/**
 * THE FIRST GIFT ASKS ONE CIRCLE (2026-11-11).
 *
 * Asked "A first gift now takes nine levels. Lower what a gift asks from three circles to one?", Pedro
 * answered "Lower to one", and then: "how about first gift is one, first gift new skill is 3, so the
 * first first is one". So the very first gift a character takes, in whichever skill, asks one circle;
 * the first gift of every other skill asks three, as a gift always has; and a later gift in a skill
 * counts on in threes from where its first left off. What a gift costs in lore is not touched.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const db = new Map<string, any>();
vi.mock('../shared/entities/data/VectorStore', () => ({
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

import { IPlayer, ISkillGift } from '../shared/types';
import { usePlayerStore } from '../src/entities/player/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { WebSystem } from '../shared/logic/systems/WebSystem';
import { CIRCLES_FOR_A_FIRST_GIFT, CIRCLES_FOR_A_GIFT, CircleSystem, IGiftWords } from '../src/logic/systems/CircleSystem';

const CERT = (uid: string, name = 'TESTER') => ({ metadata: { uid, displayName: name, createdAt: 0 }, publicKey: {} as any }) as any;
const player = () => usePlayerStore.getState().player;

const axe = () => WebSystem.mint(['axe'], ['wood']);
const pick = () => WebSystem.mint(['pickaxe'], ['stone']);

/** A character holding these skills at these circles, and these gifts. */
const holding = (circles: Record<string, number>, gifts: Record<string, ISkillGift[]> = {}): IPlayer => {
  const p = player();
  const skills = { axe: axe(), pick: pick() } as Record<string, { id: string; tags: string[] }>;
  const universalSkills = Object.fromEntries(Object.entries(circles).map(([k, c]) => [skills[k].id, { ...WebSystem.freshSkill(skills[k].id, skills[k].tags, 0), circles: c }]));
  const skillGifts = Object.fromEntries(Object.entries(gifts).map(([k, g]) => [skills[k].id, g]));
  return { ...p, levelsBanked: 99, bank: { ...p.bank, loreHeld: 1_000_000, universalSkills }, skillGifts: Object.keys(skillGifts).length ? skillGifts : undefined };
};
const word = (skill: string): IGiftWords => ({ skill, kind: 'passive', name: 'Long Grain', blurb: 'You read the wood.', elements: [], delivery: '', effect: '', cost: '', stat: 'carry_capacity', band: 'moderate' });
const asked = (p: IPlayer) => CircleSystem.asks(p).map(a => a.id);
/** A gift from before this rule: it carries no mark. */
const oldGift = (id: string): ISkillGift => ({ id, kind: 'passive', name: 'Old Grain', blurb: 'From before.', stat: 'carry_capacity', value: 1 });
/** Set one skill's circles on a character, keeping everything else. */
const at = (p: IPlayer, skillId: string, circles: number): IPlayer =>
  ({ ...p, bank: { ...p.bank, universalSkills: { ...p.bank.universalSkills, [skillId]: { ...(p.bank.universalSkills[skillId] ?? WebSystem.freshSkill(skillId, pick().tags, 0)), circles } } } });

beforeEach(() => {
  db.clear();
  localStorage.clear();
  useIdentityStore.setState({ certificate: CERT('uid_firstgift') });
  usePlayerStore.getState().initializeSession(CERT('uid_firstgift'), 'NOMAD');
});

describe('the first gift a character takes asks one circle', () => {
  it('one for the very first, three for any other, and three is still the number', () => {
    expect(CIRCLES_FOR_A_FIRST_GIFT).toBe(1);
    expect(CIRCLES_FOR_A_GIFT).toBe(3);
  });

  it('a character with no gift and one circle in a skill can take that skill\'s gift', () => {
    const p = holding({ axe: 1 });
    expect(asked(p)).toEqual([axe().id]);
    expect(CircleSystem.asks(p)[0].owed).toBe(1);
    expect(CircleSystem.judgeAll([word(axe().id)], p, [axe().id]).ok).toBe(true);
    expect(CircleSystem.fill(holding({ axe: 0 }), axe().id).owed).toBe(true);
  });

  it('a skill with no circle has no gift, and a new character is asked nothing', () => {
    expect(asked(holding({ axe: 0 }))).toEqual([]);
    expect(CircleSystem.asks(player())).toEqual([]);
  });

  it('once they hold any gift, a second skill with one or two circles cannot, and with three can', () => {
    const gifted = CircleSystem.apply(holding({ axe: 1 }), [word(axe().id)]);
    expect(CircleSystem.giftsOf(gifted, axe().id)[0].first).toBe(true);
    expect(asked(gifted)).toEqual([]);
    expect(asked(at(gifted, pick().id, 1))).toEqual([]);
    expect(asked(at(gifted, pick().id, 2))).toEqual([]);
    expect(asked(at(gifted, pick().id, 3))).toEqual([pick().id]);
    expect(CircleSystem.fill(at(gifted, pick().id, 0), pick().id).owed).toBe(false);
  });

  it('only one skill takes the first gift: the one with the most circles, then the first by its name', () => {
    expect(asked(holding({ axe: 1, pick: 2 }))).toEqual([pick().id]);
    const tie = asked(holding({ axe: 1, pick: 1 }));
    expect(tie).toEqual([[axe().id, pick().id].sort()[0]]);
  });

  it('the first skill counts on in threes from its one: its next gift at four, then seven', () => {
    const gifted = CircleSystem.apply(holding({ axe: 1 }), [word(axe().id)]);
    expect(asked(at(gifted, axe().id, 2))).toEqual([]);
    expect(asked(at(gifted, axe().id, 3))).toEqual([]);
    expect(CircleSystem.asks(at(gifted, axe().id, 4))[0]).toMatchObject({ id: axe().id, owed: 1 });
    const twice = CircleSystem.apply(at(gifted, axe().id, 4), [word(axe().id)]);
    expect(CircleSystem.giftsOf(twice, axe().id).map(g => !!g.first)).toEqual([true, false]);
    expect(asked(at(twice, axe().id, 6))).toEqual([]);
    expect(CircleSystem.asks(at(twice, axe().id, 7))[0].owed).toBe(1);
  });

  it('a skill already holding a gift is not made cheaper: a save from before asks three more, and so does every other skill', () => {
    const old = holding({ axe: 3, pick: 1 }, { axe: [oldGift('gift_old_0')] });
    expect(asked(old)).toEqual([]);
    expect(asked(at(old, axe().id, 5))).toEqual([]);
    expect(asked(at(old, axe().id, 6))).toEqual([axe().id]);
    expect(asked(at(old, pick().id, 2))).toEqual([]);
  });

  it('the sheet groups a skill\'s circles from where its first gift falls', () => {
    expect(CircleSystem.firstAsks(holding({ axe: 1 }), axe().id)).toBe(1);
    expect(CircleSystem.firstAsks(holding({ axe: 1, pick: 2 }), axe().id)).toBe(3);
    expect(readFileSync('src/components/PlayerHub.tsx', 'utf8')).toMatch(/<Circles filled=\{row\.circles\} first=\{CircleSystem\.firstAsks\(/);
  });

  it('the same inputs give the same answer', () => {
    const p = holding({ axe: 1, pick: 1 });
    expect(CircleSystem.asks(p)).toEqual(CircleSystem.asks(p));
    expect(CircleSystem.apply(p, [word(axe().id)])).toEqual(CircleSystem.apply(p, [word(axe().id)]));
  });
});
