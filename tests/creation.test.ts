/**
 * CHARACTER CREATION AND THE DEED (D35-D37, D72, D80, D81): line 113. Registered before the build.
 *   113 Everyone begins with one free deed, minting spends a deed, and a deed can be found and exchanged
 * And what the decisions ask of the flow:
 *   D35 skills come through the door and pass the law, with a floor keyed by the answers
 *   D36 the Seed speaks in the terminal's voice
 *   D37 no races, and the four silhouettes stay
 *
 * No test calls a model. The provider here is a fake, and the source says so.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, Root } from 'react-dom/client';

const db = new Map<string, any>();
const savedWorlds: any[] = [];
let refuseToSign = false;

vi.mock('../src/entities/data/VectorStore', () => ({
  VectorNamespace: { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories' },
  VectorStore: {
    get: async (_ns: string, id: string) => db.get(id) ?? null,
    put: async (doc: any) => { db.set(doc.id, doc); return true; },
    query: async (o: any) => [...db.values()].filter(d => (!o?.idPrefix || d.id?.startsWith(o.idPrefix))),
    saveContent: async (_id: string, _type: string, doc: any) => { savedWorlds.push(doc); return true; },
    searchContent: async () => savedWorlds.slice()
  }
}));
vi.mock('../src/entities/identity/certificateSystem', () => ({
  CertificateSystem: {
    signPayload: async (uid: string, payload: any) => (refuseToSign ? null : { payload, signature: 'sig', certUid: uid, timestamp: 0 }),
    verifyPayload: async () => true,
    getPrivateKey: async () => null
  }
}));

import { IItem, IPlayer, ItemType, MENTAL_ATTRIBUTES, PHYSICAL_ATTRIBUTES } from '../types';
import { usePlayerStore, ARCHETYPES } from '../src/entities/player/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { useHubStore } from '../src/entities/hub/store';
import { WorldType, WorldCertificateSystem } from '../src/entities/world/WorldCertificate';
import { WorldClock } from '../src/entities/world/WorldClock';
import { LootTable } from '../src/entities/world/LootTable';
import { NpcSheet } from '../src/logic/systems/NpcSheet';
import { RestSystem } from '../src/logic/systems/RestSystem';
import { Ledger } from '../src/logic/ledger/Ledger';
import { GoldAudit } from '../src/logic/economy/GoldAudit';
import { Treasury } from '../src/logic/economy/Treasury';
import { WebBank } from '../src/logic/content/WebBank';
import { inspectItem } from '../src/render/atoms/inspect';
import { itemArtFor } from '../src/render/atoms/items';
import { WorldDeed, FREE_DEED_SIZE, WORLD_DEED_SIZES, isWorldDeed } from '../src/logic/systems/WorldDeed';
import { WorldDeedDoor } from '../src/logic/systems/WorldDeedDoor';
import { CreationSystem, FATE_GAMBLER, FATE_ORIGIN, GRANTED_SKILLS, ICreationAsk, ICreationWords, IKamiAsk, IKamiWords } from '../src/logic/systems/CreationSystem';
import { CreationDoor } from '../src/logic/systems/CreationDoor';
import { OriginBank } from '../src/logic/content/OriginBank';
import { ORIGIN_BATCHES, IOriginBatch } from '../src/entities/generation/packs/originBatches';
import { CREATION_DRAFT_DEFAULTS, CREATION_DRAFT_KEY, useCreationDraft } from '../src/components/ui/creationDraft';
import { CreationFlow } from '../src/components/CreationFlow';
import { IntelligenceDoor, AbsentProvider } from '../server/intelligence/door';
import { ClaudeProvider, MODEL_FOR } from '../server/intelligence/claude';
import { buildCreationRequest, buildKamiSetRequest, buildKamiTalkRequest, CREATION_SCHEMA, KAMI_SCHEMA } from '../server/intelligence/prompts';
import { createIntelligenceHandler } from '../server/intelligence/http';
import { IntelligenceClient } from '../src/logic/intelligence/IntelligenceClient';
import { ARCHETYPE_IDS, figure, portrait } from '../src/render/atoms/people';
import { FIRST_THEME_PACK, installShippedThemes } from '../src/logic/theme/boot';
import { ContentRegistry } from '../src/logic/theme/ContentRegistry';

installShippedThemes();

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SRC = (p: string) => readFileSync(p, 'utf8');
const CERT = (uid: string, name = 'TEST') => ({
  metadata: { uid, displayName: name, createdAt: 0 }, publicKey: {} as any, publicKeyJWK: {} as any
}) as any;
const player = (): IPlayer => usePlayerStore.getState().player;
const stash = (): IItem[] => player().bank.stashTabs[0].items;
const deeds = () => stash().filter(isWorldDeed);
const ALL_ATTRS = [...PHYSICAL_ATTRIBUTES, ...MENTAL_ATTRIBUTES] as string[];

const born = (uid = 'u_one', archetype = 'OPERATOR', sheet?: any) => {
  useIdentityStore.setState({ certificate: CERT(uid) } as any);
  usePlayerStore.getState().initializeSession(CERT(uid), archetype, sheet);
};

const answersFor = (originId: string, pick = 0): Record<string, string> =>
  Object.fromEntries(CreationSystem.questionsFor(originId).map(q => [q.id, q.answers[pick % q.answers.length].id]));

const draftOf = (originId = 'slow_life', pick = 0) => ({
  originId,
  kitId: OriginBank.origin(originId)!.kits[0],
  silhouette: OriginBank.origin(originId)!.silhouette,
  hubId: '',
  themeId: '',
  answers: answersFor(originId, pick),
  said: ''
});

const sheetOf = (originId = 'slow_life', pick = 0) => {
  const draft = draftOf(originId, pick);
  return CreationSystem.sheet(draft, CreationSystem.floor(draft));
};

const beforeAllReset = () => {
  db.clear();
  savedWorlds.length = 0;
  refuseToSign = false;
};

beforeEach(beforeAllReset);

// -----------------------------------------------------------------------------
// LINE 113: THE DEED
// -----------------------------------------------------------------------------

describe('line 113: everyone begins with one free deed', () => {
  it('a new character holds exactly one, and it is small (D80)', () => {
    born();
    expect(deeds()).toHaveLength(1);
    expect(deeds()[0].worldDeedData!.size).toBe(FREE_DEED_SIZE);
    expect(FREE_DEED_SIZE).toBe(16);
    expect(player().freeDeedGiven).toBe(true);
  });

  it('a character from the new flow holds one too', () => {
    born('u_flow', 'NOMAD', sheetOf());
    expect(deeds()).toHaveLength(1);
  });

  it('a world deed is its own kind, and not the lot deed renamed (D72)', () => {
    born();
    const deed = deeds()[0];
    expect(deed.type).toBe(ItemType.WORLD_DEED);
    expect(deed.type).not.toBe(ItemType.DEED);
    expect(deed.deedData).toBeUndefined();
    expect(deed.composition).toBeTruthy(); // every item knows its atoms (10D)
    // The lot deed's screen filters by its type, so it can never offer this one for a lot
    expect(SRC('src/components/HoldingsPanel.tsx')).toMatch(/i\.type === ItemType\.DEED/);
  });

  it('is keyed by who it was given to, so two characters hold two deeds', () => {
    expect(WorldDeed.free('u_a').id).toBe(WorldDeed.free('u_a').id);
    expect(WorldDeed.free('u_a').id).not.toBe(WorldDeed.free('u_b').id);
  });

  it('an existing character receives it once on load, so nobody is locked out', () => {
    born();
    const old = { ...player(), freeDeedGiven: undefined, bank: { ...player().bank, stashTabs: [{ name: 'OLD', items: [] }] } } as IPlayer;
    const first = WorldDeed.migrate(old);
    expect(first.bank.stashTabs[0].items.filter(isWorldDeed)).toHaveLength(1);
    expect(first.freeDeedGiven).toBe(true);
    expect(WorldDeed.migrate(first)).toBe(first);
  });

  it('having spent it, a reload gives no second one', () => {
    born();
    const spent = { ...player(), bank: { ...player().bank, stashTabs: [{ name: 'S', items: [] }] } } as IPlayer;
    const after = WorldDeed.migrate(spent);
    expect(after).toBe(spent);
    expect(after.bank.stashTabs[0].items).toHaveLength(0);
  });

  it('startup runs the grant, and writes it on the ledger', () => {
    const startup = SRC('src/logic/initialization/StartupSequence.ts');
    expect(startup).toMatch(/WorldDeedDoor\.grantOnLoad/);
    expect(SRC('src/logic/systems/WorldDeedDoor.ts')).toMatch(/WORLD_DEED_GRANTED/);
  });
});

describe('line 113: minting spends a deed', () => {
  const mint = (deedId: string, rules: any = {}) => WorldDeedDoor.mint(CERT('u_one'), deedId, 'POCKET', 'mine', WorldType.EXTRACTION, rules);

  beforeEach(() => born());

  it('takes the deed, and the world is the size the deed names', async () => {
    const deed = deeds()[0];
    const res = await mint(deed.id);
    expect(res.ok, res.reason).toBe(true);
    expect(res.world!.data.size).toBe(16);
    expect(deeds()).toHaveLength(0);
    expect(savedWorlds).toHaveLength(1);
  });

  it('a found medium deed mints a medium world, on the cadence any medium world runs (D80)', async () => {
    const big = WorldDeed.mint({ size: 32, source: 'FOUND', key: 'test:medium' });
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, stashTabs: [{ name: 'S', items: [big] }] } } }));
    const res = await mint(big.id);
    expect(res.world!.data.size).toBe(32);
    expect(res.world!.data.rules.cadence).toEqual(WorldClock.cadenceFor(32));
  });

  it('a pocket world runs the same cadence as any other small world', async () => {
    const res = await mint(deeds()[0].id);
    expect(res.world!.data.rules.cadence).toEqual(WorldClock.cadenceFor(16));
  });

  it('the sky is chosen at the mint, not on the deed (D80)', async () => {
    expect(deeds()[0].worldDeedData).not.toHaveProperty('sky');
    const res = await mint(deeds()[0].id, { sky: 'NIGHT' });
    expect(res.world!.data.rules.sky).toBe('NIGHT');
  });

  it('the certificate names the deed it spent, so the signature covers it', async () => {
    const deed = deeds()[0];
    const res = await mint(deed.id);
    expect(res.world!.data.rules.mintedWithDeed).toBe(deed.id);
  });

  it('it is on the ledger, and moves no gold', async () => {
    const deed = deeds()[0];
    const gold = player().bank.gold;
    await mint(deed.id);
    const rows = await Ledger.list('u_one');
    const row = rows.find(r => r.payload.data.kind === 'WORLD_DEED_SPENT');
    expect(row).toBeTruthy();
    expect(row!.payload.data.deedId).toBe(deed.id);
    expect(row!.payload.data.playerDelta).toBe(0);
    expect(player().bank.gold).toBe(gold);
  });

  it('with no deed, nothing is minted, and it says why', async () => {
    const res = await mint('no_such_deed');
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/deed/i);
    expect(savedWorlds).toHaveLength(0);
  });

  it('a land deed cannot pay for a world', async () => {
    const land = { ...deeds()[0], id: 'land', type: ItemType.DEED, worldDeedData: undefined } as IItem;
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, stashTabs: [{ name: 'S', items: [land] }] } } }));
    expect((await mint('land')).ok).toBe(false);
    expect(savedWorlds).toHaveLength(0);
  });

  it('two presses in one moment spend one deed and mint one world', async () => {
    const deed = deeds()[0];
    const [a, b] = await Promise.all([mint(deed.id), mint(deed.id)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(savedWorlds).toHaveLength(1);
  });

  it('a certificate that refuses to sign hands the deed back', async () => {
    const deed = deeds()[0];
    refuseToSign = true;
    const res = await mint(deed.id);
    expect(res.ok).toBe(false);
    expect(deeds().map(d => d.id)).toEqual([deed.id]);
  });

  it('the biggest world is not offered yet, because hubs cannot be founded in one (D80)', async () => {
    expect(WORLD_DEED_SIZES).not.toContain(128);
    expect(WORLD_DEED_SIZES).toContain(16);
    const biggest = { ...deeds()[0], id: 'biggest', worldDeedData: { size: 128, source: 'FOUND' } } as IItem;
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, stashTabs: [{ name: 'S', items: [biggest] }] } } }));
    const res = await mint('biggest');
    expect(res.ok).toBe(false);
    expect(savedWorlds).toHaveLength(0);
    expect(deeds().map(d => d.id)).toEqual(['biggest']);
  });

  it('the mint goes through this door; the size comes from the deed, not a list', () => {
    const creator = SRC('src/components/WorldCreator.tsx');
    expect(creator).toMatch(/WorldDeedDoor\.mint/);
    expect(creator).not.toMatch(/WorldCertificateSystem\.mintWorld/);
    expect(creator).not.toMatch(/GRID SIZE/);
    expect(SRC('src/entities/world/WorldCertificate.ts')).toMatch(/mintedWithDeed/);
  });

  it('the simulation world and the hub need none', () => {
    expect(SRC('src/logic/initialization/StartupSequence.ts')).toMatch(/WorldCertificateSystem\.mintWorld/);
    expect(SRC('src/entities/world/WorldCertificate.ts')).not.toMatch(/WorldDeed/);
  });
});

describe('line 113: a deed can be found', () => {
  const mob = (over: any = {}) => ({ id: 'm', name: 'm', rank: 'F', tags: [], ...over }) as any;

  it('the same key finds the same deed, or none', () => {
    const a = WorldDeed.foundOn(mob({ rank: 'S', tags: ['boss'] }), 1, 'k:1');
    const b = WorldDeed.foundOn(mob({ rank: 'S', tags: ['boss'] }), 1, 'k:1');
    expect(a).toEqual(b);
  });

  it('an unkeyed roll finds nothing, because it could not be replayed', () => {
    expect(WorldDeed.foundOn(mob({ rank: 'SSS', tags: ['god'] }), 100, undefined)).toEqual([]);
  });

  it('it is rare, and rarer on small things', () => {
    const count = (m: any) => Array.from({ length: 4000 }, (_, i) => WorldDeed.foundOn(m, 1, `k:${i}`)).filter(l => l.length > 0).length;
    const small = count(mob({ rank: 'F', tags: ['grunt'] }));
    const big = count(mob({ rank: 'A', tags: ['boss'] }));
    expect(big).toBeGreaterThan(small);
    expect(big).toBeLessThan(4000);
    expect(small).toBeLessThan(40);
  });

  it('never names the biggest world', () => {
    for (let i = 0; i < 4000; i++) {
      for (const deed of WorldDeed.foundOn(mob({ rank: 'SSS', tags: ['god'] }), 50, `k:${i}`)) {
        expect(WORLD_DEED_SIZES).toContain(deed.worldDeedData!.size);
        expect(deed.worldDeedData!.source).toBe('FOUND');
      }
    }
  });

  it('a found deed really comes out of a drop', () => {
    let found: IItem | undefined;
    for (let i = 0; i < 4000 && !found; i++) {
      found = LootTable.generateLoot(mob({ rank: 'SSS', tags: ['god'] }), 1, undefined, `drop:${i}`).find(isWorldDeed);
    }
    expect(found).toBeTruthy();
  });

  it('looking for one moves no other roll in the drop: it has its own keyed stream', () => {
    const line = SRC('src/entities/world/LootTable.ts').split('\n').filter(l => l.includes('WorldDeed.foundOn'));
    expect(line).toHaveLength(1);
    expect(SRC('src/logic/systems/WorldDeed.ts')).toMatch(/Rng\.fromKey\(`\$\{rollKey\}:world_deed`\)/);
  });
});

describe('line 113: a deed can be exchanged like any item', () => {
  beforeEach(() => born());

  it('reads on the one card, with its size', () => {
    const card = inspectItem(deeds()[0]);
    expect(JSON.stringify(card)).toMatch(/16/);
  });

  it('its art says its size by shape, so sizes differ in grayscale', () => {
    const small = itemArtFor(WorldDeed.mint({ size: 16, source: 'FOUND', key: 'a' }));
    const large = itemArtFor(WorldDeed.mint({ size: 64, source: 'FOUND', key: 'a' }));
    expect(Buffer.from(small.data).equals(Buffer.from(large.data))).toBe(false);
    const inks = (s: { data: Uint8Array }) => new Set(s.data).size;
    expect(inks(small)).toBe(inks(large));
  });

  it('sells to a vendor through the one gold door, and the audit balances', async () => {
    const hub = 'hub_x';
    useHubStore.setState({ activeHubId: hub });
    await Treasury.endow(hub, 100000);
    const genesis = player().bank.gold;
    await Ledger.append('CHARACTER_GENESIS', { gold: genesis });
    const deed = deeds()[0];
    expect(deed.value).toBeGreaterThan(0);
    const offer = await useHubStore.getState().sellToVendor(deed.id);
    expect(offer).toBeGreaterThan(0);
    expect(deeds()).toHaveLength(0);
    const audit = await GoldAudit.run();
    expect(audit.expectedPlayerGold).toBe(audit.actualPlayerGold);
  });

  it('goes over a counter from one person to another, with its record, and the buyer can mint with it', async () => {
    const hub = 'hub_counter';
    useHubStore.setState({ activeHubId: hub, lots: [{ id: 'lot_c', lotIndex: 0, ownerId: 'u_one', ownerName: 'A', structureType: 'VENDOR', shopListings: [] } as any] });
    await Treasury.endow(hub, 1000);
    const deed = deeds()[0];
    expect(await useHubStore.getState().listItemForSale('lot_c', deed.id, 100)).toBe(true);
    expect(deeds()).toHaveLength(0);

    born('u_buyer');
    const own = deeds()[0];
    expect(await useHubStore.getState().buyFromLot('lot_c', deed.id)).toBe(true);
    expect(deeds().map(d => d.id).sort()).toEqual([own.id, deed.id].sort());
    expect(player().bank.gold).toBe(400);

    const res = await WorldDeedDoor.mint(CERT('u_buyer'), deed.id, 'TRADED', 'd', WorldType.EXTRACTION, {});
    expect(res.ok, res.reason).toBe(true);
    expect(res.world!.data.rules.mintedWithDeed).toBe(deed.id);
    expect(deeds().map(d => d.id)).toEqual([own.id]);
  });

  it('whoever holds a deed can mint with it: it names no holder', async () => {
    const deed = deeds()[0];
    expect(deed.worldDeedData).not.toHaveProperty('holder');
    born('u_two');
    const theirs = deeds()[0];
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, stashTabs: [{ name: 'S', items: [theirs, deed] }] } } }));
    const res = await WorldDeedDoor.mint(CERT('u_two'), deed.id, 'BOUGHT', 'd', WorldType.EXTRACTION, {});
    expect(res.ok, res.reason).toBe(true);
    expect(res.world!.data.creatorCertUid).toBe('u_two');
    expect(deeds().map(d => d.id)).toEqual([theirs.id]);
  });

  it('travels as plain data, as an item in a save or a trade must', () => {
    const deed = deeds()[0];
    expect(isWorldDeed(JSON.parse(JSON.stringify(deed)))).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// THE FOUR QUESTIONS: who you were, what you carry, the face of the world, the conversation
// -----------------------------------------------------------------------------

describe('who you were: a bank, with the choices the plan names', () => {
  it('holds the eight the plan named, including cooking and animal tamer', () => {
    const ids = OriginBank.origins().map(o => o.id);
    for (const id of ['economic_genius', 'science_wielder', 'power_fantasy', 'infrastructure_politics', 'jack_of_all_trades', 'slow_life', 'cooking', 'animal_tamer']) {
      expect(ids).toContain(id);
    }
  });

  it('a further batch adds a choice with no code', () => {
    const batch: IOriginBatch = {
      id: 'test_batch',
      origins: [{ ...OriginBank.origin('cooking')!, id: 'test_origin', says: 'YOU WERE TESTED' }],
      kits: [], questions: [], closings: [], flavors: []
    };
    const before = OriginBank.origins().length;
    expect(OriginBank.validate(batch).ok).toBe(true);
    ORIGIN_BATCHES.push(batch);
    OriginBank.reset();
    try {
      expect(OriginBank.origins().length).toBe(before + 1);
      expect(OriginBank.origin('test_origin')!.says).toBe('YOU WERE TESTED');
    } finally {
      ORIGIN_BATCHES.pop();
      OriginBank.reset();
    }
  });

  it('the law refuses a broken batch whole', () => {
    const good = OriginBank.origin('cooking')!;
    const refuse = (origin: any) => OriginBank.validate({ id: 'x', origins: [origin], kits: [], questions: [], closings: [], flavors: [] }).ok;
    expect(refuse({ ...good, main: 'wisdom' })).toBe(false);
    expect(refuse({ ...good, sub: good.main })).toBe(false);
    expect(refuse({ ...good, kits: ['no_such_kit'] })).toBe(false);
    expect(refuse({ ...good, kits: [] })).toBe(false);
    expect(refuse({ ...good, silhouette: 'ELF' })).toBe(false);
    expect(refuse({ ...good, leans: { main: ['no_such_tag_at_all'], sub: [] } })).toBe(false);
    expect(refuse({ ...good, says: 'YOUR ISEKAI TROPE' })).toBe(false);
  });

  it('stands on what ships: every tag it names is registered by the game, not by the test fixture', () => {
    const shipped = new Set([...SRC('src/entities/generation/packs/webBatches.ts').matchAll(/\{ tag: '([a-z_]+)'/g), ...SRC('src/entities/generation/packs/firstTheme.ts').matchAll(/\{ tag: '([a-z_]+)'/g)].map(m => m[1]));
    expect(shipped.size).toBeGreaterThan(50);
    for (const batch of ORIGIN_BATCHES) {
      const named = [
        ...batch.origins.flatMap(o => [...o.leans.main, ...o.leans.sub]),
        ...batch.questions.flatMap(q => q.answers.flatMap(a => a.leans)),
        ...batch.kits.flatMap(k => k.pieces.flatMap(p => (p.tag ? [p.tag] : [])))
      ];
      for (const tag of named) expect(shipped.has(tag), tag).toBe(true);
    }
  });

  it('stands on what ships: every piece of every kit is answered by the shipped theme alone', () => {
    const compiled = ContentRegistry.compiled(FIRST_THEME_PACK.themeId)!;
    const fits = (tags: string[] | undefined, tag?: string) => !tag || (tags ?? []).includes(tag);
    const gear = [...compiled.items.weapon_bases, ...compiled.items.armor_bases, ...compiled.items.tool_bases];
    const onShelf = (ids: string[], tag?: string) => ids.some(id => fits(gear.find(g => g.id === id)?.tags, tag));
    for (const kit of ORIGIN_BATCHES.flatMap(b => b.kits)) {
      for (const piece of kit.pieces) {
        const answered =
          piece.from === 'weapon' ? compiled.items.weapon_bases.some(b => b.rank === 'F' && fits(b.tags, piece.tag))
          : piece.from === 'armor' ? compiled.items.armor_bases.some(b => b.rank === 'F' && fits(b.tags, piece.tag))
          : piece.from === 'tool' ? compiled.items.tool_bases.some(b => b.rank === 'F' && fits(b.tags, piece.tag))
          : piece.from === 'carrier' ? onShelf(compiled.shelf.carrier, piece.tag)
          : piece.from === 'wardrobe' ? onShelf(compiled.shelf.wardrobe, piece.tag)
          : [...compiled.shelf.consumables, ...compiled.shelf.materials].some(id => fits(compiled.resources[id]?.tags, piece.tag));
        expect(answered, `${kit.id}: ${piece.from} ${piece.tag ?? ''}`).toBe(true);
      }
    }
  });

  it('a person always has something to choose: the shipped batch passes its own law', () => {
    for (const batch of ORIGIN_BATCHES) expect(OriginBank.validate(batch)).toEqual({ ok: true });
    expect(OriginBank.origins().length).toBeGreaterThanOrEqual(8);
  });

  it('the bank holds words and tags, and no item from any theme (D53)', () => {
    const text = SRC('src/entities/generation/packs/originBatches.ts');
    expect(text).not.toMatch(/tool_|wpn_|arm_|666daceb/);
  });

  it('the words stay unseen: no shown string in the bank says them', () => {
    const shown = ORIGIN_BATCHES.flatMap(b => [
      ...b.origins.flatMap(o => [o.says, o.line]),
      ...b.kits.flatMap(k => [k.says, k.line]),
      ...b.questions.flatMap(q => [q.asks, ...q.answers.map(a => a.says)]),
      ...b.closings, ...b.flavors
    ]);
    expect(shown.length).toBeGreaterThan(20);
    for (const s of shown) {
      expect(s).not.toMatch(/archetype|trope|isekai|reincarnat/i);
      expect(s).not.toMatch(/!/); // D36: no game-show cheer
    }
  });
});

describe('focus shapes the spread, and the stats still deal from the certificate', () => {
  const total = (a: any) => ALL_ATTRS.reduce((n, k) => n + a[k], 0);
  const lawOf = (uid: string) => NpcSheet.read(uid, { id: uid, rank: 'F' as any }, undefined).stats as any;

  it('deals by the law NPCs read, so a person and an NPC add up alike', () => {
    for (const o of OriginBank.origins()) {
      expect(total(CreationSystem.spread('u_x', o.id))).toBe(total(lawOf('u_x')));
    }
  });

  it('the main focus stands highest, and the sub next', () => {
    for (const o of OriginBank.origins().filter(x => x.main)) {
      const s = CreationSystem.spread('u_x', o.id) as any;
      const sorted = ALL_ATTRS.map(k => s[k]).sort((a, b) => b - a);
      expect(s[o.main!]).toBe(sorted[0]);
      expect(s[o.sub!]).toBe(sorted[1]);
    }
  });

  it('the same certificate and choice deal the same; another certificate deals otherwise', () => {
    const a = CreationSystem.spread('u_x', 'cooking');
    expect(CreationSystem.spread('u_x', 'cooking')).toEqual(a);
    const others = ['u_1', 'u_2', 'u_3', 'u_4'].map(u => JSON.stringify(CreationSystem.spread(u, 'cooking')));
    expect(new Set(others).size).toBeGreaterThan(1);
  });

  it('what is left over stays as the certificate dealt it', () => {
    const law = lawOf('u_y');
    const s = CreationSystem.spread('u_y', 'cooking') as any;
    const moved = ALL_ATTRS.filter(k => s[k] !== law[k]);
    expect(moved.length).toBeLessThanOrEqual(4);
  });

  it('with no focus named, the top of the deal is the focus', () => {
    const f = CreationSystem.focusOf('jack_of_all_trades', 'u_x');
    const s = CreationSystem.spread('u_x', 'jack_of_all_trades') as any;
    const sorted = ALL_ATTRS.map(k => s[k]).sort((a, b) => b - a);
    expect(s[f.main]).toBe(sorted[0]);
    expect(s[f.sub]).toBe(sorted[1]);
    expect(f.main).not.toBe(f.sub);
  });

  it('a character from the flow carries that spread, and no old bonus on top', () => {
    born('u_z', 'STREET_SAMURAI', sheetOf('cooking'));
    expect(player().baseAttributes).toEqual(CreationSystem.spread('u_z', 'cooking'));
    expect(player().archetype).toBe('STREET_SAMURAI');
    expect(ARCHETYPES.STREET_SAMURAI).toBeTruthy();
  });

  it('the record says who they were, for the sheet and for later', () => {
    born('u_z', 'NOMAD', sheetOf('cooking'));
    expect(player().creation!.origin).toBe('cooking');
    expect(player().creation!.main).toBe(OriginBank.origin('cooking')!.main);
  });

  it('D81: nothing on the character says which hub it arrived at; that is a pin the gate writes', () => {
    const sheet = CreationSystem.sheet({ ...draftOf('cooking'), hubId: 'hub_somewhere' }, CreationSystem.floor(draftOf('cooking')));
    expect(sheet.hubId).toBe('hub_somewhere');
    expect(JSON.stringify(sheet.record)).not.toMatch(/hub/i);
    born('u_d81', 'NOMAD', sheet);
    expect(JSON.stringify(player())).not.toContain('hub_somewhere');
    expect(SRC('src/logic/systems/CreationSystem.ts')).not.toMatch(/useHubStore/);
    expect(SRC('src/components/IdentityGate.tsx')).toMatch(/HomeHub\.pin\(cert\.metadata\.uid, sheet\.hubId\)/);
  });

  it('a reload between the mint and walking in keeps who they were: the sheet waits for the genesis row', () => {
    localStorage.clear();
    const sheet = sheetOf('cooking');
    CreationDoor.holdSheet('u_reload', sheet);
    expect(CreationDoor.heldSheet('u_reload')).toEqual(JSON.parse(JSON.stringify(sheet)));
    expect(CreationDoor.heldSheet('u_other')).toBeUndefined();
    born('u_reload', 'NOMAD', CreationDoor.heldSheet('u_reload'));
    expect(player().creation!.origin).toBe('cooking');
    CreationDoor.releaseSheet('u_reload');
    expect(CreationDoor.heldSheet('u_reload')).toBeUndefined();
    expect(SRC('src/components/IdentityGate.tsx')).toMatch(/CreationDoor\.heldSheet\(st\.certificate\.metadata\.uid\)/);
    const startup = SRC('src/logic/initialization/StartupSequence.ts');
    expect(startup).toMatch(/CreationDoor\.heldSheet\(certificate\.metadata\.uid\)\)/);
    expect(startup).toMatch(/CreationDoor\.releaseSheet\(certificate\.metadata\.uid\)/);
  });

  it('a skill reads under the name it was given, on every screen that lists it', () => {
    expect(SRC('src/components/CharacterSheet.tsx')).toMatch(/skillWords\?\.\[skill\.id\]\?\.name/);
    expect(SRC('src/components/PlayerHub.tsx')).toMatch(/skillWords\?\.\[skill\.id\]\?\.name/);
  });

  it('an old-style birth with no sheet stays as it was', () => {
    born('u_old', 'OPERATOR');
    expect((player().baseAttributes as any).intelligence).toBe(1 + (ARCHETYPES.OPERATOR.intelligence as number));
    expect(player().creation).toBeUndefined();
  });
});

describe('D37: no races, and the four silhouettes stay', () => {
  it('the flow offers the four, with a good default from who you were', () => {
    expect(Object.keys(ARCHETYPES).sort()).toEqual(['ARCANIST', 'NOMAD', 'OPERATOR', 'STREET_SAMURAI']);
    for (const o of OriginBank.origins()) expect(Object.keys(ARCHETYPES)).toContain(o.silhouette);
  });

  it('nothing in the flow asks for a race', () => {
    for (const f of ['src/components/CreationFlow.tsx', 'src/entities/generation/packs/originBatches.ts', 'src/logic/systems/CreationSystem.ts']) {
      expect(SRC(f)).not.toMatch(/\brace\b|\braces\b/i);
    }
  });
});

describe('what you carry: a kit that keeps the gold audit', () => {
  it('every kit of every origin mints something real from the content installed', () => {
    for (const o of OriginBank.origins()) {
      for (const kit of o.kits) {
        const items = CreationSystem.mintKit('u_k', kit);
        expect(items.length, `${o.id}:${kit}`).toBeGreaterThan(0);
        for (const item of items) expect(item.isIdentified).toBe(true);
      }
    }
  });

  it('the preview names what the kit will hold, and it is keyed', () => {
    const a = CreationSystem.kitPreview('kit_working');
    expect(a.length).toBeGreaterThan(0);
    expect(CreationSystem.kitPreview('kit_working')).toEqual(a);
    expect(CreationSystem.mintKit('u_k', 'kit_working').map(i => i.universalDefinitionId)).toEqual(a.map(p => p.definitionId));
  });

  it('the same person gets the same kit, and two people hold different items', () => {
    const a = CreationSystem.mintKit('u_a', 'kit_field');
    expect(CreationSystem.mintKit('u_a', 'kit_field').map(i => i.id)).toEqual(a.map(i => i.id));
    const b = CreationSystem.mintKit('u_b', 'kit_field');
    expect(b.map(i => i.id)).not.toEqual(a.map(i => i.id));
  });

  it('it is granted, on the ledger, with no gold moved: the bank still opens at the grant', () => {
    born('u_gold', 'NOMAD', sheetOf());
    expect(player().bank.gold).toBe(500);
    const rows = CreationDoor.genesisRows(player());
    const kit = rows.find(r => r.data.kind === 'KIT_GRANTED');
    expect(kit).toBeTruthy();
    expect(kit!.type).toBe('TRADE');
    expect(kit!.data.playerDelta).toBe(0);
    expect(kit!.data.treasuryDelta).toBe(0);
    expect(kit!.data.itemIds.length).toBeGreaterThan(0);
  });

  it('the genesis audit balances with those rows on it', async () => {
    born('u_audit', 'NOMAD', sheetOf());
    await Ledger.append('CHARACTER_GENESIS', { gold: player().bank.gold });
    for (const row of CreationDoor.genesisRows(player())) await Ledger.append(row.type, row.data);
    const audit = await GoldAudit.run();
    expect(audit.expectedPlayerGold).toBe(500);
    expect(audit.actualPlayerGold).toBe(500);
  });

  it('what can be worn is worn, because what stays in the vault does not ride into a drop', () => {
    born('u_worn', 'NOMAD', sheetOf('power_fantasy'));
    const kit = OriginBank.origin('power_fantasy')!.kits[0];
    const minted = CreationSystem.mintKit('u_worn', kit).map(i => i.id);
    const worn = player().equipment?.items.map(i => i.id) ?? [];
    expect(worn.some(id => minted.includes(id))).toBe(true);
    const inVault = stash().map(i => i.id);
    for (const id of minted) expect(worn.includes(id) || inVault.includes(id)).toBe(true);
    for (const id of minted) expect(worn.includes(id) && inVault.includes(id)).toBe(false);
  });
});

describe('D35: the skills come through the door, and pass the law', () => {
  const draft = draftOf('cooking');
  const ask: ICreationAsk = CreationSystem.ask(draft);
  const good = (): ICreationWords => ({
    line: 'The bank honors it. You will find the work where you left it.',
    skills: ask.candidates.slice(0, GRANTED_SKILLS).map((c, i) => ({ id: c.id, name: `Named ${i}`, flavor: 'It was in the hands first.', grants: [] }))
  });

  it('the floor stands with no door at all, and passes its own law', () => {
    const floor = CreationSystem.floor(draft);
    expect(CreationSystem.judge(floor, ask).ok).toBe(true);
    expect(floor.skills).toHaveLength(GRANTED_SKILLS);
    expect(floor.line.length).toBeGreaterThan(0);
  });

  it('the floor is keyed by the answers: the same answers grant the same, and others may not', () => {
    expect(CreationSystem.floor(draftOf('cooking', 0))).toEqual(CreationSystem.floor(draftOf('cooking', 0)));
    const seen = new Set<string>();
    for (let pick = 0; pick < 4; pick++) seen.add(JSON.stringify(CreationSystem.floor(draftOf('cooking', pick))));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('the first skills lean on what you focused on', () => {
    for (const o of OriginBank.origins()) {
      const d = draftOf(o.id);
      const floor = CreationSystem.floor(d);
      const lean = new Set([...o.leans.main, ...o.leans.sub]);
      const tags = floor.skills.slice(0, 2).flatMap(s => s.id.replace(/^skill_/, '').split('+'));
      expect(tags.some(t => lean.has(t)), o.id).toBe(true);
    }
  });

  it('three skills, all different, all ones the web can read', () => {
    const ids = CreationSystem.floor(draft).skills.map(s => s.id);
    expect(new Set(ids).size).toBe(GRANTED_SKILLS);
    const known = new Set(WebBank.connections(WebBank.current()).map(c => c.skillId));
    for (const id of ids) expect(known.has(id)).toBe(true);
  });

  it('the law takes a lawful answer', () => {
    expect(CreationSystem.judge(good(), ask).ok).toBe(true);
  });

  it('the law refuses it whole when it is broken', () => {
    const broken = (fn: (w: ICreationWords) => void) => { const w = good(); fn(w); return CreationSystem.judge(w, ask).ok; };
    expect(broken(w => { w.skills[0].id = 'skill_nobody+asked'; })).toBe(false);
    expect(broken(w => { w.skills[1].id = w.skills[0].id; })).toBe(false);
    expect(broken(w => { w.skills.pop(); })).toBe(false);
    expect(broken(w => { w.skills.push({ id: ask.candidates[GRANTED_SKILLS].id, name: 'n', flavor: 'f', grants: [] }); })).toBe(false);
    expect(broken(w => { w.skills[0].name = '  '; })).toBe(false);
    expect(broken(w => { w.skills[0].grants = ['fly']; })).toBe(false);
    expect(broken(w => { w.line = ''; })).toBe(false);
    expect(broken(w => { w.line = 'Your trope is settled.'; })).toBe(false);
    expect(CreationSystem.judge(null as any, ask).ok).toBe(false);
    expect(CreationSystem.judge({ line: 'x' } as any, ask).ok).toBe(false);
  });

  it('a grant the vocabulary holds stands, through the same reading as any other', () => {
    const w = good();
    w.skills[0].grants = ['rest'];
    expect(CreationSystem.judge(w, ask).ok).toBe(true);
    born('u_camp', 'NOMAD', CreationSystem.sheet(draft, w));
    expect(RestSystem.grantsFieldRest(player())).toBe(true);
  });

  it('what is granted lands as held skills, in their words', () => {
    const w = good();
    born('u_sk', 'NOMAD', CreationSystem.sheet(draft, w));
    for (const s of w.skills) {
      expect(player().bank.universalSkills[s.id]).toBeTruthy();
      expect(player().skillWords![s.id].name).toBe(s.name);
    }
  });

  it('the grant is signed: a row says what was granted and who wrote it', () => {
    const w = good();
    born('u_sign', 'NOMAD', { ...CreationSystem.sheet(draft, w), usage: { model: 'fake', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, usd: 0 } });
    const rows = CreationDoor.genesisRows(player(), { model: 'fake', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, usd: 0 });
    const row = rows.find(r => r.data.kind === 'CREATION_GRANTED')!;
    expect(row.type).toBe('TECH');
    expect(row.data.skills).toEqual(w.skills.map(s => s.id));
    expect(row.data.by).toBe('FLOOR');
    expect(rows.find(r => r.data.kind === 'INTELLIGENCE_USE')!.data.door).toBe('creation');
  });

  it('CreationDoor.seek gives the door\'s words when they pass, and the floor when they do not', async () => {
    const fake = (body: any) => vi.spyOn(IntelligenceClient, 'grantSkills').mockResolvedValue(body);
    const floor = CreationSystem.floor(draft);

    fake({ status: 'OK', data: good(), usage: { model: 'f', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, usd: 0 } });
    const ok = await CreationDoor.seek(draft);
    expect(ok.by).toBe('DOOR');
    expect(ok.words.skills[0].name).toBe('Named 0');

    const bad = good(); bad.skills[0].id = 'skill_nobody';
    fake({ status: 'OK', data: bad });
    const refused = await CreationDoor.seek(draft);
    expect(refused.by).toBe('FLOOR');
    expect(refused.words).toEqual(floor);

    for (const status of ['NO_KEY', 'OFFLINE', 'REFUSED', 'BUSY', 'OUTAGE', 'CUT_OFF']) {
      fake({ status });
      const out = await CreationDoor.seek(draft);
      expect(out.by).toBe('FLOOR');
      expect(out.words).toEqual(floor);
    }
    vi.restoreAllMocks();
  });

  it('nothing blocks on a model: a door that never answers falls to the floor in time', async () => {
    vi.spyOn(IntelligenceClient, 'grantSkills').mockReturnValue(new Promise(() => {}));
    const out = await CreationDoor.seek(draft, 5);
    expect(out.by).toBe('FLOOR');
    vi.restoreAllMocks();
  });

  it('with the network gone, the client answers with an outcome and never throws', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error('down'); }) as any;
    const out = await IntelligenceClient.grantSkills(ask);
    expect(out.status).toBe('OFFLINE');
    globalThis.fetch = original;
  });
});

describe('D35: the request, on the server, against a fake', () => {
  const ask: ICreationAsk = CreationSystem.ask(draftOf('cooking'));
  const answer = () => ({
    id: 'msg', stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0 },
    content: [{ type: 'text', text: JSON.stringify({ line: 'The bank honors it.', skills: [] }) }]
  });
  const fake = (message: any, seen?: (p: any) => void) => ({
    beta: { messages: { stream: (p: any) => { seen?.(p); return { finalMessage: async () => message }; } } },
    models: { retrieve: async () => ({}) }
  }) as any;

  it('no test here calls the API', () => {
    expect(SRC('tests/creation.test.ts')).not.toMatch(/new ClaudeProvider\(\)\s*\)/);
    expect(SRC('tests/creation.test.ts')).not.toMatch(/ANTHROPIC_API_KEY\s*=/);
  });

  it('it is its own kind, on Haiku, as Pedro asked: one constant', () => {
    expect(MODEL_FOR.creation).toBe('claude-haiku-5-5');
    expect(buildCreationRequest(ask).kind).toBe('creation');
    expect(SRC('server/intelligence/claude.ts')).toMatch(/creation: 'claude-haiku-5-5'/);
  });

  it('sends the schema and a low effort, without the fallback Haiku does not take; prices itself at Haiku', async () => {
    let params: any = {};
    const out = await new ClaudeProvider(fake(answer(), p => { params = p; })).ask(buildCreationRequest(ask));
    expect(out.status).toBe('OK');
    expect(params.model).toBe('claude-haiku-5-5');
    expect(params.output_config.format.type).toBe('json_schema');
    expect(params.output_config.format.schema).toBe(CREATION_SCHEMA);
    expect(params.output_config.effort).toBe('low');
    expect(params).not.toHaveProperty('fallbacks');
    expect(out.usage!.usd).toBeCloseTo((10 * 0.1 + 10 * 0.5) / 1_000_000, 10);
  });

  it('a refusal or a cut answer is an outcome', async () => {
    const provider = (m: any) => new ClaudeProvider(fake(m));
    expect((await provider({ ...answer(), stop_reason: 'refusal' }).ask(buildCreationRequest(ask))).status).toBe('REFUSED');
    expect((await provider({ ...answer(), stop_reason: 'max_tokens' }).ask(buildCreationRequest(ask))).status).toBe('CUT_OFF');
  });

  it('the system text is frozen, and what changes stays in the message', () => {
    const a = buildCreationRequest(ask);
    const b = buildCreationRequest(CreationSystem.ask(draftOf('slow_life')));
    expect(a.system).toBe(b.system);
    expect(a.messages[0].content).not.toBe(b.messages[0].content);
  });

  it('D36: the Seed speaks, in the terminal\'s voice, and the hidden words stay hidden', () => {
    const { system, messages } = buildCreationRequest(ask);
    expect(system).toMatch(/You are the Seed/);
    expect(system).toMatch(/terminal/);
    expect(messages[0].content).not.toMatch(/archetype|trope|isekai/i);
    expect(JSON.stringify(ask)).not.toMatch(/archetype|trope|isekai/i);
  });

  it('the schema leaves no extra keys, and offers only grants that exist', () => {
    expect(CREATION_SCHEMA.additionalProperties).toBe(false);
    expect(JSON.stringify(CREATION_SCHEMA)).toMatch(/"rest"/);
  });

  it('the handler answers on its own route, with no key as an outcome', async () => {
    const handler = createIntelligenceHandler(new IntelligenceDoor(new AbsentProvider('no key here')));
    const body = JSON.stringify({ ask });
    const req: any = {
      method: 'POST', socket: { remoteAddress: '127.0.0.1' },
      on(ev: string, fn: any) { if (ev === 'data') fn(Buffer.from(body)); if (ev === 'end') fn(); return req; }
    };
    let sent = '';
    const res: any = { setHeader() {}, end(t: string) { sent = t; }, statusCode: 0 };
    await handler(req, res, '/creation');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(sent).status).toBe('NO_KEY');
  });
});

// -----------------------------------------------------------------------------
// THE SCREENS
// -----------------------------------------------------------------------------

describe('the flow, one screen each, through the real components', () => {
  let host: HTMLDivElement;
  let root: Root;
  const minted: { name: string; sheet: any }[] = [];

  const mount = async (over: any = {}) => {
    await act(async () => {
      root.render(createElement(CreationFlow, { onMint: async (name: string, sheet: any) => { minted.push({ name, sheet }); }, creating: false, error: null, ...over }));
    });
  };
  const text = () => host.textContent ?? '';
  const button = (name: RegExp) => [...host.querySelectorAll('button')].find(b => name.test(b.textContent ?? '')) as HTMLButtonElement;
  const click = async (name: RegExp) => {
    const b = button(name);
    expect(b, `a button ${name}`).toBeTruthy();
    await act(async () => { b.click(); await Promise.resolve(); });
  };

  beforeEach(() => {
    localStorage.clear();
    useCreationDraft.getState().reset();
    minted.length = 0;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    vi.spyOn(IntelligenceClient, 'grantSkills').mockResolvedValue({ status: 'NO_KEY' } as any);
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    vi.restoreAllMocks();
  });

  /** Walk from the first screen to the last. Every click here is one a person makes. */
  const walk = async (originSays = /QUIET/) => {
    await mount();
    await click(originSays);
    await click(/^NEXT/);
    expect(text()).toMatch(/WHAT YOU CARRY/);
    await click(/^NEXT/);
    expect(text()).toMatch(/THE FACE OF THE WORLD/);
    await click(/^NEXT/);
    expect(text()).toMatch(/THE SEED/);
    for (const q of CreationSystem.questionsFor(useCreationDraft.getState().draft.originId)) {
      await click(new RegExp(q.answers[0].says.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    await click(/HEAR IT OUT|SAY NOTHING MORE/);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  };

  it('the first screen asks who you were, and has no name box yet', async () => {
    await mount();
    expect(text()).toMatch(/WHO YOU WERE/);
    expect(host.querySelector('input[type="text"], input:not([type])')).toBeNull();
  });

  it('the words stay unseen on every screen', async () => {
    await walk();
    expect(text()).not.toMatch(/archetype|trope|isekai|reincarnat/i);
    await click(/^BACK/);
    expect(text()).not.toMatch(/archetype|trope|isekai/i);
    for (const f of ['src/components/CreationFlow.tsx', 'src/components/IdentityGate.tsx']) {
      expect(SRC(f)).not.toMatch(/NEURAL ARCHETYPE/);
    }
  });

  it('choosing says so by shape, not by colour alone', async () => {
    await mount();
    await click(/QUIET/);
    const chosen = button(/QUIET/);
    expect(chosen.getAttribute('aria-pressed')).toBe('true');
    expect(chosen.textContent).toMatch(/\[X\]/);
    expect(button(/COOK/).textContent).toMatch(/\[ \]/);
  });

  it('cannot go on until a choice is made', async () => {
    await mount();
    expect(button(/^NEXT/).disabled).toBe(true);
  });

  it('the kit and the face come chosen, so someone who knows clicks straight through', async () => {
    await mount();
    await click(/QUIET/);
    await click(/^NEXT/);
    expect(button(/^NEXT/).disabled).toBe(false);
    await click(/^NEXT/);
    expect(button(/^NEXT/).disabled).toBe(false);
  });

  it('the face of the world shows a real map, drawn', async () => {
    await mount();
    await click(/QUIET/);
    await click(/^NEXT/);
    await click(/^NEXT/);
    expect(host.querySelector('img, canvas')).toBeTruthy();
    expect(SRC('src/components/CreationFlow.tsx')).toMatch(/cityMinimap/);
  });

  it('no key and no network still ends in skills, a name box and a mint', async () => {
    await walk();
    expect(text()).toMatch(/The Seed|bank/i);
    const skills = CreationSystem.floor(useCreationDraft.getState().draft as any).skills;
    for (const s of skills) expect(text()).toContain(s.name);
    const box = host.querySelector('input') as HTMLInputElement;
    expect(box).toBeTruthy();
  });

  it('the mint hands over the name and the sheet, once', async () => {
    await walk();
    const box = host.querySelector('input') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, 'KAEL');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(/MINT/);
    expect(minted).toHaveLength(1);
    expect(minted[0].name).toBe('KAEL');
    expect(minted[0].sheet.record.origin).toBe('slow_life');
    expect(minted[0].sheet.silhouette).toBeTruthy();
  });

  it('the door\'s words show when they come back lawful (a faked answer)', async () => {
    vi.spyOn(IntelligenceClient, 'grantSkills').mockImplementation(async (ask: ICreationAsk) => ({
      status: 'OK',
      data: {
        line: 'The bank honors it. Faked, for this bar.',
        skills: ask.candidates.slice(0, GRANTED_SKILLS).map((c, i) => ({ id: c.id, name: `Faked Skill ${i}`, flavor: 'A fake.', grants: [] }))
      }
    }) as any);
    await walk();
    expect(text()).toMatch(/Faked Skill 0/);
    expect(text()).toMatch(/Faked, for this bar/);
  });

  it('a draft survives a stray click: leaving and coming back keeps it (P2)', async () => {
    await mount();
    await click(/QUIET/);
    await click(/^NEXT/);
    await act(async () => { root.unmount(); });
    root = createRoot(host);
    await mount();
    expect(text()).toMatch(/WHAT YOU CARRY/);
    expect(useCreationDraft.getState().draft.originId).toBe('slow_life');
  });

  it('a draft survives a reload: it lives in this browser until the mint', async () => {
    await mount();
    await click(/QUIET/);
    expect(JSON.parse(localStorage.getItem(CREATION_DRAFT_KEY)!).originId).toBe('slow_life');
    useCreationDraft.setState({ draft: { ...CREATION_DRAFT_DEFAULTS } });
    useCreationDraft.getState().restore();
    expect(useCreationDraft.getState().draft.originId).toBe('slow_life');
  });

  it('starting over takes two presses, and a mint clears the draft', async () => {
    await mount();
    await click(/QUIET/);
    expect(SRC('src/components/CreationFlow.tsx')).toMatch(/ArmedButton/);
    expect(useCreationDraft.getState().draft.originId).toBe('slow_life');
    useCreationDraft.getState().reset();
    expect(localStorage.getItem(CREATION_DRAFT_KEY)).toBeNull();
    expect(SRC('src/components/IdentityGate.tsx')).toMatch(/useCreationDraft\.getState\(\)\.reset\(\)/);
  });

  it('the review before the mint says what was chosen, and nothing chooses the face', async () => {
    await walk();
    expect(text()).toMatch(/MAIN FOCUS/);
    expect(text()).toMatch(/SUB FOCUS/);
    const flow = SRC('src/components/CreationFlow.tsx');
    expect(flow).not.toMatch(/PortraitView/);
    expect(SRC('src/components/IdentityGate.tsx')).toMatch(/Nobody chose it/);
  });
});

