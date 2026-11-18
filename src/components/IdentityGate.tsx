/**
 * THE GATE (Wave 9.3, D5): birth, restore, and character select.
 *
 * A device holds a roster of complete owners. Minting is birth: the face is
 * derived from the certificate, so nobody chooses it and nobody can lose it.
 * Returning is select: pick an avatar, jack in, and NOTHING is reset — the
 * old handleLogin rebuilt every returning player as an Operator; ensureCharacter
 * refuses to touch an identity the store already holds.
 *
 * PLAYED FROM THE DOMAIN, THE ACCOUNT COMES FIRST (HubLink.ts; Pedro, 2026-11-18: "the account takes
 * precedence, so when someone logs in again we need to serve them the data we have"). Nobody makes or
 * plays a character with nobody signed in. A character is registered under the account as it is
 * made, and one this browser holds is registered when it is played. The select screen says what the
 * account holds on the hub, and which of its characters are on another device.
 */

import React, { useEffect, useState } from 'react';
import { useIdentityStore, IdentityState } from '../entities/identity/store';
import { usePlayerStore } from '../entities/player/store';
import { AvatarRoster, IRosterEntry } from '../entities/identity/roster';
import { Archetype, figure } from '../../shared/render/atoms/people';
import { HomeHub } from '../logic/persistence/HomeHub';
import { CreationDoor } from '../logic/systems/CreationDoor';
import { CreationSystem, ICreationSheet } from '../logic/systems/CreationSystem';
import { WorldDeed } from '../logic/systems/WorldDeed';
import { CreationFlow } from './CreationFlow';
import { useCreationDraft } from './ui/creationDraft';
import { Button, Input, Panel, PortraitView, SpriteView } from './ui/kit';
import { VoiceChip, VoicePanel } from './VoicePanel';
import { HubLink, type IBound } from '../logic/hub/HubLink';
import type { IHubCharacter, IHubWhere } from '../logic/hub/HubClient';

const FORCE_SELECT = 'worldseed_force_select';

