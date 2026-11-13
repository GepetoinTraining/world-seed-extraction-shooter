/**
 * THE LARGE CHARACTER SHEET (the interface pass, part 2, 2026-11-11; redone as one design by GV, 2026-11-12). Pedro:
 * "the base stats, all of them are cool, but right now the way the skills come into play don't tell anyone anything, the
 * character sheet itself needs a passover". One sheet, the same in a world and at home, ordered by what a player opens
 * it for: what waits to be spent; how they stand (health, energy, a fight); their attributes, each with what it does for
 * them; their skills, each with what it does, what grows it and what it needs, beside the lore that pays for them; then
 * what they wear and carry; then the rest. The small sheet stays the quick one; SHIFT+C or its LARGE SHEET button open
 * this over everything, and the hub's AGENT tab shows this same sheet.
 *
 * Every derived number is read through `SheetNumbers`, `SkillSay` or the rules' own functions; nothing here sums a stat.
 * UXS (2026-11-12), on Pedro's "yup, and hover click opens description, description opens only if the skill to describe it
 * is found": numbers first. A line is its word and its number; what it means is its description, opened behind it by hover
 * or a click, and only for a character holding the skill that describes it (`SheetLine`, `DescriptionLaw`). A description
 * says what a number means for the player, never how it is made (GV, `tests/game.voice.test.ts`). What the
 * person may not know stays out: an unread piece's part, a lore category's own key, a name not asked (D19, D32, S2a).
 * Nothing is told by colour alone; every section is a stop for TAB, and every control is a button.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { HEAD_BUDGET_POSITIONS, IAttributes } from '../../shared/types';
import { usePlayerStore } from '../entities/player/store';
import { useHubStore } from '../entities/hub/store';
import { ProgressionSystem, LEVELS_PER_CIRCLE, POINTS_PER_LEVEL } from '../../shared/entities/player/systems/ProgressionSystem';
import { LoadoutSystem } from '../../shared/entities/player/systems/LoadoutSystem';
import { InventorySystem } from '../../shared/entities/player/systems/InventorySystem';
import { StatSystem } from '../../shared/logic/systems/StatSystem';
import { WebSystem } from '../../shared/logic/systems/WebSystem';
import { WebBank } from '../../shared/logic/content/WebBank';
import { CircleSystem } from '../logic/systems/CircleSystem';
import { SheetNumbers } from '../logic/systems/SheetNumbers';
import { Archetype, figure, weaponClass, armorClass } from '../../shared/render/atoms/people';
import { ATTRIBUTE_GROUPS, HandsPanel, VAULT_CELL, VaultGrid, groupOfWord, pointWord, pointsLine } from './PlayerHub';
import { PackPanels } from './CharacterSheet';
import { PaperDoll } from './PaperDoll';
import { TheWorking } from './TheWorking';
import { STASH_COLS } from '../entities/player/systems/StashGrid';
import { groupHeading, plusSays } from './ui/levelLine';
import { useDropZone, wholeZone } from './ui/hands';
import { hoverProps, useHotbar, useSheet } from './ui/stores';
import { Bar, Button, ItemSprite, Kbd, Panel, PortraitView, RankMark, SpriteView } from './ui/kit';
import { isTypingTarget } from '../logic/systems/FieldInput';
import { goalWords, useWebView } from './TechWebView';
import { DowntimeActs } from '../logic/systems/DowntimeActs';
import { said } from '../logic/systems/SheetWords';
import { OriginBank } from '../logic/content/OriginBank';
import { SkillNames } from '../logic/systems/SkillNames';
import { WORK_DAY, WorkSay } from '../logic/systems/WorkSay';
import { SkillSay } from '../logic/systems/SkillSay';
import { Described, Moved, PointPlus, PointPreview, PreviewList, SheetLine } from './SheetLine';

/** One place on the sheet: a TAB stop under its word, never cut, spanning columns where it needs room. */
const Section: React.FC<{ word: string; span?: number; right?: React.ReactNode; children: React.ReactNode }> = ({ word, span, right, children }) => (
  <section tabIndex={0} aria-label={word} data-sheet-section={word} style={{ gridColumn: span ? `span ${span}` : undefined, minWidth: 0 }}>
    <Panel title={word} right={right}>{children}</Panel>
  </section>
);

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/** The next drop's kit, at home: the one carry limit, and the load in words as well as on its bar. */
const KitPanel: React.FC<{ zoneId: string }> = ({ zoneId }) => {
  const { player, toggleCarry } = usePlayerStore();
  const stash = player.bank.stashTabs[0]?.items || [];
  const kit = stash.filter(i => i.tags?.includes('tool') || player.bank.carryItemIds?.includes(i.id));
  const carry = SheetNumbers.fight(player).find(r => r.key === 'carry')!;
  const kitWeight = InventorySystem.totalWeight(kit);
  const limit = LoadoutSystem.carryLimit(player.attributes.strength, player.equipment);
  const load = InventorySystem.loadWord(kitWeight, limit);
  const zone = useRef<HTMLDivElement>(null);
  useDropZone(zoneId, wholeZone(zone, { kind: 'KIT' }));
  return (
    <div ref={zone} data-drop-zone={zoneId}>
      <Panel title="LOADOUT — NEXT DROP" right={<span className="ws-dim">{carry.value}</span>}>
        <div className="ws-dim ws-small" style={{ marginBottom: 6 }}>Tools always come with you. Drag anything else here to take it: it can be lost with you.</div>
        {kit.length === 0 && <div className="ws-dim ws-small">Nothing chosen. You would drop with empty hands.</div>}
        <div className="ws-list">
          {kit.map(item => (
            <div key={item.id} className="ws-row" {...hoverProps(item)}>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                <ItemSprite item={item} cellPx={16} />
                <span style={{ minWidth: 0 }}>
                  <span className="t" style={{ display: 'block' }}>{LoadoutSystem.shownName(item)}</span>
                  <span className="s">{said(item.weight)} kg{item.tags?.includes('tool') ? ' · TOOL, ALWAYS CARRIED' : ''}</span>
                </span>
              </span>
              {!item.tags?.includes('tool') && <Button tone="quiet" onClick={() => toggleCarry(item.id)}>LEAVE HOME</Button>}
            </div>
          ))}
        </div>
        <Described word="LOAD" says={carry.says} root={carry.root} style={{ marginTop: 8 }}>
          <Bar label="LOAD" value={kitWeight} max={limit} tone={load ? 'loss' : 'signal'} text={`${Math.round((kitWeight / Math.max(1, limit)) * 100)}%${load ? ` · ${load}` : ''}`} />
        </Described>
      </Panel>
    </div>
  );
};

