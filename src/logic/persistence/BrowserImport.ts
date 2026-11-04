/**
 * THE ONE-TIME IMPORT (D31): browser saves move into the database, on proof.
 *
 * Each origin's old RxDB database is read and offered to the server the first time
 * this build runs there. The rules:
 *
 *   - Verified, not trusted. A bank doc, a ledger chain, a session receipt and an
 *     item's history are checked against their signatures. An avatar that fails, or
 *     whose certificate is not on this origin, is refused WHOLE, and left in the
 *     browser. The refusal is on record, so it is never silently re-born as new.
 *   - Idempotent. Everything goes in through put-if-absent, so running it again,
 *     or after play has moved on, changes nothing. The database is always ahead.
 *   - Nothing is deleted. The browser's copy stays where it was.
 *
 * Hub states, treasuries, carts and definitions carry no signature to check. They
 * move as they are, and a treasury that does not balance goes on the report.
 */

import { chainProblem } from '../ledger/chainLaw';
import { CertificateSystem, IPlayerCertificate } from '../../entities/identity/certificateSystem';
import { IVectorDocument, VectorNamespace, VectorStore } from '../../entities/data/VectorStore';
import { StoreUnit } from '../../entities/data/StoreUnit';
import { HomeHub } from './HomeHub';

export type ILegacyDoc = IVectorDocument<any>;

export interface IImportReport {
  origin: string;
  imported: number;
  avatars: string[];
  /** What stayed behind in the browser, and why. */
  refused: { id: string; reason: string }[];
  /** What moved but did not add up, or could not be checked. */
  notes: string[];
}

const ROW_ID = /^ledger_(.+)_(\d+)$/;
const REGISTRY_ID = 'mint_registry_v1';
const receiptId = (origin: string) => `browser_import_${origin}`;
export const refusedAvatarId = (uid: string) => `import_refused_${uid}`;

async function commitAbsent(docs: ILegacyDoc[]): Promise<void> {
  const unit = new StoreUnit();
  for (const doc of docs) await VectorStore.put(doc, false, { unit, ifAbsent: true });
  const result = await unit.commit();
  if (!result.ok) throw new Error(result.reason);
}

export class BrowserImport {

  /** Once per origin per database, at the gate. The database's receipt says whether it has happened. */
  static async runOnce(): Promise<IImportReport | null> {
    const origin = window.location.host;
    if (await VectorStore.get(VectorNamespace.TERRITORIES, receiptId(origin))) return null;

    const docs = await this.readLegacyDocs();
    if (docs === null) return null;

    const { AvatarRoster } = await import('../../entities/identity/roster');
    const certs = AvatarRoster.list().map(e => e.certificate);
    return this.importDocs(docs, certs, origin);
  }

  /** The old browser database, or null if this origin never had one. Opening it never creates one. */
  private static async readLegacyDocs(): Promise<ILegacyDoc[] | null> {
    const databases = await indexedDB.databases?.() ?? [];
    if (!databases.some(d => d.name?.includes('worldseed_db'))) return null;

    const { getDatabase } = await import('../../entities/data/RxDBClient');
    const db = await getDatabase();
    const found = await db.vectors.find().exec();
    return found.map((d: any) => JSON.parse(JSON.stringify(d.toJSON())) as ILegacyDoc);
  }