// -----------------------------------------------------------------------------
// THE FIFTH: Pedro, "right now we have 4 hardcoded classes, we're adding a 5th one, fate
// gambler, that one calls up a stream style conversation with sonnet and you talk with kami
// itself, he'll set up the class"
// -----------------------------------------------------------------------------

describe('the fifth class: fate gambler', () => {
  const said = [{ role: 'assistant' as const, content: 'Sit. What will you stake.' }, { role: 'user' as const, content: 'Whatever I have left.' }];
  const ask: IKamiAsk = CreationSystem.kamiAsk();
  const good = (): IKamiWords => ({
    name: 'The Last Stake',
    line: 'It is set. Do not thank me.',
    main: 'perception',
    sub: 'subterfuge',
    kit: OriginBank.origin('cooking')!.kits[0],
    skills: ask.candidates.slice(0, GRANTED_SKILLS).map((c, i) => ({ id: c.id, name: `Dealt ${i}`, flavor: 'It came up.', grants: [] }))
  });
  const draft = { ...draftOf('cooking'), originId: '', kitId: '', silhouette: FATE_GAMBLER, answers: {} };

  it('is its own figure, in its own shape, and the old four keep theirs', () => {
    expect(ARCHETYPE_IDS).toContain(FATE_GAMBLER);
    expect(ARCHETYPE_IDS.slice(0, 4)).toEqual(['OPERATOR', 'STREET_SAMURAI', 'NOMAD', 'ARCANIST']);
    const mine = figure({ uid: 'u_f', archetype: FATE_GAMBLER as any }).data;
    expect(mine.some(v => v > 0)).toBe(true);
    expect(portrait({ uid: 'u_f', archetype: FATE_GAMBLER as any }).data.some(v => v > 0)).toBe(true);
    // The old stat table is for old births. Nobody writes this class's numbers there.
    expect(Object.keys(ARCHETYPES)).not.toContain(FATE_GAMBLER);
  });

  it('D35 holds: with no model at all, fate deals the whole class, and it passes the same law', () => {
    const floor = CreationSystem.fateFloor(said);
    expect(CreationSystem.judgeKami(floor, ask).ok).toBe(true);
    expect(floor.main).not.toBe(floor.sub);
  });

  it('the deal is keyed by what was said: the same words deal the same, and others may not', () => {
    expect(CreationSystem.fateFloor(said)).toEqual(CreationSystem.fateFloor(said));
    const seen = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map(w => JSON.stringify(CreationSystem.fateFloor([{ role: 'user', content: w }]))));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('the law takes a lawful class, and refuses a broken one whole', () => {
    expect(CreationSystem.judgeKami(good(), ask).ok).toBe(true);
    const broken = (fn: (w: IKamiWords) => void) => { const w = good(); fn(w); return CreationSystem.judgeKami(w, ask).ok; };
    expect(broken(w => { w.main = 'luck'; })).toBe(false);
    expect(broken(w => { w.sub = w.main; })).toBe(false);
    expect(broken(w => { w.kit = 'a_kit_of_his_own'; })).toBe(false);
    expect(broken(w => { w.name = ' '; })).toBe(false);
    expect(broken(w => { w.name = 'Your Trope'; })).toBe(false);
    expect(broken(w => { w.line = ''; })).toBe(false);
    expect(broken(w => { w.skills[0].id = 'skill_nobody+asked'; })).toBe(false);
    expect(broken(w => { w.skills.pop(); })).toBe(false);
    expect(broken(w => { w.skills[0].grants = ['fly']; })).toBe(false);
    expect(CreationSystem.judgeKami(null as any, ask).ok).toBe(false);
  });

  it('what he set up is what the character is: the focus shapes the deal, the kit is real, the skills are held', () => {
    const w = good();
    born('u_fate', FATE_GAMBLER, CreationSystem.kamiSheet(draft, w, 'DOOR'));
    expect(player().archetype).toBe(FATE_GAMBLER);
    expect(player().creation!.origin).toBe(FATE_ORIGIN);
    expect(player().creation!.className).toBe('The Last Stake');
    const stats = player().baseAttributes as any;
    const sorted = ALL_ATTRS.map(k => stats[k]).sort((a, b) => b - a);
    expect(stats.perception).toBe(sorted[0]);
    expect(stats.subterfuge).toBe(sorted[1]);
    const total = ALL_ATTRS.reduce((n, k) => n + stats[k], 0);
    expect(total).toBe(ALL_ATTRS.reduce((n, k) => n + (NpcSheet.read('u_fate', { id: 'u_fate', rank: 'F' as any }, undefined).stats as any)[k], 0));
    for (const s of w.skills) expect(player().bank.universalSkills[s.id]).toBeTruthy();
    expect(deeds()).toHaveLength(1);
    const held = [...stash(), ...(player().equipment?.items ?? [])].map(i => i.universalDefinitionId);
    for (const piece of CreationSystem.kitPreview(w.kit)) expect(held).toContain(piece.definitionId);
    expect(player().bank.gold).toBe(500);
  });

  it('a record from before the class still reads its focus from the bank', () => {
    born('u_plain_focus', 'NOMAD', sheetOf('cooking'));
    const focus = CreationSystem.focusOfRecord(player().creation!, 'u_plain_focus');
    expect(focus.main).toBe(OriginBank.origin('cooking')!.main);
  });

  it('it is signed, with what was spent, as one row of usage', () => {
    const usage = { model: 'claude-sonnet-5-5', inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, usd: 0.1 };
    born('u_fate_rows', FATE_GAMBLER, CreationSystem.kamiSheet(draft, good(), 'DOOR', usage));
    const rows = CreationDoor.genesisRows(player(), usage);
    const granted = rows.find(r => r.data.kind === 'CREATION_GRANTED')!;
    expect(granted.data.by).toBe('DOOR');
    expect(granted.data.className).toBe('The Last Stake');
    expect(rows.find(r => r.data.kind === 'KIT_GRANTED')!.data.playerDelta).toBe(0);
    expect(rows.find(r => r.data.kind === 'INTELLIGENCE_USE')!.data.model).toBe('claude-sonnet-5-5');
  });

  it('the door\'s class stands when it passes, and fate deals when it does not (a faked answer)', async () => {
    const fake = (body: any) => vi.spyOn(IntelligenceClient, 'setKami').mockResolvedValue(body);
    fake({ status: 'OK', data: good() });
    const ok = await CreationDoor.seekKami(said);
    expect(ok.by).toBe('DOOR');
    expect(ok.words.name).toBe('The Last Stake');

    const bad = good(); bad.kit = 'nothing';
    fake({ status: 'OK', data: bad });
    const refused = await CreationDoor.seekKami(said);
    expect(refused.by).toBe('FLOOR');
    expect(refused.words).toEqual(CreationSystem.fateFloor(said));

    for (const status of ['NO_KEY', 'OFFLINE', 'REFUSED', 'BUSY', 'OUTAGE', 'CUT_OFF']) {
      fake({ status });
      expect((await CreationDoor.seekKami(said)).by).toBe('FLOOR');
    }
    vi.spyOn(IntelligenceClient, 'setKami').mockReturnValue(new Promise(() => {}));
    expect((await CreationDoor.seekKami(said, 5)).by).toBe('FLOOR');
    vi.restoreAllMocks();
  });

  it('nothing here lets a model write a number', () => {
    expect(JSON.stringify(KAMI_SCHEMA)).not.toMatch(/"(number|integer)"/);
    expect(JSON.stringify(KAMI_SCHEMA)).toMatch(/"perception"/);
  });
});

describe('the fifth class: the stream, through the one door, against a fake', () => {
  const talkMessage = (over: any = {}) => ({
    id: 'msg', stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0 },
    content: [{ type: 'text', text: 'Sit down.' }], ...over
  });
  const fakeStream = (chunks: string[], message: any, seen?: (p: any, o: any) => void) => ({
    beta: { messages: { stream: (p: any, o: any) => {
      seen?.(p, o);
      return {
        async *[Symbol.asyncIterator]() {
          for (const text of chunks) yield { type: 'content_block_delta', delta: { type: 'text_delta', text } };
        },
        finalMessage: async () => message
      };
    } } },
    models: { retrieve: async () => ({}) }
  }) as any;

  it('no test here reaches a model', () => {
    expect(SRC('tests/creation.test.ts')).not.toMatch(/new ClaudeProvider\(\)\s*\./);
  });

  it('both kinds are Sonnet, as Pedro asked: one constant each', () => {
    expect(MODEL_FOR.kami_talk).toBe('claude-sonnet-5-5');
    expect(MODEL_FOR.kami_set).toBe('claude-sonnet-5-5');
  });

  it('text arrives as it is written, and the outcome carries the usage at Sonnet\'s rates', async () => {
    let params: any = {};
    const got: string[] = [];
    const out = await new ClaudeProvider(fakeStream(['Sit ', 'down.'], talkMessage(), p => { params = p; }))
      .askStream(buildKamiTalkRequest([]), t => got.push(t));
    expect(got).toEqual(['Sit ', 'down.']);
    expect(out.status).toBe('OK');
    expect(params.model).toBe('claude-sonnet-5-5');
    expect(params.output_config.effort).toBe('low');
    expect(params.fallbacks).toBe('default');
    expect(out.usage!.usd).toBeCloseTo((100 * 2 + 50 * 10) / 1_000_000, 10);
  });

  it('a refusal partway is an outcome, and a thrown stream is too', async () => {
    const refused = await new ClaudeProvider(fakeStream(['Si'], talkMessage({ stop_reason: 'refusal' }))).askStream(buildKamiTalkRequest([]), () => {});
    expect(refused.status).toBe('REFUSED');
    const throwing = { beta: { messages: { stream: () => { throw new Error('no api key'); } } } } as any;
    expect((await new ClaudeProvider(throwing).askStream(buildKamiTalkRequest([]), () => {})).status).toBe('NO_KEY');
  });

  it('a provider that cannot stream still answers, all at once', async () => {
    const door = new IntelligenceDoor({
      name: 'plain', status: async () => ({ available: true, provider: 'plain' }),
      ask: async () => ({ status: 'OK', text: 'All at once.' }),
      file: async () => ({ status: 'NO_KEY' as const }), collect: async () => ({ status: 'NO_KEY' as const }), ceiling: () => 0
    });
    const got: string[] = [];
    const out = await door.askStream(buildKamiTalkRequest([]), t => got.push(t));
    expect(got).toEqual(['All at once.']);
    expect(out.status).toBe('OK');
  });

  it('a conversation always opens on the person arriving, so Kami can speak first', () => {
    expect(buildKamiTalkRequest([]).messages[0].role).toBe('user');
    expect(buildKamiTalkRequest([{ role: 'assistant', content: 'Sit.' }]).messages[0].role).toBe('user');
  });

  it('he is Kami, in the terminal, and the frozen part stays frozen', () => {
    const a = buildKamiTalkRequest([]);
    const b = buildKamiTalkRequest([{ role: 'user', content: 'x' }]);
    expect(a.system).toBe(b.system);
    expect(a.system).toMatch(/Kami/);
    expect(a.system).toMatch(/terminal/);
    expect(a.system).toMatch(/fate/i);
    const set = buildKamiSetRequest([{ role: 'user', content: 'x' }], CreationSystem.kamiAsk());
    expect(set.kind).toBe('kami_set');
    expect(set.schema).toBe(KAMI_SCHEMA);
    expect(set.messages[0].content).toMatch(/x/);
  });

  const request = (body: unknown) => {
    const text = JSON.stringify(body);
    const req: any = {
      method: 'POST', socket: { remoteAddress: '127.0.0.1' },
      on(ev: string, fn: any) { if (ev === 'data') fn(Buffer.from(text)); if (ev === 'end') fn(); return req; }
    };
    return req;
  };

  it('the handler sends lines as they come, then how it ended', async () => {
    const handler = createIntelligenceHandler(new IntelligenceDoor(new ClaudeProvider(fakeStream(['Sit ', 'down.'], talkMessage()))));
    const lines: string[] = [];
    const res: any = { setHeader() {}, on() {}, write(t: string) { lines.push(t); return true; }, end(t: string) { lines.push(t); }, statusCode: 0 };
    await handler(request({ messages: [] }), res, '/kami/talk');
    const parsed = lines.join('').trim().split('\n').map(l => JSON.parse(l));
    expect(parsed.slice(0, 2)).toEqual([{ text: 'Sit ' }, { text: 'down.' }]);
    expect(parsed[2].done).toBe(true);
    expect(parsed[2].status).toBe('OK');
    expect(parsed[2].usage.model).toBe('claude-sonnet-5-5');
  });

  it('over a real socket, the pieces arrive apart, before the answer is finished', async () => {
    const { createServer } = await import('node:http');
    let release: () => void = () => {};
    const gate = new Promise<void>(r => { release = r; });
    const client = {
      beta: { messages: { stream: () => ({
        async *[Symbol.asyncIterator]() {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Sit ' } };
          await gate; // nothing more until the first piece has been seen on the other side
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'down.' } };
        },
        finalMessage: async () => talkMessage()
      }) } },
      models: { retrieve: async () => ({}) }
    } as any;
    const handler = createIntelligenceHandler(new IntelligenceDoor(new ClaudeProvider(client)));
    const server = createServer((req, res) => { void handler(req, res, '/kami/talk'); });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as { port: number };
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST', body: JSON.stringify({ messages: [] }) });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      const first = decoder.decode((await reader.read()).value);
      expect(JSON.parse(first.trim())).toEqual({ text: 'Sit ' });
      release();
      let rest = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        rest += decoder.decode(value);
      }
      const lines = rest.trim().split('\n').map(l => JSON.parse(l));
      expect(lines[0]).toEqual({ text: 'down.' });
      expect(lines[1].status).toBe('OK');
    } finally {
      await new Promise(r => server.close(r));
    }
  });

  it('no key is an outcome on the stream too', async () => {
    const handler = createIntelligenceHandler(new IntelligenceDoor(new AbsentProvider('no key here')));
    const lines: string[] = [];
    const res: any = { setHeader() {}, on() {}, write(t: string) { lines.push(t); return true; }, end(t: string) { lines.push(t); }, statusCode: 0 };
    await handler(request({ messages: [] }), res, '/kami/talk');
    expect(JSON.parse(lines.join('').trim()).status).toBe('NO_KEY');
  });

  it('the browser reads the lines as they arrive, and a dropped network is an outcome', async () => {
    const encoder = new TextEncoder();
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(new ReadableStream({
      start(c) {
        // A line split across two chunks must still read as one
        c.enqueue(encoder.encode('{"text":"Sit "}\n{"te'));
        c.enqueue(encoder.encode('xt":"down."}\n{"done":true,"status":"OK"}\n'));
        c.close();
      }
    }))) as any;
    const got: string[] = [];
    const out = await IntelligenceClient.talkKami([], t => got.push(t));
    expect(got).toEqual(['Sit ', 'down.']);
    expect(out.status).toBe('OK');

    globalThis.fetch = (async () => { throw new Error('down'); }) as any;
    expect((await IntelligenceClient.talkKami([], () => {})).status).toBe('OFFLINE');

    // A stream that stops with no ending line did not finish
    globalThis.fetch = (async () => new Response('{"text":"Si"}\n')) as any;
    expect((await IntelligenceClient.talkKami([], () => {})).status).toBe('OUTAGE');
    globalThis.fetch = original;
  });
});

