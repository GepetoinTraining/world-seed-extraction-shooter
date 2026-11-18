/**
 * A CHARACTER BROUGHT TO THIS BROWSER (Pedro, 2026-11-18: "the central node of the keys must be the
 * account, what we then do is allow the person to export character from their idb to ours for
 * changing where they'll play").
 *
 * The hub holds a character's record and its save, of the head it last sent (HubLink.send). A browser
 * signed in to the account that holds the character takes it: a key is made here, the hub makes it
 * the character's from the next row on and retires the one before, and the save and every row are
 * written into this browser's own store. Nothing is taken on trust: every row must be signed by a
 * key the hub says was the character's, each on the one under it, and the save by one of them too,
 * and what this browser already holds of the character must agree with what the hub holds.
 *
 * The key never leaves a browser. The one this browser makes is written here only once the hub has
 * taken it; a bring that fails after that is simply asked again, and makes another.
 */
import { CertificateSystem, type IPlayerCertificate, type ISignedPayload } from '../../entities/identity/certificateSystem';
import { AvatarRoster } from '../../entities/identity/roster';
import { VectorNamespace, VectorStore } from '../../../shared/entities/data/VectorStore';
import { StoreUnit } from '../../../shared/entities/data/StoreUnit';
import { chainProblem } from '../../../shared/logic/ledger/chainLaw';
import type { IPlayer } from '../../../shared/types';
import { Ledger, type ILedgerRow } from '../ledger/Ledger';
import { HubClient } from './HubClient';
import { HubLink } from './HubLink';

export interface IBrought { ok: boolean; reason?: string; displayName?: string; rows?: number }

const no = (reason: string): IBrought => ({ ok: false, reason });

/** Every row the hub holds of a character, in order, asked for in parts. */
async function rowsFromHub(uid: string): Promise<ISignedPayload<ILedgerRow>[] | string> {
  const rows: ISignedPayload<ILedgerRow>[] = [];
  let from: number | null = 1;
  while (from !== null) {
    const part = await HubClient.rows(uid, from);
    if (!part.ok || !Array.isArray(part.rows)) return part.reason ?? 'The hub did not hand over this character\'s rows.';
    rows.push(...part.rows);
    from = part.next ?? null;
    if (part.rows.length === 0) break;
  }
  return rows;
}

export async function bringCharacter(uid: string): Promise<IBrought> {
  const hub = await HubClient.hub();
  if (!hub.ok || !hub.hub) return no(hub.reason ?? 'This hub cannot be reached.');

  // What this browser already holds of it must be the start of what the hub holds, and nothing more
  const rows = await rowsFromHub(uid);
  if (typeof rows === 'string') return no(rows);
  const here = await Ledger.list(uid);
  if (here.length > rows.length) return no('This browser holds more of this character than the hub does: it went on here after it was taken elsewhere, and those rows are not the hub\'s. It plays on in the browser it was taken to.');
  for (let i = 0; i < here.length; i++) {
    if (JSON.stringify(here[i]) !== JSON.stringify(rows[i])) return no(`What this browser holds of this character differs from the hub at row ${i + 1}. Nothing was changed.`);
  }

  // A key made here, which the hub makes the character's
  const keyPair = await CertificateSystem.makeKeyPair();
  const publicKeyJWK = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const nonce = await HubClient.nonce();
  if (!nonce.ok || !nonce.nonce) return no(nonce.reason ?? 'The hub gave no text to sign.');
  const proof = await CertificateSystem.signWith(keyPair.privateKey, uid, { claim: 'hub-character-key', hub: hub.hub.id, nonce: nonce.nonce });
  const out = await HubClient.bring(uid, publicKeyJWK, proof);
  if (!out.ok) return no(out.reason ?? 'The hub did not hand this character over.');
  if ((out.held ?? 0) !== rows.length) return no('This character changed on the hub while it was being brought. Ask again.');

  const createdAt = Number(out.createdAt) || Date.now();
  const metadata = {
    uid,
    displayName: String(out.displayName ?? ''),
    // Where and when it was born stayed in the browser that made it: the hub was never told, and none is invented
    birthData: { coordinates: { latitude: 0, longitude: 0, accuracy: 0 }, timestamp: createdAt, entropy: '', userAgent: '' },
    createdAt,
    version: '1.0.0'
  };
  const certificate: IPlayerCertificate = {
    metadata,
    publicKeyJWK,
    certificatePEM: await CertificateSystem.selfSigned(metadata, keyPair),
    ...(out.formerKeys?.length ? { formerKeys: out.formerKeys } : {})
  };

  // Nothing on trust: every row by a key the hub names, each on the one under it; the save by one of them, and this character's
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].certUid !== uid || rows[i].payload.seq !== i + 1 || !(await CertificateSystem.verifyPayload(rows[i], certificate))) return no(`Row ${i + 1} of what the hub handed over is not this character's.`);
  }
  const broken = chainProblem(rows);
  if (broken) return no(`What the hub handed over does not hold together at row ${broken.seq}: ${broken.why}`);
  const save = out.save?.doc as ISignedPayload<IPlayer> | undefined;
  if (rows.length > 0 && !save) return no('The hub holds this character\'s record, and no save of it.');
  if (save && (save.certUid !== uid || save.payload?.id !== uid || !(await CertificateSystem.verifyPayload(save, certificate)))) return no('The save the hub handed over is not signed by this character.');

  // Proved: the key, the certificate, the save and the rows are written here
  await CertificateSystem.storePrivateKey(uid, keyPair.privateKey);
  AvatarRoster.remember(certificate, save?.payload?.archetype || AvatarRoster.archetypeOf(uid) || 'OPERATOR');
  AvatarRoster.setActive(certificate);
  const unit = new StoreUnit();
  if (save) {
    await VectorStore.put({
      id: uid, namespace: VectorNamespace.CHARACTERS, data: save,
      metadata: { createdAt, updatedAt: Date.now(), ownerCertUid: uid, signature: save.signature, version: 1 }
    }, false, { unit });
  }
  for (const row of rows.slice(here.length)) {
    await VectorStore.put({
      id: `ledger_${uid}_${row.payload.seq.toString().padStart(8, '0')}`, namespace: VectorNamespace.TRANSACTIONS, data: row,
      metadata: { createdAt: row.payload.ts, updatedAt: row.payload.ts, ownerCertUid: uid, signature: row.signature, version: 1 }
    }, false, { unit });
  }
  const committed = await unit.commit();
  if (!committed.ok) return no(`It was taken from the hub and could not be written here: ${committed.reason}. Ask again.`);
  if (out.mint) HubLink.keepMint(uid, out.mint, out.issued);
  return { ok: true, displayName: metadata.displayName, rows: rows.length };
}