export const IdentityGate = ({ onComplete }: { onComplete: () => void }) => {
  const { state, createIdentity, certificate, error, checkExistingIdentity } = useIdentityStore();
  const { ensureCharacter, player } = usePlayerStore();

  const [mode, setMode] = useState<'select' | 'birth' | 'restore' | 'minted'>('select');
  const [roster, setRoster] = useState<IRosterEntry[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);

  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [backupPass, setBackupPass] = useState('');
  const [restoreError, setRestoreError] = useState<string | null>(null);

  // The account, where it comes first (HubLink.ts): who is signed in, what they hold on the hub, and what the hub said of the character at hand
  const accountFirst = HubLink.required();
  const [where, setWhere] = useState<IHubWhere | null>(null);
  const [held, setHeld] = useState<IHubCharacter[]>([]);
  const [hubSaid, setHubSaid] = useState<IBound | null>(null);
  const [binding, setBinding] = useState(false);

  const lookAtAccount = async (): Promise<IHubCharacter[]> => {
    const w = await HubLink.where();
    const mine = w.configured && w.signedIn ? await HubLink.held() : [];
    setWhere(w);
    setHeld(mine);
    return mine;
  };

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
    // Someone whose account holds characters made elsewhere is shown them first, never a blank birth
    if (accountFirst) void lookAtAccount().then(mine => { if (list.length === 0 && mine.length > 0) setMode('select'); });
  }, []);

  /** Registers the character under the signed-in account, and says what the hub answered. */
  const bind = async (cert: NonNullable<typeof certificate>): Promise<IBound> => {
    setBinding(true);
    try {
      const said = await HubLink.bind(cert);
      setHubSaid(said);
      if (said.state === 'SIGNED_OUT') await lookAtAccount();
      return said;
    } finally {
      setBinding(false);
    }
  };

  const handleMint = async (name: string, sheet: ICreationSheet) => {
    if (creating) return;
    setCreating(true);
    const success = await createIdentity(name);
    if (success) {
      const cert = useIdentityStore.getState().certificate;
      if (cert) {
        AvatarRoster.remember(cert, sheet.silhouette);
        AvatarRoster.setActive(cert);
        ensureCharacter(cert, sheet.silhouette, sheet);
        CreationDoor.holdSheet(cert.metadata.uid, sheet);
        // Where they chose to arrive is theirs. No choice means the hub this device's boot finds.
        if (sheet.hubId) await HomeHub.pin(cert.metadata.uid, sheet.hubId);
        useCreationDraft.getState().reset();
        setRoster(AvatarRoster.list());
        // Born on the hub's word: registered now, and its first row names the mint (StartupSequence)
        if (accountFirst) await bind(cert);
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
    // A character this browser holds and the hub does not is registered as it is played. One that is
    // another account's is not played here; a hub that cannot be reached holds nobody back.
    if (accountFirst) {
      const said = await bind(st.certificate);
      if (said.state === 'SIGNED_OUT' || said.state === 'ANOTHERS') return;
    }
    // The fix: adopt, never reinitialize. The archetype rides along for genesis only.
    ensureCharacter(st.certificate, entry.archetype || 'OPERATOR', CreationDoor.heldSheet(st.certificate.metadata.uid));
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

  // --- THE ACCOUNT FIRST: nobody signed in, nothing is made and nothing is played ---
  if (accountFirst && !where) {
    return <Gate><Panel style={{ width: 460 }}><div className="ws-dim ws-small">Asking this hub who is signed in…</div></Panel></Gate>;
  }
  if (accountFirst && where?.configured && !where.signedIn) {
    return (
      <Gate>
        <Panel title="SIGN IN FIRST" style={{ width: 460, whiteSpace: 'normal' }}>
          <div className="ws-small">On this hub the account comes first. A character is born under it, and what the hub holds of you comes back when you sign in.</div>
          {roster.length > 0 && <div className="ws-dim ws-small" style={{ marginTop: 6 }}>{roster.length} avatar{roster.length === 1 ? ' is' : 's are'} on this device, and wait{roster.length === 1 ? 's' : ''} here.</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <a className="ws-ui ws-btn ws-btn--signal ws-btn--primary" href="/" style={{ textDecoration: 'none' }}>TO THE FIRST PAGE, TO SIGN IN</a>
            <Button tone="quiet" onClick={() => void lookAtAccount()}>CHECK AGAIN</Button>
          </div>
        </Panel>
      </Gate>
    );
  }
  const heldUids = new Set(held.map(c => c.uid));
  const elsewhere = held.filter(c => !roster.some(r => r.certificate.metadata.uid === c.uid));
  const bound = !accountFirst || hubSaid?.state === 'BOUND';

  // --- BIRTH MOMENT: the real avatar from the real certificate ---
  if (mode === 'minted' && certificate) {
    const uid = certificate.metadata.uid;
    const made = player.id === uid ? player.creation : undefined;
    const focus = made ? CreationSystem.focusOfRecord(made, uid) : null;
    const dealt = player.baseAttributes as unknown as Record<string, number>;
    const deeds = player.id === uid ? WorldDeed.held(player) : [];
    return (
      <Gate>
        <Panel tone="proof" style={{ width: 460 }}>
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <div className="ws-proof" style={{ fontSize: 'var(--ws-font-title)', letterSpacing: '0.25em' }}>IDENTITY MINTED</div>
            <div className="ws-dim ws-small" style={{ marginTop: 4 }}>
              This face comes from your certificate. Nobody chose it. Nobody can take it.
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 20, alignItems: 'flex-end', margin: '10px 0' }}>
            <PortraitView uid={certificate.metadata.uid} archetype={(AvatarRoster.archetypeOf(certificate.metadata.uid) || 'OPERATOR') as Archetype} scale={4} />
            <SpriteView sprite={figure({ uid: certificate.metadata.uid, archetype: (AvatarRoster.archetypeOf(certificate.metadata.uid) || 'OPERATOR') as Archetype })} scale={4} />
          </div>
          <div style={{ textAlign: 'center' }} className="ws-small">
            <div className="ws-bright">{certificate.metadata.displayName.toUpperCase()}</div>
            {made?.className && <div className="ws-bright" style={{ marginTop: 6 }}>{made.className.toUpperCase()}</div>}
            {focus && (
              <div style={{ marginTop: 6 }}>
                MAIN FOCUS {focus.main.toUpperCase()} {dealt[focus.main]} · SUB FOCUS {focus.sub.toUpperCase()} {dealt[focus.sub]}
              </div>
            )}
            {deeds.length > 0 && <div className="ws-dim" style={{ marginTop: 2 }}>IN THE VAULT: {deeds.map(d => d.name).join(', ')}</div>}
          </div>
          {accountFirst && (
            <div className="ws-small" style={{ textAlign: 'center', marginTop: 10, whiteSpace: 'normal' }}>
              {binding
                ? '[…] Registering with this hub…'
                : bound
                  ? `[■] Registered on this hub${where?.signedIn ? `, under ${where.signedIn}` : ''}. Its receipts go up by themselves as you play.`
                  : `[!] Not registered on this hub yet: ${hubSaid?.reason ?? 'it did not answer.'}`}
              {!binding && !bound && <div style={{ marginTop: 6 }}><Button tone="signal" onClick={() => void bind(certificate)}>TRY AGAIN</Button></div>}
            </div>
          )}
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
            <Button tone="proof" primary autoFocus disabled={!bound || binding} title={bound ? undefined : 'A character is born on this hub\'s word: it is registered first.'} onClick={onComplete}>ENTER WORLD SEED</Button>
          </div>
        </Panel>
      </Gate>
    );
  }

  // --- BIRTH: the flow, and its draft survives leaving this screen ---
  if (mode === 'birth') {
    return (
      <Gate>
        <CreationFlow
          onMint={handleMint}
          creating={creating}
          error={error}
          aside={
            <span style={{ display: 'flex', gap: 6 }}>
              <VoiceChip />
              {roster.length > 0 && <Button tone="quiet" onClick={() => setMode('select')}>TO CHARACTER SELECT</Button>}
              <Button tone="quiet" onClick={() => setMode('restore')}>RESTORE A BACKUP</Button>
            </span>
          }
        />
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '100vh', overflowY: 'auto', padding: '12px 0' }}>
      <Panel title="CHARACTER SELECT" right={<span className="ws-dim ws-small">{accountFirst && where?.signedIn ? `SIGNED IN · ${where.signedIn} · ` : ''}{roster.length} avatar{roster.length === 1 ? '' : 's'} on this device</span>} style={{ width: 640 }}>
        {accountFirst && hubSaid && hubSaid.state !== 'BOUND' && hubSaid.state !== 'NO_HUB' && !binding && (
          <div className="ws-small" style={{ marginBottom: 8, whiteSpace: 'normal' }}>! {hubSaid.reason}</div>
        )}
        {binding && <div className="ws-dim ws-small" style={{ marginBottom: 8 }}>Asking this hub…</div>}
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
                      {(entry.archetype || 'OPERATOR').replace(/_/g, ' ')}
                      {accountFirst && where?.signedIn ? (heldUids.has(uid) ? ' · [■] ON YOUR ACCOUNT' : ' · [ ] JOINS YOUR ACCOUNT WHEN PLAYED') : ''}
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
        {elsewhere.length > 0 && (
          <div style={{ marginTop: 12, whiteSpace: 'normal' }}>
            <div className="ws-bright ws-small">YOUR ACCOUNT ALSO HOLDS, NOT ON THIS DEVICE</div>
            <div className="ws-list">
              {elsewhere.map(c => (
                <div key={c.uid} className="ws-row">
                  <span style={{ minWidth: 0 }}>
                    <span className="ws-bright" style={{ display: 'block' }}>{(c.displayName || 'A CHARACTER').toUpperCase()}</span>
                    <span className="ws-dim ws-small" style={{ display: 'block' }}>
                      {c.held} receipt{c.held === 1 ? '' : 's'} held by this hub{c.standing === 'CHALLENGED' ? ' · [!] ITS STANDING IS CHALLENGED' : ''}
                    </span>
                  </span>
                </div>
              ))}
            </div>
            <div className="ws-dim ws-small" style={{ marginTop: 4 }}>
              The hub holds each one's record. Its key and its save are in the browser that made it: back it up there (SYSTEM, BACK UP THIS AVATAR), then RESTORE A BACKUP here.
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <Button tone="proof" onClick={() => setMode('birth')}>MINT A NEW AVATAR</Button>
          <Button tone="quiet" onClick={() => setMode('restore')}>RESTORE A BACKUP</Button>
        </div>
      </Panel>
      {/* Before the door picks a voice, the person sees what this machine can run (Q24) */}
      <VoicePanel style={{ width: 640 }} />
      </div>
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
