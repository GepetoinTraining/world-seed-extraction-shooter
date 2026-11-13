/**
 * WHEN A DESCRIPTION OPENS (UXS, 2026-11-12), bars set before the law and seen red.
 *
 * Pedro, on the sheet put to him as "numbers first and each sentence one step behind": "yup, and hover click opens
 * description, description opens only if the skill to describe it is found UAHUAHUA". The coordinator's reading: the skill
 * that describes a line is the skill in the tech web the line roots in, and every named thing roots in the web (Pedro,
 * 2026-11-07: "every stat ..., every skill, every affix - suffix, everything that's content pipelines and becomes something
 * named through study needs to be rooted in tech web").
 *
 * One pure law, under `shared/`, so a card can ask it too. It holds no table: a root is read from what a line's number is
 * read from, by rules the web already has.
 * - A skill's own line roots in that skill, and an act's line in the skill the act trains (`WorkCost.pairOf`): held, it opens.
 * - A line read from a thing in the hand roots in a skill whose every word is on the thing: the fight's own reading of a
 *   weapon (`WebSystem.handPower`), one predicate, `WebSystem.fits`.
 * - A line about a bench roots in a skill whose work opens the bench (`WebSystem.benchesOf`).
 * - A line the web roots nowhere is a gap. It opens on the nearest rule that does exist: a schooled eye held, the web's
 *   own skill for reading what is worked into a thing (the identify trades).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { ISkillState, IWebBatch, UniversalRank, Rarity } from '../shared/types';
import { TagLaw } from '../shared/logic/content/TagLaw';
import { WebBank } from '../shared/logic/content/WebBank';
import { WEB_BATCHES } from '../shared/entities/generation/packs/webBatches';
import { WebSystem } from '../shared/logic/systems/WebSystem';
import { WorkCost } from '../shared/logic/systems/WorkCost';
import { DescriptionLaw } from '../shared/logic/systems/DescriptionLaw';

const skill = (tags: string[], level = 1, over: Partial<ISkillState> = {}): ISkillState => {
  const canon = TagLaw.canonical(tags);
  return { ...WebSystem.freshSkill(TagLaw.skillIdOf(canon), canon, 0), level, ...over };
};
const held = (...skills: ISkillState[]): Record<string, ISkillState> => Object.fromEntries(skills.map(s => [s.id, s]));

const BOW = ['ranged', 'two_hand', 'physical', 'projectile'];
const BLADE = ['melee', 'one_hand', 'physical', 'blade'];

describe('a skill\'s own line opens when the skill is held', () => {
  it('held, it opens; forming or not there, it does not', () => {
    const saw = skill(['saw', 'flora', 'wood'], 3);
    expect(DescriptionLaw.opens(held(saw), DescriptionLaw.itself(saw.id))).toBe(true);
    expect(DescriptionLaw.opens({}, DescriptionLaw.itself(saw.id))).toBe(false);
    expect(DescriptionLaw.opens(undefined, DescriptionLaw.itself(saw.id))).toBe(false);
  });

  it('a track from an old save the web cannot read opens nothing, its own line included', () => {
    const old = { ...skill(['blade', 'melee']), id: 'skill_swordsmanship', legacy: true };
    expect(DescriptionLaw.opens(held(old), DescriptionLaw.itself(old.id))).toBe(false);
  });

  it('an act\'s line roots in the skill the act trains, the same pair its price reads', () => {
    const pair = WorkCost.pairOf('open')!;
    expect(pair).not.toBeNull();
    const scavenging = { ...skill(pair.tags, 2), id: pair.id };
    expect(DescriptionLaw.opens(held(scavenging), DescriptionLaw.itself(pair.id))).toBe(true);
    expect(DescriptionLaw.opens(held(skill(['social'], 4)), DescriptionLaw.itself(pair.id))).toBe(false);
  });
});

describe('a line read from what is in the hand opens with a skill the fight reads on it', () => {
  it('a skill whose every word is on the weapon opens it; one with a word the weapon lacks does not', () => {
    expect(DescriptionLaw.opens(held(skill(['projectile', 'ranged'])), DescriptionLaw.on(BOW))).toBe(true);
    expect(DescriptionLaw.opens(held(skill(['projectile', 'ranged', 'beast'])), DescriptionLaw.on(BOW))).toBe(false);
    expect(DescriptionLaw.opens(held(skill(['blade', 'melee'])), DescriptionLaw.on(BOW))).toBe(false);
    expect(DescriptionLaw.opens(held(skill(['melee'])), DescriptionLaw.on(BLADE))).toBe(true);
  });

  it('is the very reading the fight makes: a fitting skill of some level moves the blow, and opens the line', () => {
    for (const [tags, weapon] of [[['projectile', 'ranged'], BOW], [['blade', 'melee'], BOW], [['blade', 'melee'], BLADE], [['axe', 'flora', 'wood'], BLADE]] as [string[], string[]][]) {
      const s = skill(tags, 5);
      const player = { bank: { universalSkills: held(s) } } as never;
      const moves = WebSystem.handPower(player, { tags: weapon } as never) > 0;
      expect(DescriptionLaw.opens(held(s), DescriptionLaw.on(weapon)), `${tags} on ${weapon}`).toBe(moves);
      expect(WebSystem.fits(s, weapon)).toBe(moves);
    }
  });

  it('a hand with nothing on it has nothing to read, and is a gap', () => {
    expect(DescriptionLaw.on([])).toBe(DescriptionLaw.GAP);
  });
});

describe('a line about a bench opens with a skill whose work raises it', () => {
  const STRANGER: IWebBatch = {
    runId: 'run_description_stranger', model: 'test', ranAt: 1,
    tags: [
      { tag: 'froe', kind: 'tool', meaning: 'A wedge blade driven with a mallet to split staves, for this bar.' },
      { tag: 'bark', kind: 'material', meaning: 'The outer skin of a tree, stripped whole, for this bar.' }
    ],
    tools: [{ id: 'tool_froe_bar', name: 'Froe', tag: 'froe', rank: UniversalRank.F, basePower: 10, powerStat: 'chopping_power', works: ['bark'], verbs: [] }],
    materials: [{ id: 'mat_bark_bar', name: 'Stripped Bark', tags: ['flora', 'bark'], rank: UniversalRank.F, rarity: Rarity.COMMON, weight: 0.5 }],
    stations: [{ id: 'stn_barkshed_bar', name: 'Bark Shed', connection: { tool: ['froe'], material: ['bark'] }, bill: [{ tag: 'building', count: 2 }], minArea: 14, weight: 12, width: 2, height: 1 }]
  };
  it('the skill that connects it opens it, and another does not', () => {
    const compiled = WebBank.compile([...WEB_BATCHES, STRANGER]);
    expect(compiled.ok, compiled.reason).toBe(true);
    const pack = compiled.pack!;
    const froe = skill(['froe', 'bark', 'flora']);
    expect(WebSystem.benchesOf(froe.tags, pack)).toContain('stn_barkshed_bar');
    expect(DescriptionLaw.opens(held(froe), DescriptionLaw.bench('stn_barkshed_bar', pack))).toBe(true);
    expect(DescriptionLaw.opens(held(skill(['saw', 'flora', 'wood'])), DescriptionLaw.bench('stn_barkshed_bar', pack))).toBe(false);
  });
});

describe('a gap opens on the nearest rule that does exist: a schooled eye held', () => {
  it('an eye held opens it; no eye, a forming one, or any other skill does not', () => {
    const eye = skill(['identify_armor']);
    expect(DescriptionLaw.isEye(eye.tags)).toBe(true);
    expect(DescriptionLaw.isEye(['saw', 'flora', 'wood'])).toBe(false);
    expect(DescriptionLaw.opens(held(eye), DescriptionLaw.GAP)).toBe(true);
    expect(DescriptionLaw.opens(held(skill(['saw', 'flora', 'wood'], 9), skill(['projectile', 'ranged'], 9)), DescriptionLaw.GAP)).toBe(false);
    expect(DescriptionLaw.opens({}, DescriptionLaw.GAP)).toBe(false);
  });

  it('every eye in the shipped web is an eye by its own words, and nothing else in the web is', () => {
    const pack = WebBank.current();
    const eyes = pack.names.filter(n => DescriptionLaw.isEye(n.tags)).map(n => n.name).sort();
    expect(eyes).toEqual(['The Armor Eye', 'The Furniture Eye', 'The Goods Eye', 'The Tool Eye', 'The Weapon Eye']);
  });

  it('an eye opens a gap and never a root it does not pass: a skill line or a hand stays the skill\'s', () => {
    const eye = skill(['identify_weapon']);
    expect(DescriptionLaw.opens(held(eye), DescriptionLaw.on(BOW))).toBe(false);
    expect(DescriptionLaw.opens(held(eye), DescriptionLaw.itself(skill(['saw', 'flora', 'wood']).id))).toBe(false);
  });
});

describe('the law is pure and holds no table', () => {
  const PATH = 'shared/logic/systems/DescriptionLaw.ts';
  const code = () => readFileSync(PATH, 'utf8');

  it('reads nothing from the game\'s screens or stores', () => {
    expect(code()).not.toMatch(/from '\.\.\/\.\.\/\.\.\/src|zustand|from 'react'/);
  });

  it('names no tag of the web, no stat and no line of a sheet: every word it reads comes from the thing or the skill', () => {
    const file = ts.createSourceFile(PATH, code(), ts.ScriptTarget.Latest, true);
    const strings: string[] = [];
    const visit = (n: ts.Node) => {
      if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && !ts.isImportDeclaration(n.parent)) strings.push(n.text);
      ts.forEachChild(n, visit);
    };
    visit(file);
    const registered = new Set(WebBank.current().tags.map(t => t.tag));
    const sheetWords = /^(DAMAGE|ATTACKS|PROTECTION|DODGE|BLOCK|CRIT|GLANCE|WALK|SIGHT|CARRY|HEALTH|ENERGY|strength|agility|dexterity|perception)$/i;
    expect(strings.filter(s => registered.has(s) || sheetWords.test(s))).toEqual([]);
  });

  it('the sheet\'s eye fold and the law\'s eye are one rule', () => {
    expect(readFileSync('src/logic/systems/SkillSay.ts', 'utf8')).toMatch(/DescriptionLaw\.isEye\(/);
  });

  it('the fight\'s reading of a weapon and the law\'s are one predicate', () => {
    expect(readFileSync('shared/logic/systems/WebSystem.ts', 'utf8')).toMatch(/handPower[\s\S]{0,400}this\.fits\(/);
    expect(code()).toMatch(/WebSystem\.fits\(/);
  });
});
