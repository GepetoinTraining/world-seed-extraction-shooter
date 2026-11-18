/**
 * A CHARACTER AND ITS ACCOUNT (HUB_WIRING.md, sections 1 to 4). Pedro, 2026-11-12: "we need the minting
 * of a new player to be done from the hub we're going to launch with the server, every new player
 * get's their account registered there, even if they never log on to the hub", receipts going up by
 * themselves ("agreed"), and, 2026-11-18: "the account takes precedence, so when someone logs in
 * again we need to serve them the data we have".
 *
 * Played from the domain, the hub is the page's own origin and the account comes first:
 *   - nobody makes or plays a character with nobody signed in;
 *   - a character is registered under the account as it is made, and the hub's word for it (its
 *     `mint`) is kept beside the certificate and named in the character's first ledger row;
 *   - a character this browser holds and the hub does not is registered when it is next played;
 *   - what the account holds on the hub is read, so the select screen can say which of its
 *     characters are on this device and which are not;
 *   - receipts go up by themselves: on a slow beat, when the page is hidden, and when asked, and
 *     the character itself goes with them (its signed player doc), so the hub's save is of the head
 *     it holds and the account can bring the character to another browser (BringCharacter.ts);
 *   - a character the account took to another browser is not played here until it is brought back:
 *     the hub says which key is the character's now, and this browser's is another.
 *
 * Anywhere else (development, a runner on this machine) nothing here is required: `required` is
 * false, binding is tried quietly, and a game with no hub plays on as it did.
 *
 * Every answer is an outcome, never a thrown error.
 */
import type { IPlayerCertificate } from '../../entities/identity/certificateSystem';
import { HubClient, type IHubCharacter, type IHubOutcome, type IHubStatement, type IHubWhere } from './HubClient';
import { sha256Hex } from '../../../shared/logic/ledger/sha256';

export type BindState =
  /** The hub holds this character under the signed-in account. */
  | 'BOUND'
  /** A hub is there and nobody is signed in to it. */
  | 'SIGNED_OUT'
  /** The account took this character to another browser: the hub's key for it is not this browser's. */
  | 'ELSEWHERE'
  /** No hub is set for this game, or it cannot be reached. */
  | 'NO_HUB'
  /** The hub holds this character under another account. */
  | 'ANOTHERS'
  /** The hub answered, and did not register it. */
  | 'REFUSED';

export interface IBound { state: BindState; mint?: string; reason?: string }

const MINT_KEY = 'ws_hub_mints';
/** Receipts not asked for by anything go up this often. The hub does not need them sooner (HUB_WIRING.md). */
export const RECEIPTS_EVERY_MS = 3 * 60_000;

interface IKept { mint: string; issued?: IHubStatement; hub?: string }

const readMints = (): Record<string, IKept> => {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(MINT_KEY) : null;
    const kept = raw ? JSON.parse(raw) : {};
    return kept && typeof kept === 'object' && !Array.isArray(kept) ? kept : {};
  } catch {
    return {};
  }
};

const keep = (uid: string, kept: IKept) => {
  try { localStorage.setItem(MINT_KEY, JSON.stringify({ ...readMints(), [uid]: kept })); } catch { /* a private window keeps nothing: the hub holds it, and it is read again */ }
};

/** Played from the domain (`npm run build:site`): the game is the hub's own page. */
const onTheDomain = (): boolean => {
  try { return (import.meta as { env?: Record<string, unknown> }).env?.VITE_WS_STORE === 'browser'; } catch { return false; }
};

let force: boolean | null = null;
let sending: Promise<IHubOutcome> | null = null;
let again = false;
let watch: { uid: string; stop: () => void } | null = null;
type Readers = { readGold?: () => number; city?: () => string | null | undefined; save?: () => Promise<unknown | null> };
/** What `soon` sends with: the readers `start` was last given. */
let readers: Readers = {};
const challenged = new Set<(said: string) => void>();
const moved = new Set<(said: string) => void>();

