import React, { useEffect, useRef, useState } from 'react';
import { usePlayerStore } from './src/entities/player/store';
import { useWorldStore } from './src/entities/world/store';
import { useIdentityStore, IdentityState } from './src/entities/identity/store';
import { WorldCanvas } from './src/components/WorldCanvas';
import { HubCanvas } from './src/entities/hub/HubCanvas';
import { MissionControl } from './src/components/MissionControl';
import { ReconView, closeRecon } from './src/components/ReconView';
import { MaintenanceNotice } from './src/components/MaintenanceNotice';
import { PlayerHub } from './src/components/PlayerHub';
import { IdentityGate } from './src/components/IdentityGate';
import { HubSelector } from './src/components/HubSelector';
import { HoldingsPanel } from './src/components/HoldingsPanel';
import { StartupSequence } from './src/logic/initialization/StartupSequence';
import { ProgressionSystem } from './src/entities/player/systems/ProgressionSystem';
import { Busy, Button, Chip, Kbd, Modal, RankMark } from './src/components/ui/kit';
import { AppView, useAppView, useFeed, useSheet } from './src/components/ui/stores';
import { RestBar, WaitStrip } from './src/components/WaitStrip';
import { WaitClock } from './src/logic/systems/WaitClock';
import { craftName, useHubStore } from './src/entities/hub/store';
import { CharacterSheet } from './src/components/CharacterSheet';
import { HandsLayer } from './src/components/ui/hands';
import { HoverLayer } from './src/components/ui/HoverLayer';
import { isTypingTarget } from './src/logic/systems/FieldInput';
import { ReceiptScreen } from './src/components/ReceiptScreen';
import { FeedView } from './src/components/FeedView';
import { RestDoor } from './src/logic/systems/RestDoor';
import { ScanDoor } from './src/logic/systems/ScanDoor';
import { RecordDoor } from './src/logic/systems/RecordDoor';

// Debug Console
import { SystemConsole } from './src/components/debug/SystemConsole';
import { TuningPanel } from './src/components/debug/TuningPanel';
import { installConsoleInterceptor, useLogStore } from './src/components/debug/LogStore';
import { VoicePanel } from './src/components/VoicePanel';

installConsoleInterceptor();

/** The player's own housekeeping, one step in: the backup, the other avatars, and the dev switch. */
const SystemMenu: React.FC<{ devMode: boolean; onDevMode: (v: boolean) => void; onClose: () => void }> = ({ devMode, onDevMode, onClose }) => {
  const [voiceOpen, setVoiceOpen] = React.useState(false);
  return (
  <Modal title="SYSTEM" onClose={onClose} width={voiceOpen ? 660 : 420}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Button
        autoFocus
        title="Export this avatar (sovereign backup)"
        onClick={async () => {
          const password = prompt('Passphrase to encrypt your private key:');
          if (!password) return;
          const { AvatarExport } = await import('./src/logic/sovereignty/AvatarExport');
          const result = await AvatarExport.exportAvatar(password);
          if (!result) { alert('Export failed — see console.'); return; }
          const url = URL.createObjectURL(result.blob);
          const a = document.createElement('a');
          a.href = url; a.download = result.filename; a.click();
          URL.revokeObjectURL(url);
        }}
      >
        BACK UP THIS AVATAR
      </Button>
      <Button
        title="Return to character select"
        onClick={() => {
          localStorage.setItem('worldseed_force_select', '1');
          window.location.reload();
        }}
      >
        SWITCH AVATAR
      </Button>
      <Button tone="quiet" aria-pressed={voiceOpen} onClick={() => setVoiceOpen(!voiceOpen)} title="What this machine can run, and the choice of voice">
        THE VOICE
      </Button>
      {voiceOpen && <VoicePanel titled={false} />}
      <Button tone="quiet" aria-pressed={devMode} onClick={() => onDevMode(!devMode)} title="Developer tools, also on Ctrl+Shift+D">
        DEVELOPER TOOLS: {devMode ? 'ON' : 'OFF'}
      </Button>
    </div>
  </Modal>
  );
};

const DEV_TABS: { id: AppView; label: string }[] = [
  { id: 'HUB', label: 'CITY' },
  { id: 'MISSIONS', label: 'ZONES' },
  { id: 'BANK', label: 'BANK' },
  { id: 'HOLDINGS', label: 'HOLDINGS' },
  { id: 'TUNING', label: 'TUNING' },
];

/** D79: how long this character is down. Their rest is their own loop, and SYSTEM switches to another. */
const RestChip: React.FC<{ rest?: { until: number; startedAt?: number } }> = ({ rest }) => {
  if (!rest) return null;
  return <Chip tone="signal" title="This character cannot deploy until it wakes. Another can."><RestBar rest={rest} /></Chip>;
};

/** D43: what a rest sent to the door is still out. Nothing waits on it, and nobody can say how long. */
const DreamChip: React.FC<{ filedAt?: number; out: boolean }> = ({ filedAt, out }) => {
  if (!out) return null;
  return <Chip title="It comes back when it comes back. Nothing waits on it."><Busy label="THE SEED IS READING" startedAt={filedAt} /></Chip>;
};

