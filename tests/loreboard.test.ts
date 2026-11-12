/**
 * THE BOARD ASKS FOR LORE (the design pass, part 4). Registered before the build.
 *
 * Pedro, 2026-11-11: "That opens the board (questing) to lore being a resource. Adventurer, we need fire power, our
 * smithies cannot work sovereign silver! Find us a solution."
 *
 * The need comes from the hub's own web and people by a rule, never from a list (made by plain sense, ledger DP4): a
 * person's workshop that stands, or the station their workshop is short of, which nobody in the hub has the hands for
 * (no skill the hub holds, reached or silent, opens it), is a lack. A lack is posted on the Hall's board, asking for a
 * written piece of a skill that would open that station. Handing one in pays from the asker's own purse, by the piece's
 * worth and their want, and the hub's web gains the skill, credited to whoever wrote it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { IHubWeb, IItem, IWebStation, ItemType, Rarity, UniversalRank } from '../shared/types';
import { WebSystem } from '../shared/logic/systems/WebSystem';
import { TagLaw } from '../shared/logic/content/TagLaw';
import { WebBank } from '../shared/logic/content/WebBank';
import { LoreBoard } from '../src/logic/systems/LoreBoard';
import { IWorkshop } from '../src/entities/hub/hubTech';

const SRC = (p: string) => readFileSync(p, 'utf8');
const anvil = (): IWebStation => WebBank.current().stations.find(s => s.id === 'stn_anvil')!;
const sawpit = (): IWebStation => WebBank.current().stations.find(s => s.id === 'stn_sawpit')!;
const shop = (station: string, stands = true): IWorkshop => ({
  id: `ws_${station}`, residentId: 'res_smith', lotId: 'poi_lot_1', mode: 'WORKSTATION', stations: [station], name: "Brann's Anvil",
  bill: [], pool: {}, raised: stands, ...(stands ? { standsAt: 10 } : {})
});
const SMITH = { id: 'res_smith', name: 'Brann' };
const credit = { uid: 'u_first', name: 'First', at: 1 };
const node = (id: string) => ({ id, tags: TagLaw.parseSkillId(id)!, rank: 0, firstBy: credit, rungRecord: { ...credit, rung: 0 } });
const HAMMER_ON_METAL = WebSystem.mint(['hammer'], ['metal']);
const AXE_ON_WOOD = WebSystem.mint(['axe'], ['flora', 'wood']);

const piece = (skill: { id: string; tags: string[] }, over: Partial<IItem> = {}): IItem => ({
  id: `lore_${skill.id}`, universalDefinitionId: 'lore_piece', name: 'Written out', description: '', type: ItemType.LORE,
  rank: UniversalRank.F, rarity: Rarity.COMMON, quality: 0.5, level: 1, value: 60, itemPower: 0, tags: ['lore', 'document', ...skill.tags],
  affixes: [], dimensions: { width: 1, height: 1 }, weight: 0.1, stats: {}, visuals: { modelId: 'note', colorHex: '#fff' }, icon: 'i',
  isIdentified: true, lorePiece: { skillId: skill.id, tags: skill.tags, rank: 0, by: { uid: 'u_writer', name: 'Writer' }, at: 5 }, ...over
} as IItem);

const lacks = (web: IHubWeb, workshops: IWorkshop[], next: (residentId: string) => IWebStation | null = () => null) =>
  LoreBoard.lacks({ workshops, web, residents: [SMITH], stations: WebBank.current().stations, next });

describe('a lack comes from the hub\'s own web and people, by a rule', () => {
  it('a workshop that stands, whose station nobody in the hub has the hands for, is a lack', () => {
    const found = lacks({ nodes: {} }, [shop('stn_anvil')]);
    expect(found).toEqual([{ stationId: 'stn_anvil', stationName: anvil().name, askerId: 'res_smith', askerName: 'Brann', tool: anvil().connection.tool, material: anvil().connection.material }]);
  });

  it('a skill the hub holds, reached or silent, that opens it, means no lack', () => {
    expect(lacks({ nodes: { [HAMMER_ON_METAL.id]: node(HAMMER_ON_METAL.id) } }, [shop('stn_anvil')])).toEqual([]);
    expect(lacks({ nodes: {}, silent: { [HAMMER_ON_METAL.id]: { id: HAMMER_ON_METAL.id, tags: HAMMER_ON_METAL.tags, rank: 0, by: credit, rung: 0 } } }, [shop('stn_anvil')])).toEqual([]);
  });

  it('a workshop not yet standing asks nothing yet', () => {
    expect(lacks({ nodes: {} }, [shop('stn_anvil', false)])).toEqual([]);
  });

  it('the station a standing workshop is short of, with nobody to work it, is a lack too', () => {
    const web = { nodes: { [HAMMER_ON_METAL.id]: node(HAMMER_ON_METAL.id) } };
    const found = lacks(web, [shop('stn_anvil')], () => sawpit());
    expect(found.map(l => l.stationId)).toEqual(['stn_sawpit']);
  });

  it('the same in any order', () => {
    const two = [shop('stn_anvil'), { ...shop('stn_sawpit'), id: 'ws_b', residentId: 'res_smith' }];
    expect(lacks({ nodes: {} }, two)).toEqual(lacks({ nodes: {} }, [...two].reverse()));
  });
});

describe('a lack is posted on the board, asking for a written piece', () => {
  const lack = lacks({ nodes: {} }, [shop('stn_anvil')])[0];
  const quest = LoreBoard.posting(lack, 1.2, 7);

  it('it is a want of the asker, open, asking one written piece that would open the station', () => {
    expect(quest).toMatchObject({ residentId: 'res_smith', count: 1, payShare: 1.2, state: 'OPEN', postedDay: 7, lore: { stationId: 'stn_anvil', tool: anvil().connection.tool, material: anvil().connection.material } });
    expect(quest.id).toBe(LoreBoard.posting(lack, 1.2, 9).id);
    for (const word of [...anvil().connection.material]) expect(quest.text).toContain(word.replace(/_/g, ' '));
    expect(quest.text).toContain('Brann');
  });

  it('a written piece of a skill that opens the station answers it; another skill, or a plain document, does not', () => {
    expect(LoreBoard.answers(quest, piece(HAMMER_ON_METAL))).toBe(true);
    expect(LoreBoard.answers(quest, piece(AXE_ON_WOOD))).toBe(false);
    expect(LoreBoard.answers(quest, piece(HAMMER_ON_METAL, { lorePiece: undefined }))).toBe(false);
  });

  it('handing it in: the hub\'s web gains the skill, credited to whoever wrote it, and the lack is gone', () => {
    const web = LoreBoard.admit({ nodes: {} }, piece(HAMMER_ON_METAL), 99);
    expect(web.nodes[HAMMER_ON_METAL.id]).toMatchObject({ id: HAMMER_ON_METAL.id, tags: HAMMER_ON_METAL.tags, firstBy: { uid: 'u_writer', name: 'Writer', at: 99 } });
    expect(lacks(web, [shop('stn_anvil')])).toEqual([]);
  });
});

describe('the doors: posted by the day\'s turn, answered at the Hall\'s board, walked up to', () => {
  it('the hub posts lacks when wants are resolved, and has a door to answer one', () => {
    const store = SRC('src/entities/hub/store.ts');
    expect(store).toMatch(/postLoreAsks/);
    expect(store).toMatch(/answerLoreAsk/);
  });
  it('the Hall\'s board offers the answer', () => {
    expect(SRC('src/components/GuildHall.tsx')).toMatch(/answerLoreAsk/);
  });
});
