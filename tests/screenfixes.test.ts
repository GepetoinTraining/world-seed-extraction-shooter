/**
 * What checking the balance changes on screen found (PLAYTEST_LEDGER.md, 2026-11-11), each held by a bar:
 * S2i the pack's weight after a whole new player, G2b one circle, S1k what a field thing shows to study,
 * S2h lore by category, G1f and G1g the sheets' points, E1e the city's tonic mark.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { usePlayerStore, playerPort } from '../src/entities/player/store';
import { CircleSystem } from '../src/logic/systems/CircleSystem';
import { FieldStudy } from '../src/logic/systems/FieldStudy';
import { LoreSystem } from '../src/logic/systems/LoreSystem';
import { LoreLaw } from '../shared/logic/systems/LoreLaw';
import { groupHeading, plusSays } from '../src/components/ui/levelLine';
import { RESOURCE_DEFINITIONS } from '../shared/entities/item/data/resourceDefinitions';
import { MOB_DEFINITIONS } from '../shared/entities/mob/data/mobDefinitions';
import { EntityType, IWorldEntity } from '../shared/entities/world/types';
import { IItem, IPlayer } from '../shared/types';

const source = (path: string) => readFileSync(path, 'utf8');
const piece = (id: string, weight: number): IItem => ({ id, name: id, weight, type: 'MATERIAL', universalDefinitionId: id, tags: [] } as unknown as IItem);
const base = (): IPlayer => usePlayerStore.getState().player;

describe('S2i: a whole new player leaves the pack weighing what it holds', () => {
  beforeEach(() => {
    const p = base();
    usePlayerStore.setState({ player: { ...p, currentSession: undefined }, currentWeight: 0 });
  });

  it('a SET through the port counts the weight again', () => {
    const p = base();
    playerPort.apply({ kind: 'SET', player: { ...p, currentSession: { inventory: [piece('a', 5), piece('b', 5)] } as never } });
    expect(usePlayerStore.getState().currentWeight).toBe(10);
    // Study loses one piece and spends the other: the new player holds nothing
    playerPort.apply({ kind: 'SET', player: { ...base(), currentSession: { ...base().currentSession!, inventory: [] } } });
    expect(usePlayerStore.getState().currentWeight).toBe(0);
  });

  it('any door that sets the player directly is counted too, not only SET', () => {
    usePlayerStore.setState({ player: { ...base(), currentSession: { inventory: [piece('c', 3)] } as never } });
    expect(usePlayerStore.getState().currentWeight).toBe(3);
  });
});

describe('G2b: one circle is a circle', () => {
  it('says one circle and two circles', () => {
    expect(CircleSystem.standsLine('Flora', 1)).toBe('Flora stands at 1 circle. It will answer at a rest, when you hold the lore for it.');
    expect(CircleSystem.standsLine('Flora', 2)).toBe('Flora stands at 2 circles. It will answer at a rest, when you hold the lore for it.');
    expect(source('src/entities/player/store.ts')).toMatch(/CircleSystem\.standsLine\(/);
  });
});

describe('S1k: a field thing is studied by what it shows, and the panel asks for what is pressed', () => {
  const oak = 'res_screenfix_oak';
  const wolf = 'mob_screenfix_wolf';
  beforeEach(() => {
    (RESOURCE_DEFINITIONS as Record<string, unknown>)[oak] = { id: oak, name: 'Test Oak', rank: 'F', tags: ['flora', 'wood'], uses: 3 };
    (MOB_DEFINITIONS as Record<string, unknown>)[wolf] = { id: wolf, name: 'Test Wolf', tags: ['fauna', 'canine'], baseHealth: 10, baseDamage: 1 };
  });
  const entity = (type: EntityType, definitionId: string, extra: Partial<IWorldEntity> = {}): IWorldEntity =>
    ({ id: `e_${definitionId}`, type, definitionId, position: { x: 0, y: 0 }, rank: 'F', ...extra } as unknown as IWorldEntity);
  const knowing = (defId: string, level: number): IPlayer => ({ ...base(), materialMastery: { [defId]: { knowledgeLevel: level } } } as unknown as IPlayer);

  it('a thing the person does not know shows nothing to file under; one they know shows its own tags', () => {
    expect(FieldStudy.target(entity(EntityType.RESOURCE, oak), knowing(oak, 0)).tags).toEqual([]);
    expect(FieldStudy.target(entity(EntityType.RESOURCE, oak), knowing(oak, 1)).tags).toEqual(['flora', 'wood']);
  });

  it('a creature shows its kind only once its kind is known, and its name stays as the screen says it', () => {
    const unknown = FieldStudy.target(entity(EntityType.MOB, wolf, { displayName: 'Unknown Contact' } as never), knowing(wolf, 0));
    expect(unknown.tags).toEqual([]);
    expect(unknown.name).toBe('Unknown Contact');
    expect(FieldStudy.target(entity(EntityType.MOB, wolf), knowing(wolf, 1)).tags).toEqual(['fauna', 'canine']);
  });

  it('a person shows no tags, whatever is known of them', () => {
    const person = entity(EntityType.NPC, 'npc_x', { npc: { disposition: 50, want: 'bread', attempts: 2 } } as never);
    expect(FieldStudy.target(person, base()).tags).toEqual([]);
  });

  it('every entry the panel offers says its own ask, and no line reads the first entry for all', () => {
    const panel = source('src/components/StudyPanel.tsx');
    expect(panel).not.toMatch(/studyAsk\(player, here\[0\]/);
    expect(panel).toMatch(/here\.map\(target => \{[\s\S]{0,200}StudySystem\.studyAsk\(player, target/);
    expect(panel).toMatch(/FieldStudy\.target\(/);
  });
});

describe('S2h: lore of a category is shown, a misreading in it', () => {
  it('reads each category with its misreading, highest first, under the word the person may see', () => {
    let purse = { loreHeld: 0 } as Parameters<typeof LoreLaw.credit>[0];
    purse = LoreLaw.credit(purse, { key: 'family:flora', name: 'flora' }, 10, 0);
    purse = LoreLaw.credit(purse, { key: 'family:flora', name: 'flora' }, 0, 30);
    purse = LoreLaw.credit(purse, { key: 'family:stone', name: 'stone' }, 10, 0);
    const p = { ...base(), bank: { ...base().bank, ...purse } } as IPlayer;
    expect(LoreSystem.shownKinds(p)).toEqual([{ key: 'family:flora', name: 'flora', reads: 36 }, { key: 'family:stone', name: 'stone', reads: 6 }]);
    expect(source('src/components/StudyPanel.tsx')).toMatch(/LoreSystem\.shownKinds\(/);
  });
});

describe('G1f: both sheets say what waits in each group, and what a + spends, without a pointer', () => {
  const p = (free: number, body: number) => ({ attributePoints: free, groupPoints: { body, mind: 0, self: 0 } });
  it('a heading says its own count, and a line says what its + spends', () => {
    expect(groupHeading(p(1, 2), 'body')).toBe('HARDWARE · 2 TO SPEND HERE');
    expect(groupHeading(p(1, 0), 'body')).toBe('HARDWARE');
    expect(plusSays(p(1, 2), 'body')).toBe('+ SPENDS A HARDWARE POINT');
    expect(plusSays(p(1, 0), 'body')).toBe('+ SPENDS THE FREE POINT');
    expect(plusSays(p(0, 0), 'body')).toBeNull();
  });
  it('the field sheet and the AGENT tab both draw them, and the AGENT tab names each + for keys', () => {
    for (const path of ['src/components/CharacterSheet.tsx', 'src/components/PlayerHub.tsx']) {
      expect(source(path)).toMatch(/groupHeading\(player/);
      expect(source(path)).toMatch(/plusSays\(player/);
    }
    expect(source('src/components/PlayerHub.tsx')).toMatch(/aria-label=\{`Raise \$\{attr\}/);
  });
});

describe('G1g: the AGENT tab keeps its spend line inside its panel', () => {
  it('the title carries a count only; the line by kind sits in the body, where it can wrap', () => {
    const hub = source('src/components/PlayerHub.tsx');
    expect(hub).not.toMatch(/title="ATTRIBUTES" right=\{[^}]*pointsLine/);
    expect(hub).toMatch(/whiteSpace: 'normal'[\s\S]{0,120}SPEND \{pointsLine\(player\)\}/);
  });
});

describe('E1e: the city shows the tonic mark the field shows', () => {
  it('one mark, drawn in both places', () => {
    expect(source('src/components/WaitStrip.tsx')).toMatch(/export const TonicMark/);
    expect(source('src/entities/hub/HubCanvas.tsx')).toMatch(/<TonicMark \/>/);
    expect(source('src/components/WaitStrip.tsx')).toMatch(/<TonicMark \/>/);
  });
});
