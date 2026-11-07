/**
 * THE HUB, from inside the game (DEPLOY.md): sign in to the hub this game is set to, register the
 * character in play under the account, and send its receipts. The game runs here; the hub only
 * checks. Every state has its own mark and words, so it reads without colour.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Button, Input, Panel } from './ui/kit';
import { HubClient, IHubCharacter, IHubWhere } from '../logic/hub/HubClient';
import { useIdentityStore } from '../entities/identity/store';
import { usePlayerStore } from '../entities/player/store';
import { useHubStore } from '../entities/hub/store';
import { PoolSection } from './PoolSection';

const STANDING: Record<IHubCharacter['standing'], string> = {
  GOOD: '[■] IN GOOD STANDING',
  CHALLENGED: '[!] CHALLENGED: THE HUB HOLDS A DIFFERENT HISTORY'
};

const whereLine = (w: IHubWhere | null) => {
  if (!w) return 'CHECKING';
  if (!w.configured) return '[ ] NO HUB SET';
  return w.signedIn ? `[■] SIGNED IN · ${w.signedIn}` : '[◆] NOT SIGNED IN';
};

export const HubPanel: React.FC<{ titled?: boolean }> = ({ titled = true }) => {
  const certificate = useIdentityStore(s => s.certificate);
  const [where, setWhere] = useState<IHubWhere | null>(null);
  const [mine, setMine] = useState<IHubCharacter | null>(null);
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');

  const refresh = useCallback(async () => {
    const w = await HubClient.where();
    setWhere(w);
    if (!w.signedIn || !certificate) { setMine(null); return; }
    const list = await HubClient.characters();
    setMine(list.characters?.find(c => c.uid === certificate.metadata.uid) ?? null);
  }, [certificate]);

  useEffect(() => { void refresh(); }, [refresh]);

  const work = async (label: string, job: () => Promise<string | void>) => {
    setBusy(label);
    setNote('');
    try {
      const said = await job();
      if (said) setNote(said);
    } finally {
      setBusy('');
      await refresh();
    }
  };

  const account = (make: boolean) => work(make ? 'MAKING THE ACCOUNT' : 'SIGNING IN', async () => {
    const h = handle.trim();
    const p = password;
    setPassword('');
    if (make) {
      const made = await HubClient.createAccount(h, p);
      if (!made.ok) return made.reason ?? 'The account was not made.';
    }
    const out = await HubClient.signIn(h, p);
    return out.ok ? undefined : (out.reason ?? 'Not signed in.');
  });

  return (
    <Panel title={titled ? 'THE HUB' : undefined} right={<span className="ws-dim ws-small">{whereLine(where)}</span>} style={{ whiteSpace: 'normal', maxWidth: '100%' }}>
      <div className="ws-small">This game runs on this machine. A hub keeps your account and checks your character's receipts; it does not run your play.</div>
      {where && !where.configured && <div className="ws-dim ws-small" style={{ marginTop: 6 }}>{where.reason}</div>}
      {where?.configured && <div className="ws-dim ws-small" style={{ marginTop: 6, overflowWrap: 'anywhere' }}>Hub: {where.url}</div>}

      {where?.configured && !where.signedIn && (
        <form style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }} onSubmit={e => { e.preventDefault(); void account(false); }}>
          <Input label="HANDLE" autoComplete="username" value={handle} onChange={e => setHandle(e.target.value)} />
          <Input label="PASSWORD" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Button type="submit" tone="signal" primary disabled={!!busy || !handle.trim() || !password}>SIGN IN</Button>
            <Button tone="quiet" disabled={!!busy || !handle.trim() || !password} onClick={() => void account(true)}>MAKE AN ACCOUNT</Button>
          </div>
        </form>
      )}

      {where?.signedIn && certificate && (
        <div style={{ marginTop: 8 }}>
          <div className="ws-bright">{certificate.metadata.displayName}</div>
          {!mine && (
            <>
              <div className="ws-small">[ ] Not registered on this hub.</div>
              <Button tone="signal" primary disabled={!!busy} style={{ marginTop: 6 }} onClick={() => work('REGISTERING', async () => {
                const out = await HubClient.register(certificate);
                return out.ok ? 'Registered. The hub signed its word for it.' : (out.reason ?? 'Not registered.');
              })}>REGISTER THIS CHARACTER</Button>
            </>
          )}
          {mine && (
            <>
              <div className="ws-small">{STANDING[mine.standing]}</div>
              <div className="ws-small">The hub holds {mine.held} of this character's receipts.</div>
              <Button tone="signal" primary disabled={!!busy} style={{ marginTop: 6 }} onClick={() => work('SENDING RECEIPTS', async () => {
                const out = await HubClient.sendReceipts(certificate.metadata.uid, () => usePlayerStore.getState().player.bank.gold);
                if (!out.ok) return out.reason ?? 'The receipts were not checked.';
                const rerun = out.rerun as { sessions: number; rolls: number; owed: number } | undefined;
                // The city's people go up with the receipts: each on a chain of their own, minted by the hub
                const city = useHubStore.getState().activeHubId;
                const people = city ? (await HubClient.sendPeople(city)).people ?? [] : [];
                const peopleHeld = people.filter(p => p.ok).length;
                return `Checked. The hub now holds ${out.held} and signed for it.${rerun ? ` It reran ${rerun.rolls} drop${rerun.rolls === 1 ? '' : 's'} from ${rerun.sessions} session${rerun.sessions === 1 ? '' : 's'}${rerun.owed ? `; ${rerun.owed} still owed` : ''}.` : ''}${people.length > 0 ? ` It checked ${peopleHeld} of ${people.length} people of this city.` : ''}`;
              })}>SEND RECEIPTS</Button>
            </>
          )}
        </div>
      )}

      {where?.signedIn && <PoolSection me={where.signedIn} />}

      {busy && <div className="ws-dim ws-small" style={{ marginTop: 6 }}>{busy}…</div>}
      {note && <div className="ws-small" style={{ marginTop: 6 }}>! {note}</div>}

      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        <Button tone="quiet" disabled={!!busy} onClick={() => work('CHECKING', async () => {})}>CHECK AGAIN</Button>
        {where?.signedIn && <Button tone="quiet" disabled={!!busy} onClick={() => work('SIGNING OUT', async () => { await HubClient.signOut(); })}>SIGN OUT</Button>}
      </div>
    </Panel>
  );
};
