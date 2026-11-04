/**
 * THE CHARACTER SHEET (line 76): one key, the same screen everywhere. Who you are,
 * what you are wearing and what you are carrying, side by side, over whatever you
 * were doing: the game goes on underneath, and the sheet leaves the upper half of
 * the window to it. In the field it holds the pack, at home the vault. Same hands.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { EquipSlotId, IActiveSession, IAttributes, IItem, ItemType, SlotType } from '../../types';
import { usePlayerStore } from '../entities/player/store';
import { useHubStore } from '../entities/hub/store';
import { useWorldStore } from '../entities/world/store';
import { FieldCapture } from '../logic/systems/FieldCapture';
import { WorldGenerator } from '../entities/world/WorldGenerator';
import { InventorySystem, GRID_H, GRID_W } from '../entities/player/systems/InventorySystem';
import { LoadoutSystem } from '../entities/player/systems/LoadoutSystem';
import { ProgressionSystem } from '../entities/player/systems/ProgressionSystem';
import { STASH_COLS } from '../entities/player/systems/StashGrid';
import { GEAR_RECIPES } from '../entities/economy/data/recipeDefinitions';
import { StudySystem } from '../logic/systems/StudySystem';
import { StudyDoor } from '../logic/systems/StudyDoor';
import { StudyPanel } from './StudyPanel';
import { WebSystem } from '../logic/systems/WebSystem';
import { WebBank } from '../logic/content/WebBank';
import { isTypingTarget } from '../logic/systems/FieldInput';
import { PaperDoll } from './PaperDoll';
import { TheWorking } from './TheWorking';
import { RestSystem } from '../logic/systems/RestSystem';
import { StatSystem } from '../logic/systems/StatSystem';
import { ATTRIBUTE_GROUPS, HandsPanel, VAULT_CELL, VaultGrid } from './PlayerHub';
import { ItemGrid } from './ui/ItemGrid';
import { useDropZone, useHands, wholeZone } from './ui/hands';
import { ArmedButton, Bar, Button, Chip, Kbd, Panel, RankMark } from './ui/kit';
import { useAppView, useFeed, useSheet, useWaits } from './ui/stores';

const feed = (text: string, tone: 'plain' | 'signal' | 'proof' | 'loss' = 'plain') => useFeed.getState().push(text, tone);
const TILE_SIZE = 20;
const SHEET_BOTTOM = 62; // clear of the hotbar
const SHEET_TOP = 46; // clear of the city's bar

/**
 * THE PACK (Wave 9.4, the usability pass): the 8x6 spatial inventory beside the
 * body, in the items' real art at their real footprints. The grid never moves:
 * what can be done with the selected piece lives in a fixed column beside it, and
 * reading a piece is the card on hover. The ground is a place in the same hands.
 */
const CELL = 36;
const PACK_ACTIONS_W = 200;
const PACK_BODY_H = 332;
const GROUND_CELL = 24;
const GROUND_ROWS = 2;

/** What a piece most plainly wants: E, a double-click or a right-click (U6). */
const packPrimary = (item: IItem) => {
  const st = usePlayerStore.getState();
  // A signal may be tried on. Anything else it might be will not answer until it is read.
  if (item.isIdentified === false && item.slot === SlotType.NONE && !item.tags?.includes('tool')) {
    feed(LoadoutSystem.unreadRefusal(item).reason!, 'loss');
    return;
  }
  if (item.cartData) { void st.deployCart(item.id); return; }
  if (item.type === ItemType.CONSUMABLE && !item.charmData && !item.scrollData) { st.consumeItem(item.id); return; }
  if (item.slot !== SlotType.NONE || item.tags?.includes('tool')) { st.equipSwap(item.id); return; }
  feed(`${item.name} has no slot and no use in the hand. It rides the pack.`, 'plain');
};

