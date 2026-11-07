/**
 * THE APPRENTICE WINDOW: who stands at this vendor's bench, and who could. Ranks read in
 * words and progress by the stepped bar, never by hue. Everyone comes through the tavern
 * (D75), and this bench takes those with no ground yet. It cannot be undone, so taking
 * someone on is a second press.
 */

import React from 'react';
import { useHubStore } from '../entities/hub/store';
import { HUB_NPCS } from '../entities/hub/HubGenerator';
import { bondItemOf } from '../entities/hub/guild';
import { ApprenticeRoad, CraftRank, TERM_DAYS, generalKeepers } from '../logic/systems/ApprenticeRoad';
import { VendorSystem } from '../logic/systems/VendorSystem';
import { NpcSheet } from '../../shared/logic/systems/NpcSheet';
import { WebBank } from '../../shared/logic/content/WebBank';
import { WebSystem } from '../../shared/logic/systems/WebSystem';
import { ArmedButton, Bar, Modal, Row } from './ui/kit';
import { useFeed } from './ui/stores';

const RANK_WORDS: Record<CraftRank, string> = { APPRENTICE: 'APPRENTICE', JOURNEYMAN: 'JOURNEYMAN', MASTER: 'MASTER' };

export const ApprenticeWindow: React.FC<{ npcId: string; onClose: () => void }> = ({ npcId, onClose }) => {
  const { vendors, craftsmen, guild, takeApprentice, activeHubId } = useHubStore();
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
  const lodged = guild.residents.filter(r => !r.lotId && !r.craftsmanId);
  const keepers = generalKeepers();

  return (
    <Modal title={`${npc.name.toUpperCase()}: THE BENCH`} onClose={onClose} width={560}>
      <div className="ws-small" style={{ marginBottom: 8 }}>{record ? `"${VendorSystem.say(record)}"` : ''}</div>
      <div className="ws-dim ws-small" style={{ marginBottom: 8 }}>
        Teaches crafting. A term at each of the {keepers.length} keepers unlocks it, {TERM_DAYS} days each, whether or not you are here. {bench} of {room} at this bench.
      </div>

      <div className="ws-dim ws-small">AT THE BENCH</div>
      {mine.length === 0 && <div className="ws-dim ws-small" style={{ margin: '4px 0 10px' }}>Nobody yet.</div>}
      <div className="ws-list" style={{ marginBottom: 10 }}>
        {mine.map(c => (
          <div key={c.id} style={{ padding: '4px 0' }}>
            <Row title={c.name} right={RANK_WORDS[c.rank]} sub={ApprenticeRoad.canCraft(c) ? `${WebSystem.nameOf(c.skill.id)}, ${WebSystem.masteryOf(c.skill).rungName}` : `${c.done.length} of ${keepers.length} benches done`} />
            {c.rank === 'APPRENTICE' && <Bar label="TERM" value={c.progress} max={100} text={`${Math.floor(c.progress)}%`} />}
          </div>
        ))}
      </div>

      <div className="ws-dim ws-small">WHO IS AT THE TAVERN</div>
      {lodged.length === 0 && <div className="ws-dim ws-small" style={{ marginTop: 4 }}>Nobody is lodged with Mags. Someone you bring out of a world goes to her first.</div>}
      <div className="ws-list">
        {lodged.map(person => {
          const verdict = ApprenticeRoad.unfit(bondItemOf(person), pack);
          return (
            <Row
              key={person.id}
              title={person.name}
              sub={verdict.ok ? (bench >= room ? 'There is no room at this bench.' : 'No trade, and not built for the road. This bench would have them.') : verdict.reason}
              right={verdict.ok && bench < room ? (
                <ArmedButton
                  tone="proof"
                  confirmLabel="TO THIS BENCH: SURE?"
                  onConfirm={() => {
                    void takeApprentice(npcId, person.id).then(v => pushFeed(v.ok ? `${person.name} starts at ${npc.name}'s bench.` : v.reason ?? 'The bench refuses.', v.ok ? 'proof' : 'loss'));
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
