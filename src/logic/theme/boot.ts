/**
 * Before anything else reads a definition, the shipped theme is installed. A theme
 * minted later arrives from the database and joins it (`loadBankedThemes`).
 */

import { ContentRegistry } from './ContentRegistry';
import { sealTheme } from './ThemeCompiler';
import { IThemePack } from './ThemeTypes';
import { FIRST_THEME } from '../../entities/generation/packs/firstTheme';

/** The dev-time run that wrote it, on the record (D20). A fixed moment, so its bytes never move. */
const FIRST_THEME_RAN_AT = 1793491200000; // 2026-11-01

export const FIRST_THEME_PACK: IThemePack = sealTheme(FIRST_THEME, 'claude-opus-5-5 (dev batch, D53)', FIRST_THEME_RAN_AT);

export function installShippedThemes(): void {
  const verdict = ContentRegistry.install(FIRST_THEME_PACK);
  if (!verdict.ok) throw new Error(`The shipped theme breaks its own law: ${verdict.reason}`);
}

/** The namespace key a theme is banked under. */
export const THEME_CONTENT_TYPE = 'THEME_PACK';