const GroundPanel: React.FC<{ session: IActiveSession }> = ({ session }) => {
  const root = useRef<HTMLDivElement>(null);
  useDropZone('ground', wholeZone(root, { kind: 'GROUND' }));
  const map = useWorldStore(s => s.currentMap);
  const reach = 3 * TILE_SIZE;
  const caches = WorldGenerator.chunkKeysInBox(session.position.x, session.position.z, reach + 40)
    .flatMap(k => map?.chunks[k]?.entities ?? [])
    .filter(e => (e.container?.items?.length ?? 0) > 0 && !e.container!.looted &&
      Math.hypot(e.position.x - session.position.x, e.position.y - session.position.z) < reach);
  const cache = caches[0];
  const items = cache?.container?.items ?? [];
  const cols = Math.floor((GRID_W * CELL - 28) / GROUND_CELL);
  const rows = Math.max(GROUND_ROWS, Math.ceil(items.reduce((n, i) => n + (i.dimensions?.width ?? 1) * (i.dimensions?.height ?? 1), 0) / cols) + 3);
  const layout = useMemo(() => InventorySystem.placeAll(items, cols, rows), [items, cols, rows]);
  return (
    <div
      ref={root}
      data-drop-zone="ground"
      style={{ marginTop: 6, border: '1px dashed var(--ws-void-4)', width: GRID_W * CELL, height: GROUND_ROWS * GROUND_CELL + 24, padding: '2px 4px', overflowY: 'scroll', overflowX: 'hidden' }}
    >
      <div className="ws-dim ws-small">GROUND · {cache ? 'a cache in reach' : 'set a thing here to leave it'}</div>
      {cache && (
        <ItemGrid
          zoneId={`cache_${cache.id}`}
          place={{ kind: 'CACHE', entityId: cache.id }}
          items={items}
          layout={layout}
          gridW={cols}
          gridH={rows}
          cellPx={GROUND_CELL}
          onPrimary={item => { usePlayerStore.getState().takeFromCache(cache.id, item.id); }}
        />
      )}
    </div>
  );
};

