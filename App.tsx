import React, { useEffect, useState } from 'react';
import { usePlayerStore } from './src/entities/player/store';
import { useWorldStore } from './src/entities/world/store';
import { useIdentityStore, IdentityState } from './src/entities/identity/store';
import { WorldCanvas } from './src/components/WorldCanvas';
import { HubCanvas } from './src/entities/hub/HubCanvas';
import { MissionControl } from './src/components/MissionControl';
import { PlayerHub } from './src/components/PlayerHub';
import { GenreCreator } from './src/components/admin/GenreCreator';
import { IdentityGate } from './src/components/IdentityGate';
import { HubSelector } from './src/components/HubSelector';
import { HoldingsPanel } from './src/components/HoldingsPanel';
import { StartupSequence } from './src/logic/initialization/StartupSequence';
import { ProgressionSystem } from './src/entities/player/systems/ProgressionSystem';
import { Button, Chip, Kbd, Modal, RankMark } from './src/components/ui/kit';
import { AppView, useAppView, useSheet } from './src/components/ui/stores';
import { CharacterSheet } from './src/components/CharacterSheet';
import { HandsLayer } from './src/components/ui/hands';
import { HoverLayer } from './src/components/ui/HoverLayer';
import { isTypingTarget } from './src/logic/systems/FieldInput';
import { ReceiptScreen } from './src/components/ReceiptScreen';
import { FeedView } from './src/components/FeedView';

// Debug Console
import { SystemConsole } from './src/components/debug/SystemConsole';
import { installConsoleInterceptor, useLogStore } from './src/components/debug/LogStore';

installConsoleInterceptor();

/** The player's own housekeeping, one step in: the backup, the other avatars, and the dev switch. */
const SystemMenu: React.FC<{ devMode: boolean; onDevMode: (v: boolean) => void; onClose: () => void }> = ({ devMode, onDevMode, onClose }) => (
  <Modal title="SYSTEM" onClose={onClose} width={420}>
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
      <Button tone="quiet" aria-pressed={devMode} onClick={() => onDevMode(!devMode)} title="Developer tools, also on Ctrl+Shift+D">
        DEVELOPER TOOLS: {devMode ? 'ON' : 'OFF'}
      </Button>
    </div>
  </Modal>
);

const DEV_TABS: { id: AppView; label: string }[] = [
  { id: 'HUB', label: 'CITY' },
  { id: 'MISSIONS', label: 'ZONES' },
  { id: 'BANK', label: 'BANK' },
  { id: 'HOLDINGS', label: 'HOLDINGS' },
  { id: 'ADMIN', label: 'GENRES' }
];

/** D7: very little frame. One thin bar — who you are and what you hold. The walkable
 * city is the navigation: its keepers lead to every other screen, and each has a way back. */
const TerminalBar: React.FC<{ devMode: boolean; onDevMode: (v: boolean) => void }> = ({ devMode, onDevMode }) => {
  const { player } = usePlayerStore();
  const { view, setView } = useAppView();
  const toggleConsole = useLogStore(s => s.toggle);
  const rank = ProgressionSystem.rankFromXp(player.rankXp ?? 0);
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
      if (useAppView.getState().view !== 'HUB') setView('HUB');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [devMode, onDevMode, setView]);

  return (
    <div
      className="ws-ui"
      style={{
        display: 'flex', alignItems: 'center', gap: 10, height: 38, padding: '0 10px',
        background: 'var(--ws-void-1)', borderBottom: '1px solid var(--ws-void-4)'
      }}
    >
      {view !== 'HUB' && <Button tone="signal" onClick={() => setView('HUB')}><Kbd>ESC</Kbd> BACK TO THE CITY</Button>}
      <Button tone="quiet" aria-pressed={sheetOpen} onClick={toggleSheet}><Kbd>TAB</Kbd> CHARACTER</Button>

      <span style={{ flex: 1 }} />

      <Chip title={`Rank ${rank} — kills feed it`}><RankMark rank={rank} scale={2} /> {rank}</Chip>
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
  const [hubSelected, setHubSelected] = useState(false);
  const [gateDone, setGateDone] = useState(false);

  const session = player.currentSession;

  // 1. BOOT SEQUENCE
  useEffect(() => {
    const boot = async () => {
      if (identityState === IdentityState.READY && gateDone && bootStatus === 'INIT') {
        setBootStatus('BOOTING');
        const result = await StartupSequence.execute();
        if (result.status === 'READY') {
          setBootStatus('READY');
        } else {
          console.error('Boot failed or waiting for identity.');
        }
      }
    };
    boot();
  }, [identityState, bootStatus, gateDone]);

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
          <div className="ws-dim ws-small" style={{ marginTop: 8 }}>
            A save that fails its signature check is refused, not repaired. <Kbd>~</Kbd> watches it happen.
          </div>
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
      <div style={{ flex: 1, minHeight: 0, overflow: view === 'HUB' ? 'hidden' : 'auto' }}>
        {view === 'HUB' && <HubCanvas />}
        {view === 'MISSIONS' && <MissionControl />}
        {view === 'BANK' && <PlayerHub />}
        {view === 'HOLDINGS' && <HoldingsPanel devMode={devMode} />}
        {view === 'ADMIN' && (devMode ? <GenreCreator /> : <div style={{ padding: 20 }} className="ws-dim">Developer tools are off.</div>)}
      </div>
      <SystemConsole />
      <FeedView />
      <ReceiptScreen />
      <CharacterSheet />
      <HoverLayer />
      <HandsLayer />
    </div>
  );
};

export default App;
