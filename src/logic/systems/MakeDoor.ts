/**
 * WHAT A PERSON WANTS TO MAKE, REACHING OUT (D119). The law is `MakeAsk`, pure; this is where it meets the stores and the
 * record. Laying an ask moves the components out of the vault to wait with the words; the next long sleep carries it
 * (`RestDoor.file`) and its answer is settled on return (`RestDoor.settleMade`). A technology already standing in this hub
 * is made at once from the same components, with nobody asked, by the roll and the price every making takes, and is read
 * at the next rest like anything else made by hand.
 */

import type { IPlayerPort } from '../../entities/player/playerView';
import type { IHubPort } from '../../entities/hub/hubView';
import { useFeed } from '../../components/ui/stores';
import { MakeAsk } from '../../../shared/logic/systems/MakeAsk';
import { WorkCost } from '../../../shared/logic/systems/WorkCost';
import { ProgressionSystem } from '../../../shared/entities/player/systems/ProgressionSystem';
import { ownerHasStationFor } from '../../../shared/entities/hub/room';
import { GameClock } from '../time/GameClock';
import { Provenance } from '../sovereignty/Provenance';
import { RestSystem } from './RestSystem';
import { StudySystem } from './StudySystem';

const feed = (text: string, tone: 'plain' | 'signal' | 'proof' | 'loss' = 'plain') => useFeed.getState().push(text, tone);

export const MakeDoor = {
  /** Laid for the night: the components leave the vault and wait with what was said. */
  lay(words: string, itemIds: string[], pc: IPlayerPort): { ok: boolean; reason?: string } {
    const out = MakeAsk.lay(pc.view().player, words, itemIds, GameClock.now());
    if (!out.ok || !out.player || !out.ask) {
      feed(out.reason ?? 'It could not be laid.', 'loss');
      return { ok: false, reason: out.reason };
    }
    pc.apply({ kind: 'SET', player: out.player });
    feed(`Laid for your next rest: "${out.ask.words}", of ${out.ask.parts.map(p => p.name).join(', ')}. It is answered while you sleep.`, 'signal');
    return { ok: true };
  },

  takeBack(askId: string, pc: IPlayerPort): void {
    const before = pc.view().player;
    const ask = (before.makeAsks ?? []).find(a => a.id === askId);
    if (!ask) return;
    // Filed already: the sleep will answer nothing for it, and its answer is let go on return (RestDoor.settleMade)
    pc.apply({ kind: 'SET', player: MakeAsk.takeBack(before, askId) });
    feed(`Taken back: "${ask.words}". What you laid is in your vault.`, 'plain');
  },

  /** A technology this hub already holds, made now of what is put in. Unread until a rest, as anything made by hand is. */
  async makeNow(techId: string, itemIds: string[], pc: IPlayerPort, hp: IHubPort): Promise<{ ok: boolean; reason?: string }> {
    const before = pc.view().player;
    const view = hp.view();
    const stash = before.bank.stashTabs.flatMap(t => t.items);
    const parts = stash.filter(i => itemIds.includes(i.id));
    if (parts.length === 0) return { ok: false, reason: 'Put in what it is made of.' };
    const cost = WorkCost.make(before, parts[0], parts[1] ?? parts[0]);
    const left = StudySystem.energyLeft(before);
    if (left < cost) {
      const reason = `Refused: needs ${cost} energy, you hold ${Math.floor(left)}. Rest first.`;
      feed(reason, 'loss');
      return { ok: false, reason };
    }
    const out = MakeAsk.makeNow(before, techId, itemIds, {
      rank: ProgressionSystem.rankOf(before),
      dexterity: before.attributes?.dexterity ?? 1,
      skillLevel: id => before.bank.universalSkills[id]?.level ?? 0,
      hasBench: asks => ownerHasStationFor(asks, before.id, { lots: view.lots, rooms: view.rooms, stash }),
      hasTool: word => MakeAsk.lacking(before, [word]).length === 0
    }, GameClock.now(), view.tech?.made);
    if (!out.ok || !out.player || !out.made || !out.tech) {
      feed(out.reason ?? 'It would not come together.', 'loss');
      return { ok: false, reason: out.reason };
    }
    const waiting = { id: out.made.item.id, outcome: out.made.outcome, ...(out.made.why ? { why: out.made.why } : {}), ...(out.tech.trade ? { trade: out.tech.trade } : {}) };
    pc.apply({ kind: 'SET', player: RestSystem.queueMade(StudySystem.pay(out.player, cost), waiting) });
    await Provenance.record(out.made.item, 'MINT', { origin: 'IMPROVISATION', consumedIds: parts.map(p => p.id), techId });
    // The same words whatever came of it, as when one thing is set on another: a rest says what it is
    feed(`You worked them together (${cost} energy). Something came of it. A rest will say what.`, 'signal');
    return { ok: true };
  }
};
