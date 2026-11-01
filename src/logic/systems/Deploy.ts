/**
 * One door into a world (Wave 9.7): Mission Control and the Conduit's quick
 * deploy go through the same checks and open the same journal.
 */

import { useWorldStore } from '../../entities/world/store';
import { usePlayerStore } from '../../entities/player/store';
import { SessionJournal } from '../journal/SessionJournal';
import { PlayerPersistence } from '../persistence/PlayerPersistence';

export async function deployToWorld(worldId: string): Promise<{ ok: boolean; reason?: string }> {
  const card = useWorldStore.getState().availableWorlds.find(w => w.id === worldId);
  if (!card) return { ok: false, reason: 'No such world.' };
  if (card.retired) return { ok: false, reason: 'Made of what no longer exists. Its record stands, but it can no longer be walked.' };

  // Wave 4.4: the world cert's power gates are enforced at the door
  if (card.ipCap || card.ipFloor) {
    const { RANK_MULTIPLIERS } = await import('../../constants');
    const stash = usePlayerStore.getState().player.bank.stashTabs[0]?.items || [];
    const playerIP = stash.reduce((m, i) => Math.max(m, i.itemPower || 0), 0);
    const rankIP = (r: string) => (RANK_MULTIPLIERS as any)[r] * 100;
    if (card.ipCap && playerIP > rankIP(card.ipCap)) {
      return { ok: false, reason: `Refused: your gear (${playerIP} IP) exceeds this world's cap (${card.ipCap}).` };
    }
    if (card.ipFloor && playerIP < rankIP(card.ipFloor)) {
      return { ok: false, reason: `Refused: this world requires at least ${card.ipFloor}-grade gear.` };
    }
  }

  await useWorldStore.getState().selectWorld(worldId);
  usePlayerStore.getState().diveIntoLayer(card.seed);

  // Wave 1.2: open the session journal with the claim's baseHash
  const { player } = usePlayerStore.getState();
  if (player.currentSession) {
    await SessionJournal.start(
      player.currentSession.sessionId, worldId, card.seed,
      PlayerPersistence.persistableJson(player)
    );
  }
  return { ok: true };
}
