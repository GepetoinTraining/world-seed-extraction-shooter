/**
 * ANOTHER COIN (D115): a shelf can ask for an anchor in place of gold. The one piece both
 * shelf windows share: what is asked, what a buyer presses, and what the owner collects.
 * Told in words and position, never by colour.
 */

import React from 'react';
import { useHubStore, IPlayerLot } from '../entities/hub/store';
import { usePlayerStore } from '../entities/player/store';
import { Anchors } from '../logic/economy/Anchors';
import { Button } from './ui/kit';
import { useFeed } from './ui/stores';

type Listing = NonNullable<IPlayerLot['shopListings']>[number];

/** What this shelf asks for the next thing listed: coin at a price, or one anchor of a kind. */
export const AskFor: React.FC<{ value: string; onChange: (defId: string) => void }> = ({ value, onChange }) => (
  <select className="ws-input" value={value} onChange={e => onChange(e.target.value)} aria-label="Ask for">
    <option value="">Coin</option>
    {Anchors.kinds().map(k => <option key={k.defId} value={k.defId}>One {k.name}</option>)}
  </select>
);

export const BuyListing: React.FC<{ lotId: string; listing: Listing }> = ({ lotId, listing }) => {
  const buyFromLot = useHubStore(s => s.buyFromLot);
  const gold = usePlayerStore(s => s.player.bank.gold);
  const stash = usePlayerStore(s => s.player.bank.stashTabs[0]?.items ?? []);
  const pushFeed = useFeed(s => s.push);
  const ask = listing.ask;
  const able = ask ? stash.some(i => i.universalDefinitionId === ask.defId && i.isIdentified !== false) : gold >= listing.price;
  return (
    <Button
      tone="proof"
      disabled={!able}
      title={ask && !able ? `This shelf wants a ${ask.name}. It will not take coin.` : undefined}
      onClick={async () => {
        const ok = await buyFromLot(lotId, listing.item.id);
        const paid = ask ? `one ${ask.name}` : `${listing.price} G`;
        pushFeed(ok ? `Bought ${listing.item.name} for ${paid}.` : 'The counter refused.', ok ? 'proof' : 'loss');
      }}
    >
      {ask ? `PAY ONE ${ask.name.toUpperCase()}` : `BUY ${listing.price}G`}
    </Button>
  );
};

export const CollectHeld: React.FC<{ lot: IPlayerLot }> = ({ lot }) => {
  const collectHeld = useHubStore(s => s.collectHeld);
  const pushFeed = useFeed(s => s.push);
  const count = lot.heldInTrade?.length ?? 0;
  if (count === 0) return null;
  return (
    <Button tone="proof" onClick={async () => {
      const got = await collectHeld(lot.id);
      if (got > 0) pushFeed(`${got === 1 ? 'One thing' : `${got} things`} collected from the counter.`, 'proof');
    }}>
      COLLECT {count} TAKEN IN TRADE
    </Button>
  );
};
