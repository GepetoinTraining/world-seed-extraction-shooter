/**
 * PEDRO'S ANSWERS AFTER HIS OWN RUN (2026-11-10), in his words:
 *
 *   On lore: "The note isn't spent, that needs to be spent because if it isn't there's no reason not
 *     to sell them"
 *   On an empty hand: "nope, you should throw it, but you should have -1 (if you have 7x then 6)"
 *   On the inn: "10 beds?"
 *   On affixes: "but I rested a lot, when does the hub rest?"
 *
 * Registered before the build. No test calls a model.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

const db = new Map<string, any>();
vi.mock('../shared/entities/data/VectorStore', () => ({
  VectorNamespace: { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories' },
  VectorStore: {
    get: async (_ns: string, id: string) => db.get(id) ?? null,
    put: async (doc: any) => { db.set(doc.id, JSON.parse(JSON.stringify(doc))); return true; },
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

import { IItem, ItemType, Rarity, UniversalRank } from '../shared/types';
import { RESOURCE_DEFINITIONS } from '../shared/entities/item/data/resourceDefinitions';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { Rng } from '../shared/logic/rng/DeterministicRNG';
import { installShippedThemes } from '../shared/logic/theme/boot';
import { ProcessSystem } from '../shared/logic/systems/ProcessSystem';
import { SHELF_STATE } from '../shared/logic/theme/shelf';
import { usePlayerStore, playerPort } from '../src/entities/player/store';
import { useWorldStore } from '../src/entities/world/store';
import { hubPort } from '../src/entities/hub/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { LORE_NOTE_PAY } from '../shared/logic/systems/LoreConstants';
import { Escort } from '../src/logic/systems/Escort';
import { FieldEscort } from '../src/logic/systems/FieldEscort';
import { throwsLeft } from '../src/logic/systems/FieldInput';
import { StudyDoor } from '../src/logic/systems/StudyDoor';
import { StudySystem } from '../src/logic/systems/StudySystem';
import { Tutorial, TUTORIAL_WORLD_ID } from '../src/logic/systems/Tutorial';
import { useFeed } from '../src/components/ui/stores';

installShippedThemes();

const SRC = (p: string) => readFileSync(p, 'utf8');
const UID = 'uid_answers';
const CERT = (uid: string, name: string) => ({
  metadata: { uid, displayName: name, createdAt: 0 }, publicKey: {} as any, publicKeyJWK: {} as any
}) as any;

const player = () => usePlayerStore.getState().player;
const stash = () => player().bank.stashTabs[0].items;
const fed = () => useFeed.getState().lines.map(l => l.text).join(' | ');
const inVault = (...items: IItem[]) => usePlayerStore.setState(s => ({
  player: { ...s.player, currentSession: undefined, bank: { ...s.player.bank, stashTabs: [{ ...s.player.bank.stashTabs[0], items }] } }
}));

const written = (form: string) => Object.values(RESOURCE_DEFINITIONS).find(d => d.harvestConfig && (d as any).visuals?.modelId === form)! as any;
const mint = (def: any, key: string): IItem => ItemFactory.createResourceItem(def, Rng.fromKey(key));
const tradeNote = (key = 'n1'): IItem => ProcessSystem.tradeNote('carpentry' as any, Rng.fromKey(key));
/** A fragment out of a chest: a document that names no trade. */
const fragment = (id = 'frag_1'): IItem => ({
  ...mint({ id: 'lore_fragment', name: 'Lore Fragment', icon: 'x', weight: 0.1, dimensions: { width: 1, height: 1 } }, id),
  id, type: ItemType.LORE, description: 'Maintenance log: the branch is still open.', value: 50, tags: ['lore', 'document']
});

beforeEach(() => {
  db.clear();
  localStorage.clear();
  useFeed.setState({ lines: [] });
  StudyDoor.reset();
  SHELF_STATE.magicUnlocked = false;
  useIdentityStore.setState({ certificate: CERT(UID, 'PEDRO') } as any);
  usePlayerStore.getState().initializeSession(CERT(UID, 'PEDRO'), 'NOMAD');
});

afterEach(() => {
  vi.restoreAllMocks();
  SHELF_STATE.magicUnlocked = false;
});

// -----------------------------------------------------------------------------
// A NOTE IS SPENT BY WHAT IT GIVES
// -----------------------------------------------------------------------------

