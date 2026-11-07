/**
 * ROOM PROOF PAGE (Wave 10.1): the composer, exercised on every room type at
 * several sizes, with the NPC preset blueprints, material-built walls and the
 * minimum-size rule — before any of it enters the game. Press Grayscale first.
 */

import '../../tests/fixtures/content/installOnLoad';
import { IItem } from '../../shared/types';
import {
  IRoomState, STATION_MIN_AREA, tagDefaultMaterial,
  canPlaceItem, emptyRoom, fullyWalkable, roomDoor
} from '../../shared/entities/hub/room';
import { ROOM_PRESETS, presetToRoom } from '../../shared/entities/hub/template';
import { CRAFTED_DEFINITIONS } from '../../shared/entities/economy/data/recipeDefinitions';
import { ItemFactory } from '../../shared/entities/item/ItemFactory';
import { Rng } from '../../shared/logic/rng/DeterministicRNG';
import { ATOM_PX, Sprite, buildPalette, grayscale, hashBytes } from '../../shared/render/atoms/atoms';
import { HUB_GENRE, lotArt } from '../../src/render/atoms/hub';
import { composeRoom } from '../../src/render/atoms/room';

const root = document.getElementById('root')!;
const grayButton = document.getElementById('gray')!;
let useGray = false;

const palette = () => (useGray ? grayscale(buildPalette(HUB_GENRE)) : buildPalette(HUB_GENRE));

