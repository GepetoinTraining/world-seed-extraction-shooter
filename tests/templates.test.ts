/**
 * WAVE 10B BARS — registered before the Architect was built (guardrail 1).
 * Test lines 41–44:
 *   41 a template is designed at a drafting table, minted as a signed item, and
 *      sold and bought like any other
 *   42 a bought template raises a house under construction; materials are chosen
 *      per element, consumed once, and the finished room matches the template exactly
 *   43 a template refuses a lot that does not meet its size needs, in voice, with the numbers
 *   44 the architect's name survives: author provenance reads on the template and on
 *      the standing house, after copying and resale
 * Plus the wave's own bars (PLAN 3B, Wave 10B): same template + same material
 * sheet → same built bytes; an invalid template cannot be minted and says why;
 * the apply bill is consumed exactly once; an under-construction lot blocks
 * exactly what it draws and its progress only moves forward; template thumbnails
 * are real composed atoms, not icons; the presets fold into the one contract.
 * Decisions honored: D12 (scribe's table, generalist), D13 (material per element
 * class by TAG; a mono-material house is detected and recorded), D14 (not
 * consumed; paper-and-ink bill; the author rides every copy).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = new Map<string, any>();
vi.mock('../shared/entities/data/VectorStore', () => ({
  VectorNamespace: { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories' },
  VectorStore: {
    get: async (_ns: string, id: string) => db.get(id) ?? null,
    put: async (doc: any) => { db.set(doc.id, doc); return true; },
    query: async () => [...db.values()],
    saveContent: async () => true,
    searchContent: async () => []
  }
}));
vi.mock('../src/entities/identity/certificateSystem', () => ({
  CertificateSystem: {
    signPayload: async (uid: string, payload: any) => ({ payload, signature: 'sig', certUid: uid, timestamp: 0 }),
    verifyPayload: async () => true,
    getPrivateKey: async () => null
  }
}));

import { IItem, ItemType } from '../shared/types';
import { emptyRoom, interiorSize, STATION_FUNCTION, STATION_MIN_AREA } from '../shared/entities/hub/room';
import {
  ITemplate, ITemplateSheet, SIZE_CLASSES, SYSTEM_TEMPLATES, ROOM_PRESETS, TEMPLATE_MINT_BILL,
  defaultSheet, templateToRoom, validateTemplate, sizeNeedsVerdict, templateBill,
  templateMatchesRoom, monoMaterialOf, lotConstruction, presetToRoom, canAddPiece
} from '../shared/entities/hub/template';
import { TemplateSystem, ITemplateItem } from '../src/logic/systems/TemplateSystem';
import { composeRoom, templateThumb } from '../src/render/atoms/room';
import { lotArt } from '../src/render/atoms/hub';
import { Role, STEPS, hashBytes, px } from '../shared/render/atoms/atoms';
import { itemArtFor } from '../src/render/atoms/items';
import { inspectItem, inspectTemplateRoom } from '../src/render/atoms/inspect';
import { useHubStore } from '../src/entities/hub/store';
import { usePlayerStore, playerPort } from '../src/entities/player/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { CRAFTED_DEFINITIONS, RECIPE_DEFINITIONS } from '../shared/entities/economy/data/recipeDefinitions';
import { Rng } from '../shared/logic/rng/DeterministicRNG';

// -----------------------------------------------------------------------------
// Bars, set before the build. Do not lower them to get a pass.
// -----------------------------------------------------------------------------
const UNDERCON_FLOOR_MAX = 0.30;  // floor/transparent atoms allowed per blocked under-construction tile
const ZONE_TILE_DIFF_MIN = 0.10;  // share of a zone tile's atoms changed by its own floor material
const THUMB_COVER_MIN = 0.20;     // share of a template thumbnail that is drawn, not empty

const CERT = (uid: string, name = 'TESTER') => ({
  metadata: { uid, displayName: name, createdAt: 0 },
  publicKey: {} as any,
  publicKeyJWK: {} as any
}) as any;

const mintRes = (defId: string, key: string): IItem =>
  ItemFactory.createResourceItem(CRAFTED_DEFINITIONS[defId] as any, Rng.fromKey(key));

const FOOT_4x4 = { width: 4, height: 4 };

/** A real draft: an inner wall with a door, two windows, one named zone. */
const draft = (over: Record<string, any> = {}) => ({
  name: 'GALL ROW HOUSE',
  structureType: 'HOUSE' as const,
  footprint: FOOT_4x4,
  pieces: [
    { kind: 'WALL' as const, x: 10, y: 1 }, { kind: 'WALL' as const, x: 10, y: 2 }, { kind: 'WALL' as const, x: 10, y: 3 },
    { kind: 'DOOR' as const, x: 10, y: 4 },
    { kind: 'WINDOW' as const, x: 4, y: 0 }, { kind: 'WINDOW' as const, x: 12, y: 0 }
  ],
  zones: [{ name: 'STUDY', tiles: [{ x: 3, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 3 }, { x: 4, y: 3 }], minArea: 8 }],
  ...over
});

