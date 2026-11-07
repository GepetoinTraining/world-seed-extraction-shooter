/**
 * The door's options read from their file on a machine (`door-options.json`, or the file
 * WS_DOOR_OPTIONS names), kept with the shared door. A page imports the same file as data instead (src/logic/intelligence).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDoorOptions, type IDoorOptions } from '../../shared/intelligence/options';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Read at each start. A broken file offers nothing rather than stopping the server. */
export function readDoorOptions(path = process.env.WS_DOOR_OPTIONS?.trim() || resolve(HERE, '../../shared/intelligence/door-options.json')): IDoorOptions {
  try {
    return parseDoorOptions(JSON.parse(readFileSync(path, 'utf8')));
  } catch (e) {
    console.warn(`[DOOR] The door's options could not be read from ${path}: ${(e as Error).message}`);
    return { keyed: [] };
  }
}
