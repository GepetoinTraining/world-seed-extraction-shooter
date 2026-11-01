/**
 * Themes in the database: signed into CONTENT like every pack, read back and judged
 * again at the door. The base sync carries them between databases as definitions,
 * so what one hub wrote another can walk (D33, D55).
 */

import { VectorNamespace, VectorStore } from '../../entities/data/VectorStore';
import { ContentRegistry } from './ContentRegistry';
import { IThemePack } from './ThemeTypes';
import { THEME_CONTENT_TYPE } from './boot';

export class ThemeStore {

  /** Bank a theme: judged, installed, saved. Refused whole if the law says no. */
  static async bank(pack: IThemePack): Promise<{ ok: boolean; reason?: string }> {
    const verdict = ContentRegistry.install(pack);
    if (!verdict.ok) return verdict;
    await VectorStore.saveContent(pack.themeId, THEME_CONTENT_TYPE, pack, `${pack.name} ${pack.premise}`);
    return { ok: true };
  }

  /** Oldest first, then by id, so every machine installs them in the same order. */
  static async loadBanked(): Promise<number> {
    const docs = await VectorStore.query<{ content: IThemePack }>({
      namespace: VectorNamespace.CONTENT,
      filter: { 'data.type': THEME_CONTENT_TYPE }
    });
    const packs = docs.map(d => d.data.content)
      .sort((a, b) => a.writtenAt - b.writtenAt || (a.themeId < b.themeId ? -1 : 1));
    let count = 0;
    for (const pack of packs) {
      const verdict = ContentRegistry.install(pack);
      if (verdict.ok) count++;
      else console.warn(`[THEME] ${pack.name} refused at the door: ${verdict.reason}`);
    }
    return count;
  }
}
