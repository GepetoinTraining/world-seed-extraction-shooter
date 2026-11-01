/**
 * THE TEMPLATE SYSTEM (Wave 10B): minting plans into items, at the scribe's table.
 *
 * D14: a template is never consumed by use. The original is a keepable,
 * tradable item; copies are minted for the same paper-and-ink bill, and the
 * author's signature rides every copy in provenance forever. Scarcity comes
 * from labor and materials, never from burning drawings.
 */

import { IItem, ItemType, Rarity, SlotType, UniversalRank } from '../../../types';
import { ITemplate, ITemplateDraft, TEMPLATE_MINT_BILL, validateTemplate } from '../../entities/hub/template';
import { pickBill } from '../../entities/hub/room';
import { usePlayerStore } from '../../entities/player/store';
import { useIdentityStore } from '../../entities/identity/store';
import { Rng } from '../rng/DeterministicRNG';
import { Ledger } from '../ledger/Ledger';

export interface ITemplateItem extends IItem {
  itemType: 'TEMPLATE';
  templateData: ITemplate;
}

export const isTemplateItem = (item: IItem): item is ITemplateItem =>
  item.type === ItemType.TEMPLATE && !!(item as ITemplateItem).templateData;

export interface TemplateMintResult { ok: boolean; reason?: string; item?: ITemplateItem }

export const stashItems = () => usePlayerStore.getState().player.bank.stashTabs[0]?.items || [];

export const removeFromStash = (ids: string[]) => usePlayerStore.setState(s => ({
  player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((tab, idx) =>
    idx === 0 ? { ...tab, items: tab.items.filter(i => !ids.includes(i.id)) } : tab
  ) } }
}));

export const addToStash = (items: IItem[]) => usePlayerStore.setState(s => ({
  player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((tab, idx) =>
    idx === 0 ? { ...tab, items: [...tab.items, ...items] } : tab
  ) } }
}));

export class TemplateSystem {

  /** The plan, made an item. Same shape every mint; the rng gives it its id. */
  private static buildItem(tpl: ITemplate, key: string): ITemplateItem {
    const rng = Rng.fromKey(key);
    const pieces = tpl.pieces.length;
    return {
      id: `itm_${rng.int(0, 0xffffffff).toString(16).padStart(8, '0')}${rng.int(0, 0xffffffff).toString(16).padStart(8, '0')}`,
      universalDefinitionId: 'tpl_design',
      name: tpl.name,
      description: `A building plan in ${tpl.authorName}'s hand: ${tpl.footprint.width}×${tpl.footprint.height} lot, ${pieces} piece${pieces === 1 ? '' : 's'}. The architect's name travels with the house.`,
      type: ItemType.TEMPLATE,
      slot: SlotType.NONE,
      rank: UniversalRank.F,
      rarity: Rarity.UNCOMMON,
      level: 1,
      quality: 0, // Wave 10D: the one scale — 0 means no roll was taken
      value: 25 + pieces * 5 + tpl.zones.length * 10,
      itemPower: 0,
      tags: ['template', 'document'],
      affixes: [],
      dimensions: { width: 2, height: 2 },
      weight: 0.2,
      stats: {},
      visuals: { modelId: 'template', colorHex: '#e7e5e4' },
      icon: 'template_icon',
      history: { dropDate: Date.now(), killCount: 0 },
      isIdentified: true,
      itemType: 'TEMPLATE',
      templateData: tpl
    };
  }

  /** Pay paper and ink from the stash, exactly once. Refuses naming the shortfall. */
  static payBill(): { ok: boolean; reason?: string; ids: string[] } {
    const bill = pickBill(TEMPLATE_MINT_BILL, stashItems());
    if (!bill.ok) return { ok: false, reason: `The scribe's bill is short: ${bill.missing}. Paper and ink, nothing else writes.`, ids: [] };
    return { ok: true, ids: bill.items.map(i => i.id) };
  }

  /**
   * MINT TEMPLATE: the one gate. An invalid plan cannot be minted — the same
   * validators the builder runs decide, and the refusal says why. A valid plan
   * costs paper and ink, lands signed in the stash, provenance MINT origin DESIGN.
   */
  static async mintTemplate(draft: ITemplateDraft): Promise<TemplateMintResult> {
    const cert = useIdentityStore.getState().certificate;
    if (!cert) return { ok: false, reason: 'No identity holds the pen. Jack in first.' };
    if (!draft.name || !draft.name.trim()) return { ok: false, reason: 'A plan with no name cannot be signed.' };

    const verdict = validateTemplate(draft);
    if (!verdict.ok) return { ok: false, reason: verdict.reason! };

    const bill = this.payBill();
    if (!bill.ok) return { ok: false, reason: bill.reason! };

    const tpl: ITemplate = {
      version: 1,
      ...draft,
      name: draft.name.trim().toUpperCase(),
      authorUid: cert.metadata.uid,
      authorName: cert.metadata.displayName,
      designedAt: Date.now()
    };
    const item = this.buildItem(tpl, `tpl:${cert.metadata.uid}:${tpl.designedAt}:${tpl.name}`);

    removeFromStash(bill.ids);
    addToStash([item]);
    const { Provenance } = await import('../sovereignty/Provenance');
    await Provenance.record(item, 'MINT', { origin: 'DESIGN', authorUid: tpl.authorUid, authorName: tpl.authorName, consumedIds: bill.ids });
    await Ledger.append('DESIGN', { kind: 'TEMPLATE_MINTED', itemId: item.id, name: tpl.name, authorUid: tpl.authorUid, consumedIds: bill.ids });
    return { ok: true, item };
  }

  /**
   * MINT COPY (D14): the same bill, a new item, THE SAME AUTHOR. Whoever holds
   * the pen, the hand on the plan stays the architect's.
   */
  static async mintCopy(originalItemId: string): Promise<TemplateMintResult> {
    const cert = useIdentityStore.getState().certificate;
    if (!cert) return { ok: false, reason: 'No identity holds the pen. Jack in first.' };
    const original = stashItems().find(i => i.id === originalItemId);
    if (!original || !isTemplateItem(original)) return { ok: false, reason: 'That plan is not in your stash.' };

    const bill = this.payBill();
    if (!bill.ok) return { ok: false, reason: bill.reason! };

    const copy = this.buildItem(original.templateData, `tplcopy:${cert.metadata.uid}:${Date.now()}:${original.id}:${stashItems().length}`);
    removeFromStash(bill.ids);
    addToStash([copy]);
    const { Provenance } = await import('../sovereignty/Provenance');
    await Provenance.record(copy, 'MINT', {
      origin: 'COPY',
      ofItemId: original.id,
      authorUid: original.templateData.authorUid,
      authorName: original.templateData.authorName,
      copiedBy: cert.metadata.uid,
      consumedIds: bill.ids
    });
    await Ledger.append('DESIGN', { kind: 'TEMPLATE_COPIED', itemId: copy.id, ofItemId: original.id, authorUid: original.templateData.authorUid, consumedIds: bill.ids });
    return { ok: true, item: copy };
  }
}
