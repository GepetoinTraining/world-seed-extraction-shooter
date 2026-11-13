/**
 * What the host runs for every address under /api/hub (vercel.json). The hub itself is
 * `server/hub/entry.ts`, built into one file before the host looks here (`npm run build:hub`):
 * the host runs plain Node, and plain Node finds an import only when its address is written whole.
 * This is the only source file under api/, so the host makes one function.
 */
import server from '../dist-hub/hub.mjs';

export default server;
