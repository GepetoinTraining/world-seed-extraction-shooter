/**
 * Creation, reaching out: the door, and the rows that sign what it gave. The rules are in
 * CreationSystem and stay pure.
 *
 * Nothing waits on a model (D35): whatever the door says, however late, this answers. A
 * refusal, no key, no network or a door that never answers all come back as the floor.
 */

import { IItem, IPlayer } from '../../../shared/types';
import { IDoorMessage, IDoorUsage, IntelligenceClient } from '../intelligence/IntelligenceClient';
import { LedgerRowType } from '../ledger/Ledger';
import { CreationSystem, ICreationAsk, ICreationDraftChoices, ICreationSheet, ICreationWords, IKamiWords } from './CreationSystem';
import { isWorldDeed, WorldDeed } from './WorldDeed';

/** How long a person is kept waiting before the floor answers instead. */
export const DOOR_PATIENCE_MS = 12_000;

export interface ICreationAnswer { words: ICreationWords; by: 'DOOR' | 'FLOOR'; usage?: IDoorUsage; reason?: string }

/** How many times the Seed is asked for one grant: once, and once more with the reason if the law refused it. */
const GRANT_ASKS = 2;

/** What two asks cost together. The record names the model once and adds what it read and wrote. */
const addUsage = (a: IDoorUsage | undefined, b: IDoorUsage | undefined): IDoorUsage | undefined => {
  if (!a || !b) return a ?? b;
  const sum: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) if (typeof v === 'number') sum[k] = (typeof sum[k] === 'number' ? sum[k] as number : 0) + v;
  return sum as unknown as IDoorUsage;
};

const SHEET_KEY = (uid: string) => `worldseed_creation_sheet_${uid}`;

