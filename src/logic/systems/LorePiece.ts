/**
 * LORE AS A GOOD (the design pass, part 3). Pedro, 2026-11-11: "once a player has a skill, a craft, anything related to
 * the tech web they can produce the skill as a lore piece to trade, sell, or even give. That opens the board (questing) to
 * lore being a resource." And: "you never lose lore".
 *
 * So whoever holds a skill rooted in the web (a lawful pair of tags, D27) can write it out at home, on a sheet of paper,
 * for what a sitting on that skill's own tree asks of them: the more of the tree they know, the cheaper. The writer keeps
 * the skill. The piece is a document like any fragment, so it is read through the lore rule as it stands (twice its
 * stretch, filed under the skill's category, spent by a reading that pays fair or better), and reading it teaches the
 * skill it carries, as a piece's design does. Pure: a player in, a player and a piece out. The door is LoreWriteDoor.
 *
 * Proof against copying a good (the goods proof: a sealed good, hash-signed in batches against pulsars) is designed
 * elsewhere and not built. It would attach here, where a piece is minted: `lorePiece` would carry its seal.
 */

import { IItem, IPlayer, ISkillState, IStudyTarget, ItemType, Rarity } from '../../../shared/types';
import { IHubTree, WebSystem } from '../../../shared/logic/systems/WebSystem';
import { ProgressionSystem, RANK_ORDER } from '../../../shared/entities/player/systems/ProgressionSystem';
import { LORE_RANK_GROWTH } from '../../../shared/logic/systems/LoreConstants';
import { Verdict } from '../../../shared/entities/player/systems/LoadoutSystem';
import { StudySystem } from './StudySystem';
import { SkillNames } from './SkillNames';

/** What a written piece is worth at rank F: what a trade's note sells for on the shelf (ProcessSystem.tradeNote). */
export const LORE_PIECE_VALUE = 60;
/** The definition every written piece shares; what it carries is on the piece. */
export const LORE_PIECE_DEF = 'lore_piece';

export interface ILorePieceRecord {
  skillId: string;
  tags: string[];
  rank: number;
  by: { uid: string; name: string };
  at: number;
}

const no = (reason: string): Verdict => ({ ok: false, reason });
type Piece = IItem & { lorePiece?: ILorePieceRecord };

