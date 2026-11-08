import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = new Map<string, any>();

vi.mock('../shared/entities/data/VectorStore', () => ({
  VectorNamespace: { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories' },
  VectorStore: {
    get: async (_ns: string, id: string) => { await new Promise(r => setTimeout(r, 1)); return db.get(id) ?? null; },
    put: async (doc: any) => { await new Promise(r => setTimeout(r, 1)); db.set(doc.id, doc); return true; },
    query: async () => [...db.values()].map(d => d),
    saveContent: async () => true,
    searchContent: async () => []
  }
}));

vi.mock('../src/entities/identity/certificateSystem', () => ({
  CertificateSystem: {
    signPayload: async (uid: string, payload: any) => ({ payload, signature: 'sig', certUid: uid, timestamp: 0 }),
    verifyPayload: async () => true
  }
}));

import { Ledger } from '../src/logic/ledger/Ledger';
import { Treasury } from '../src/logic/economy/Treasury';
import { ExitLevy } from '../src/logic/economy/ExitLevy';
import { GoldAudit } from '../src/logic/economy/GoldAudit';
import { useIdentityStore } from '../src/entities/identity/store';
import { usePlayerStore, playerPort } from '../src/entities/player/store';
import { useHubStore } from '../src/entities/hub/store';
import { Provenance } from '../src/logic/sovereignty/Provenance';

const UID = 'uid_test';

beforeEach(() => {
  db.clear();
  useIdentityStore.setState({ certificate: { metadata: { uid: UID } } as any });
  usePlayerStore.setState(s => ({ player: { ...s.player, id: UID, bank: { ...s.player.bank, gold: 0 } } }));
});

describe('ledger', () => {
  it('keeps every row when appends overlap', async () => {
    await Promise.all(Array.from({ length: 10 }, (_, i) => Ledger.append('CRAFT', { i })));
    const rows = await Ledger.list(UID);
    expect(rows.map(r => r.payload.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect((await Ledger.audit(UID)).ok).toBe(true);
  });
});

describe('treasury', () => {
  it('keeps every credit when writes overlap', async () => {
    await Promise.all(Array.from({ length: 10 }, () => Treasury.credit('world', 1)));
    expect(await Treasury.balance('world')).toBe(10);
  });
});

describe('shop sale between identities', () => {
  it('conserves gold: seller share is held, then collected', async () => {
    const lot = {
      id: 'lot1', lotIndex: 0, ownerId: 'seller', ownerName: 'Seller', purchaseDate: 0,
      structureType: 'VENDOR' as const, inventory: [], price: 1,
      shopListings: [{ item: { id: 'item1', name: 'Plank' } as any, price: 100 }]
    };
    useHubStore.setState({ activeHubId: 'hub', lots: [lot] });
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: 100 } } }));
    await Ledger.append('CHARACTER_GENESIS', { gold: 100 });

    expect(await useHubStore.getState().buyFromLot('lot1', 'item1')).toBe(true);

    expect(usePlayerStore.getState().player.bank.gold).toBe(0);
    expect(await Treasury.balance('hub')).toBe(5);
    expect(useHubStore.getState().lots[0].proceeds).toBe(95);
    expect((await GoldAudit.run(usePlayerStore.getState().player)).ok).toBe(true);

    // Now the seller's identity collects
    usePlayerStore.setState(s => ({ player: { ...s.player, id: 'seller' } }));
    expect(await useHubStore.getState().collectProceeds('lot1')).toBe(95);
    expect(usePlayerStore.getState().player.bank.gold).toBe(95);
    expect(useHubStore.getState().lots[0].proceeds).toBe(0);
  });
});

describe('provenance', () => {
  it('appends to a chain read back from the store as read-only', async () => {
    const item = { id: 'item9', universalDefinitionId: 'crf_glass' } as any;
    expect(await Provenance.record(item, 'MINT', {})).toBe(true);
    const stored = db.get('prov_item9');
    Object.freeze(stored.data.events);
    expect(await Provenance.record(item, 'TRANSFER', {})).toBe(true);
    expect((await Provenance.verify('item9')).events).toBe(2);
  });
});

describe('exit levy', () => {
  it('records only what was actually charged', async () => {
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: 3 } } }));
    await Ledger.append('CHARACTER_GENESIS', { gold: 3 });

    const charged = await ExitLevy.charge(playerPort, 'world', 1000, 0.05);

    expect(charged).toBe(3);
    expect(usePlayerStore.getState().player.bank.gold).toBe(0);
    expect(await Treasury.balance('world')).toBe(3);
    expect((await GoldAudit.run(usePlayerStore.getState().player)).ok).toBe(true);
  });
});
