/**
 * THE VAULT GATE (D31): no database, no game.
 *
 * At load: the game does not mount until the bank answers, and existing browser
 * saves have moved in. While playing: if the bank stops answering, this covers the
 * screen and holds the keys, everything waiting stays in order, and it lifts itself
 * when the bank returns. There is no fallback to browser storage, on purpose: a
 * second set of books is how data forks silently.
 *
 * A new file, standing outside the screens the usability pass is changing.
 */

import React, { useEffect, useState } from 'react';
import { StoreClient, useVault } from '../../shared/entities/data/StoreClient';
import { BrowserImport, IImportReport } from '../logic/persistence/BrowserImport';
import { Busy, Button, Panel } from './ui/kit';

const POLL_MS = 2000;

/** While the vault is closed, the field's keys go nowhere. Registered before the game's own listeners. */
function holdTheKeys(event: KeyboardEvent) {
  if (useVault.getState().status === 'CLOSED') event.stopImmediatePropagation();
}
window.addEventListener('keydown', holdTheKeys, true);
window.addEventListener('keyup', holdTheKeys, true);

// A commit still waiting for the bank exists only in this tab until it lands.
window.addEventListener('beforeunload', event => {
  if (useVault.getState().waiting > 0) event.preventDefault();
});

const Refusal: React.FC<{ midPlay: boolean }> = ({ midPlay }) => {
  const reason = useVault(s => s.reason);
  const waiting = useVault(s => s.waiting);
  const canCarry = useVault(s => s.canCarry);
  const [asked, setAsked] = useState(false);
  const [carrying, setCarrying] = useState(false);
  const [carried, setCarried] = useState<string[] | null>(null);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="vault-title"
      className="ws-ui"
      style={{ position: 'fixed', inset: 0, zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--ws-void-1)', padding: 24 }}
    >
      <Panel tone="loss" style={{ width: 560, maxWidth: '100%' }}>
        <div id="vault-title" className="ws-loss" style={{ fontSize: 'var(--ws-font-title)', letterSpacing: '0.2em' }}>THE VAULT IS NOT ANSWERING</div>
        <p className="ws-bright" style={{ margin: '12px 0 6px' }}>
          {midPlay
            ? 'The bank has stopped answering. Your last acts wait here, in order, and land when it returns.'
            : 'The bank will not open without its books.'}
        </p>
        <p className="ws-dim ws-small" style={{ margin: '0 0 6px' }}>
          {StoreClient.isLocal()
            ? 'Its books are kept in this browser, and it refuses rather than guess. Nothing has been changed, and nothing has been written anywhere else.'
            : 'It keeps no second set in this browser, so it refuses rather than guess. Nothing has been changed, and nothing has been written anywhere else.'}
        </p>
        {midPlay && waiting > 0 && (
          <p className="ws-loss ws-small" style={{ margin: '0 0 6px' }}>
            {waiting} {waiting === 1 ? 'entry waits' : 'entries wait'} for the bank, in this tab only. Closing it loses them.
          </p>
        )}
        <p className="ws-dim ws-small" style={{ margin: '0 0 6px' }}>
          {canCarry
            ? 'To open the vault, carry this save over. It writes a new database here and leaves the old file as it is.'
            : StoreClient.isLocal()
              ? 'To open the vault, do what the machine says below, then reload this page.'
              : <>To open the vault, start the server from the project folder: <span className="ws-bright">npm run dev</span></>}
        </p>
        <p className="ws-dim ws-small" style={{ margin: '0 0 12px', wordBreak: 'break-word' }}>The machine says: {reason ?? 'no answer'}</p>
        {carried && <pre className="ws-dim ws-small" style={{ margin: '0 0 12px', maxHeight: 160, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{carried.join('\n')}</pre>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {canCarry && (
            <Button
              tone="signal" primary disabled={carrying}
              onClick={async () => {
                setCarrying(true);
                const result = await StoreClient.carryOldSave();
                setCarried(result.lines);
                setCarrying(false);
                await StoreClient.checkVault();
              }}
            >
              {carrying ? 'CARRYING…' : 'CARRY THIS SAVE OVER'}
            </Button>
          )}
          <Button
            tone="signal" primary={!canCarry} autoFocus={!canCarry}
            onClick={async () => { setAsked(true); await StoreClient.checkVault(); setAsked(false); }}
          >
            {asked ? 'KNOCKING…' : 'KNOCK AGAIN'}
          </Button>
          <span className="ws-dim ws-small">The bank is asked again every few seconds, either way.</span>
        </div>
      </Panel>
    </div>
  );
};

const ImportRefusals: React.FC<{ report: IImportReport; onDone: () => void }> = ({ report, onDone }) => (
  <div className="ws-ui" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--ws-void-1)', padding: 24 }}>
    <Panel title="THE BANK REFUSED PART OF WHAT THIS BROWSER HELD" tone="loss" style={{ width: 640, maxWidth: '100%' }}>
      <p className="ws-dim ws-small" style={{ marginTop: 0 }}>
        {report.imported} documents moved into the bank's books and proved themselves. What is listed here failed its proof. It stayed in this browser, untouched.
      </p>
      <div className="ws-list" style={{ maxHeight: 280, overflow: 'auto' }}>
        {report.refused.map(r => (
          <div key={r.id} className="ws-row ws-small"><span className="ws-loss" style={{ wordBreak: 'break-all' }}>{r.id}</span>&nbsp;{r.reason}</div>
        ))}
        {report.notes.map(n => <div key={n} className="ws-row ws-small ws-dim">{n}</div>)}
      </div>
      <div style={{ marginTop: 12 }}>
        <Button tone="signal" primary autoFocus onClick={onDone}>UNDERSTOOD</Button>
      </div>
    </Panel>
  </div>
);

export const VaultGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const status = useVault(s => s.status);
  const [ready, setReady] = useState(false);
  const [report, setReport] = useState<IImportReport | null>(null);

  // Knock until the bank answers: at load, and whenever it stops answering.
  useEffect(() => {
    if (status === 'OPEN') return;
    void StoreClient.checkVault();
    const timer = setInterval(() => void StoreClient.checkVault(), POLL_MS);
    return () => clearInterval(timer);
  }, [status]);

  // The first time the bank answers: browser saves move in, once, before anything reads them.
  useEffect(() => {
    if (status !== 'OPEN' || ready) return;
    let stale = false;
    void BrowserImport.runOnce()
      .then(result => {
        if (stale) return;
        if (result?.notes.length) console.warn('[IMPORT]', result.notes.join(' '));
        if (result && result.refused.length > 0) setReport(result);
        setReady(true);
      })
      .catch(e => {
        // A failed import must not read as an empty bank: the game stays behind the gate.
        console.error('[IMPORT] The one-time import failed:', e);
        useVault.setState({ status: 'CLOSED', reason: `The import of this browser's saves failed: ${e?.message ?? e}` });
      });
    return () => { stale = true; };
  }, [status, ready]);

  if (!ready) {
    if (status === 'CLOSED') return <Refusal midPlay={false} />;
    return (
      <div className="ws-ui" style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--ws-void-1)' }}>
        <div style={{ width: 400 }}><Busy label="ASKING THE BANK" /></div>
      </div>
    );
  }

  if (report) return <ImportRefusals report={report} onDone={() => setReport(null)} />;

  return (
    <>
      {children}
      {status === 'CLOSED' && <Refusal midPlay />}
    </>
  );
};
