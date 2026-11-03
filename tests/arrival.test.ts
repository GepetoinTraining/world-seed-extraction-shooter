/**
 * LEG 1, ARRIVAL: seams a new person meets on the first day, each held by a bar
 * that went red before its fix.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../src/entities/data/VectorStore', () => ({
  VectorNamespace: { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories' },
  VectorStore: {
    get: async () => null,
    put: async () => true,
    query: async () => [],
    saveContent: async () => true,
    searchContent: async () => []
  }
}));

import { HubGenerator, IHubLayout, POIType } from '../src/entities/hub/HubGenerator';
import { dismemberPlan, firstPlan } from '../src/entities/hub/hubManifest';

const SRC = (path: string) => readFileSync(path, 'utf8');
const lotPois = (l: IHubLayout) => l.zones.flatMap(z => z.pois).filter(p => p.type === POIType.PLAYER_LOT);

// -----------------------------------------------------------------------------
// N9: a lot is called what its sign says, on every screen
// -----------------------------------------------------------------------------

describe('a lot reads the same on the street and on every screen (N9)', () => {
  const first = HubGenerator.generate();
  const bigLot = lotPois(first).find(p => p.size.width >= 8 && p.size.height >= 8)!;
  const split = HubGenerator.generate(dismemberPlan(firstPlan(), bigLot.id));

  it('names every lot as its sign does, the pieces of a split one included', () => {
    for (const layout of [first, split]) {
      for (const poi of lotPois(layout)) expect(HubGenerator.lotName(layout, poi.id)).toBe(poi.name);
    }
    expect(lotPois(split).some(p => p.metadata.dismemberedFrom === bigLot.id)).toBe(true);
  });

  it('builds no lot label from its index or its id, which count from zero where the sign counts from one', () => {
    const screens = [
      'src/components/HoldingsPanel.tsx',
      'src/components/TemplateApplyModal.tsx',
      'src/entities/hub/HubCanvas.tsx'
    ];
    for (const file of screens) {
      const text = SRC(file);
      expect(text, file).not.toMatch(/LOT \$?\{[^}]*lotIndex\}/i);
      expect(text, file).not.toMatch(/Lot \$\{[^}]*lotIndex\}/);
      expect(text, file).not.toMatch(/replace\('poi_lot_'/);
    }
  });
});

// -----------------------------------------------------------------------------
// N11: the Agent tab says where mental stats come from, truly
// -----------------------------------------------------------------------------

describe('the Agent tab tells the truth about mental stats (N11)', () => {
  it('does not say frames are their only source, since a new sheet is dealt them', () => {
    const text = SRC('src/components/PlayerHub.tsx');
    expect(text).not.toMatch(/come only from frames/);
    expect(text).toMatch(/Gear never adds to the mental stats/);
  });
});
