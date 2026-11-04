/**
 * THE POOL, from inside the game (server/hub/pool.ts): a hub's shared work, in turns, on each
 * member's own voice. The player sees who is in it, with what, how many jobs each has done and
 * what each has spent, and can leave at any time. Marks and words carry meaning, never hue.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Button } from './ui/kit';
import { HubClient, IPoolMember } from '../logic/hub/HubClient';
import { PoolWorker } from '../logic/hub/PoolWorker';
import { VoiceClient } from '../logic/intelligence/VoiceClient';

const VOICE_WORDS: Record<IPoolMember['voice'], string> = { keyed: 'OWN KEY', local: 'OWN MACHINE' };

export const PoolSection: React.FC<{ me: string }> = ({ me }) => {
  const [members, setMembers] = useState<IPoolMember[]>([]);
  const [says, setSays] = useState('');
  const [voice, setVoice] = useState<'keyed' | 'local' | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [pool, status] = await Promise.all([HubClient.pool(), VoiceClient.status()]);
    setMembers(pool.members ?? []);
    setSays(pool.says ?? '');
    setVoice(status?.mode === 'keyed' ? 'keyed' : status?.provider === 'local' && status.available ? 'local' : null);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const inPool = members.some(m => m.handle === me);
  const act = async (job: () => Promise<string | void>) => {
    setBusy(true);
    setNote('');
    try { const said = await job(); if (said) setNote(said); } finally { setBusy(false); await refresh(); }
  };

  return (
    <div style={{ marginTop: 10, borderTop: '1px dashed var(--ws-void-3)', paddingTop: 8 }}>
      <div className="ws-bright ws-small" style={{ letterSpacing: '0.08em' }}>THE POOL</div>
      <div className="ws-small">Work written for everyone here (a world's passes, the chain) goes round the players in the pool, one job each in turn, on each one's own key or own machine. The more of you, the less each pays. What comes back is checked by the hub like anything else.</div>

      {members.length > 0 && (
        <div className="ws-list" style={{ marginTop: 6 }}>
          {members.map(m => (
            <div key={m.handle} className="ws-small">
              {m.online ? '[■]' : '[ ]'} {m.handle === me ? '► ' : ''}{m.handle} · {VOICE_WORDS[m.voice]} · {m.jobsDone} {m.jobsDone === 1 ? 'job' : 'jobs'} · ${m.spentUsd.toFixed(2)} spent{m.online ? '' : ' · away'}
            </div>
          ))}
          {says && <div className="ws-dim ws-small">{says}</div>}
        </div>
      )}
      {members.length === 0 && <div className="ws-dim ws-small" style={{ marginTop: 6 }}>Nobody is in the pool here yet.</div>}

      <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        {!inPool && (
          <Button tone="signal" disabled={busy || !voice} title={voice ? undefined : 'Choose a voice first, under THE VOICE: your own key, or a model on this machine.'} onClick={() => act(async () => {
            const out = await HubClient.joinPool(voice!);
            if (!out.ok) return out.reason ?? 'Not joined.';
            PoolWorker.start();
            return voice === 'keyed' ? 'In the pool, on your own key. Your turns are spent on it.' : 'In the pool, on this machine\'s model. Your turns cost you nothing.';
          })}>{voice === 'keyed' ? 'JOIN WITH MY KEY' : voice === 'local' ? 'JOIN WITH THIS MACHINE' : 'JOIN THE POOL'}</Button>
        )}
        {inPool && (
          <Button tone="quiet" disabled={busy} onClick={() => act(async () => {
            PoolWorker.stop();
            const out = await HubClient.leavePool();
            return out.ok ? 'Out of the pool. A job you held goes back for another turn.' : out.reason;
          })}>LEAVE THE POOL</Button>
        )}
      </div>
      {!voice && !inPool && <div className="ws-dim ws-small" style={{ marginTop: 4 }}>To join, choose a voice under THE VOICE: your own key, or a model on this machine.</div>}
      {note && <div className="ws-small" style={{ marginTop: 6 }}>! {note}</div>}
    </div>
  );
};
