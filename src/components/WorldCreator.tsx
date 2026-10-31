/**
 * WORLD CREATION (Wave 9): Concept → Laws → Economy → Sign, on the kit.
 * Minting signs a permanent certificate; the last step says so plainly.
 */

import React, { useState } from 'react';
import { useIdentityStore } from '../entities/identity/store';
import { WorldCertificateSystem, WorldType, AccessMode, IWorldRules } from '../entities/world/WorldCertificate';
import { UniversalRank } from '../../types';
import { Button, Input, Modal, Panel, Tabs } from './ui/kit';

interface WorldCreatorProps {
  opened: boolean;
  onClose: () => void;
  onCreated: (worldUid: string) => void;
}

const STEPS = [
  { id: '0', label: '1 CONCEPT' },
  { id: '1', label: '2 LAWS' },
  { id: '2', label: '3 ECONOMY' },
  { id: '3', label: '4 SIGN' }
] as const;

export const WorldCreator: React.FC<WorldCreatorProps> = ({ opened, onClose, onCreated }) => {
  const { certificate } = useIdentityStore();
  const [step, setStep] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [worldName, setWorldName] = useState('');
  const [worldDescription, setWorldDescription] = useState('');
  const [worldType, setWorldType] = useState<WorldType>(WorldType.EXTRACTION);
  const [size, setSize] = useState(32);

  // Rules
  const [accessMode, setAccessMode] = useState<AccessMode>(AccessMode.PUBLIC);
  const [entryFee, setEntryFee] = useState(0);
  const [extractionTax, setExtractionTax] = useState(5);
  const [creatorShare, setCreatorShare] = useState(3);
  const [pvpEnabled, setPvpEnabled] = useState(false);
  const [difficulty, setDifficulty] = useState<UniversalRank>(UniversalRank.D);
  const [sessionDuration, setSessionDuration] = useState(15);

  if (!opened) return null;

  const handleCreate = async () => {
    if (!certificate) return;
    setCreating(true);
    setError(null);
    try {
      const rules: Partial<IWorldRules> = {
        accessMode,
        entryFeeGold: entryFee,
        extractionTaxRate: extractionTax / 100,
        creatorRevenueShare: creatorShare / 100,
        pvpEnabled,
        difficulty,
        sessionDurationMinutes: worldType === WorldType.EXTRACTION ? sessionDuration : undefined
      };
      const worldCert = await WorldCertificateSystem.mintWorld(
        certificate, worldName, worldDescription, worldType, size, rules
      );
      if (worldCert) {
        onCreated(worldCert.data.worldUid);
        setStep(0); setWorldName(''); setWorldDescription('');
        onClose();
      } else {
        setError('The certificate refused to sign.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error during signing.');
    }
    setCreating(false);
  };

  const estimatedDailyRevenue = Math.floor((size === 16 ? 10 : 50) * 500 * (creatorShare / 100));

  const fieldRow = (label: string, control: React.ReactNode) => (
    <div className="ws-field" style={{ marginBottom: 8 }}>
      <label>{label}{control}</label>
    </div>
  );

  return (
    <Modal title="MINT NEW REALITY" onClose={onClose} width={560}>
      <Tabs tabs={STEPS as any} active={String(step)} onChange={id => setStep(Number(id))} />
      <div style={{ paddingTop: 10 }}>
        {step === 0 && (
          <div>
            <Input label="WORLD NAME" placeholder="e.g. SECTOR 7 SLUMS" maxLength={32} value={worldName} onChange={e => setWorldName(e.target.value)} />
            <div className="ws-field" style={{ margin: '8px 0' }}>
              <label>
                LORE DESCRIPTION
                <textarea
                  className="ws-input" rows={3} maxLength={500}
                  placeholder="A forgotten industrial sector reclaimed by neon flora…"
                  value={worldDescription}
                  onChange={e => setWorldDescription(e.target.value)}
                />
              </label>
            </div>
            {fieldRow('WORLD TYPE', (
              <select className="ws-input" value={worldType} onChange={e => setWorldType(e.target.value as WorldType)}>
                <option value={WorldType.EXTRACTION}>Extraction (high risk)</option>
                <option value={WorldType.HUB}>Social hub (safe)</option>
                <option value={WorldType.ARENA}>Arena (PvP)</option>
              </select>
            ))}
            {fieldRow('GRID SIZE', (
              <select className="ws-input" value={String(size)} onChange={e => setSize(parseInt(e.target.value))}>
                <option value="16">16×16 sectors (skirmish)</option>
                <option value="32">32×32 sectors (standard)</option>
                <option value="64">64×64 sectors (expedition)</option>
              </select>
            ))}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button tone="signal" disabled={!worldName} onClick={() => setStep(1)}>NEXT: LAWS</Button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div>
            {fieldRow('ACCESS PROTOCOL', (
              <select className="ws-input" value={accessMode} onChange={e => setAccessMode(e.target.value as AccessMode)}>
                <option value={AccessMode.PUBLIC}>Open access</option>
                <option value={AccessMode.TICKET}>Ticket required</option>
                <option value={AccessMode.GUILD}>Guild only</option>
              </select>
            ))}
            {fieldRow('DANGER LEVEL (RANK)', (
              <select className="ws-input" value={difficulty} onChange={e => setDifficulty(e.target.value as UniversalRank)}>
                {Object.values(UniversalRank).map(r => <option key={r} value={r}>Rank {r}</option>)}
              </select>
            ))}
            <div className="ws-field" style={{ marginBottom: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, flexDirection: 'row' }}>
                <input type="checkbox" checked={pvpEnabled} onChange={e => setPvpEnabled(e.target.checked)} />
                HOSTILE PLAYER ACTION (PVP)
              </label>
            </div>
            {worldType === WorldType.EXTRACTION && (
              <Input label="COLLAPSE TIMER (MINUTES)" type="number" min={5} max={60} value={sessionDuration}
                onChange={e => setSessionDuration(Number(e.target.value) || 15)} />
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
              <Button tone="quiet" onClick={() => setStep(0)}>BACK</Button>
              <Button tone="signal" onClick={() => setStep(2)}>NEXT: ECONOMY</Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <Input label="GATE FEE (GOLD)" type="number" min={0} max={1000} value={entryFee}
              onChange={e => setEntryFee(Number(e.target.value) || 0)} />
            <div className="ws-field" style={{ margin: '8px 0' }}>
              <label>
                EXTRACTION TAX — {extractionTax}%
                <input type="range" min={0} max={30} value={extractionTax} onChange={e => setExtractionTax(Number(e.target.value))} />
              </label>
            </div>
            <div className="ws-field" style={{ marginBottom: 8 }}>
              <label>
                CREATOR REVENUE SHARE — {creatorShare}%
                <input type="range" min={0} max={10} value={creatorShare} onChange={e => setCreatorShare(Number(e.target.value))} />
              </label>
            </div>
            <Panel title="EST. DAILY REVENUE" right={<span className="ws-proof">{estimatedDailyRevenue} G</span>}>
              <span className="ws-dim ws-small">An estimate, not a promise. The ledger will say what really happened.</span>
            </Panel>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
              <Button tone="quiet" onClick={() => setStep(1)}>BACK</Button>
              <Button tone="signal" onClick={() => setStep(3)}>NEXT: SIGN</Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <Panel title="IMMUTABLE ACTION" tone="proof">
              <span className="ws-small">
                Minting signs this world with your identity key. The certificate becomes a permanent asset on the ledger — it cannot be unsaid.
              </span>
            </Panel>
            {error && <div className="ws-loss ws-small" style={{ marginTop: 8 }}>{error}</div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
              <Button tone="quiet" onClick={() => setStep(2)}>BACK</Button>
              <Button tone="proof" primary disabled={creating} onClick={handleCreate}>
                {creating ? 'SIGNING…' : 'SIGN & MINT WORLD'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
