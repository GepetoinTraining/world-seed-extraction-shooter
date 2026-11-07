/**
 * CAPTURE, IN THE FIELD (D65): the doors the snare, the cage and the follower go through. The
 * law is `Capture.ts`; this moves the items, tells the world's records and says what happened.
 *
 * A body caught comes off its count and onto the person's register. A body let go on another map
 * joins it as a foreign branch, with the proof of its line. Who may let what go on a shared
 * map is D65's other open half, and it waits for one to exist.
 */

import { IItem, UniversalRank } from '../../../shared/types';
import { useHubStore, worldDay } from '../../entities/hub/store';
import { MemoryStore, rememberThreat } from '../../entities/interaction/memoryStore';
import { Deeds } from '../memory/Deeds';
import { MOB_DEFINITIONS } from '../../../shared/entities/mob/data/mobDefinitions';
import { MobAI } from '../../entities/mob/ai/MobAI';
import type { IPlayerPort } from '../../entities/player/playerView';
import { DirectorStore } from '../../entities/world/DirectorStore';
import { chunkOf } from '../../../shared/entities/world/grid';
import { bodiesOf, bodyOf, openCard, type IWorldPort } from '../../entities/world/worldView';
import { Population, emptyPopulationRecord } from '../../../shared/entities/world/Population';
import { EntityType, IWorldEntity } from '../../../shared/entities/world/types';
import { useFeed } from '../../components/ui/stores';
import { SessionJournal } from '../journal/SessionJournal';
import { Rng, fnv1a } from '../../../shared/logic/rng/DeterministicRNG';
import { Provenance } from '../sovereignty/Provenance';
import { CreatureLines } from '../../../shared/logic/theme/CreatureLines';
import { Capture, ICaged } from '../../../shared/logic/systems/Capture';
import { WebSystem } from '../../../shared/logic/systems/WebSystem';

const feed = (text: string, tone: Parameters<ReturnType<typeof useFeed.getState>['push']>[1] = 'plain') => useFeed.getState().push(text, tone);
const session = (pc: IPlayerPort) => pc.view().player.currentSession;
const levelOf = (tags: string[], pc: IPlayerPort) => pc.view().player.bank.universalSkills?.[WebSystem.mint(tags, []).id]?.level ?? 0;
const practise = (tags: string[], rank: UniversalRank | string, xp: number, pc: IPlayerPort) =>
  pc.apply({ kind: 'WORK_ON', pair: WebSystem.mint(tags, []), rank: Math.max(0, Object.values(UniversalRank).indexOf(rank as UniversalRank)), xp });

const dropFromPack = (itemId: string, pc: IPlayerPort) => pc.apply({ kind: 'UPDATE', update: was => {
  const held = was.currentSession;
  if (!held) return was;
  const layout = { ...(held.inventoryLayout || {}) };
  delete layout[itemId];
  return { ...was, currentSession: { ...held, inventory: held.inventory.filter(i => i.id !== itemId), inventoryLayout: layout } };
} });

const here = (port: IWorldPort) => {
  const world = port.view();
  return { world, card: openCard(world) };
};

/** The cage goes where the pack can hold it, or to the person's feet. Nothing alive is lost to a full pack. */
const intoPack = (item: IItem, port: IWorldPort, pc: IPlayerPort) => {
  const { rejected } = pc.tryAddItems([item]);
  if (rejected.length === 0) return;
  const pos = session(pc)?.position;
  if (!pos) return;
  port.apply({ kind: 'ADD_BODY', entity: {
    id: `cache_cage_${item.id}`, type: EntityType.CONTAINER, definitionId: 'ground_cache',
    position: { x: pos.x + 15, y: pos.z + 15 }, rank: item.rank, rarity: item.rarity, isHostile: false,
    container: { lootRank: item.rank, looted: false, hasLore: false, items: [item], cacheOwner: pc.view().player.id }
  } });
  feed('The pack will not take the cage, so it stands at your feet.', 'loss');
};

