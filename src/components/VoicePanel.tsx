/**
 * THE VOICE: what this machine can run, said plainly, and the person's choice of it. Pedro: "be
 * honest with them, if they can't run a local model they need to insert a key, and we can actually
 * give them free options to pick from", and "the choice should be the players".
 *
 * Every model the local runtime serves can be chosen, however large; the panel says how it would
 * sit and how it fared, and refuses nothing. Meaning is carried by words and marks, never by hue.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Button, Input, Modal, Panel } from './ui/kit';
import { IDoorSettingStatus, IKeyedOption, IMachineReading, VoiceClient } from '../logic/intelligence/VoiceClient';

const GB = 1_000_000_000;
const size = (bytes: number) => `${(bytes / GB).toFixed(1)} GB`;

/** Each verdict has its own mark, so it reads without colour. */
export const VERDICT_WORDS: Record<IMachineReading['verdict'], { mark: string; words: string }> = {
  READY: { mark: '[■]', words: 'RUNS HERE' },
  CAN_RUN: { mark: '[◆]', words: 'CAN RUN HERE' },
  NEEDS_KEY: { mark: '[ ]', words: 'NEEDS A KEY' }
};

const SEAT_SHORT: Record<string, string> = {
  CARD: 'on the card',
  CARD_AND_MEMORY: 'card and memory, slower',
  MEMORY: 'memory only, slow',
  TOO_BIG: 'larger than this machine',
  UNKNOWN: 'fit unknown'
};

const modeLine = (s: IDoorSettingStatus | null) => {
  if (!s) return 'THE DOOR CANNOT BE REACHED';
  if (s.mode === 'off') return 'TURNED OFF ON THIS SERVER';
  if (s.mode === 'keyed') return `A KEY · ${s.option ?? s.provider}`;
  if (s.provider === 'local') return `THIS MACHINE · ${s.model ?? 'no model chosen'}`;
  return s.available ? "THE SERVER'S KEY" : 'NO VOICE';
};

