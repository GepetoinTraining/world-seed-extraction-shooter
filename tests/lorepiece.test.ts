/**
 * LORE AS A GOOD (the design pass, part 3). Registered before the build.
 *
 * Pedro, 2026-11-11: "once a player has a skill, a craft, anything related to the tech web they can produce the skill as a
 * lore piece to trade, sell, or even give." And of lore: "you never lose lore".
 *
 * What these bars hold, made by plain sense where no ruling says, and marked in the ledger (DP3):
 *  - only a skill held and rooted in the web (a lawful pair of tags) can be written out, and only at home, where the bench
 *    and the shelf are; writing it out never takes it from its writer;
 *  - it costs one piece of paper (anything made of the registered paper material) and what a sitting on that skill's own
 *    tree asks its writer (`studyAsk`), so the more of the tree they know, the cheaper the writing;
 *  - the piece is a document like any fragment: read through the lore rule as it stands, twice its stretch, filed under the
 *    skill's own category, and spent by a reading that pays fair or better (so a second reading of the same piece is only
 *    had after a little one, and pays by the rule again); reading it also teaches its skill, as a piece's design does;
 *  - it is worth what a trade's note sells for on the shelf, half again a rank.
 */

import { describe, it, expect } from 'vitest';
import { IItem, IPlayer, ISkillState, ItemType, Rarity, UniversalRank } from '../shared/types';
import { WebSystem } from '../shared/logic/systems/WebSystem';
import { LoreLaw } from '../shared/logic/systems/LoreLaw';
import { StudySystem } from '../src/logic/systems/StudySystem';
import { LorePiece, LORE_PIECE_VALUE } from '../src/logic/systems/LorePiece';
import { loreTeachPrice } from '../shared/logic/systems/LoreConstants';

const skill = (tool: string[] | null, worked: string[], xp = 0, rank = 0): ISkillState => {
  const pair = WebSystem.mint(tool, worked);
  return WebSystem.withCumulativeXp(WebSystem.freshSkill(pair.id, pair.tags, rank), xp);
};
const paper = (id: string): IItem => ({
  id, universalDefinitionId: 'crf_paper', name: 'Carbon Paper', description: '', type: ItemType.RESOURCE, rank: UniversalRank.F,
  rarity: Rarity.COMMON, quality: 0.5, level: 1, value: 3, itemPower: 1, tags: ['paper'], affixes: [],
  dimensions: { width: 1, height: 1 }, weight: 0.1, stats: {}, visuals: { modelId: 'm', colorHex: '#fff' }, icon: 'i', isIdentified: true
} as IItem);
const person = (skills: ISkillState[], stash: IItem[], over: Partial<IPlayer> = {}): IPlayer => ({
  id: 'p_writer', attributes: undefined, equipment: undefined, currentSession: undefined, skillProgress: {}, materialMastery: {},
  energyToday: 50, bank: { universalSkills: Object.fromEntries(skills.map(s => [s.id, s])), stashTabs: [{ name: 'tab', items: stash }], loreHeld: 0, gold: 0 },
  ...over
} as unknown as IPlayer);

const AXE = skill(['axe'], ['flora', 'wood'], 4000);
const WRITER = { uid: 'u_writer', name: 'Writer' };
const writer = () => person([AXE], [paper('pp_1'), paper('pp_2')]);

describe('only what is held and rooted in the web is written out, at home, on paper', () => {
  it('a held skill, at home, with paper and the energy, can be written', () => {
    expect(LorePiece.canWrite(writer(), AXE.id).ok).toBe(true);
  });

  it('a skill not held cannot', () => {
    expect(LorePiece.canWrite(person([], [paper('pp_1')]), AXE.id).ok).toBe(false);
  });

  it('nothing is written in the field', () => {
    const out = person([AXE], [paper('pp_1')], { currentSession: { inventory: [], energy: 50 } } as unknown as Partial<IPlayer>);
    expect(LorePiece.canWrite(out, AXE.id).ok).toBe(false);
  });

  it('with no paper, or too little energy, it says so', () => {
    expect(LorePiece.canWrite(person([AXE], []), AXE.id)).toMatchObject({ ok: false });
    expect(LorePiece.canWrite(person([AXE], [paper('pp_1')], { energyToday: 0 }), AXE.id)).toMatchObject({ ok: false });
  });
});

describe('writing costs paper and a sitting\'s ask, and never the skill', () => {
  const { player, item, cost } = LorePiece.write(writer(), AXE.id, WRITER, 77);

  it('the writer keeps the skill whole', () => {
    expect(player.bank.universalSkills[AXE.id]).toEqual(AXE);
  });

  it('one piece of paper is used and the energy a sitting on that tree asks of them is paid', () => {
    const ask = StudySystem.studyAsk(writer(), LorePiece.targetOf(AXE));
    expect(cost).toBe(ask.cost);
    expect(player.energyToday).toBe(50 - ask.cost);
    const left = player.bank.stashTabs[0].items;
    expect(left.filter(i => i.tags.includes('paper')).length).toBe(1);
    expect(left.some(i => i.id === item.id)).toBe(true);
  });

  it('knowing more of the tree makes the writing cheaper', () => {
    const novice = person([skill(['axe'], ['flora', 'wood'], 0)], [paper('pp_1')]);
    const master = person([AXE, skill(['saw'], ['flora', 'wood'], 4000)], [paper('pp_1')]);
    expect(LorePiece.write(master, AXE.id, WRITER, 1).cost).toBeLessThan(LorePiece.write(novice, AXE.id, WRITER, 1).cost);
  });

  it('the piece is a document carrying the skill, its rank and who wrote it, and when', () => {
    expect(item.type).toBe(ItemType.LORE);
    expect(StudySystem.isDocument(item)).toBe(true);
    expect(item.lorePiece).toEqual({ skillId: AXE.id, tags: AXE.tags, rank: 0, by: WRITER, at: 77 });
    expect(item.rank).toBe(UniversalRank.F);
    expect(item.value).toBe(LORE_PIECE_VALUE);
  });

  it('two pieces written are two goods', () => {
    const second = LorePiece.write(player, AXE.id, WRITER, 78);
    expect(second.item.id).not.toBe(item.id);
  });
});

