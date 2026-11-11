/**
 * THE RUSTY ANCHOR'S ROOMS (D75): who the gate brought out, staying at the tavern until
 * the guild buys them ground. Mags keeps the beds; her rest stays where it was.
 */

import React, { useMemo } from 'react';
import { IItem } from '../../shared/types';
import { IResident, bedsTaken, jobOf, readSheet, residentStage, tavernBeds } from '../entities/hub/guild';
import { HubGenerator } from '../entities/hub/HubGenerator';
import { useHubStore } from '../entities/hub/store';
import { usePlayerStore } from '../entities/player/store';
import { HUB_GENRE } from '../render/atoms/hub';
import { buildPalette } from '../../shared/render/atoms/atoms';
import { portrait } from '../../shared/render/atoms/people';
import { NpcSheet } from '../../shared/logic/systems/NpcSheet';
import { ArmedButton, Button, Chip, Modal, Panel, SpriteView } from './ui/kit';
import { useTalk } from '../entities/interaction/talkStore';
import { useFeed } from './ui/stores';

const lower = (word: string) => word.toLowerCase().replace(/_/g, ' ');

/** The person's face, read from who they are, so it is the same wherever they are drawn. */
export const ResidentFace: React.FC<{ entityId: string }> = ({ entityId }) => {
  const sprite = useMemo(() => portrait({ uid: entityId, archetype: 'NOMAD' }), [entityId]);
  const palette = useMemo(() => buildPalette(HUB_GENRE), []);
  return <SpriteView sprite={sprite} palette={palette} scale={1} />;
};

/** What the world rolled for them: enough to know them by. */
export const ResidentLines: React.FC<{ resident: IResident }> = ({ resident }) => {
  const sheet = readSheet(resident);
  const job = jobOf(sheet);
  return (
    <>
      <div className="ws-small"><b>{resident.name}</b> · rank {resident.bond.rank} · {lower(sheet.temperament)}</div>
      <div className="ws-dim ws-small">Wants {lower(sheet.want)}. Set on {lower(sheet.objective)}.{job ? ` Hands know ${job.name}.` : ''}</div>
    </>
  );
};

export const TavernRoom: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { guild, buildJobs, redeemBond, chunks, dismembered } = useHubStore();
  const beds = useMemo(() => tavernBeds(HubGenerator.generate({ chunks, dismembered })), [chunks, dismembered]);
  const taken = bedsTaken(guild.residents, { buildJobs });
  const { player } = usePlayerStore();
  const pushFeed = useFeed(s => s.push);
  const bonds = (player.bank.stashTabs[0]?.items ?? []).filter((i: IItem) => !!NpcSheet.fromBond(i));
  const lodging = guild.residents.filter(r => residentStage(r, { buildJobs }) !== 'HOME');

  return (
    <Modal title="THE RUSTY ANCHOR: WHO IS STAYING" onClose={onClose} width={560}>
      <div className="ws-dim ws-small" style={{ marginBottom: 8 }}>
        Whoever comes through the gate with you gets a bed here. They stay until the Hall of Banners buys them ground and their own house stands, or a keeper's bench takes them on.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {bonds.length > 0 && (
          <Panel title="BONDS YOU HOLD">
            {bonds.map(bond => {
              const sheet = NpcSheet.fromBond(bond)!;
              return (
                <div key={bond.id} className="ws-row">
                  <span className="ws-small">{sheet.name}, {lower(sheet.temperament)}</span>
                  {/* U14: a bond does not come back, so it is a deliberate step */}
                  <ArmedButton
                    tone="quiet"
                    confirmLabel="THE BOND IS SPENT: SURE?"
                    onConfirm={async () => {
                      const res = await redeemBond(bond.id);
                      pushFeed(res.ok ? `${sheet.name} has a bed at the Rusty Anchor.` : res.reason ?? 'Mags shakes her head.', res.ok ? 'proof' : 'loss');
                    }}
                  >
                    BRING THEM IN
                  </ArmedButton>
                </div>
              );
            })}
          </Panel>
        )}
        <Panel title="IN THE ROOMS" right={<Chip>{Number.isFinite(beds) ? <>{taken} OF {beds} BEDS</> : lodging.length}</Chip>}>
          {lodging.length === 0 && <span className="ws-dim ws-small">The beds are empty. Nobody you brought out is waiting on a house.</span>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {lodging.map(r => (
              <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <ResidentFace entityId={r.entityId} />
                <div style={{ minWidth: 0 }}>
                  <ResidentLines resident={r} />
                  <div className="ws-dim ws-small">
                    {residentStage(r, { buildJobs }) === 'TAVERN' ? 'Waiting on the Hall of Banners for ground.'
                      : residentStage(r, { buildJobs }) === 'POOLING' ? 'The Hall bought ground. The house waits on its bill.'
                      : 'Their house is rising.'}
                  </div>
                  <Button tone="quiet" onClick={() => { onClose(); void useTalk.getState().open({ kind: 'CITY', npcId: r.id }); }}>Talk with them</Button>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </Modal>
  );
};
