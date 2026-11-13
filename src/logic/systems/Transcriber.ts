/**
 * SPEECH TO TEXT, BEHIND ONE SEAM (UXC, part 3). Pedro wants a note spoken: "button + voice" send to "whisper or haiku".
 * Claude models take text and images, not sound (the models overview page, read 2026-11-12), so a transcriber stands
 * before the quick model. Which one was his call, and he answered it: asked "Which turns the spoken note into text?",
 * he said "Browser's own". So the browser's own recognizer (`SpeechRecognition`, `webkitSpeechRecognition`) is THE
 * transcriber, not a stand-in: no Whisper, no package, no model download.
 *
 * The game still asks one interface for text (`Transcribers.current()`), so a check or a bar sets one that returns fixed
 * text (`FixedTranscriber`) and no microphone is ever opened in a hidden window.
 *
 * Every way the browser's recognizer can fail is its own plain sentence, said on the card, and the note is simply not
 * made: no recognizer in this browser; the microphone refused; a recognizer whose speech service does not answer (a
 * Chromium build without its maker's keys reports a network or service error, and Pedro's own play window is a
 * Chromium app window, so he may meet that one first); and the rest the browser reports. It listens in the browser's
 * own language (ledger UXC29). In Chrome the sound is sent to the browser maker's speech service to be recognized: the
 * browser's doing, never our door's, written down for the site's words about players' data (UXC30).
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
/** How long a recognizer told to stop may take to end before its silence is read as a service that does not answer. */
const STOP_GRACE_MS = 3_000;

export const CANNOT_HEAR = 'This browser cannot hear yet.';
export const NO_ANSWER = 'This browser\'s speech service did not answer, so nothing was heard.';

/**
 * What the browser's recognizer reports, each in its own sentence a player reads on the card. `network` is what a
 * Chromium build without its maker's speech service says; `service-not-allowed` is the browser or its settings
 * refusing this page the service, which is not the player refusing the microphone (`not-allowed`).
 */
const REFUSALS: Record<string, string> = {
  'not-allowed': 'The microphone was refused. Allow it for this page to speak a note.',
  'service-not-allowed': 'This browser does not let this page use its speech service.',
  network: 'This browser\'s speech service could not be reached. A browser built without its maker\'s speech service cannot turn speech into text.',
  'audio-capture': 'No microphone was found.',
  'no-speech': 'Nothing was heard.',
  'language-not-supported': 'This browser\'s speech service does not take the language the browser is set to.',
  aborted: 'Listening was stopped before anything was heard.'
};
const refusalOf = (code: string): string => REFUSALS[code] ?? `The browser could not hear, and said only "${code}".`;

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

/** The language a note is heard in: the browser's own (ledger UXC29, the coordinator's call), and English where it says none. */
export const listenLanguage = (): string => (typeof navigator !== 'undefined' && navigator.language) || 'en-US';

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
      rec.lang = listenLanguage();
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.continuous = false;
      let text = '';
      let refused: string | null = null;
      let done = false;
      const timers: ReturnType<typeof setTimeout>[] = [];
      const finish = () => {
        if (done) return;
        done = true;
        timers.forEach(clearTimeout);
        resolve(text.trim() ? { ok: true, text: text.trim() } : { ok: false, reason: refused ?? REFUSALS['no-speech'] });
      };
      rec.onresult = e => {
        for (let i = 0; i < e.results.length; i++) text += `${text ? ' ' : ''}${e.results[i][0]?.transcript ?? ''}`;
      };
      rec.onerror = e => { refused = refusalOf(e.error); };
      rec.onend = finish;
      // Listening ends at its time; a recognizer that does not end when told is a service that did not answer
      timers.push(setTimeout(() => {
        try { rec.stop(); } catch { /* ended already */ }
        timers.push(setTimeout(() => { refused = refused ?? NO_ANSWER; finish(); }, STOP_GRACE_MS));
      }, LISTEN_MS));
      signal?.addEventListener('abort', () => { refused = REFUSALS.aborted; try { rec.abort(); } catch { finish(); } });
      try {
        rec.start();
      } catch (e) {
        refused = `The browser could not start listening: ${(e as Error).message}.`;
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
