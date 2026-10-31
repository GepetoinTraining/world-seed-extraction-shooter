import { HUB_NPCS, HubGenerator, IPOI, POIType } from '../../src/entities/hub/HubGenerator';
import { ITEM_DEFINITIONS } from '../../src/entities/item/data/itemDefinitions';
import { ATOM_PX, Sprite, buildPalette, grayscale, hashBytes } from '../../src/render/atoms/atoms';
import { HUB_GENRE, HUB_TILE, LOT_STATES, LotState, composeHub, doorOf, emblem, lotArt, textSprite } from '../../src/render/atoms/hub';
import { ARCHETYPE_IDS, Archetype, ArmorClass, Facing, WALK_PHASES, WeaponClass, castFigure, castPortrait, figure, portrait, weaponClass } from '../../src/render/atoms/people';

const layout = HubGenerator.generate();
const pois = layout.zones.flatMap(z => z.pois);
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

// Stepped animation for the proof page: frames swap, nothing interpolates.
const animTimers: number[] = [];
function animated(framesList: Sprite[], table: Uint8Array, scale: number, ms: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:flex-end';
  const canvases = framesList.map(s => toCanvas(s, table, scale));
  canvases.forEach((c, i) => { c.style.display = i === 0 ? '' : 'none'; wrap.append(c); });
  let at = 0;
  animTimers.push(window.setInterval(() => {
    canvases[at].style.display = 'none';
    at = (at + 1) % canvases.length;
    canvases[at].style.display = '';
  }, ms));
  return wrap;
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

const SAMPLE_IDS = ['ws_69e30a63_mvvj0dil_f4304a85', 'ws_159d4ad7_mvvmgerl_66446b7f', 'ws_b12f9531_mvvk2a01_0c9d1e22', 'ws_7a1100fe_mvvn9q11_a81b6677'];

const state = {
  uid: SAMPLE_IDS[0],
  archetype: 'NOMAD' as Archetype,
  weapon: undefined as WeaponClass | undefined,
  armor: undefined as ArmorClass | undefined,
  x: layout.spawnPoint.x, y: layout.spawnPoint.y,
  px: (layout.spawnPoint.x + 0.5) * HUB_TILE, py: (layout.spawnPoint.y + 0.5) * HUB_TILE,
  facing: 'down' as Facing,
  step: 0,
  stepAt: 0,
  frame: 0,
  mode: 'walk' as 'walk',
  nearby: null as IPOI | null,
  talking: null as IPOI | null,
  lotsDemo: true
};

const DEMO_LOTS: Record<number, LotState> = { 0: 'FOR_SALE', 1: 'OWNED_EMPTY', 2: 'HOUSE', 3: 'WORKSHOP', 4: 'VENDOR', 5: 'FORECLOSED' };

/** The game's own proximity rule: an interactable within 3 tiles of its center. */
function nearest(x: number, y: number): IPOI | null {
  let best: IPOI | null = null, bestD = Infinity;
  for (const p of pois) {
    if (!p.interactable) continue;
    const d = Math.hypot(x - (p.position.x + p.size.width / 2), y - (p.position.y + p.size.height / 2));
    if (d < 3 && d < bestD) { best = p; bestD = d; }
  }
  return best;
}

const VIEW_TILES = 30;
const frames: Sprite[] = [];
const frameFor = (i: number) => {
  if (!frames[i]) frames[i] = composeHub(layout, { frame: i, lots: state.lotsDemo ? DEMO_LOTS : {} });
  return frames[i];
};

function renderStage() {
  const row = section('NEW CARLEON, WALKABLE', 'The real layout at the 20px tile the game now uses, with the real collision and interaction rules. Click the map, then use WASD to walk and E to talk. The six lots show its five real states and the mark for one reverting.');
  const stage = document.createElement('div');
  stage.className = 'stage';
  row.append(stage);

  const view = document.createElement('canvas');
  view.id = 'hub-view';
  view.tabIndex = 0;
  view.width = VIEW_TILES * HUB_TILE; view.height = VIEW_TILES * HUB_TILE;
  view.style.width = `${view.width * ATOM_PX}px`; view.style.height = `${view.height * ATOM_PX}px`;
  view.setAttribute('aria-label', 'City map. WASD to walk, E to talk.');
  const ctx = view.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  const panel = document.createElement('div');
  panel.className = 'panel';
  const prompt = document.createElement('div');
  prompt.className = 'box';
  prompt.id = 'prompt';
  const dialog = document.createElement('div');
  dialog.className = 'box';
  dialog.id = 'dialog';
  dialog.style.display = 'none';
  const you = document.createElement('div');
  you.className = 'box';
  panel.append(prompt, dialog, you);
  stage.append(view, panel);

  let bitmaps: HTMLCanvasElement[] = [];
  const bitmap = (i: number) => {
    if (!bitmaps[i]) bitmaps[i] = toCanvas(frameFor(i), palette(), 1);
    return bitmaps[i];
  };
  const bodies = new Map<string, HTMLCanvasElement>();
  const figureBitmap = (moving: boolean) => {
    const key = `${state.uid}:${state.archetype}:${state.facing}:${moving ? state.step : 'stand'}:${state.weapon}:${state.armor}`;
    let c = bodies.get(key);
    if (!c) {
      c = toCanvas(figure({ uid: state.uid, archetype: state.archetype, facing: state.facing, step: state.step, moving, weapon: state.weapon, armor: state.armor }), palette(), 1);
      bodies.set(key, c);
    }
    return c;
  };

  const draw = (moving: boolean) => {
    const ox = Math.max(0, Math.min(layout.width * HUB_TILE - VIEW_TILES * HUB_TILE, state.px - (VIEW_TILES * HUB_TILE >> 1)));
    const oy = Math.max(0, Math.min(layout.height * HUB_TILE - VIEW_TILES * HUB_TILE, state.py - (VIEW_TILES * HUB_TILE >> 1)));
    ctx.drawImage(bitmap(state.frame), -Math.round(ox), -Math.round(oy));
    const f = figureBitmap(moving);
    ctx.drawImage(f, Math.round(state.px - (f.width >> 1) - ox), Math.round(state.py - (f.height >> 1) - oy));
  };

  const refresh = () => {
    state.nearby = nearest(state.x, state.y);
    prompt.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'box-title';
    title.textContent = state.nearby ? state.nearby.name : (HubGenerator.getZoneAtPosition(layout, state.x, state.y)?.name ?? 'Unrecorded ground');
    const hint = document.createElement('div');
    hint.className = 'hint';
    if (state.nearby) hint.textContent = state.nearby.npcId ? '[E] Talk' : state.nearby.type === POIType.PLAYER_LOT ? '[E] Inspect lot' : 'No one is here.';
    else hint.textContent = `${state.x}, ${state.y}`;
    prompt.append(title, hint);

    dialog.innerHTML = '';
    const npc = state.talking?.npcId ? HUB_NPCS[state.talking.npcId] : null;
    dialog.style.display = npc ? 'block' : 'none';
    if (npc) {
      const head = document.createElement('div');
      head.style.cssText = 'display:flex;gap:8px;align-items:flex-start';
      head.append(toCanvas(castPortrait(npc.id), palette(), 3));
      const who = document.createElement('div');
      who.innerHTML = '';
      const a = document.createElement('div'); a.className = 'box-title'; a.textContent = npc.name;
      const b = document.createElement('div'); b.className = 'hint'; b.textContent = npc.dialogue && npc.title;
      who.append(a, b);
      head.append(who);
      const line = document.createElement('div'); line.className = 'line'; line.textContent = `"${npc.dialogue.greeting}"`;
      dialog.append(head, line);
      npc.dialogue.options.forEach(o => {
        const opt = document.createElement('div'); opt.className = 'opt'; opt.textContent = `> ${o.label}`;
        dialog.append(opt);
      });
    }
    you.innerHTML = '';
    const yt = document.createElement('div'); yt.className = 'box-title'; yt.textContent = state.archetype.replace('_', ' ');
    const yh = document.createElement('div'); yh.className = 'hint'; yh.textContent = `Certificate ${state.uid.slice(0, 11)}. Derived, not chosen.`;
    you.append(toCanvas(portrait({ uid: state.uid, archetype: state.archetype }), palette(), 4), yt, yh);
    const controls = document.createElement('div');
    controls.className = 'controls';
    const btn = (label: string, act: () => void) => {
      const el = document.createElement('button');
      el.textContent = label;
      el.addEventListener('click', () => { act(); refresh(); draw(false); view.focus(); });
      controls.append(el);
    };
    btn('New certificate', () => { state.uid = `ws_${(hashBytes(new TextEncoder().encode(state.uid)) >>> 0).toString(16)}_proof`; });
    btn('Archetype', () => { state.archetype = ARCHETYPE_IDS[(ARCHETYPE_IDS.indexOf(state.archetype) + 1) % 4]; });
    const ws: (WeaponClass | undefined)[] = [undefined, 'blade', 'heavy', 'caster', 'ranged', 'tool'];
    btn('Weapon', () => { state.weapon = ws[(ws.indexOf(state.weapon) + 1) % ws.length]; });
    const as: (ArmorClass | undefined)[] = [undefined, 'heavy', 'light', 'magic'];
    btn('Armor', () => { state.armor = as[(as.indexOf(state.armor) + 1) % as.length]; });
    you.append(controls);
  };

  // Held keys walk smoothly, the same as the field: one world, one way of walking.
  const keys = new Set<string>();
  const WALK_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
  view.addEventListener('keydown', ev => {
    const k = ev.key.toLowerCase();
    if (WALK_KEYS.includes(k)) { ev.preventDefault(); keys.add(k); state.talking = null; }
    else if (k === 'e') { state.talking = state.nearby; refresh(); }
  });
  view.addEventListener('keyup', ev => keys.delete(ev.key.toLowerCase()));
  view.addEventListener('blur', () => keys.clear());

  const blockedAt = (ax: number, ay: number) => {
    const tx = Math.floor(ax / HUB_TILE), ty = Math.floor(ay / HUB_TILE);
    return tx < 0 || ty < 0 || tx >= layout.width || ty >= layout.height || !layout.navMesh[ty][tx];
  };

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  refresh();
  draw(false);
  if (stageRaf) cancelAnimationFrame(stageRaf);
  let last = performance.now();
  let wasMoving = false;
  const loop = (time: number) => {
    const dt = Math.min((time - last) / 1000, 0.1);
    last = time;
    let dx = 0, dy = 0;
    if (keys.has('w') || keys.has('arrowup')) dy -= 1;
    if (keys.has('s') || keys.has('arrowdown')) dy += 1;
    if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
    if (keys.has('d') || keys.has('arrowright')) dx += 1;
    const moving = dx !== 0 || dy !== 0;
    if (moving) {
      const len = Math.hypot(dx, dy);
      const step = 3.0 * HUB_TILE * dt; // 3 tiles/s, in atoms
      const mx = (dx / len) * step, my = (dy / len) * step;
      let nx = state.px + mx;
      if (blockedAt(nx, state.py) && !blockedAt(state.px, state.py)) nx = state.px;
      let ny = state.py + my;
      if (blockedAt(nx, ny) && !blockedAt(nx, state.py)) ny = state.py;
      state.px = nx; state.py = ny;
      state.facing = Math.abs(mx) > Math.abs(my) ? (mx > 0 ? 'right' : 'left') : (my > 0 ? 'down' : 'up');
      if (time - state.stepAt > 560 / WALK_PHASES) { state.step = (state.step + 1) % WALK_PHASES; state.stepAt = time; }
      const tx = Math.floor(state.px / HUB_TILE), ty = Math.floor(state.py / HUB_TILE);
      if (tx !== state.x || ty !== state.y) { state.x = tx; state.y = ty; refresh(); }
    } else if (wasMoving) {
      state.step = 0;
      state.stepAt = 0;
    }
    wasMoving = moving;
    state.frame = reduced ? 0 : Math.floor(time / 500) % 2;
    draw(moving);
    stageRaf = requestAnimationFrame(loop);
  };
  stageRaf = requestAnimationFrame(loop);
  (window as any).__hub = { state, nearest, hash: hashBytes(composeHub(layout).data) };
}

let stageRaf = 0;

function renderCharacters() {
  const table = palette();
  const archetypes = section('ONE CERTIFICATE, FOUR ARCHETYPES', 'Real size in the field and the city, then the same figure enlarged. Archetype sets the silhouette family. The brackets mark you, by shape, in every world.');
  ARCHETYPE_IDS.forEach(archetype => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;align-items:flex-end';
    (['down', 'right', 'up', 'left'] as Facing[]).forEach(facing => row.append(toCanvas(figure({ uid: SAMPLE_IDS[0], archetype, facing }), table)));
    row.append(toCanvas(figure({ uid: SAMPLE_IDS[0], archetype }), table, 5));
    row.append(toCanvas(portrait({ uid: SAMPLE_IDS[0], archetype }), table, 4));
    archetypes.append(cell(row, archetype));
  });

  const prefersStill = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const walk = section(
    'WALKING (D2: 2 OR 4 FRAMES — CHOOSE BY EYE)',
    `Stand first, then the two-frame cycle, then the four-frame cycle. Stepped frames, never interpolated; stopping always returns to the stand. The game currently walks on ${WALK_PHASES} frames — one constant switches it.` +
    (prefersStill ? ' Reduced motion is on: no animated cells.' : ' The last two cells step at the game\'s cadence: 2-frame, then 4-frame.')
  );
  ARCHETYPE_IDS.forEach(archetype => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:4px;align-items:flex-end';
    const uid = SAMPLE_IDS[1];
    row.append(toCanvas(figure({ uid, archetype, moving: false }), table, 4));
    [0, 1].forEach(step => row.append(toCanvas(figure({ uid, archetype, step, moving: true, phases: 2 }), table, 4)));
    [0, 1, 2, 3].forEach(step => row.append(toCanvas(figure({ uid, archetype, step, moving: true, phases: 4 }), table, 4)));
    if (!prefersStill) {
      row.append(animated([0, 1].map(step => figure({ uid, archetype, step, moving: true, phases: 2 })), table, 4, 280));
      row.append(animated([0, 1, 2, 3].map(step => figure({ uid, archetype, step, moving: true, phases: 4 })), table, 4, 140));
    }
    walk.append(cell(row, `${archetype}: stand · 2-frame · 4-frame`));
  });

  const people = section('TWENTY-FOUR CERTIFICATES', 'Same archetypes, different owners. Who you are comes from the certificate you own, so no one can pick your face and you cannot lose it.');
  for (let i = 0; i < 24; i++) {
    const uid = `ws_${(i * 2654435761 >>> 0).toString(16)}_cert_${i}`;
    const archetype = ARCHETYPE_IDS[i % 4];
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:4px;align-items:flex-end';
    row.append(toCanvas(figure({ uid, archetype }), table, 3), toCanvas(portrait({ uid, archetype }), table, 2));
    people.append(row);
  }

  const gear = section('WEARS WHAT IT CARRIES', 'Real weapon and tool bases map to five held shapes. Armor classes change the outline.');
  const seen = new Set<WeaponClass>();
  [...ITEM_DEFINITIONS.weapon_bases, ...ITEM_DEFINITIONS.tool_bases].forEach(base => {
    const kind = weaponClass(base.tags);
    if (seen.has(kind)) return;
    seen.add(kind);
    gear.append(cell(toCanvas(figure({ uid: SAMPLE_IDS[2], archetype: 'OPERATOR', weapon: kind }), table, 4), `${kind}: ${base.universal_name}`));
  });
  (['heavy', 'light', 'magic'] as ArmorClass[]).forEach(armor => {
    gear.append(cell(toCanvas(figure({ uid: SAMPLE_IDS[2], archetype: 'OPERATOR', armor }), table, 4), `${armor} armor`));
  });

  const cast = section('THE CAST', 'Every named person in the game, at real size and in portrait. The cast is drawn in the hub\'s life ramp; only you are drawn in signal. ');
  Object.values(HUB_NPCS).forEach(npc => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;align-items:flex-end';
    row.append(toCanvas(castFigure(npc.id), table), toCanvas(castFigure(npc.id), table, 4), toCanvas(castPortrait(npc.id), table, 3));
    cast.append(cell(row, `${npc.name}, ${npc.title}`));
  });
}