describe('reading one goes through the lore rule as it stands', () => {
  const { item } = LorePiece.write(writer(), AXE.id, WRITER, 77);
  const reader = person([], [item]);
  const target = StudySystem.targetOfItem(item);

  it('a fair reading pays twice its stretch, as any document, filed under the skill\'s own category', () => {
    const paid = StudySystem.loreOf(reader, target, { stretch: 'fair', times: 1 });
    expect(paid.amount).toBe(LoreLaw.pay(0, 1, 2));
    expect(paid.category?.key).toBe(WebSystem.categoryOf(AXE.tags)!.key);
  });

  it('it teaches the skill it carries, as a piece\'s design does', () => {
    expect(LorePiece.teaches(item)).toEqual({ id: AXE.id, tags: AXE.tags });
    expect(LorePiece.teaches({ ...item, lorePiece: undefined })).toBeNull();
  });

  it('a higher rank is worth more on the shelf', () => {
    expect(LorePiece.worth(2)).toBeGreaterThan(LorePiece.worth(1));
    expect(LorePiece.worth(1)).toBeGreaterThan(LorePiece.worth(0));
  });
});

describe('the doors: written at home from the web, and read through study', () => {
  const SRC = (p: string) => require('node:fs').readFileSync(p, 'utf8') as string;
  it('the web view writes a held skill out through its own door, which takes its time and goes on the ledger', () => {
    expect(SRC('src/components/TechWebView.tsx')).toMatch(/LoreWriteDoor\.start/);
    expect(SRC('src/logic/systems/LoreWriteDoor.ts')).toMatch(/LORE_WRITTEN/);
  });
  it('a sitting on a written piece teaches the skill it carries', () => {
    expect(SRC('src/logic/systems/StudyDoor.ts')).toMatch(/LorePiece\.read\(/);
  });
  it('the piece carries its record on the item contract', () => {
    expect(SRC('shared/types.ts')).toMatch(/lorePiece\?:/);
  });
});

/**
 * Pedro, 2026-11-11, of skills a character is forming: "they don't count, they don't do anything yet, and you need to have
 * lore as a resource to actually be able to rollover a dream and learn them". So a piece read never hands its skill over:
 * it gives its lore by the lore rule, and makes the skill it carries ready to settle; a rest then asks the skill's price in
 * lore as it does for any forming skill, and waits, saying so, when the reader holds too little.
 */
describe('reading a piece makes its skill ready to settle, for its price in lore', () => {
  const SRC2 = (p: string) => require('node:fs').readFileSync(p, 'utf8') as string;
  const { item } = LorePiece.write(writer(), AXE.id, WRITER, 77);
  const reader = (lore: number) => person([], [item], { bank: { universalSkills: {}, stashTabs: [{ name: 'tab', items: [item] }], loreHeld: lore, gold: 0 } } as Partial<IPlayer>);

  it('reading never hands the skill over: it is forming, and ready', () => {
    const read = LorePiece.read(reader(0), item);
    expect(read.bank.universalSkills[AXE.id]).toBeUndefined();
    expect(read.skillProgress![AXE.id]).toMatchObject({ id: AXE.id, tags: AXE.tags, ready: true });
  });

  it('at a rest it settles for its price when the reader holds the lore', () => {
    const out = WebSystem.rest(LorePiece.read(reader(100), item));
    expect(out.emerged.map(s => s.id)).toEqual([AXE.id]);
    expect(out.player.bank.loreHeld).toBe(100 - loreTeachPrice(0));
    expect(out.player.skillProgress![AXE.id]).toBeUndefined();
  });

  it('with too little it waits, still ready, and the rest says so in its own words', () => {
    const out = WebSystem.rest(LorePiece.read(reader(10), item));
    expect(out.emerged).toEqual([]);
    expect(out.wanting).toEqual([{ id: AXE.id, price: loreTeachPrice(0), held: 10 }]);
    expect(out.player.bank.universalSkills[AXE.id]).toBeUndefined();
    expect(out.player.skillProgress![AXE.id].ready).toBe(true);
    expect(SRC2('src/logic/systems/RestDoor.ts')).toMatch(/was ready to settle, and it wants/);
  });

  it('a reader who already holds the skill gains nothing toward it', () => {
    const holder = person([AXE], [item]);
    expect(LorePiece.read(holder, item)).toBe(holder);
  });
});
