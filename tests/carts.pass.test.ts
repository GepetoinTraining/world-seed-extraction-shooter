/**
 * CARTS (the interface pass, part 3), bars set before the build.
 *
 * Pedro, 2026-11-11: "the carts need variable sizes of bed and their stats". DESIGN_BACKLOG.md 1.3.
 * A cart is a kind like any other: its bed comes from a size word on the kind, turned into a width and
 * a height by the formula, with rank and quality doing what the formula says; there is no list of
 * finished carts. The shipped theme is pinned, so its one cart keeps a bed of 10 by 8 by the default.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../src/entities/identity/certificateSystem', () => ({
  CertificateSystem: { signPayload: async (uid: string, payload: any) => ({ payload, signature: `sig_${uid}`, certUid: uid, timestamp: 0 }), verifyPayload: async () => true, getPrivateKey: async () => null }
}));

import { IItem, UniversalRank } from '../shared/types';
import { cartNumbers, cartFolded } from '../shared/logic/theme/ThemeFormula';
import { compileTheme, sealTheme } from '../shared/logic/theme/ThemeCompiler';
import { FIRST_THEME_PACK } from '../shared/logic/theme/boot';
import { SIZES, THEME_SCHEMA } from '../shared/logic/theme/ThemeTypes';
import { ThemeLaw } from '../shared/logic/theme/ThemeLaw';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { LoadoutSystem } from '../shared/entities/player/systems/LoadoutSystem';
import { CartSystem } from '../src/entities/world/CartSystem';
import { Rng } from '../shared/logic/rng/DeterministicRNG';

const SRC = (p: string) => readFileSync(p, 'utf8');
const cells = (n: { gridW: number; gridH: number }) => n.gridW * n.gridH;
const shippedCart = () => {
  const compiled = compileTheme(FIRST_THEME_PACK);
  return Object.values(compiled.items).flat().find((d: any) => d.cart) as any;
};
const mintKit = (template: any, key: string): IItem => ItemFactory.createFromTemplate(template, true, Rng.fromKey(key));

describe('the bed comes from a size word, through the formula', () => {
  it('the shipped theme\'s one cart keeps its bed of 10 by 8 and its weight, by the default', () => {
    const def = shippedCart();
    expect(def).toBeDefined();
    expect(def.cart.gridW).toBe(10);
    expect(def.cart.gridH).toBe(8);
    expect(cartNumbers({}).gridW).toBe(10);
    expect(cartNumbers({}).gridH).toBe(8);
    const kit = mintKit(def, 'carts:shipped');
    expect(kit.cartData!.gridW).toBe(10);
    expect(kit.cartData!.gridH).toBe(8);
    expect(kit.dimensions).toEqual({ width: 2, height: 3 });
    expect(kit.weight).toBe(15);
  });

  it('every size word gives a bed, each bigger than the one before, by one ratio and no list', () => {
    const beds = SIZES.map(size => cartNumbers({ size }));
    for (let i = 1; i < beds.length; i++) expect(cells(beds[i])).toBeGreaterThan(cells(beds[i - 1]));
    const ratios = beds.slice(1).map((b, i) => cells(b) / cells(beds[i]));
    for (const r of ratios) expect(Math.abs(r - ratios[0])).toBeLessThan(0.25);
  });

  it('rank grows a bed, and nothing stops it: the last rank and the last size still give a bed', () => {
    expect(cells(cartNumbers({ size: 'MEDIUM', rank: UniversalRank.E }))).toBeGreaterThan(cells(cartNumbers({ size: 'MEDIUM', rank: UniversalRank.F })));
    const top = cartNumbers({ size: SIZES[SIZES.length - 1], rank: UniversalRank.SSS });
    expect(Number.isFinite(top.gridW) && top.gridW > 0 && top.gridH > 0).toBe(true);
    expect(cartFolded(SIZES[SIZES.length - 1]).height).toBeGreaterThan(cartFolded('MEDIUM').height);
  });

  it('a cart has its own weight and a load it bears, and a better-made one bears more', () => {
    const def = shippedCart();
    const kits = Array.from({ length: 12 }, (_, i) => mintKit(def, `carts:quality:${i}`));
    for (const kit of kits) {
      expect(kit.cartData!.weight).toBeGreaterThan(0);
      expect(kit.cartData!.bears).toBeCloseTo(def.cart.bears * (1 + kit.quality), 0);
    }
  });

  it('a theme may write a size word on a kind; an unknown word is refused', () => {
    expect(JSON.stringify((THEME_SCHEMA.properties as any).gear.items.properties.size)).toContain('MEDIUM');
    const body = JSON.parse(JSON.stringify(FIRST_THEME_PACK));
    const cart = body.gear.find((g: any) => g.kind === 'cart');
    cart.size = 'LARGE';
    const large = compileTheme(sealTheme(body, 'test', 0));
    const def = Object.values(large.items).flat().find((d: any) => d.cart) as any;
    expect(cells(def.cart)).toBeGreaterThan(80);
    cart.size = 'ENORMOUS';
    expect(ThemeLaw.validate(body, () => true).ok).toBe(false);
  });
});

describe('the tow reads the load against what this cart bears', () => {
  it('no slower than towing at all while the load is borne; past it, slower; never stopped', () => {
    expect(LoadoutSystem.towSpeedModifier(30, 40)).toBe(LoadoutSystem.towSpeedModifier(0, 40));
    expect(LoadoutSystem.towSpeedModifier(80, 40)).toBeLessThan(LoadoutSystem.towSpeedModifier(30, 40));
    expect(LoadoutSystem.towSpeedModifier(100000, 40)).toBeGreaterThan(0);
  });

  it('an old cart that names no load it bears tows as every cart did', () => {
    expect(LoadoutSystem.towSpeedModifier(60)).toBe(Math.max(0.4, 0.75 - 60 / 400));
  });

  it('two carts with one load: the one that bears more tows faster', () => {
    const def = shippedCart();
    const kit = mintKit(def, 'carts:tow');
    const light = { ...kit, cartData: { ...kit.cartData!, bears: 10 } };
    const strong = { ...kit, id: 'itm_strong', cartData: { ...kit.cartData!, bears: 90 } };
    const load = Array.from({ length: 6 }, (_, i) => ({ ...kit, id: `load_${i}`, cartData: undefined, weight: 10, dimensions: { width: 1, height: 1 } })) as IItem[];
    let a = CartSystem.newCart(light, 'u', 'U');
    let b = CartSystem.newCart(strong, 'u', 'U');
    for (const piece of load) { a = CartSystem.load(a, piece)!; b = CartSystem.load(b, piece)!; }
    expect(CartSystem.towOf(b)).toBeGreaterThan(CartSystem.towOf(a));
  });
});

describe('fold and unfold give back the same cart', () => {
  it('a folded kit keeps its name, rank, quality, affixes and bed', () => {
    const def = shippedCart();
    const kit = { ...mintKit(def, 'carts:fold'), affixes: [{ id: 'afx_lock', name: 'Time-Locked', type: 'PREFIX', stats: { cart_lock: 2 } } as any] };
    const cart = CartSystem.newCart(kit, 'u', 'U');
    const back = CartSystem.fold(cart);
    expect(back).toEqual(kit);
    const again = CartSystem.newCart(back, 'u', 'U');
    expect({ ...again, items: [], layout: {} }).toEqual({ ...cart, items: [], layout: {} });
  });

  it('a cart saved before it kept its kit folds to a kit with its bed, as before', () => {
    const def = shippedCart();
    const cart = CartSystem.newCart(mintKit(def, 'carts:old'), 'u', 'U');
    const old = { ...cart, kit: undefined, gridW: 11, gridH: 7 };
    const back = CartSystem.fold(old as any);
    expect(back.id).toBe(cart.cartItemId);
    expect(back.cartData).toMatchObject({ gridW: 11, gridH: 7 });
  });
});

describe('the cart\'s window says what the bed is, and its lock and alarm, in words', () => {
  it('the words come from the cart, not a tone', () => {
    const def = shippedCart();
    const kit = { ...mintKit(def, 'carts:words'), affixes: [{ id: 'a', name: 'Shrieking', type: 'PREFIX', stats: { cart_lock: 1, cart_alarm: 1 } } as any] };
    const said = CartSystem.describe(CartSystem.newCart(kit, 'u', 'U'));
    expect(said.bed).toMatch(/10 by 8/);
    expect(said.lock).toMatch(/10s|10 s/);
    expect(said.alarm).toMatch(/shriek/i);
    const plain = CartSystem.describe(CartSystem.newCart(mintKit(def, 'carts:plain'), 'u', 'U'));
    expect(plain.lock).toMatch(/no lock/i);
    expect(plain.alarm).toMatch(/no alarm/i);
    const canvas = SRC('src/components/WorldCanvas.tsx');
    expect(canvas).toMatch(/CartSystem\.describe\(/);
    expect(canvas).toMatch(/CartSystem\.fold\(/);
  });
});