function renderCity() {
  const table = palette();
  const whole = section('THE WHOLE CITY', 'All 50 by 50 tiles at half scale. Every sign shows its full name.');
  whole.append(toCanvas(composeHub(layout, { lots: DEMO_LOTS }), table, 1));

  const marks = section('EMBLEMS', 'Each kind of building, with no words.');
  [POIType.BANK, POIType.PORTAL, POIType.IDENTIFIER, POIType.GUILD_HALL, POIType.VENDOR_WEAPONS, POIType.VENDOR_ARMOR, POIType.VENDOR_CONSUMABLES, POIType.AUCTION_HOUSE, POIType.TAVERN]
    .forEach(type => marks.append(cell(toCanvas(emblem(type), table, 4), type)));

  const lots = section('LOTS', 'The states a lot can really be in, at real size and enlarged.');
  LOT_STATES.forEach(state2 => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;align-items:flex-end';
    row.append(toCanvas(lotArt(state2, 40, 40, 7), table), toCanvas(lotArt(state2, 40, 40, 7), table, 3));
    lots.append(cell(row, state2.replace('_', ' ')));
  });

  const type = section('TYPE', 'Three by five atoms. Everything the city names, and every letter.');
  type.append(cell(toCanvas(textSprite(['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', "0123456789 ' # . , - :"]), table, 3), 'At 3x'));
  type.append(cell(toCanvas(textSprite(['MARCUS GOLDWEAVE', 'VAULT KEEPER']), table), 'At real 2px'));
}

function render() {
  root.innerHTML = '';
  frames.length = 0;
  animTimers.forEach(t => clearInterval(t));
  animTimers.length = 0;
  renderStage();
  renderCharacters();
  renderCity();
}

grayButton.addEventListener('click', () => {
  useGray = !useGray;
  grayButton.setAttribute('aria-pressed', String(useGray));
  render();
});

render();
void doorOf;
