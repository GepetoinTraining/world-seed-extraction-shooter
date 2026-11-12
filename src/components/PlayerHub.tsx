/**
 * THE BANK (Wave 9, D7): the player-facing record of who you are — stats,
 * build and loadout for the next drop — plus skills, the stash, and the
 * ledger itself. Everything here is a record the Seed keeps about you.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usePlayerStore } from '../entities/player/store';
import { useHubStore } from '../entities/hub/store';
import { ATTRIBUTE_GROUPS as GROUPS, GROUP_ORDER, GROUP_WORDS, AttributeGroup, LEVELS_PER_CIRCLE, POINTS_PER_LEVEL, ProgressionSystem } from '../../shared/entities/player/systems/ProgressionSystem';
import { StatSystem } from '../../shared/logic/systems/StatSystem';
import { CIRCLES_FOR_A_GIFT, CircleSystem } from '../logic/systems/CircleSystem';
import { VendorSystem } from '../logic/systems/VendorSystem';
import { InventorySystem } from '../../shared/entities/player/systems/InventorySystem';
import { LoadoutSystem } from '../../shared/entities/player/systems/LoadoutSystem';
import { PaperDoll } from './PaperDoll';
import { LargeSheet } from './LargeSheet';
import { TechWebView } from './TechWebView';
import { EquipSlotId, IAttributes, IItem, ItemType, SlotType, HEAD_BUDGET_POSITIONS } from '../../shared/types';
import { STASH_COLS, StashFilter, StashGrid, StashKind, StashSortKey } from '../entities/player/systems/StashGrid';
import { ItemGrid } from './ui/ItemGrid';
import { groupHeading, plusSays } from './ui/levelLine';
import { useDropZone, wholeZone } from './ui/hands';
import { hoverProps } from './ui/stores';
import { Archetype } from '../../shared/render/atoms/people';
import { inspectItem } from '../render/atoms/inspect';
import { ArmedButton, Bar, Busy, Button, CardView, Chip, Input, ItemSprite, Kbd, Panel, PortraitView, RankMark, SealView, SpriteView, Tabs } from './ui/kit';
import { figure, weaponClass, armorClass } from '../../shared/render/atoms/people';
import { useAppView } from './ui/stores';
import { Ledger, ILedgerRow } from '../logic/ledger/Ledger';
import { ISignedPayload } from '../entities/identity/certificateSystem';
import { MASTERY_RUNGS, WebSystem } from '../../shared/logic/systems/WebSystem';
import { WebBank } from '../../shared/logic/content/WebBank';
import { foldForming } from '../logic/systems/SheetWords';

/** The groups are the shared rules' (2.13); a sheet draws each by its word and its place, in this order. */
export const ATTRIBUTE_GROUPS: Record<string, (keyof IAttributes)[]> = Object.fromEntries(GROUP_ORDER.map(g => [GROUP_WORDS[g], GROUPS[g]]));

/** The kind of point a + would spend, in words: a group's own, or the free one. */
export const pointWord = (kind: AttributeGroup | 'free'): string => (kind === 'free' ? 'the free point' : `a ${GROUP_WORDS[kind]} point`);

/** What waits to be spent, by kind, in one line: "1 FREE · 1 HARDWARE · 1 SOFTWARE · 1 WETWARE". */
export const pointsLine = (player: Parameters<typeof ProgressionSystem.unspent>[0]): string => {
  const left = ProgressionSystem.unspent(player);
  return [...(left.free > 0 ? [`${left.free} FREE`] : []), ...GROUP_ORDER.filter(g => left[g] > 0).map(g => `${left[g]} ${GROUP_WORDS[g]}`)].join(' · ');
};

export const groupOfWord = (word: string): AttributeGroup => GROUP_ORDER.find(g => GROUP_WORDS[g] === word)!;

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
 * A skill's circles, in groups that end where a gift falls: threes, but a first group of one for the
 * character's very first gift (2026-11-11). Filled and hollow are told apart by shape, and each group
 * has a gap, so it reads in grayscale. There is always a next group: no top.
 */
const Circles: React.FC<{ filled: number; first?: number }> = ({ filled, first = CIRCLES_FOR_A_GIFT }) => {
  const slots = filled < first ? first : first + (Math.floor((filled - first) / CIRCLES_FOR_A_GIFT) + 1) * CIRCLES_FOR_A_GIFT;
  return (
    <span role="img" aria-label={`${filled} circles`} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      {Array.from({ length: slots }, (_, i) => (
        <span key={i} style={{
          width: 7, height: 7, borderRadius: '50%', boxSizing: 'border-box',
          border: '1px solid var(--ws-text-body)',
          background: i < filled ? 'var(--ws-text-body)' : 'transparent',
          marginLeft: i >= first && (i - first) % CIRCLES_FOR_A_GIFT === 0 ? 4 : 0
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
              <Circles filled={row.circles} first={CircleSystem.firstAsks(player, row.id)} />
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
          {/* D32: which eye is forming would say what the unread piece was, so rows that read alike are one (SheetWords) */}
          {foldForming(sheet.forming).map(row => (
            <div key={row.said} className="ws-row ws-small" style={{ padding: '2px 0' }}>
              <span style={{ minWidth: 0 }}>{row.said}</span>
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
// AGENT: the large character sheet itself (the interface pass, 2026-11-11). Pedro: "right now we have
// the small character sheet and no big one". The tab is no longer a second, different sheet.
// ---------------------------------------------------------------------------

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
      onRotate={item => usePlayerStore.getState().rotateItem(item.id)}
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
                {/* Q12 and Q17: an unread piece shows no offer, and a person is not for sale */}
                {VendorSystem.refuses(selected) ? (
                  <span className="ws-dim ws-small">{VendorSystem.refuses(selected)}</span>
                ) : (
                  <ArmedButton
                    tone="proof"
                    confirmLabel={`SELL FOR ${StatSystem.vendorOffer(selected.value, player.attributes)}G: SURE?`}
                    onConfirm={() => { void sellToVendor(selected.id); setSelectedId(null); }}
                  >
                    SELL {StatSystem.vendorOffer(selected.value, player.attributes)}G
                  </ArmedButton>
                )}
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
          { id: 'web', label: 'THE WEB' },
          { id: 'stash', label: 'STASH' },
          { id: 'ledger', label: 'LEDGER' }
        ]}
        active={bankTab}
        onChange={setBankTab}
      />
      {bankTab === 'agent' && <LargeSheet />}
      {bankTab === 'skills' && <SkillsTab />}
      {bankTab === 'web' && <TechWebView />}
      {bankTab === 'stash' && <StashTab />}
      {bankTab === 'ledger' && <LedgerTab />}
    </div>
  );
};
