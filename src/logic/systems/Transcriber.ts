/**
 * SPEECH TO TEXT, BEHIND ONE SEAM (UXC, part 3). Pedro wants a note spoken: "button + voice" send to "whisper or haiku".
 * Claude models take text and images, not sound (the models overview page, read 2026-11-12), so a transcriber stands
 * before the quick model, and which one is Pedro's call, asked and not yet answered: a Whisper model run in the browser
 * (a package and a model download, neither of which this branch may add) or the browser's own recognizer.
 *
 * So the game asks one interface for text and never knows what stands behind it (`Transcribers.current()`). Built behind
 * it: the browser's own recognizer where the browser has one; where it has none, it says in words that this browser
 * cannot hear yet. A check or a bar sets one that returns fixed text (`FixedTranscriber`): no microphone is ever opened
 * in a hidden window. A Whisper transcriber, if Pedro picks it, is one more class here and one `Transcribers.use`.
 *
 * Note for that call: in Chrome the browser's own recognizer sends the sound to the browser maker's speech service; that
 * is the browser's doing, not a call of ours, and the ledger's UXC rows say so for that call.
 */

export type Heard = { ok: true; text: string } | { ok: false; reason: string };

export interface ITranscriber {
  /** Whether it can hear here; when not, why, in words a player reads on the button. */
  ready(): { ok: true } | { ok: false; reason: string };
  /** Listen once and give back what was said, as text, or why nothing was. */
  listen(signal?: AbortSignal): Promise<Heard>;
}

/** The longest one listening holds the microphone open, the coordinator's call: a guess is a breath or two. */
export const LISTEN_MS = 15_000;

export const CANNOT_HEAR = 'This browser cannot hear yet.';

/** What the browser's recognizer said went wrong, in a player's words. */
const REFUSALS: Record<string, string> = {
  'not-allowed': 'The microphone was not allowed. Allow it for this page to speak a note.',
  'service-not-allowed': 'The microphone was not allowed. Allow it for this page to speak a note.',
  'no-speech': 'Nothing was heard.',
  'audio-capture': 'No microphone was found.',
  network: 'The browser\'s recognizer could not be reached.',
  aborted: 'Listening was stopped.'
};

type RecognizerClass = new () => {
  lang: string; interimResults?: boolean; maxAlternatives?: number; continuous?: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};

const recognizerClass = (): RecognizerClass | undefined => {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognizerClass; webkitSpeechRecognition?: RecognizerClass };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

/** The browser's own recognizer, in the language the browser is set to, once, until the player stops speaking. */
export class BrowserTranscriber implements ITranscriber {
  ready(): { ok: true } | { ok: false; reason: string } {
    return recognizerClass() ? { ok: true } : { ok: false, reason: CANNOT_HEAR };
  }

  listen(signal?: AbortSignal): Promise<Heard> {
    const Recognizer = recognizerClass();
    if (!Recognizer) return Promise.resolve({ ok: false, reason: CANNOT_HEAR });
    return new Promise<Heard>(resolve => {
      const rec = new Recognizer();
      rec.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.continuous = false;
      let text = '';
      let refused: string | null = null;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(text.trim() ? { ok: true, text: text.trim() } : { ok: false, reason: refused ?? REFUSALS['no-speech'] });
      };
      rec.onresult = e => {
        for (let i = 0; i < e.results.length; i++) text += `${text ? ' ' : ''}${e.results[i][0]?.transcript ?? ''}`;
      };
      rec.onerror = e => { refused = REFUSALS[e.error] ?? `The browser could not hear: ${e.error}.`; };
      rec.onend = finish;
      const timer = setTimeout(() => { try { rec.stop(); } catch { finish(); } }, LISTEN_MS);
      signal?.addEventListener('abort', () => { refused = REFUSALS.aborted; try { rec.abort(); } catch { finish(); } });
      try {
        rec.start();
      } catch (e) {
        refused = `The browser could not hear: ${(e as Error).message}.`;
        finish();
      }
    });
  }
}

/** For bars and checks: hears the same words every time, and opens nothing. */
export class FixedTranscriber implements ITranscriber {
  constructor(private readonly text: string) {}
  ready(): { ok: true } { return { ok: true }; }
  async listen(): Promise<Heard> { return { ok: true, text: this.text }; }
}

let current: ITranscriber = new BrowserTranscriber();

/** The one seam: the game asks whichever transcriber stands, and Pedro's call sets which. */
export const Transcribers = {
  current: (): ITranscriber => current,
  use(transcriber: ITranscriber): void { current = transcriber; }
};
