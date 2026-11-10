/**
 * THE CREDITS, AS DATA (Pedro, 2026-11-10: "you'll need to check the full list of models that touched
 * this, and it's large"). `credits.json` is the record; this reads it. The names are in that file and
 * not in code, where a bar still holds that the first model's code is gone (tests/theme.test.ts).
 *
 * A model is named with the version its record gives, and where the record gives none the entry says so
 * (tests/entry.view.test.ts holds both). Adding a model to the game's door without naming it here fails
 * a bar, so the list cannot fall behind what the game speaks through.
 */
import raw from './credits.json';

export interface ICreditEntry {
  /** The model's own id, where the game or a session names one. */
  id?: string;
  name: string;
  maker: string;
  /** Year and month it first appears in the record: what the builders are ordered by. */
  when?: string;
  did: string;
  record: string;
}

export interface ICredits {
  about: string;
  people: { name: string; did: string }[];
  /** Who wrote the game, oldest first. */
  built: ICreditEntry[];
  /** What the game can speak through today. */
  voices: ICreditEntry[];
  /** What it spoke through before. */
  earlier: ICreditEntry[];
}

export const CREDITS = raw as ICredits;
