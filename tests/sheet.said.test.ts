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
import { said, foldForming } from '../src/logic/systems/SheetWords';

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
  it('three eyes forming read as one eye, at the furthest of them', () => {
    const rows = [
      { name: 'Identify A', tool: 'identify', worked: 'weapon', fill: 0.2 },
      { name: 'Identify B', tool: 'identify, scope', worked: 'armor', fill: 0.6 },
      { name: 'Identify C', tool: 'identify', worked: '', fill: 0.4 },
      { name: 'Chopping', tool: 'axe', worked: 'oak', fill: 0.5 }
    ];
    const shown = foldForming(rows);
    expect(shown).toEqual([{ said: 'the eye', fill: 0.6 }, { said: 'axe on oak', fill: 0.5 }]);
  });
  it('the hands panel shows the folded rows', () => {
    const hub = SRC('src/components/PlayerHub.tsx');
    expect(hub).toMatch(/foldForming\(sheet\.forming\)/);
  });
});

describe('SV3: every explanation under IN A FIGHT says what its reader does', () => {
  const sheet = SRC('src/logic/systems/SheetNumbers.ts');
  it('protection has no top, and is read on a curve against a blow of the person\'s own rank', () => {
    expect(sheet).not.toMatch(/at most \$\{pct\(0\.6\)\}/);
    expect(sheet).toMatch(/CombatMath\.mitigationOf\(eq, rank\)/);
    expect(sheet).toMatch(/nears but never reaches all/);
  });
  it('dodge and glance are read at the person\'s own rank', () => {
    expect(sheet).toMatch(/CombatMath\.dodgeChance\(eq, at, rank\)/);
    expect(sheet).toMatch(/CombatMath\.glanceChance\(eq, at, rank\)/);
  });
  it('how often names haste and leaves out what another hand wields; the walk names its curve and heavy pieces', () => {
    expect(sheet).toMatch(/haste/);
    expect(sheet).toMatch(/another hand/);
    expect(sheet).toMatch(/heavy/);
  });
});