function toCanvas(s: Sprite, table: Uint8Array, scale = ATOM_PX): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = s.w; c.height = s.h;
  c.style.width = `${s.w * scale}px`; c.style.height = `${s.h * scale}px`;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(s.w, s.h);
  for (let i = 0; i < s.data.length; i++) {
    const v = s.data[i], j = i * 4;
    if (!v) continue;
    img.data[j] = table[v * 3]; img.data[j + 1] = table[v * 3 + 1]; img.data[j + 2] = table[v * 3 + 2]; img.data[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function cell(node: HTMLElement, label: string) {
  const d = document.createElement('div');
  d.className = 'cell';
  const l = document.createElement('div');
  l.className = 'label';
  l.textContent = label;
  d.append(node, l);
  return d;
}

function section(title: string, note?: string) {
  const h = document.createElement('h2');
  h.textContent = title;
  root.append(h);
  if (note) { const p = document.createElement('p'); p.textContent = note; root.append(p); }
  const row = document.createElement('div');
  row.className = 'row';
  root.append(row);
  return row;
}

const mint = (defId: string, key: string): IItem =>
  ItemFactory.createResourceItem(CRAFTED_DEFINITIONS[defId] as any, Rng.fromKey(key));

// ---------------------------------------------------------------------------
// DEMO ROOMS, built once from records
// ---------------------------------------------------------------------------

/** A lived-in workshop on a 4x4 lot: an inner wall, a doorway, windows, stations. */
function demoWorkshop(): IRoomState {
  const room = emptyRoom('proof_shop', { width: 4, height: 4 }, 'crf_plank');
  for (const y of [1, 2, 3, 5, 6, 7]) {
    room.pieces.push({ id: `w${y}`, kind: 'WALL', x: 10, y, materialDefId: 'crf_iron_ingot', builtBy: 'PROOF', at: 0 });
  }
  room.pieces.push({ id: 'd', kind: 'DOOR', x: 10, y: 4, materialDefId: 'crf_plank', builtBy: 'PROOF', at: 0 });
  room.pieces.push({ id: 'win1', kind: 'WINDOW', x: 4, y: 0, materialDefId: 'crf_glass', builtBy: 'PROOF', at: 0 });
  room.pieces.push({ id: 'win2', kind: 'WINDOW', x: 13, y: 0, materialDefId: 'crf_glass', builtBy: 'PROOF', at: 0 });
  room.placements.push(
    { id: 'p1', item: mint('stn_bench', 'proof:bench'), x: 3, y: 2, rotated: false, placedBy: 'PROOF', at: 0 },
    { id: 'p2', item: mint('stn_table', 'proof:table'), x: 12, y: 2, rotated: false, placedBy: 'PROOF', at: 0 },
    { id: 'p3', item: mint('crf_plank', 'proof:plank'), x: 2, y: 8, rotated: true, placedBy: 'PROOF', at: 0 }
  );
  return room;
}

// ---------------------------------------------------------------------------
// SECTIONS
// ---------------------------------------------------------------------------

function renderShells() {
  const row = section(
    'THE SHELL, AT EVERY SIZE',
    'A fresh shell is perimeter wall, one door, open floor — fully walkable by construction. ' +
    'Lot sizes grow as the hub grows (D8), so the room is a pure function of the lot footprint.'
  );
  for (const foot of [{ width: 3, height: 3 }, { width: 4, height: 4 }, { width: 6, height: 5 }]) {
    const room = emptyRoom(`proof_${foot.width}x${foot.height}`, foot, 'crf_plank');
    const sprite = composeRoom(room);
    const walkable = fullyWalkable(room);
    row.append(cell(
      toCanvas(sprite, palette()),
      `${foot.width}x${foot.height} lot -> ${room.size.w}x${room.size.h} tiles · walkable: ${walkable ? 'yes' : 'NO'} · ${hashBytes(sprite.data).toString(16)}`
    ));
  }
}

function renderMaterials() {
  const row = section(
    'PROPERTIES BECOME PIXELS',
    'The same shell record, paid in different materials. The wall is drawn from the material that answered the bill.'
  );
  for (const defId of ['crf_plank', 'crf_iron_ingot', 'crf_glass']) {
    const room = emptyRoom('proof_mat', { width: 4, height: 4 }, defId);
    row.append(cell(toCanvas(composeRoom(room), palette()), `${(CRAFTED_DEFINITIONS as any)[defId].name} shell`));
  }
}

function renderLived() {
  const row = section(
    'A LIVED-IN WORKSHOP',
    'An iron inner wall with a doorway, two glass windows spilling light, a bench, a table, and a plank leaning in the corner. ' +
    'Everything standing is an item; only walls, doors and windows are structure.'
  );
  const room = demoWorkshop();
  const sprite = composeRoom(room);
  row.append(cell(toCanvas(sprite, palette()), `walkable: ${fullyWalkable(room) ? 'yes' : 'NO'} · same record, same bytes: ${hashBytes(sprite.data).toString(16)}`));
}

function renderPresets() {
  const row = section(
    'THE NPC PRESETS (D8)',
    'NPCs never design. These are the blueprints they will use in Wave 11, rendered by the same composer: ' +
    'players bring the materials, a timer runs, a resident moves in.'
  );
  for (const preset of ROOM_PRESETS) {
    const room = presetToRoom(preset, `proof_${preset.id}`, { width: 4, height: 4 }, mint);
    row.append(cell(toCanvas(composeRoom(room), palette()), `${preset.name} (${preset.structureType}) · walkable: ${fullyWalkable(room) ? 'yes' : 'NO'}`));
  }
}

function renderMinSize() {
  const row = section(
    'THE MINIMUM-SIZE RULE',
    'A station needs clear tiles to work. In the walled-off chamber below, the bench is refused and says why; the table fits.'
  );
  // A 3x3 chamber in the corner: wall column with a door, wall row below.
  const room = emptyRoom('proof_min', { width: 4, height: 4 }, 'crf_plank');
  for (const y of [1, 2]) room.pieces.push({ id: `mw${y}`, kind: 'WALL', x: 4, y, materialDefId: 'crf_plank', builtBy: 'PROOF', at: 0 });
  room.pieces.push({ id: 'md', kind: 'DOOR', x: 4, y: 3, materialDefId: 'crf_plank', builtBy: 'PROOF', at: 0 });
  for (const x of [1, 2, 3]) room.pieces.push({ id: `mh${x}`, kind: 'WALL', x, y: 4, materialDefId: 'crf_plank', builtBy: 'PROOF', at: 0 });
  room.pieces.push({ id: 'mh4', kind: 'WALL', x: 4, y: 4, materialDefId: 'crf_plank', builtBy: 'PROOF', at: 0 });

  const bench = mint('stn_bench', 'proof:minbench');
  const table = mint('stn_table', 'proof:mintable');
  const benchVerdict = canPlaceItem(room, bench, 1, 1, false);
  const tableVerdict = canPlaceItem(room, table, 1, 1, false);
  if (tableVerdict.ok) {
    room.placements.push({ id: 'mt', item: table, x: 1, y: 1, rotated: false, placedBy: 'PROOF', at: 0 });
  }
  row.append(cell(toCanvas(composeRoom(room), palette()), `bench (needs ${STATION_MIN_AREA.stn_bench}): ${benchVerdict.ok ? 'allowed' : benchVerdict.reason} · table (needs ${STATION_MIN_AREA.stn_table}): ${tableVerdict.ok ? 'placed' : 'refused'}`));
}

function renderCitySide() {
  const row = section(
    'FROM THE STREET',
    'The built lot the city draws: solid over every tile it blocks, a hard seam all round, the doorway at the bottom centre. ' +
    'The door tile you stand on lies one row below the footprint.'
  );
  for (const state of ['HOUSE', 'WORKSHOP', 'VENDOR'] as const) {
    row.append(cell(toCanvas(lotArt(state, 40, 40, 1), palette(), ATOM_PX * 2), state));
  }
  const dg = roomDoor({ w: 16, h: 12 });
  const note = document.createElement('p');
  note.textContent = `Default materials by tag: ${Object.entries(tagDefaultMaterial).map(([t, d]) => `${t} -> ${d}`).join(', ')}. Interior door gap sits at ${dg.x},${dg.y}.`;
  root.append(note);
}

function render() {
  root.textContent = '';
  renderShells();
  renderMaterials();
  renderLived();
  renderPresets();
  renderMinSize();
  renderCitySide();
}

grayButton.addEventListener('click', () => {
  useGray = !useGray;
  grayButton.setAttribute('aria-pressed', String(useGray));
  render();
});

render();
