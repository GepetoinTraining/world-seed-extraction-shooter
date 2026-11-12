/**
 * A DIVE LEFT BY A CLOSED WINDOW (TQ, call 9), bars set before the build and seen red.
 *
 * Found by another session (ML26): a drop moves every tool from the vault into the pack, the save drops the dive, and
 * nothing rebuilds it at the next start, so a window closed mid-dive lost the whole pack, tools included, even in the
 * tutorial where a death costs nothing. The coordinator's call 9: a dive left by a closed window is settled at the next
 * start exactly as a death there would be, by `DeathCost`, never more.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
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

import { IItem, IPlayer, Rarity, UniversalRank } from '../shared/types';
import { RESOURCE_DEFINITIONS } from '../shared/entities/item/data/resourceDefinitions';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { Rng } from '../shared/logic/rng/DeterministicRNG';
import { installShippedThemes } from '../shared/logic/theme/boot';
import { Tutorial } from '../src/logic/systems/Tutorial';
import { LeftDive } from '../src/logic/systems/LeftDive';
import { PlayerPersistence } from '../src/logic/persistence/PlayerPersistence';
import { usePlayerStore } from '../src/entities/player/store';
import { useIdentityStore } from '../src/entities/identity/store';
import type { IWorldCard } from '../src/entities/world/store';

installShippedThemes();

const SRC = (p: string) => readFileSync(p, 'utf8');
const UID = 'uid_leftdive';
const CERT = (uid: string, name: string) => ({ metadata: { uid, displayName: name, createdAt: 0 }, publicKey: {} as any, publicKeyJWK: {} as any }) as any;
const player = () => usePlayerStore.getState().player;
const M = 60_000;
const openWorld = (over: Partial<IWorldCard> = {}): IWorldCard => ({
  id: 'w_other', seed: 'grey-reach', size: 16, createdAt: Date.now() - 10 * M, playerCount: 0, name: 'Grey Reach', difficulty: 'F' as never,
  creator: 'x', extractionTaxRate: 0.05, deathPenalty: 'INVENTORY_LOSS', ...over
});
const written = (form: string) => Object.values(RESOURCE_DEFINITIONS).find(d => d.harvestConfig && (d as any).visuals?.modelId === form)! as any;
const mint = (def: any, key: string): IItem => ItemFactory.createResourceItem(def, Rng.fromKey(key));
/** A pick, as the tools kit carries one: a tool whose words fit a vein. */
function pickaxe(): IItem {
  return { id: 'item_pick_fo', name: 'Claim Pick', type: 'TOOL', rank: UniversalRank.F, rarity: Rarity.COMMON, tags: ['tool', 'pickaxe'], toolData: { toolTags: ['pickaxe'], power: 1 }, affixes: [], value: 1, weight: 1, dimensions: { width: 1, height: 2 }, stats: { maxDurability: 100 } } as unknown as IItem;
}

beforeEach(() => {
  db.clear();
  localStorage.clear();
  useIdentityStore.setState({ certificate: CERT(UID, 'FIRSTLING') } as any);
  usePlayerStore.getState().initializeSession(CERT(UID, 'FIRSTLING'), 'NOMAD');
});

// -----------------------------------------------------------------------------
// CALL 9: A CLOSED WINDOW IS SETTLED AS A DEATH THERE WOULD BE, NEVER MORE
// -----------------------------------------------------------------------------

describe('a dive left by a closed window is settled at the next start as a death there would be', () => {
  const tool = () => pickaxe();
  /** The dive as the window left it, kept by the save. */
  const leftIn = async (card: IWorldCard, dropped = true) => {
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, stashTabs: [{ ...s.player.bank.stashTabs[0], items: [tool()] }] } } }));
    usePlayerStore.getState().apply({ kind: 'DIVE', layerId: card.seed, penalty: card.deathPenalty } as never);
    expect(player().currentSession?.inventory.map(i => i.id)).toContain(tool().id);
    if (dropped) usePlayerStore.setState(s => ({ player: { ...s.player, currentSession: { ...s.player.currentSession!, droppedAt: 1, inventory: [...s.player.currentSession!.inventory, mint(written('pebble'), 'found')] } } }));
    const saved = PlayerPersistence.persistable(player());
    expect(saved.currentSession).toBeUndefined();
    expect(saved.leftDive?.session.inventory.map(i => i.id)).toContain(tool().id);
    expect(saved.leftDive?.penalty).toBe(card.deathPenalty);
    return saved;
  };
  /** The next start, from what the save kept. */
  const restart = (saved: IPlayer) => {
    usePlayerStore.setState({ player: JSON.parse(JSON.stringify(saved)) });
    return LeftDive.settle(usePlayerStore.getState().player, p => usePlayerStore.getState().emergencyJackOut(p as never), next => usePlayerStore.setState({ player: next }));
  };

  it('in the tutorial, everything carried comes back to the vault, tools and finds, as a death there would', async () => {
    const saved = await leftIn(Tutorial.card(0, 0));
    expect(restart(saved)).toBe(true);
    const stash = player().bank.stashTabs[0].items.map(i => i.name);
    expect(stash).toContain('Claim Pick');
    expect(stash.length).toBe(2);
    expect(player().currentSession).toBeUndefined();
    expect(player().leftDive).toBeUndefined();
  });

  it('in a world where a death takes the haul, the pack and what is worn fall as a death would, and nothing more', async () => {
    const saved = await leftIn(openWorld());
    restart(saved);
    expect(player().bank.stashTabs[0].items).toHaveLength(0);
    expect(player().leftDive).toBeUndefined();
  });

  it('before the drop nothing was risked: the kit comes back as leaving recon would bring it', async () => {
    const saved = await leftIn(openWorld(), false);
    restart(saved);
    expect(player().bank.stashTabs[0].items.map(i => i.name)).toEqual(['Claim Pick']);
  });

  it('with no dive left, a start settles nothing', () => {
    expect(restart(PlayerPersistence.persistable(player()))).toBe(false);
  });

  it('the start settles it before anything else reads the character, and saves it', () => {
    const boot = SRC('src/logic/initialization/StartupSequence.ts');
    expect(boot).toMatch(/LeftDive\.settle\(/);
    expect(boot.indexOf('LeftDive.settle(')).toBeLessThan(boot.indexOf('WorldDeedDoor.grantOnLoad'));
    expect(SRC('src/logic/systems/Deploy.ts')).toMatch(/penalty: card\.deathPenalty/);
    expect(SRC('src/components/WorldCanvas.tsx')).toMatch(/droppedAt: Date\.now\(\)/);
  });
});
