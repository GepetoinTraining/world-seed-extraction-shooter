/**
 * WAVE 9 BARS — registered before the screens were built (guardrail 1).
 * Test lines 26–31:
 *   26 a new identity picks an archetype, sees its real avatar, leaves, returns through character select
 *   27 every option on every screen does something, or is not there
 *   28 no emoji remain; items show their real art at real footprints
 *   29 the inspect card works everywhere, by mouse and by keyboard
 *   30 kills count, a level-up is seen, and what it gives is real
 *   31 the seal and the DIED receipt exist, and the ledger can be read
 * Plus the wave's own bars: minimum readable text size, keyboard reachable,
 * recon readable in grayscale, one theme.
 */

import { RestSystem } from '../src/logic/systems/RestSystem';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const db = new Map<string, any>();
vi.mock('../src/entities/data/VectorStore', () => ({
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

import { UniversalRank, Rarity, ItemType } from '../types';
import {
  ProgressionSystem, RANK_ORDER, RANK_XP_THRESHOLDS, POINTS_PER_LEVEL
} from '../src/entities/player/systems/ProgressionSystem';
import { usePlayerStore, ARCHETYPES } from '../src/entities/player/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { applyKillRewards } from '../src/entities/combat/killRewards';
import { ICombatEvent } from '../src/entities/combat/CombatSystems';
import { AvatarRoster } from '../src/entities/identity/roster';
import { HUB_NPCS } from '../src/entities/hub/HubGenerator';
import { DIALOGUE_HANDLERS, HANDLED_ACTIONS, runDialogueAction, repairCost, repairItem } from '../src/entities/hub/dialogue';
import { useHubStore } from '../src/entities/hub/store';
import { reconCell, RECON_CELL_ATOMS } from '../src/render/atoms/recon';
import { BiomeType } from '../src/entities/world/types';
import { Role, STEPS, px, buildPalette, grayscale } from '../src/render/atoms/atoms';
import { itemArtFor } from '../src/render/atoms/items';
import { ItemFactory } from '../src/entities/item/ItemFactory';
import { RESOURCE_DEFINITIONS } from '../src/entities/item/data/resourceDefinitions';
import { Rng } from '../src/logic/rng/DeterministicRNG';
import { MACHINE_COLORS, FONT_PX, MIN_READABLE_PX, TERMINAL_GENRE } from '../src/components/ui/tokens';
import { useFeed, useReceipt, useAppView } from '../src/components/ui/stores';

// -----------------------------------------------------------------------------
// Bars, set before the build. Do not lower them to get a pass.
// -----------------------------------------------------------------------------
const RECON_PAIR_MIN = 0.25;      // biomes apart in grayscale, by atom steps
const RECON_UNKNOWN_MIN = 0.30;   // the unscanned reads as a different thing
const MIN_TEXT_PX = 12;           // the smallest word on any screen

const CERT = (uid: string, name = 'TESTER') => ({
  metadata: { uid, displayName: name, createdAt: 0 },
  publicKey: {} as any
}) as any;

beforeEach(() => {
  db.clear();
  localStorage.clear();
  useIdentityStore.setState({ certificate: CERT('uid_bars') });
  usePlayerStore.getState().initializeSession(CERT('uid_bars'), 'NOMAD');
});

// -----------------------------------------------------------------------------
// LINE 30 — kills count, a rank-up is seen, and what it gives is real
// -----------------------------------------------------------------------------

describe('line 30: levels and the old rank ladder (kill XP is finally applied)', () => {
  it('thresholds climb monotonically F to SSS', () => {
    for (let i = 1; i < RANK_ORDER.length; i++) {
      expect(RANK_XP_THRESHOLDS[RANK_ORDER[i]]).toBeGreaterThan(RANK_XP_THRESHOLDS[RANK_ORDER[i - 1]]);
    }
    expect(ProgressionSystem.rankFromXp(0)).toBe(UniversalRank.F);
    expect(ProgressionSystem.rankFromXp(999)).toBe(UniversalRank.F);
    expect(ProgressionSystem.rankFromXp(1000)).toBe(UniversalRank.E);
    expect(ProgressionSystem.rankFromXp(2_000_000)).toBe(UniversalRank.SSS);
  });

  it('a KILL event with xpReward raises rankXp — the Wave 9.5 bug stays dead', () => {
    const before = usePlayerStore.getState().player.rankXp ?? 0;
    const events: ICombatEvent[] = [
      { type: 'KILL', entityId: 'm1', xpReward: { amount: 120, sourceRank: UniversalRank.E, sourceRarity: Rarity.COMMON } },
      { type: 'HIT', entityId: 'm2', damage: 5 },
      { type: 'KILL', entityId: 'm3', xpReward: { amount: 80, sourceRank: UniversalRank.F, sourceRarity: Rarity.COMMON } }
    ];
    const result = applyKillRewards(events);
    expect(result.xpGained).toBe(200);
    expect(usePlayerStore.getState().player.rankXp).toBe(before + 200);
  });

  it('a level grants attribute points, and spending one is real', () => {
    const res = usePlayerStore.getState().applyKillXp(ProgressionSystem.levelCost(UniversalRank.F, 1)); // level 1 -> 2 exactly
    expect(res.leveledUp).toBe(true);
    expect(res.from).toBe(1);
    expect(res.to).toBe(2);
    expect(res.pointsGranted).toBe(POINTS_PER_LEVEL);
    const p1 = usePlayerStore.getState().player;
    expect(p1.attributePoints).toBe(POINTS_PER_LEVEL);

    const strBefore = p1.baseAttributes.strength;
    expect(usePlayerStore.getState().spendAttributePoint('strength')).toBe(true);
    const p2 = usePlayerStore.getState().player;
    expect(p2.baseAttributes.strength).toBe(strBefore + 1);
    expect(p2.attributes.strength).toBe(strBefore + 1); // effective follows base
    expect(p2.attributePoints).toBe(POINTS_PER_LEVEL - 1);
  });

  it('no points means no spend', () => {
    expect(usePlayerStore.getState().player.attributePoints ?? 0).toBe(0);
    expect(usePlayerStore.getState().spendAttributePoint('strength')).toBe(false);
  });

  it('a jump across several levels grants points for each', () => {
    const three = [1, 2, 3].reduce((sum, level) => sum + ProgressionSystem.levelCost(UniversalRank.F, level), 0);
    const res = usePlayerStore.getState().applyKillXp(three);
    expect(res.to).toBe(4);
    expect(res.pointsGranted).toBe(3 * POINTS_PER_LEVEL);
  });

  it('D6: outranking a task by three or more is auto-success, outside combat', () => {
    expect(ProgressionSystem.checkSkill(UniversalRank.SS, UniversalRank.B).autoSuccess).toBe(true);  // the magic lockpick
    expect(ProgressionSystem.checkSkill(UniversalRank.A, UniversalRank.B).autoSuccess).toBe(false);  // gap 1
    expect(ProgressionSystem.checkSkill(UniversalRank.B, UniversalRank.SS).autoSuccess).toBe(false); // outranked
    expect(ProgressionSystem.checkSkill(UniversalRank.C, UniversalRank.F).autoSuccess).toBe(true);   // gap 3
  });
});

// -----------------------------------------------------------------------------
// LINE 26 — a new identity picks an archetype and returns through select
// -----------------------------------------------------------------------------

describe('line 26: birth and character select', () => {
  it('initializeSession keeps the chosen archetype and its bonuses', () => {
    const p = usePlayerStore.getState().player;
    expect(p.archetype).toBe('NOMAD');
    // NOMAD: endurance +3 over the default base
    expect(p.baseAttributes.endurance).toBeGreaterThanOrEqual((ARCHETYPES.NOMAD.endurance ?? 0) + 1);
  });

  it('ensureCharacter never resets a returning player (the handleLogin bug)', () => {
    usePlayerStore.getState().applyKillXp(1_000);
    const before = usePlayerStore.getState().player;
    usePlayerStore.getState().ensureCharacter(CERT('uid_bars'), 'OPERATOR'); // the old default
    const after = usePlayerStore.getState().player;
    expect(after.archetype).toBe('NOMAD');
    expect(after.rankXp).toBe(before.rankXp);
    expect(after.bank.gold).toBe(before.bank.gold);
  });

  it('the roster holds several complete owners per device, and migrates the old slot', () => {
    // the legacy single slot
    localStorage.setItem('worldseed_certificate', JSON.stringify(CERT('uid_old', 'LEGACY')));
    const migrated = AvatarRoster.list();
    expect(migrated.some(e => e.certificate.metadata.uid === 'uid_old')).toBe(true);

    AvatarRoster.remember(CERT('uid_new', 'SECOND'), 'ARCANIST');
    expect(AvatarRoster.list().length).toBe(2);
    expect(AvatarRoster.archetypeOf('uid_new')).toBe('ARCANIST');

    AvatarRoster.setActive(CERT('uid_new', 'SECOND'));
    expect(AvatarRoster.activeUid()).toBe('uid_new');

    AvatarRoster.forget('uid_old');
    expect(AvatarRoster.list().length).toBe(1);
  });
});

// -----------------------------------------------------------------------------
// LINE 27 — every option on every screen does something, or is not there
// -----------------------------------------------------------------------------

describe('line 27: no dialogue option without an effect', () => {
  it('every authored option carries a registered action', () => {
    for (const npc of Object.values(HUB_NPCS)) {
      for (const opt of npc.dialogue.options) {
        expect(HANDLED_ACTIONS, `${npc.name}: "${opt.label}" -> ${opt.action}`).toContain(opt.action);
      }
    }
  });

  it('an unregistered action is refused out loud, not swallowed', () => {
    const effect = runDialogueAction('OPEN_AUCTION');
    expect(effect.kind).toBe('reply');
    expect((effect as any).text).toContain('REFUSED');
  });

  it('SHOW_BALANCE answers with the real balance', () => {
    const effect = runDialogueAction('SHOW_BALANCE');
    expect(effect.kind).toBe('reply');
    expect((effect as any).text).toContain(usePlayerStore.getState().player.bank.gold.toLocaleString());
  });

  it('IDENTIFY_ITEM charges gold, and the piece is known after the night (D50)', () => {
    useHubStore.setState({ activeHubId: 'hub_test' });
    const rng = Rng.fromKey('bars:identify');
    const item = ItemFactory.createItem(UniversalRank.F, false, rng, 'weapon');
    expect(item.isIdentified).toBe(false);
    usePlayerStore.setState(s => ({
      player: { ...s.player, bank: { ...s.player.bank, gold: 1000, stashTabs: [{ name: 'MAIN', items: [item] }] } }
    }));
    const effect = runDialogueAction('IDENTIFY_ITEM', { cost: 100 });
    expect(effect.kind).toBe('reply');
    const after = usePlayerStore.getState().player;
    expect(after.bank.gold).toBe(900);
    expect(after.bank.stashTabs[0].items[0].isIdentified).toBe(false);
    expect(RestSystem.settle(after).player.bank.stashTabs[0].items[0].isIdentified).toBe(true);
  });

  it('IDENTIFY refuses honestly when nothing is hidden or gold is short', () => {
    usePlayerStore.setState(s => ({
      player: { ...s.player, bank: { ...s.player.bank, gold: 10, stashTabs: [{ name: 'MAIN', items: [] }] } }
    }));
    const effect = runDialogueAction('IDENTIFY_ITEM', { cost: 100 });
    expect(effect.kind).toBe('reply');
    expect(usePlayerStore.getState().player.bank.gold).toBe(10); // nothing moved
  });

  it('REPAIR restores durability for a price that scales with the damage', () => {
    useHubStore.setState({ activeHubId: 'hub_test' });
    const rng = Rng.fromKey('bars:repair');
    const item = ItemFactory.createItem(UniversalRank.E, true, rng, 'weapon');
    item.stats.maxDurability = 100;
    item.stats.durability = 40;
    usePlayerStore.setState(s => ({
      player: { ...s.player, bank: { ...s.player.bank, gold: 1000, stashTabs: [{ name: 'MAIN', items: [item] }] } }
    }));
    const cost = repairCost(item as any);
    expect(cost).toBeGreaterThan(0);
    const res = repairItem(item.id);
    expect(res.ok).toBe(true);
    const after = usePlayerStore.getState().player;
    expect(after.bank.stashTabs[0].items[0].stats.durability).toBe(100);
    expect(after.bank.gold).toBe(1000 - cost);
  });

  it('BUY_CONSUMABLE moves gold and lands a usable drink in the stash', () => {
    useHubStore.setState({ activeHubId: 'hub_test' });
    usePlayerStore.setState(s => ({
      player: { ...s.player, bank: { ...s.player.bank, gold: 50, stashTabs: [{ name: 'MAIN', items: [] }] } }
    }));
    const effect = runDialogueAction('BUY_CONSUMABLE', { itemId: 'drink_ale', cost: 10 });
    expect(effect.kind).toBe('reply');
    const after = usePlayerStore.getState().player;
    expect(after.bank.gold).toBe(40);
    const ale = after.bank.stashTabs[0].items[0];
    expect(ale.type).toBe(ItemType.CONSUMABLE);
    expect(ale.stats.health_restore).toBeGreaterThan(0);
  });

  it('the dead ends are gone: no guild forms, no auction forms (REST came back with a job, D43)', () => {
    const actions = Object.values(HUB_NPCS).flatMap(n => n.dialogue.options.map(o => o.action));
    for (const gone of ['OPEN_GUILD', 'CREATE_GUILD', 'BROWSE_GUILDS', 'OPEN_AUCTION', 'MY_AUCTIONS', 'CREATE_LISTING']) {
      expect(actions).not.toContain(gone);
    }
  });
});

// -----------------------------------------------------------------------------
// LINE 28 — no emoji remain; items show their real art at real footprints
// -----------------------------------------------------------------------------

const SRC = join(__dirname, '..');
function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) tsxFiles(p, out);
    else if (name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

// Pictographs, dingbats, transport, flags, variation selector — emoji ranges.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

describe('line 28: the screens are made of the atoms', () => {
  it('no emoji anywhere in the interface sources', () => {
    const files = [...tsxFiles(join(SRC, 'src')), join(SRC, 'App.tsx')];
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      const m = text.match(EMOJI);
      if (m) offenders.push(`${f.replace(SRC, '')}: ${m[0]}`);
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('items render their real art at their real footprint, identified or not', () => {
    const rng = Rng.fromKey('bars:itemart');
    const axe = ItemFactory.createItem(UniversalRank.E, true, rng, 'tool', 'tool_axe_field_t1');
    const art = itemArtFor(axe);
    expect(art.w).toBe(axe.dimensions.width * 18 - 2);
    expect(art.h).toBe(axe.dimensions.height * 18 - 2);

    const hidden = itemArtFor({ ...axe, isIdentified: false });
    let differs = 0;
    for (let i = 0; i < art.data.length; i++) if (art.data[i] !== hidden.data[i]) differs++;
    expect(differs / art.data.length).toBeGreaterThan(0.3); // noise, not the real glyph

    const log = ItemFactory.createResourceItem(RESOURCE_DEFINITIONS['res_tree_log'] as any, rng);
    const logArt = itemArtFor(log);
    expect(logArt.w).toBe(log.dimensions.width * 18 - 2);
    expect(logArt.h).toBe(log.dimensions.height * 18 - 2);
  });
});

// -----------------------------------------------------------------------------
// THE WAVE'S OWN BARS — one theme, minimum text, keyboard, recon in grayscale
// -----------------------------------------------------------------------------

describe('one theme, readable text', () => {
  it('machine colors come from the same ramps the atoms use', () => {
    const table = buildPalette(TERMINAL_GENRE);
    const hex = (role: Role, step: number) => {
      const i = (1 + role * STEPS + step) * 3;
      return `#${[table[i], table[i + 1], table[i + 2]].map(c => c.toString(16).padStart(2, '0')).join('')}`;
    };
    expect(MACHINE_COLORS.signal[3]).toBe(hex(Role.SIGNAL, 3));
    expect(MACHINE_COLORS.proof[3]).toBe(hex(Role.PROOF, 3));
    expect(MACHINE_COLORS.loss[3]).toBe(hex(Role.LOSS, 3));
    expect(MACHINE_COLORS.void[0]).toBe(hex(Role.VOID, 0));
  });

  it('no font size below the readable floor, in tokens or in the screens', () => {
    expect(MIN_READABLE_PX).toBeGreaterThanOrEqual(MIN_TEXT_PX);
    Object.values(FONT_PX).forEach(n => expect(n).toBeGreaterThanOrEqual(MIN_READABLE_PX));

    // No screen reaches past the tokens for something smaller.
    const files = [...tsxFiles(join(SRC, 'src')), join(SRC, 'App.tsx')];
    const offenders: string[] = [];
    for (const f of files) {
      if (f.includes('admin')) continue; // the Genre Creator inherits the system later
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/fontSize:\s*'?(\d+)(?:px)?'?/g)) {
        if (Number(m[1]) < MIN_TEXT_PX) offenders.push(`${f.replace(SRC, '')}: fontSize ${m[1]}`);
      }
      for (const m of text.matchAll(/size="(\d+)px"/g)) {
        if (Number(m[1]) < MIN_TEXT_PX) offenders.push(`${f.replace(SRC, '')}: size ${m[1]}px`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});

describe('keyboard reachable: the kit is made of native controls', () => {
  it('kit components render button/input/kbd elements, not clickable divs', async () => {
    const React = (await import('react')).default;
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { Button, Input, Tabs, Bar } = await import('../src/components/ui/kit');

    expect(renderToStaticMarkup(React.createElement(Button, { tone: 'signal' }, 'DEPLOY'))).toContain('<button');
    expect(renderToStaticMarkup(React.createElement(Input, { label: 'CODENAME' }))).toContain('<input');
    const tabs = renderToStaticMarkup(React.createElement(Tabs, {
      tabs: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], active: 'a', onChange: () => {}
    }));
    expect(tabs).toContain('role="tablist"');
    expect(tabs.match(/<button/g)?.length).toBe(2);
    const bar = renderToStaticMarkup(React.createElement(Bar, { label: 'HP', value: 50, max: 100 }));
    expect(bar).toContain('role="meter"');
  });

  it('the kit stylesheet declares a visible focus style', () => {
    const css = readFileSync(join(SRC, 'src/components/ui/kit.css'), 'utf8');
    expect(css).toContain(':focus-visible');
  });
});

describe('recon readable in grayscale (it was hue-only)', () => {
  const BIOMES = [BiomeType.WASTELAND, BiomeType.OVERGROWTH, BiomeType.RUINS, BiomeType.INDUSTRIAL, BiomeType.CYBER_CITY];

  const stepDiff = (a: Uint8Array, b: Uint8Array) => {
    let n = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
    return n / a.length;
  };

  it('every biome pair reads apart by structure and value, not hue', () => {
    for (const level of [1, 3]) {
      for (let i = 0; i < BIOMES.length; i++) for (let j = i + 1; j < BIOMES.length; j++) {
        const a = reconCell({ biome: BIOMES[i], scanLevel: level, seed: 's', sx: 3, sy: 4 });
        const b = reconCell({ biome: BIOMES[j], scanLevel: level, seed: 's', sx: 3, sy: 4 });
        const d = stepDiff(a.data, b.data);
        expect(d, `${BIOMES[i]} vs ${BIOMES[j]} at level ${level}: ${(d * 100).toFixed(0)}%`).toBeGreaterThanOrEqual(RECON_PAIR_MIN);
      }
    }
  });

  it('the unknown is unmistakable against any scanned ground', () => {
    const unknown = reconCell({ biome: BiomeType.RUINS, scanLevel: 0, seed: 's', sx: 1, sy: 1 });
    for (const biome of BIOMES) {
      const known = reconCell({ biome, scanLevel: 1, seed: 's', sx: 1, sy: 1 });
      expect(stepDiff(unknown.data, known.data)).toBeGreaterThanOrEqual(RECON_UNKNOWN_MIN);
    }
  });

  it('the exit is a mark with a moat, present at every scan depth past zero', () => {
    for (const level of [1, 2, 3]) {
      const cell = reconCell({ biome: BiomeType.WASTELAND, scanLevel: level, hasExit: true, seed: 's', sx: 2, sy: 2 });
      const signalFloor = px(Role.SIGNAL, 0), signalCeil = px(Role.SIGNAL, 4);
      let signals = 0;
      for (const v of cell.data) if (v >= signalFloor && v <= signalCeil) signals++;
      expect(signals).toBeGreaterThanOrEqual(8);
    }
  });

  it('deeper scans brighten the record without erasing the structure', () => {
    const l1 = reconCell({ biome: BiomeType.INDUSTRIAL, scanLevel: 1, seed: 's', sx: 5, sy: 5 });
    const l3 = reconCell({ biome: BiomeType.INDUSTRIAL, scanLevel: 3, seed: 's', sx: 5, sy: 5 });
    const sum = (d: Uint8Array) => d.reduce((s, v) => s + v, 0);
    expect(sum(l3.data)).toBeGreaterThan(sum(l1.data));
  });

  it('grayscale keeps the machine marks apart from the ground', () => {
    const palette = grayscale(buildPalette(TERMINAL_GENRE));
    const groundTop = palette[px(Role.GROUND, 4) * 3];
    const signalMid = palette[px(Role.SIGNAL, 3) * 3];
    expect(signalMid - groundTop).toBeGreaterThanOrEqual(40); // the exit mark survives gray
  });
});

// -----------------------------------------------------------------------------
// LINE 31 — the seal and the DIED receipt exist, and the ledger can be read
// -----------------------------------------------------------------------------

describe('line 31: receipts and the feed', () => {
  it('the receipt store carries both outcomes with their haul', () => {
    const { show, clear } = useReceipt.getState();
    show({ outcome: 'EXTRACTED', haul: [], haulValue: 120, tax: 6, worldName: 'TEST', durationMs: 1000, actionCount: 3, signature: 'abc' });
    expect(useReceipt.getState().receipt?.outcome).toBe('EXTRACTED');
    show({ outcome: 'DIED', haul: [], haulValue: 0, tax: 0, worldName: 'TEST', durationMs: 500, actionCount: 1 });
    expect(useReceipt.getState().receipt?.outcome).toBe('DIED');
    clear();
    expect(useReceipt.getState().receipt).toBeNull();
  });

  it('the feed keeps the last few lines and sweeps old ones', () => {
    const feed = useFeed.getState();
    for (let i = 0; i < 12; i++) feed.push(`line ${i}`);
    expect(useFeed.getState().lines.length).toBeLessThanOrEqual(8);
    useFeed.getState().sweep(Date.now() + 60_000);
    expect(useFeed.getState().lines.length).toBe(0);
  });

  it('dialogue can steer the terminal to another screen', () => {
    useAppView.getState().setView('HUB');
    const effect = runDialogueAction('OPEN_BANK');
    expect(effect).toEqual({ kind: 'navigate', view: 'BANK' });
  });
});