/** D7: very little frame. One thin bar — who you are and what you hold. The walkable
 * city is the navigation: its keepers lead to every other screen, and each has a way back. */
const TerminalBar: React.FC<{ devMode: boolean; onDevMode: (v: boolean) => void }> = ({ devMode, onDevMode }) => {
  const { player } = usePlayerStore();
  const { view, setView } = useAppView();
  const toggleConsole = useLogStore(s => s.toggle);
  const rank = ProgressionSystem.rankOf(player);
  const [systemOpen, setSystemOpen] = useState(false);
  const sheetOpen = useSheet(s => s.open);
  const toggleSheet = useSheet(s => s.toggle);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        onDevMode(!devMode);
        return;
      }
      if (e.key !== 'Escape' || isTypingTarget(e.target) || document.querySelector('.ws-overlay')) return;
      const from = useAppView.getState().view;
      if (from !== 'HUB') setView(from === 'RECON' ? 'MISSIONS' : 'HUB');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [devMode, onDevMode, setView]);

  return (
    <div
      className="ws-ui"
      style={{
        display: 'flex', alignItems: 'center', gap: 10, height: 38, padding: '0 10px', whiteSpace: 'nowrap',
        background: 'var(--ws-void-1)', borderBottom: '1px solid var(--ws-void-4)'
      }}
    >
      {view === 'RECON' && <Button tone="signal" onClick={() => setView('MISSIONS')}><Kbd>ESC</Kbd> BACK TO THE ZONES</Button>}
      {view !== 'HUB' && view !== 'RECON' && <Button tone="signal" onClick={() => setView('HUB')}><Kbd>ESC</Kbd> BACK TO THE CITY</Button>}
      <Button tone="quiet" aria-pressed={sheetOpen} onClick={toggleSheet}><Kbd>TAB</Kbd> CHARACTER</Button>

      <span style={{ flex: 1 }} />

      <RestChip rest={player.rest} />
      <DreamChip out={!!player.pendingDream} filedAt={player.pendingDream?.filedAt} />
      <Chip title={`Rank ${rank}, from the guild. Level ${ProgressionSystem.levelOf(player)}, from experience; it begins again at each rank.`}><RankMark rank={rank} scale={2} /> {rank} · LV {ProgressionSystem.levelOf(player)}</Chip>
      <Chip tone="proof" title="Gold on the ledger">{player.bank.gold.toLocaleString()} G</Chip>
      <Chip title={player.id}>{player.username}</Chip>
      <Button tone="quiet" onClick={() => setSystemOpen(true)}>SYSTEM</Button>

      {devMode && (
        <>
          {DEV_TABS.map(t => (
            <Button key={t.id} tone={view === t.id ? 'signal' : 'quiet'} onClick={() => setView(t.id)} aria-current={view === t.id}>{t.label}</Button>
          ))}
          <Button tone="quiet" onClick={toggleConsole} title="The machine talking to itself">CONSOLE <Kbd>~</Kbd></Button>
          <Chip title="Developer tools are on. Ctrl+Shift+D turns them off.">DEV</Chip>
        </>
      )}
      {systemOpen && <SystemMenu devMode={devMode} onDevMode={onDevMode} onClose={() => setSystemOpen(false)} />}
    </div>
  );
};

