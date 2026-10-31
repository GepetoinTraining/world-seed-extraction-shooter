/**
 * THE GATE (Wave 9.3, D5): birth, restore, and character select.
 *
 * A device holds a roster of complete owners. Minting is birth: the face is
 * derived from the certificate, so nobody chooses it and nobody can lose it.
 * Returning is select: pick an avatar, jack in, and NOTHING is reset — the
 * old handleLogin rebuilt every returning player as an Operator; ensureCharacter
 * refuses to touch an identity the store already holds.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useIdentityStore, IdentityState } from '../entities/identity/store';
import { usePlayerStore, ARCHETYPES } from '../entities/player/store';
import { AvatarRoster, IRosterEntry } from '../entities/identity/roster';
import { Archetype, figure } from '../render/atoms/people';
import { Button, Input, Panel, PortraitView, SpriteView } from './ui/kit';

const FORCE_SELECT = 'worldseed_force_select';

const ARCHETYPE_LINES: Record<string, string> = {
  OPERATOR: 'Reads the machine. Pack and antenna; the terminal answers faster.',
  STREET_SAMURAI: 'Angular shoulders, a topknot, and no patience for locked doors.',
  NOMAD: 'Hood and cloak. Walks out of places others are carried out of.',
  ARCANIST: 'Robe and halo. Asks the Seed directly and sometimes it answers.'
};

export const IdentityGate = ({ onComplete }: { onComplete: () => void }) => {
  const { state, createIdentity, certificate, error, checkExistingIdentity } = useIdentityStore();
  const { ensureCharacter } = usePlayerStore();

  const [mode, setMode] = useState<'select' | 'birth' | 'restore' | 'minted'>('select');
  const [roster, setRoster] = useState<IRosterEntry[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [selectedArchetype, setSelectedArchetype] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [backupPass, setBackupPass] = useState('');
  const [restoreError, setRestoreError] = useState<string | null>(null);

  useEffect(() => {
    const list = AvatarRoster.list();
    setRoster(list);
    const forced = localStorage.getItem(FORCE_SELECT);
    if (forced) localStorage.removeItem(FORCE_SELECT);
    if (list.length === 0) setMode('birth');
    else {
      setMode('select');
      setChosen(AvatarRoster.activeUid() ?? list[0].certificate.metadata.uid);
    }
  }, []);

  const handleMint = async () => {
    if (!name || !selectedArchetype) return;
    setCreating(true);
    const success = await createIdentity(name);
    if (success) {
      const cert = useIdentityStore.getState().certificate;
      if (cert) {
        AvatarRoster.remember(cert, selectedArchetype);
        AvatarRoster.setActive(cert);
        ensureCharacter(cert, selectedArchetype);
        setRoster(AvatarRoster.list());
        setMode('minted');
      }
    }
    setCreating(false);
  };

  const handleJackIn = async (entry: IRosterEntry) => {
    AvatarRoster.setActive(entry.certificate);
    await checkExistingIdentity();
    const st = useIdentityStore.getState();
    if (st.state !== IdentityState.READY || !st.certificate) return; // key missing: the gate says so below
    // The fix: adopt, never reinitialize. The archetype rides along for genesis only.
    ensureCharacter(st.certificate, entry.archetype || 'OPERATOR');
    onComplete();
  };

  const handleRestore = async () => {
    if (!backupFile) return;
    setRestoreError(null);
    const { AvatarExport } = await import('../logic/sovereignty/AvatarExport');
    const result = await AvatarExport.importAvatar(await backupFile.text(), backupPass);
    if (result.ok) window.location.reload();
    else setRestoreError(result.reason || 'Unknown error');
  };

  const keyMissing = state === IdentityState.NO_IDENTITY && roster.length > 0 && mode === 'select';

  // --- BIRTH MOMENT: the real avatar from the real certificate ---
  if (mode === 'minted' && certificate) {
    return (
      <Gate>
        <Panel tone="proof" style={{ width: 460 }}>
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <div className="ws-proof" style={{ fontSize: 'var(--ws-font-title)', letterSpacing: '0.25em' }}>IDENTITY MINTED</div>
            <div className="ws-dim ws-small" style={{ marginTop: 4 }}>
              This face is computed from your certificate. Nobody chose it. Nobody can take it.
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 20, alignItems: 'flex-end', margin: '10px 0' }}>
            <PortraitView uid={certificate.metadata.uid} archetype={(AvatarRoster.archetypeOf(certificate.metadata.uid) || 'OPERATOR') as Archetype} scale={4} />
            <SpriteView sprite={figure({ uid: certificate.metadata.uid, archetype: (AvatarRoster.archetypeOf(certificate.metadata.uid) || 'OPERATOR') as Archetype })} scale={4} />
          </div>
          <div style={{ textAlign: 'center' }} className="ws-small">
            <div className="ws-bright">{certificate.metadata.displayName.toUpperCase()}</div>
            <div className="ws-dim" style={{ wordBreak: 'break-all' }}>{certificate.metadata.uid}</div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 14 }}>
            <Button
              tone="quiet"
              onClick={async () => {
                const password = prompt('Set an encryption passphrase for the certificate export:');
                if (!password) return;
                const blob = await useIdentityStore.getState().exportIdentity(password);
                if (!blob) { alert('Export window passed — use BACKUP in the terminal bar instead.'); return; }
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = `worldseed_identity_${certificate.metadata.uid}.json`; a.click();
                URL.revokeObjectURL(url);
              }}
            >
              EXPORT CERTIFICATE
            </Button>
            <Button tone="proof" primary autoFocus onClick={onComplete}>ENTER WORLD SEED</Button>
          </div>
        </Panel>
      </Gate>
    );
  }

  // --- BIRTH ---
  if (mode === 'birth') {
    return (
      <Gate>
        <Panel title="GENESIS PROTOCOL" right={roster.length > 0 && <Button tone="quiet" onClick={() => setMode('select')}>BACK TO SELECT</Button>} style={{ width: 720 }}>
          <div className="ws-dim ws-small" style={{ marginBottom: 10 }}>
            Mint a sovereign identity. The certificate signs everything you ever bank.
          </div>

          <Input
            label="1. DESIGNATION — CODENAME"
            placeholder="KAEL / SERA / IO…"
            value={name}
            onChange={e => setName(e.target.value)}
            style={{ textTransform: 'uppercase' }}
            autoFocus
          />

          <div className="ws-dim ws-small" style={{ margin: '12px 0 6px', letterSpacing: '0.08em' }}>2. NEURAL ARCHETYPE</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {Object.entries(ARCHETYPES).map(([key, stats]) => {
              const active = selectedArchetype === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedArchetype(key)}
                  aria-pressed={active}
                  className="ws-ui"
                  style={{
                    display: 'flex', gap: 10, alignItems: 'center', textAlign: 'left', cursor: 'pointer',
                    background: active ? 'var(--ws-signal-0)' : 'var(--ws-void-2)',
                    border: `1px solid ${active ? 'var(--ws-signal-2)' : 'var(--ws-void-4)'}`,
                    padding: 8, color: 'inherit', fontFamily: 'var(--ws-mono)'
                  }}
                >
                  <SpriteView sprite={figure({ uid: `preview:${name || 'unborn'}`, archetype: key as Archetype })} scale={3} />
                  <span style={{ minWidth: 0 }}>
                    <span className={active ? 'ws-signal' : 'ws-bright'} style={{ display: 'block', letterSpacing: '0.08em' }}>{key.replace('_', ' ')}</span>
                    <span className="ws-dim ws-small" style={{ display: 'block' }}>{ARCHETYPE_LINES[key]}</span>
                    <span className="ws-small" style={{ display: 'block', marginTop: 2 }}>
                      {Object.entries(stats).map(([stat, val]) => `${stat.slice(0, 3).toUpperCase()} +${val}`).join(' · ')}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="ws-dim ws-small" style={{ marginTop: 6 }}>
            The silhouette is the archetype's. The face comes from the certificate — you will meet it after the mint.
          </div>

          {error && <div className="ws-loss ws-small" style={{ marginTop: 8 }}>GENERATION FAILED: {error}</div>}

          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            <Button tone="proof" primary disabled={!name || !selectedArchetype || creating} onClick={handleMint} style={{ flex: 1, textAlign: 'center' }}>
              {creating ? 'MINTING…' : 'MINT IDENTITY CERTIFICATE'}
            </Button>
            <Button tone="quiet" onClick={() => setMode('restore')}>RESTORE A BACKUP</Button>
          </div>
        </Panel>
      </Gate>
    );
  }

  // --- RESTORE ---
  if (mode === 'restore') {
    return (
      <Gate>
        <Panel title="RESTORE AVATAR" right={<Button tone="quiet" onClick={() => setMode(roster.length ? 'select' : 'birth')}>BACK</Button>} style={{ width: 460 }}>
          <div className="ws-dim ws-small" style={{ marginBottom: 10 }}>
            A sovereign backup holds the certificate, the key and the bank. A wrong passphrase or a tampered digest is refused.
          </div>
          <div className="ws-field" style={{ marginBottom: 8 }}>
            <label>
              BACKUP FILE
              <input
                type="file" accept="application/json" className="ws-input"
                onChange={e => setBackupFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
          <Input label="PASSPHRASE" type="password" value={backupPass} onChange={e => setBackupPass(e.target.value)} />
          {restoreError && <div className="ws-loss ws-small" style={{ marginTop: 8 }}>RESTORE REFUSED: {restoreError}</div>}
          <div style={{ marginTop: 12 }}>
            <Button tone="signal" primary disabled={!backupFile || !backupPass} onClick={handleRestore}>RESTORE AVATAR</Button>
          </div>
        </Panel>
      </Gate>
    );
  }

  // --- CHARACTER SELECT (D5) ---
  return (
    <Gate>
      <Panel title="CHARACTER SELECT" right={<span className="ws-dim ws-small">{roster.length} avatar{roster.length === 1 ? '' : 's'} on this device</span>} style={{ width: 640 }}>
        {keyMissing && (
          <div className="ws-loss ws-small" style={{ marginBottom: 8 }}>
            That avatar's private key is not on this device. Restore it from a backup, or pick another.
          </div>
        )}
        <div className="ws-list">
          {roster.map(entry => {
            const uid = entry.certificate.metadata.uid;
            const active = chosen === uid;
            return (
              <div key={uid} className="ws-row" style={active ? { background: 'var(--ws-void-2)' } : undefined}>
                <button
                  type="button"
                  onClick={() => setChosen(uid)}
                  onDoubleClick={() => handleJackIn(entry)}
                  className="ws-ui"
                  aria-pressed={active}
                  style={{
                    display: 'flex', gap: 10, alignItems: 'center', flex: 1, minWidth: 0, textAlign: 'left',
                    background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', fontFamily: 'var(--ws-mono)', padding: 4
                  }}
                >
                  <PortraitView uid={uid} archetype={(entry.archetype || 'OPERATOR') as Archetype} scale={2} />
                  <span style={{ minWidth: 0 }}>
                    <span className={active ? 'ws-signal' : 'ws-bright'} style={{ display: 'block' }}>
                      {entry.certificate.metadata.displayName.toUpperCase()}
                    </span>
                    <span className="ws-dim ws-small" style={{ display: 'block' }}>
                      {(entry.archetype || 'OPERATOR').replace('_', ' ')} · {uid.slice(0, 16)}…
                    </span>
                  </span>
                </button>
                <div style={{ display: 'flex', gap: 6 }}>
                  {active && <Button tone="signal" primary onClick={() => handleJackIn(entry)}>JACK IN</Button>}
                  <Button
                    tone="quiet"
                    title="Remove from this device's select screen. Signed records and keys remain."
                    onClick={() => {
                      if (!confirm(`Remove ${entry.certificate.metadata.displayName} from character select? The ledger keeps its records.`)) return;
                      AvatarRoster.forget(uid);
                      setRoster(AvatarRoster.list());
                    }}
                  >
                    FORGET
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <Button tone="proof" onClick={() => { setName(''); setSelectedArchetype(null); setMode('birth'); }}>MINT A NEW AVATAR</Button>
          <Button tone="quiet" onClick={() => setMode('restore')}>RESTORE A BACKUP</Button>
        </div>
      </Panel>
    </Gate>
  );
};

const Gate: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    className="ws-ui"
    style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--ws-void-1)' }}
  >
    {children}
  </div>
);
