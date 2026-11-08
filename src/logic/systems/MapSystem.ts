/**
 * A MAP IS AN ITEM (D85): what a character scanned, written down at the scribe's table.
 *
 * Paid for in paper and ink like a plan (D14) and, like a plan, never used up by being read.
 * It is for one world, and reading it adds to the reader's own survey as old as it was
 * scanned, so a map goes stale exactly as a scan does. It holds levels and counts, never a
 * creature's name (D60). The law of what goes on paper and what a reading does is SurveySystem's.
 */

import { IItem, ItemType, Rarity, SlotType, UniversalRank } from '../../../shared/types';
import type { IPlayerPort } from '../../entities/player/playerView';
import { useIdentityStore } from '../../entities/identity/store';
import type { IWorldCard, IWorldPort } from '../../entities/world/worldView';
import { WorldClock } from '../../entities/world/WorldClock';
import { Rng } from '../../../shared/logic/rng/DeterministicRNG';
import { Ledger } from '../ledger/Ledger';
import { sha256Hex } from '../journal/SessionJournal';
import { PlayerPersistence } from '../persistence/PlayerPersistence';
import { ISurveySheet, SurveySystem } from './SurveySystem';
import { TemplateSystem, addToStash, removeFromStash, stashItems } from './TemplateSystem';

export interface IMapItem extends IItem {
  mapData: NonNullable<IItem['mapData']>;
}

export const isMapItem = (item: IItem): item is IMapItem => item.type === ItemType.MAP && !!item.mapData;

export interface MapWriteResult { ok: boolean; reason?: string; item?: IMapItem }
export interface MapReadResult { ok: boolean; reason?: string; taken?: number; kept?: number }

export class MapSystem {

  private static buildItem(data: IMapItem['mapData'], sectors: ISurveySheet, value: number, key: string): IMapItem {
    const rng = Rng.fromKey(key);
    const { sectors: count } = SurveySystem.mapSpread(sectors);
    return {
      id: `itm_${rng.int(0, 0xffffffff).toString(16).padStart(8, '0')}${rng.int(0, 0xffffffff).toString(16).padStart(8, '0')}`,
      universalDefinitionId: 'map_survey',
      name: `MAP OF ${data.worldName.toUpperCase()}`,
      description: `${data.worldName}, in ${data.scribeName}'s hand: ${count} sector${count === 1 ? '' : 's'}, each as old as it was when scanned.`,
      type: ItemType.MAP,
      slot: SlotType.NONE,
      rank: UniversalRank.F,
      rarity: Rarity.UNCOMMON,
      level: 1,
      quality: 0, // the one scale: 0 means no roll was taken
      value,
      itemPower: 0,
      tags: ['document'],
      affixes: [],
      dimensions: { width: 2, height: 2 },
      weight: 0.2,
      stats: {},
      visuals: { modelId: 'map', colorHex: '#e7e5e4' },
      icon: 'map_icon',
      history: { dropDate: Date.now(), killCount: 0 },
      isIdentified: true,
      mapData: data
    };
  }

  /** WRITE A MAP: everything this character holds of one world, for the same bill as a plan. */
  static async write(worldId: string, cards: IWorldCard[], pc: IPlayerPort): Promise<MapWriteResult> {
    const cert = useIdentityStore.getState().certificate;
    if (!cert) return { ok: false, reason: 'No identity holds the pen. Jack in first.' };
    const card = cards.find(w => w.id === worldId);
    if (!card) return { ok: false, reason: 'That world is not on the registry.' };
    const sectors = SurveySystem.mapSheet(pc.view().player.survey?.[worldId] ?? {});
    if (Object.keys(sectors).length === 0) return { ok: false, reason: 'Nothing scanned there to write down.' };

    const bill = TemplateSystem.payBill(pc);
    if (!bill.ok) return { ok: false, reason: bill.reason! };

    const writtenAt = Date.now();
    const data: IMapItem['mapData'] = {
      worldId, worldName: card.name,
      scribeUid: cert.metadata.uid, scribeName: cert.metadata.displayName,
      writtenAt, sectors
    };
    const value = SurveySystem.mapWorth(sectors, WorldClock.momentAt(card, writtenAt).generation);
    const item = this.buildItem(data, sectors, value, `map:${cert.metadata.uid}:${writtenAt}:${worldId}:${stashItems(pc).length}`);

    removeFromStash(bill.ids, pc);
    addToStash([item], pc);
    const { Provenance } = await import('../sovereignty/Provenance');
    // The signature covers what it says, so a later reader can hold the two together
    const digest = await sha256Hex(JSON.stringify(data));
    await Provenance.record(item, 'MINT', { origin: 'SURVEY', authorUid: data.scribeUid, authorName: data.scribeName, worldId, digest, consumedIds: bill.ids });
    await Ledger.append('DESIGN', { kind: 'MAP_WRITTEN', itemId: item.id, worldId, authorUid: data.scribeUid, consumedIds: bill.ids });
    return { ok: true, item };
  }

  /** READ A MAP: the sectors join this character's own record, and the map stays in the stash. */
  static read(itemId: string, world: IWorldPort, pc: IPlayerPort): MapReadResult {
    const item = stashItems(pc).find(i => i.id === itemId);
    if (!item || !isMapItem(item)) return { ok: false, reason: 'That map is not in your stash.' };

    const { worldId, sectors } = item.mapData;
    const { player, taken, kept } = SurveySystem.readMap(pc.view().player, worldId, sectors);
    if (taken > 0) {
      pc.apply({ kind: 'SET', player });
      if (world.view().activeWorldId === worldId) world.apply({ kind: 'APPLY_SURVEY', survey: player.survey?.[worldId] });
      void PlayerPersistence.flush('survey', pc.view().player);
    }
    return { ok: true, taken, kept };
  }
}
