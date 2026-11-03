/**
 * THE CITY'S WEEK (leg 1): seams found by playing a city through its week, each held here.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { HubGenerator } from '../src/entities/hub/HubGenerator';
import * as money from '../src/entities/hub/money';

const source = (path: string) => readFileSync(path, 'utf8');

describe('N9: a lot goes by the name its sign carries, on every screen', () => {
  it('a lot\'s name is its sign\'s, counted from one', () => {
    const layout = HubGenerator.generate();
    const lots = layout.zones.flatMap(z => z.pois).filter(p => p.metadata.lotIndex !== undefined);
    expect(lots.length).toBeGreaterThan(0);
    for (const poi of lots) expect(HubGenerator.lotName(layout, { id: poi.id, lotIndex: poi.metadata.lotIndex })).toBe(poi.name);
  });

  it('found by playing: no screen names a lot by its index, which is one behind the sign', () => {
    for (const path of ['src/components/HoldingsPanel.tsx', 'src/components/TemplateApplyModal.tsx', 'src/entities/hub/HubCanvas.tsx']) {
      expect(source(path), path).not.toMatch(/LOT \$?\{\w+\.lotIndex\}|Lot \$\{\w+\.lotIndex\}/);
    }
  });
});

describe('the Hall\'s books add up to what it says the city runs on', () => {
  const city = (weekCost: number) => ({ layout: HubGenerator.generate(), lots: [{ ownerId: null }], web: { nodes: {} }, items: [], weekCost });

  it('found by playing: the lines a day add up to the day, the shops\' week included', () => {
    for (const weekCost of [0, 6, 7, 9_261, 14_623]) {
      const book = money.runningBook(city(weekCost) as any);
      const lines = (money as any).dayLines(book) as { amount: number }[];
      expect(lines.reduce((sum, line) => sum + line.amount, 0)).toBe(book.perDay);
    }
  });

  it('the Hall lists those lines', () => {
    expect(source('src/components/GuildHall.tsx')).toMatch(/dayLines\(/);
  });
});
