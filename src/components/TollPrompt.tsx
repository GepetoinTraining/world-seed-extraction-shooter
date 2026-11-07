/**
 * THE TOLL'S QUESTION (D93): it stops you and says what it wants. Not a menu you went looking for:
 * you walked into it. Walking on past the wait is an answer, and so is a shot.
 */

import React from 'react';
import { usePlayerStore } from '../entities/player/store';
import { TollDoor } from '../logic/economy/TollDoor';
import { Toll, useTollPrompt } from '../logic/systems/Toll';
import { Button } from './ui/kit';
import { useFeed } from './ui/stores';
import { useWorldStore } from '../entities/world/store';

export const TollPrompt: React.FC = () => {
  const asking = useTollPrompt(s => s.asking);
  const gold = usePlayerStore(s => s.player.bank.gold);
  if (!asking) return null;
  const canPay = Toll.canPay(gold, asking.owed);
  return (
    <div
      className="ws-ui"
      style={{ position: 'absolute', left: '50%', bottom: 96, transform: 'translateX(-50%)', zIndex: 40, display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px', background: 'var(--ws-void-1)', border: '2px solid var(--ws-void-5, #3f3f46)' }}
      onPointerDown={e => e.stopPropagation()}
    >
      <span className="ws-small">Something large stands in the way. It wants {asking.owed} G to let you past.</span>
      <Button
        disabled={!canPay}
        onClick={async () => {
          const out = await TollDoor.pay(useWorldStore.getState());
          useFeed.getState().push(out.ok ? `Paid. ${out.paid === 0 ? 'It was yours to begin with.' : 'It steps aside.'}` : out.reason ?? 'It did not take that.', out.ok ? 'proof' : 'loss');
        }}
      >
        {canPay ? `PAY ${asking.owed} G` : `YOU HOLD ${gold} G`}
      </Button>
      <Button
        onClick={() => {
          TollDoor.refuse();
          useFeed.getState().push('You say no. It stops being polite.', 'loss');
        }}
      >
        REFUSE
      </Button>
    </div>
  );
};
