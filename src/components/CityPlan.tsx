/**
 * THE CITY PLAN (D73, D74): at the Land Office. What has risen, by where it stands,
 * and what the next chunk asks. Materials are deposited here, and the plan is decided
 * here: solo, by whoever deposited; online, by Wave 13's weekly vote.
 */

import React, { useMemo, useState } from 'react';
import { answersTag, materialLabel } from '../../shared/entities/hub/room';
import { chunkBillFor, isFarmland, openSides } from '../entities/hub/hubManifest';
import { FarmDoors } from '../entities/hub/farmDoors';
import { useHubStore, hubPort } from '../entities/hub/store';
import { usePlayerStore } from '../entities/player/store';
import { ArmedButton, Button, Modal, Panel } from './ui/kit';
import { useFeed } from './ui/stores';

const CELL_PX = 56;

export const CityPlan: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { chunks, planDeposit, depositToPlan, planRaise } = useHubStore();
  const { player } = usePlayerStore();
  const pushFeed = useFeed(s => s.push);
  const stash = player.bank.stashTabs[0]?.items || [];
  const [chosen, setChosen] = useState<string | null>(null);
  const [ploughing, setPloughing] = useState<string | null>(null);

  const bill = chunkBillFor(chunks.length);
  const open = useMemo(() => openSides({ chunks }), [chunks]);
  const met = bill.every(line => (planDeposit[line.tag] ?? 0) >= line.count);
  const choice = open.find(o => `${o.at.cx},${o.at.cy}` === chosen) ?? null;

  // The ground by position: what stands is solid, and where a chunk could rise is a broken outline.
  const all = [...chunks.map(c => ({ cx: c.cx, cy: c.cy })), ...open.map(o => o.at)];
  const minCx = Math.min(...all.map(c => c.cx)), maxCx = Math.max(...all.map(c => c.cx));
  const minCy = Math.min(...all.map(c => c.cy)), maxCy = Math.max(...all.map(c => c.cy));

  const deposit = async (tag: string, defId: string, count: number) => {
    const ids = stash.filter(i => i.universalDefinitionId === defId).slice(0, count).map(i => i.id);
    const res = await depositToPlan(tag, ids);
    pushFeed(res.ok ? `${materialLabel(defId)} deposited. The plan holds it.` : res.reason ?? 'The office would not take it.', res.ok ? 'signal' : 'loss');
  };

  return (
    <Modal title="THE CITY PLAN" onClose={onClose} width={640}>
      <div className="ws-dim ws-small" style={{ marginBottom: 8 }}>
        {chunks.length} chunk{chunks.length === 1 ? '' : 's'} standing. Each chunk rises beside one that stands, and the next one asks more than the last.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10, alignItems: 'start' }}>
        <Panel title="WHERE IT RISES">
          <div
            data-testid="plan-grid"
            style={{
              display: 'grid', gap: 2, justifyContent: 'center',
              gridTemplateColumns: `repeat(${maxCx - minCx + 1}, ${CELL_PX}px)`,
              gridTemplateRows: `repeat(${maxCy - minCy + 1}, ${CELL_PX}px)`
            }}
          >
            {chunks.map((c, i) => {
              const key = `${c.cx},${c.cy}`;
              const farm = isFarmland(c);
              return (
                <button
                  key={key}
                  type="button"
                  className="ws-ui ws-small"
                  disabled={i === 0 || farm}
                  aria-pressed={ploughing === key}
                  aria-label={i === 0 ? 'The city' : farm ? `Chunk ${i + 1}, farmland` : `Chunk ${i + 1}: make it farmland`}
                  onClick={() => setPloughing(ploughing === key ? null : key)}
                  style={{
                    gridColumn: c.cx - minCx + 1, gridRow: c.cy - minCy + 1, color: 'inherit', fontFamily: 'var(--ws-mono)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: i === 0 || farm ? 'default' : 'pointer',
                    border: `${ploughing === key ? 4 : 2}px ${farm ? 'double' : 'solid'} var(--ws-text-body)`, background: 'var(--ws-void-3)', fontWeight: i === 0 ? 700 : 400
                  }}
                >
                  {i === 0 ? 'CITY' : farm ? `FARM #${i + 1}` : `#${i + 1}`}
                </button>
              );
            })}
            {open.map(o => {
              const key = `${o.at.cx},${o.at.cy}`;
              return (
                <button
                  key={key}
                  type="button"
                  className="ws-ui ws-small"
                  aria-label={`Raise a chunk ${o.side.toLowerCase()} of chunk ${o.beside.cx},${o.beside.cy}`}
                  aria-pressed={chosen === key}
                  onClick={() => setChosen(chosen === key ? null : key)}
                  style={{
                    gridColumn: o.at.cx - minCx + 1, gridRow: o.at.cy - minCy + 1,
                    border: `2px ${chosen === key ? 'solid' : 'dashed'} var(--ws-text-body)`,
                    background: chosen === key ? 'var(--ws-void-2)' : 'transparent',
                    color: 'inherit', cursor: 'pointer', fontFamily: 'var(--ws-mono)'
                  }}
                >
                  {chosen === key ? 'HERE' : o.side[0]}
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: 10 }}>
            <Button
              disabled={!met || !choice}
              title={!choice ? 'Choose where it rises.' : !met ? 'The deposit is short.' : `${choice.side} of chunk ${choice.beside.cx},${choice.beside.cy}`}
              onClick={async () => {
                if (!choice) return;
                const res = await planRaise(choice.side, choice.beside);
                pushFeed(res.ok ? 'The city grows. New ground is on the plan, and its lots are for sale.' : res.reason ?? 'It would not rise.', res.ok ? 'proof' : 'loss');
                if (res.ok) setChosen(null);
              }}
            >
              RAISE THE CHUNK
            </Button>{' '}
            <Button
              tone="quiet"
              disabled={!met || !choice}
              title={!choice ? 'Choose where it rises.' : !met ? 'The deposit is short.' : 'The whole chunk, portioned evenly by the hub.'}
              onClick={async () => {
                if (!choice) return;
                const res = await FarmDoors.raiseFarmland(choice.side, choice.beside, hubPort);
                pushFeed(res.ok ? 'New ground is ploughed whole. The hub has portioned it into even plots, for sale at the deeds.' : res.reason ?? 'It would not rise.', res.ok ? 'proof' : 'loss');
                if (res.ok) setChosen(null);
              }}
            >
              RAISE IT AS FARMLAND
            </Button>
            {ploughing && (
              <div style={{ marginTop: 6 }}>
                <ArmedButton
                  tone="quiet"
                  confirmLabel="THE WHOLE CHUNK: SURE?"
                  onConfirm={async () => {
                    const [cx, cy] = ploughing.split(',').map(Number);
                    const res = await FarmDoors.makeFarmland({ cx, cy }, hubPort);
                    pushFeed(res.ok ? 'That ground is farmland now, whole, and the hub has portioned it into even plots.' : res.reason ?? 'It would not go.', res.ok ? 'proof' : 'loss');
                    if (res.ok) setPloughing(null);
                  }}
                >
                  MAKE THAT CHUNK FARMLAND
                </ArmedButton>
              </div>
            )}
          </div>
        </Panel>
        <Panel title="WHAT IT ASKS">
          {bill.map(line => {
            const held = planDeposit[line.tag] ?? 0;
            const answers = [...new Set(stash.filter(i => answersTag(i, line.tag)).map(i => i.universalDefinitionId))];
            const short = Math.max(0, line.count - held);
            return (
              <div key={line.tag} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div className="ws-row">
                  <span>{line.tag}</span>
                  <span>{held} of {line.count}</span>
                </div>
                {answers.length === 0 && short > 0 && <span className="ws-dim ws-small">Nothing in the stash answers this.</span>}
                {short > 0 && answers.map(defId => {
                  const count = stash.filter(i => i.universalDefinitionId === defId).length;
                  const giving = Math.min(count, short);
                  return (
                    <div key={defId} className="ws-row">
                      <span className="ws-small" style={{ minWidth: 0 }}>{materialLabel(defId)}, {count} held</span>
                      {/* U14: a deposit does not come back, so it is a deliberate step */}
                      <ArmedButton tone="quiet" confirmLabel={`GIVE ${giving}: SURE?`} onConfirm={() => void deposit(line.tag, defId, giving)}>
                        DEPOSIT {giving}
                      </ArmedButton>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </Panel>
      </div>
    </Modal>
  );
};
