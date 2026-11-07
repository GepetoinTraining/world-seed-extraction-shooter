/**
 * WHAT BOTH RUNTIMES SUPPLY. The shared store is checked against the language alone (lib ES2022):
 * no page and no Node. These are the few globals that a browser and Node both give, written down
 * only as far as the store uses them. Anything else a file reaches for (the page's storage, the
 * window, the disk, the process) does not compile here, and that is the check. A new use of a
 * global both runtimes have is added here, by name, with what it is used for.
 */

/** Messages for whoever is watching: the page's console or the server's log. */
declare var console: {
  log(...data: unknown[]): void;
  info(...data: unknown[]): void;
  warn(...data: unknown[]): void;
  error(...data: unknown[]): void;
  debug(...data: unknown[]): void;
};

/** A wait before trying again. What it returns differs by runtime, so it is not read. */
declare function setTimeout(handler: (...args: any[]) => void, ms?: number): unknown;

/** Text to bytes and back, as UTF-8. */
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
  decode(input?: ArrayBufferView | ArrayBuffer, options?: { stream?: boolean }): string;
}

/** The platform's crypto: a digest and a fresh id. */
declare var crypto: {
  subtle: { digest(algorithm: string, data: ArrayBufferView | ArrayBuffer): Promise<ArrayBuffer> };
  randomUUID(): string;
};

/** A request's way to be called off. Only passed along, never read. */
interface AbortSignal {
  readonly aborted: boolean;
}

/** A request over the network, to a model or to the store's server. */
interface RequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  cache?: 'default' | 'no-store' | 'reload' | 'no-cache' | 'force-cache' | 'only-if-cached';
  credentials?: 'omit' | 'same-origin' | 'include';
}
interface Response {
  readonly ok: boolean;
  readonly status: number;
  /** A byte stream; the store reads it as an async iterable of chunks. */
  readonly body: object | null;
  json(): Promise<any>;
  text(): Promise<string>;
}
declare function fetch(input: string, init?: RequestInit): Promise<Response>;
