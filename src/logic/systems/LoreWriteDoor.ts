/**
 * Writing a skill out, reaching out (the design pass, part 3): the part that touches stores, the ledger and the clock.
 * The law is LorePiece and stays pure. It is asked when the hand begins, takes a sitting's time, and is asked again when
 * the time is up, since the vault or the energy may have moved in between; then the sheet and the energy go, the piece
 * lands in the vault, and a row goes on the ledger.
 */

import type { IPlayerPort } from '../../entities/player/playerView';
import type { IHubPort } from '../../entities/hub/hubView';
import { hubTreeOf } from '../../entities/hub/hubTech';
import { useFeed, useWaits } from '../../components/ui/stores';
import { Ledger } from '../ledger/Ledger';
import { GameClock } from '../time/GameClock';
import { LorePiece } from './LorePiece';
import { WebSystem } from '../../../shared/logic/systems/WebSystem';
import { SkillNames } from './SkillNames';

const WAIT_ID = 'lore_writing';
let writing: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const feed = (text: string, tone: 'plain' | 'signal' | 'proof' | 'loss' = 'plain') => useFeed.getState().push(text, tone);

export const LoreWriteDoor = {
  busy: () => writing,

  /** The hand begins: asked now, written when a sitting's time is up. */
  start(skillId: string, pc: IPlayerPort, hp: IHubPort): { ok: boolean; reason?: string; seconds?: number } {
    if (writing) return { ok: false, reason: 'You are already writing.' };
    const player = pc.view().player;
    const hub = hubTreeOf(hp.view().tech);
    const verdict = LorePiece.canWrite(player, skillId, hub, GameClock.now());
    if (!verdict.ok) { feed(verdict.reason!, 'loss'); return verdict; }
    const { cost, seconds } = LorePiece.ask(player, LorePiece.heldSkill(player, skillId)!, hub);
    writing = skillId;
    const startedAt = Date.now();
    useWaits.getState().begin({ id: WAIT_ID, label: 'WRITING', startedAt, until: startedAt + seconds * 1000 });
    feed(`Writing out ${SkillNames.nameOf(skillId)}. A sheet of paper, ${cost} energy, ${seconds}s.`, 'signal');
    timer = setTimeout(() => { void LoreWriteDoor.finish(pc, hp); }, seconds * 1000);
    return { ok: true, seconds };
  },

  /** The time is up: asked again, then written. */
  async finish(pc: IPlayerPort, hp: IHubPort): Promise<{ ok: boolean; reason?: string; itemId?: string }> {
    const skillId = writing;
    LoreWriteDoor.reset();
    if (!skillId) return { ok: false, reason: 'Nothing was being written.' };
    const player = pc.view().player;
    const hub = hubTreeOf(hp.view().tech);
    const verdict = LorePiece.canWrite(player, skillId, hub, GameClock.now());
    if (!verdict.ok) { feed(verdict.reason!, 'loss'); return verdict; }
    const sheet = LorePiece.paperOf(player)!;
    const who = { uid: player.id, name: player.username || 'Someone' };
    const out = LorePiece.write(player, skillId, who, GameClock.now(), hub);
    pc.apply({ kind: 'SET', player: out.player });
    feed(`${out.item.name} is in your vault. Your hands still know it.`, 'proof');
    await Ledger.append('TECH', {
      kind: 'LORE_WRITTEN', skillId, itemId: out.item.id, energy: out.cost, hubId: hp.view().activeHubId, consumedIds: [sheet.id]
    });
    return { ok: true, itemId: out.item.id };
  },

  reset(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    writing = null;
    useWaits.getState().end(WAIT_ID);
  }
};
