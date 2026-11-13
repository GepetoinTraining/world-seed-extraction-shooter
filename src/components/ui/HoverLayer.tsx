/**
 * THE CARD ON HOVER (the usability pass): one layer over everything, so a card
 * appears at once and moves nothing. It sits beside what it reads, inside the
 * window, and compares with what the piece would replace through the same blind
 * sheet the card itself reads (D19).
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usePlayerStore } from '../../entities/player/store';
import { AnchorRect, comparisonFor, inspectHand, inspectItem, placeCard } from '../../render/atoms/inspect';
import { LoadoutSystem } from '../../../shared/entities/player/systems/LoadoutSystem';
import { CardView, CompareView, RankMark } from './kit';
import { useHands } from './hands';
import { useHover } from './stores';
import { useCardKeys } from './cardKeys';

const SETTLE_CHECK_MS = 200;

/** Any card that must not cover its anchor or leave the window. */
export const PlacedCard: React.FC<{ anchor: AnchorRect; layoutKey: string; children: React.ReactNode }> = ({ anchor, layoutKey, children }) => {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  // UXC: the card grows beneath while ALT is held, so it is placed again, wherever it came up from
  const deep = useCardKeys(s => s.deep);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    setAt(placeCard(anchor, { w: el.offsetWidth, h: el.offsetHeight }, { w: window.innerWidth, h: window.innerHeight }));
  }, [layoutKey, deep, anchor.left, anchor.top, anchor.width, anchor.height]);
  return (
    <div
      ref={box}
      style={{
        position: 'fixed', zIndex: 2000, pointerEvents: 'none',
        left: at?.left ?? 0, top: at?.top ?? 0,
        visibility: at ? 'visible' : 'hidden'
      }}
    >
      {children}
    </div>
  );
};

export const HoverLayer: React.FC = () => {
  const item = useHover(s => s.item);
  const hand = useHover(s => s.hand);
  const el = useHover(s => s.el);
  const clear = useHover(s => s.clear);
  const holding = useHands(s => !!s.held);
  // The card only asks the store about what can change what it says.
  const mastery = usePlayerStore(s => s.player.materialMastery);
  const equipment = usePlayerStore(s => s.player.equipment);
  // UXC, part 2: what a hand's card reads beyond the piece: the body, the skills, the cast set, the stones carried
  const attributes = usePlayerStore(s => s.player.attributes);
  const skills = usePlayerStore(s => s.player.bank?.universalSkills);
  const activeCast = usePlayerStore(s => s.player.activeCast);
  const carried = usePlayerStore(s => s.player.currentSession?.inventory);

  // A thing can leave the screen under the pointer, and then it sends no leave.
  useEffect(() => {
    if (!el) return;
    const t = setInterval(() => { if (!el.isConnected) clear(); }, SETTLE_CHECK_MS);
    return () => clearInterval(t);
  }, [el, clear]);

  const card = useMemo(() => {
    if (!item) return null;
    const player = usePlayerStore.getState().player;
    return { card: inspectItem(item, player), compare: comparisonFor(item, player) };
  }, [item, mastery, equipment]);

  const handCard = useMemo(() => {
    if (!hand) return null;
    const player = usePlayerStore.getState().player;
    const piece = player.equipment ? LoadoutSystem.itemIn(player.equipment, hand) : undefined;
    return { card: inspectHand(player, hand), piece };
  }, [hand, mastery, equipment, attributes, skills, activeCast, carried]);

  if (!el || holding || !el.isConnected) return null;
  const r = el.getBoundingClientRect();
  const anchor = { left: r.left, top: r.top, width: r.width, height: r.height };
  if (hand && handCard) {
    const piece = handCard.piece;
    return (
      <PlacedCard anchor={anchor} layoutKey={`hand:${hand}:${handCard.card.rows.length}`}>
        <CardView card={handCard.card} right={!piece || piece.isIdentified === false ? undefined : <RankMark rank={String(piece.rank)} scale={2} />} />
      </PlacedCard>
    );
  }
  if (!item || !card) return null;
  return (
    <PlacedCard anchor={anchor} layoutKey={`${item.id}:${card.compare ? 1 : 0}`}>
      <CardView card={card.card} right={item.isIdentified === false ? undefined : <RankMark rank={String(item.rank)} scale={2} />}>
        {card.compare && <CompareView compare={card.compare} />}
      </CardView>
    </PlacedCard>
  );
};
