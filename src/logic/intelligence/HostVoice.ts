/**
 * THE HUB'S OWN VOICE, SEEN FROM THE PAGE (Pedro, 2026-11-18: "we need the web vercel deploy to be
 * playable"). Played from the domain, the hub beside the page may answer the door's asks itself, on
 * its operator's key, for whoever is signed in (server/hub/voice.ts). This asks the hub whether it
 * does and who is signed in, and remembers the answer for a little while, so an ask does not wait on
 * a second request each time.
 *
 * The page never sees that key, and the hub's session rides in a cookie the page cannot read.
 */

export interface IHostVoiceWord {
  /** The hub answers the door's asks itself. */
  offered: boolean;
  /** Who is signed in to the hub, by handle, or nobody. */
  signedIn: string | null;
}

export interface IHostVoice {
  look(): Promise<IHostVoiceWord>;
  /** What was learned is dropped: the next look asks again (a session that ended, a sign-in since). */
  forget(): void;
}

export interface IHostVoiceOptions {
  /** The hub's route that says where this is and who is signed in. */
  where?: string;
  /** How long an answer is taken for. */
  ttlMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
}

const NOBODY: IHostVoiceWord = { offered: false, signedIn: null };

export function openHostVoice(o: IHostVoiceOptions = {}): IHostVoice {
  const where = o.where ?? '/api/hub/where';
  const ttlMs = o.ttlMs ?? 30_000;
  const ask = o.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const now = o.now ?? Date.now;
  let kept: { at: number; word: Promise<IHostVoiceWord> } | null = null;

  const read = async (): Promise<IHostVoiceWord> => {
    try {
      const res = await ask(where, { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) return NOBODY;
      const said = await res.json() as { voice?: unknown; signedIn?: unknown };
      return { offered: said.voice === true, signedIn: typeof said.signedIn === 'string' && said.signedIn ? said.signedIn : null };
    } catch {
      // A hub that cannot be reached offers nothing right now; the next look asks again
      kept = null;
      return NOBODY;
    }
  };

  return {
    look() {
      if (kept && now() - kept.at < ttlMs) return kept.word;
      kept = { at: now(), word: read() };
      return kept.word;
    },
    forget() { kept = null; }
  };
}
