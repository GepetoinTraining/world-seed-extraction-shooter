/**
 * The game's side of the record (D133): it says when a world's gate has gone down, and
 * tells a person once where this game stands. All the work is on the server. Commits never
 * come through here, and the browser holds nothing of the record.
 *
 * A world's clock runs in the client today, so whichever client is here is who notices
 * (as `ScanDoor` does). A gate that goes down with nobody here is written down at the next
 * maintenance or clean stop: later, and nothing lost.
 */
import { useFeed } from '../../components/ui/stores';
import { StoreClient } from '../../entities/data/StoreClient';
import { WorldClock } from '../../entities/world/WorldClock';
import { useWorldStore } from '../../entities/world/store';

const lastPhase = new Map<string, string>();
const told = new Set<string>();
let ticking = false;

/** The worlds whose gate was seen open and is now seen shut. Pure: `seen` is the only thing it keeps. */
export function gatesGoneDown(worlds: { id: string; phase: string }[], seen: Map<string, string>): string[] {
  const down: string[] = [];
  for (const { id, phase } of worlds) {
    if (seen.get(id) === 'UP' && phase !== 'UP') down.push(id);
    seen.set(id, phase);
  }
  return down;
}

export const RecordDoor = {
  async tick(now = Date.now()): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      const worlds = useWorldStore.getState().availableWorlds
        .filter(w => !w.isDebug && !w.retired)
        .map(w => ({ id: w.id, phase: WorldClock.momentAt(w, now).phase as string }));
      if (gatesGoneDown(worlds, lastPhase).length > 0) {
        await fetch('/api/db/record', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ why: 'gate' }) });
      }
      const says = (await StoreClient.health()).record?.says;
      if (says && !told.has(says)) {
        told.add(says);
        useFeed.getState().push(says, 'signal');
      }
    } catch (e) {
      console.warn('[RECORD] This look stopped, and the next picks it up:', e);
    } finally {
      ticking = false;
    }
  }
};
