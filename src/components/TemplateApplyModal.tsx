/**
 * THE MATERIAL SHEET (Wave 10B.4, Pedro's D13): raising a house from a plan.
 * One material per element class — walls, doors, windows, each floor zone —
 * each billed by TAG and consumed exactly once at apply. Size needs refuse in
 * voice with the numbers (line 43). The drawing itself is never consumed (D14).
 */

import React, { useMemo, useState } from 'react';
import { IItem, ItemType } from '../../types';
import { useHubStore, IPlayerLot } from '../entities/hub/store';
import { usePlayerStore } from '../entities/player/store';
import { HubGenerator } from '../entities/hub/HubGenerator';
import { ITemplateSheet, defaultSheet, sizeNeedsVerdict, templateBill, zoneFloorCount } from '../entities/hub/template';
import { ITemplateItem, isTemplateItem } from '../logic/systems/TemplateSystem';
import { STRUCTURE_COSTS } from '../entities/economy/data/recipeDefinitions';
import { useFeed } from './ui/stores';
import { inspectItem } from '../render/atoms/inspect';
import { Button, CardView, Chip, ItemSprite, Modal } from './ui/kit';

export const TemplateApplyModal: React.FC<{ lot: IPlayerLot; onClose: () => void }> = ({ lot, onClose }) => {
  const hub = useHubStore();
  const { player } = usePlayerStore();
  const pushFeed = useFeed(s => s.push);
  const stash = player.bank.stashTabs[0]?.items || [];
  const templates = stash.filter(i => i.type === ItemType.TEMPLATE && isTemplateItem(i)) as ITemplateItem[];

  const [selId, setSelId] = useState(templates[0]?.id ?? '');
  const selected = templates.find(t => t.id === selId);
  const tpl = selected?.templateData;

  const layout = useMemo(() => HubGenerator.generate(), []);
  const poi = HubGenerator.findPOI(layout, lot.id);
  const lotFootprint = poi ? { width: poi.size.width, height: poi.size.height } : { width: 4, height: 4 };

  const [sheet, setSheet] = useState<ITemplateSheet | null>(null);
  const liveSheet: ITemplateSheet = useMemo(() => {
    if (sheet) return sheet;
    return tpl ? defaultSheet(tpl) : { WALL: 'crf_plank', DOOR: 'crf_plank', WINDOW: 'crf_glass', zones: {} };
  }, [sheet, tpl]);

  /** The stash's answers to a tag: distinct materials carrying it, with counts. */
  const optionsFor = (tag: string) => {
    const byDef = new Map<string, { name: string; count: number }>();
    for (const item of stash) {
      if (item.id === selId) continue;
      if (!(item.tags || []).includes(tag)) continue;
      const got = byDef.get(item.universalDefinitionId) ?? { name: item.name, count: 0 };
      got.count++;
      byDef.set(item.universalDefinitionId, got);
    }
    return [...byDef.entries()].map(([defId, v]) => ({ defId, ...v }));
  };

  const sized = tpl ? sizeNeedsVerdict(tpl, lotFootprint) : { ok: false as const, reason: 'Pick a plan.' };
  const bill = tpl ? templateBill(tpl, liveSheet) : null;
  const permit = tpl ? STRUCTURE_COSTS[tpl.structureType].build : 0;

  const pickClass = (cls: 'WALL' | 'DOOR' | 'WINDOW', defId: string) =>
    setSheet({ ...liveSheet, [cls]: defId });
  const pickZone = (zone: string, defId: string) =>
    setSheet({ ...liveSheet, zones: { ...liveSheet.zones, [zone]: defId } });

  const apply = async () => {
    if (!selected) return;
    const res = await hub.applyTemplate(lot.id, selected.id, liveSheet);
    if (res.ok) {
      pushFeed(`${selected.name} rising on LOT ${lot.lotIndex}. The street shows the scaffold; walk in once the shell stands.`, 'proof');
      onClose();
    } else {
      pushFeed(res.reason, 'loss');
    }
  };

  const select = (cls: string, tag: string, value: string, onPick: (defId: string) => void, count: number) => {
    const options = optionsFor(tag);
    return (
      <div key={cls} className="ws-row">
        <span className="ws-small" style={{ minWidth: 110 }}>{cls} ×{count}</span>
        <select className="ws-input" style={{ flex: 1 }} value={value} onChange={e => onPick(e.target.value)} aria-label={`Material for ${cls}`}>
          {options.length === 0 && <option value={value}>nothing {tag} in the stash</option>}
          {options.map(o => <option key={o.defId} value={o.defId}>{o.name} — {o.count} held</option>)}
        </select>
      </div>
    );
  };

  return (
    <Modal title={`RAISE FROM A PLAN — LOT ${lot.lotIndex}`} onClose={onClose} width={680}>
      {templates.length === 0 && (
        <span className="ws-dim ws-small">No plans in the stash. They are drawn at a scribe's table, or bought where someone sells them.</span>
      )}
      {templates.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px', gap: 10, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="ws-list">
              {templates.map(t => (
                <div key={t.id} className="ws-row" style={selId === t.id ? { background: 'var(--ws-void-2)' } : undefined}>
                  <button
                    type="button" className="ws-ui"
                    onClick={() => { setSelId(t.id); setSheet(null); }}
                    style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1, minWidth: 0, textAlign: 'left', background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontFamily: 'var(--ws-mono)', padding: 2 }}
                  >
                    <ItemSprite item={t} cellPx={16} />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                      <span className="ws-dim ws-small">by {t.templateData.authorName} · needs {t.templateData.footprint.width}×{t.templateData.footprint.height}</span>
                    </span>
                  </button>
                </div>
              ))}
            </div>

            {tpl && !sized.ok && <span className="ws-small" style={{ color: 'var(--ws-loss)' }}>{sized.reason}</span>}

            {tpl && sized.ok && bill && (
              <>
                <span className="ws-dim ws-small">The sheet: one material per element class. The choice is what the house will look like.</span>
                {bill.choices.filter(c => c.cls === 'WALLS').map(c => select('WALLS', c.tag, liveSheet.WALL, d => pickClass('WALL', d), c.count))}
                {bill.choices.filter(c => c.cls === 'DOORS').map(c => select('DOORS', c.tag, liveSheet.DOOR, d => pickClass('DOOR', d), c.count))}
                {bill.choices.filter(c => c.cls === 'WINDOWS').map(c => select('WINDOWS', c.tag, liveSheet.WINDOW, d => pickClass('WINDOW', d), c.count))}
                {(tpl.zones ?? []).map(z =>
                  select(`FLOOR: ${z.name}`, 'building', liveSheet.zones[z.name] ?? 'crf_plank', d => pickZone(z.name, d), zoneFloorCount(z))
                )}
                {bill.tagLines.length > 0 && (
                  <span className="ws-dim ws-small">
                    The shell also asks, by tag: {bill.tagLines.map(l => `${l.count} ${l.tag}`).join(', ')}.
                  </span>
                )}
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <Chip tone={player.bank.gold >= permit ? 'proof' : 'loss'}>{permit} G permit</Chip>
                  <span className="ws-dim ws-small">consumed exactly once, at apply. The plan itself is never burned.</span>
                </div>
                <Button tone="signal" onClick={() => void apply()}>APPLY — RAISE THE HOUSE</Button>
              </>
            )}
          </div>
          {selected
            ? <CardView card={inspectItem(selected)} />
            : <span className="ws-dim ws-small">Select a plan to read it.</span>}
        </div>
      )}
    </Modal>
  );
};

export default TemplateApplyModal;