const App: React.FC = () => {
  const { player } = usePlayerStore();
  const { currentMap } = useWorldStore();
  const { state: identityState } = useIdentityStore();
  const { view } = useAppView();

  const [devMode, setDevModeState] = useState(() => {
    try { return localStorage.getItem('worldseed_dev') === '1'; } catch { return false; }
  });
  const setDevMode = (v: boolean) => {
    setDevModeState(v);
    try { localStorage.setItem('worldseed_dev', v ? '1' : '0'); } catch { /* the switch still works for this sitting */ }
  };

  // Lifecycle State
  const [bootStatus, setBootStatus] = useState<'INIT' | 'BOOTING' | 'READY'>('INIT');
  const [bootFailed, setBootFailed] = useState<string | null>(null);
  const [hubSelected, setHubSelected] = useState(false);
  const [gateDone, setGateDone] = useState(false);

  const session = player.currentSession;

  // Recon holds a world open with nobody in it. Leaving its view lets go, unless the leaving was a drop.
  const lastView = useRef(view);
  useEffect(() => {
    if (lastView.current === 'RECON' && view !== 'RECON' && !usePlayerStore.getState().player.currentSession) closeRecon();
    lastView.current = view;
  }, [view]);

  // 1. BOOT SEQUENCE
  useEffect(() => {
    const boot = async () => {
      if (identityState === IdentityState.READY && gateDone && bootStatus === 'INIT') {
        setBootStatus('BOOTING');
        // Line 124: a boot that cannot finish says so, and the clock does not count forever
        try {
          const result = await StartupSequence.execute();
          if (result.status === 'READY') {
            setBootStatus('READY');
          } else {
            console.error('Boot failed or waiting for identity.');
            setBootFailed(result.status);
          }
        } catch (e) {
          console.error('[BOOT] Failed:', e);
          setBootFailed(e instanceof Error ? e.message : String(e));
        }
      }
    };
    boot();
  }, [identityState, bootStatus, gateDone]);

  // D79: a rest ends when its time is up, and this character wakes whoever is watching
  useEffect(() => {
    if (bootStatus !== 'READY') return;
    void RestDoor.wakeIfDue();
    const interval = setInterval(() => void RestDoor.wakeIfDue(), 5000);
    return () => clearInterval(interval);
  }, [bootStatus]);

  // D69: a world's window runs on its own clock, from whichever client is here. Play never waits on it
  useEffect(() => {
    if (bootStatus !== 'READY') return;
    void ScanDoor.tick();
    const interval = setInterval(() => void ScanDoor.tick(), 5000);
    return () => clearInterval(interval);
  }, [bootStatus]);

  // D133: a gate going down is a downtime, and the record is told. Play never waits on it
  useEffect(() => {
    if (bootStatus !== 'READY') return;
    void RecordDoor.tick();
    const interval = setInterval(() => void RecordDoor.tick(), 5000);
    return () => clearInterval(interval);
  }, [bootStatus]);

  // A bench's job finishes whoever is looking, and it says so once (line 124)
  useEffect(() => {
    if (bootStatus !== 'READY') return;
    const told = new Set<string>();
    const tell = () => {
      const ready = WaitClock.newlyReady(useHubStore.getState().craftingJobs, usePlayerStore.getState().player.id, told, Date.now());
      for (const job of ready) useFeed.getState().push(`${craftName(job.recipeId)} is ready on the bench.`, 'signal');
    };
    tell();
    const interval = setInterval(tell, 1000);
    return () => clearInterval(interval);
  }, [bootStatus]);

  // --- VIEW ROUTER ---

  // A. IDENTITY GATE (birth, restore, and character select — Wave 9.3)
  if (identityState !== IdentityState.READY || !gateDone) {
    return (
      <>
        <IdentityGate onComplete={() => setGateDone(true)} />
        <SystemConsole />
      </>
    );
  }

  // B. BOOT LOADER
  if (bootStatus !== 'READY') {
    return (
      <div className="ws-ui" style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--ws-void-1)' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="ws-proof" style={{ letterSpacing: '0.2em', fontSize: 'var(--ws-font-head)' }}>
            INITIALIZING GENESIS PROTOCOL...
          </div>
          {bootFailed ? (
            <div style={{ marginTop: 12 }}>
              <div className="ws-loss ws-small">THIS AVATAR WOULD NOT LOAD: {bootFailed}</div>
              <div style={{ marginTop: 10 }}>
                <Button
                  tone="signal" autoFocus
                  onClick={() => {
                    localStorage.setItem('worldseed_force_select', '1');
                    window.location.reload();
                  }}
                >
                  SWITCH AVATAR
                </Button>
              </div>
            </div>
          ) : (
            <div style={{ width: 360, margin: '12px auto 0' }}><Busy /></div>
          )}
        </div>
        <SystemConsole />
      </div>
    );
  }

  // C. HUB SELECTOR
  if (!hubSelected) {
    return (
      <>
        <HubSelector onSelect={() => setHubSelected(true)} />
        <SystemConsole />
        <ReceiptScreen />
      </>
    );
  }

  // D. ACTIVE GAME SESSION
  if (session && currentMap) {
    return (
      <div style={{ height: '100vh', background: 'var(--ws-void-1)' }}>
        <WorldCanvas session={session} />
        <SystemConsole />
        <FeedView />
        <WaitStrip />
        <ReceiptScreen />
        <CharacterSheet />
        <HoverLayer />
        <HandsLayer />
      </div>
    );
  }

  // E. MAIN SHELL: one thin bar, then the screen (D7)
  return (
    <div className="ws-ui" style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--ws-void-1)' }}>
      <TerminalBar devMode={devMode} onDevMode={setDevMode} />
      <MaintenanceNotice />
      <div style={{ flex: 1, minHeight: 0, overflow: view === 'HUB' || view === 'RECON' || (view === 'TUNING' && !devMode) ? 'hidden' : 'auto' }}>
        {(view === 'HUB' || (view === 'TUNING' && !devMode)) && <HubCanvas />}
        {(view === 'MISSIONS' || (view === 'RECON' && !currentMap)) && <MissionControl />}
        {view === 'RECON' && currentMap && <ReconView />}
        {view === 'BANK' && <PlayerHub />}
        {view === 'HOLDINGS' && <HoldingsPanel devMode={devMode} />}
        {view === 'TUNING' && devMode && <TuningPanel />}
      </div>
      <SystemConsole />
      <FeedView />
      <WaitStrip />
      <ReceiptScreen />
      <CharacterSheet />
      <HoverLayer />
      <HandsLayer />
    </div>
  );
};

export default App;
