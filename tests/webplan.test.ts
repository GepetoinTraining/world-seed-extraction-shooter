/**
 * PLANNING ON THE TECH WEB (the design pass, part 2). Registered before the build.
 *
 * Pedro, 2026-11-11: "so people could minimally plan their lore". A person marks a thing on the web as what they are
 * working toward; the view says the way to it from what they know, and what that way would ask in lore, by category and
 * in general, set against what they hold. The mark is kept with the character and shown on the large sheet.
 *
 * Made by plain sense and marked in the ledger (W2): the way is the one that asks least lore, then has fewest steps,
 * then comes first by key; only a skill asks lore (what learning it asks: `learnPrice`); a station and a thing are steps
 * to stand at and to find, which ask none; the lore is spent as the law spends it, a category's own first and then
 * general, so a misreading locks its category here too.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../shared/entities/data/VectorStore', () => ({
  VectorNamespace: { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories' },
  VectorStore: { get: async () => null, put: async () => true, query: async () => [], saveContent: async () => true, searchContent: async () => [] }
}));
vi.mock('../src/entities/identity/certificateSystem', () => ({
  CertificateSystem: { signPayload: async (uid: string, payload: any) => ({ payload, signature: `sig_${uid}`, certUid: uid, timestamp: 0 }), verifyPayload: async () => true, getPrivateKey: async () => null }
}));

import { IHubWeb, IPlayer, ISkillState } from '../shared/types';
import { WebSystem } from '../shared/logic/systems/WebSystem';
import { WebBank } from '../shared/logic/content/WebBank';
import { WebMap } from '../src/logic/systems/WebMap';
import { usePlayerStore, playerPort } from '../src/entities/player/store';
import { useIdentityStore } from '../src/entities/identity/store';

const SRC = (p: string) => readFileSync(p, 'utf8');
const EMPTY: IHubWeb = { nodes: {} };

const known = (tool: string[] | null, worked: string[]): ISkillState => {
  const pair = WebSystem.mint(tool, worked);
  return WebSystem.freshSkill(pair.id, pair.tags, 0);
};
const person = (skills: ISkillState[], materials: string[], bank: Partial<IPlayer['bank']> = {}): IPlayer => ({
  id: 'p_plan', attributes: undefined, equipment: undefined, currentSession: undefined, skillProgress: {},
  materialMastery: Object.fromEntries(materials.map(id => [id, { resourceId: id, knowledgeLevel: 1, discoveredAffixes: [] }])),
  bank: { universalSkills: Object.fromEntries(skills.map(s => [s.id, s])), stashTabs: [], loreHeld: 0, ...bank }
} as unknown as IPlayer);

const knowsLog = person([], ['res_tree_log']);
const SAWPIT = 'station:stn_sawpit';
const sawpit = () => WebBank.current().stations.find(s => s.id === 'stn_sawpit')!;
const opensSawpit = (skillId: string) => {
  const tags = skillId.replace(/^skill_/, '').split('+');
  return sawpit().connection.tool.some(t => tags.includes(t)) && sawpit().connection.material.every(t => tags.includes(t));
};

describe('the way to a marked thing, from what is known', () => {
  it('a station whose opening skill is not held: learn one that works what they know, then stand at it', () => {
    const plan = WebMap.pathTo(knowsLog, { web: EMPTY }, SAWPIT);
    expect(plan.broken).toBe(false);
    expect(plan.steps.map(s => s.kind)).toEqual(['skill', 'station']);
    const skill = plan.steps[0];
    expect(opensSawpit(skill.ref)).toBe(true);
    expect(WebSystem.materialsOf(skill.tags!)).toContain('res_tree_log');
    expect(skill.price).toBe(WebSystem.learnPrice(skill.rank!));
    expect(plan.steps[1].ref).toBe('stn_sawpit');
  });

  it('the way that asks least is taken, and what is already held asks nothing', () => {
    const axe = known(['axe'], ['flora', 'wood']);
    const plan = WebMap.pathTo(person([axe], ['res_tree_log']), { web: EMPTY }, SAWPIT);
    expect(plan.steps).toEqual([]);
    expect(plan.lore.asked).toBe(0);
    expect(plan.lore.met).toBe(true);
  });

  it('a made thing asks for its station and what it is made of, and only the skills ask lore', () => {
    const plan = WebMap.pathTo(knowsLog, { web: EMPTY }, 'thing:crf_fine_board');
    expect(plan.steps.map(s => s.kind)).toEqual(['skill', 'station', 'thing']);
    expect(plan.lore.asked).toBe(plan.steps[0].price);
  });

  it('what cannot be reached from anything says so', () => {
    const plan = WebMap.pathTo(person([], []), { web: EMPTY }, 'station:no_such_station');
    expect(plan.broken).toBe(true);
  });

  it('an unknown step is never named', () => {
    const plan = WebMap.pathTo(knowsLog, { web: EMPTY }, 'thing:crf_fine_board');
    for (const step of plan.steps.filter(s => s.state === 'unknown')) expect(step.name).toBeUndefined();
  });
});

describe('what the way asks in lore, by category and in general, against what is held', () => {
  const price = () => WebMap.pathTo(knowsLog, { web: EMPTY }, SAWPIT).lore.asked;
  const flora = (held: number, misread = 0) => ({ 'family:flora': { key: 'family:flora', name: 'flora', held, misread } });

  it('its own category first, then general, as the law spends it', () => {
    const who = person([], ['res_tree_log'], { loreHeld: 15, loreKinds: flora(price() - 10) });
    const plan = WebMap.pathTo(who, { web: EMPTY }, SAWPIT);
    expect(plan.lore.lines).toEqual([{ key: 'family:flora', word: 'flora', asked: price(), fromOwn: price() - 10, fromGeneral: 10, short: 0 }]);
    expect(plan.lore.general).toEqual({ asked: 10, held: 15 });
    expect(plan.lore.met).toBe(true);
  });

  it('short is said with how much, and a misreading locks its category here too', () => {
    const who = person([], ['res_tree_log'], { loreHeld: 15, loreKinds: flora(500, 5) });
    const plan = WebMap.pathTo(who, { web: EMPTY }, SAWPIT);
    expect(plan.lore.lines[0]).toMatchObject({ fromOwn: 0, fromGeneral: 15, short: price() - 15 });
    expect(plan.lore.met).toBe(false);
    expect(plan.lore.short).toBe(price() - 15);
  });

  it('a category the person holds no lore of is not named on the way', () => {
    const plan = WebMap.pathTo(knowsLog, { web: EMPTY }, SAWPIT);
    // They know the log, so the skill's family is a word they may read; the key is never the word
    expect(plan.lore.lines[0].key).toBe('family:flora');
    const blind = WebMap.pathTo(person([], ['res_tree_log']), { web: EMPTY }, 'thing:crf_fine_board');
    for (const line of blind.lore.lines) expect(line.word === undefined || !line.word.includes(':')).toBe(true);
  });
});

describe('the mark is kept with the character and shown', () => {
  const CERT = (uid: string) => ({ metadata: { uid, displayName: 'PLAN', createdAt: 0 }, publicKey: {} as any, publicKeyJWK: {} as any }) as any;
  beforeEach(() => {
    localStorage.clear();
    useIdentityStore.setState({ certificate: CERT('uid_plan') } as any);
    usePlayerStore.getState().initializeSession(CERT('uid_plan'), 'NOMAD');
  });

  it('marking sets it on the character, and unmarking clears it', () => {
    playerPort.apply({ kind: 'WEB_GOAL', goal: { ref: SAWPIT, at: 5 } });
    expect(usePlayerStore.getState().player.webGoal).toEqual({ ref: SAWPIT, at: 5 });
    playerPort.apply({ kind: 'WEB_GOAL', goal: undefined });
    expect(usePlayerStore.getState().player.webGoal).toBeUndefined();
  });

  it('a marked goal draws its whole way, unknown steps unnamed, even past one step from what is known', () => {
    const who = { ...knowsLog, webGoal: { ref: 'thing:crf_fine_board', at: 1 } } as IPlayer;
    const map = WebMap.of(who, { web: EMPTY });
    const plan = WebMap.pathTo(who, { web: EMPTY }, 'thing:crf_fine_board');
    for (const step of plan.steps) {
      const n = map.nodes.find(m => m.id === step.id);
      expect(n, step.id).toBeDefined();
      expect(n!.onWay).toBe(true);
    }
    expect(map.nodes.find(n => n.id === 'thing:crf_fine_board')!.goal).toBe(true);
  });

  it('the large sheet says what is marked, and the view can mark and unmark', () => {
    expect(SRC('src/components/LargeSheet.tsx')).toMatch(/WORKING TOWARD/);
    expect(SRC('src/components/TechWebView.tsx')).toMatch(/WEB_GOAL/);
  });
});
