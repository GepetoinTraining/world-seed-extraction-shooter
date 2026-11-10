/**
 * THE RUNNER, started by whoever holds it (DEPLOY.md). One listener on the person's own machine: the built
 * game, the database door, the door to their model, the bridge to a hub and the clock.
 *
 * `server/main.ts` starts it from the environment and stops it on a signal. `scripts/pedro.ts --built` starts
 * it in its own process and stops it when the game's window closes: on Windows no signal reaches another
 * process's handlers, so a runner that must stop cleanly for someone else has to be closed by a call.
 */
import { createServer } from 'node:http';
import { join } from 'node:path';
import { createDbHandler, lazyStore } from './http';
import { openLiveStore } from './record';
import { carryOldSave } from './carryDoor';
import { createIntelligenceHandler, openDoor } from './intelligence';
import { createHubBridge, createRunnerListener, hubUrlProblem } from './runner';
import { createClockDoor } from './clock';

export interface IStandaloneOptions {
  /** The checkout: the built game is its `dist`. */
  root: string;
  /** The database: pglite://<folder> or postgres://… */
  url: string;
  port: number;
  host: string;
  /** What the record, the hub and the doors read. The process's own by default. */
  env?: NodeJS.ProcessEnv;
}

export interface IStandalone {
  /** A clean close: it writes down and leaves nothing to replay. A kill loses nothing either: the next open replays, and the marks are still there. */
  close(): Promise<void>;
}

/** Resolves once the address answers. A port already taken is a rejection, before any database is opened. */
export function startStandalone(options: IStandaloneOptions): Promise<IStandalone> {
  const { root, url, port, host } = options;
  const env = options.env ?? process.env;

  const store = lazyStore(() => openLiveStore(url, env));
  const intelligence = createIntelligenceHandler(openDoor(env));
  const handle = createDbHandler(store.get, { allowRemote: env.WS_DB_ALLOW_REMOTE === '1', carry: carryOldSave });

  const hubUrl = env.WS_HUB_URL?.trim() || undefined;
  const server = createServer(createRunnerListener({
    clock: createClockDoor({ hubUrl }),
    db: handle,
    intelligence,
    hub: createHubBridge({ hubUrl }),
    dist: join(root, 'dist'),
    noStatic: env.WS_NO_STATIC === '1'
  }));

  return new Promise<IStandalone>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      console.log(`[DB] World Seed's database answers on http://${host}:${port}/api/db (${url.split(':')[0]})`);
      console.log(`[RUNNER] The game is at http://${host}:${port}/`);
      console.log(hubUrl ? (hubUrlProblem(hubUrl) ?? `[RUNNER] Its hub is ${hubUrl}`) : '[RUNNER] No hub is set (WS_HUB_URL): this game plays here alone.');
      void store.get().catch(e => console.error(`[DB] The database did not open: ${e?.message ?? e}`));
      resolve({
        close: async () => {
          try {
            await store.close();
          } finally {
            server.close();
            server.closeAllConnections();
          }
        }
      });
    });
  });
}
