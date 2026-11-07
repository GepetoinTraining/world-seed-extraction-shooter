/**
 * THE ESCORT, IN THE FIELD (Q16): where `Escort`'s law meets the stores. A person secured walks
 * at your heel through `MobAI`'s follower door, so what would come for you comes for them when
 * they are nearer. Their blows go to the fight as swings, the field's blows reach them here, and
 * at the beacon they go home as the bond the field has always written.
 */

import { IEscort, IItem } from '../../../shared/types';
import { MobAI } from '../../entities/mob/ai/MobAI';
import type { IPlayerPort } from '../../entities/player/playerView';
import { bodiesOf, bodyOf, openCard, type IWorldPort } from '../../entities/world/worldView';
import { EntityType, IWorldEntity } from '../../../shared/entities/world/types';
import { useFeed } from '../../components/ui/stores';
import { fnv1a } from '../../../shared/logic/rng/DeterministicRNG';
import { Escort, IEscortSwing } from './Escort';
import { NpcSheet } from '../../../shared/logic/systems/NpcSheet';

const feed = (text: string, tone: 'plain' | 'signal' | 'proof' | 'loss' = 'plain') => useFeed.getState().push(text, tone);
const session = (pc: IPlayerPort) => pc.view().player.currentSession;

const setEscorts = (change: (escorts: IEscort[]) => IEscort[], pc: IPlayerPort) => pc.apply({ kind: 'UPDATE', update: was => was.currentSession ? ({ ...was, currentSession: { ...was.currentSession, escorts: change(was.currentSession.escorts ?? []) } }) : was });

const bondId = (bond: IEscort['bond']) => `bond_${fnv1a(`${bond.worldSeed}:${bond.entityId}`).toString(36)}`;

