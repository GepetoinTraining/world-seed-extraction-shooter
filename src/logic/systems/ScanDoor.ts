/**
 * The scan pass, reaching out: the part that touches stores, the ledger and the door.
 * The rules are in ScanPass and stay pure; this is where they meet a browser, until a
 * served runtime drives them instead (D70).
 *
 * It runs on a timer in the app and nothing waits on it. With no key, no network or a
 * server that is down, a world still regenerates and stands on plain names.
 */

import { useWorldStore, IWorldCard } from '../../entities/world/store';
import { useHubStore } from '../../entities/hub/store';
import { WorldClock } from '../../entities/world/WorldClock';
import { useFeed } from '../../components/ui/stores';
import { IntelligenceClient } from '../intelligence/IntelligenceClient';
import { Ledger } from '../ledger/Ledger';
import { CreatureLines } from '../../../shared/logic/theme/CreatureLines';
import { DirectorStore } from '../../entities/world/DirectorStore';
import { IScanDoor, IScanReport, ScanPass } from './ScanPass';
import { scanRoom } from './ScanRoom';

/** How long a closed door stays believed before it is asked again. A guess until Wave 12. */
const DOOR_ASKED_EVERY_MS = 5 * 60_000;

let ticking = false;
let doorSaid: { at: number; open: boolean } | null = null;
const lastSlot = new Map<string, string>();
const defined = new Set<string>();
const told = new Set<string>();

const browserDoor: IScanDoor = {
  async open() {
    const now = Date.now();
    if (!doorSaid || now - doorSaid.at >= DOOR_ASKED_EVERY_MS) doorSaid = { at: now, open: (await IntelligenceClient.status()).available };
    return doorSaid.open;
  },
  file: async (id, kind, asks, theme, spent) => IntelligenceClient.fileWindow(id, kind, asks, theme, spent),
  collect: async batchId => IntelligenceClient.collectWindow(batchId)
};

const say = (card: IWorldCard, report: IScanReport) => {
  // How many, never who: a masked name stays masked (D60)
  const written = report.installed.length;
  if (written > 0) useFeed.getState().push(`${card.name} is booting, and ${written} ${written === 1 ? 'change has its' : 'changes have their'} words now. Recon reads ${written === 1 ? 'it' : 'them'}.`, 'signal');
  for (const r of report.refused) {
    if (told.has(`${r.order}:${r.reason}`)) continue;
    told.add(`${r.order}:${r.reason}`);
    console.warn(`[SCAN] ${card.name}, ${r.order}: ${r.reason} It waits for the next window.`);
  }
};

export const ScanDoor = {
  /** Every world's definitions, once a session, so what a person carries out of one keeps reading anywhere. */
  async defineOnce(card: IWorldCard): Promise<void> {
    if (defined.has(card.id)) return;
    defined.add(card.id);
    await CreatureLines.define(await DirectorStore.load(card.id), card.themeId);
  },

  /** One pass over every world this client knows, at most once per slot of each. */
  async tick(now = Date.now()): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      const worlds = useWorldStore.getState().availableWorlds.filter(w => !w.isDebug);
      for (const card of worlds) {
        await ScanDoor.defineOnce(card);
        const moment = WorldClock.momentAt(card, now);
        if (moment.phase !== 'SCAN') continue;
        const slot = `${moment.generation}_${ScanPass.slotAt(card, now)}`;
        if (lastSlot.get(card.id) === slot) continue;
        lastSlot.set(card.id, slot);

        const report = await ScanPass.step(card, now, scanRoom, browserDoor);
        if (report.record) useWorldStore.getState().adoptRecord(card.id, report.record);
        say(card, report);
        for (const usage of report.used) {
          await Ledger.append('TECH', { kind: 'INTELLIGENCE_USE', hubId: useHubStore.getState().activeHubId, door: 'window', worldId: card.id, ...usage });
        }
      }
    } catch (e) {
      console.warn('[SCAN] This pass stopped, and the next picks it up:', e);
    } finally {
      ticking = false;
    }
  }
};
