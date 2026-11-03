/**
 * THE CITY'S WEEK (leg 1): seams found by playing a city through its week, each held here.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { HubGenerator } from '../src/entities/hub/HubGenerator';

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