export const LargeSheet: React.FC<{ zonePrefix?: string }> = ({ zonePrefix = '' }) => {
  const player = usePlayerStore(s => s.player);
  const spend = usePlayerStore(s => s.spendAttributePoint);
  const web = useHubStore(s => s.web);
  const hubTech = useHubStore(s => s.tech);
  const session = player.currentSession;
  const equipment = player.equipment ?? LoadoutSystem.emptyEquipment();
  const rank = ProgressionSystem.rankOf(player);
  const progress = ProgressionSystem.levelProgress(player);
  const points = ProgressionSystem.unspent(player).total;
  const circles = CircleSystem.free(player);

  // The hand the hotbar has active is the one the field fires, so it is the one a hit is read from
  const activeHand = useHotbar(s => s.active);
  const fight = SheetNumbers.fight(player, activeHand);
  const vitals = SheetNumbers.vitals(player);
  const lore = SheetNumbers.lore(player);
  const mastery = SheetNumbers.mastery(player);
  const companions = SheetNumbers.companions(player);
  const waits = SheetNumbers.atRest(player).filter(w => w.count > 0);
  const statuses = SheetNumbers.statuses(player);
  const hidden = SheetNumbers.hiddenWorn(player);
  const earned = useMemo(() => new Set(WebSystem.earnedSheet(player, WebBank.current(), web).earned.map(r => r.id)), [player, web]);
  const others = Object.values(player.bank.universalSkills || {}).filter(s => !earned.has(s.id)).sort((a, b) => b.level - a.level);
  const held = LoadoutSystem.itemIn(equipment, 'RIGHT_HAND');
  const worn = LoadoutSystem.itemIn(equipment, 'CHEST');
  const creation = player.creation;
  const origin = creation ? OriginBank.origin(creation.origin) : undefined;
  const kit = creation?.kit ? OriginBank.kit(creation.kit) : undefined;
  const leans = creation ? [creation.main, creation.sub].filter(Boolean).map(a => capital(a)) : [];
  // UXS: a + waiting for its second press, and every number the point would move, read on a copy with it spent
  const [armed, setArmed] = useState<keyof IAttributes | null>(null);
  const moved = useMemo(() => (armed ? SheetNumbers.ifSpent(player, armed, activeHand) : []), [player, armed, activeHand]);
  const preview = useMemo(() => (armed ? new Map(moved.map(m => [m.key, m])) : null), [armed, moved]);

  return (
    <PointPreview.Provider value={preview}>
    <div data-large-sheet style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10, alignItems: 'start' }}>
      {/* What waits to be spent comes first: it is what a level sends a player here for */}
      <Section word={player.username.toUpperCase()} right={<span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><RankMark rank={rank} scale={2} />RANK {rank}</span>}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 8 }}>
          <PortraitView uid={player.id} archetype={(player.archetype || 'OPERATOR') as Archetype} scale={3} />
          <SpriteView sprite={figure({ uid: player.id, archetype: (player.archetype || 'OPERATOR') as Archetype, weapon: held ? weaponClass(held.tags || []) : undefined, armor: worn ? armorClass(worn.tags || []) : undefined })} scale={4} title="You, as the field draws you" />
          <div className="ws-small" style={{ minWidth: 0 }}>{creation?.className ?? capital((player.archetype || 'OPERATOR').replace(/_/g, ' '))}</div>
        </div>
        <Bar label={`LV ${progress.level}`} value={progress.into} max={progress.needed} tone="signal" text={`${(progress.needed - progress.into).toLocaleString()} XP to level ${progress.level + 1}`} />
        <SheetLine word="POINTS TO SPEND" value={points > 0 ? pointsLine(player) : 'none'} says={[
          points > 0 && 'Spend them under ATTRIBUTES.',
          `Each level gives ${POINTS_PER_LEVEL} points: one free, and one for each group of attributes. Every ${LEVELS_PER_CIRCLE} levels give a circle for a skill. A new rank from the guild starts your levels again; what you built stays.`
        ]} />
        <SheetLine word="CIRCLES TO PLACE" value={String(circles)} says={[circles > 0 && 'Place them under SKILLS.', SkillSay.circlesLine(player)]} />
      </Section>

      <Section word="HEALTH AND ENERGY">
        <Bar label="HEALTH" value={vitals.health.now} max={vitals.health.max} tone="proof" text={`${Math.round(vitals.health.now)} of ${said(vitals.health.max)}`} />
        <div style={{ height: 4 }} />
        <Described word="ENERGY" says={WORK_DAY}>
          <Bar label="ENERGY" value={vitals.energy.now} max={vitals.energy.max} tone="signal" text={`${Math.round(vitals.energy.now)} of ${said(vitals.energy.max)}`} />
        </Described>
        {/* EN: what each act of work costs, and what brings it down, as a fixed fact */}
        {WorkSay.lines(player).map(w => <SheetLine key={w.word} word={w.word} value={w.value} says={w.says} root={w.root} />)}
        {vitals.aether.length === 0 && <SheetLine word="AETHER" value="none held" says="Gathering gives it, an element at a time." />}
        {vitals.aether.map(a => (
          <SheetLine key={a.element} k={`aether:${a.element}`} word={`AETHER · ${a.element.toUpperCase()}`} value={`${said(a.held)} of ${said(a.max)}`} />
        ))}
        <SheetLine k="tonics" word="TONICS" value={`${vitals.tonics.drunk} of ${vitals.tonics.perRest} until you rest`} says="Endurance lets you take more." />
      </Section>

      <Section word="IN A FIGHT">
        {fight.filter(r => r.key !== 'walk' && r.key !== 'sight' && r.key !== 'carry').map(r => <SheetLine key={r.key} k={r.key} word={r.word} value={r.value} says={r.says} root={r.root} />)}
      </Section>

      <Section word="ATTRIBUTES" right={points > 0 ? <span className="ws-signal">{points} TO SPEND</span> : undefined}>
        {/* G1g: the title carries a count only; the line by kind sits in the body, where it wraps at any width */}
        {points > 0 && <div className="ws-signal ws-small" style={{ whiteSpace: 'normal', marginBottom: 6 }}>SPEND {pointsLine(player)}</div>}
        {Object.entries(ATTRIBUTE_GROUPS).map(([group, attrs]) => (
          <div key={group} style={{ marginBottom: 6 }}>
            <div className="ws-dim ws-small" style={{ letterSpacing: '0.08em' }}>{groupHeading(player, groupOfWord(group))}</div>
            {plusSays(player, groupOfWord(group)) && <div className="ws-signal ws-small">{plusSays(player, groupOfWord(group))}</div>}
            {attrs.map(attr => {
              const val = player.attributes[attr] || 0;
              const base = player.baseAttributes?.[attr] ?? val;
              const fromGear = val - base;
              const point = ProgressionSystem.pointFor(player, attr);
              const does = StatSystem.attributeWork(attr, player.attributes);
              // UXS: what an attribute does is its description; the web roots no attribute (Pedro, 2026-11-07), so it is a gap
              return (
                <React.Fragment key={attr}>
                <Described word={attr} says={does} style={{ padding: '2px 0', borderBottom: '1px solid var(--ws-void-3)' }}>
                  <div className="ws-row" style={{ padding: 0 }}>
                    <span style={{ textTransform: 'capitalize' }}>{attr}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {fromGear !== 0 && <span className="ws-dim ws-small">{base} {fromGear > 0 ? '+' : '−'} {Math.abs(fromGear)} worn</span>}
                      <span className="ws-bright" style={{ minWidth: 20, textAlign: 'right' }}>{val}<Moved k={`attr:${attr}`} /></span>
                      {point && (
                        <PointPlus attr={attr} aria-label={`Raise ${attr} with ${pointWord(point)}`} armed={armed === attr}
                          onArm={() => setArmed(attr)} onDisarm={() => setArmed(a => (a === attr ? null : a))} onSpend={() => { spend(attr); setArmed(null); }} />
                      )}
                    </span>
                  </div>
                </Described>
                {armed === attr && <PreviewList attr={attr} moved={moved} />}
                </React.Fragment>
              );
            })}
          </div>
        ))}
      </Section>

      <section tabIndex={0} aria-label="SKILLS" style={{ minWidth: 0 }}><HandsPanel full /></section>

      <Section word="LORE" right={<Button tone="quiet" onClick={() => useWebView.getState().toggle()}>THE WEB</Button>}>
        <SheetLine word="GENERAL" value={String(Math.round(lore.general))} says={['Lore pays for a skill to settle, a gift, and a gift raised. A study at a rest gives it.', 'Spent on anything.']} />
        {lore.byCategory.length === 0 && <SheetLine word="OF ONE KIND" value="none yet" says="Studying a thing gives lore of its kind, spent on skills of that kind." />}
        {lore.byCategory.map(k => <SheetLine key={k.name} word={k.name.toUpperCase()} value={String(k.reads)} />)}
        {/* The design pass, part 2: what is marked on the tech web, and what the way there asks */}
        {(() => {
          const goal = goalWords(player, web, hubTech);
          return goal
            ? <><SheetLine word="WORKING TOWARD" value={goal.name} /><SheetLine word="THE WAY THERE" value={goal.says} /></>
            : <SheetLine word="WORKING TOWARD" value="nothing marked" says="THE WEB marks a goal." />;
        })()}
      </Section>

      <Section word="WALK, SIGHT, CARRY">
        {fight.filter(r => r.key === 'walk' || r.key === 'sight' || r.key === 'carry').map(r => <SheetLine key={r.key} k={r.key} word={r.word} value={r.value} says={r.says} root={r.root} />)}
      </Section>

      <Section word="WHAT YOU WEAR" span={2}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <PaperDoll />
          <div style={{ minWidth: 200, flex: 1 }}>
            <Described word="THE HEAD" says="Head, eyes, earring and necklace each take gear or a frame, three frames at most. Gear never adds to the mental stats (SOFTWARE); a frame does, beside what you were dealt.">
              <div className="ws-dim ws-small" style={{ letterSpacing: '0.08em' }}>THE HEAD</div>
            </Described>
            {HEAD_BUDGET_POSITIONS.map(position => {
              const frame = LoadoutSystem.frameAt(equipment, position);
              const gear = LoadoutSystem.itemIn(equipment, position);
              return <SheetLine key={position} word={position.replace(/_/g, ' ')} value={frame ? `${frame.name}, a frame` : gear ? LoadoutSystem.shownName(gear) : 'open'} />;
            })}
          </div>
        </div>
      </Section>

      {session ? (
        <section tabIndex={0} aria-label="THE PACK" style={{ gridColumn: 'span 2', minWidth: 0, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <PackPanels session={session} />
        </section>
      ) : (
        <>
          <Section word="THE VAULT" span={2} right={<span className="ws-proof">{player.bank.gold.toLocaleString()} G</span>}>
            <div style={{ maxHeight: 320, overflowY: 'auto', overflowX: 'auto', maxWidth: STASH_COLS * VAULT_CELL + 16 }}>
              <VaultGrid zoneId={`${zonePrefix}vault`} cellPx={VAULT_CELL} />
            </div>
          </Section>
          <section tabIndex={0} aria-label="LOADOUT, NEXT DROP" style={{ minWidth: 0 }}><KitPanel zoneId={`${zonePrefix}kit`} /></section>
        </>
      )}

      <section tabIndex={0} aria-label="WORKINGS" style={{ minWidth: 0 }}><TheWorking /></section>

      <Section word="ON YOU NOW">
        {statuses.length === 0 ? <div className="ws-dim ws-small">Nothing is working on you now.</div> : statuses.map(s => <div key={s} className="ws-small">· {s}</div>)}
        {hidden > 0 && <SheetLine word="WORN, UNREAD" value={String(hidden)} says={`${hidden === 1 ? 'It works' : 'They work'} on you, and you do not know how.`} />}
      </Section>

      <Section word="WHO WALKS WITH YOU">
        {companions.length === 0 ? <div className="ws-dim ws-small">No one walks with you.</div> : companions.map((c, i) => <SheetLine key={i} word={c.name.toUpperCase()} value={c.how} />)}
      </Section>

      <Section word="GOLD, AND THE NEXT REST">
        <SheetLine word="GOLD" value={`${player.bank.gold.toLocaleString()} G`} />
        {waits.length === 0 ? <div className="ws-dim ws-small">Nothing waits for your next rest.</div> : waits.map(w => <SheetLine key={w.key} word={w.word.toUpperCase()} value={String(w.count)} />)}
      </Section>

      {/* The design pass, part 5: what is stacked for while away, and what the last return said */}
      <Section word="WHILE AWAY">
        {player.downtime?.stack.acts.length
          ? player.downtime.stack.acts.map((act, i) => <div key={i} className="ws-small">{i + 1}. {DowntimeActs.wordOf(act)}</div>)
          : <div className="ws-dim ws-small">Nothing planned. Plan it where you rest: Old Mags' table at the inn, or your own bed.</div>}
        {player.downtime?.account && (
          <div className="ws-small" style={{ marginTop: 4 }}>
            <div className="ws-dim">When you came back:</div>
            {player.downtime.account.lines.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        )}
      </Section>

      <Section word="MATERIALS YOU KNOW">
        {mastery.length === 0 ? <div className="ws-dim ws-small">None yet. Work one with a tool, then rest.</div>
          : mastery.map(m => <SheetLine key={m.id} word={m.name.toUpperCase()} value={m.knows} />)}
      </Section>

      {others.length > 0 && (
        <Section word="OLDER SKILLS">
          {others.map(skill => (
            <div key={skill.id} className="ws-row ws-small" style={{ padding: '2px 0' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <RankMark rank={ProgressionSystem.skillRankOf(skill)} scale={1} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{SkillNames.nameOf(skill.id, player.skillWords?.[skill.id]?.name)}</span>
              </span>
              <span className="ws-dim" style={{ flexShrink: 0 }}>level {skill.level}</span>
            </div>
          ))}
        </Section>
      )}

      <Section word="WHERE YOU CAME FROM">
        <SheetLine word="CLASS" value={creation?.className ?? capital((player.archetype || 'OPERATOR').replace(/_/g, ' '))} />
        {origin && <SheetLine word="BEFORE" value={capital(origin.says)} />}
        {leans.length > 0 && <SheetLine word="LEANING" value={leans.join(', then ')} />}
        {kit && <SheetLine word="STARTED WITH" value={capital(kit.says)} />}
        <SheetLine word="GUILD" value={player.guildId ? 'a member' : 'none yet'} />
        <SheetLine word="CITY" value={player.ownedCityId ? 'one of your own' : 'none of your own'} />
      </Section>
    </div>
    </PointPreview.Provider>
  );
};

/** Over everything, in a world or at home: SHIFT+C or ESC puts it away. */
export const LargeSheetOverlay: React.FC = () => {
  const close = useSheet(s => s.closeLarge);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.key === 'Escape' || (e.shiftKey && e.key.toLowerCase() === 'c')) {
        e.preventDefault(); e.stopImmediatePropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    // The keys start inside it
    requestAnimationFrame(() => (root.current?.querySelector('[data-sheet-section]') as HTMLElement | null)?.focus());
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close]);
  return (
    <div ref={root} className="ws-ui ws-overlay" role="dialog" aria-label="The large character sheet"
      style={{ display: 'block', overflowY: 'auto', padding: 16, background: 'rgba(3, 3, 3, 0.94)', zIndex: 400 }}
      onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
        <span className="ws-bright" style={{ letterSpacing: '0.12em' }}>CHARACTER</span>
        <Button onClick={close}>CLOSE <Kbd>SHIFT+C</Kbd> <Kbd>ESC</Kbd></Button>
      </div>
      <LargeSheet zonePrefix="large_" />
    </div>
  );
};