const asTemplate = (d = draft()): ITemplate => ({
  version: 1, authorUid: 'uid_author', authorName: 'HALDE', designedAt: 1, ...d
} as ITemplate);

const SHEET: ITemplateSheet = { WALL: 'crf_plank', DOOR: 'crf_plank', WINDOW: 'crf_glass', zones: { STUDY: 'crf_iron_ingot' } };

const primeStash = (items: IItem[], gold = 10_000) => {
  usePlayerStore.setState(s => ({
    player: { ...s.player, bank: { ...s.player.bank, gold, stashTabs: [{ name: 'MAIN', items }] } }
  }));
};
const stash = () => usePlayerStore.getState().player.bank.stashTabs[0].items;
const gold = () => usePlayerStore.getState().player.bank.gold;

const buildingKit = () => [
  ...Array.from({ length: 8 }, (_, i) => mintRes('crf_plank', `tpl:plank:${i}`)),
  ...Array.from({ length: 3 }, (_, i) => mintRes('crf_iron_ingot', `tpl:ingot:${i}`)),
  ...Array.from({ length: 2 }, (_, i) => mintRes('crf_glass', `tpl:glass:${i}`))
];
const scribeKit = () => [mintRes('crf_paper', 'tpl:paper'), mintRes('crf_ink', 'tpl:ink')];

async function ownedLot() {
  useHubStore.setState({ activeHubId: null, lots: [], craftingJobs: [], rooms: {}, buildJobs: [] } as any);
  await useHubStore.getState().loadHub('hub_tpl');
  primeStash([...buildingKit(), ...scribeKit()]);
  // Setup moved for the stretch: lot 0 is 8x8 now, and lot 3 is the 4x4 this bar has always meant.
  const lotId = useHubStore.getState().lots[3].id;
  expect(await useHubStore.getState().buyLot(lotId)).toBe(true);
  return lotId;
}

const finishJobs = () =>
  useHubStore.setState(s => ({ buildJobs: (s as any).buildJobs.map((j: any) => ({ ...j, finishesAt: 0 })) } as any));

async function mintedTemplate(d = draft()): Promise<ITemplateItem> {
  primeStash([...stash(), ...scribeKit()]);
  const res = await TemplateSystem.mintTemplate(d as any, playerPort);
  expect(res.ok, res.reason).toBe(true);
  return res.item!;
}

beforeEach(() => {
  db.clear();
  localStorage.clear();
  useIdentityStore.setState({ certificate: CERT('uid_author', 'HALDE') });
  usePlayerStore.getState().initializeSession(CERT('uid_author', 'HALDE'), 'NOMAD');
});

// -----------------------------------------------------------------------------
// 10B.1 THE CONTRACT — one law: same template + same sheet → same bytes
// -----------------------------------------------------------------------------