const PackPanels = ({ session }: { session: IActiveSession }) => {
  const { dropItem, rotateItem, consumeItem, currentWeight, maxWeight, player } = usePlayerStore();
  const [selected, setSelected] = useState<string | null>(null);
  // Wave 10E (D19): the field identify runs on a real clock, and line 124 keeps it where the HUD can read it
  const waits = useWaits(s => s.waits);
  // Wave 10E (D21): a chosen charm asks which slot it holds
  const [invoking, setInvoking] = useState<string | null>(null);

  const layout = session.inventoryLayout || {};
  const items = session.inventory;
  const ratio = maxWeight > 0 ? currentWeight / maxWeight : 0;
  const selectedItem = items.find(i => i.id === selected);
  // What has not been read offers the same buttons whatever it is, so they tell nothing.
  const read = !!selectedItem && selectedItem.isIdentified !== false;
  const pouchSlots = player.equipment
    ? LoadoutSystem.availableSlots(player.equipment).filter(s => s.startsWith('POUCH_') && player.equipment!.slots[s])
    : [];
  const recipes = Object.values(GEAR_RECIPES).filter(r => r.requiredFacility === null &&
    r.inputs.every(req => items.filter(i => i.universalDefinitionId === req.itemId).length >= req.quantity));

  return (
    <>
      <Panel
        title={`PACK — ${InventorySystem.usedCells(items, layout)}/${GRID_W * GRID_H} CELLS`}
        right={
          <span className={ratio > 0.8 ? 'ws-loss' : 'ws-dim'}>
            {currentWeight.toFixed(1)}/{maxWeight}kg{ratio > 0.8 ? ' · SLOWED' : ''}
          </span>
        }
      >
        <ItemGrid
          zoneId="pack"
          place={{ kind: 'PACK' }}
          items={items}
          layout={layout}
          gridW={GRID_W}
          gridH={GRID_H}
          cellPx={CELL}
          selectedId={selected}
          onSelect={setSelected}
          onPrimary={packPrimary}
          onRotate={item => rotateItem(item.id)}
        />
        <GroundPanel session={session} />
      </Panel>
      <Panel title="THIS PIECE" style={{ width: PACK_ACTIONS_W, height: PACK_BODY_H, overflowY: 'auto', flexShrink: 0 }}>
        {!selectedItem && <StudyPanel />}
        {!selectedItem && (
          <div className="ws-dim ws-small" style={{ marginTop: 8 }}>
            Hover to read. Drag to move, <Kbd>R</Kbd> to turn. Right-click or <Kbd>E</Kbd> equips or uses. Click to choose a piece, or <Kbd>ARROWS</Kbd> then <Kbd>ENTER</Kbd> to take it in hand.
          </div>
        )}
        {selectedItem && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div className="ws-bright ws-small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selectedItem.isIdentified === false ? 'Unidentified Signal' : selectedItem.name}
            </div>
            {!read && <Button tone="proof" onClick={() => packPrimary(selectedItem)}>TRY IT</Button>}
            {read && selectedItem.type === ItemType.CONSUMABLE && !selectedItem.charmData && !selectedItem.scrollData && (
              <Button tone="signal" onClick={() => { consumeItem(selectedItem.id); setSelected(null); }}>{selectedItem.creatureData ? 'TRY TO TAME' : 'USE'}</Button>
            )}
            {selectedItem.creatureData && (
              <Button tone="quiet" onClick={() => { void FieldCapture.release(selectedItem.id); setSelected(null); }}>LET IT GO HERE</Button>
            )}
            {/* Wave 10E (D21): insurance is spent, not eaten — the magic names what it keeps */}
            {read && (selectedItem.charmData || selectedItem.scrollData) && (
              (selectedItem.charmData ?? selectedItem.scrollData)!.chosen ? (
                invoking === selectedItem.id ? (
                  Object.keys(player.equipment?.slots ?? {}).filter(s => player.equipment!.slots[s as EquipSlotId]).map(slot => (
                    <Button key={slot} tone="proof" onClick={() => {
                      const v = usePlayerStore.getState().useProtection(selectedItem.id, slot as EquipSlotId);
                      setInvoking(null);
                      if (v.ok) setSelected(null);
                    }}>
                      KEEP · {slot.replace('_', ' ')}
                    </Button>
                  ))
                ) : (
                  <Button tone="signal" onClick={() => setInvoking(selectedItem.id)}>INVOKE · CHOOSE A SLOT</Button>
                )
              ) : (
                <Button tone="signal" onClick={() => {
                  const v = usePlayerStore.getState().useProtection(selectedItem.id);
                  if (v.ok) setSelected(null);
                }}>INVOKE</Button>
              )
            )}
            {/* Wave 10E (D19): identify in the field — scoped, ALWAYS timed, faster with skill */}
            {StudySystem.identifyScopeOf(selectedItem) &&
              (selectedItem.isIdentified === false || selectedItem.affixes.some(a => !LoadoutSystem.isAffixStudied(player, a.id))) && (
              waits.some(w => w.id === `identify_${selectedItem.id}`) ? (
                <Button tone="quiet" disabled>LOOKING…</Button>
              ) : (
                <Button tone="signal" onClick={() => {
                  const ask = usePlayerStore.getState().fieldIdentify(selectedItem.id);
                  if (!ask.ok) return;
                  feed(`Identifying ${selectedItem.isIdentified === false ? 'the signal' : selectedItem.name} — ${ask.cost} energy, ${ask.seconds}s. It may give nothing up.`, 'signal');
                  const startedAt = Date.now();
                  useWaits.getState().begin({ id: `identify_${selectedItem.id}`, label: 'LOOKING', startedAt, until: startedAt + ask.seconds! * 1000 });
                  window.setTimeout(() => {
                    usePlayerStore.getState().completeFieldIdentify(selectedItem.id);
                    useWaits.getState().end(`identify_${selectedItem.id}`);
                  }, ask.seconds! * 1000);
                }}>
                  IDENTIFY · {StudySystem.identifyAsk(player, selectedItem).cost} energy · {StudySystem.identifyAsk(player, selectedItem).seconds}s
                </Button>
              )
            )}
            {/* D118: for energy, and it can go badly. A finished product asks for a workstation for it, and so does anything unread, so it tells nothing. */}
            {StudyDoor.offered(selectedItem) && (
              <Button tone="quiet" disabled={waits.some(w => w.id === 'study_sitting')} onClick={() => StudyDoor.start(StudySystem.targetOfItem(selectedItem))}>
                STUDY · {StudySystem.studyAsk(player, StudySystem.targetOfItem(selectedItem)).cost} energy · {StudySystem.studyAsk(player, StudySystem.targetOfItem(selectedItem)).seconds}s
              </Button>
            )}
            {read && selectedItem.type === ItemType.LORE && selectedItem.description && (
              <Button tone="proof" onClick={() => feed(`"${selectedItem.description}"`, 'proof')}>READ</Button>
            )}
            {read && (selectedItem.slot !== 'NONE' || selectedItem.tags?.includes('tool')) && selectedItem.type !== ItemType.CONSUMABLE && !selectedItem.cartData && (
              <Button tone="proof" onClick={() => {
                const v = usePlayerStore.getState().equipSwap(selectedItem.id);
                if (v.ok) setSelected(null);
              }}>
                EQUIP
              </Button>
            )}
            {read && selectedItem.cartData && (
              <Button tone="proof" onClick={() => { void usePlayerStore.getState().deployCart(selectedItem.id); setSelected(null); }}>
                UNFOLD CART
              </Button>
            )}
            {pouchSlots.map(slot => {
              const pouch = LoadoutSystem.itemIn(player.equipment!, slot)!;
              return (
                <Button
                  key={slot}
                  tone="quiet"
                  title={`${LoadoutSystem.shownName(pouch)}: stacks ${pouch.pouchData?.accepts.join(', ')}`}
                  onClick={() => {
                    const v = usePlayerStore.getState().stowInPouch(slot, selectedItem.id);
                    if (v.ok) setSelected(null);
                  }}
                >
                  STOW · {pouch.name.toUpperCase()}
                </Button>
              );
            })}
            <Button onClick={() => rotateItem(selectedItem.id)}>ROTATE</Button>
            <Button tone="loss" onClick={() => { dropItem(selectedItem.id); setSelected(null); }}>LEAVE BEHIND</Button>
          </div>
        )}
        {/* Wave 10D (10D.2): the floor — improvised crafting, right here, no bench */}
        {recipes.map(recipe => (
          <div key={recipe.id} style={{ marginTop: 6 }}>
            <Button
              tone="quiet"
              title={recipe.description}
              onClick={() => { usePlayerStore.getState().improviseInField(recipe.id); setSelected(null); }}
            >
              IMPROVISE · {recipe.name.toUpperCase()}
            </Button>
          </div>
        ))}
      </Panel>
    </>
  );
};

