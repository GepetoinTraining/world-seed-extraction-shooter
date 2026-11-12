/**
 * THE VIEW OF THE TECH WEB (the design pass, part 1). Pedro, 2026-11-11: "what's unlocking what, where do things sit, so
 * people could minimally plan their lore". The law of what is drawn is `WebMap`; this only draws it.
 *
 * Meaning is carried by shape, position and words, never by hue (he is colourblind): a circle is a thing, a diamond a
 * skill, a square a station. Filled is yours; an outline is the hub's; a broken outline is a skill still forming in your
 * hands (the hands panel's own mark for it); a dashed outline holding a question mark is not known, and has no name.
 * Columns run from the ground outward. The picture is as large as the web: it is moved by dragging or scrolling, and any
 * group folds to one mark under its word. Nothing here changes a rule.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { IHubWeb, IPlayer } from '../../shared/types';
import { usePlayerStore, playerPort } from '../entities/player/store';
import { GameClock } from '../logic/time/GameClock';
import type { IHubTech } from '../entities/hub/hubTech';
import { useHubStore } from '../entities/hub/store';
import { IMapNode, IPlan, MAP_COLUMN, MAP_ROW, WebMap } from '../logic/systems/WebMap';
import { Button, Kbd, Panel } from './ui/kit';
import { isTypingTarget } from '../logic/systems/FieldInput';
import { LorePiece } from '../logic/systems/LorePiece';
import { LoreWriteDoor } from '../logic/systems/LoreWriteDoor';
import { hubPort } from '../entities/hub/store';
import { hubTreeOf } from '../entities/hub/hubTech';

/** Whether the view is open over everything: from the large sheet or the study panel. */
export const useWebView = create<{ open: boolean; toggle: () => void; close: () => void }>(set => ({
  open: false,
  toggle: () => set(s => ({ open: !s.open })),
  close: () => set({ open: false })
}));

const PAD = 24;
const SHAPE = 7;
const KIND_WORD: Record<IMapNode['kind'], string> = { thing: 'a thing', skill: 'a skill', station: 'a station' };
const STATE_WORD: Record<IMapNode['state'], string> = { yours: 'yours', forming: 'forming in your hands', hub: 'the hub knows it', unknown: 'not known' };
const LINK_WORD = { works: 'is worked by', opens: 'opens', makes: 'makes', feeds: 'goes into' } as const;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The mark for a node: its kind by outline, how it is known by fill and stroke. */
const Mark: React.FC<{ node: IMapNode }> = ({ node }) => {
  const stroke = node.state === 'unknown' ? 'var(--ws-text-dim)' : 'var(--ws-text-bright)';
  const fill = node.state === 'yours' ? 'var(--ws-text-bright)' : 'var(--ws-void-0)';
  const dash = node.state === 'unknown' ? '3 2' : node.state === 'forming' ? '6 3' : undefined;
  const common = { stroke, fill, strokeWidth: 1.5, strokeDasharray: dash };
  const shape = node.kind === 'thing' ? <circle cx={0} cy={0} r={SHAPE} {...common} />
    : node.kind === 'skill' ? <polygon points={`0,${-SHAPE - 1} ${SHAPE + 1},0 0,${SHAPE + 1} ${-SHAPE - 1},0`} {...common} />
    : <rect x={-SHAPE} y={-SHAPE} width={SHAPE * 2} height={SHAPE * 2} {...common} />;
  return (
    <g>
      {/* The way to what is marked: a ring around each step; the mark itself, two */}
      {(node.onWay || node.goal) && <circle cx={0} cy={0} r={SHAPE + 5} fill="none" stroke="var(--ws-text-bright)" strokeWidth={1} />}
      {node.goal && <circle cx={0} cy={0} r={SHAPE + 9} fill="none" stroke="var(--ws-text-bright)" strokeWidth={1} />}
      {shape}
      {node.state === 'unknown' && <text x={0} y={4} textAnchor="middle" style={{ fontSize: 12, fill: 'var(--ws-text-dim)' }}>?</text>}
    </g>
  );
};

