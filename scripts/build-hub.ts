/**
 * The hub's function as ONE file (DEPLOY.md). A function host compiles each source file alone and
 * runs the result as plain Node. Plain Node finds an import only when its address is written whole,
 * and nothing under `server/` or `shared/` writes one that way, so the first deployment died as it
 * loaded (`Cannot find module '/var/task/server/hub/app'`). Built into one file, nothing of ours is
 * left to find; what comes from a package stays an import, and the host brings the package.
 *
 * It is built to `dist-hub/`, one folder under the root, on purpose: the store finds its migrations
 * from where its own file is (`server/connection.ts`, `server/coldStore.ts`: one folder under the
 * root, then `drizzle/`), and once built, where its own file is, is here.
 *
 *   npm run build:hub      then dist-hub/hub.mjs is what api/hub.js hands the host
 */
import { build } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(import.meta.dirname, '..');

export async function buildHub(): Promise<string> {
  const out = resolve(root, 'dist-hub');
  await build({
    // The game's own configuration is for a browser; none of it belongs in a function
    configFile: false,
    root,
    logLevel: 'warn',
    publicDir: false,
    build: {
      ssr: resolve(root, 'server', 'hub', 'entry.ts'),
      outDir: out,
      emptyOutDir: true,
      target: 'node20',
      minify: false,
      rollupOptions: { output: { format: 'es', entryFileNames: 'hub.mjs', inlineDynamicImports: true } }
    }
  });
  return resolve(out, 'hub.mjs');
}

// Run as a script, and silent when another script takes the function from here
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`[HUB] Built: ${await buildHub()} (the hub's function, as one file)`);
}
