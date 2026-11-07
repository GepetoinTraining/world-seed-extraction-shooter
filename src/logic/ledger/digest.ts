/**
 * SHA-256 through the platform's own crypto, as hex. It answers on a later turn of the event loop;
 * `sha256Hex` in sha256.ts gives the same digits at once. It lives apart from the session journal,
 * which needs this machine's identity and store, so code that only hashes need not reach them.
 */
export async function sha256Hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
