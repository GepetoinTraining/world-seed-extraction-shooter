/**
 * The exact text a character's key signs. The browser signs it and checks its own chain with it, and
 * a hub checks a receipt with it (server/hub), so both sides build it in one place and cannot drift.
 */
export const signedText = (payload: unknown, timestamp: number): string => JSON.stringify({ payload, timestamp });