/** What a node says under its name: what a sitting would ask, or what learning would ask in lore. */
const subline = (n: IMapNode): string | null => {
  if (n.study) return `sitting ${n.study.cost} energy, ${n.study.seconds}s`;
  if (n.price !== undefined) return `learning ${n.price} lore${n.category?.word ? `, ${n.category.word}` : ''}`;
  return null;
};

/** The words of a plan: what is marked, how many steps, and whether the lore held meets what they ask. The large sheet says the same. */
export function goalWords(player: IPlayer, web: IHubWeb, tech: IHubTech): { name: string; says: string; plan: IPlan } | null {
  if (!player.webGoal) return null;
  const plan = WebMap.pathTo(player, { web, tech }, player.webGoal.ref);
  const marked = WebMap.of(player, { web, tech }).nodes.find(n => n.id === player.webGoal!.ref);
  const name = marked?.name ?? 'something not known yet';
  if (plan.broken) return { name, plan, says: 'Nothing you know leads there yet.' };
  if (plan.steps.length === 0) return { name, plan, says: 'Within reach: nothing stands between you and it.' };
  const steps = `${plan.steps.length} ${plan.steps.length === 1 ? 'step' : 'steps'}`;
  if (plan.lore.asked === 0) return { name, plan, says: `${steps}, asking no lore.` };
  return { name, plan, says: `${steps}, asking ${plan.lore.asked} lore: ${plan.lore.met ? 'you hold enough' : `short by ${plan.lore.short}`}.` };
}

const STEP_VERB: Record<IMapNode['kind'], string> = { thing: 'Have', skill: 'Learn', station: 'Stand at' };

/** The way there, step by step, and what it asks set against what is held. */
const WayPanel: React.FC<{ player: IPlayer; web: IHubWeb; tech: IHubTech }> = ({ player, web, tech }) => {
  const words = goalWords(player, web, tech);
  if (!words) return <Panel title="WORKING TOWARD"><div className="ws-dim ws-small">Nothing marked. Pick anything on the web and mark it to see the way there and what it asks.</div></Panel>;
  const { plan } = words;
  return (
    <Panel title={`WORKING TOWARD: ${words.name.toUpperCase()}`}>
      <div className="ws-small" data-web-way style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div>{words.says}</div>
        {plan.steps.map((s, i) => (
          <div key={s.id} className={s.state === 'unknown' ? 'ws-dim' : undefined}>
            {i + 1}. {STEP_VERB[s.kind]} {s.name ?? `${KIND_WORD[s.kind]} not known`}{s.kind === 'skill' && s.price ? `: ${s.price} lore` : ''}{s.state === 'forming' ? ' (forming)' : ''}
          </div>
        ))}
        {plan.lore.lines.map(l => (
          <div key={l.key}>
            {l.word ? `LORE OF ${l.word.toUpperCase()}` : 'A KIND YOU HOLD NO LORE OF'}: asks {l.asked}; {l.fromOwn} of its own, {l.fromGeneral} general{l.short > 0 ? `, short ${l.short}` : ''}.
          </div>
        ))}
        {plan.lore.asked > 0 && <div>GENERAL: {plan.lore.general.asked} asked of {Math.round(plan.lore.general.held)} held.</div>}
        <Button tone="quiet" onClick={() => playerPort.apply({ kind: 'WEB_GOAL', goal: undefined })}>STOP WORKING TOWARD IT</Button>
      </div>
    </Panel>
  );
};