export const LorePiece = {
  /** The skill as something to sit with: its own tags, on its own tree. What writing it out asks is what that sitting asks. */
  targetOf(skill: Pick<ISkillState, 'id' | 'tags'>): IStudyTarget {
    return StudySystem.targetOfThing({ id: skill.id, name: SkillNames.nameOf(skill.id), tags: skill.tags });
  },

  /** A sheet to write on: anything of the registered paper material that is not itself written. */
  isPaper(item: IItem): boolean {
    return item.type !== ItemType.LORE && WebSystem.materialIdentity(item.tags ?? []).includes('paper');
  },

  paperOf(player: IPlayer): IItem | undefined {
    return player.bank.stashTabs.flatMap(t => t.items).find(i => this.isPaper(i));
  },

  heldSkill(player: IPlayer, skillId: string): ISkillState | undefined {
    return WebSystem.heldSkills(player.bank.universalSkills ?? {}).find(s => s.id === skillId);
  },

  /** What writing it out asks of this person: a sitting on its tree. */
  ask(player: IPlayer, skill: Pick<ISkillState, 'id' | 'tags'>, hub?: IHubTree): { cost: number; seconds: number } {
    return StudySystem.studyAsk(player, this.targetOf(skill), hub);
  },

  canWrite(player: IPlayer, skillId: string, hub?: IHubTree, now = Date.now()): Verdict {
    const skill = this.heldSkill(player, skillId);
    if (!skill) return no('You can only write out what your own hands know.');
    if (player.currentSession) return no('Nothing is written out here. It can wait for home.');
    if (player.rest && now < player.rest.until) return no('This character is at rest.');
    if (!this.paperOf(player)) return no('Writing it out takes a sheet of paper, and you hold none at home.');
    const { cost } = this.ask(player, skill, hub);
    const left = StudySystem.energyLeft(player);
    if (left < cost) return no(`Refused: needs ${cost} energy, you hold ${Math.floor(left)}. Rest first.`);
    return { ok: true };
  },

  /** What a piece of this rank is worth: the shelf's note, half again a rank, as lore grows. */
  worth(rank: number): number {
    return Math.round(LORE_PIECE_VALUE * Math.pow(LORE_RANK_GROWTH, Math.max(0, rank)));
  },

  /** Written out: the skill stays, one sheet and a sitting's energy go, and the piece lands in the vault. */
  write(player: IPlayer, skillId: string, by: { uid: string; name: string }, at: number, hub?: IHubTree): { player: IPlayer; item: IItem; cost: number; seconds: number } {
    const skill = this.heldSkill(player, skillId);
    const sheet = this.paperOf(player);
    if (!skill || !sheet) throw new Error('LorePiece.write: ask canWrite first');
    const { cost, seconds } = this.ask(player, skill, hub);
    const rank = Math.max(0, skill.rank ?? 0);
    const name = SkillNames.nameOf(skill.id, player.skillWords?.[skill.id]?.name);
    const record: ILorePieceRecord = { skillId: skill.id, tags: skill.tags, rank, by, at };
    const item: Piece = {
      // The sheet it was written on is used once, so its id makes the piece's
      id: `lore_${sheet.id}`, universalDefinitionId: LORE_PIECE_DEF, name: `Written out: ${name}`,
      description: `What ${by.name}'s hands know of ${name}, written out. Reading it teaches it, and pays lore of its kind.`,
      type: ItemType.LORE, rank: RANK_ORDER[Math.min(rank, RANK_ORDER.length - 1)], rarity: Rarity.COMMON, quality: 0.5, level: 1,
      value: this.worth(rank), itemPower: 0, tags: ['lore', 'document', ...skill.tags], affixes: [],
      dimensions: { width: 1, height: 1 }, weight: 0.1, stats: {}, visuals: { modelId: 'note', colorHex: '#d8d2c0' }, icon: 'note_icon',
      isIdentified: true, lorePiece: record
    } as Piece;
    let next = StudySystem.loseItem(player, sheet.id);
    next = StudySystem.pay(next, cost);
    next = { ...next, bank: { ...next.bank, stashTabs: next.bank.stashTabs.map((t, i) => (i === 0 ? { ...t, items: [...t.items, item] } : t)) } };
    return { player: next, item, cost, seconds };
  },

  /** What reading the piece teaches: the pair it carries, accrued as a sitting accrues. Null for anything else. */
  teaches(item: IItem): { id: string; tags: string[] } | null {
    const record = (item as Piece).lorePiece;
    return record ? { id: record.skillId, tags: record.tags } : null;
  },

  /**
   * A piece read, and paid for (a fair reading or better). Pedro, 2026-11-11, of forming skills: "they don't count, they don't
   * do anything yet, and you need to have lore as a resource to actually be able to rollover a dream and learn them". So the
   * skill it carries is not handed over: it is forming, and ready, and the next rest settles it for its price in lore
   * (`WebSystem.rest`), or keeps it, saying so, while the reader holds too little. A reader who holds it already gains nothing.
   */
  read(player: IPlayer, item: IItem): IPlayer {
    const taught = this.teaches(item);
    if (!taught || player.bank.universalSkills?.[taught.id]) return player;
    const next = WebSystem.accrueFromStudy(player, taught, this.rankOf(item));
    return { ...next, skillProgress: { ...next.skillProgress, [taught.id]: { ...next.skillProgress![taught.id], ready: true } } };
  },

  /** The rank index a piece was written at. */
  rankOf(item: IItem): number {
    return (item as Piece).lorePiece?.rank ?? ProgressionSystem.rankIndex(item.rank);
  }
};
