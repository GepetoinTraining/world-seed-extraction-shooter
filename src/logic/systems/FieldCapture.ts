/**
 * CAPTURE, IN THE FIELD (D65): the doors the snare, the cage and the follower go through. The
 * law is `Capture.ts`; this moves the items, tells the world's records and says what happened.
 *
 * A body caught comes off its count and onto the person's register. A body let go on another map
 * joins it as a foreign branch, with the proof of its line. Who may let what go on a shared
 * map is D65's other open half, and it waits for one to exist.
 */

import { IItem, UniversalRank } from '../../../types';
import { useHubStore } from '../../entities/hub/store';
import { MOB_DEFINITIONS } from '../../entities/mob/data/mobDefinitions';
import { MobAI } from '../../entities/mob/ai/MobAI';
import { usePlayerStore } from '../../entities/player/store';
import { DirectorStore } from '../../entities/world/DirectorStore';
import { chunkOf } from '../../entities/world/grid';
import { useWorldStore } from '../../entities/world/store';
import { EntityType, IWorldEntity } from '../../entities/world/types';
import { useFeed } from '../../components/ui/stores';
import { SessionJournal } from '../journal/SessionJournal';
import { Rng, fnv1a } from '../rng/DeterministicRNG';
import { Provenance } from '../sovereignty/Provenance';
import { CreatureLines } from '../theme/CreatureLines';
import { Capture, ICaged } from './Capture';
import { WebSystem } from './WebSystem';

const feed = (text: string, tone: Parameters<ReturnType<typeof useFeed.getState>['push']>[1] = 'plain') => useFeed.getState().push(text, tone);
const session = () => usePlayerStore.getState().player.currentSession;
const levelOf = (tags: string[]) => usePlayerStore.getState().player.bank.universalSkills?.[WebSystem.mint(tags, []).id]?.level ?? 0;
const practise = (tags: string[], rank: UniversalRank | string, xp: number) =>
  usePlayerStore.getState().workOn(WebSystem.mint(tags, []), Math.max(0, Object.values(UniversalRank).indexOf(rank as UniversalRank)), xp);

const dropFromPack = (itemId: string) => usePlayerStore.setState(s => {
  const held = s.player.currentSession;
  if (!held) return s;
  const layout = { ...(held.inventoryLayout || {}) };
  delete layout[itemId];
  return { player: { ...s.player, currentSession: { ...held, inventory: held.inventory.filter(i => i.id !== itemId), inventoryLayout: layout } } };
});

const here = () => {
  const world = useWorldStore.getState();
  const card = world.availableWorlds.find(w => w.id === world.activeWorldId);
  return { world, card };
};

/** The cage goes where the pack can hold it, or to the person's feet. Nothing alive is lost to a full pack. */
const intoPack = (item: IItem) => {
  const { rejected } = usePlayerStore.getState().tryAddItems([item]);
  if (rejected.length === 0) return;
  const pos = session()?.position;
  if (!pos) return;
  useWorldStore.getState().addEntity({
    id: `cache_cage_${item.id}`, type: EntityType.CONTAINER, definitionId: 'ground_cache',
    position: { x: pos.x + 15, y: pos.z + 15 }, rank: item.rank, rarity: item.rarity, isHostile: false,
    container: { lootRank: item.rank, looted: false, hasLore: false, items: [item], cacheOwner: usePlayerStore.getState().player.id }
  });
  feed('The pack will not take the cage, so it stands at your feet.', 'loss');
};

