/**
 * THE FORCED EXIT: line 119's last clause (D77, D96).
 *
 * One word, one reader, and two ways of reaching it: an item and a spell are not two
 * systems. Registered before the build. The first theme took its entry when the wave
 * joined, so these bars take it back out and hold a pack that writes it their own way.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { IPlayer, ItemType } from '../types';
import { EffectSystem, IEffectAbility } from '../src/logic/systems/EffectSystem';
import { WeaveSystem } from '../src/logic/systems/WeaveSystem';
import { CircleSystem, IGiftWords } from '../src/logic/systems/CircleSystem';
import { BASE_CHANNEL_MS, StatSystem } from '../src/logic/systems/StatSystem';
import { COST_BANDS, EFFECTS, IThemeBody, RANKS, THEME_SCHEMA } from '../src/logic/theme/ThemeTypes';
import { abilityNumbers, FORCED_EXIT_COST, FORCED_EXIT_FLOOR_RANK, forcedExitWorth, materialNumbers, rankStep, shelfPrice } from '../src/logic/theme/ThemeFormula';
import { ThemeLaw } from '../src/logic/theme/ThemeLaw';
import { compileTheme, sealTheme } from '../src/logic/theme/ThemeCompiler';
import { ContentRegistry } from '../src/logic/theme/ContentRegistry';
import { FIRST_THEME_PACK, installShippedThemes } from '../src/logic/theme/boot';
import { FIRST_THEME } from '../src/entities/generation/packs/firstTheme';
import { RESOURCE_DEFINITIONS } from '../src/entities/item/data/resourceDefinitions';
import { ItemFactory } from '../src/entities/item/ItemFactory';
import { usePlayerStore } from '../src/entities/player/store';
import { Rng, fnv1a } from '../src/logic/rng/DeterministicRNG';
import { TagLaw } from '../src/logic/content/TagLaw';
import { buildRestRequest, buildThemeRequest } from '../server/intelligence/prompts';
import { GRID_H, GRID_W } from '../src/entities/player/systems/InventorySystem';

installShippedThemes();

const ELEMENT = 'seal';
const WAY_OUT = {
  key: 'breach_of_contract', name: 'Breach of Contract', blurb: 'Void where you stand, at a price.',
  elements: [ELEMENT], delivery: 'self' as const, effect: 'forced_exit' as const, cost: 'extreme' as const
};
const WRIT = {
  key: 'writ_of_breach', name: 'Writ of Breach', blurb: 'Read it and leave. Keep the receipt.',
  kind: 'scroll' as const, rank: 'C' as const, tags: ['consumable'], casts: WAY_OUT.key, onShelf: true
};

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const withWayOut = (mutate: (b: IThemeBody) => void = () => {}): IThemeBody => {
  const body = clone(FIRST_THEME) as IThemeBody;
  body.abilities = body.abilities.filter(a => a.key !== WAY_OUT.key);
  body.consumables = body.consumables.filter(c => c.key !== WRIT.key);
  body.abilities.push(clone(WAY_OUT));
  body.consumables.push(clone(WRIT));
  mutate(body);
  return body;
};
const judge = (body: IThemeBody) => ContentRegistry.judge(body);

const ability = (over: Partial<IEffectAbility> = {}): IEffectAbility => ({
  id: 'way_out', name: 'Way Out', elements: [ELEMENT], delivery: 'self', effect: 'forced_exit', cost: 'extreme', ...over
});
const receiptOf = (over: Partial<IEffectAbility> = {}, rank = 'D') => EffectSystem.resolve(ability(over), { rank }, 'k');

const giftWords = (over: Partial<IGiftWords> = {}): IGiftWords => ({
  skill: 'skill_felling', kind: 'active', name: 'Felled Door', blurb: 'The wall was a tree once.', elements: [ELEMENT],
  delivery: 'self', effect: 'forced_exit', cost: 'extreme', stat: '', band: '', ...over
});

describe('the one word has one real reader', () => {
  it('the word is in the vocabulary, and the reader gives it a way out and nothing else', () => {
    expect(EFFECTS).toContain('forced_exit');
    expect(receiptOf().exit).toBeDefined();
    expect(receiptOf().status).toBeUndefined();
    for (const effect of EFFECTS.filter(e => e !== 'forced_exit')) {
      expect(EffectSystem.resolve(ability({ effect, delivery: 'ranged', cost: 'medium' }), { rank: 'D' }, 'k').exit, effect).toBeUndefined();
    }
  });

  it('it lands on the one who opens it, wherever it was aimed', () => {
    expect(EffectSystem.landsOnCaster('forced_exit', 'ranged')).toBe(true);
  });

  it('the same casting gives the same receipt on every machine', () => {
    expect(receiptOf()).toEqual(receiptOf());
    // The way out does not get cheaper or quicker with the caster's rank: it is the band's own price
    expect(receiptOf({}, 'F').exit).toEqual(receiptOf({}, 'SSS').exit);
    expect(receiptOf({}, 'F').aether).toBe(receiptOf({}, 'SSS').aether);
  });

  it('the schema a model writes under and the door a gift comes through both offer it', () => {
    const schema = JSON.stringify(THEME_SCHEMA);
    expect(schema).toContain('forced_exit');
    expect(JSON.stringify(buildRestRequest({}, {}))).toContain('forced_exit');
  });

  it('the prompt says what the law will hold it to', () => {
    const told = JSON.stringify(buildThemeRequest([], {}));
    expect(told).toContain('forced_exit');
    expect(told).toContain(FORCED_EXIT_COST);
    expect(told).toContain(`rank ${FORCED_EXIT_FLOOR_RANK}`);
  });
});

describe('it costs a lot, through the formula, and plainly more than an ordinary exit', () => {
  it('its band is the top of the bands', () => {
    expect(FORCED_EXIT_COST).toBe(COST_BANDS[COST_BANDS.length - 1]);
    const numbers = abilityNumbers(FORCED_EXIT_COST, 'F');
    const below = abilityNumbers(COST_BANDS[COST_BANDS.length - 2], 'F');
    expect(numbers.aether).toBeGreaterThan(below.aether);
    expect(numbers.energy).toBeGreaterThan(below.energy);
  });

  it('it takes longer to open than the beacon, and the same stat shortens both alike', () => {
    expect(receiptOf().exit!.channelMs).toBeGreaterThan(BASE_CHANNEL_MS);
    const attributes = { hacking: 40 } as IPlayer['attributes'];
    const beacon = StatSystem.channelMs(BASE_CHANNEL_MS, attributes);
    const forced = StatSystem.channelMs(receiptOf().exit!.channelMs, attributes);
    expect(beacon).toBeLessThan(BASE_CHANNEL_MS);
    expect(forced).toBeGreaterThan(beacon);
  });

  it('the spell asks more of the reserves than a beginner can hold in one element', () => {
    const each = WeaveSystem.aetherPerElement(ability(), 'F');
    expect(each).toBeGreaterThan(WeaveSystem.capacity({ focus: 0 } as IPlayer['attributes']));
    expect(WeaveSystem.canCast({ reserves: { [ELEMENT]: each - 1 } } as unknown as IPlayer, ability(), 'F').ok).toBe(false);
    const paying = { reserves: { [ELEMENT]: each } } as unknown as IPlayer;
    expect(WeaveSystem.canCast(paying, ability(), 'F').ok).toBe(true);
    expect(WeaveSystem.spend(paying, ability(), 'F').reserves![ELEMENT]).toBe(0);
  });

  it('splitting it over more elements takes as much in all', () => {
    const elements = ['a', 'b', 'c', 'd', 'e'];
    const total = WeaveSystem.aetherPerElement(ability({ elements }), 'F') * elements.length;
    expect(total).toBeGreaterThanOrEqual(abilityNumbers(FORCED_EXIT_COST, 'F').aether);
  });

  it('at any lawful rank the writ costs more than the levy on a full pack of rare goods of that rank', () => {
    const DEFAULT_LEVY = 0.05;
    for (const rank of RANKS.filter(r => rankStep(r) >= rankStep(FORCED_EXIT_FLOOR_RANK))) {
      const rare = materialNumbers({ rank, form: 'vein', weight: 'light', worth: 'rare' }).value;
      const levy = GRID_W * GRID_H * rare * DEFAULT_LEVY;
      expect(forcedExitWorth(rank) * 3, rank).toBeGreaterThan(levy);
    }
  });

  it('it is priced by its band, unlike any other scroll', () => {
    expect(forcedExitWorth('C')).toBeGreaterThan(shelfPrice('C'));
  });

  it('a person who reads it on the shelf pays what the formula says, not the floor every scroll sells at', () => {
    const pack = sealTheme(withWayOut(), 'test', 1);
    expect(ContentRegistry.install(pack)).toEqual({ ok: true });
    const def = Object.values(compileTheme(pack).resources).find(r => r.name === WRIT.name)!;
    const item = ItemFactory.createResourceItem(def, Rng.fromKey('shelf'));
    expect(item.value).toBe(forcedExitWorth('C'));
    const plain = Object.values(compileTheme(pack).resources).find(r => r.name === 'Writ of Notice')!;
    expect(ItemFactory.createResourceItem(plain, Rng.fromKey('shelf')).value).toBeLessThan(5);
  });
});

describe('the law holds it to that price, whoever writes it', () => {
  it('a pack that follows the rules is lawful, and nothing else in it moves', () => {
    expect(judge(withWayOut())).toEqual({ ok: true });
    expect(judge(FIRST_THEME as IThemeBody)).toEqual({ ok: true });
  });

  it('any cheaper band is refused', () => {
    for (const cost of COST_BANDS.filter(c => c !== FORCED_EXIT_COST)) {
      const v = judge(withWayOut(b => { b.abilities.find(a => a.key === WAY_OUT.key)!.cost = cost; }));
      expect(v.ok, cost).toBe(false);
      expect(v.reason, cost).toMatch(/extreme/);
    }
  });

  it('it opens where you stand, or not at all', () => {
    const v = judge(withWayOut(b => { b.abilities.find(a => a.key === WAY_OUT.key)!.delivery = 'ranged'; }));
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/self/);
  });

  it('nothing is born knowing it, so defeating a thing cannot teach it for free', () => {
    const v = judge(withWayOut(b => { b.creatures[0].innate = [WAY_OUT.key]; }));
    expect(v.ok).toBe(false);
    expect(v.reason).toContain(WAY_OUT.key);
  });

  it('a line that changes cannot come to know it either', () => {
    const v = ThemeLaw.validateLine(
      { name: 'Breaching Rat', blurb: 'It left.', tags: [], features: ['tail'], innate: [WAY_OUT.key] },
      withWayOut(), [], () => true
    );
    expect(v.ok).toBe(false);
    expect(v.reason).toContain(WAY_OUT.key);
  });

  it('no worn piece fires it, since a trigger pays nothing', () => {
    const v = judge(withWayOut(b => {
      const piece = b.gear.find(g => g.carries)!;
      piece.carries = WAY_OUT.key;
    }));
    expect(v.ok).toBe(false);
    expect(v.reason).toContain(WAY_OUT.key);
  });

  it('a writ below the floor rank is refused, and so is anything but a scroll', () => {
    const low = judge(withWayOut(b => { b.consumables.find(c => c.key === WRIT.key)!.rank = 'F'; }));
    expect(low.ok).toBe(false);
    expect(low.reason).toContain(FORCED_EXIT_FLOOR_RANK);
    const food = judge(withWayOut(b => { b.consumables.find(c => c.key === WRIT.key)!.kind = 'heal'; }));
    expect(food.ok).toBe(false);
    expect(food.reason).toMatch(/scroll/);
  });

  it('a gift is judged by the same words', () => {
    const asked = ['skill_felling'];
    expect(CircleSystem.judge(giftWords(), asked).ok).toBe(true);
    expect(CircleSystem.judge(giftWords({ cost: 'low' }), asked).reason).toMatch(/extreme/);
    expect(CircleSystem.judge(giftWords({ delivery: 'area' }), asked).reason).toMatch(/self/);
  });
});

describe('a weave never lands on it by chance, and no weave changes', () => {
  // The list as it stood before the word, in its own order. The hash's reading of it must not move.
  const BEFORE = ['damage', 'control', 'heal', 'buff', 'debuff', 'ward'];
  const sets = Array.from({ length: 400 }, (_, i) => [`e${i}`, ...(i % 3 === 0 ? [`f${i}`] : [])]);

  it('no set of elements hashes to a way out', () => {
    for (const set of sets) expect(WeaveSystem.weave(set).effect).not.toBe('forced_exit');
  });

  it('every set still does what it did', () => {
    for (const set of sets) {
      const hash = fnv1a(`weave:v1:${TagLaw.canonical(set).join('+')}`);
      expect(WeaveSystem.weave(set).effect, set.join('+')).toBe(BEFORE[hash % BEFORE.length]);
    }
  });
});

describe('an item and a spell reach the one mechanic', () => {
  beforeEach(() => {
    usePlayerStore.setState(s => ({
      pendingCast: null,
      player: {
        ...s.player,
        currentSession: {
          sessionId: 's', worldId: 'w', position: { x: 0, y: 0, z: 0 }, health: 100, maxHealth: 100, energy: 100,
          inventory: [], kitItemIds: [], inventoryLayout: {}, activeEffects: []
        } as never
      }
    }));
  });

  it('the scroll is read through the existing path and names the ability', () => {
    const pack = sealTheme(withWayOut(), 'test', 1);
    expect(ContentRegistry.install(pack)).toEqual({ ok: true });
    const compiled = ContentRegistry.compiled(pack.themeId)!;
    const way = Object.values(compiled.abilities).find(a => a.name === WAY_OUT.name)!;
    expect(way.effect).toBe('forced_exit');

    const def = Object.values(RESOURCE_DEFINITIONS).find(r => r.name === WRIT.name && r.themeId === pack.themeId)!;
    expect(def.type).toBe(ItemType.CONSUMABLE);
    const scroll = ItemFactory.createResourceItem(def, Rng.fromKey('writ'));
    usePlayerStore.setState(s => ({ player: { ...s.player, currentSession: { ...s.player.currentSession!, inventory: [scroll] } } }));

    usePlayerStore.getState().consumeItem(scroll.id);
    const after = usePlayerStore.getState();
    expect(after.pendingCast).toBe(way.id);
    expect(after.player.currentSession!.inventory).toHaveLength(0); // the price is paid by reading it
    expect(EffectSystem.resolve(ContentRegistry.ability(after.pendingCast!)!, { rank: 'F' }, 'k').exit).toBeDefined();
  });

  it('a gift casts it through the same door, and it opens the same way out', () => {
    const player = {
      ...usePlayerStore.getState().player,
      bank: { ...usePlayerStore.getState().player.bank, universalSkills: { skill_felling: { id: 'skill_felling', tags: [], circles: 3 } } },
      skillGifts: {}
    } as unknown as IPlayer;
    const gifted = CircleSystem.apply(player, [giftWords()]);
    const giftId = gifted.skillGifts!.skill_felling[0].id;
    const asSpell = CircleSystem.abilityOf(gifted, giftId)!;
    expect(asSpell.effect).toBe('forced_exit');

    const pack = sealTheme(withWayOut(), 'test', 1);
    ContentRegistry.install(pack);
    const asItem = Object.values(ContentRegistry.compiled(pack.themeId)!.abilities).find(a => a.name === WAY_OUT.name)!;
    const spell = EffectSystem.resolve(asSpell, { rank: 'F' }, 'k');
    const item = EffectSystem.resolve(asItem, { rank: 'F' }, 'k');
    expect(spell.exit).toEqual(item.exit);
    expect(spell.energy).toBe(item.energy);
    expect(CircleSystem.say(gifted.skillGifts!.skill_felling[0])).not.toContain('_');
  });

  it('neither road holds a second way of leaving: both end at the field\'s one channel', () => {
    const scanned = ['src/entities/player/store.ts', 'src/components/TheWorking.tsx', 'src/logic/systems/WeaveSystem.ts', 'src/logic/systems/CircleSystem.ts']
      .map(f => [f, readFileSync(f, 'utf8')] as const);
    for (const [file, text] of scanned) {
      expect(text.includes('completeExtraction'), file).toBe(false);
      expect(text.includes('ExitLevy'), file).toBe(false);
    }
  });
});

describe('the gate and the channel', () => {
  it('a gate that is up takes nobody', () => {
    expect(EffectSystem.gateTakes('UP', false)).toBe(false);
    expect(EffectSystem.gateTakes('UP', true)).toBe(false);
  });

  it('a gate that has shut takes whoever has no way out open', () => {
    expect(EffectSystem.gateTakes('OFF', false)).toBe(true);
    expect(EffectSystem.gateTakes('SCAN', false)).toBe(true);
  });

  it('a way out opened before the close holds through it', () => {
    expect(EffectSystem.gateTakes('OFF', true)).toBe(false);
    expect(EffectSystem.gateTakes('SCAN', true)).toBe(false);
  });
});

describe('the field reads it: one channel, one receipt, one levy', () => {
  const canvas = readFileSync('src/components/WorldCanvas.tsx', 'utf8');
  const count = (needle: string) => canvas.split(needle).length - 1;

  it('the player\'s side of the door opens it from the receipt, for a scroll and a cast alike', () => {
    expect(canvas).toMatch(/applyPlayerReceipt[\s\S]{0,200}receipt\.exit/);
    expect(canvas).toContain('openForcedExit(');
  });

  it('there is still one way a channel ends well, and one levy', () => {
    expect(count('completeExtraction();')).toBe(1);
    expect(count('ExitLevy.charge(')).toBe(1);
    expect(count('ExitLevy.attemptNow(')).toBe(1);
  });

  it('the channel is read through the stat that shortens the beacon\'s', () => {
    expect(canvas).toMatch(/StatSystem\.channelMs\(exit\.channelMs/);
  });

  it('harm breaks it where it breaks the beacon\'s: the same line, no second check', () => {
    expect(count('CHANNEL BROKEN')).toBe(1);
  });

  it('holding the button cannot pay twice for one way out', () => {
    expect(canvas).toMatch(/ability\.effect === 'forced_exit' && forcedOpen\(\)/);
  });

  it('the gate asks the reader whether it takes this run', () => {
    expect(canvas).toContain('EffectSystem.gateTakes(');
    expect(canvas).not.toMatch(/moment\.phase !== 'UP'\) \{\s*endRun/);
  });

  it('the way out is drawn by shape, and the receipt says it was forced', () => {
    expect(canvas).toMatch(/channeling === 'FORCED'[\s\S]{0,300}dashed/);
    expect(readFileSync('src/components/ReceiptScreen.tsx', 'utf8')).toContain('receipt.forced');
  });
});

describe('nothing that stands moved', () => {
  it('the first theme still seals to the same id', () => {
    expect(sealTheme(FIRST_THEME as IThemeBody, FIRST_THEME_PACK.model, FIRST_THEME_PACK.writtenAt).themeId).toBe(FIRST_THEME_PACK.themeId);
  });

  // Moved on purpose (D115): an anchor has a worth of its own too, since its weight cannot price it.
  it('only what casts the word, and what holds value, has a worth of its own', () => {
    const worthy = Object.values(compileTheme(FIRST_THEME_PACK).resources).filter(def => (def as { worth?: number }).worth !== undefined && !def.anchor);
    expect(worthy.map(def => def.name)).toEqual(['Writ of Breach']);
  });
});
