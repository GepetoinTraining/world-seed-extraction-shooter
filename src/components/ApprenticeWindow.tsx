/**
 * THE APPRENTICE WINDOW: who stands at this vendor's bench, and who could. Ranks read in
 * words and progress by the stepped bar, never by hue. A bond is spent once, so taking
 * someone on is a second press.
 */

import React from 'react';
import { usePlayerStore } from '../entities/player/store';
import { useHubStore } from '../entities/hub/store';
import { HUB_NPCS } from '../entities/hub/HubGenerator';
import { LoadoutSystem } from '../entities/player/systems/LoadoutSystem';
import { ApprenticeRoad, CraftRank, TERM_DAYS } from '../logic/systems/ApprenticeRoad';
import { VendorSystem } from '../logic/systems/VendorSystem';
import { NpcSheet } from '../logic/systems/NpcSheet';
import { WebBank } from '../logic/content/WebBank';
import { WebSystem } from '../logic/systems/WebSystem';
import { ArmedButton, Bar, Modal, Row } from './ui/kit';
import { useFeed } from './ui/stores';

const RANK_WORDS: Record<CraftRank, string> = { APPRENTICE: 'APPRENTICE', JOURNEYMAN: 'JOURNEYMAN', MASTER: 'MASTER' };

export const ApprenticeWindow: React.FC<{ npcId: string; onClose: () => void }> = ({ npcId, onClose }) => {
  const { player } = usePlayerStore();
  const { vendors, craftsmen, takeApprentice, activeHubId } = useHubStore();
  const pushFeed = useFeed(s => s.push);
  const npc = HUB_NPCS[npcId];
  const record = vendors[npcId];
  const teaches = npc?.teaches;
  if (!npc || !teaches) return null;

  const mine = craftsmen.filter(c => c.masterId === npcId);
  const bench = mine.filter(c => c.rank === 'APPRENTICE').length;
  const keeper = NpcSheet.read(activeHubId ?? 'hub_unknown', { id: npcId, rank: teaches.rank }, undefined);
  const room = ApprenticeRoad.roomFor(keeper.stats!);
  const pack = WebBank.current();
  const bonds = (player.bank.stashTabs[0]?.items ?? []).filter(i => i.bondData);

  return (
    <Modal title={`${npc.name.toUpperCase()}: THE BENCH`} onClose={onClose} width={560}>
      <div className="ws-small" style={{ marginBottom: 8 }}>{record ? `"${VendorSystem.say(record)}"` : ''}</div>
      <div className="ws-dim ws-small" style={{ marginBottom: 8 }}>
        Teaches {WebSystem.nameOf(`skill_${teaches.trade}`)}. {bench} of {room} at the bench. A term runs {TERM_DAYS} days, and it passes whether or not you are here.
      </div>

      <div className="ws-dim ws-small">AT THE BENCH</div>
      {mine.length === 0 && <div className="ws-dim ws-small" style={{ margin: '4px 0 10px' }}>Nobody yet.</div>}
      <div className="ws-list" style={{ marginBottom: 10 }}>
        {mine.map(c => (
          <div key={c.id} style={{ padding: '4px 0' }}>
            <Row title={c.name} right={RANK_WORDS[c.rank]} sub={`${WebSystem.nameOf(c.skill.id)}, ${WebSystem.masteryOf(c.skill).rungName}`} />
            {c.rank === 'APPRENTICE' && <Bar label="TERM" value={c.progress} max={100} text={`${Math.floor(c.progress)}%`} />}
          </div>
        ))}
      </div>

      <div className="ws-dim ws-small">WHO YOU COULD BRING</div>
      {bonds.length === 0 && <div className="ws-dim ws-small" style={{ marginTop: 4 }}>You hold no one's bond. People come out of the worlds beside you.</div>}
      <div className="ws-list">
        {bonds.map(bond => {
          const verdict = ApprenticeRoad.unfit(bond, pack);
          return (
            <Row
              key={bond.id}
              title={LoadoutSystem.shownName(bond)}
              sub={verdict.ok ? (bench >= room ? 'There is no room at this bench.' : 'No trade, and not built for the road. This bench would have them.') : verdict.reason}
              right={verdict.ok && bench < room ? (
                <ArmedButton
                  tone="proof"
                  confirmLabel="SPEND THE BOND: SURE?"
                  onConfirm={() => {
                    void takeApprentice(npcId, bond.id).then(v => pushFeed(v.ok ? `${bond.bondData!.sheet.name} is ${npc.name}'s apprentice now.` : v.reason ?? 'The bench refuses.', v.ok ? 'proof' : 'loss'));
                  }}
                >
                  TAKE ON
                </ArmedButton>
              ) : undefined}
            />
          );
        })}
      </div>
    </Modal>
  );
};
