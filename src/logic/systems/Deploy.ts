/**
 * One door into a world (Wave 9.7): Mission Control and the Conduit's quick
 * deploy go through the same checks and open the same journal.
 */

import type { IWorldPort } from '../../entities/world/worldView';
import type { IPlayerPort } from '../../entities/player/playerView';
import type { IHubPort } from '../../entities/hub/hubView';
import { SessionJournal } from '../journal/SessionJournal';
import { PlayerPersistence } from '../persistence/PlayerPersistence';
import { WorldClock } from '../../entities/world/WorldClock';
import { WorldCertificateSystem } from '../../entities/world/WorldCertificate';
import { RestDoor } from './RestDoor';
import { RestSystem } from './RestSystem';
import { useWaits, whileWaiting } from '../../components/ui/stores';

/** The one wait for opening a world, whichever door it came through. */
export const OPENING_WORLD = 'opening_world';

/** Press it twice and nothing more happens: the first is still opening. */
export async function deployToWorld(worldId: string, world: IWorldPort, pc: IPlayerPort, hp: IHubPort): Promise<{ ok: boolean; reason?: string }> {
  if (useWaits.getState().waits.some(w => w.id === OPENING_WORLD)) return { ok: false };
  return whileWaiting(OPENING_WORLD, 'OPENING THE GATE', () => enterWorld(worldId, world, pc, hp));
}

async function enterWorld(worldId: string, world: IWorldPort, pc: IPlayerPort, hp: IHubPort): Promise<{ ok: boolean; reason?: string }> {
  const card = world.view().availableWorlds.find(w => w.id === worldId);
  if (!card) return { ok: false, reason: 'No such world.' };

  // D79: a character at rest is down, and another can play
  const now = Date.now();
  await RestDoor.wakeIfDue(pc, hp, now);
  const sleeper = pc.view().player;
  if (RestSystem.isResting(sleeper, now)) {
    return { ok: false, reason: `This character is at rest for ${WorldClock.say(sleeper.rest!.until - now)} more. Another can go.` };
  }

  // D67: the gate runs on the world's clock
  const moment = WorldClock.momentAt(card, now);
  if (!moment.canDeploy) {
    return {
      ok: false,
      reason: moment.phase === 'SCAN'
        ? `${card.name} is booting. Recon is open, and the gate opens in ${WorldClock.say(moment.msLeft)}.`
        : `The gate to ${card.name} is down. It boots in ${WorldClock.say(moment.msLeft)}.`
    };
  }

  // Wave 4.4: the world cert's power gates are enforced at the door
  if (card.ipCap || card.ipFloor) {
    const { RANK_MULTIPLIERS } = await import('../../../shared/constants');
    const stash = pc.view().player.bank.stashTabs[0]?.items || [];
    const playerIP = stash.reduce((m, i) => Math.max(m, i.itemPower || 0), 0);
    const rankIP = (r: string) => (RANK_MULTIPLIERS as any)[r] * 100;
    if (card.ipCap && playerIP > rankIP(card.ipCap)) {
      return { ok: false, reason: `Refused: your gear (${playerIP} IP) exceeds this world's cap (${card.ipCap}).` };
    }
    if (card.ipFloor && playerIP < rankIP(card.ipFloor)) {
      return { ok: false, reason: `Refused: this world requires at least ${card.ipFloor}-grade gear.` };
    }
  }

  await world.open(worldId);
  // Q41: AGENTS counts drops into the world. The simulation stands outside the count.
  if (!card.isDebug) {
    await WorldCertificateSystem.recordDrop(worldId);
    world.apply({ kind: 'DROP_COUNTED', worldId });
  }
  world.apply({ kind: 'APPLY_SURVEY', survey: pc.view().player.survey?.[worldId] });
  pc.apply({ kind: 'DIVE', layerId: card.seed, penalty: card.deathPenalty });

  // Wave 1.2: open the session journal with the claim's baseHash
  const { player } = pc.view();
  if (player.currentSession) {
    await SessionJournal.start(
      player.currentSession.sessionId, worldId, card.seed,
      PlayerPersistence.persistableJson(player)
    );
  }
  return { ok: true };
}