describe('a note is spent when it is read, so it cannot be read and then sold', () => {
  it('a trade note read gives what it gave before, and is gone from the vault', () => {
    const note = tradeNote();
    inVault(note);
    const before = player().bank.loreHeld ?? 0;
    expect(usePlayerStore.getState().readLore(note.id)).toEqual({ ok: true });
    expect(player().bank.loreHeld).toBe(before + LORE_NOTE_PAY);
    expect(player().bank.lore[ProcessSystem.noteTopic('carpentry')]).toBeDefined();
    expect(stash().some(i => i.id === note.id)).toBe(false);
    expect(fed()).toMatch(/spent/i);
  });

  it('a note that is refused is kept: one already read, or one that names no trade', () => {
    const [first, second] = [tradeNote('a'), tradeNote('b')];
    inVault(first, second, fragment());
    usePlayerStore.getState().readLore(first.id);
    expect(usePlayerStore.getState().readLore(second.id).ok).toBe(false);
    expect(usePlayerStore.getState().readLore('frag_1').ok).toBe(false);
    expect(stash().map(i => i.id).sort()).toEqual([second.id, 'frag_1'].sort());
  });

  it('sitting with a document until it pays spends it too', async () => {
    const doc = fragment();
    inVault(doc);
    vi.spyOn(StudySystem, 'rollSitting').mockReturnValue({ d20: 15, total: 15, dc: 8, outcome: 'success' });
    expect(StudyDoor.begin(StudySystem.targetOfItem(doc), playerPort, hubPort).ok).toBe(true);
    expect((await StudyDoor.finish(playerPort, hubPort)).outcome).toBe('success');
    expect(stash().some(i => i.id === doc.id)).toBe(false);
    // What it gave is still on the log for a dream to resolve
    expect(player().restQueue!.sittings).toHaveLength(1);
    expect(fed()).toMatch(/spent/i);
  });

  it('a sitting that fails leaves the document, the worse for it, as any piece', async () => {
    const doc = fragment();
    inVault(doc);
    vi.spyOn(StudySystem, 'rollSitting').mockReturnValue({ d20: 3, total: 3, dc: 8, outcome: 'failure' });
    StudyDoor.begin(StudySystem.targetOfItem(doc), playerPort, hubPort);
    await StudyDoor.finish(playerPort, hubPort);
    expect(stash().some(i => i.id === doc.id)).toBe(true);
  });

  it('nothing but a document is spent by a sitting: a material stays, and a person on paper is never one', async () => {
    const oak = mint(written('tree'), 'oak');
    inVault(oak);
    vi.spyOn(StudySystem, 'rollSitting').mockReturnValue({ d20: 15, total: 15, dc: 8, outcome: 'success' });
    StudyDoor.begin(StudySystem.targetOfItem(oak), playerPort, hubPort);
    await StudyDoor.finish(playerPort, hubPort);
    expect(stash().some(i => i.id === oak.id)).toBe(true);

    const bond = Escort.bondOf({ worldSeed: 's', entityId: 'e', rank: UniversalRank.E, rarity: Rarity.COMMON, sheet: { name: 'Mara Quill', temperament: 'PASSIVE', objective: 'SURVIVE', want: 'GIFT', disposition: 60, attempts: 0 } } as any, 'bond_e', false);
    expect(bond.type).toBe(ItemType.LORE);
    expect(StudySystem.isDocument(bond)).toBe(false);
    expect(StudySystem.isDocument(fragment())).toBe(true);
    expect(StudySystem.isDocument(tradeNote())).toBe(true);
    expect(StudySystem.isDocument(oak)).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// WHOEVER WAITED ON A BED IS TRIED AGAIN
// -----------------------------------------------------------------------------

describe('someone who found the tavern full is tried again at the next arrival', () => {
  const bond = (name: string, entityId: string): IItem => Escort.bondOf(
    { worldSeed: 'seed_wait', entityId, rank: UniversalRank.E, rarity: Rarity.COMMON, sheet: { name, temperament: 'PASSIVE', objective: 'SURVIVE', want: 'GIFT', disposition: 60, attempts: 0 } } as any, `bond_${entityId}`, false);

  it('still no bed is not news: nothing is said', async () => {
    const out = await FieldEscort.lodgeArrivals([bond('Io Null', 'w1')], async () => ({ ok: false, reason: 'The Rusty Anchor is full: 10 of 10 beds.' }), true);
    expect(out.waiting).toEqual(['Io Null']);
    expect(fed()).toBe('');
  });

  it('a bed that has freed is taken, and that is said', async () => {
    const out = await FieldEscort.lodgeArrivals([bond('Io Null', 'w1')], async () => ({ ok: true }), true);
    expect(out.lodged).toEqual(['Io Null']);
    expect(fed()).toMatch(/Io Null has a bed at the Rusty Anchor/);
  });

  it('the field asks for them after the people of this run', () => {
    const field = SRC('src/components/WorldCanvas.tsx');
    const first = field.indexOf('FieldEscort.lodgeArrivals(haul');
    const again = field.indexOf('FieldEscort.lodgeArrivals(waited');
    expect(first).toBeGreaterThan(0);
    expect(again).toBeGreaterThan(first);
  });
});

// -----------------------------------------------------------------------------
// THE HAND THAT WILL THROW SAYS HOW MANY IT HAS
// -----------------------------------------------------------------------------

describe('"if you have 7x then 6": the hand that will throw shows the count, and each throw takes one off', () => {
  const stones = (n: number) => Array.from({ length: n }, (_, i) => mint(written('pebble'), `s${i}`));

  it('an empty hand that fires counts every stone carried, and nothing when none is', () => {
    expect(throwsLeft(undefined, stones(7), true)).toBe(7);
    expect(throwsLeft(undefined, [], true)).toBeUndefined();
    expect(throwsLeft(undefined, [mint(written('tree'), 'oak')], true)).toBeUndefined();
  });

  it('an empty hand that is not the one firing counts nothing', () => {
    expect(throwsLeft(undefined, stones(7))).toBeUndefined();
    expect(throwsLeft(undefined, stones(7), false)).toBeUndefined();
  });

  it('seven carried read 7, and after one throw 6: the one in the hand and five behind it', () => {
    const [first, ...rest] = stones(7);
    expect(throwsLeft(undefined, [first, ...rest], true)).toBe(7);
    // The hand reached for one and threw it: the next came to the hand
    const [next, ...left] = rest;
    expect(throwsLeft(next, left, true)).toBe(6);
  });

  it('the hotbar asks with which hand is firing', () => {
    expect(SRC('src/components/Hotbar.tsx')).toMatch(/throwsLeft\(item, carried, isActive\)/);
  });
});

// -----------------------------------------------------------------------------
// THE TUTORIAL TAKES ITS HUB'S UNLOCK AS IT STANDS
// -----------------------------------------------------------------------------

describe('the tutorial is never minted, so it takes its hub\'s magic as it stands', () => {
  it('its card carries no mark of its own', () => {
    expect(Tutorial.card(0, 0).magicUnlocked).toBeUndefined();
  });

  it('before the hub has unlocked, it dreams nothing; after, it does', () => {
    const card = Tutorial.card(0, 0);
    expect(Tutorial.dreams(card, false)).toBe(false);
    expect(Tutorial.dreams(card, true)).toBe(true);
  });

  it('a minted world keeps what it was pinned with, whatever the hub has done since', () => {
    const pinned = { isTutorial: false, magicUnlocked: false };
    expect(Tutorial.dreams(pinned, true)).toBe(false);
    expect(Tutorial.dreams({ isTutorial: false, magicUnlocked: true }, false)).toBe(true);
  });

  it('the world reads it on entry, from the hub\'s own state', async () => {
    const store = SRC('src/entities/world/store.ts');
    expect(store).toMatch(/Tutorial\.dreams\(worldCard, SHELF_STATE\.magicUnlocked\)/);
    await useWorldStore.getState().refreshWorlds();
    SHELF_STATE.magicUnlocked = true;
    await useWorldStore.getState().selectWorld(TUTORIAL_WORLD_ID);
    const { DreamingSystem } = await import('../shared/entities/world/Dreaming');
    expect(DreamingSystem.active()).not.toBeNull();
    useWorldStore.getState().exitWorld();
    SHELF_STATE.magicUnlocked = false;
    await useWorldStore.getState().selectWorld(TUTORIAL_WORLD_ID);
    expect(DreamingSystem.active()).toBeNull();
    useWorldStore.getState().exitWorld();
  });
});
