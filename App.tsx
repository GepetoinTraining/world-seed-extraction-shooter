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
import { Button, Chip, Kbd, RankMark } from './src/components/ui/kit';
import { useAppView } from './src/components/ui/stores';
import { ReceiptScreen } from './src/components/ReceiptScreen';
import { FeedView } from './src/components/FeedView';

// Debug Console
import { SystemConsole } from './src/components/debug/SystemConsole';
import { installConsoleInterceptor, useLogStore } from './src/components/debug/LogStore';

installConsoleInterceptor();

/** D7: very little frame. One thin bar — identity, rank, gold, console — and
 * the walkable city is the navigation. The bar's tabs are the only chrome. */
const TerminalBar: React.FC<{ devMode: boolean; onDevMode: (v: boolean) => void }> = ({ devMode, onDevMode }) => {
  const { player } = usePlayerStore();
  const { view, setView } = useAppView();
  const toggleConsole = useLogStore(s => s.toggle);
  const rank = ProgressionSystem.rankFromXp(player.rankXp ?? 0);

  const tabs: { id: 'HUB' | 'MISSIONS' | 'BANK' | 'HOLDINGS' | 'ADMIN'; label: string }[] = [
    { id: 'HUB', label: 'CITY' },
    { id: 'MISSIONS', label: 'ZONES' },
    { id: 'BANK', label: 'BANK' },
    { id: 'HOLDINGS', label: 'HOLDINGS' },
    ...(devMode ? [{ id: 'ADMIN' as const, label: 'GENRES' }] : [])
  ];

  return (
    <div
      className="ws-ui"
      style={{
        display: 'flex', alignItems: 'center', gap: 10, height: 38, padding: '0 10px',
        background: 'var(--ws-void-1)', borderBottom: '1px solid var(--ws-void-4)'
      }}
    >
      <span style={{ width: 8, height: 8, background: 'var(--ws-proof-3)', flexShrink: 0 }} />
      <b style={{ letterSpacing: '0.18em', color: 'var(--ws-text-bright)', whiteSpace: 'nowrap' }}>WORLD SEED</b>
      <Chip tone="signal" title="The terminal is listening">ONLINE</Chip>

      <nav style={{ display: 'flex', gap: 2, marginLeft: 12 }}>
        {tabs.map(t => (
          <Button key={t.id} tone={view === t.id ? 'signal' : 'quiet'} onClick={() => setView(t.id)} aria-current={view === t.id}>
            {t.label}
          </Button>
        ))}
      </nav>

      <span style={{ flex: 1 }} />

      <Chip title={`Rank ${rank} — kills feed it`}><RankMark rank={rank} scale={2} /> {rank}</Chip>
      <Chip tone="proof" title="Gold on the ledger">{player.bank.gold.toLocaleString()} G</Chip>
      <Chip title={player.id}>{player.username}</Chip>

      <Button tone="quiet" onClick={toggleConsole} title="The machine talking to itself">CONSOLE <Kbd>~</Kbd></Button>
      <Button
        tone="quiet" title="Export this avatar (sovereign backup)"
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
        BACKUP
      </Button>
      <Button
        tone="quiet" title="Return to character select"
        onClick={() => {
          localStorage.setItem('worldseed_force_select', '1');
          window.location.reload();
        }}
      >
        SWITCH
      </Button>
      <Button tone="quiet" onClick={() => onDevMode(!devMode)} title="Developer tools">
        {devMode ? 'DEV' : 'USER'}
      </Button>
    </div>
  );
};

const App: React.FC = () => {
  const { player } = usePlayerStore();
  const { currentMap } = useWorldStore();
  const { state: identityState } = useIdentityStore();
  const { view } = useAppView();

  const [devMode, setDevMode] = useState(false);

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
      </div>
    );
  }

  // E. MAIN SHELL: one thin bar, then the screen (D7)
  return (
    <div className="ws-ui" style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--ws-void-1)' }}>
      <TerminalBar devMode={devMode} onDevMode={setDevMode} />
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {view === 'HUB' && <HubCanvas />}
        {view === 'MISSIONS' && <MissionControl />}
        {view === 'BANK' && <PlayerHub />}
        {view === 'HOLDINGS' && <HoldingsPanel devMode={devMode} />}
        {view === 'ADMIN' && (devMode ? <GenreCreator /> : <div style={{ padding: 20 }} className="ws-dim">Developer tools are off.</div>)}
      </div>
      <SystemConsole />
      <FeedView />
      <ReceiptScreen />
    </div>
  );
};

export default App;