export const FieldCapture = {

  /** A snare set on a body in reach. It is spent either way. */
  snare(entity: IWorldEntity): void {
    const { world, card } = here();
    const held = session();
    if (!held || !card || !world.activeWorldId) return;
    const def = MOB_DEFINITIONS[entity.definitionId];
    const refusal = Capture.trapRefusal(entity.id, def);
    if (refusal) { feed(refusal, 'loss'); return; }
    const snare = held.inventory.find(i => i.tags?.includes('snare'));
    if (!snare) { feed('You have no snare to set.', 'loss'); return; }

    const max = (def?.baseHealth ?? entity.health ?? 1) + (entity.bonusHealth ?? 0);
    const roll = Capture.trap({
      seed: card.seed, body: entity.id, attempt: fnv1a(snare.id), rank: entity.rank, behavior: def?.behavior,
      healthShare: (entity.health ?? max) / Math.max(1, max), skill: levelOf(['trapping'])
    });
    dropFromPack(snare.id);
    practise(['trapping'], entity.rank, 8);
    SessionJournal.record('INTERACT', { kind: 'SNARE', bodyId: entity.id, snareId: snare.id, held: roll.held, noticed: roll.noticed });
    if (!roll.held) {
      if (roll.noticed) MobAI.provoke(entity.id);
      feed(roll.noticed ? 'The snare closes on nothing, and it knows you tried.' : 'The snare closes on nothing. Nothing looks up.', roll.noticed ? 'loss' : 'plain');
      usePlayerStore.getState().recalcWeight();
      return;
    }

    const proof = CreatureLines.proofOf(world.directorRecord, { seed: card.seed, themeId: card.themeId }, entity.definitionId);
    if (!proof) { feed('The snare holds, and what it holds is nothing this machine can read. It gets away.', 'loss'); return; }
    const me = usePlayerStore.getState().player.id;
    const cage: ICaged = Capture.cage({ body: entity.id, kind: entity.definitionId, seed: card.seed, generation: world.generation, worldUid: world.activeWorldId, by: me, proof });
    const item = Capture.cageItem(cage, `${card.seed}:${snare.id}`);

    // Off its count and onto this person's register, through the door a move has
    const hub = useHubStore.getState();
    const hubId = hub.activeHubId ?? 'hub';
    const register = hub.farmland.registers[me] ?? Capture.registerOf(hubId, me, world.generation);
    const written = world.reportCaptured(entity.id, entity.definitionId, register);
    useHubStore.setState({ farmland: { ...hub.farmland, registers: { ...hub.farmland.registers, [me]: written } } });
    void useHubStore.getState().saveHubState();
    world.removeEntity(entity.id);
    MobAI.clearMob(entity.id);
    intoPack(item);
    usePlayerStore.getState().recalcWeight();
    feed('The snare holds. Something alive is in a cage now, and it is not pleased.', 'proof');
  },

  /** Let out, and answering to a hand. A hit walks beside you, and walks out with you. A miss stays caged. */
  tame(itemId: string): void {
    const held = session();
    const item = held?.inventory.find(i => i.id === itemId);
    const cage = item?.creatureData;
    if (!held || !item || !cage) return;
    const attempt = cage.tameTries ?? 0;
    const roll = Capture.tame({ cage, attempt, skill: levelOf(['taming']) });
    practise(['taming'], cage.def.rank as string, 8);
    SessionJournal.record('INTERACT', { kind: 'TAME', body: cage.body, held: roll.held, attempt });
    if (!roll.held) {
      usePlayerStore.setState(s => s.player.currentSession ? ({
        player: { ...s.player, currentSession: { ...s.player.currentSession, inventory: s.player.currentSession.inventory.map(i => (i.id === itemId ? { ...i, creatureData: { ...cage, tameTries: attempt + 1 } } : i)) } }
      }) : s);
      feed('It wants nothing to do with you yet. It stays in the cage.', 'plain');
      return;
    }
    if (!MOB_DEFINITIONS[cage.kind]) Object.assign(MOB_DEFINITIONS, { [cage.kind]: cage.def });
    const def = MOB_DEFINITIONS[cage.kind];
    const id = `tame_${fnv1a(cage.body).toString(36)}_${attempt}`;
    const until = Date.now() + roll.followMs;
    useWorldStore.getState().addEntity({
      id, type: EntityType.MOB, definitionId: cage.kind, position: { x: held.position.x + 25, y: held.position.z + 25 },
      rank: item.rank, rarity: item.rarity, health: def?.baseHealth ?? 1, isHostile: false
    });
    MobAI.follow(id, until);
    dropFromPack(itemId);
    usePlayerStore.setState(s => s.player.currentSession ? ({
      player: { ...s.player, currentSession: { ...s.player.currentSession, tamed: [...(s.player.currentSession.tamed ?? []), { entityId: id, item: { ...item, creatureData: { ...cage, tameTries: attempt + 1 } }, until }] } }
    }) : s);
    usePlayerStore.getState().recalcWeight();
    feed('It follows. For now.', 'proof');
  },

  /** The time ran out: it stops answering, and it is part of this land from here. Read each second. */
  expire(now = Date.now()): void {
    const held = session();
    const done = held?.tamed?.filter(t => t.until <= now) ?? [];
    if (!held || done.length === 0) return;
    for (const t of done) {
      const body = Object.values(useWorldStore.getState().currentMap?.chunks ?? {}).flatMap(c => c.entities).find(e => e.id === t.entityId);
      if (body) {
        MobAI.unfollow(t.entityId);
        useWorldStore.getState().reportReleased(`${chunkOf(body.position.x)},${chunkOf(body.position.y)}`, body.definitionId);
        feed('What followed you has stopped. It goes back to being what it was.', 'plain');
      }
    }
    usePlayerStore.setState(s => s.player.currentSession ? ({
      player: { ...s.player, currentSession: { ...s.player.currentSession, tamed: (s.player.currentSession.tamed ?? []).filter(t => t.until > now) } }
    }) : s);
  },

  /** At the beacon: what is still beside you goes home with you, and it weighs nothing in the pack. */
  walkOut(): void {
    const held = session();
    if (!held?.tamed?.length) return;
    const standing = new Set(Object.values(useWorldStore.getState().currentMap?.chunks ?? {}).flatMap(c => c.entities).filter(e => (e.health ?? 0) > 0).map(e => e.id));
    const out = held.tamed.filter(t => standing.has(t.entityId));
    usePlayerStore.setState(s => s.player.currentSession ? ({
      player: { ...s.player, currentSession: { ...s.player.currentSession, tamed: [], inventory: [...s.player.currentSession.inventory, ...out.map(t => t.item)] } }
    }) : s);
    for (const t of out) { MobAI.unfollow(t.entityId); useWorldStore.getState().removeEntity(t.entityId); }
    if (out.length > 0) feed(`${out.length === 1 ? 'What followed you walks' : `${out.length} that followed you walk`} out beside you.`, 'proof');
  },

  /**
   * Let go, here. Back on its own map it only rejoins its count. On another, it joins as a foreign
   * branch with the proof of its line, which moves that map's signed root and not its pack.
   */
  async release(itemId: string): Promise<void> {
    const { world, card } = here();
    const held = session();
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
      useWorldStore.getState().adoptRecord(world.activeWorldId, arrival.record);
      await CreatureLines.define(arrival.record, card.themeId);
    }
    if (!MOB_DEFINITIONS[cage.kind]) Object.assign(MOB_DEFINITIONS, { [cage.kind]: cage.def });
    const def = MOB_DEFINITIONS[cage.kind];
    const n = (useWorldStore.getState().populationRecord?.released ?? []).filter(b => b.ground === ground && b.at === world.generation).length;
    useWorldStore.getState().reportReleased(ground, cage.kind);
    useWorldStore.getState().addEntity({
      id: `rel_${ground.replace(',', '_')}_${n}`, type: EntityType.MOB, definitionId: cage.kind, position: { x: held.position.x + 25, y: held.position.z + 25 },
      rank: item.rank, rarity: item.rarity, health: def?.baseHealth ?? 1, isHostile: false
    });
    dropFromPack(itemId);
    usePlayerStore.getState().recalcWeight();
    SessionJournal.record('INTERACT', { kind: 'RELEASE', body: cage.body, ground, foreign: !home });
    await Provenance.record(item, 'TRANSFER', { via: 'RELEASED', worldUid: world.activeWorldId, ground, foreign: !home });
    feed(home ? 'It goes. It knows this ground.' : 'It goes. This land did not know its kind until now, and the map has changed to say so.', 'proof');
  },

  /** A snare tied at home, from what the stash holds. */
  async tieAtHome(): Promise<{ ok: boolean; reason?: string }> {
    const stash = usePlayerStore.getState().player.bank.stashTabs[0]?.items ?? [];
    const key = `${usePlayerStore.getState().player.id}:${Date.now()}:${Rng.fromKey(String(stash.length)).next()}`;
    const res = Capture.tieSnare(stash, key);
    if (!res.ok || !res.item) return { ok: false, reason: res.reason };
    usePlayerStore.setState(s => ({
      player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((tab, i) => (i === 0 ? { ...tab, items: [...tab.items.filter(x => !res.consumedIds.includes(x.id)), res.item!] } : tab)) } }
    }));
    await Provenance.record(res.item, 'MINT', { origin: 'IMPROVISATION', consumedIds: res.consumedIds });
    return { ok: true };
  }
};