export const CreationDoor = {
  /**
   * C9: a grant the law refuses is asked once more, with the reason, as a world's passes are. A second
   * refusal falls to the floor, which follows the same law and makes sense on its own. Both asks share
   * the one wait, and whatever was spent on them is on the record either way.
   */
  async seek(draft: ICreationDraftChoices, patienceMs = DOOR_PATIENCE_MS): Promise<ICreationAnswer> {
    const floor = CreationSystem.floor(draft);
    const ask: ICreationAsk = CreationSystem.ask(draft);
    let usage: IDoorUsage | undefined;
    const granting = async (): Promise<ICreationAnswer> => {
      let refused: string | undefined;
      for (let attempt = 0; attempt < GRANT_ASKS; attempt++) {
        const out = await IntelligenceClient.grantSkills<ICreationWords>(refused ? { ...ask, refused } : ask);
        usage = addUsage(usage, out.usage);
        if (out.status !== 'OK' || !out.data) return { words: floor, by: 'FLOOR', usage, reason: out.reason ?? out.status };
        const verdict = CreationSystem.judge(out.data, ask);
        if (verdict.ok) return { words: out.data, by: 'DOOR', usage };
        console.warn(`[CREATION] What came back was refused whole: ${verdict.reason}`);
        refused = verdict.reason;
      }
      return { words: floor, by: 'FLOOR', usage, reason: refused };
    };
    return Promise.race([
      granting(),
      new Promise<ICreationAnswer>(resolve => setTimeout(() => resolve({ words: floor, by: 'FLOOR', usage, reason: 'The Seed took too long.' }), patienceMs))
    ]);
  },

  /** He sets up the class. Whatever comes back, however late, this answers, and fate deals what he does not. */
  async seekKami(messages: IDoorMessage[], patienceMs = DOOR_PATIENCE_MS, persona?: string): Promise<{ words: IKamiWords; by: 'DOOR' | 'FLOOR'; usage?: IDoorUsage; reason?: string }> {
    const floor = CreationSystem.fateFloor(messages);
    const ask = CreationSystem.kamiAsk();
    const out = await Promise.race([
      IntelligenceClient.setKami<IKamiWords>(messages, ask, persona),
      new Promise<{ status: 'OUTAGE'; data?: undefined; usage?: undefined; reason: string }>(resolve => setTimeout(() => resolve({ status: 'OUTAGE', reason: 'He took too long.' }), patienceMs))
    ]);
    if (out.status !== 'OK' || !out.data) return { words: floor, by: 'FLOOR', reason: out.reason ?? out.status };
    const verdict = CreationSystem.judgeKami(out.data, ask);
    if (!verdict.ok) {
      console.warn(`[CREATION] What he set up was refused whole: ${verdict.reason}`);
      return { words: floor, by: 'FLOOR', usage: out.usage, reason: verdict.reason };
    }
    return { words: out.data, by: 'DOOR', usage: out.usage };
  },

  /**
   * Nothing is saved until the person walks in, so a reload on the face-to-face screen must
   * not rebirth them with nothing. The sheet stays in this browser until the genesis row lands.
   */
  holdSheet(uid: string, sheet: ICreationSheet): void {
    try { localStorage.setItem(SHEET_KEY(uid), JSON.stringify(sheet)); } catch { /* the store still holds them for this sitting */ }
  },

  heldSheet(uid: string): ICreationSheet | undefined {
    try {
      const raw = localStorage.getItem(SHEET_KEY(uid));
      return raw ? JSON.parse(raw) as ICreationSheet : undefined;
    } catch {
      return undefined;
    }
  },

  releaseSheet(uid: string): void {
    try { localStorage.removeItem(SHEET_KEY(uid)); } catch { /* nothing held */ }
  },

  /** What lands with CHARACTER_GENESIS: nothing here moves gold, so the audit reads only the grant. */
  genesisRows(player: IPlayer, usage?: IDoorUsage): { type: LedgerRowType; data: Record<string, any> }[] {
    const rows: { type: LedgerRowType; data: Record<string, any> }[] = [];
    const deed = WorldDeed.free(player.id);
    if ((player.bank.stashTabs[0]?.items ?? []).some(i => i.id === deed.id)) {
      rows.push({ type: 'TRADE', data: { kind: 'WORLD_DEED_GRANTED', deedId: deed.id, size: deed.worldDeedData!.size, playerDelta: 0, treasuryDelta: 0 } });
    }
    const made = player.creation;
    if (!made) return rows;
    const kit = kitHeldBy(player);
    rows.push({ type: 'TRADE', data: { kind: 'KIT_GRANTED', kit: made.kit, itemIds: kit.map(i => i.id), playerDelta: 0, treasuryDelta: 0 } });
    rows.push({
      type: 'TECH',
      data: {
        kind: 'CREATION_GRANTED',
        origin: made.origin, main: made.main, sub: made.sub, by: made.by,
        ...(made.className ? { className: made.className } : {}),
        skills: Object.keys(player.skillWords ?? {}),
        words: player.skillWords,
        line: made.line
      }
    });
    if (usage) rows.push({ type: 'TECH', data: { kind: 'INTELLIGENCE_USE', door: 'creation', ...usage } });
    return rows;
  },

  /** The deed and the kit reach the bank signed, as anything that reaches the bank does. */
  async provenance(player: IPlayer): Promise<void> {
    const { Provenance } = await import('../sovereignty/Provenance');
    for (const item of [...(player.bank.stashTabs[0]?.items ?? []).filter(isWorldDeed), ...kitHeldBy(player)]) {
      await Provenance.record(item, 'MINT', { origin: isWorldDeed(item) ? 'FREE_DEED' : 'CREATION_KIT', authorUid: player.id, authorName: player.username });
    }
  }
};

function kitHeldBy(player: IPlayer): IItem[] {
  const made = player.creation;
  if (!made) return [];
  const minted = new Set(CreationSystem.kitPreview(made.kit).map(p => p.definitionId));
  const held = [...(player.bank.stashTabs[0]?.items ?? []), ...(player.equipment?.items ?? [])];
  return held.filter(i => minted.has(i.universalDefinitionId));
}