describe('the same template and sheet give the same bytes', () => {
  it('composes identically twice, and from a deep copy', () => {
    const tpl = asTemplate();
    const a = composeRoom(templateToRoom(tpl, SHEET, 'poi_lot_0'));
    const b = composeRoom(templateToRoom(JSON.parse(JSON.stringify(tpl)), JSON.parse(JSON.stringify(SHEET)), 'poi_lot_0'));
    expect(hashBytes(a.data)).toBe(hashBytes(b.data));
    expect(a.w).toBe(interiorSize(FOOT_4x4).w * 10);
  });

  it('a different sheet gives different bytes: the material is the look', () => {
    const tpl = asTemplate();
    const plank = composeRoom(templateToRoom(tpl, SHEET, 'poi_lot_0'));
    const ingot = composeRoom(templateToRoom(tpl, { ...SHEET, WALL: 'crf_iron_ingot' }, 'poi_lot_0'));
    expect(hashBytes(plank.data)).not.toBe(hashBytes(ingot.data));
  });

  it('a floor zone is drawn from its own material and reads apart', () => {
    const tpl = asTemplate();
    const zoned = composeRoom(templateToRoom(tpl, SHEET, 'poi_lot_0'));
    const bare = composeRoom(templateToRoom({ ...tpl, zones: [] }, SHEET, 'poi_lot_0'));
    // The zone's tiles must change by at least the bar, per tile.
    for (const t of tpl.zones[0].tiles) {
      let diff = 0;
      for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
        const i = (t.y * 10 + y) * zoned.w + t.x * 10 + x;
        if (zoned.data[i] !== bare.data[i]) diff++;
      }
      expect(diff / 100, `zone tile ${t.x},${t.y}`).toBeGreaterThanOrEqual(ZONE_TILE_DIFF_MIN);
    }
  });
});

// -----------------------------------------------------------------------------
// THE PRESETS FOLD IN — one contract, no second path
// -----------------------------------------------------------------------------

describe('the presets are system templates', () => {
  it('every system template validates under the same law', () => {
    for (const tpl of SYSTEM_TEMPLATES) {
      const v = validateTemplate(tpl);
      expect(v.ok, `${tpl.name}: ${v.ok ? '' : v.reason}`).toBe(true);
    }
  });

  it('every preset rides a system template and still composes its room', () => {
    for (const preset of ROOM_PRESETS) {
      expect(SYSTEM_TEMPLATES.some(t => t === preset.template)).toBe(true);
      const room = presetToRoom(preset, 'poi_lot_p', FOOT_4x4, mintRes);
      expect(room.pieces.length).toBe(preset.template.pieces.length);
      expect(room.placements.length).toBe(preset.stations.length);
    }
  });
});

// -----------------------------------------------------------------------------
// THE MINT LAW — an invalid template cannot be minted, and says why
// -----------------------------------------------------------------------------

describe('an invalid template cannot be minted, and says why', () => {
  it('refuses the sealing wall column', () => {
    const h = interiorSize(FOOT_4x4).h;
    const pieces = Array.from({ length: h - 2 }, (_, i) => ({ kind: 'WALL' as const, x: 3, y: i + 1 }));
    const v = validateTemplate(asTemplate(draft({ pieces, zones: [] })));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/seal|door/i);
  });

  it('refuses a window off the outside wall, a stair, and a piece on the way out', () => {
    const inWindow = validateTemplate(asTemplate(draft({ pieces: [{ kind: 'WINDOW', x: 5, y: 5 }], zones: [] })));
    expect(inWindow.ok).toBe(false);
    if (!inWindow.ok) expect(inWindow.reason).toMatch(/outside wall|window/i);

    const stair = validateTemplate(asTemplate(draft({ pieces: [{ kind: 'STAIR', x: 5, y: 5 }], zones: [] })));
    expect(stair.ok).toBe(false);
    if (!stair.ok) expect(stair.reason).toMatch(/floor|tier/i);

    const size = interiorSize(FOOT_4x4);
    const onDoor = validateTemplate(asTemplate(draft({ pieces: [{ kind: 'WALL', x: size.w >> 1, y: size.h - 1 }], zones: [] })));
    expect(onDoor.ok).toBe(false);
  });

  it('refuses a zone that promises more open tiles than the plan holds, with the numbers', () => {
    const v = validateTemplate(asTemplate(draft({ zones: [{ name: 'HALL', tiles: [{ x: 2, y: 2 }], minArea: 500 }] })));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/500/);
  });

  it('the live check speaks while drawing: canAddPiece refuses in voice', () => {
    const d = draft({ pieces: [], zones: [] });
    const size = interiorSize(FOOT_4x4);
    const v = canAddPiece(d as any, 'WALL', size.w >> 1, size.h - 1);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason.length).toBeGreaterThan(0);
    expect(canAddPiece(d as any, 'WALL', 5, 5).ok).toBe(true);
  });

  it('a refused mint consumes nothing', async () => {
    primeStash(scribeKit());
    const before = stash().length;
    const res = await TemplateSystem.mintTemplate(draft({ pieces: [{ kind: 'WINDOW', x: 5, y: 5 }], zones: [] }) as any, playerPort);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason!.length).toBeGreaterThan(0);
    expect(stash().length).toBe(before);
  });
});

