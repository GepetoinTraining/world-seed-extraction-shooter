/**
 * THE BOARD ASKS FOR LORE (the design pass, part 4). Pedro, 2026-11-11: "That opens the board (questing) to lore being a
 * resource. Adventurer, we need fire power, our smithies cannot work sovereign silver! Find us a solution."
 *
 * A lack is read from the hub's own web and people, by a rule and never from a list: a person's workshop that stands, or
 * the station their workshop is short of (the hub's own `nextLink`), which no skill the hub holds opens, reached or silent
 * (D125: what the hub's people know is the hub's, though nobody hears of it until the web reaches it). Posted on the
 * Hall's board, it asks for a written piece of a skill that would open that station (D25: the connection against the
 * tags). Handed in, the piece pays from the asker's own purse, as a want does, and the hub's web gains the skill, its
 * first credited to whoever wrote it. Pure: the store's doors call it.
 */

import { IHubWeb, IItem, IWebStation } from '../../../shared/types';
import { WebSystem } from '../../../shared/logic/systems/WebSystem';
import type { IResidentQuest } from '../../entities/hub/guild';
import type { IWorkshop } from '../../entities/hub/hubTech';
import { LorePiece } from './LorePiece';

export interface ILoreLack {
  stationId: string;
  stationName: string;
  askerId: string;
  askerName: string;
  tool: string[];
  material: string[];
}

const opens = (tags: string[], station: Pick<IWebStation, 'connection'>) =>
  station.connection.tool.some(t => tags.includes(t)) && station.connection.material.every(t => tags.includes(t));
const words = (tags: string[]) => tags.map(t => t.replace(/_/g, ' '));
const either = (list: string[]) => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}`);

export const LoreBoard = {
  /** Who in the hub has the hands for this station: any skill it holds, reached or silent. */
  hasHands(web: IHubWeb, station: Pick<IWebStation, 'connection'>): boolean {
    return [...Object.values(web.nodes ?? {}), ...Object.values(web.silent ?? {})].some(n => opens(n.tags, station));
  },

  /** Every lack, one for each person and station, in the order of the person and then the station. */
  lacks(input: {
    workshops: Pick<IWorkshop, 'residentId' | 'stations' | 'standsAt'>[];
    web: IHubWeb;
    residents: { id: string; name: string }[];
    stations: IWebStation[];
    /** The station a person's standing workshop is short of, if any: the hub's own reading of their road. */
    next: (residentId: string) => IWebStation | null;
  }): ILoreLack[] {
    const out = new Map<string, ILoreLack>();
    for (const shop of input.workshops) {
      if (!shop.standsAt) continue;
      const person = input.residents.find(r => r.id === shop.residentId);
      if (!person) continue;
      const short = input.next(shop.residentId);
      const candidates = [...shop.stations.map(id => input.stations.find(s => s.id === id)), short]
        .filter((s): s is IWebStation => !!s);
      for (const station of candidates) {
        if (this.hasHands(input.web, station)) continue;
        out.set(`${person.id}|${station.id}`, {
          stationId: station.id, stationName: station.name, askerId: person.id, askerName: person.name,
          tool: station.connection.tool, material: station.connection.material
        });
      }
    }
    return [...out.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, lack]) => lack);
  },

  /** A lack, on the board: one written piece asked, paid by the asker's want. One id for one person and one station. */
  posting(lack: ILoreLack, payShare: number, day: number): IResidentQuest & { lore: { stationId: string; tool: string[]; material: string[] } } {
    const material = words(lack.material).join(' and ');
    return {
      id: `q_lore_${lack.askerId}_${lack.stationId}`, residentId: lack.askerId, askerName: lack.askerName, n: 0,
      tag: 'lore', count: 1, payShare, state: 'OPEN', postedDay: day,
      text: `${lack.askerName}'s ${lack.stationName} stands idle: nobody here has the hands to work ${material} at it. Bring a written piece of the way, ${either(words(lack.tool))} on ${material}, and it is paid for.`,
      lore: { stationId: lack.stationId, tool: lack.tool, material: lack.material }
    };
  },

  /** Does this piece answer that posting? A written skill that would open the station asked for. */
  answers(quest: Pick<IResidentQuest, 'lore'>, item: IItem): boolean {
    const taught = LorePiece.teaches(item);
    if (!quest.lore || !taught) return false;
    return opens(taught.tags, { connection: { tool: quest.lore.tool, material: quest.lore.material } });
  },

  /** The hub's web, once the piece is handed in: the skill it carries, first credited to its writer. */
  admit(web: IHubWeb, item: IItem, at: number): IHubWeb {
    const record = item.lorePiece;
    if (!record) return web;
    const skill = WebSystem.freshSkill(record.skillId, record.tags, record.rank);
    return WebSystem.admit(web, { uid: record.by.uid, name: record.by.name }, { [skill.id]: skill }, at).web;
  }
};