  /** The import itself: verify, sort, commit. Safe to run any number of times. */
  static async importDocs(docs: ILegacyDoc[], certs: IPlayerCertificate[], origin: string): Promise<IImportReport> {
    const report: IImportReport = { origin, imported: 0, avatars: [], refused: [], notes: [] };
    const certOf = new Map(certs.map(c => [c.metadata.uid, c]));
    const byId = new Map(docs.map(d => [d.id, d]));

    const rowsByOwner = new Map<string, ILegacyDoc[]>();
    for (const doc of docs) {
      const row = ROW_ID.exec(doc.id);
      if (row && !doc.id.startsWith('ledger_head_') && doc.namespace === VectorNamespace.TRANSACTIONS) {
        rowsByOwner.set(row[1], [...(rowsByOwner.get(row[1]) ?? []), doc]);
      }
    }

    // 1. Avatars: the bank doc and its whole chain stand or fall together.
    const owners = new Set<string>([...rowsByOwner.keys(), ...docs.filter(d => d.namespace === VectorNamespace.CHARACTERS).map(d => d.id)]);
    const refusedOwners = new Set<string>();
    for (const uid of owners) {
      const reason = await this.verifyAvatar(uid, byId.get(uid), rowsByOwner.get(uid) ?? [], certOf.get(uid));
      if (reason) {
        report.refused.push({ id: uid, reason });
        refusedOwners.add(uid);
        await VectorStore.put({
          id: refusedAvatarId(uid),
          namespace: VectorNamespace.TERRITORIES,
          data: { origin, reason },
          metadata: { createdAt: Date.now(), updatedAt: Date.now(), ownerCertUid: uid, version: 1 }
        }, false, { ifAbsent: true });
        continue;
      }
      const rows = (rowsByOwner.get(uid) ?? []).sort((a, b) => a.data.payload.seq - b.data.payload.seq);
      const char = byId.get(uid);
      await commitAbsent([...rows, ...(char ? [char] : [])]);
      report.imported += rows.length + (char ? 1 : 0);
      report.avatars.push(certOf.get(uid)!.metadata.displayName);
    }

    // 2. The hub layer and everything else, sorted by what can be checked.
    const moved = new Set<string>([...owners, ...[...rowsByOwner.values()].flat().map(d => d.id)]);
    const rest: ILegacyDoc[] = [];
    for (const doc of docs) {
      if (moved.has(doc.id) || doc.id.startsWith('ledger_head_') || doc.id === REGISTRY_ID) continue;

      if (doc.id.startsWith('session_')) {
        const reason = await this.verifySession(doc, certOf);
        if (reason) { report.refused.push({ id: doc.id, reason }); continue; }
      }
      if (doc.id.startsWith('prov_')) {
        const reason = await this.verifyProvenance(doc);
        if (reason) { report.refused.push({ id: doc.id, reason }); continue; }
      }
      rest.push(doc);
    }
    if (rest.length > 0) await commitAbsent(rest);
    report.imported += rest.length;

    // 3. The bank's registry of claims: one document per origin, merged. The first keeps its claim.
    const registry = byId.get(REGISTRY_ID);
    if (registry) await this.mergeRegistry(registry);

    // 4. Each avatar keeps the hub it knew.
    await this.pinHomes(docs, owners, refusedOwners, origin);

    // 5. Does what moved add up?
    this.auditTreasuries(docs, report);

    await VectorStore.put({
      id: receiptId(origin),
      namespace: VectorNamespace.TERRITORIES,
      data: { origin, at: Date.now(), imported: report.imported, avatars: report.avatars, refused: report.refused, notes: report.notes },
      metadata: { createdAt: Date.now(), updatedAt: Date.now(), ownerCertUid: 'SYSTEM', version: 1 }
    });

    console.log(`[IMPORT] ${origin}: ${report.imported} documents moved, ${report.refused.length} refused, avatars: ${report.avatars.join(', ') || 'none'}.`);
    return report;
  }

  private static async verifyAvatar(uid: string, char: ILegacyDoc | undefined, rows: ILegacyDoc[], cert?: IPlayerCertificate): Promise<string | null> {
    if (!cert) return 'No certificate for this avatar on this origin, so nothing can be verified.';

    if (char) {
      const data = char.data;
      if (!data?.signature || !data?.payload) return 'The bank doc is unsigned.';
      if (data.certUid !== uid) return 'The bank doc names another signer.';
      if (!(await CertificateSystem.verifyPayload(data, cert))) return 'The bank doc fails its signature.';
    }

    const ordered = [...rows].sort((a, b) => (a.data?.payload?.seq ?? 0) - (b.data?.payload?.seq ?? 0));
    let expected = 1;
    for (const row of ordered) {
      const { payload } = row.data ?? {};
      if (payload?.seq !== expected || payload?.prevSeq !== expected - 1 || Number(ROW_ID.exec(row.id)![2]) !== expected) {
        return `The ledger chain breaks at seq ${expected}.`;
      }
      if (!(await CertificateSystem.verifyPayload(row.data, cert))) return `Ledger row ${expected} fails its signature.`;
      expected++;
    }
    const broken = chainProblem(ordered.map(r => r.data));
    return broken ? broken.why : null;
  }

