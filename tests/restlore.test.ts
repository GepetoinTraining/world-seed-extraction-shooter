/**
 * A FORMING SKILL IS LEARNED AT A REST ONLY WITH THE LORE FOR IT. Registered before the build.
 *
 * Pedro, 2026-11-11, on skills still forming: "exactly, they don't count, they don't do anything yet,
 * and you need to have lore as a resource to actually be able to rollover a dream and learn them".
 * Asked "Should learning a forming skill at a rest ask for lore? Today it does not.": "Yes, ask for lore".
 *
 * Read as built, each for him to overrule (PLAYTEST_LEDGER.md):
 *  - the price is the lore law's own price for a skill: what a dream asks to teach one, by the skill's rank.
 *  - lore is asked only of a skill whose roll came good, and spent only when it is learned: a failed roll costs nothing.
 *  - when the purse covers only some, the skill most worked goes first, then by its id: nothing a replay would change.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../shared/entities/data/VectorStore', () => ({
  VectorNamespace: { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories' },
  VectorStore: { get: async () => null, put: async () => true, query: async () => [], saveContent: async () => true, searchContent: async () => [] }
}));
vi.mock('../src/entities/identity/certificateSystem', () => ({
  CertificateSystem: {
    signPayload: async (uid: string, payload: any) => ({ payload, signature: 'sig', certUid: uid, timestamp: 0 }),
    verifyPayload: async () => true,
    getPrivateKey: async () => null
  }
}));

import { IPlayer, ISkillProgress, ISkillState } from '../shared/types';
import { WebSystem } from '../shared/logic/systems/WebSystem';
import { LORE_TEACH_PRICE, loreTeachPrice } from '../shared/logic/systems/LoreConstants';
import { LoreSystem } from '../src/logic/systems/LoreSystem';
import { usePlayerStore, playerPort } from '../src/entities/player/store';
import { hubPort } from '../src/entities/hub/store';
import { useFeed } from '../src/components/ui/stores';
import { RestDoor } from '../src/logic/systems/RestDoor';

const PID = 'lore_student';

/** A forming skill worked far past what it asks, at the first attempt count whose keyed roll comes good. */
const ready = (tool: string[] | null, worked: string[], rank = 0, weight = 1_000_000): ISkillProgress => {
  const pair = WebSystem.mint(tool, worked);
  for (let attempts = 1; ; attempts++) {
    const progress: ISkillProgress = { id: pair.id, tags: pair.tags, rank, attempts, weight };
    if (WebSystem.emerges(progress, PID)) return progress;
  }
};
/** One whose roll never comes: too little work behind it. */
const unready = (tool: string[] | null, worked: string[]): ISkillProgress => {
  const pair = WebSystem.mint(tool, worked);
  return { id: pair.id, tags: pair.tags, rank: 0, attempts: 1, weight: 1 };
};

const person = (lore: number, forming: ISkillProgress[], held: ISkillState[] = []): IPlayer => ({
  id: PID, materialMastery: {}, skillProgress: Object.fromEntries(forming.map(p => [p.id, p])),
  bank: { loreHeld: lore, lore: {}, universalSkills: Object.fromEntries(held.map(s => [s.id, s])), stashTabs: [] }
} as unknown as IPlayer);

const axe = ready(['axe'], ['flora', 'wood']);
const pick = ready(['blunt'], ['mineral', 'stone']);

