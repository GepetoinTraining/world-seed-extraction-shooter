/**
 * WHAT THE SHEETS SAY (2026-11-12), bars set before the fixes, from Pedro's pictures of his large sheet after his round.
 *
 * SV1: kept numbers reached the screen raw: "130 of 130.35213707168586" health, "7 of 52.05700071542524" energy,
 * "15.0 of 85.06564579119595 kg" carry. What is shown is rounded by one rule (whole from ten up, a tenth below, a whole
 * number as it is); what is kept is not touched.
 * SV2: the forming list read "the eye" three times, one under another: each identify skill forming on an unread piece is
 * named "the eye" so the sheet does not say what the piece was (D32). Rows that read alike are folded into one, which
 * shows the furthest of them.
 * SV3: the explanations under IN A FIGHT said what the code no longer does ("at most 60%" for protection, which has had
 * no top since the rescale), and three readers were read against rank F whatever the person's rank.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { said } from '../src/logic/systems/SheetWords';
import { SkillSay } from '../src/logic/systems/SkillSay';
import { WebSystem } from '../shared/logic/systems/WebSystem';
import { TagLaw } from '../shared/logic/content/TagLaw';

const SRC = (p: string) => readFileSync(p, 'utf8');

describe('SV1: what is shown is rounded by one rule; what is kept is not', () => {
  it('whole from ten up, a tenth below, a whole number as it is', () => {
    expect(said(130.35213707168586)).toBe('130');
    expect(said(52.05700071542524)).toBe('52');
    expect(said(85.06564579119595)).toBe('85');
    expect(said(7.46)).toBe('7.5');
    expect(said(15)).toBe('15');
    expect(said(0.25)).toBe('0.3');
    expect(said(4)).toBe('4');
  });
  it('the sheets, the shared bar and the carry line say their numbers through it', () => {
    const large = SRC('src/components/LargeSheet.tsx');
    expect(large).toMatch(/said\(vitals\.health\.max\)/);
    expect(large).toMatch(/said\(vitals\.energy\.max\)/);
    expect(large).toMatch(/said\(a\.held\)} of \$\{said\(a\.max\)/);
    expect(SRC('src/components/CharacterSheet.tsx')).toMatch(/said\(maxWeight\)/);
    expect(SRC('src/components/ui/kit.tsx')).toMatch(/said\(max\)/);
    const sheet = SRC('src/logic/systems/SheetNumbers.ts');
    expect(sheet).toMatch(/\$\{said\(load\)\} of \$\{said\(limit\)\} kg/);
    expect(sheet).toMatch(/said\(e\.maxHealth\)/);
    expect(sheet).not.toMatch(/×\$\{slowedByLoad\}/);
  });
});

describe('SV2: forming rows that read alike are one row', () => {
  // GV (2026-11-12): the forming rows are said by SkillSay now, which keeps D32's fold: every eye is one row
  it('three eyes forming read as one eye, at the furthest of them', () => {
    const progress = (tags: string[], weight: number) => ({ id: TagLaw.skillIdOf(TagLaw.canonical(tags)), tags: TagLaw.canonical(tags), rank: 0, attempts: 1, weight });
    const rows = [progress(['identify_weapon'], 4), progress(['identify_armor'], 12), progress(['identify_tool'], 8), progress(['axe', 'flora', 'wood'], 10)];
    const player = { id: 'p', bank: { universalSkills: {}, loreHeld: 0 }, skillProgress: Object.fromEntries(rows.map(r => [r.id, r])) } as any;
    const shown = SkillSay.forming(player, undefined);
    expect(shown.map(r => r.said)).toEqual(['A trained eye', 'Chopping plants and wood']);
    expect(shown[0].fill).toBe(Math.max(...rows.slice(0, 3).map(r => WebSystem.emergenceFill(r))));
  });
  it('the skills panel shows the folded rows', () => {
    const hub = SRC('src/components/PlayerHub.tsx');
    expect(hub).toMatch(/SkillSay\.forming\(/);
  });
});

describe('SV3: every line under IN A FIGHT reads its number at the person\'s own rank', () => {
  const sheet = SRC('src/logic/systems/SheetNumbers.ts');
  it('protection has no top, and is read against a blow of the person\'s own rank', () => {
    expect(sheet).not.toMatch(/at most \$\{pct\(0\.6\)\}/);
    expect(sheet).toMatch(/CombatMath\.mitigationOf\(eq, rank\)/);
    // GV: the line says what it means for the player, never the curve it is read on
    expect(sheet).not.toMatch(/nears but never reaches/);
  });
  it('dodge and glance are read at the person\'s own rank', () => {
    expect(sheet).toMatch(/CombatMath\.dodgeChance\(eq, at, rank\)/);
    expect(sheet).toMatch(/CombatMath\.glanceChance\(eq, at, rank\)/);
  });
  it('how often names haste; the walk names heavy gear', () => {
    expect(sheet).toMatch(/haste/);
    expect(sheet).toMatch(/heavy/);
  });
});