export const HubLink = {
  /** Whether the account comes first here: only where the game is the hub's own page. A test may say so outright. */
  required: (): boolean => force ?? onTheDomain(),
  /** For tests, and nothing else: say whether the account is required, or `null` to read it from the build again. */
  setRequired(on: boolean | null) { force = on; },

  where: (): Promise<IHubWhere> => HubClient.where(),

  /** The hash the hub names a key by: the same text its birth statement hashes. */
  keyHashOf: (certificate: IPlayerCertificate): string => sha256Hex(`${certificate.publicKeyJWK.n}.${certificate.publicKeyJWK.e}`),

  /** Whether the hub's key for a character is another than this browser's: the account took it elsewhere. */
  isElsewhere: (certificate: IPlayerCertificate, held: IHubCharacter | undefined): boolean => !!held?.key && held.key !== HubLink.keyHashOf(certificate),

  /** The hub's word for a character, kept beside its certificate: at its birth here, or when it is brought here. */
  keepMint(uid: string, mint: string, issued?: IHubStatement) { keep(uid, { mint, ...(issued ? { issued } : {}) }); },

  /** The hub's word for a character, as this browser kept it when the hub gave it. */
  mintOf: (uid: string): string | null => readMints()[uid]?.mint ?? null,
  issuedOf: (uid: string): IHubStatement | null => readMints()[uid]?.issued ?? null,

  /** What the signed-in account holds on the hub. Empty when nobody is signed in or the hub cannot be reached. */
  async held(): Promise<IHubCharacter[]> {
    const out = await HubClient.characters();
    return out.ok && Array.isArray(out.characters) ? out.characters : [];
  },

  /**
   * Registers this character under the signed-in account, or finds that it already is. Asking again
   * for a character the account holds answers the same statement, so this is safe at every start.
   */
  async bind(certificate: IPlayerCertificate): Promise<IBound> {
    const uid = certificate.metadata.uid;
    const where = await HubClient.where();
    if (!where.configured) return { state: 'NO_HUB', reason: where.reason ?? 'No hub is set for this game.' };
    if (!where.signedIn) return { state: 'SIGNED_OUT', reason: 'Nobody is signed in to this hub. Sign in on the site\'s first page.' };
    const out = await HubClient.register(certificate) as IHubOutcome & { issued?: IHubStatement; mint?: string };
    if (out.ok && typeof out.mint === 'string') {
      keep(uid, { mint: out.mint, ...(out.issued ? { issued: out.issued } : {}), ...(where.url ? { hub: where.url } : {}) });
      // The hub holds it under this account. Whether this browser's key is still the character's is the hub's to say
      const record = await HubClient.record(uid);
      if (record.ok && typeof record.key === 'string' && record.key !== HubLink.keyHashOf(certificate)) {
        return { state: 'ELSEWHERE', mint: out.mint, reason: 'This character plays in another browser now: your account took it there. Bring it here to play it here.' };
      }
      return { state: 'BOUND', mint: out.mint };
    }
    if (out.status === 409 && /another account/i.test(out.reason ?? '')) {
      return { state: 'ANOTHERS', reason: 'This character belongs to another account on this hub. Sign in to that account to play it.' };
    }
    if (out.status === 401) return { state: 'SIGNED_OUT', reason: 'Nobody is signed in to this hub. Sign in on the site\'s first page.' };
    return { state: 'REFUSED', reason: out.reason ?? 'The hub did not register this character.' };
  },

  /** Told when the hub's rerun of a character does not land where the character's own did: the one thing a player must hear. */
  onChallenge(fn: (said: string) => void): () => void {
    challenged.add(fn);
    return () => { challenged.delete(fn); };
  },

  /** Told when the hub says the character plays in another browser now: what this one adds is no longer held. */
  onMoved(fn: (said: string) => void): () => void {
    moved.add(fn);
    return () => { moved.delete(fn); };
  },

  /**
   * This character's receipts, the character itself with them (`save`), and its city's people after,
   * sent now. One send at a time: a second asked for while one runs waits and goes once after it, so
   * two never race the hub.
   */
  send(uid: string, readGold?: () => number, city?: () => string | null | undefined, save?: () => Promise<unknown | null>): Promise<IHubOutcome> {
    if (sending) { again = true; return sending; }
    const run = async (): Promise<IHubOutcome> => {
      const out = await HubClient.sendReceipts(uid, readGold, save);
      if (out.moved) {
        const said = out.reason ?? 'This character plays in another browser now.';
        for (const fn of moved) fn(said);
        return out;
      }
      if (out.standing === 'CHALLENGED' || out.challenge) {
        const said = out.reason ?? 'This hub holds a different history of this character. Its standing here is challenged.';
        for (const fn of challenged) fn(said);
      }
      const home = out.ok ? city?.() : null;
      if (home) await HubClient.sendPeople(home).catch(() => undefined);
      return out;
    };
    sending = run().catch((): IHubOutcome => ({ ok: false, reason: 'The receipts could not be sent.' })).finally(() => {
      sending = null;
      if (again) { again = false; void HubLink.send(uid, readGold, city, save); }
    });
    return sending;
  },

  /** Everything the character in play has, sent now, with the readers it was started with: what a player asks for before changing where they play. */
  sendNow(): Promise<IHubOutcome> {
    const w = watch;
    if (!w) return Promise.resolve({ ok: false, reason: 'No character is being played.' });
    return HubLink.send(w.uid, readers.readGold, readers.city, readers.save);
  },

  /**
   * Receipts by themselves for the character in play: once now, on a slow beat, and when the page is
   * hidden. Quiet when nobody is signed in or the hub does not hold the character. Returns how to stop.
   */
  start(uid: string, readGold?: () => number, city?: () => string | null | undefined, everyMs = RECEIPTS_EVERY_MS, save?: () => Promise<unknown | null>): () => void {
    watch?.stop();
    readers = { readGold, city, save };
    let stopped = false;
    const go = async () => {
      if (stopped) return;
      const where = await HubClient.where();
      if (!where.configured || !where.signedIn) return;
      await HubLink.send(uid, readGold, city, save);
    };
    const timer = setInterval(() => void go(), everyMs);
    (timer as { unref?: () => void }).unref?.();
    const hidden = () => { if (typeof document !== 'undefined' && document.visibilityState === 'hidden') void go(); };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', hidden);
    const stop = () => {
      stopped = true;
      clearInterval(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', hidden);
      if (watch?.stop === stop) watch = null;
    };
    watch = { uid, stop };
    void go();
    return stop;
  },

  /** Something just ended that the hub can rerun (a dive, a rest): the receipts go now, if a character is being watched. */
  soon() {
    const w = watch;
    if (!w) return;
    void (async () => {
      const where = await HubClient.where();
      if (where.configured && where.signedIn) await HubLink.send(w.uid, readers.readGold, readers.city, readers.save);
    })();
  },

  stop() { watch?.stop(); }
};