// -----------------------------------------------------------------------------
// D14 — PAPER AND INK: the mint bill is real, craftable, and paid exactly once
// -----------------------------------------------------------------------------

describe('paper and ink are the mint bill (D14)', () => {
  it('the bill asks for paper and ink by tag', () => {
    const tags = TEMPLATE_MINT_BILL.map(l => l.tag).sort();
    expect(tags).toEqual(['ink', 'paper']);
  });

  it('paper, ink and the scribe\'s table exist with recipes whose inputs exist', () => {
    for (const defId of ['crf_paper', 'crf_ink', 'stn_scribe']) {
      expect(CRAFTED_DEFINITIONS[defId], defId).toBeTruthy();
    }
    expect((CRAFTED_DEFINITIONS.crf_paper.tags || [])).toContain('paper');
    expect((CRAFTED_DEFINITIONS.crf_ink.tags || [])).toContain('ink');
    for (const rid of ['recipe_paper', 'recipe_ink', 'recipe_scribe_table']) {
      const recipe = RECIPE_DEFINITIONS[rid];
      expect(recipe, rid).toBeTruthy();
      for (const input of recipe.inputs) {
        const known = CRAFTED_DEFINITIONS[input.itemId] || input.itemId.startsWith('res_');
        expect(known, `${rid} input ${input.itemId}`).toBeTruthy();
      }
    }
    // D12: the scribe's table is a station with a working minimum, like the others
    expect(STATION_MIN_AREA.stn_scribe).toBeGreaterThan(0);
    expect(STATION_FUNCTION.stn_scribe).toBe('SCRIBE');
  });

  it('minting pays one paper and one ink, signs, and the item carries the plan', async () => {
    primeStash([...scribeKit(), mintRes('crf_plank', 'tpl:spare')]);
    const res = await TemplateSystem.mintTemplate(draft() as any, playerPort);
    expect(res.ok, res.ok ? '' : res.reason).toBe(true);
    const item = res.item!;
    // Paper and ink left; the plank stayed; the template arrived.
    expect(stash().some(i => i.universalDefinitionId === 'crf_paper')).toBe(false);
    expect(stash().some(i => i.universalDefinitionId === 'crf_ink')).toBe(false);
    expect(stash().some(i => i.universalDefinitionId === 'crf_plank')).toBe(true);
    expect(stash().some(i => i.id === item.id)).toBe(true);
    expect(item.type).toBe(ItemType.TEMPLATE);
    expect(item.templateData.name).toBe('GALL ROW HOUSE');
    expect(item.templateData.authorUid).toBe('uid_author');
    expect(item.templateData.authorName).toBe('HALDE');
    // Provenance: MINT, origin DESIGN
    const chain = db.get(`prov_${item.id}`);
    expect(chain?.data?.events?.[0]?.payload?.type).toBe('MINT');
    expect(chain?.data?.events?.[0]?.payload?.context?.origin).toBe('DESIGN');
  });
});

// -----------------------------------------------------------------------------
// LINE 41 — designed, minted, sold and bought like any other item
// -----------------------------------------------------------------------------

