/**
 * The site as a domain serves it (DEPLOY.md): the landing page at /, and the game at /play/,
 * built to keep its save in the browser. The hub's function is built beside it as one file
 * (build-hub.ts), which api/hub.js hands the host.
 *
 *   npm run build:site      then dist-site/ is the whole static site
 */
import { build } from 'vite';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { unixScript, windowsScript } from '../src/logic/intelligence/LocalSetup';
import doorOptions from '../shared/intelligence/door-options.json';
import { resolve } from 'node:path';
import { buildHub } from './build-hub';
import { clerkHostOf, writePolicies } from '../server/hub/pagePolicy';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'dist-site');

process.env.VITE_WS_STORE = 'browser';
// The game's own origin is configuration (the domain is not chosen); a player's Ollama is told to answer it alone
const origin = (process.env.WS_PUBLIC_URL ?? 'http://127.0.0.1:3950').replace(/\/+$/, '');
process.env.VITE_WS_ORIGIN = origin;
rmSync(out, { recursive: true, force: true });
await build({ root, base: '/play/', build: { outDir: resolve(out, 'play'), emptyOutDir: true } });
cpSync(resolve(root, 'landing'), out, { recursive: true });
// Each landing page carries its content policy as a meta tag, written from the same function the stand-in sends it
// with; it names Clerk's own address, which the publishable key carries (vercel.json gives every address the rest)
const policies = writePolicies(out, clerkHostOf(process.env));
// The plain scripts, served from the game's own origin, for a player with no agent: read them, then run them
const model = doorOptions.local?.suggestions?.at(-1)?.model ?? 'gemma4:e2b-it-qat';
mkdirSync(resolve(out, 'setup'), { recursive: true });
writeFileSync(resolve(out, 'setup', 'world-seed-local-model.ps1'), windowsScript({ origin, model }));
writeFileSync(resolve(out, 'setup', 'world-seed-local-model.sh'), unixScript({ origin, model }));
// The function the host runs for /api/hub, wherever in its own order the host comes to build it
const hub = await buildHub();
console.log(`[SITE] Built: ${hub} (the hub's function, as one file)`);
console.log(`[SITE] Built: ${out} (the landing page at /, the game at /play/, the scripts at /setup/), for ${origin}`);
console.log(`[SITE] A content policy written into ${policies.length} page${policies.length === 1 ? '' : 's'} (${policies.join(', ')}), ${clerkHostOf(process.env) ? 'with Clerk\'s address' : 'with no Clerk key'}`);