describe('a forming skill asks for lore at the rest (Pedro, 2026-11-11: "Yes, ask for lore")', () => {

  it('the price is the lore law\'s own price for a skill, by its rank, with no cap', () => {
    expect(WebSystem.learnPrice(0)).toBe(LORE_TEACH_PRICE);
    for (const rank of [0, 1, 2, 5, 9]) expect(WebSystem.learnPrice(rank)).toBe(LoreSystem.teachPrice(rank));
    expect(WebSystem.learnPrice(10)).toBeGreaterThan(WebSystem.learnPrice(9));
    expect(loreTeachPrice(3)).toBe(LoreSystem.teachPrice(3));
  });

  it('with the lore, a skill whose roll comes good is held, and exactly its price is gone', () => {
    const { player, emerged, wanting } = WebSystem.rest(person(100, [axe]));
    expect(emerged.map(s => s.id)).toEqual([axe.id]);
    expect(player.bank.universalSkills[axe.id]).toBeDefined();
    expect(player.skillProgress?.[axe.id]).toBeUndefined();
    expect(player.bank.loreHeld).toBe(100 - WebSystem.learnPrice(axe.rank));
    expect(wanting).toEqual([]);
  });

  it('without the lore it stays forming, whole, and no lore is lost', () => {
    const short = WebSystem.learnPrice(axe.rank) - 1;
    const { player, emerged, wanting } = WebSystem.rest(person(short, [axe]));
    expect(emerged).toEqual([]);
    expect(player.bank.universalSkills[axe.id]).toBeUndefined();
    expect(player.skillProgress?.[axe.id]).toEqual(axe);
    expect(player.bank.loreHeld).toBe(short);
    // The lore pass, 2026-11-11 ("in the same category yes, general lore no"): what wants lore says what it could use
    expect(wanting).toEqual([{ id: axe.id, price: WebSystem.learnPrice(axe.rank), held: short }]);
  });

  it('a roll that does not come good costs nothing, lore or no lore', () => {
    const idle = unready(['axe'], ['flora', 'wood']);
    const { player, emerged, wanting } = WebSystem.rest(person(1000, [idle]));
    expect(emerged).toEqual([]);
    expect(wanting).toEqual([]);
    expect(player.bank.loreHeld).toBe(1000);
    expect(player.skillProgress?.[idle.id]).toEqual(idle);
  });

  it('it is learned at a later rest once the lore is there, with no more work', () => {
    const first = WebSystem.rest(person(0, [axe])).player;
    const paid = { ...first, bank: { ...first.bank, loreHeld: 50 } };
    const second = WebSystem.rest(paid);
    expect(second.emerged.map(s => s.id)).toEqual([axe.id]);
    expect(second.player.bank.loreHeld).toBe(50 - WebSystem.learnPrice(axe.rank));
  });

  it('a skill already held, and one given at creation, ask nothing', () => {
    const given = WebSystem.freshSkill(pick.id, pick.tags, 0);
    const held = { ...WebSystem.freshSkill(axe.id, axe.tags, 0), level: 3 };
    const { player, emerged, wanting } = WebSystem.rest(person(100, [axe], [held, given]));
    expect(emerged).toEqual([]);
    expect(wanting).toEqual([]);
    expect(player.bank.loreHeld).toBe(100);
    expect(player.bank.universalSkills[axe.id]).toEqual(held);
    expect(player.bank.universalSkills[pick.id]).toEqual(given);
  });

  it('with lore for only some, the most worked goes first, then by id, the same every time', () => {
    const price = WebSystem.learnPrice(0);
    const heavyPick = { ...pick, weight: axe.weight + 10 };
    const out = WebSystem.rest(person(price, [axe, heavyPick]));
    expect(out.emerged.map(s => s.id)).toEqual([pick.id]);
    expect(out.wanting.map(w => w.id)).toEqual([axe.id]);
    const heavyAxe = { ...axe, weight: pick.weight + 10 };
    expect(WebSystem.rest(person(price, [heavyAxe, pick])).emerged.map(s => s.id)).toEqual([axe.id]);
    // Equal work: the id decides, and the order the record holds them in does not
    const even = [axe, { ...pick, weight: axe.weight }];
    const byId = [axe.id, pick.id].sort()[0];
    expect(WebSystem.rest(person(price, even)).emerged.map(s => s.id)).toEqual([byId]);
    expect(WebSystem.rest(person(price, [...even].reverse())).emerged.map(s => s.id)).toEqual([byId]);
  });

  it('the same rest replays the same', () => {
    const state = person(WebSystem.learnPrice(0) + 5, [axe, pick, unready(['sickle'], ['flora', 'fiber'])]);
    expect(WebSystem.rest(state)).toEqual(WebSystem.rest(state));
  });
});

describe('the person is told at the rest, both ways', () => {
  beforeEach(() => {
    useFeed.setState({ lines: [] });
  });

  const restWith = (lore: number, forming: ISkillProgress[]) => {
    usePlayerStore.setState(s => ({
      player: { ...s.player, id: PID, skillProgress: Object.fromEntries(forming.map(p => [p.id, p])), bank: { ...s.player.bank, loreHeld: lore, universalSkills: {} } }
    }));
    RestDoor.settle(playerPort, hubPort);
    return useFeed.getState().lines.map(l => l.text).join(' | ');
  };

  it('what was learned, and the lore it took', () => {
    const said = restWith(100, [axe]);
    expect(said).toContain(WebSystem.nameOf(axe.id));
    expect(said).toContain(`${WebSystem.learnPrice(0)} lore`);
    expect(said).toContain('The hands know it now');
  });

  it('what could not be learned for want of lore, and that it waits', () => {
    const said = restWith(3, [axe]);
    expect(said).toContain(WebSystem.nameOf(axe.id));
    expect(said).toContain(`${WebSystem.learnPrice(0)} lore`);
    expect(said).not.toContain('The hands know it now');
    expect(usePlayerStore.getState().player.skillProgress?.[axe.id]).toEqual(axe);
  });
});