// =============================================================================
// AT HOME: the vault in the pack's place. Selling is at a counter, sorting at the vault.
// =============================================================================

const VaultPanels: React.FC = () => {
  const { player, toggleCarry, trashItem } = usePlayerStore();
  const [selected, setSelected] = useState<string | null>(null);
  const waits = useWaits(s => s.waits);
  const stash = player.bank.stashTabs[0]?.items ?? [];
  const piece = stash.find(i => i.id === selected);
  const tool = !!piece?.tags?.includes('tool');
  return (
    <>
      <Panel title={`THE VAULT — ${stash.length} HELD`} right={<span className="ws-proof">{player.bank.gold.toLocaleString()} G</span>}>
        <div style={{ height: PACK_BODY_H - 56, overflowY: 'auto', overflowX: 'hidden', width: STASH_COLS * VAULT_CELL + 14 }}>
          <VaultGrid zoneId="sheet_vault" cellPx={VAULT_CELL} selectedId={selected} onSelect={setSelected} />
        </div>
      </Panel>
      <Panel title="THIS PIECE" style={{ width: PACK_ACTIONS_W, height: PACK_BODY_H, overflowY: 'auto', flexShrink: 0 }}>
        {!piece && <StudyPanel />}
        {!piece && (
          <div className="ws-dim ws-small" style={{ marginTop: 8 }}>
            Hover to read. Drag onto the body, or right-click to wear. Click to choose a piece. The Vault Keeper sorts the vault; a counter buys from it.
          </div>
        )}
        {piece && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div className="ws-bright ws-small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {piece.isIdentified === false ? 'Unidentified Signal' : piece.name}
            </div>
            {(piece.slot !== SlotType.NONE || tool) && (
              <Button tone="proof" onClick={() => { if (usePlayerStore.getState().equipSwap(piece.id).ok) setSelected(null); }}>EQUIP</Button>
            )}
            {StudyDoor.offered(piece) && (
              <Button tone="quiet" disabled={waits.some(w => w.id === 'study_sitting')} onClick={() => StudyDoor.start(StudySystem.targetOfItem(piece))}>
                STUDY · {StudySystem.studyAsk(player, StudySystem.targetOfItem(piece)).cost} energy · {StudySystem.studyAsk(player, StudySystem.targetOfItem(piece)).seconds}s
              </Button>
            )}
            <Button
              tone={tool || player.bank.carryItemIds?.includes(piece.id) ? 'signal' : 'quiet'}
              disabled={tool}
              onClick={() => toggleCarry(piece.id)}
            >
              {tool ? 'TOOL, ALWAYS CARRIED' : player.bank.carryItemIds?.includes(piece.id) ? 'CARRYING · LEAVE HOME' : 'CARRY ON THE NEXT DROP'}
            </Button>
            <ArmedButton tone="loss" confirmLabel="DISCARD: IT DOES NOT COME BACK" onConfirm={() => { trashItem(piece.id, 'INVENTORY'); setSelected(null); }}>
              DISCARD
            </ArmedButton>
          </div>
        )}
      </Panel>
    </>
  );
};

