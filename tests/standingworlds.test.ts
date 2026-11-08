/**
 * Worlds over time, as Pedro ruled on leg 1 (Q40, Q41, Q43).
 *
 * A world never retires: a later grid or a theme this hub no longer holds keeps it walkable.
 * Recon names the boss's ward as the ward. AGENTS counts drops into a world, written at deploy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { useWorldStore } from '../src/entities/world/store';
import { WorldCertificateSystem, IWorldCertificate, WorldType, AccessMode } from '../src/entities/world/WorldCertificate';
import { GRID_VERSION } from '../shared/entities/world/grid';
import { ContentRegistry } from '../shared/logic/theme/ContentRegistry';
import { FIRST_THEME_PACK, installShippedThemes } from '../shared/logic/theme/boot';
import { VectorStore } from '../shared/entities/data/VectorStore';

const content = new Map<string, unknown>();
vi.mock('../shared/entities/data/VectorStore', () => ({
  VectorNamespace: { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories' },
  VectorStore: {
    get: async () => null,
    put: async () => true,
    query: async () => [],
    saveContent: async (id: string, _type: string, doc: unknown) => { content.set(id, structuredClone(doc)); return true; },
    searchContent: async () => [...content.values()].map(d => structuredClone(d))
  }
}));

const SRC = (path: string) => readFileSync(path, 'utf8');

const certOf = (uid: string, over: { gridVersion?: number; themeId?: string; visitors?: number } = {}): IWorldCertificate => ({
  data: {
    worldUid: uid, worldName: uid.toUpperCase(), worldDescription: '', worldType: WorldType.EXTRACTION,
    creatorCertUid: 'maker_uid_000', currentOwnerCertUid: 'maker_uid_000', createdAt: 0, seedHash: `seed_${uid}`, size: 2,
    ...('gridVersion' in over ? { gridVersion: over.gridVersion } : { gridVersion: GRID_VERSION }),
    rules: { accessMode: AccessMode.PUBLIC, difficulty: 'E', pvpEnabled: false, extractionTaxRate: 0.05, themeId: 'themeId' in over ? over.themeId : FIRST_THEME_PACK.themeId } as never,
    stats: { totalVisitors: over.visitors ?? 0, totalExtractions: 0, totalGoldGenerated: 0, totalDeaths: 0, averageSessionMinutes: 0, rating: 0, ratingCount: 0 },
    version: 1, lastModified: 0
  },
  creatorSignature: '', ownerSignature: '', certificatePEM: ''
});

describe('a world never retires (Q43)', () => {
  beforeEach(() => { installShippedThemes(); });
  afterEach(() => { vi.restoreAllMocks(); });

  const cardsFor = async (certs: IWorldCertificate[]) => {
    vi.spyOn(WorldCertificateSystem, 'getPublicWorlds').mockResolvedValue(certs);
    await useWorldStore.getState().refreshWorlds();
    return useWorldStore.getState().availableWorlds;
  };

  it('a world on an older grid stays on the list, walkable on this one', async () => {
    const [, old, none] = await cardsFor([certOf('old_grid', { gridVersion: GRID_VERSION - 1 }), certOf('no_grid', { gridVersion: undefined })]);
    for (const card of [old, none]) {
      expect(card, card.id).toBeDefined();
      expect((card as unknown as Record<string, unknown>).retired, card.id).toBeUndefined();
      expect(card.themeId, card.id).toBe(FIRST_THEME_PACK.themeId);
    }
  });

  it('a world whose theme this hub does not hold reads the hub\'s own, and so does one from before themes', async () => {
    const [, gone, before] = await cardsFor([certOf('theme_gone', { themeId: 'theme_nobody_holds' }), certOf('before_themes', { themeId: undefined })]);
    expect(ContentRegistry.get('theme_nobody_holds')).toBeUndefined();
    for (const card of [gone, before]) {
      expect((card as unknown as Record<string, unknown>).retired, card.id).toBeUndefined();
      expect(card.themeId, card.id).toBe(ContentRegistry.defaultThemeId());
      expect(ContentRegistry.get(card.themeId), card.id).toBeDefined();
    }
  });

  it('no door refuses a world for its age: the word is gone from the code', () => {
    const files = [
      'src/entities/world/store.ts', 'src/logic/systems/Deploy.ts', 'src/components/MissionControl.tsx',
      'src/logic/systems/RecordDoor.ts', 'src/logic/systems/RestDoor.ts', 'src/logic/systems/ScanDoor.ts',
      'src/logic/systems/ScanPass.ts', 'src/entities/hub/dialogue.ts'
    ];
    for (const file of files) expect(SRC(file), file).not.toMatch(/\.retired\b|retired\?:|RETIRED/);
    expect(SRC('shared/entities/world/grid.ts')).not.toMatch(/cannot be walked on this one/);
  });
});

describe('AGENTS counts drops, written at deploy (Q41)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('a drop adds one to the world\'s visitors, and nothing else on its record moves', async () => {
    const cert = certOf('drop_count', { visitors: 2 });
    await VectorStore.saveContent(cert.data.worldUid, 'world_certificate', cert, cert.data.worldType);
    await WorldCertificateSystem.recordDrop(cert.data.worldUid);
    const kept = (await VectorStore.searchContent<IWorldCertificate>('world_certificate')).find(w => w.data.worldUid === 'drop_count')!;
    expect(kept.data.stats.totalVisitors).toBe(3);
    expect(kept.data.stats.averageSessionMinutes).toBe(0);
    expect(kept.data.stats.totalExtractions).toBe(0);
  });

  it('the door into a world writes the drop, after the world opened, and the simulation is not counted', () => {
    const deploy = SRC('src/logic/systems/Deploy.ts');
    const opened = deploy.indexOf('world.open(worldId)');
    const counted = deploy.indexOf('recordDrop(');
    expect(counted).toBeGreaterThan(opened);
    expect(deploy.slice(opened, counted + 200)).toMatch(/isDebug/);
  });

  it('a session\'s end no longer counts the visitor a second time', () => {
    const cert = SRC('src/entities/world/WorldCertificate.ts');
    const session = cert.slice(cert.indexOf('static async recordSession'), cert.indexOf('static async rateWorld'));
    expect(session).not.toMatch(/totalVisitors\+\+/);
  });
});

describe('recon names the ward as the ward (Q40)', () => {
  it('the held ground\'s line says the count is the ward\'s anchors', () => {
    const recon = SRC('src/components/ReconView.tsx');
    expect(recon).not.toMatch(/<span>Chunks · anchors<\/span>/);
    expect(recon).toMatch(/anchors in its ward/);
  });
});