  private static async verifySession(doc: ILegacyDoc, certOf: Map<string, IPlayerCertificate>): Promise<string | null> {
    const cert = certOf.get(doc.data?.certUid);
    if (!cert) return 'No certificate for this receipt on this origin.';
    return (await CertificateSystem.verifyPayload(doc.data, cert)) ? null : 'The receipt fails its signature.';
  }

  private static async verifyProvenance(doc: ILegacyDoc): Promise<string | null> {
    for (const record of doc.data?.events ?? []) {
      const { signerKey, ...signed } = record;
      const valid = await CertificateSystem.verifyPayload(signed, { publicKeyJWK: signerKey } as IPlayerCertificate);
      if (!valid) return 'An event in this item\'s history fails its signature.';
    }
    return null;
  }

  private static async mergeRegistry(incoming: ILegacyDoc): Promise<void> {
    const held = await VectorStore.get<{ rows: [string, string][] }>(VectorNamespace.ITEMS, REGISTRY_ID);
    const merged = new Map<string, string>(held?.data?.rows ?? []);
    for (const [tuple, itemId] of (incoming.data?.rows ?? []) as [string, string][]) {
      if (!merged.has(tuple)) merged.set(tuple, itemId);
    }
    await VectorStore.put({ ...incoming, data: { rows: [...merged.entries()] }, metadata: { ...incoming.metadata, updatedAt: Date.now() } });
  }

  /** The hub where an avatar holds a lot, or else the hub this origin would have opened. */
  private static async pinHomes(docs: ILegacyDoc[], owners: Set<string>, refused: Set<string>, origin: string): Promise<void> {
    const hubs = docs
      .filter(d => d.namespace === VectorNamespace.CONTENT && d.data?.type === 'world_certificate' && d.data?.content?.data?.worldType === 'HUB')
      .map(d => d.data.content.data.worldUid as string)
      .sort();
    if (hubs.length === 0) return;
    const states = new Map(docs.filter(d => d.id.startsWith('hub_state_')).map(d => [d.id.slice('hub_state_'.length), d.data]));

    for (const uid of owners) {
      if (refused.has(uid) || await HomeHub.of(uid)) continue;
      const holding = hubs.find(hub => (states.get(hub)?.lots ?? []).some((lot: any) => lot.ownerId === uid));
      await HomeHub.pin(uid, holding ?? hubs[0], origin);
    }
  }

  /** The audit's own law, over what this origin held. Reported, not refused: the debt it describes is older than this leg. */
  private static auditTreasuries(docs: ILegacyDoc[], report: IImportReport): void {
    const endowed = docs.filter(d => d.id.startsWith('endowment_')).reduce((s, d) => s + (d.data?.gold || 0), 0);
    const held = docs.filter(d => d.id.startsWith('treasury_')).reduce((s, d) => s + (d.data?.gold || 0), 0);
    if (!docs.some(d => d.id.startsWith('treasury_'))) return;

    let expected = endowed;
    for (const doc of docs) {
      if (!ROW_ID.test(doc.id) || doc.id.startsWith('ledger_head_')) continue;
      const { type, data } = doc.data?.payload ?? {};
      if (type === 'GOLD_DELTA' || type === 'TRADE') expected += data?.treasuryDelta ?? 0;
      if (type === 'TAX') expected += data?.tax ?? 0;
      if (type === 'UPKEEP') expected += data?.amount ?? 0;
    }
    if (expected !== held) {
      report.notes.push(`The treasury on ${report.origin} holds ${held}G where its rows say ${expected}G. Moved as it stood.`);
    }
  }
}