export const FieldCapture = {

  /** A snare set on a body in reach. It is spent either way. */
  snare(entity: IWorldEntity, port: IWorldPort, pc: IPlayerPort): void {
    const { world, card } = here(port);
    const held = session(pc);
    if (!held || !card || !world.activeWorldId) return;
    const def = MOB_DEFINITIONS[entity.definitionId];
    const refusal = Capture.trapRefusal(entity.id, def);
    if (refusal) { feed(refusal, 'loss'); return; }
    const snare = held.inventory.find(i => i.tags?.includes('snare'));
    if (!snare) { feed('You have no snare to set.', 'loss'); return; }

    const max = (def?.baseHealth ?? entity.health ?? 1) + (entity.bonusHealth ?? 0);
    const roll = Capture.trap({
      seed: card.seed, body: entity.id, attempt: fnv1a(snare.id), rank: entity.rank, behavior: def?.behavior,
      healthShare: (entity.health ?? max) / Math.max(1, max), skill: levelOf(['trapping'], pc)
    });
    dropFromPack(snare.id, pc);
    practise(['trapping'], entity.rank, 8, pc);
    SessionJournal.record('INTERACT', { kind: 'SNARE', bodyId: entity.id, snareId: snare.id, held: roll.held, noticed: roll.noticed });
    if (!roll.held) {
      if (roll.noticed) {
        MobAI.provoke(entity.id);
        void rememberThreat(card.seed, entity.id, pc.view().player.id, worldDay(), { held: false });
      }
      feed(roll.noticed ? 'The snare closes on nothing, and it knows you tried.' : 'The snare closes on nothing. Nothing looks up.', roll.noticed ? 'loss' : 'plain');
      pc.apply({ kind: 'RECALC_WEIGHT' });
      return;
    }

    const proof = CreatureLines.proofOf(world.directorRecord, { seed: card.seed, themeId: card.themeId }, entity.definitionId);
    if (!proof) { feed('The snare holds, and what it holds is nothing this machine can read. It gets away.', 'loss'); return; }
    const me = pc.view().player.id;
    // Caught: it goes to the hub now, and keeps who caught it there, open, as long as it is held
    void MemoryStore.write({ hubId: useHubStore.getState().activeHubId ?? 'hub' }, [{ owner: entity.id, what: Deeds.caught({ day: worldDay(), by: me, owner: entity.id, held: true }) }]);
    const cage: ICaged = Capture.cage({ body: entity.id, kind: entity.definitionId, seed: card.seed, generation: world.generation, worldUid: world.activeWorldId, by: me, proof });
    const item = Capture.cageItem(cage, `${card.seed}:${snare.id}`);

    // Off its count and onto this person's register, through the door a move has
    const hub = useHubStore.getState();
    const hubId = hub.activeHubId ?? 'hub';
    const register = hub.farmland.registers[me] ?? Capture.registerOf(hubId, me, world.generation);
    const now = port.view();
    const written = Population.captured(now.populationRecord ?? emptyPopulationRecord(), entity.id, entity.definitionId, now.generation, register).to;
    port.apply({ kind: 'CAPTURED', entityId: entity.id, definitionId: entity.definitionId, to: register });
    useHubStore.setState({ farmland: { ...hub.farmland, registers: { ...hub.farmland.registers, [me]: written } } });
    void useHubStore.getState().saveHubState();
    port.apply({ kind: 'REMOVE_BODY', entityId: entity.id });
    MobAI.clearMob(entity.id);
    intoPack(item, port, pc);
    pc.apply({ kind: 'RECALC_WEIGHT' });
    feed('The snare holds. Something alive is in a cage now, and it is not pleased.', 'proof');
  },

  /** Let out, and answering to a hand. A hit walks beside you, and walks out with you. A miss stays caged. */
  tame(itemId: string, port: IWorldPort, pc: IPlayerPort): void {
    const held = session(pc);
    const item = held?.inventory.find(i => i.id === itemId);
    const cage = item?.creatureData;
    if (!held || !item || !cage) return;
    const attempt = cage.tameTries ?? 0;
    const roll = Capture.tame({ cage, attempt, skill: levelOf(['taming'], pc) });
    practise(['taming'], cage.def.rank as string, 8, pc);
    SessionJournal.record('INTERACT', { kind: 'TAME', body: cage.body, held: roll.held, attempt });
    if (!roll.held) {
      pc.apply({ kind: 'UPDATE', update: was => was.currentSession ? ({ ...was, currentSession: { ...was.currentSession, inventory: was.currentSession.inventory.map(i => (i.id === itemId ? { ...i, creatureData: { ...cage, tameTries: attempt + 1 } } : i)) } }) : was });
      feed('It wants nothing to do with you yet. It stays in the cage.', 'plain');
      return;
    }
    if (!MOB_DEFINITIONS[cage.kind]) Object.assign(MOB_DEFINITIONS, { [cage.kind]: cage.def });
    const def = MOB_DEFINITIONS[cage.kind];
    const id = `tame_${fnv1a(cage.body).toString(36)}_${attempt}`;
    const until = Date.now() + roll.followMs;
    port.apply({ kind: 'ADD_BODY', entity: {
      id, type: EntityType.MOB, definitionId: cage.kind, position: { x: held.position.x + 25, y: held.position.z + 25 },
      rank: item.rank, rarity: item.rarity, health: def?.baseHealth ?? 1, isHostile: false
    } });
    MobAI.follow(id, until);
    dropFromPack(itemId, pc);
    pc.apply({ kind: 'UPDATE', update: was => was.currentSession ? ({ ...was, currentSession: { ...was.currentSession, tamed: [...(was.currentSession.tamed ?? []), { entityId: id, item: { ...item, creatureData: { ...cage, tameTries: attempt + 1 } }, until }] } }) : was });
    pc.apply({ kind: 'RECALC_WEIGHT' });
    feed('It follows. For now.', 'proof');
  },

  /** The time ran out: it stops answering, and it is part of this land from here. Read each second. */
  expire(port: IWorldPort, pc: IPlayerPort, now = Date.now()): void {
    const held = session(pc);
    const done = held?.tamed?.filter(t => t.until <= now) ?? [];
    if (!held || done.length === 0) return;
    for (const t of done) {
      const body = bodyOf(port.view(), t.entityId);
      if (body) {
        MobAI.unfollow(t.entityId);
        port.apply({ kind: 'RELEASED', ground: `${chunkOf(body.position.x)},${chunkOf(body.position.y)}`, definitionId: body.definitionId });
        feed('What followed you has stopped. It goes back to being what it was.', 'plain');
      }
    }
    pc.apply({ kind: 'UPDATE', update: was => was.currentSession ? ({ ...was, currentSession: { ...was.currentSession, tamed: (was.currentSession.tamed ?? []).filter(t => t.until > now) } }) : was });
  },

  /** At the beacon: what is still beside you goes home with you, and it weighs nothing in the pack. */
  walkOut(port: IWorldPort, pc: IPlayerPort): void {
    const held = session(pc);
    if (!held?.tamed?.length) return;
    const standing = new Set(bodiesOf(port.view()).filter(e => (e.health ?? 0) > 0).map(e => e.id));
    const out = held.tamed.filter(t => standing.has(t.entityId));
    pc.apply({ kind: 'UPDATE', update: was => was.currentSession ? ({ ...was, currentSession: { ...was.currentSession, tamed: [], inventory: [...was.currentSession.inventory, ...out.map(t => t.item)] } }) : was });
    for (const t of out) { MobAI.unfollow(t.entityId); port.apply({ kind: 'REMOVE_BODY', entityId: t.entityId }); }
    if (out.length > 0) feed(`${out.length === 1 ? 'What followed you walks' : `${out.length} that followed you walk`} out beside you.`, 'proof');
  },

  /**
   * Let go, here. Back on its own map it only rejoins its count. On another, it joins as a foreign
   * branch with the proof of its line, which moves that map's signed root and not its pack.
   */
  async release(itemId: string, port: IWorldPort, pc: IPlayerPort): Promise<void> {
    const { world, card } = here(port);
    const held = session(pc);
    const item = held?.inventory.find(i => i.id === itemId);
    const cage = item?.creatureData;
    if (!held || !item || !cage || !card || !world.activeWorldId) return;
    if (!world.populationRecord || !world.directorRecord) { feed('This place keeps no count of what lives here. It would not last.', 'loss'); return; }

    const ground = `${chunkOf(held.position.x)},${chunkOf(held.position.z)}`;
    const home = cage.caughtAt.worldUid === world.activeWorldId;
    if (!home) {
      const proof = await CreatureLines.sealProof(cage.proof);
      const arrival = await CreatureLines.arrive(world.directorRecord, { seed: card.seed, themeId: card.themeId }, proof, ground);
      if (!arrival.ok) { feed(`It will not take here. ${arrival.reason ?? ''}`.trim(), 'loss'); return; }
      await DirectorStore.save(world.activeWorldId, arrival.record);
      port.apply({ kind: 'ADOPT_RECORD', worldId: world.activeWorldId, record: arrival.record });
      await CreatureLines.define(arrival.record, card.themeId);
    }
    if (!MOB_DEFINITIONS[cage.kind]) Object.assign(MOB_DEFINITIONS, { [cage.kind]: cage.def });
    const def = MOB_DEFINITIONS[cage.kind];
    const n = (port.view().populationRecord?.released ?? []).filter(b => b.ground === ground && b.at === world.generation).length;
    port.apply(
      { kind: 'RELEASED', ground, definitionId: cage.kind },
      { kind: 'ADD_BODY', entity: {
        id: `rel_${ground.replace(',', '_')}_${n}`, type: EntityType.MOB, definitionId: cage.kind, position: { x: held.position.x + 25, y: held.position.z + 25 },
        rank: item.rank, rarity: item.rarity, health: def?.baseHealth ?? 1, isHostile: false
      } }
    );
    dropFromPack(itemId, pc);
    pc.apply({ kind: 'RECALC_WEIGHT' });
    SessionJournal.record('INTERACT', { kind: 'RELEASE', body: cage.body, ground, foreign: !home });
    await Provenance.record(item, 'TRANSFER', { via: 'RELEASED', worldUid: world.activeWorldId, ground, foreign: !home });
    feed(home ? 'It goes. It knows this ground.' : 'It goes. This land did not know its kind until now, and the map has changed to say so.', 'proof');
  },

  /** A snare tied at home, from what the stash holds. */
  async tieAtHome(pc: IPlayerPort): Promise<{ ok: boolean; reason?: string }> {
    const stash = pc.view().player.bank.stashTabs[0]?.items ?? [];
    const key = `${pc.view().player.id}:${Date.now()}:${Rng.fromKey(String(stash.length)).next()}`;
    const res = Capture.tieSnare(stash, key);
    if (!res.ok || !res.item) return { ok: false, reason: res.reason };
    pc.apply({ kind: 'UPDATE', update: was => ({ ...was, bank: { ...was.bank, stashTabs: was.bank.stashTabs.map((tab, i) => (i === 0 ? { ...tab, items: [...tab.items.filter(x => !res.consumedIds.includes(x.id)), res.item!] } : tab)) } }) });
    await Provenance.record(res.item, 'MINT', { origin: 'IMPROVISATION', consumedIds: res.consumedIds });
    return { ok: true };
  }
};
