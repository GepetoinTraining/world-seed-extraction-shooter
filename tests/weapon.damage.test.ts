/**
 * A WEAPON SAYS WHAT IT DEALS (2026-11-12), bars set before the build.
 *
 * Pedro, after his round on main at 854bcce: "You do realize you guys built a whole rpg extraction shooter and forgot
 * the stat "damage" on weapons?" A weapon's own lines were an accuracy rating and its rate; what it dealt was worked
 * out apart from them (`CombatMath.weaponDamage`, from the piece's power over its rate), so nothing on it said so.
 * BALANCE_RUN 1.4 already names a blade as the piece that natively carries damage.
 *
 * The coordinator's call: one number. A piece's own blow is derived in ONE function, `CombatMath.ownBlow`, which the
 * fight (`weaponDamage`), the card, the hotbar and the sheet all read; nothing is stored on the piece, so a piece
 * minted before and a piece from a standing world read by the same function. A weapon's own `damage` line (an
 * added amount, as on any piece) is folded into the card's damage line, so the card shows one damage number. What a
 * blow is a second is the blow at the piece's own rate.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { IEquipmentState, IItem, ItemType, Rarity, SlotType, UniversalRank } from '../shared/types';
import { FIRST_THEME_PACK, installShippedThemes } from '../shared/logic/theme/boot';
import { ContentRegistry } from '../shared/logic/theme/ContentRegistry';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { Rng } from '../shared/logic/rng/DeterministicRNG';
import { RESOURCE_DEFINITIONS } from '../shared/entities/item/data/resourceDefinitions';
import { isLooseStone, thrownDamage } from '../shared/entities/item/Throwable';
import { CombatMath } from '../src/entities/combat/CombatMath';
import { inspectItem } from '../src/render/atoms/inspect';
import { UNARMED_SHOTS_PER_SEC } from '../shared/logic/systems/FightNumbers';

installShippedThemes();
const compiled = ContentRegistry.compiled(FIRST_THEME_PACK.themeId)!;
const gearDef = (name: string) => [...Object.values(compiled.items).flat(), ...compiled.craftedGear].find((d: any) => d.universal_name === name) as any;
const mint = (name: string, key: string): IItem => ItemFactory.createFromTemplate(gearDef(name), true, Rng.fromKey(key));
const pebble = (): IItem => ItemFactory.createResourceItem(Object.values(RESOURCE_DEFINITIONS).find(d => isLooseStone(d as never)) as never, Rng.fromKey('dmg:pebble'));
const wearing = (pairs: [string, IItem][]): IEquipmentState => ({ slots: Object.fromEntries(pairs.map(([s, i]) => [s, i.id])), items: pairs.map(p => p[1]), frames: {}, protected: [] } as unknown as IEquipmentState);
const ring = (damage: number): IItem => ({ id: 'ring', name: 'RING', slot: SlotType.RING, type: ItemType.GEAR, tags: [], affixes: [], rank: UniversalRank.F, rarity: Rarity.COMMON, isIdentified: true, weight: 0.1, stats: { damage } } as unknown as IItem);
const legacy = (stats: Record<string, number>): IItem => ({
  id: 'old', universalDefinitionId: 'gear_old', name: 'OLD BLADE', description: '', type: ItemType.GEAR, slot: SlotType.MAIN_HAND,
  rank: UniversalRank.F, rarity: Rarity.COMMON, quality: 0, level: 1, value: 1, itemPower: 40, tags: ['melee', 'weapon'], affixes: [],
  dimensions: { width: 1, height: 1 }, weight: 1, stats, visuals: { modelId: 'm', colorHex: '#fff' }, icon: 'i', history: { dropDate: 0, killCount: 0 }, isIdentified: true
}) as IItem;
const firstRow = (item: IItem) => inspectItem(item).rows[0];
const said = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

describe('one number: the fight reads the blow the piece says', () => {
  it('a weapon deals its own blow, and what is worn elsewhere adds to it', () => {
    for (const name of ['Steel-Rule Bow', 'Letter Opener', 'Oversized Gavel', "Clerk's Abacus", 'Claim Pick']) {
      const w = mint(name, `dmg:${name}`);
      const own = w.stats?.damage ?? 0;
      expect(CombatMath.weaponDamage(w), name).toBe(Math.max(1, CombatMath.ownBlow(w)));
      expect(CombatMath.weaponDamage(w, wearing([['RIGHT_HAND', w], ['RING_1', ring(3)]])), name).toBeCloseTo(Math.max(1, CombatMath.ownBlow(w) + own + 3), 9);
    }
  });
  it('a thrown stone and a bare hand read through the same door', () => {
    const p = pebble();
    expect(CombatMath.ownBlow(p)).toBe(thrownDamage(p));
    expect(CombatMath.weaponDamage(p)).toBe(CombatMath.ownBlow(p));
    expect(CombatMath.weaponDamage(undefined, undefined, 'C')).toBe(CombatMath.ownBlow(undefined, 'C'));
    expect(CombatMath.ownRate(undefined)).toBe(UNARMED_SHOTS_PER_SEC);
  });
  it('a piece minted before the law (no piece law) still reads, by the old rule, with no blank', () => {
    const old = legacy({ attack_speed: 1.5 });
    expect(CombatMath.ownBlow(old)).toBe(Math.round(6 + 40 * 0.08));
    expect(firstRow(old)[1]).toMatch(/^\d+ a blow, [\d.]+ a second$/);
  });
});

describe('the card leads with what the piece deals, a blow and a second', () => {
  it('a weapon\'s first line is its damage: the blow, and the blow at its own rate', () => {
    for (const name of ['Steel-Rule Bow', 'Letter Opener', 'Oversized Gavel', "Clerk's Abacus"]) {
      const w = mint(name, `card:${name}`);
      const blow = Math.max(1, CombatMath.ownBlow(w) + (w.stats?.damage ?? 0));
      expect(firstRow(w), name).toEqual(['Damage', `${said(Math.round(blow * 10) / 10)} a blow, ${said(Math.round(blow * CombatMath.ownRate(w) * 10) / 10)} a second`]);
    }
  });
  it('a weapon\'s own damage line is folded in, so the card shows one damage number', () => {
    const old = legacy({ damage: 3, attack_speed: 1 });
    expect(firstRow(old)).toEqual(['Damage', `${Math.round(6 + 40 * 0.08) + 3} a blow, ${Math.round(6 + 40 * 0.08) + 3} a second`]);
    expect(inspectItem(old).rows.filter(r => /^damage$/i.test(r[0])).length).toBe(1);
  });
  it('a tool used as a weapon and a stone in the hand say what they deal', () => {
    const pick = mint('Claim Pick', 'card:pick');
    expect(firstRow(pick)[0]).toBe('Damage');
    const p = pebble();
    expect(firstRow(p)).toEqual(['Damage', `${thrownDamage(p)} a throw, ${thrownDamage(p)} a second`]);
  });
  it('a piece no hand fires keeps its own damage line where it was, and an unread piece says nothing', () => {
    expect(firstRow(ring(3))[0]).not.toBe('Damage');
    expect(inspectItem(ring(3)).rows.some(r => r[0] === 'damage' && r[1] === '3')).toBe(true);
    const unread = { ...mint('Steel-Rule Bow', 'card:unread'), isIdentified: false };
    expect(inspectItem(unread).rows.some(r => r[0] === 'Damage')).toBe(false);
  });
});

describe('the hotbar and the sheet say it too', () => {
  it('taking a hand says what it deals, a bare hand included', () => {
    const hotbar = readFileSync('src/components/Hotbar.tsx', 'utf8');
    expect(hotbar).toMatch(/CombatMath\.damageSaid\(/);
    expect(hotbar).toMatch(/Bare hands: \$\{/);
  });
  it('the sheet\'s first fight line is DAMAGE: the hit, and what it comes to a second', () => {
    const sheet = readFileSync('src/logic/systems/SheetNumbers.ts', 'utf8');
    expect(sheet).toMatch(/key: 'hit', word: 'DAMAGE'/);
    expect(sheet).toMatch(/a second/);
  });
});
