/**
 * THE BANK (Wave 9, D7): the player-facing record of who you are — stats,
 * build and loadout for the next drop — plus skills, the stash, and the
 * ledger itself. Everything here is a record the Seed keeps about you.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { usePlayerStore } from '../entities/player/store';
import { useHubStore } from '../entities/hub/store';
import { POINTS_PER_RANK_UP, ProgressionSystem } from '../entities/player/systems/ProgressionSystem';
import { InventorySystem } from '../entities/player/systems/InventorySystem';
import { LoadoutSystem } from '../entities/player/systems/LoadoutSystem';
import { PaperDoll } from './PaperDoll';
import { IAttributes, IItem, ItemType, HEAD_BUDGET_POSITIONS } from '../../types';
import { Archetype } from '../render/atoms/people';
import { inspectItem } from '../render/atoms/inspect';
import { Bar, Button, CardView, Chip, Input, ItemSprite, Panel, PortraitView, RankMark, SealView, SpriteView, Tabs } from './ui/kit';
import { figure, weaponClass, armorClass } from '../render/atoms/people';
import { useAppView } from './ui/stores';
import { Ledger, ILedgerRow } from '../logic/ledger/Ledger';
import { ISignedPayload } from '../entities/identity/certificateSystem';

const ATTRIBUTE_GROUPS: Record<string, (keyof IAttributes)[]> = {
  HARDWARE: ['strength', 'constitution', 'agility', 'dexterity', 'endurance'],
  SOFTWARE: ['intelligence', 'focus', 'engineering', 'hacking', 'perception'],
  WETWARE: ['charisma', 'intimidation', 'subterfuge', 'bartering', 'leadership']
};

// ---------------------------------------------------------------------------
// AGENT: the build — attributes, frames, and the loadout for the next drop
// ---------------------------------------------------------------------------

const AgentTab: React.FC = () => {
  const { player, spendAttributePoint, toggleCarry, currentWeight, maxWeight, recalcWeight } = usePlayerStore();
  useEffect(() => { recalcWeight(); }, [recalcWeight]);

  const rankXp = player.rankXp ?? 0;
  const rank = ProgressionSystem.rankFromXp(rankXp);
  const next = ProgressionSystem.xpToNextRank(rankXp);
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

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(440px, auto) 300px 1fr', gap: 10, alignItems: 'start' }}>
      <PaperDoll />
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
        <div className="ws-dim ws-small">{(player.archetype || 'OPERATOR').replace('_', ' ')}</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 4px' }}>
          <RankMark rank={rank} scale={3} />
          <span className="ws-bright">RANK {rank}</span>
          {points > 0 && <Chip tone="signal">{points} POINT{points === 1 ? '' : 'S'} TO SPEND</Chip>}
        </div>
        {next
          ? <Bar label="RANK" value={rankXp - next.floor} max={(rankXp - next.floor) + next.needed} tone="signal" text={`${next.needed.toLocaleString()} XP to ${next.next}`} />
          : <div className="ws-dim ws-small">The track ends here. The world believes in you completely.</div>}
        <div className="ws-dim ws-small" style={{ marginTop: 4 }}>
          Kills feed the rank. Each rank grants {POINTS_PER_RANK_UP} attribute points.
        </div>
      </Panel>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Panel title="ATTRIBUTES" right={points > 0 ? <span className="ws-signal">SPEND {points}</span> : undefined}>
        {Object.entries(ATTRIBUTE_GROUPS).map(([group, attrs]) => (
          <div key={group} style={{ marginBottom: 8 }}>
            <div className="ws-dim ws-small" style={{ letterSpacing: '0.1em', marginBottom: 2 }}>{group}</div>
            {attrs.map(attr => {
              const val = player.attributes[attr] || 0;
              const base = player.baseAttributes[attr] || 0;
              const diff = val - base;
              return (
                <div key={attr} className="ws-row" style={{ padding: '2px 0' }}>
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
          THE HEAD BUDGET (D22) — HEAD, EYES, EARRING, NECKLACE each hold gear OR a frame; three frames at most.
          Mental stats come only from frames, and they drive the recon survey too.
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

      <Panel title="LOADOUT — NEXT DROP" right={<span className={kitWeight > capacity ? 'ws-loss' : 'ws-dim'}>{kitWeight.toFixed(1)} / {capacity} kg</span>}>
        <div className="ws-dim ws-small" style={{ marginBottom: 6 }}>
          Tools always ride. Mark anything else CARRY in the stash, and it drops with you — and can be lost with you.
        </div>
        {kit.length === 0 && <div className="ws-dim ws-small">Nothing marked. You would drop with empty hands.</div>}
        <div className="ws-list">
          {kit.map(item => (
            <div key={item.id} className="ws-row">
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
      .filter(([name]) => name.toLowerCase().includes(q))
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
          const xpNeeded = ProgressionSystem.getXpToNextLevel(skill.level);
          const rank = ProgressionSystem.getRankFromLevel(skill.level);
          return (
            <div key={key} className="ws-row">
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                <RankMark rank={rank} scale={2} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span className="t" style={{ display: 'block', textTransform: 'uppercase' }}>
                    {skill.id.replace('skill_', '').replace(/_/g, ' ')}
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
// STASH: the vault, with real art and the one inspect card
// ---------------------------------------------------------------------------

export const StashTab: React.FC = () => {
  const { player, toggleCarry, trashItem } = usePlayerStore();
  const { sellToVendor } = useHubStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const stash = player.bank.stashTabs[0]?.items || [];
  const selected = stash.find(i => i.id === selectedId) || null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 10, alignItems: 'start' }}>
      <Panel title="SECURE STORAGE" right={<span className="ws-proof">{player.bank.gold.toLocaleString()} G</span>}>
        {stash.length === 0 && <div className="ws-dim ws-small">Nothing stored. The vault keeps its silence.</div>}
        <div className="ws-list">
          {stash.map(item => {
            const carrying = item.tags?.includes('tool') || player.bank.carryItemIds?.includes(item.id);
            const offer = Math.max(1, Math.floor((item.value || 1) * 0.6));
            return (
              <div key={item.id} className="ws-row" style={selectedId === item.id ? { background: 'var(--ws-void-2)' } : undefined}>
                <button
                  type="button"
                  className="ws-ui"
                  onClick={() => setSelectedId(item.id === selectedId ? null : item.id)}
                  style={{
                    display: 'flex', gap: 8, alignItems: 'center', flex: 1, minWidth: 0, textAlign: 'left',
                    background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontFamily: 'var(--ws-mono)', padding: 2
                  }}
                >
                  <ItemSprite item={item} cellPx={16} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.isIdentified === false ? 'UNIDENTIFIED SIGNAL' : item.name}
                    </span>
                    <span className="ws-dim ws-small">{item.weight}kg · {item.value}G · {item.rank}</span>
                  </span>
                </button>
                <span style={{ display: 'flex', gap: 4 }}>
                  <Button
                    tone={carrying ? 'signal' : 'quiet'}
                    disabled={item.tags?.includes('tool')}
                    title={item.tags?.includes('tool') ? 'Tools always ride' : 'Take it on the next drop'}
                    onClick={() => toggleCarry(item.id)}
                  >
                    {carrying ? 'CARRYING' : 'CARRY'}
                  </Button>
                  <Button tone="proof" onClick={() => { void sellToVendor(item.id); if (selectedId === item.id) setSelectedId(null); }}>
                    SELL {offer}G
                  </Button>
                </span>
              </div>
            );
          })}
        </div>
      </Panel>

      <div style={{ position: 'sticky', top: 10 }}>
        {selected ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
              <ItemSprite item={selected} cellPx={36} />
            </div>
            <CardView card={inspectItem(selected)} right={<RankMark rank={String(selected.rank)} scale={2} />} />
            {selected.type === ItemType.LORE && selected.description && (
              <Panel title="FRAGMENT" tone="proof" style={{ marginTop: 8 }}>
                <div className="ws-small" style={{ fontStyle: 'italic' }}>{selected.description}</div>
              </Panel>
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
              <Button
                tone="loss"
                onClick={() => {
                  if (!confirm(`Discard ${selected.name}? The vault does not take things back.`)) return;
                  trashItem(selected.id, 'INVENTORY');
                  setSelectedId(null);
                }}
              >
                DISCARD
              </Button>
            </div>
          </>
        ) : (
          <Panel title="INSPECT">
            <div className="ws-dim ws-small">Select anything stored and the terminal reads it back: rarity in the frame, wear as bites, quality in the fill, rank in its mark.</div>
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
  TOMBSTONE: 'Superseded'
};

const rowSummary = (row: ILedgerRow): string => {
  const d = row.data || {};
  if (row.type === 'SESSION_RESULT') return `${d.outcome} · ${d.actionCount} actions`;
  if (row.type === 'GOLD_DELTA') return `${d.amount > 0 ? '+' : ''}${d.amount} G${d.reason ? ` · ${String(d.reason).toLowerCase().replace(/_/g, ' ')}` : ''}`;
  if (row.type === 'CHARACTER_GENESIS') return `${d.username} · birthright ${d.gold} G`;
  if (row.type === 'UPKEEP') return `lot upkeep · ${d.amount} G`;
  if (row.type === 'TRADE') return String(d.kind || '').toLowerCase().replace(/_/g, ' ');
  if (row.type === 'CRAFT') return String(d.kind || '').toLowerCase();
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
      {rows === null && <div className="ws-dim ws-small">Reading the chain…</div>}
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
