/**
 * Stands in for `undici-types`, Node's own fetch types. The Anthropic client looks for them and,
 * when they are there, pulls in all of Node's types with them, which would let the store use the
 * disk or the process unnoticed. Without them the client falls back to the plain fetch shapes.
 * The shared project's `paths` points that one name here; nothing exports from this file.
 */
export {};