export const TechWebView: React.FC = () => {
  const player = usePlayerStore(s => s.player);
  const web = useHubStore(s => s.web);
  const tech = useHubStore(s => s.tech);
  const map = useMemo(() => WebMap.of(player, { web, tech }), [player, web, tech]);
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const layout = useMemo(() => WebMap.layout(map, folded), [map, folded]);
  const [picked, setPicked] = useState<string | null>(null);
  const pane = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const purse = WebMap.purse(player);
  const byId = useMemo(() => new Map(map.nodes.map(n => [n.id, n])), [map]);
  const node = picked ? byId.get(picked) : undefined;

  const fold = (group: string) => setFolded(prev => {
    const next = new Set(prev);
    if (next.has(group)) next.delete(group); else next.add(group);
    return next;
  });
  const anchor = (id: string, side: 'in' | 'out') => {
    const at = layout.at[id];
    return at ? { x: PAD + at.x + (side === 'out' ? SHAPE + 2 : -SHAPE - 2), y: PAD + at.y + MAP_ROW / 2 } : null;
  };
  const links = node ? map.edges.filter(e => e.from === node.id || e.to === node.id) : [];

  return (
    <div data-web-view style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start', minWidth: 0 }}>
      <div style={{ flex: '1 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="ws-small" style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }} data-web-purse>
          <span>GENERAL LORE <span className="ws-bright">{Math.round(purse.general).toLocaleString()}</span></span>
          {purse.kinds.map(k => <span key={k.key}>LORE OF {k.name.toUpperCase()} <span className="ws-bright">{k.reads.toLocaleString()}</span></span>)}
        </div>
        <div className="ws-dim ws-small">
          Circle a thing, diamond a skill, square a station. Filled is yours; an outline the hub knows; a broken outline is forming in your hands; a dashed one with a question mark is not known. From the ground outward, left to right. Drag or scroll to move; a heading folds its group.
        </div>
        {map.nodes.length === 0 && (
          <div className="ws-small" data-web-empty>You know nothing of the web yet. Work a material with a tool, or sit with one, and it begins here.</div>
        )}
        <div
          ref={pane}
          data-web-pane
          style={{ overflow: 'auto', maxHeight: '64vh', border: '1px solid var(--ws-void-3)', background: 'var(--ws-void-0)', cursor: 'grab', touchAction: 'none' }}
          onPointerDown={e => {
            if ((e.target as Element).closest('[data-web-node],[data-web-head]')) return;
            drag.current = { x: e.clientX, y: e.clientY, left: pane.current!.scrollLeft, top: pane.current!.scrollTop };
          }}
          onPointerMove={e => {
            if (!drag.current || !pane.current) return;
            pane.current.scrollLeft = drag.current.left - (e.clientX - drag.current.x);
            pane.current.scrollTop = drag.current.top - (e.clientY - drag.current.y);
          }}
          onPointerUp={() => { drag.current = null; }}
          onPointerLeave={() => { drag.current = null; }}
        >
          <svg width={layout.width + PAD * 2} height={layout.height + PAD * 2} role="img" aria-label="The tech web" style={{ display: 'block', fontFamily: 'var(--ws-mono)' }}>
            {map.edges.map(e => {
              const a = anchor(e.from, 'out');
              const b = anchor(e.to, 'in');
              if (!a || !b) return null;
              const lit = picked !== null && (e.from === picked || e.to === picked);
              return <line key={`${e.from}>${e.to}>${e.why}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={lit ? 'var(--ws-text-bright)' : 'var(--ws-void-4)'} strokeWidth={lit ? 2 : 1} strokeDasharray={e.why === 'feeds' ? '2 3' : undefined} />;
            })}
            {layout.heads.map(h => (
              <g key={h.group} data-web-head={h.group} role="button" tabIndex={0} aria-label={`${h.folded ? 'Open' : 'Fold'} ${h.word}, ${h.count}`}
                style={{ cursor: 'pointer' }} onClick={() => fold(h.group)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fold(h.group); } }}>
                <text x={PAD + h.x - SHAPE} y={PAD + h.y + 15} style={{ fontSize: 12, fill: 'var(--ws-text-dim)', letterSpacing: '0.08em' }}>
                  {h.folded ? '▸' : '▾'} {h.word.toUpperCase()} · {h.count}
                </text>
              </g>
            ))}
            {layout.folds.map(f => (
              <text key={`fold_${f.group}`} x={PAD + f.x + 4} y={PAD + f.y + 18} style={{ fontSize: 12, fill: 'var(--ws-text-dim)' }}>
                {f.count} folded here
              </text>
            ))}
            {map.nodes.map(n => {
              const at = layout.at[n.id];
              if (!at) return null;
              const sub = subline(n);
              const label = n.name ?? 'not known';
              return (
                <g key={n.id} data-web-node={n.state} transform={`translate(${PAD + at.x}, ${PAD + at.y + MAP_ROW / 2})`}
                  role="button" tabIndex={0} aria-label={`${KIND_WORD[n.kind]}, ${STATE_WORD[n.state]}${n.name ? `: ${n.name}` : ''}`}
                  style={{ cursor: 'pointer' }} onClick={() => setPicked(n.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPicked(n.id); } }}>
                  {picked === n.id && <rect x={-SHAPE - 4} y={-SHAPE - 4} width={MAP_COLUMN - 16} height={MAP_ROW - 2} fill="none" stroke="var(--ws-text-bright)" strokeWidth={1} />}
                  <Mark node={n} />
                  <text x={SHAPE + 6} y={sub ? -3 : 4} style={{ fontSize: 12, fill: n.state === 'unknown' ? 'var(--ws-text-dim)' : 'var(--ws-text-bright)', fontStyle: n.state === 'unknown' ? 'italic' : undefined }}>
                    {clip(label, 26)}
                  </text>
                  {sub && <text x={SHAPE + 6} y={12} style={{ fontSize: 12, fill: 'var(--ws-text-dim)' }}>{clip(sub, 32)}</text>}
                  <title>{label}{sub ? `, ${sub}` : ''}</title>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
      <div style={{ flex: '0 1 320px', minWidth: 220, display: 'flex', flexDirection: 'column', gap: 8 }} data-web-detail>
        <WayPanel player={player} web={web} tech={tech} />
        <Panel title={node ? (node.name ?? 'NOT KNOWN').toUpperCase() : 'PICK ONE'}>
          {!node && <div className="ws-dim ws-small">Pick anything on the web to read what it links to and what it would ask.</div>}
          {node && (
            <div className="ws-small" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div>{KIND_WORD[node.kind]}, {STATE_WORD[node.state]}.</div>
              {node.study && <div>A sitting on it asks {node.study.cost} energy and {node.study.seconds}s of you.</div>}
              {node.price !== undefined && <div>Learning it would ask {node.price} lore{node.category?.word ? `, of ${node.category.word} first, then general` : ', of its own kind first, then general'}.</div>}
              {node.kind === 'skill' && node.state === 'yours' && (() => {
                // The design pass, part 3: what the hands know, written out as a good to trade, sell or give
                const can = LorePiece.canWrite(player, node.ref, hubTreeOf(tech));
                const ask = LorePiece.ask(player, { id: node.ref, tags: node.tags ?? [] }, hubTreeOf(tech));
                return (
                  <>
                    <Button tone="quiet" disabled={!can.ok} onClick={() => LoreWriteDoor.start(node.ref, playerPort, hubPort)}>WRITE IT OUT: A SHEET, {ask.cost} ENERGY</Button>
                    {!can.ok && <div className="ws-dim">{can.reason}</div>}
                  </>
                );
              })()}
              {player.webGoal?.ref === node.id
                ? <div className="ws-dim">This is what you are working toward.</div>
                : <Button tone="quiet" onClick={() => playerPort.apply({ kind: 'WEB_GOAL', goal: { ref: node.id, at: GameClock.now() } })}>WORK TOWARD THIS</Button>}
              {links.map(e => {
                const other = byId.get(e.from === node.id ? e.to : e.from);
                const outward = e.from === node.id;
                const word = outward ? LINK_WORD[e.why] : `is ${e.why === 'works' ? 'worked from' : e.why === 'opens' ? 'opened by' : e.why === 'makes' ? 'made at' : 'made from'}`;
                return <div key={`${e.from}>${e.to}>${e.why}`} className="ws-dim">{word} {other?.name ?? 'something not known'}</div>;
              })}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
};

/** Over everything, in a world or at home: ESC or its button puts it away. */
export const TechWebOverlay: React.FC = () => {
  const close = useWebView(s => s.close);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close]);
  return (
    <div className="ws-ui ws-overlay" role="dialog" aria-label="The tech web"
      style={{ display: 'block', overflowY: 'auto', padding: 16, background: 'rgba(3, 3, 3, 0.94)', zIndex: 410 }}
      onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
        <span className="ws-bright" style={{ letterSpacing: '0.12em' }}>THE TECH WEB, AS YOU KNOW IT</span>
        <Button onClick={close}>CLOSE <Kbd>ESC</Kbd></Button>
      </div>
      <TechWebView />
    </div>
  );
};
