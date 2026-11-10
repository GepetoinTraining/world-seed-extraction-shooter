/**
 * API KEYS (Pedro, 2026-11-10): "API keys with an input form that has: + (add), provider (enum [the
 * labs]), skeleton of the start of each key type expected, dry run and test, accept".
 *
 * The providers are the rows of the door's options file, read from the door. The steps and their order
 * are KeyForm.ts. A key is held in this form only while it is being typed, in a password field, and it is
 * cleared on accept and on cancel: the door holds it after that, and the list below shows whose keys are
 * held, never a key.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Button, Input, Panel } from './ui/kit';
import { IDoorSettingStatus, IHeldKey, IKeyedOption, VoiceClient } from '../logic/intelligence/VoiceClient';
import { DoorTransport } from '../logic/intelligence/DoorTransport';
import { dryRun, keySkeleton } from '../../shared/intelligence/keyShape';
import { IKeyForm, canAccept, canTest, dried, emptyForm, picked, tested, typed } from '../logic/intelligence/KeyForm';

const modeLine = (s: IDoorSettingStatus | null) => {
  if (!s) return 'THE DOOR CANNOT BE REACHED';
  if (s.mode === 'off') return 'TURNED OFF ON THIS SERVER';
  if (s.mode === 'keyed') return `IN USE: ${s.option ?? s.provider}`;
  if (s.provider === 'local') return `IN USE: THIS MACHINE'S OWN MODEL`;
  return s.available ? "IN USE: THE SERVER'S OWN KEY" : 'NO VOICE YET';
};

export const KeysPanel: React.FC<{ style?: React.CSSProperties }> = ({ style }) => {
  const [offered, setOffered] = useState<IKeyedOption[]>([]);
  const [held, setHeld] = useState<IHeldKey[]>([]);
  const [status, setStatus] = useState<IDoorSettingStatus | null>(null);
  const [form, setForm] = useState<IKeyForm | null>(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');

  const refresh = useCallback(async () => {
    const [options, keys, now] = await Promise.all([VoiceClient.options(), VoiceClient.keys(), VoiceClient.status()]);
    setOffered(options?.keyed ?? []);
    setHeld(keys);
    setStatus(now);
  }, []);

  useEffect(() => { void VoiceClient.restore().then(refresh); }, [refresh]);

  const work = async (label: string, job: () => Promise<void>) => {
    setBusy(label);
    setNote('');
    try { await job(); } finally { setBusy(''); await refresh(); }
  };

  const option = form ? offered.find(o => o.id === form.optionId) ?? null : null;

  return (
    <Panel title="API KEYS" right={<span className="ws-dim ws-small">{modeLine(status)}</span>} style={{ whiteSpace: 'normal', ...style }}>
      <div className="ws-small ws-dim">
        {DoorTransport.isPage()
          ? 'A key stays in this browser, sealed, and goes only to its own provider, never to our servers.'
          : 'A key goes to this machine\'s own server and stays in its memory. It is never kept in this browser, and stopping the game forgets it.'}
      </div>

      <div className="ws-list" style={{ marginTop: 8 }}>
        {held.length === 0 && <div className="ws-small">No key is held.</div>}
        {held.map(k => (
          <div key={k.optionId} className="ws-row" style={k.inUse ? { borderLeft: '3px solid currentColor', paddingLeft: 6 } : undefined}>
            <span className={k.inUse ? 'ws-bright' : undefined} style={{ minWidth: 0 }}>{k.inUse ? '► ' : ''}{k.name}<span className="ws-dim ws-small" style={{ whiteSpace: 'nowrap' }}> · {k.inUse ? 'IN USE' : 'HELD'}</span></span>
            <span style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              {!k.inUse && (
                <Button tone="signal" disabled={!!busy} style={{ whiteSpace: 'nowrap' }} onClick={() => work('CHOOSING', async () => {
                  const out = await VoiceClient.useHeld(k.optionId);
                  if (!out?.ok) setNote(out?.reason ?? 'The door cannot be reached.');
                })}>USE</Button>
              )}
              <Button tone="quiet" disabled={!!busy} style={{ whiteSpace: 'nowrap' }} onClick={() => work('FORGETTING', async () => { await VoiceClient.forgetKey(k.optionId); })}>FORGET</Button>
            </span>
          </div>
        ))}
      </div>

      {!form && (
        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          <Button tone="signal" primary disabled={!!busy || offered.length === 0} onClick={() => { setNote(''); setForm(emptyForm(offered[0]?.id ?? '')); }}>+ ADD A KEY</Button>
          {status && status.mode !== 'auto' && status.mode !== 'off' && (
            <Button tone="quiet" disabled={!!busy} onClick={() => work('RESETTING', async () => { await VoiceClient.useAuto(); })}>USE NO KEY OF MINE</Button>
          )}
        </div>
      )}
      {!form && offered.length === 0 && <div className="ws-small" style={{ marginTop: 6 }}>This server offers no provider to add a key for.</div>}

      {form && option && (
        <div style={{ marginTop: 10, borderTop: '1px dashed var(--ws-void-3)', paddingTop: 8 }}>
          <div className="ws-ui ws-field">
            <label>
              PROVIDER
              <select
                className="ws-ui ws-input" aria-label="Provider" value={form.optionId} disabled={!!busy}
                onChange={e => setForm(picked(form, e.target.value))}
              >
                {offered.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
          </div>
          {option.free && <div className="ws-dim ws-small">Cost: {option.free}</div>}
          {option.card && <div className="ws-dim ws-small">Card needed: {option.card}</div>}
          {option.data && <div className="ws-dim ws-small">What is sent: {option.data}</div>}
          {option.checked && <div className="ws-dim ws-small">Terms read {option.checked}.</div>}

          <div style={{ marginTop: 8 }}>
            A KEY FROM HERE LOOKS LIKE <span className="ws-bright" style={{ letterSpacing: '0.04em' }}>{keySkeleton(option)}</span>
            {option.keyPage && <> · <a className="ws-small" href={option.keyPage} target="_blank" rel="noreferrer noopener">GET A KEY ↗</a></>}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}>
            <Input
              type="password" autoComplete="off" spellCheck={false} aria-label="Key" placeholder={keySkeleton(option)}
              value={form.text} onChange={e => setForm(typed(form, e.target.value))} style={{ flex: 1, minWidth: 220 }}
            />
          </div>

          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <Button tone="quiet" disabled={!!busy || !canTest(form)} title="Reads what was pasted, on this machine. Nothing is sent."
              onClick={() => setForm(dried(form, dryRun(option, offered, form.text)))}>1 DRY RUN</Button>
            <Button tone="signal" disabled={!!busy || !canTest(form)} title="Asks the provider once whether it takes this key. Nothing is held."
              onClick={() => work(`ASKING ${option.name}`, async () => {
                const asked = form;
                const out = await VoiceClient.testKey(asked.optionId, asked.text);
                setForm(current => (current && current.text === asked.text && current.optionId === asked.optionId
                  ? tested(current, out ?? { ok: false, reason: 'The door cannot be reached.' })
                  : current));
              })}>2 TEST</Button>
            <Button tone="signal" primary disabled={!!busy || !canAccept(form)} title="Holds the key and puts it in use. Open once the test has passed."
              onClick={() => work('ACCEPTING', async () => {
                const accepted = form;
                setForm(null);
                const out = await VoiceClient.useKey(accepted.optionId, accepted.text);
                // Taken, the list above says so. Not taken, the reason is said.
                if (!out?.ok) setNote(out?.reason ?? 'The door cannot be reached.');
              })}>3 ACCEPT</Button>
            <Button tone="quiet" disabled={!!busy} onClick={() => setForm(null)}>CANCEL</Button>
          </div>

          {form.dry && (
            <div style={{ marginTop: 8 }}>
              <div className="ws-bright">{form.dry.ok ? '[■] DRY RUN: IT LOOKS RIGHT' : '[ ] DRY RUN: LOOK AGAIN'}</div>
              {form.dry.says.map((line, i) => <div key={i} className="ws-small">{line}</div>)}
            </div>
          )}
          {form.tested && (
            <div style={{ marginTop: 8 }}>
              <div className="ws-bright">{form.tested.ok ? `[■] TEST: ${option.name} TOOK THE KEY` : '[ ] TEST: THE KEY WAS NOT TAKEN'}</div>
              <div className="ws-small">{form.tested.ok ? 'Nothing is held yet. ACCEPT puts it in use.' : (form.tested.reason ?? 'No reason was given.')}</div>
            </div>
          )}
        </div>
      )}

      {busy && <div className="ws-dim ws-small" style={{ marginTop: 6 }}>{busy}…</div>}
      {note && <div className="ws-small" style={{ marginTop: 6 }}>! {note}</div>}
    </Panel>
  );
};