describe('line 41: a template trades through the existing counter', () => {
  it('lists on a vendor lot and is bought with the plan intact', async () => {
    const lotId = await ownedLot();
    await useHubStore.getState().buildStructure(lotId, 'VENDOR');
    finishJobs();
    await useHubStore.getState().resolveBuilds();

    const item = await mintedTemplate();
    expect(await useHubStore.getState().listItemForSale(lotId, item.id, 120)).toBe(true);
    expect(stash().some(i => i.id === item.id)).toBe(false);
    expect(await useHubStore.getState().buyFromLot(lotId, item.id)).toBe(true);
    const back = stash().find(i => i.id === item.id) as ITemplateItem;
    expect(back).toBeTruthy();
    expect(back.templateData.authorUid).toBe('uid_author'); // the plan rode the trade
    const chain = db.get(`prov_${item.id}`);
    expect(chain.data.events.some((e: any) => e.payload.type === 'TRANSFER')).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// LINE 43 — size needs refuse, in voice, with the numbers
// -----------------------------------------------------------------------------

describe('line 43: size needs refuse with the numbers', () => {
  it('a 6x5 plan refuses a 4x4 lot, naming both', async () => {
    const big = draft({ footprint: { width: 6, height: 5 }, pieces: [], zones: [] });
    const v = sizeNeedsVerdict(asTemplate(big), FOOT_4x4);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toMatch(/6/);
      expect(v.reason).toMatch(/5/);
      expect(v.reason).toMatch(/4/);
    }

    const lotId = await ownedLot();
    const item = await mintedTemplate(big);
    const res = await useHubStore.getState().applyTemplate(lotId, item.id, { WALL: 'crf_plank', DOOR: 'crf_plank', WINDOW: 'crf_glass', zones: {} });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/6/);
  });

  it('every declared size class is real', () => {
    expect(SIZE_CLASSES.length).toBeGreaterThanOrEqual(2);
    for (const c of SIZE_CLASSES) {
      expect(fullyWalkableShell(c)).toBe(true);
    }
    function fullyWalkableShell(c: { width: number; height: number }) {
      const room = emptyRoom('l', c, 'crf_plank');
      return room.size.w > 2 && room.size.h > 2;
    }
  });
});

// -----------------------------------------------------------------------------
// LINE 42 — the house rises: bill once, order kept, finished means equal
// -----------------------------------------------------------------------------

describe('line 42: a template raises a house under construction', () => {
  it('consumes the bill exactly once, builds in order, and finishes piece for piece', async () => {
    const lotId = await ownedLot();
    const item = await mintedTemplate();
    const goldBefore = gold();
    const stashBefore = stash().length;

    const bill = templateBill(item.templateData, SHEET);
    const billCount = bill.choices.reduce((n, c) => n + c.count, 0) + bill.tagLines.reduce((n, l) => n + l.count, 0);

    const res = await useHubStore.getState().applyTemplate(lotId, item.id, SHEET);
    expect(res.ok, res.ok ? '' : res.reason).toBe(true);
    expect(stash().length).toBe(stashBefore - billCount);
    expect(stash().some(i => i.id === item.id)).toBe(true); // D14: the drawing is not burned
    expect(gold()).toBeLessThan(goldBefore); // the permit went to the treasury

    // Under construction: blocks like a built lot, progress forward only.
    const jobs = () => (useHubStore.getState() as any).buildJobs;
    const con0 = lotConstruction(jobs(), lotId);
    expect(con0).toBeTruthy();
    expect(con0!.progress).toBe(0);
    // Pieces apply in order on the clock: finish times ascend, shell first.
    const batch = jobs().filter((j: any) => j.lotId === lotId && j.batch === item.id);
    expect(batch[0].kind).toBe('SHELL');
    for (let i = 1; i < batch.length; i++) {
      expect(batch[i].finishesAt).toBeGreaterThan(batch[i - 1].finishesAt);
    }

    // The shell lands first; progress moves, and only forward.
    useHubStore.setState(s => ({ buildJobs: (s as any).buildJobs.map((j: any) => j.kind === 'SHELL' ? { ...j, finishesAt: 0 } : j) } as any));
    await useHubStore.getState().resolveBuilds();
    const con1 = lotConstruction(jobs(), lotId);
    expect(con1).toBeTruthy();
    expect(con1!.progress).toBeGreaterThan(0);

    finishJobs();
    await useHubStore.getState().resolveBuilds();
    await useHubStore.getState().resolveBuilds(); // resolving twice must not double anything
    expect(lotConstruction(jobs(), lotId)).toBeNull(); // finished means finished

    const room = (useHubStore.getState() as any).rooms[lotId];
    expect(room).toBeTruthy();
    expect(templateMatchesRoom(item.templateData, SHEET, room)).toBe(true);
    expect(room.pieces.length).toBe(item.templateData.pieces.length);
    expect(stash().length).toBe(stashBefore - billCount); // a HOUSE mints no station; nothing doubled
  });

  it('the finished room survives a cold reload, byte for byte, with its architect', async () => {
    const lotId = await ownedLot();
    const item = await mintedTemplate();
    const res = await useHubStore.getState().applyTemplate(lotId, item.id, SHEET);
    expect(res.ok, res.ok ? '' : res.reason).toBe(true);
    finishJobs();
    await useHubStore.getState().resolveBuilds();
    const before = (useHubStore.getState() as any).rooms[lotId];
    const beforeHash = hashBytes(composeRoom(before).data);
    expect(before.template?.authorName).toBe('HALDE');

    useHubStore.setState({ activeHubId: null, lots: [], craftingJobs: [], rooms: {}, buildJobs: [] } as any);
    await useHubStore.getState().loadHub('hub_tpl');
    const after = (useHubStore.getState() as any).rooms[lotId];
    expect(after).toBeTruthy();
    expect(hashBytes(composeRoom(after).data)).toBe(beforeHash);
    expect(after.template?.authorUid).toBe('uid_author');
  });

  it('a refused apply consumes nothing: no materials, no gold, no jobs', async () => {
    const lotId = await ownedLot();
    const item = await mintedTemplate();
    primeStash([item, mintRes('crf_plank', 'tpl:lone')], 5000); // far short of the bill
    const goldBefore = gold();
    const res = await useHubStore.getState().applyTemplate(lotId, item.id, SHEET);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason.length).toBeGreaterThan(0);
    expect(stash().length).toBe(2);
    expect(gold()).toBe(goldBefore);
    expect((useHubStore.getState() as any).buildJobs.some((j: any) => j.batch === item.id)).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// LINE 44 — the architect's name survives copying and resale
// -----------------------------------------------------------------------------

describe("line 44: the architect's name survives", () => {
  it('a copy keeps the original author, even minted by another hand', async () => {
    primeStash(scribeKit());
    const res = await TemplateSystem.mintTemplate(draft() as any, playerPort);
    expect(res.ok).toBe(true);
    const original = res.item!;

    // Another identity holds the original and mints a copy.
    useIdentityStore.setState({ certificate: CERT('uid_buyer', 'VESPER') });
    primeStash([original, ...scribeKit()]);
    const copyRes = await TemplateSystem.mintCopy(original.id, playerPort);
    expect(copyRes.ok, copyRes.ok ? '' : copyRes.reason).toBe(true);
    const copy = copyRes.item!;
    expect(copy.id).not.toBe(original.id);
    expect(copy.templateData.authorUid).toBe('uid_author'); // the author rides the copy
    expect(copy.templateData.authorName).toBe('HALDE');
    const chain = db.get(`prov_${copy.id}`);
    expect(chain?.data?.events?.[0]?.payload?.context?.origin).toBe('COPY');
    expect(chain?.data?.events?.[0]?.payload?.context?.authorUid).toBe('uid_author');
  });

  it('the standing house names its architect, and the cards read it', async () => {
    const lotId = await ownedLot();
    const item = await mintedTemplate();

    // The card on the ITEM reads the author.
    const itemCard = inspectItem(item);
    expect(itemCard.rows.some(([k, v]) => /architect/i.test(k) && v === 'HALDE')).toBe(true);

    const res = await useHubStore.getState().applyTemplate(lotId, item.id, SHEET);
    expect(res.ok).toBe(true);
    finishJobs();
    await useHubStore.getState().resolveBuilds();
    const room = (useHubStore.getState() as any).rooms[lotId];
    expect(room.template?.name).toBe('GALL ROW HOUSE');
    expect(room.template?.authorUid).toBe('uid_author');

    // The card on the STANDING HOUSE reads the author.
    const houseCard = inspectTemplateRoom(room);
    expect(houseCard).toBeTruthy();
    expect(houseCard!.title).toMatch(/GALL ROW HOUSE/);
    expect(houseCard!.rows.some(([k, v]) => /architect/i.test(k) && v === 'HALDE')).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// D13 — the mono-material house is detected and recorded
// -----------------------------------------------------------------------------

describe('D13: a house built fully of one material is known', () => {
  it('all-plank reads as mono; one glass window breaks the set', async () => {
    const plankOnly = draft({
      pieces: [{ kind: 'WALL', x: 10, y: 1 }, { kind: 'WALL', x: 10, y: 2 }, { kind: 'DOOR', x: 10, y: 3 }],
      zones: [{ name: 'HALL', tiles: [{ x: 3, y: 3 }], minArea: 4 }]
    });
    const monoSheet: ITemplateSheet = { WALL: 'crf_plank', DOOR: 'crf_plank', WINDOW: 'crf_glass', zones: { HALL: 'crf_plank' } };
    const monoRoom = templateToRoom(asTemplate(plankOnly), monoSheet, 'poi_lot_0');
    expect(monoMaterialOf(monoRoom)).toBe('crf_plank');

    const mixed = templateToRoom(asTemplate(), SHEET, 'poi_lot_0');
    expect(monoMaterialOf(mixed)).toBeNull();

    // The house card says so — the bonus's numbers are 11B's, on record.
    const withRef = { ...monoRoom, template: { itemId: 'x', name: 'PLANK HALL', authorUid: 'u', authorName: 'HALDE' } };
    const card = inspectTemplateRoom(withRef as any);
    expect(card!.rows.some(([k]) => /one material|set/i.test(k))).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// THE CITY SIDE — under construction blocks what it draws, progress forward only
// -----------------------------------------------------------------------------

describe('an under-construction lot blocks exactly what it draws', () => {
  const isFloorish = (v: number) => !v || (v >= px(Role.GROUND, 0) && v <= px(Role.GROUND, STEPS - 1));

  it('the scaffold is solid over every tile it blocks', () => {
    for (const p of [0, 0.25, 0.75]) {
      const art = lotArt('UNDER_CONSTRUCTION', 40, 40, 1, p);
      for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
        let floor = 0;
        for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
          if (isFloorish(art.data[(ty * 10 + y) * art.w + tx * 10 + x])) floor++;
        }
        expect(floor / 100, `p=${p} tile ${tx},${ty}`).toBeLessThanOrEqual(UNDERCON_FLOOR_MAX);
      }
    }
  });

  it('progress reads by shape and only grows', () => {
    const solidCount = (p: number) => {
      const art = lotArt('UNDER_CONSTRUCTION', 40, 40, 1, p);
      let n = 0;
      for (const v of art.data) if (v && !(v >= px(Role.GROUND, 0) && v <= px(Role.GROUND, STEPS - 1))) n++;
      return n;
    };
    const a = solidCount(0.125), b = solidCount(0.5), c = solidCount(1);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
});

// -----------------------------------------------------------------------------
// THE THUMBNAIL — real composed atoms, not an icon
// -----------------------------------------------------------------------------

describe('template thumbnails are real composed atoms', () => {
  it('the item art IS the composed plan, and two plans differ', async () => {
    primeStash(scribeKit());
    const a = (await TemplateSystem.mintTemplate(draft() as any, playerPort)).item!;
    primeStash([...stash(), ...scribeKit()]);
    const b = (await TemplateSystem.mintTemplate(draft({
      name: 'BARE SHELL', pieces: [], zones: []
    }) as any, playerPort)).item!;

    const artA = itemArtFor(a);
    const artB = itemArtFor(b);
    expect(hashBytes(artA.data)).toBe(hashBytes(templateThumb(a.templateData, a.dimensions).data));
    expect(hashBytes(artA.data)).not.toBe(hashBytes(artB.data));
    const drawn = artA.data.reduce((n, v) => n + (v ? 1 : 0), 0);
    expect(drawn / artA.data.length).toBeGreaterThanOrEqual(THUMB_COVER_MIN);
  });
});
