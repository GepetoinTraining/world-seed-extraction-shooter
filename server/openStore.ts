/**
 * A store on a machine: a folder, a served Postgres, or memory, through Node's opener. Apart from
 * SqlStore.ts so that the browser, which opens its own (src/entities/data/BrowserStore.ts), never
 * bundles this one.
 */
import { openDatabase } from './connection';
import { SqlStore, type IStoreOptions } from './SqlStore';

export async function openStore(url: string, options: IStoreOptions = {}): Promise<SqlStore> {
  return new SqlStore(await openDatabase(url, options), options);
}
