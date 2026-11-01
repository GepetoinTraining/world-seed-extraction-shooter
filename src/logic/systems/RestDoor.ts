/**
 * The rest, reaching out: the part of a rest that touches stores, the ledger and the
 * door. The rules are in RestSystem and stay pure; this is where they meet the world.
 */

import { usePlayerStore } from '../../entities/player/store';
import { useHubStore } from '../../entities/hub/store';
import { useWorldStore } from '../../entities/world/store';
import { useFeed } from '../../components/ui/stores';
import { GoldCommit } from '../economy/GoldCommit';
import { Ledger } from '../ledger/Ledger';
import { ContentRegistry } from '../theme/ContentRegistry';
import { IntelligenceClient } from '../intelligence/IntelligenceClient';
import { WebSystem } from './WebSystem';
import { HubUnlock } from './HubUnlock';
import { DirectorStore } from '../../entities/world/DirectorStore';
import { IDreamResult, INN_FEE, RestPlace, RestSystem } from './RestSystem';

const feed = (text: string, tone: 'plain' | 'signal' | 'proof' | 'loss' = 'plain') => useFeed.getState().push(text, tone);

export const RestDoor = {
  /** Settling, at any rest. A return to the hub comes through here too (D30). */
  settle(): { emerged: { id: string }[] } {
    const { player, read, emerged, learned, floorNamed } = RestSystem.settle(usePlayerStore.getState().player);
    usePlayerStore.setState({ player });
    for (const item of read) feed(`You know what ${item.name} is now. It reads exactly as it was banked.`, 'proof');
    for (const id of learned) feed(`It settled: you could cast ${ContentRegistry.ability(id)?.name ?? 'what you saw'} now.`, 'proof');
    for (const id of floorNamed) void RestDoor.unlockFrom(id);
    return { emerged };
  },

  /** D49: the first magic settled in a hub unlocks that hub, and says so once. */
  async unlockFrom(what: string): Promise<void> {
    const p = usePlayerStore.getState().player;
    if (await HubUnlock.unlock(p.id, what)) {
      feed('Something in this hub has changed. What is found from now on may carry more than its name.', 'signal');
      useHubStore.getState().generateDailyStock();
    }
  },

  /** A chosen rest. Energy, the day, the Director, and what was queued goes to the door. */
  async sleep(place: RestPlace): Promise<{ ok: boolean; reason?: string }> {
    const before = usePlayerStore.getState().player;
    const verdict = RestSystem.canRest(before, place);
    if (!verdict.ok) {
      feed(verdict.reason!, 'loss');
      return verdict;
    }

    if (place === 'INN') {
      const hubId = useHubStore.getState().activeHubId ?? 'hub_unknown';
      usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: s.player.bank.gold - INN_FEE } } }));
      void GoldCommit.commit({
        rows: [{ type: 'GOLD_DELTA', data: { reason: 'INN', amount: -INN_FEE, treasuryId: hubId, treasuryDelta: INN_FEE } }],
        treasury: { worldUid: hubId, delta: INN_FEE }
      });
    }

    await RestDoor.collect();
    const { emerged } = RestDoor.settle();
    usePlayerStore.setState(s => ({ player: RestSystem.restoreEnergy(s.player) }));
    for (const skill of emerged) feed(`It settled: ${WebSystem.nameOf(skill.id)}. The hands know it now.`, 'proof');
    feed('You slept. It is another day.', 'signal');
    await useHubStore.getState().creditHeld();
    await DirectorStore.evolveAll(useWorldStore.getState().availableWorlds.map(w => w.id));
    await RestDoor.file(emerged);
    return { ok: true };
  },

  /** Send what was queued, if there is anything and a door. Nothing waits on this. */
  async file(emerged: { id: string }[]): Promise<void> {
    const player = usePlayerStore.getState().player;
    if (player.pendingDream) return;
    const queue = RestSystem.dreamQueue(player, emerged);
    const skills = queue.skills as unknown[];
    const weaves = queue.weaves as unknown[];
    if (skills.length === 0 && weaves.length === 0) return;

    const world = useWorldStore.getState();
    const card = world.availableWorlds.find(w => w.id === world.activeWorldId) ?? world.availableWorlds.find(w => !w.retired);
    const theme = ContentRegistry.get(card?.themeId) ?? ContentRegistry.list()[0];
    const summary = theme ? { name: theme.name, premise: theme.premise, regions: theme.regions.map(r => r.name) } : {};

    const id = `rest_${player.id}_${player.dayCount ?? 0}`;
    const out = await IntelligenceClient.fileRest(id, queue, summary);
    if (out.status === 'PENDING' && out.batchId) {
      usePlayerStore.setState(s => ({
        player: {
          ...s.player,
          pendingDream: {
            batchId: out.batchId!,
            asked: {
              skills: (skills as { id: string }[]).map(q => q.id),
              weaves: (weaves as { id: string }[]).map(q => q.id)
            }
          }
        }
      }));
    } else if (out.status !== 'NO_KEY' && out.status !== 'OFFLINE') {
      console.log(`[REST] The batch waits for the next rest: ${out.status}. ${out.reason ?? ''}`);
    }
  },

  /** Bring back what was filed, if it is ready: judged by the law, signed, and applied. */
  async collect(): Promise<void> {
    const pending = usePlayerStore.getState().player.pendingDream;
    if (!pending) return;
    const out = await IntelligenceClient.collectRest<IDreamResult>(pending.batchId);
    if (out.status === 'PENDING' || out.status === 'OFFLINE' || out.status === 'NO_KEY') return;
    if (out.status !== 'OK' || !out.data) {
      usePlayerStore.setState(s => ({ player: { ...s.player, pendingDream: undefined } }));
      return;
    }
    const verdict = RestSystem.judgeDream(out.data, pending.asked);
    if (!verdict.ok) {
      console.warn(`[REST] What came back was refused whole: ${verdict.reason}`);
      usePlayerStore.setState(s => ({ player: { ...s.player, pendingDream: undefined } }));
      return;
    }
    const before = usePlayerStore.getState().player;
    usePlayerStore.setState({ player: RestSystem.applyDream(before, out.data) });
    const hubId = useHubStore.getState().activeHubId;
    if (out.usage) await Ledger.append('TECH', { kind: 'INTELLIGENCE_USE', hubId, door: 'rest', ...out.usage });
    for (const w of out.data.weaves) {
      // Spellcraft's rule: the first to name it names it for everyone, signed
      if (!(before.weaveNames ?? {})[w.id] || before.weaveNames![w.id].startsWith('Unnamed')) {
        await Ledger.append('TECH', { kind: 'WEAVE_NAMED', weaveId: w.id, name: w.name, hubId, by: before.id });
        feed(`What you wove has a name now: ${w.name}. The bank has it signed.`, 'proof');
      }
    }
    for (const s of out.data.skills) feed(`${s.name}: ${s.flavor}`, 'signal');
  }
};