// =============================================================================
// WHO YOU ARE: rank, level, attributes, what the hands know, every skill
// =============================================================================

const WhoPanel: React.FC = () => {
  const { player, spendAttributePoint } = usePlayerStore();
  const rank = ProgressionSystem.rankOf(player);
  const progress = ProgressionSystem.levelProgress(player);
  const points = player.attributePoints ?? 0;
  // D52: what an attribute does, in a line of its own that holds its place
  const [told, setTold] = useState<keyof IAttributes | null>(null);
  const held = useMemo(() => new Set(WebSystem.earnedSheet(player, WebBank.current(), useHubStore.getState().web).earned.map(r => r.id)), [player.bank.universalSkills, player.skillProgress]);
  const others = Object.values(player.bank.universalSkills || {})
    .filter(s => !held.has(s.id))
    .sort((a, b) => b.level - a.level);

  return (
    <Panel
      title={player.username.toUpperCase()}
      right={<span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><RankMark rank={rank} scale={2} />RANK {rank}</span>}
      style={{ flex: '1 1 240px', minWidth: 240, height: PACK_BODY_H, overflowY: 'auto' }}
    >
      <Bar label={`LV ${progress.level}`} value={progress.into} max={progress.needed} tone="signal" text={`${(progress.needed - progress.into).toLocaleString()} XP to level ${progress.level + 1}`} />
      {points > 0 && <div style={{ margin: '4px 0' }}><Chip tone="signal">{points} POINT{points === 1 ? '' : 'S'} TO SPEND</Chip></div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', columnGap: 10, margin: '6px 0' }}>
        {Object.entries(ATTRIBUTE_GROUPS).map(([group, attrs]) => (
          <div key={group} style={{ minWidth: 0 }}>
            <div className="ws-dim ws-small" style={{ letterSpacing: '0.06em', overflow: 'hidden', textOverflow: 'ellipsis' }}>{group}</div>
            {attrs.map(attr => (
              <div key={attr} className="ws-small" title={`${attr}: ${StatSystem.attributeWork(attr, player.attributes)}`} onMouseEnter={() => setTold(attr)} onMouseLeave={() => setTold(null)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                <span className="ws-dim">{attr === 'intimidation' ? 'IMD' : attr.slice(0, 3).toUpperCase()}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span className="ws-bright">{player.attributes[attr] || 0}</span>
                  {points > 0 && (
                    <Button tone="signal" aria-label={`Raise ${attr}`} style={{ padding: '0 4px' }} onClick={() => spendAttributePoint(attr)}>+</Button>
                  )}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="ws-dim ws-small" style={{ minHeight: '2.6em', marginBottom: 4 }}>
        {told ? `${told.toUpperCase()}: ${StatSystem.attributeWork(told, player.attributes)}` : 'Point at an attribute to read what it does for you.'}
      </div>

      <HandsPanel />
      <TheWorking />

      <div className="ws-dim ws-small" style={{ letterSpacing: '0.1em', margin: '8px 0 2px' }}>SKILLS</div>
      {others.length === 0 && <div className="ws-dim ws-small">None but what the hands know. Skills are born from actions, not menus.</div>}
      {others.map(skill => (
        <div key={skill.id} className="ws-row ws-small" style={{ padding: '2px 0' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <RankMark rank={ProgressionSystem.skillRankOf(skill)} scale={1} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{player.skillWords?.[skill.id]?.name ?? WebSystem.nameOf(skill.id)}</span>
          </span>
          <span className="ws-dim" style={{ flexShrink: 0 }}>level {skill.level}</span>
        </div>
      ))}
    </Panel>
  );
};

// =============================================================================
// THE SHEET: one key, the same screen everywhere, over whatever you were doing
// =============================================================================

const SheetBody: React.FC = () => {
  const session = usePlayerStore(s => s.player.currentSession);
  return (
    <div
      className="ws-ui"
      style={{ position: 'fixed', left: 16, right: 16, bottom: SHEET_BOTTOM, zIndex: 150, pointerEvents: 'none', display: 'flex', justifyContent: 'flex-end' }}
    >
      {/* Q8: in a narrow window the panels wrap onto a second row instead of running off the left edge, and the sheet scrolls rather than leave the top of the window */}
      <div data-pack-window style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'stretch', pointerEvents: 'auto', width: '100%', maxWidth: 1500, justifyContent: 'flex-end', maxHeight: `calc(100vh - ${SHEET_BOTTOM + SHEET_TOP}px)`, overflowY: 'auto' }}>
        <WhoPanel />
        <PaperDoll unit={24} compact />
        {session ? <PackPanels session={session} /> : <VaultPanels />}
      </div>
    </div>
  );
};

export const CharacterSheet: React.FC = () => {
  const open = useSheet(s => s.open);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useHands.getState().held || isTypingTarget(e.target) || e.ctrlKey || e.altKey || e.metaKey) return;
      if (document.querySelector('.ws-overlay')) return; // an open window keeps its keys
      const sheet = useSheet.getState();
      const inside = e.target instanceof Node && !!document.querySelector('[data-pack-window]')?.contains(e.target);
      const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };

      // Tab is the sheet's where the game is walking; on a screen of forms it stays the browser's.
      if (e.key === 'Tab') {
        if (inside) return;
        const walking = !!usePlayerStore.getState().player.currentSession || useAppView.getState().view === 'HUB';
        if (!walking) return;
        stop();
        sheet.toggle();
        return;
      }
      if (e.key.toLowerCase() === 'c') {
        stop();
        sheet.toggle();
        return;
      }
      if (!sheet.open) return;
      if (e.key === 'Escape') {
        stop();
        sheet.close();
        (document.activeElement as HTMLElement | null)?.blur?.();
        return;
      }
      // With the sheet open, the arrows reach into it: the keyboard's way to the pieces
      if (e.key.startsWith('Arrow') && !inside) {
        stop();
        (document.querySelector('[data-pack-window] [data-item-id]') as HTMLElement | null)?.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return open ? <SheetBody /> : null;
};
