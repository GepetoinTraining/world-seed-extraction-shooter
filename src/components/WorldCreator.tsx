/**
 * WORLD CREATION (Wave 9): Concept → Laws → Economy → Sign, on the kit.
 * Minting signs a permanent certificate; the last step says so plainly.
 * D72, D80: it spends a deed, whose size it takes. The sky is chosen here.
 */

import React, { useEffect, useState } from 'react';
import { useIdentityStore } from '../entities/identity/store';
import { draftDismissal } from '../logic/systems/FieldInput';
import { WORLD_DRAFT_DEFAULTS, WorldDraft, draftDanger, useWorldDraft } from './ui/stores';
import { ProgressionSystem } from '../../shared/entities/player/systems/ProgressionSystem';
import { WorldType, AccessMode, IWorldRules } from '../entities/world/WorldCertificate';
import { usePlayerStore, playerPort } from '../entities/player/store';
import { FREE_DEED_SIZE, WorldDeed } from '../logic/systems/WorldDeed';
import { WorldDeedDoor } from '../logic/systems/WorldDeedDoor';
import { UniversalRank } from '../../shared/types';
import { Button, Input, Modal, Panel, Tabs } from './ui/kit';
import { ThemeTalk } from './ThemeTalk';
import { ContentRegistry } from '../../shared/logic/theme/ContentRegistry';
import { ThemeStore } from '../logic/theme/ThemeStore';
import { sealTheme } from '../../shared/logic/theme/ThemeCompiler';
import { IThemeBody } from '../../shared/logic/theme/ThemeTypes';
import { HubUnlock } from '../logic/systems/HubUnlock';
import { SkyKind, WorldClock } from '../entities/world/WorldClock';
import { useHubStore } from '../entities/hub/store';

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
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  // The draft lives in its own small store (line 58), so nothing here can lose it.
  const { draft, set, reset } = useWorldDraft();
  const { step, worldName, worldDescription, deedId, entryFee, extractionTax, creatorShare, pvpEnabled, sky } = draft;
  const { player } = usePlayerStore();
  const deeds = WorldDeed.held(player);
  const deed = deeds.find(d => d.id === deedId) ?? deeds[0];
  const size = deed?.worldDeedData?.size ?? FREE_DEED_SIZE;
  const spokenOf = player.creation?.themeId;
  const worldType = draft.worldType as WorldType;
  const accessMode = draft.accessMode as AccessMode;
  const difficulty = draftDanger(draft, ProgressionSystem.rankOf(player)) as UniversalRank;
  const setStep = (v: number) => set({ step: v });
  const setWorldName = (v: string) => set({ worldName: v });
  const setWorldDescription = (v: string) => set({ worldDescription: v });
  const setWorldType = (v: WorldType) => set({ worldType: v });
  const setAccessMode = (v: AccessMode) => set({ accessMode: v });
  const setEntryFee = (v: number) => set({ entryFee: v });
  const setExtractionTax = (v: number) => set({ extractionTax: v });
  const setCreatorShare = (v: number) => set({ creatorShare: v });
  const setPvpEnabled = (v: boolean) => set({ pvpEnabled: v });
  const setDifficulty = (v: UniversalRank) => set({ difficulty: v });
  const setSky = (v: string) => set({ sky: v });

  // The world the Seed spoke of comes chosen, and agreeing to it is not a draft to lose
  useEffect(() => {
    if (opened && !draft.themeId && !draft.writtenTheme && spokenOf && ContentRegistry.offered().some(t => t.themeId === spokenOf)) set({ themeId: spokenOf });
  }, [opened, spokenOf]);

  if (!opened) return null;

  const dirty = (Object.keys(WORLD_DRAFT_DEFAULTS) as (keyof WorldDraft)[]).some(k => {
    if (k === 'deedId') return false;
    if (k === 'themeId' && draft.themeId === spokenOf) return false;
    return draft[k] !== WORLD_DRAFT_DEFAULTS[k];
  });
  const requestClose = () => {
    if (draftDismissal(dirty, 'ESCAPE') === 'ASK') setAsking(true);
    else onClose();
  };

  const handleCreate = async () => {
    if (!certificate || !deed) return;
    setCreating(true);
    setError(null);
    try {
      // D56: the theme first. A written one is judged again and banked; its id is its bytes.
      let themeId = draft.themeId || ContentRegistry.defaultThemeId();
      if (draft.writtenTheme) {
        const usage = draft.writtenUsage as { model?: string; inputTokens: number; outputTokens: number; usd: number } | null;
        const pack = sealTheme(draft.writtenTheme as IThemeBody, usage?.model ?? 'unknown', Date.now(), usage
          ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, usd: usage.usd } : undefined);
        const banked = await ThemeStore.bank(pack);
        if (!banked.ok) {
          setError(banked.reason ?? 'What was written did not hold together.');
          setCreating(false);
          return;
        }
        themeId = pack.themeId;
      }
      const rules: Partial<IWorldRules> = {
        themeId,
        magicUnlocked: await HubUnlock.isUnlocked(useHubStore.getState().activeHubId ?? ''),
        accessMode,
        entryFeeGold: entryFee,
        extractionTaxRate: extractionTax / 100,
        creatorRevenueShare: creatorShare / 100,
        pvpEnabled,
        difficulty,
        sky: sky as SkyKind
      };
      const minted = await WorldDeedDoor.mint(certificate, deed.id, worldName, worldDescription, worldType, rules, playerPort);
      if (minted.ok && minted.world) {
        onCreated(minted.world.data.worldUid);
        reset();
        onClose();
      } else {
        setError(minted.reason ?? 'The certificate refused to sign.');
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
    <Modal title="MINT NEW REALITY" onClose={requestClose} width={620} heavy>
      {asking && (
        <Panel title="THE DRAFT IS UNSIGNED" tone="loss" style={{ marginBottom: 10 }}>
          <div className="ws-small" style={{ marginBottom: 8 }}>The draft is unsigned. Abandon it?</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Button tone="signal" autoFocus onClick={() => setAsking(false)}>KEEP DRAFTING</Button>
            <Button tone="loss" onClick={() => { setAsking(false); reset(); onClose(); }}>ABANDON</Button>
          </div>
        </Panel>
      )}
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
            {worldType !== WorldType.HUB && <div style={{ marginBottom: 8 }}><ThemeTalk /></div>}
            {fieldRow('WORLD TYPE', (
              <select className="ws-input" value={worldType} onChange={e => setWorldType(e.target.value as WorldType)}>
                <option value={WorldType.EXTRACTION}>Extraction (high risk)</option>
                <option value={WorldType.HUB}>Social hub (safe)</option>
                <option value={WorldType.ARENA}>Arena (PvP)</option>
              </select>
            ))}
            {deeds.length > 0 ? fieldRow('THE DEED IT SPENDS', (
              <select className="ws-input" value={deed?.id ?? ''} onChange={e => set({ deedId: e.target.value })}>
                {deeds.map(d => <option key={d.id} value={d.id}>{WorldDeed.say(d.worldDeedData!.size)}</option>)}
              </select>
            )) : (
              <Panel title="YOU HOLD NO DEED" tone="loss" style={{ marginBottom: 8 }}>
                <span className="ws-small">A world costs a deed, and you hold no deed. One can be found out there, or had from someone who holds one.</span>
              </Panel>
            )}
            {/* D67: how the gate runs is signed with the world */}
            <div className="ws-dim ws-small" style={{ marginBottom: 8 }}>
              Its gate stays open {WorldClock.say(WorldClock.cadenceFor(size).upMs)}, then goes down for {WorldClock.say(WorldClock.cadenceFor(size).offMs)}, then boots for {WorldClock.say(WorldClock.cadenceFor(size).scanMs)} of recon. It opens the moment you sign.
            </div>
            {worldType !== WorldType.HUB && fieldRow('SKY', (
              <select className="ws-input" value={sky} onChange={e => setSky(e.target.value)}>
                <option value="TURNING">It turns: day and night</option>
                <option value="LOCKED">It does not spin: a night side, a rim, a day side</option>
                <option value="NIGHT">Only night</option>
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
              <div className="ws-small" style={{ marginTop: 6 }}>
                {deed ? `It spends ${deed.name}: ${WorldDeed.say(size)}. The deed is gone at the signing.` : 'You hold no deed, so nothing can be signed.'}
              </div>
            </Panel>
            {error && <div className="ws-loss ws-small" style={{ marginTop: 8 }}>{error}</div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
              <Button tone="quiet" onClick={() => setStep(2)}>BACK</Button>
              <Button tone="proof" primary disabled={creating || !deed} onClick={handleCreate}>
                {creating ? 'SIGNING…' : 'SIGN & MINT WORLD'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