export const FieldEscort = {

  /** "they will come": secured, they stay in the world, at your side. Nothing goes in the pack. */
  join(entity: IWorldEntity, port: IWorldPort, pc: IPlayerPort): IEscort | null {
    if (!entity.npc || entity.escort) return null;
    const world = port.view();
    const card = world.availableWorlds ? openCard(world) : undefined;
    const seed = world.currentMap?.seed ?? '';
    const sheet = NpcSheet.read(seed, entity, card?.webVersion);
    const bond: IEscort['bond'] = {
      worldSeed: seed, entityId: entity.id, webVersion: card?.webVersion, themeId: card?.themeId,
      rank: entity.rank, rarity: entity.rarity, sheet: { ...entity.npc }
    };
    const escort = Escort.join(entity, bond, sheet.stats ?? NpcSheet.statsOf(seed, entity));
    setEscorts(list => [...list.filter(e => e.entityId !== entity.id), escort], pc);
    port.apply({ kind: 'UPDATE_BODY', entityId: entity.id, patch: { escort: { by: pc.view().player.id }, health: escort.health } });
    MobAI.follow(entity.id, Number.POSITIVE_INFINITY);
    return escort;
  },

  escorts(pc: IPlayerPort): IEscort[] {
    return session(pc)?.escorts ?? [];
  },

  /** Where each one still standing is now, for the blows the field throws. */
  standing(port: IWorldPort, pc: IPlayerPort): { entityId: string; x: number; y: number }[] {
    const alive = new Set(this.escorts(pc).filter(e => !e.fallen).map(e => e.entityId));
    return bodiesOf(port.view()).filter(b => alive.has(b.id)).map(b => ({ entityId: b.id, x: b.position.x, y: b.position.y }));
  },

  /** Their blows this frame, at whatever has engaged within their reach. */
  swings(now: number, chunkEntities: IWorldEntity[], port: IWorldPort, pc: IPlayerPort): IEscortSwing[] {
    const out: IEscortSwing[] = [];
    const hostiles = chunkEntities
      .filter(e => e.type === EntityType.MOB && (e.health ?? 0) > 0 && !MobAI.isFollowing(e.id))
      .map(e => ({ id: e.id, x: e.position.x, y: e.position.y, engaged: MobAI.isActive(e.id) && (e.isHostile !== false || MobAI.isProvoked(e.id)) }));
    if (hostiles.length === 0) return out;
    const at = new Map<string, { x: number; y: number }>(FieldEscort.standing(port, pc).map(b => [b.entityId, b]));
    const next = this.escorts(pc).map(escort => {
      const pos = at.get(escort.entityId);
      if (!pos) return escort;
      const { escort: after, swing } = Escort.strike(escort, pos, hostiles, now);
      if (swing) out.push(swing);
      return after;
    });
    if (out.length > 0) setEscorts(() => next, pc);
    return out;
  },

  /** A blow that reached one of them. */
  hurt(entityId: string, raw: number, key: string, port: IWorldPort, pc: IPlayerPort): void {
    const escort = this.escorts(pc).find(e => e.entityId === entityId);
    if (!escort || escort.fallen) return;
    const { escort: after, fell } = Escort.take(escort, raw, key);
    setEscorts(list => list.map(e => (e.entityId === entityId ? after : e)), pc);
    if (fell) this.fall(entityId, port, pc);
    else port.apply({ kind: 'UPDATE_BODY', entityId, patch: { health: after.health } });
  },

  /** Down: they lie where they fell, and wait to be carried. */
  fall(entityId: string, port: IWorldPort, pc: IPlayerPort): void {
    const escort = this.escorts(pc).find(e => e.entityId === entityId);
    if (!escort) return;
    setEscorts(list => list.map(e => (e.entityId === entityId ? { ...e, health: 0, fallen: true } : e)), pc);
    MobAI.unfollow(entityId);
    port.apply({ kind: 'UPDATE_BODY', entityId, patch: { health: 0, escort: { by: pc.view().player.id, fallen: true } } });
    feed(`${escort.name} is down. Carry them to the beacon and they come back on the other side.`, 'loss');
  },

  /**
   * Their own record is the truth of them. The field writes its copy of the chunks back after the
   * blows of a frame have landed, so this puts each body right from the record afterwards.
   */
  settle(port: IWorldPort, pc: IPlayerPort): void {
    const by = pc.view().player.id;
    for (const escort of this.escorts(pc)) {
      const body = bodyOf(port.view(), escort.entityId);
      if (!body) continue;
      const fallen = !!escort.fallen;
      if (body.health === escort.health && !!body.escort?.fallen === fallen && body.escort?.by === by) continue;
      port.apply({ kind: 'UPDATE_BODY', entityId: escort.entityId, patch: { health: escort.health, escort: { by, ...(fallen ? { fallen: true } : {}) } } });
    }
  },

  /** "you grab them as a corpse": onto your back, if the pack will bear it. */
  carry(entityId: string, port: IWorldPort, pc: IPlayerPort): boolean {
    const escort = this.escorts(pc).find(e => e.entityId === entityId && e.fallen);
    if (!escort) return false;
    const corpse = Escort.corpseOf(escort);
    const { rejected } = pc.tryAddItems([corpse]);
    if (rejected.length > 0) {
      feed(`${escort.name} is too heavy for what you carry. Leave something, or leave them.`, 'loss');
      return false;
    }
    port.apply({ kind: 'REMOVE_BODY', entityId });
    pc.apply({ kind: 'RECALC_WEIGHT' });
    feed(`You take ${escort.name} up. They are heavy.`, 'plain');
    return true;
  },

  /** Set down, they lie at your feet again, as they were. Nothing of theirs comes open. */
  setDown(item: IItem, port: IWorldPort, pc: IPlayerPort): boolean {
    if (!Escort.isCorpse(item) || !item.bondData) return false;
    const held = session(pc);
    if (!held) return false;
    const sheet = item.bondData.sheet;
    pc.apply({ kind: 'UPDATE', update: was => {
      const cur = was.currentSession;
      if (!cur) return was;
      const layout = { ...(cur.inventoryLayout ?? {}) };
      delete layout[item.id];
      return { ...was, currentSession: { ...cur, inventory: cur.inventory.filter(i => i.id !== item.id), inventoryLayout: layout } };
    } });
    port.apply({ kind: 'ADD_BODY', entity: {
      id: item.bondData.entityId, type: EntityType.NPC, definitionId: 'npc_survivor',
      position: { x: held.position.x + 15, y: held.position.z + 15 }, rank: item.bondData.rank, rarity: item.bondData.rarity, isHostile: false,
      health: 0, npc: { ...(sheet as IWorldEntity['npc'])! }, escort: { by: pc.view().player.id, fallen: true }
    } });
    pc.apply({ kind: 'RECALC_WEIGHT' });
    feed(`You set ${sheet.name} down.`, 'plain');
    return true;
  },

  /**
   * At the beacon: whoever still walks beside you comes home as their bond, and whoever you carried
   * comes back on the other side. A fallen one left on the ground stays in this world.
   */
  walkOut(port: IWorldPort, pc: IPlayerPort): void {
    const held = session(pc);
    if (!held) return;
    const escorts = held.escorts ?? [];
    const walking = escorts.filter(e => !e.fallen && (bodyOf(port.view(), e.entityId)?.health ?? 0) > 0);
    const carried = held.inventory.filter(i => Escort.isCorpse(i) && i.bondData);
    if (walking.length === 0 && carried.length === 0 && escorts.length === 0) return;
    const bonds = [
      ...walking.map(e => Escort.bondOf(e.bond, bondId(e.bond), false)),
      ...carried.map(c => Escort.bondOf(c.bondData!, bondId(c.bondData!), true))
    ];
    const carriedIds = new Set(carried.map(c => c.id));
    pc.apply({ kind: 'UPDATE', update: was => {
      const cur = was.currentSession;
      if (!cur) return was;
      const layout = { ...(cur.inventoryLayout ?? {}) };
      carriedIds.forEach(id => delete layout[id]);
      return { ...was, currentSession: { ...cur, escorts: [], inventoryLayout: layout, inventory: [...cur.inventory.filter(i => !carriedIds.has(i.id)), ...bonds] } };
    } });
    for (const e of walking) { MobAI.unfollow(e.entityId); port.apply({ kind: 'REMOVE_BODY', entityId: e.entityId }); }
    pc.apply({ kind: 'RECALC_WEIGHT' });
    for (const e of walking) feed(`${e.name} walks out beside you.`, 'proof');
    for (const c of carried) feed(`${c.bondData!.sheet.name} comes back on the other side.`, 'proof');
  }
};
