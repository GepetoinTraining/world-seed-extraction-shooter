/**
 * One rule for what an item looks like (Wave 9.4): its real art at its real
 * footprint, from the same numbers that decide its physics. Resources draw
 * from their material properties; gear proposes a profile from its tags.
 * Wave 10B: a template's art is its composed plan — real atoms, never an icon.
 */

import { ICognitiveFrame, IItem, ItemType } from '../../../types';
import { RESOURCE_DEFINITIONS } from '../../entities/item/data/resourceDefinitions';
import { Role, STEPS, Sprite, gearMaterial, hashBytes, itemArt, materialFromProps } from './atoms';
import { templateThumb } from './room';

const encoder = new TextEncoder();

/**
 * Wave 10C (D22): a cognitive frame on the paper-doll. NOT an item and never
 * drawn like one: a hollow diamond — mind holding a position gear would — with
 * the frame's TYPE coded by the structure inside, never by hue (colourblind
 * law): LOGIC carries ruled traces, INSTINCT carries chevrons, SOCIAL carries
 * two facing points. Drawn in the machine's signal ramp: a frame is live signal.
 */
export function frameMark(frame: ICognitiveFrame): Sprite {
  const S = 16;
  const data = new Uint8Array(S * S);
  const set = (x: number, y: number, step: number) => {
    if (x >= 0 && x < S && y >= 0 && y < S) data[y * S + x] = 1 + Role.SIGNAL * STEPS + step;
  };
  const c = S / 2 - 0.5, r = 7;

  // The hollow diamond: |dx| + |dy| == r, two atoms thick
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.abs(x - c) + Math.abs(y - c);
    if (d >= r - 1 && d <= r) set(x, y, 3);
  }

  if (frame.type === 'LOGIC') {
    // Ruled traces: three horizontal lines inside the diamond
    for (const y of [5, 8, 11] as const) {
      for (let x = 0; x < S; x++) {
        if (Math.abs(x - c) + Math.abs(y - c) < r - 2) set(x, y, y === 8 ? 4 : 2);
      }
    }
  } else if (frame.type === 'INSTINCT') {
    // Chevrons: two nested points, teeth downward
    for (const [top, step] of [[4, 4], [8, 2]] as const) {
      for (let i = 0; i < 4; i++) {
        set(Math.floor(c) - i, top + i, step); set(Math.floor(c) + 1 - i, top + i, step);
        set(Math.floor(c) + i, top + i, step); set(Math.floor(c) + 1 + i, top + i, step);
      }
    }
  } else {
    // SOCIAL: two facing points with a bridge
    for (const dx of [-3, 3] as const) {
      set(Math.floor(c) + dx, 7, 4); set(Math.floor(c) + dx + 1, 7, 4);
      set(Math.floor(c) + dx, 8, 4); set(Math.floor(c) + dx + 1, 8, 4);
    }
    for (let x = Math.floor(c) - 1; x <= Math.floor(c) + 2; x++) set(x, 10, 2);
  }

  return { w: S, h: S, data };
}

export function itemArtFor(item: IItem): Sprite {
  // Wave 10B: a building plan shows the plan itself, through the composer.
  const templateData = (item as any).templateData;
  if (item.type === ItemType.TEMPLATE && templateData) {
    return templateThumb(templateData, item.dimensions ?? { width: 2, height: 2 });
  }
  const def = RESOURCE_DEFINITIONS[item.universalDefinitionId] as any;
  const material = def?.materialProps ? materialFromProps(def.materialProps) : gearMaterial(item.tags || []);
  return itemArt({
    wCells: item.dimensions?.width || 1,
    hCells: item.dimensions?.height || 1,
    tags: item.tags || [],
    material,
    rarity: String(item.rarity),
    rank: String(item.rank),
    quality: (item as any).quality,
    durability: item.stats?.durability,
    maxDurability: item.stats?.maxDurability,
    identified: item.isIdentified,
    seed: hashBytes(encoder.encode(item.id))
  });
}
