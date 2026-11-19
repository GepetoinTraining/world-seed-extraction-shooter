/**
 * A CARD IS OPENED ON PURPOSE, AND SAYS LITTLE OF WHAT IS NOT KNOWN. Pedro, 2026-11-19: "the hover is too responsive, let
 * someone click, and then show it, also, it shows TOO much information before I know anything, too expositive".
 *
 * What these bars hold:
 *  - a piece's card: a pointer that only passes over opens nothing; a press opens it; leaving closes it; the keyboard still reaches it;
 *  - the field: nothing is hit-tested under the pointer each frame; the card opens from Inspect on a right click (added
 *    where the law offers no look of its own) or from Q, and Inspect is the card and no longer a line in the feed;
 *  - before anything is known: a place says nothing of itself and does not tell anyone to go and study it.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { handHoverProps, hoverProps, useHover } from '../src/components/ui/stores';
import { inspectEntity } from '../src/render/atoms/inspect';
import { EntityType } from '../shared/entities/world/types';
import { RESOURCE_DEFINITIONS } from '../shared/entities/item/data/resourceDefinitions';
import { FIRST_THEME_PACK, installShippedThemes } from '../shared/logic/theme/boot';
import { IItem } from '../shared/types';

installShippedThemes();
const SRC = (path: string) => readFileSync(path, 'utf8');
const piece = { id: 'itm_1', name: 'A Thing' } as IItem;
const el = () => document.createElement('button');

beforeEach(() => { useHover.getState().clear(); });

describe('a piece\'s card is opened by a press, never by a passing pointer', () => {
  it('offers no handler for a pointer coming over it', () => {
    expect(Object.keys(hoverProps(piece)).sort()).toEqual(['onBlur', 'onFocus', 'onMouseDown', 'onMouseLeave']);
    expect(Object.keys(handHoverProps('RIGHT_HAND')).sort()).toEqual(['onBlur', 'onFocus', 'onMouseDown', 'onMouseLeave']);
  });

  it('a press opens it, leaving closes it, and only the first button counts', () => {
    const at = el();
    const props = hoverProps(piece);
    props.onMouseDown({ currentTarget: at, button: 2 });
    expect(useHover.getState().item).toBeNull();
    props.onMouseDown({ currentTarget: at, button: 0 });
    expect(useHover.getState().item).toBe(piece);
    props.onMouseLeave({ currentTarget: at });
    expect(useHover.getState().item).toBeNull();
    // Pressed again where it already holds the focus, it opens again
    props.onMouseDown({ currentTarget: at, button: 0 });
    expect(useHover.getState().item).toBe(piece);
  });

  it('the keyboard still reaches it: focus opens, and leaving the focus closes', () => {
    const at = el();
    const props = hoverProps(piece);
    props.onFocus({ currentTarget: at });
    expect(useHover.getState().item).toBe(piece);
    props.onBlur({ currentTarget: at });
    expect(useHover.getState().item).toBeNull();
  });

  it('a hand\'s card opens the same way', () => {
    const at = el();
    handHoverProps('RIGHT_HAND').onMouseDown({ currentTarget: at, button: 0 });
    expect(useHover.getState().hand).toBe('RIGHT_HAND');
  });

  it('nothing on a sheet opens under a passing pointer either', () => {
    expect(SRC('src/components/SheetLine.tsx')).not.toMatch(/onMouseEnter/);
    expect(SRC('src/components/CharacterSheet.tsx')).not.toMatch(/onMouseEnter/);
    expect(SRC('src/components/ui/stores.ts')).not.toMatch(/onMouseEnter/);
  });
});

describe('in the field, a card is opened on purpose', () => {
  const field = SRC('src/components/WorldCanvas.tsx');

  it('nothing is looked up under the pointer as the frames go by', () => {
    expect(field).not.toMatch(/hitTest\(targets, worldX, worldZ, inspectedIdRef\.current\)/);
    // The card that is open is still kept true to its thing while that thing is near
    expect(field).toMatch(/if \(inspectedIdRef\.current\) \{/);
  });

  it('Inspect on a right click is the card itself, and anything a right click reaches can be looked at', () => {
    expect(field).toMatch(/startsWith\('int_inspect_'\)\) openCard\(selectedEntityId\)/);
    expect(field).toMatch(/offered\.some\(o => o\.id\.startsWith\('int_inspect_'\)\) \? offered : \[\.\.\.offered, \{/);
    // Q still walks the cards of what is near
    expect(field).toMatch(/Q cycles the inspect card/);
  });
});

describe('before anything is known, a card says what the eye sees', () => {
  it('a place nobody has studied says nothing of itself, and tells nobody to go and study it', () => {
    const def = Object.values(RESOURCE_DEFINITIONS).find(d => d.themeId === FIRST_THEME_PACK.themeId && (d as { harvestConfig?: unknown }).harvestConfig)!;
    const body = { id: 'n', type: EntityType.RESOURCE, definitionId: def.id, position: { x: 0, y: 0 }, rank: 'F', rarity: 'COMMON' } as never;
    const who = { currentSession: { inventory: [] }, attributes: {}, bank: { universalSkills: {} } } as never;
    const blind = inspectEntity(body, { player: who, dist: 1, level: () => 0 });
    const said = JSON.stringify(blind.rows);
    for (const word of ['Known', 'Study', 'Rank', 'Cost', 'Odds']) expect(said, word).not.toContain(word);
    expect(blind.unknowns?.map(u => u.kind)).toEqual(['material']);
    // Known, it says what it did before
    const known = inspectEntity(body, { player: who, dist: 1, level: () => 1 });
    expect(known.rows.map(([k]) => k)).toEqual(expect.arrayContaining(['Rank']));
  });
});

describe('found while looking at it in the game', () => {
  it('a tool worn counts as a tool carried: the card of a tree does not ask for one a person has in its slot', () => {
    const def = Object.values(RESOURCE_DEFINITIONS).find(d => d.themeId === FIRST_THEME_PACK.themeId && ((d as { harvestConfig?: { requiredToolTags: string[] } }).harvestConfig?.requiredToolTags ?? []).length > 0)!;
    const asks = (def as { harvestConfig: { requiredToolTags: string[] } }).harvestConfig.requiredToolTags;
    const body = { id: 'n', type: EntityType.RESOURCE, definitionId: def.id, position: { x: 0, y: 0 }, rank: 'F', rarity: 'COMMON' } as never;
    const bare = { currentSession: { inventory: [] }, attributes: {}, bank: { universalSkills: {} } };
    const tool = { id: 't', name: 'A Tool', tags: [asks[0]], stats: { chopping_power: 99, mining_power: 99 } };
    const needs = (player: unknown) => inspectEntity(body, { player: player as never, dist: 1, level: () => 0 }).needs.filter(n => n.startsWith('Needs'));
    expect(needs(bare)).toEqual(['Needs a tool']);
    expect(needs({ ...bare, equipment: { slots: {}, items: [tool], frames: {}, protected: [] } })).toEqual([]);
    expect(needs({ ...bare, currentSession: { inventory: [tool] } })).toEqual([]);
  });
});

