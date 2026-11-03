/**
 * THE BANK (Wave 9, D7): the player-facing record of who you are — stats,
 * build and loadout for the next drop — plus skills, the stash, and the
 * ledger itself. Everything here is a record the Seed keeps about you.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usePlayerStore } from '../entities/player/store';
import { useHubStore } from '../entities/hub/store';
import { POINTS_PER_LEVEL, ProgressionSystem } from '../entities/player/systems/ProgressionSystem';
import { StatSystem } from '../logic/systems/StatSystem';
import { CIRCLES_FOR_A_GIFT, CircleSystem } from '../logic/systems/CircleSystem';
import { InventorySystem } from '../entities/player/systems/InventorySystem';
import { LoadoutSystem } from '../entities/player/systems/LoadoutSystem';
import { PaperDoll } from './PaperDoll';
import { EquipSlotId, IAttributes, IItem, ItemType, SlotType, HEAD_BUDGET_POSITIONS } from '../../types';
import { STASH_COLS, StashFilter, StashGrid, StashKind, StashSortKey } from '../entities/player/systems/StashGrid';
import { ItemGrid } from './ui/ItemGrid';
import { useDropZone, wholeZone } from './ui/hands';
import { hoverProps } from './ui/stores';
import { Archetype } from '../render/atoms/people';
import { inspectItem } from '../render/atoms/inspect';
import { ArmedButton, Bar, Busy, Button, CardView, Chip, Input, ItemSprite, Kbd, Panel, PortraitView, RankMark, SealView, SpriteView, Tabs } from './ui/kit';
import { figure, weaponClass, armorClass } from '../render/atoms/people';
import { useAppView } from './ui/stores';
import { Ledger, ILedgerRow } from '../logic/ledger/Ledger';
import { ISignedPayload } from '../entities/identity/certificateSystem';
import { MASTERY_RUNGS, WebSystem } from '../logic/systems/WebSystem';
import { WebBank } from '../logic/content/WebBank';

export const ATTRIBUTE_GROUPS: Record<string, (keyof IAttributes)[]> = {
  HARDWARE: ['strength', 'constitution', 'agility', 'dexterity', 'endurance'],
  SOFTWARE: ['intelligence', 'focus', 'engineering', 'hacking', 'perception'],
  WETWARE: ['charisma', 'intimidation', 'subterfuge', 'bartering', 'leadership']
};

// ---------------------------------------------------------------------------
// D27: what the hands know. A rung reads by position and fill, never by hue.
// ---------------------------------------------------------------------------

const RungNotches: React.FC<{ rung: number; into: number }> = ({ rung, into }) => (
  <span style={{ display: 'inline-flex', gap: 2, verticalAlign: 'middle' }} aria-label={`${MASTERY_RUNGS[rung]}, rung ${rung + 1} of ${MASTERY_RUNGS.length}`}>
    {MASTERY_RUNGS.map((_, i) => {
      const fill = i < rung ? 100 : i === rung ? Math.max(12, Math.round(into * 100)) : 0;
      return (
        <span key={i} style={{ width: 16, height: 10, border: '1px solid var(--ws-text-bright)', position: 'relative', background: 'transparent' }}>
          <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${fill}%`, background: 'var(--ws-text-bright)' }} />
        </span>
      );
    })}
  </span>
);

/** A skill forming: a broken outline that fills. It says how far, never how far is far enough. */
const FormingFill: React.FC<{ fill: number }> = ({ fill }) => (
  <span style={{ display: 'inline-block', width: 66, height: 10, border: '1px dashed var(--ws-text-bright)', position: 'relative', verticalAlign: 'middle' }}>
    <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.round(fill * 100)}%`, background: 'repeating-linear-gradient(90deg, var(--ws-text-bright) 0 2px, transparent 2px 4px)' }} />
  </span>
);

/**
 * A skill's circles, in threes. Filled and hollow are told apart by shape, and each
 * group of three has a gap, so it reads in grayscale. There is always a next group: no top.
 */
const Circles: React.FC<{ filled: number }> = ({ filled }) => {
  const slots = (Math.floor(filled / CIRCLES_FOR_A_GIFT) + 1) * CIRCLES_FOR_A_GIFT;
  return (
    <span role="img" aria-label={`${filled} circles`} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      {Array.from({ length: slots }, (_, i) => (
        <span key={i} style={{
          width: 7, height: 7, borderRadius: '50%', boxSizing: 'border-box',
          border: '1px solid var(--ws-text-body)',
          background: i < filled ? 'var(--ws-text-body)' : 'transparent',
          marginLeft: i > 0 && i % CIRCLES_FOR_A_GIFT === 0 ? 4 : 0
        }} />
      ))}
    </span>
  );
};

export const HandsPanel: React.FC = () => {
  const { player, fillCircle } = usePlayerStore();
  const freeCircles = CircleSystem.free(player);
  const { web } = useHubStore();
  const sheet = useMemo(() => WebSystem.earnedSheet(player, WebBank.current(), web), [player, web]);
  return (
    <Panel title="WHAT THE HANDS KNOW" right={<span className="ws-dim ws-small">{sheet.earned.length} held{freeCircles > 0 ? ` · ${freeCircles} to fill` : ''}</span>}>
      {sheet.earned.length === 0 && sheet.forming.length === 0 && (
        <div className="ws-dim ws-small">Nothing yet. Work a material with a tool, and rest.</div>
      )}
      <div className="ws-list">
        {sheet.earned.map(row => (
          <div key={row.id} style={{ padding: '4px 0', borderBottom: '1px solid var(--ws-void-3)' }}>
            <div className="ws-row" style={{ padding: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <RankMark rank={row.rank} scale={1} />
                <span className="ws-bright">{row.name}</span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="ws-dim ws-small">LV {row.level} · {row.rungName}</span>
                <RungNotches rung={row.rung} into={row.into} />
              </span>
            </div>
            <div className="ws-row" style={{ padding: '2px 0' }}>
              <Circles filled={row.circles} />
              {freeCircles > 0 && (
                <Button tone="signal" aria-label={`Fill a circle in ${row.name}`} style={{ padding: '0 4px' }} onClick={() => fillCircle(row.id)}>+</Button>
              )}
            </div>
            {CircleSystem.giftsOf(player, row.id).map(g => (
              <div key={g.id} className="ws-small" title={g.blurb}>{CircleSystem.say(g)}</div>
            ))}
            {row.flavor && <div className="ws-dim ws-small">{row.flavor}</div>}
            {row.verbs.length > 0 && <div className="ws-small">can {row.verbs.join(', ')}</div>}
            {row.opens.length > 0 && <div className="ws-small">opens {row.opens.join(', ')}</div>}
            {row.firstBy && <div className="ws-dim ws-small">first in this hub: {row.firstBy}</div>}
          </div>
        ))}
      </div>
      {sheet.forming.length > 0 && (
        <>
          <div className="ws-dim ws-small" style={{ letterSpacing: '0.1em', margin: '8px 0 2px' }}>FORMING. IT SETTLES AT A REST, OR IT DOESN'T.</div>
          {sheet.forming.map(row => (
            <div key={row.name} className="ws-row ws-small" style={{ padding: '2px 0' }}>
              {/* D32: which eye is forming would say what the unread piece was */}
              <span style={{ minWidth: 0 }}>{/identify/.test(row.tool) ? 'the eye' : row.worked ? `${row.tool} on ${row.worked}` : row.tool}</span>
              <FormingFill fill={row.fill} />
            </div>
          ))}
        </>
      )}
      {sheet.opens.length > 0 && (
        <>
          <div className="ws-dim ws-small" style={{ letterSpacing: '0.1em', margin: '8px 0 2px' }}>THE HUB CAN RAISE</div>
          {sheet.opens.map(station => (
            <div key={station.id} className="ws-small" style={{ padding: '1px 0' }}>
              {station.name}{station.description ? <span className="ws-dim"> — {station.description}</span> : null}
            </div>
          ))}
        </>
      )}
    </Panel>
  );
};

// ---------------------------------------------------------------------------
// AGENT: the build — attributes, frames, and the loadout for the next drop
// ---------------------------------------------------------------------------

const AgentTab: React.FC = () => {
  const { player, spendAttributePoint, toggleCarry, currentWeight, maxWeight, recalcWeight } = usePlayerStore();
  useEffect(() => { recalcWeight(); }, [recalcWeight]);

  const rank = ProgressionSystem.rankOf(player);
  const progress = ProgressionSystem.levelProgress(player);
  const points = player.attributePoints ?? 0;
  const stash = player.bank.stashTabs[0]?.items || [];
  const equipment = player.equipment ?? LoadoutSystem.emptyEquipment();

  // The next drop's kit: the HARNESS rides as worn (weightless against the
  // limit, 10C.3); the pack takes tools-in-stash and whatever is marked CARRY
  const kit = stash.filter(i => i.tags?.includes('tool') || player.bank.carryItemIds?.includes(i.id));
  const kitWeight = kit.reduce((s, i) => s + (i.weight || 0), 0);
  const capacity = InventorySystem.maxCarryWeight(player.attributes.strength) + LoadoutSystem.bagCapacityBonus(equipment);
  // The figure draws what the harness holds (Wave 10C: the tree is the truth)
  const held = LoadoutSystem.itemIn(equipment, 'RIGHT_HAND');
  const worn = LoadoutSystem.itemIn(equipment, 'CHEST');
  const kitZone = useRef<HTMLDivElement>(null);
  useDropZone('kit', wholeZone(kitZone, { kind: 'KIT' }));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: `auto ${STASH_COLS * VAULT_CELL + 26}px minmax(280px, 1fr)`, gap: 10, alignItems: 'start' }}>
      <PaperDoll />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Panel title="THE VAULT" right={<span className="ws-proof">{player.bank.gold.toLocaleString()} G</span>}>
          <div className="ws-dim ws-small" style={{ marginBottom: 6 }}>Drag a piece onto the body, or right-click to wear it. Sell and sort on the STASH tab.</div>
          <div style={{ maxHeight: 300, overflowY: 'auto', overflowX: 'hidden' }}>
            <VaultGrid zoneId="vault" cellPx={VAULT_CELL} />
          </div>
        </Panel>
        <div ref={kitZone} data-drop-zone="kit">
        <Panel title="LOADOUT — NEXT DROP" right={<span className={kitWeight > capacity ? 'ws-loss' : 'ws-dim'}>{kitWeight.toFixed(1)} / {capacity} kg</span>}>
          <div className="ws-dim ws-small" style={{ marginBottom: 6 }}>
            Tools always ride. Drag anything else here, and it drops with you — and can be lost with you.
          </div>
          {kit.length === 0 && <div className="ws-dim ws-small">Nothing marked. You would drop with empty hands.</div>}
          <div className="ws-list">
            {kit.map(item => (
              <div key={item.id} className="ws-row" {...hoverProps(item)}>
                <span style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                  <ItemSprite item={item} cellPx={16} />
                  <span style={{ minWidth: 0 }}>
                    <span className="t" style={{ display: 'block' }}>{item.name}</span>
                    <span className="s">{item.weight}kg{item.tags?.includes('tool') ? ' · TOOL, ALWAYS CARRIED' : ''}</span>
                  </span>
                </span>
                {!item.tags?.includes('tool') && (
                  <Button tone="quiet" onClick={() => toggleCarry(item.id)}>LEAVE HOME</Button>
                )}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8 }}>
            <Bar label="LOAD" value={kitWeight} max={capacity} tone={kitWeight > capacity * 0.8 ? 'loss' : 'signal'} text={`${Math.round((kitWeight / Math.max(1, capacity)) * 100)}%`} />
          </div>
          <div className="ws-dim ws-small" style={{ marginTop: 6 }}>
            Session weight above 80% reads SLOWED in the field. Current bank weight: {currentWeight.toFixed(1)} / {maxWeight} kg.
            {equipment.items.length > 0 && <> The harness carries {LoadoutSystem.harnessWeight(equipment).toFixed(1)} kg more, and none of it counts: the limit is the haul, not the harness.</>}
          </div>
        </Panel>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <Panel title="IDENTITY">
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 8 }}>
          <PortraitView uid={player.id} archetype={(player.archetype || 'OPERATOR') as Archetype} scale={3} />
          <SpriteView
            sprite={figure({
              uid: player.id, archetype: (player.archetype || 'OPERATOR') as Archetype,
              weapon: held ? weaponClass(held.tags || []) : undefined,
              armor: worn ? armorClass(worn.tags || []) : undefined
            })}
            scale={4}
            title="You, as the next drop will draw you"
          />
        </div>
        <div className="ws-bright">{player.username.toUpperCase()}</div>
        <div className="ws-dim ws-small" style={{ wordBreak: 'break-all' }}>{player.id}</div>
        <div className="ws-dim ws-small">{player.creation?.className ?? (player.archetype || 'OPERATOR').replace('_', ' ')}</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 4px' }}>
          <RankMark rank={rank} scale={3} />
          <span className="ws-bright">RANK {rank}</span>
          {points > 0 && <Chip tone="signal">{points} POINT{points === 1 ? '' : 'S'} TO SPEND</Chip>}
        </div>
        <Bar label={`LV ${progress.level}`} value={progress.into} max={progress.needed} tone="signal" text={`${(progress.needed - progress.into).toLocaleString()} XP to level ${progress.level + 1}`} />
        <div className="ws-dim ws-small" style={{ marginTop: 4 }}>
          Fights, chests and what you gather feed the level, more for what is riskier. Each level grants {POINTS_PER_LEVEL} attribute point and a circle. The guild sets the rank; the level begins again there, and what you built stays.
        </div>
      </Panel>
      <HandsPanel />
      <Panel title="ATTRIBUTES" right={points > 0 ? <span className="ws-signal">SPEND {points}</span> : undefined}>
        {Object.entries(ATTRIBUTE_GROUPS).map(([group, attrs]) => (
          <div key={group} style={{ marginBottom: 8 }}>
            <div className="ws-dim ws-small" style={{ letterSpacing: '0.1em', marginBottom: 2 }}>{group}</div>
            {attrs.map(attr => {
              const val = player.attributes[attr] || 0;
              const base = player.baseAttributes[attr] || 0;
              const diff = val - base;
              return (
                <div key={attr} className="ws-row" title={StatSystem.attributeWork(attr, player.attributes)} style={{ padding: '2px 0' }}>
                  <span style={{ textTransform: 'capitalize' }}>{attr}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {diff !== 0 && <span className={diff > 0 ? 'ws-signal ws-small' : 'ws-loss ws-small'}>{diff > 0 ? '+' : ''}{diff}</span>}
                    <span className="ws-bright" style={{ minWidth: 20, textAlign: 'right' }}>{val}</span>
                    {points > 0 && (
                      <Button tone="signal" onClick={() => spendAttributePoint(attr)} title={`Raise ${attr} permanently`}>+1</Button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
        <div className="ws-dim ws-small" style={{ marginTop: 6 }}>
          THE HEAD BUDGET — HEAD, EYES, EARRING, NECKLACE each hold gear OR a frame; three frames at most.
          Gear never adds to the mental stats; a frame does, beside what you were dealt, and they drive the recon survey too.
        </div>
        {HEAD_BUDGET_POSITIONS.map(position => {
          const frame = LoadoutSystem.frameAt(equipment, position);
          const gear = LoadoutSystem.itemIn(equipment, position);
          return (
            <div key={position} className="ws-row">
              <span className="ws-dim ws-small" style={{ width: 80 }}>{position}</span>
              <span className={frame ? 'ws-signal' : gear ? 'ws-bright' : 'ws-dim'}>
                {frame ? `${frame.name} (frame)` : gear ? gear.name : 'open'}
              </span>
            </div>
          );
        })}
        <div className="ws-dim ws-small" style={{ marginTop: 2 }}>Seat and clear frames on the body, left.</div>
      </Panel>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// SKILLS: grown by use; the rank is effectiveness against the task (D6)
// ---------------------------------------------------------------------------

const SkillsTab: React.FC = () => {
  const { player } = usePlayerStore();
  const [query, setQuery] = useState('');
  const skills = player.bank.universalSkills || {};
  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return Object.entries(skills)
      .filter(([id]) => WebSystem.nameOf(id).toLowerCase().includes(q))
      .sort((a, b) => b[1].level - a[1].level);
  }, [skills, query]);

  return (
    <Panel title="SKILL ENGRAMS" right={<span className="ws-dim ws-small">{Object.keys(skills).length} known</span>}>
      <Input placeholder="SEARCH THE ENGRAM INDEX…" value={query} onChange={e => setQuery(e.target.value)} />
      <div className="ws-dim ws-small" style={{ margin: '6px 0' }}>
        Skills grow by use. The rank is how much the world believes the skill: outrank a task by three and it simply opens.
      </div>
      {filtered.length === 0 && <div className="ws-dim ws-small" style={{ marginTop: 10 }}>No matching engrams. Skills are born from actions, not menus.</div>}
      <div className="ws-list">
        {filtered.map(([key, skill]) => {
          const xpNeeded = ProgressionSystem.getXpToNextLevel(skill.level, ProgressionSystem.skillRarity(skill));
          const rank = ProgressionSystem.skillRankOf(skill);
          return (
            <div key={key} className="ws-row">
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                <RankMark rank={rank} scale={2} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span className="t" style={{ display: 'block', textTransform: 'uppercase' }}>
                    {player.skillWords?.[skill.id]?.name ?? WebSystem.nameOf(skill.id)}
                  </span>
                  <span className="s">
                    base {skill.level}
                    {skill.origin ? ` · born of ${skill.origin.triggerAction}` : ''}
                  </span>
                </span>
              </span>
              <span style={{ width: 180 }}>
                <Bar value={skill.currentXp} max={xpNeeded} tone="signal" text={`${skill.currentXp}/${xpNeeded}`} />
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
};

// ---------------------------------------------------------------------------
// STASH: the vault as a grid (U13). It sorts and filters by what can be seen;
// a piece is read on hover, moved by hand, and sold only on a second press.
// ---------------------------------------------------------------------------

const STASH_CELL = 36;
export const VAULT_CELL = 24;

const SORT_KEYS: StashSortKey[] = ['NAME', 'RANK', 'VALUE', 'WEIGHT', 'TYPE'];
const KIND_WORDS: { id: StashKind; label: string }[] = [
  { id: 'ALL', label: 'ALL' }, { id: 'GEAR', label: 'GEAR' }, { id: 'TOOL', label: 'TOOLS' },
  { id: 'MATERIAL', label: 'MATERIAL' }, { id: 'USE', label: 'USE' }, { id: 'UNREAD', label: 'UNREAD' }
];

/** What a piece in the vault most plainly wants: to be worn, if it can be. */
const vaultPrimary = (item: IItem) => {
  const st = usePlayerStore.getState();
  if (item.slot !== SlotType.NONE || item.tags?.includes('tool')) st.equipSwap(item.id);
};

export const VaultGrid: React.FC<{
  zoneId: string; cellPx: number; selectedId?: string | null; onSelect?: (id: string | null) => void; filter?: StashFilter;
}> = ({ zoneId, cellPx, selectedId, onSelect, filter }) => {
  const { player } = usePlayerStore();
  const tab = player.bank.stashTabs[0];
  const items = tab?.items ?? [];
  const layout = useMemo(() => StashGrid.resolve(items, tab?.layout), [items, tab?.layout]);
  return (
    <ItemGrid
      zoneId={zoneId}
      place={{ kind: 'STASH' }}
      items={items}
      layout={layout}
      gridW={STASH_COLS}
      gridH={StashGrid.rows(items, layout)}
      cellPx={cellPx}
      selectedId={selectedId}
      onSelect={onSelect}
      onPrimary={vaultPrimary}
      dimmed={filter ? item => !StashGrid.matches(item, filter, player) : undefined}
      badge={item => (!item.tags?.includes('tool') && player.bank.carryItemIds?.includes(item.id) ? 'C' : null)}
    />
  );
};

export const StashTab: React.FC = () => {
  const { player, toggleCarry, trashItem, arrangeStash } = usePlayerStore();
  const { sellToVendor } = useHubStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<StashFilter>({ text: '', kind: 'ALL' });
  const stash = player.bank.stashTabs[0]?.items || [];
  const selected = stash.find(i => i.id === selectedId) || null;
  const shown = stash.filter(i => StashGrid.matches(i, filter, player)).length;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: `${STASH_COLS * STASH_CELL + 26}px minmax(300px, 340px)`, gap: 10, alignItems: 'start' }}>
      <Panel title="SECURE STORAGE" right={<span className="ws-proof">{player.bank.gold.toLocaleString()} G</span>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
          <Input placeholder="FIND BY NAME…" value={filter.text} onChange={e => setFilter(f => ({ ...f, text: e.target.value }))} aria-label="Find by name" />
          <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="ws-dim ws-small" style={{ width: 44 }}>SHOW</span>
            {KIND_WORDS.map(k => (
              <Button key={k.id} tone="quiet" primary={filter.kind === k.id} aria-pressed={filter.kind === k.id} style={{ padding: '2px 6px', borderColor: filter.kind === k.id ? 'var(--ws-text-bright)' : undefined, fontSize: 'var(--ws-font-small)' }} onClick={() => setFilter(f => ({ ...f, kind: k.id }))}>{k.label}</Button>
            ))}
            <span className="ws-dim ws-small" style={{ marginLeft: 'auto' }}>{shown} of {stash.length}</span>
          </div>
          <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="ws-dim ws-small" style={{ width: 44 }}>SORT</span>
            {SORT_KEYS.map(k => (
              <Button key={k} tone="quiet" style={{ padding: '2px 6px' }} onClick={() => arrangeStash(k)}>{k}</Button>
            ))}
          </div>
        </div>
        {stash.length === 0 && <div className="ws-dim ws-small">Nothing stored. The vault keeps its silence.</div>}
        <VaultGrid zoneId="stash" cellPx={STASH_CELL} selectedId={selectedId} onSelect={setSelectedId} filter={filter} />
      </Panel>

      <div style={{ position: 'sticky', top: 10 }}>
        {selected ? (
          <>
            <CardView card={inspectItem(selected, player)} right={<RankMark rank={String(selected.rank)} scale={2} />} />
            {selected.type === ItemType.LORE && selected.description && (
              <Panel title="FRAGMENT" tone="proof" style={{ marginTop: 8 }}>
                <div className="ws-small" style={{ fontStyle: 'italic' }}>{selected.description}</div>
              </Panel>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
              {(selected.slot !== SlotType.NONE || selected.tags?.includes('tool')) && (
                <Button tone="proof" onClick={() => { if (usePlayerStore.getState().equipSwap(selected.id).ok) setSelectedId(null); }}>EQUIP</Button>
              )}
              <Button
                tone={selected.tags?.includes('tool') || player.bank.carryItemIds?.includes(selected.id) ? 'signal' : 'quiet'}
                disabled={selected.tags?.includes('tool')}
                title={selected.tags?.includes('tool') ? 'Tools always ride' : 'Take it on the next drop'}
                onClick={() => toggleCarry(selected.id)}
              >
                {selected.tags?.includes('tool') ? 'TOOL, ALWAYS CARRIED' : player.bank.carryItemIds?.includes(selected.id) ? 'CARRYING · LEAVE HOME' : 'CARRY ON THE NEXT DROP'}
              </Button>
              {/* Wave 10E (D21): insurance invokes from the vault — mark before the drop */}
              {(selected.charmData || selected.scrollData) && (
                (selected.charmData ?? selected.scrollData)!.chosen ? (
                  Object.entries(player.equipment?.slots ?? {}).filter(([, id]) => !!id).length === 0
                    ? <span className="ws-dim ws-small">Nothing is worn. The magic has nothing to hold.</span>
                    : Object.entries(player.equipment?.slots ?? {}).filter(([, id]) => !!id).map(([slot]) => (
                      <Button key={slot} tone="signal" onClick={() => {
                        const v = usePlayerStore.getState().useProtection(selected.id, slot as EquipSlotId);
                        if (v.ok) setSelectedId(null);
                      }}>
                        INVOKE · KEEP {slot.replace('_', ' ')}
                      </Button>
                    ))
                ) : (
                  <Button tone="signal" onClick={() => {
                    const v = usePlayerStore.getState().useProtection(selected.id);
                    if (v.ok) setSelectedId(null);
                  }}>INVOKE</Button>
                )
              )}
              {/* U14: a sale is a deliberate step, and it sits apart from CARRY */}
              <div style={{ display: 'flex', gap: 6, marginTop: 10, justifyContent: 'space-between' }}>
                <ArmedButton
                  tone="proof"
                  confirmLabel={`SELL FOR ${StatSystem.vendorOffer(selected.value, player.attributes)}G: SURE?`}
                  onConfirm={() => { void sellToVendor(selected.id); setSelectedId(null); }}
                >
                  SELL {StatSystem.vendorOffer(selected.value, player.attributes)}G
                </ArmedButton>
                <ArmedButton
                  tone="loss"
                  confirmLabel="DISCARD: IT DOES NOT COME BACK"
                  onConfirm={() => { trashItem(selected.id, 'INVENTORY'); setSelectedId(null); }}
                >
                  DISCARD
                </ArmedButton>
              </div>
            </div>
          </>
        ) : (
          <Panel title="THIS PIECE">
            <div className="ws-dim ws-small">Hover anything stored and the terminal reads it back, set against what you wear. Drag to place it, <Kbd>R</Kbd> to turn it. Click to choose a piece and carry, sell or discard it. Right-click wears it.</div>
          </Panel>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// LEDGER: the core of the fantasy, finally visible (line 31)
// ---------------------------------------------------------------------------

const ROW_WORDS: Record<string, string> = {
  CHARACTER_GENESIS: 'Identity minted',
  SESSION_RESULT: 'Session sealed',
  GOLD_DELTA: 'Gold moved',
  TAX: 'Levy charged',
  TRADE: 'Item changed hands',
  CRAFT: 'Transformation',
  UPKEEP: 'Upkeep charged',
  GUILD: 'The guild',
  PRINT: 'The hub printed',
  WALLET: 'Came with their own coin',
  FARM: 'The farm',
  TOMBSTONE: 'Superseded'
};

const rowSummary = (row: ILedgerRow): string => {
  const d = row.data || {};
  if (row.type === 'SESSION_RESULT') return `${d.outcome} · ${d.actionCount} actions`;
  if (row.type === 'GOLD_DELTA') return `${d.amount > 0 ? '+' : ''}${d.amount} G${d.reason ? ` · ${String(d.reason).toLowerCase().replace(/_/g, ' ')}` : ''}`;
  if (row.type === 'CHARACTER_GENESIS') return `${d.username} · birthright ${d.gold} G`;
  if (row.type === 'UPKEEP') return `lot upkeep · ${d.amount} G`;
  if (row.type === 'PRINT') return `+${d.amount} G into the treasury · ${d.days} days at ${d.perDay} G`;
  if (row.type === 'WALLET') return `${d.name} · ${d.amount} G`;
  if (row.type === 'TRADE') return String(d.kind || '').toLowerCase().replace(/_/g, ' ');
  if (row.type === 'CRAFT' || row.type === 'GUILD' || row.type === 'FARM') return String(d.kind || '').toLowerCase().replace(/_/g, ' ');
  return '';
};

const LedgerTab: React.FC = () => {
  const { player } = usePlayerStore();
  const [rows, setRows] = useState<ISignedPayload<ILedgerRow>[] | null>(null);
  const [audit, setAudit] = useState<{ ok: boolean; rows: number } | null>(null);

  useEffect(() => {
    let alive = true;
    Ledger.list(player.id).then(r => { if (alive) setRows(r.reverse()); }).catch(() => setRows([]));
    return () => { alive = false; };
  }, [player.id]);

  return (
    <Panel
      title="THE LEDGER"
      right={
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {audit && <span className={audit.ok ? 'ws-signal' : 'ws-loss'}>{audit.ok ? `CHAIN VERIFIED · ${audit.rows} ROWS` : 'CHAIN BROKEN'}</span>}
          <Button tone="quiet" onClick={() => Ledger.audit(player.id).then(setAudit)}>AUDIT THE CHAIN</Button>
        </span>
      }
    >
      <div className="ws-dim ws-small" style={{ marginBottom: 8 }}>
        Append-only, signed, each row chained to the last. This is what the game is actually made of.
      </div>
      {rows === null && <Busy label="READING THE CHAIN" quietForMs={250} />}
      {rows !== null && rows.length === 0 && <div className="ws-dim ws-small">No rows yet. Everything you do from here on becomes one.</div>}
      <div className="ws-list">
        {rows?.map(signed => {
          const row = signed.payload;
          return (
            <div key={row.seq} className="ws-row">
              <span style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0, flex: 1 }}>
                <SealView hash={signed.signature || String(row.seq)} scale={1} />
                <span className="ws-dim ws-small" style={{ width: 56 }}>#{String(row.seq).padStart(5, '0')}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block' }}>{ROW_WORDS[row.type] ?? row.type}</span>
                  <span className="ws-dim ws-small">{rowSummary(row)}</span>
                </span>
              </span>
              <span className="ws-dim ws-small">{new Date(row.ts).toLocaleString()}</span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
};

// ---------------------------------------------------------------------------

export const PlayerHub = () => {
  const { bankTab, setBankTab } = useAppView();
  return (
    <div className="ws-ui" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Tabs
        tabs={[
          { id: 'agent', label: 'AGENT' },
          { id: 'skills', label: 'SKILLS' },
          { id: 'stash', label: 'STASH' },
          { id: 'ledger', label: 'LEDGER' }
        ]}
        active={bankTab}
        onChange={setBankTab}
      />
      {bankTab === 'agent' && <AgentTab />}
      {bankTab === 'skills' && <SkillsTab />}
      {bankTab === 'stash' && <StashTab />}
      {bankTab === 'ledger' && <LedgerTab />}
    </div>
  );
};