describe('the fifth class: the screens', () => {
  let host: HTMLDivElement;
  let root: Root;
  const minted: { name: string; sheet: any }[] = [];
  const text = () => host.textContent ?? '';
  const button = (name: RegExp) => [...host.querySelectorAll('button')].find(b => name.test(b.textContent ?? '')) as HTMLButtonElement;
  const click = async (name: RegExp) => {
    const b = button(name);
    expect(b, `a button ${name}`).toBeTruthy();
    await act(async () => { b.click(); await new Promise(r => setTimeout(r, 0)); });
  };
  const type = async (el: HTMLInputElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const mount = async () => {
    await act(async () => {
      root.render(createElement(CreationFlow, { onMint: async (name: string, sheet: any) => { minted.push({ name, sheet }); }, creating: false, error: null }));
      await new Promise(r => setTimeout(r, 0));
    });
  };
  const lawful = (ask: IKamiAsk) => ({
    status: 'OK',
    data: {
      name: 'Faked Stake', line: 'It is set. Faked, for this bar.', main: 'perception', sub: 'focus', kit: ask.kits[0].id,
      skills: ask.candidates.slice(0, GRANTED_SKILLS).map((c, i) => ({ id: c.id, name: `Dealt Hand ${i}`, flavor: 'Faked.', grants: [] }))
    },
    usage: { model: 'claude-sonnet-5-5', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, usd: 0.01 }
  });

  beforeEach(() => {
    localStorage.clear();
    useCreationDraft.getState().reset();
    minted.length = 0;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    vi.restoreAllMocks();
  });

  const toKami = async () => {
    await mount();
    await click(/FATE GAMBLER/);
    await click(/^NEXT/);
    expect(text()).toMatch(/THE FACE OF THE WORLD/);
    await click(/^NEXT/);
  };

  it('a person can pick it with no life chosen, and it skips what Kami will set', async () => {
    await mount();
    expect(button(/FATE GAMBLER/)).toBeTruthy();
    expect(button(/^NEXT/).disabled).toBe(true);
    await click(/FATE GAMBLER/);
    expect(button(/FATE GAMBLER/).textContent).toMatch(/\[X\]/);
    expect(button(/^NEXT/).disabled).toBe(false);
    await click(/^NEXT/);
    expect(text()).not.toMatch(/WHAT YOU CARRY\b.*charges nothing/);
    expect(text()).toMatch(/WHERE YOU ARRIVE/);
    await click(/^BACK/);
    expect(text()).toMatch(/Before this/);
  });

  it('picking a life afterwards takes the choice back', async () => {
    await mount();
    await click(/FATE GAMBLER/);
    await click(/QUIET/);
    expect(useCreationDraft.getState().draft.silhouette).not.toBe(FATE_GAMBLER);
    expect(button(/FATE GAMBLER/).textContent).toMatch(/\[ \]/);
  });

  it('with a door, he speaks first, in pieces, and the transcript keeps what was said', async () => {
    vi.spyOn(IntelligenceClient, 'status').mockResolvedValue({ available: true });
    let resolve: (o: any) => void = () => {};
    let speak: (t: string) => void = () => {};
    vi.spyOn(IntelligenceClient, 'talkKami').mockImplementation((_m: any, onText: any) => {
      speak = onText;
      return new Promise(r => { resolve = r; });
    });
    await toKami();
    expect(text()).toMatch(/KAMI/);
    await act(async () => { speak('Sit '); });
    expect(text()).toMatch(/Sit/);
    await act(async () => { speak('down.'); });
    expect(text()).toMatch(/Sit down\./);
    await act(async () => { resolve({ status: 'OK', usage: { model: 'claude-sonnet-5-5', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, usd: 0.01 } }); await Promise.resolve(); });
    expect(useCreationDraft.getState().draft.kami).toEqual([{ role: 'assistant', content: 'Sit down.' }]);
    expect((useCreationDraft.getState().draft.kamiUsage as any).usd).toBeCloseTo(0.01, 5);
  });

  it('what the person says goes to him, whole, and he answers it', async () => {
    vi.spyOn(IntelligenceClient, 'status').mockResolvedValue({ available: true });
    const talk = vi.spyOn(IntelligenceClient, 'talkKami').mockImplementation(async (_m: any, onText: any) => { onText('Answered.'); return { status: 'OK' } as any; });
    await toKami();
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    await type(host.querySelector('input[aria-label="Say something to Kami"]') as HTMLInputElement, 'I stake it all');
    await click(/^SAY$/);
    const last = talk.mock.calls[talk.mock.calls.length - 1][0] as any[];
    expect(last[last.length - 1]).toEqual({ role: 'user', content: 'I stake it all' });
    expect(useCreationDraft.getState().draft.kami.map((m: any) => m.role)).toEqual(['assistant', 'user', 'assistant']);
  });

  it('a draft survives leaving mid-conversation', async () => {
    vi.spyOn(IntelligenceClient, 'status').mockResolvedValue({ available: true });
    const talk = vi.spyOn(IntelligenceClient, 'talkKami').mockImplementation(async (_m: any, onText: any) => { onText('Sit.'); return { status: 'OK' } as any; });
    await toKami();
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    const calls = talk.mock.calls.length;
    await act(async () => { root.unmount(); });
    root = createRoot(host);
    await mount();
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(text()).toMatch(/Sit\./);
    // He does not open twice, and nobody pays twice
    expect(talk.mock.calls.length).toBe(calls);
    expect(JSON.parse(localStorage.getItem(CREATION_DRAFT_KEY)!).kami).toHaveLength(1);
  });

  it('he sets up the class (a faked answer), it is shown, and the mint hands it over', async () => {
    vi.spyOn(IntelligenceClient, 'status').mockResolvedValue({ available: true });
    vi.spyOn(IntelligenceClient, 'talkKami').mockImplementation(async (_m: any, onText: any) => { onText('Sit.'); return { status: 'OK', usage: { model: 'claude-sonnet-5-5', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, usd: 0.02 } } as any; });
    vi.spyOn(IntelligenceClient, 'setKami').mockImplementation(async (_m: any, ask: any) => lawful(ask) as any);
    await toKami();
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    await click(/LET HIM SET IT/);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(text()).toMatch(/FAKED STAKE/);
    expect(text()).toMatch(/Dealt Hand 0/);
    expect(text()).toMatch(/MAIN FOCUS.*PERCEPTION/);
    await type(host.querySelector('input') as HTMLInputElement, 'DICE');
    await click(/MINT/);
    expect(minted).toHaveLength(1);
    expect(minted[0].sheet.silhouette).toBe(FATE_GAMBLER);
    expect(minted[0].sheet.record.className).toBe('Faked Stake');
    expect(minted[0].sheet.record.by).toBe('DOOR');
    // What the talk and the setting cost, together
    expect(minted[0].sheet.usage.usd).toBeCloseTo(0.03, 5);
  });

  it('with no key, nothing blocks: he does not answer, and fate deals', async () => {
    vi.spyOn(IntelligenceClient, 'status').mockResolvedValue({ available: false });
    const talk = vi.spyOn(IntelligenceClient, 'talkKami');
    vi.spyOn(IntelligenceClient, 'setKami').mockResolvedValue({ status: 'NO_KEY' } as any);
    await toKami();
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(talk).not.toHaveBeenCalled();
    expect(text()).toMatch(/does not answer/i);
    await click(/THROW IT/);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(useCreationDraft.getState().draft.grant?.by).toBe('FLOOR');
    expect(host.querySelector('input')).toBeTruthy();
    expect(text()).toMatch(/MAIN FOCUS/);
  });

  it('a person is never held by a stream: they can move on while he is speaking', async () => {
    vi.spyOn(IntelligenceClient, 'status').mockResolvedValue({ available: true });
    vi.spyOn(IntelligenceClient, 'talkKami').mockReturnValue(new Promise(() => {}));
    vi.spyOn(IntelligenceClient, 'setKami').mockResolvedValue({ status: 'NO_KEY' } as any);
    await toKami();
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(button(/LET HIM SET IT/).disabled).toBe(false);
    await click(/LET HIM SET IT/);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(useCreationDraft.getState().draft.step).toBe(4);
  });

  it('the hidden words stay hidden here too', async () => {
    vi.spyOn(IntelligenceClient, 'status').mockResolvedValue({ available: false });
    await toKami();
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(text()).not.toMatch(/archetype|trope|isekai|reincarnat/i);
  });
});

describe('the mint window', () => {
  it('names the deed it will spend, and says where to find one when none is held', () => {
    const creator = SRC('src/components/WorldCreator.tsx');
    expect(creator).toMatch(/WorldDeed\.held/);
    expect(creator).toMatch(/no deed/i);
  });

  it('keeps the sky at the mint', () => {
    expect(SRC('src/components/WorldCreator.tsx')).toMatch(/SKY/);
  });

  it('the world the Seed spoke of comes chosen', () => {
    expect(SRC('src/components/WorldCreator.tsx')).toMatch(/creation\?\.themeId/);
  });
});

describe('the rest of the game reads a creation sheet\'s character as any other', () => {
  it('a character born here saves as plain data', () => {
    born('u_plain', 'NOMAD', sheetOf());
    const round = JSON.parse(JSON.stringify(player()));
    expect(round.creation.origin).toBe('slow_life');
    expect(round.bank.stashTabs[0].items.filter(isWorldDeed)).toHaveLength(1);
  });

  it('WorldCertificateSystem stands as it was for what needs no deed', async () => {
    useIdentityStore.setState({ certificate: CERT('u_hub') } as any);
    const hub = await WorldCertificateSystem.mintWorld(CERT('u_hub'), 'H', 'd', WorldType.HUB, 50, {});
    expect(hub).toBeTruthy();
    expect(hub!.data.rules.mintedWithDeed).toBeUndefined();
  });
});