export const VoicePanel: React.FC<{ style?: React.CSSProperties; titled?: boolean }> = ({ style, titled = true }) => {
  const [reading, setReading] = useState<IMachineReading | null>(null);
  const [status, setStatus] = useState<IDoorSettingStatus | null>(null);
  const [keyed, setKeyed] = useState<IKeyedOption[]>([]);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const [showKeys, setShowKeys] = useState(false);

  const refresh = useCallback(async () => {
    const [m, s, o] = await Promise.all([VoiceClient.machine(), VoiceClient.status(), VoiceClient.options()]);
    setReading(m && 'verdict' in m ? m : null);
    setStatus(s);
    setKeyed(o?.keyed ?? []);
  }, []);

  useEffect(() => { void VoiceClient.restore().then(refresh); }, [refresh]);

  const work = async (label: string, job: () => Promise<void>) => {
    setBusy(label);
    setNote('');
    try { await job(); } finally { setBusy(''); await refresh(); }
  };

  const verdict = reading ? VERDICT_WORDS[reading.verdict] : null;
  const needsKey = reading?.verdict === 'NEEDS_KEY';

  return (
    <Panel title={titled ? 'THE VOICE' : undefined} right={<span className="ws-dim ws-small">{modeLine(status)}</span>} style={{ whiteSpace: 'normal', maxWidth: '100%', ...style }}>
      {!reading && <div className="ws-dim ws-small">The check on this machine could not be read.</div>}
      {reading && verdict && (
        <>
          <div className="ws-bright" style={{ letterSpacing: '0.08em' }}>{verdict.mark} {verdict.words}</div>
          {reading.says.map((line, i) => <div key={i} className="ws-small" style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{line}</div>)}

          {reading.served.length > 0 && (
            <div className="ws-list" style={{ marginTop: 8 }}>
              {reading.served.map(m => {
                const chosen = m.name === reading.chosen && status?.provider === 'local';
                const tried = reading.tried.find(t => t.model === m.name);
                return (
                  <div key={m.name} className="ws-row" style={chosen ? { borderLeft: '3px solid currentColor', paddingLeft: 6 } : undefined}>
                    <span style={{ minWidth: 0 }}>
                      <span className={chosen ? 'ws-bright' : undefined}>{chosen ? '► ' : ''}{m.name}</span>
                      <span className="ws-dim ws-small" style={{ display: 'block' }}>
                        {size(m.bytes)}{m.parameters ? ` · ${m.parameters}` : ''} · {SEAT_SHORT[m.seat]}
                        {tried ? ` · tried: ${tried.answered ? `answered in ${(tried.ms / 1000).toFixed(1)} s${tried.heldShape ? ', held the shape' : ', missed the shape'}` : 'no answer'}` : ''}
                      </span>
                    </span>
                    <span style={{ display: 'flex', gap: 6 }}>
                      <Button tone="quiet" disabled={!!busy} onClick={() => work(`TRYING ${m.name}`, async () => { await VoiceClient.tryModel(m.name); })}>TRY</Button>
                      <Button tone="signal" primary={!chosen} disabled={!!busy || chosen} onClick={() => work('CHOOSING', async () => { await VoiceClient.useLocal(m.name); })}>
                        {chosen ? 'IN USE' : 'USE'}
                      </Button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {reading.runtime.state === 'RUNNING' && reading.suggested && !reading.suggested.served && (
            <div style={{ marginTop: 8 }}>
              <Button tone="signal" disabled={!!busy} onClick={() => work(`PULLING ${reading.suggested!.model}`, async () => {
                const out = await VoiceClient.pull(reading.suggested!.model);
                if (!out?.ok) setNote(out?.reason ?? 'The pull did not finish.');
              })}>
                PULL {reading.suggested.model} · {size(reading.suggested.bytes)} DOWNLOAD
              </Button>
            </div>
          )}
        </>
      )}

      {busy && <div className="ws-dim ws-small" style={{ marginTop: 6 }}>{busy}…</div>}
      {note && <div className="ws-small" style={{ marginTop: 6 }}>! {note}</div>}

      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        <Button tone="quiet" disabled={!!busy} onClick={() => work('CHECKING', async () => {})}>CHECK AGAIN</Button>
        {!needsKey && <Button tone="quiet" aria-pressed={showKeys} onClick={() => setShowKeys(!showKeys)}>{showKeys ? 'HIDE THE KEYS' : 'OR USE A KEY'}</Button>}
        {status && status.mode !== 'auto' && status.mode !== 'off' && (
          <Button tone="quiet" disabled={!!busy} onClick={() => work('RESETTING', async () => { await VoiceClient.useAuto(); })}>THE SERVER'S OWN WAY</Button>
        )}
      </div>

      {(needsKey || showKeys) && (
        <div style={{ marginTop: 10, borderTop: '1px dashed var(--ws-void-3)', paddingTop: 8 }}>
          <div className="ws-small">
            {keyed.length === 0 ? 'This server offers no keyed options.' : 'Free options. A key goes to this machine\'s server and stays there; it is never kept in this browser, and a restart forgets it.'}
          </div>
          <div className="ws-list" style={{ marginTop: 6 }}>
            {keyed.map(option => (
              <div key={option.id} style={{ padding: '4px 0' }}>
                <div className="ws-row">
                  <span className={open === option.id ? 'ws-bright' : undefined}>{open === option.id ? '▾ ' : '▸ '}{option.name}</span>
                  <Button tone="quiet" aria-expanded={open === option.id} onClick={() => { setOpen(open === option.id ? null : option.id); setKey(''); }}>{open === option.id ? 'CLOSE' : 'PICK'}</Button>
                </div>
                {option.free && <div className="ws-dim ws-small">Free: {option.free}</div>}
                {option.card && <div className="ws-dim ws-small">Card needed: {option.card}</div>}
                {option.data && <div className="ws-dim ws-small">What is sent: {option.data}</div>}
                {option.checked && <div className="ws-dim ws-small">Terms read {option.checked}.</div>}
                {open === option.id && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                    {option.keyPage && <a className="ws-small" href={option.keyPage} target="_blank" rel="noreferrer noopener">GET A KEY ↗</a>}
                    <Input type="password" autoComplete="off" placeholder="paste the key" value={key} onChange={e => setKey(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
                    <Button tone="signal" primary disabled={!!busy || !key.trim()} onClick={() => work('CHECKING THE KEY', async () => {
                      const sent = key;
                      setKey('');
                      const out = await VoiceClient.useKey(option.id, sent);
                      setNote(out?.ok ? `${option.name} answers.` : (out?.reason ?? 'The door cannot be reached.'));
                    })}>USE THIS KEY</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
};

/**
 * The verdict in a word, where a person meets the door first (creation asks it before anything
 * else), and the whole panel a click away.
 */
export const VoiceChip: React.FC = () => {
  const [reading, setReading] = useState<IMachineReading | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { void VoiceClient.restore().then(() => VoiceClient.machine()).then(m => setReading(m && 'verdict' in m ? m : null)); }, [open]);
  const verdict = reading ? VERDICT_WORDS[reading.verdict] : null;
  return (
    <>
      <Button tone="quiet" onClick={() => setOpen(true)} title="What this machine can run, and the choice of voice">
        {verdict ? `${verdict.mark} VOICE: ${verdict.words}` : 'THE VOICE'}
      </Button>
      {open && (
        <Modal title="THE VOICE" onClose={() => setOpen(false)} width={660}>
          <VoicePanel titled={false} />
        </Modal>
      )}
    </>
  );
};
