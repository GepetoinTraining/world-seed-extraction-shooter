/**
 * THE TALK'S WINDOW (D113, D114). What was said on the left of the page, top to bottom; the meter
 * above it, with its lines marked by position, so where you stand reads without any colour. Each
 * round says plainly what it rolled, what it needed and what it moved, because the roll is on the
 * record and nobody should have to take it on trust.
 *
 * In the city the person's goal stands above the log once it is set, with the one want the board
 * holds for them under it (Q19). A monster's meter is cut into its three stances, and once it is
 * friendly, or once asked well, what it wants stands in the same place.
 *
 * Q50: a talk shows no cost. What a person can do besides talk is ask if they want something.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useTalk, meterOpensFollowing } from '../entities/interaction/talkStore';
import { TALK_ENERGY, TalkLaw } from '../logic/systems/TalkLaw';
import { worldDay } from '../entities/hub/worldDay';
import { TALK_MESSAGE_LIMIT } from '../../shared/logic/systems/TalkTypes';
import { usePlayerStore } from '../entities/player/store';
import { useHubStore } from '../entities/hub/store';
import { StatSystem } from '../../shared/logic/systems/StatSystem';
import { Busy, Button, Chip, Modal, Panel } from './ui/kit';

/** A 0 to 100 track with notches at what it opens: position and seam, never hue. */
const MeterTrack: React.FC<{ value: number; lines: { at: number; label: string }[] }> = ({ value, lines }) => (
  <div aria-label={`Regard ${value} of 100`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} style={{ position: 'relative', height: 26, marginBottom: 4 }}>
    <div style={{ position: 'absolute', left: 0, right: 0, top: 6, height: 8, border: '1px solid var(--ws-text-dim)' }} />
    <div style={{ position: 'absolute', left: 0, top: 6, height: 8, width: `${value}%`, background: 'var(--ws-text-bright)' }} />
    {lines.map(line => (
      <React.Fragment key={line.label}>
        <div style={{ position: 'absolute', left: `${line.at}%`, top: 2, height: 16, width: 0, borderLeft: '2px dashed var(--ws-text-bright)' }} />
        <div className="ws-dim" style={{ position: 'absolute', left: `${line.at}%`, top: 16, fontSize: 12, transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}>{line.label}</div>
      </React.Fragment>
    ))}
  </div>
);

export const TalkWindow: React.FC = () => {
  const { subject, title, ready, busy, log, rounds, meter, note, goal, stance, wants, named, say, give, bring, ask, askName, close } = useTalk();
  const cityId = subject?.kind === 'CITY' ? subject.npcId : null;
  const onTheBoard = useHubStore(s => cityId ? s.guild.quests.find(q => q.residentId === cityId && q.state === 'OPEN')?.text ?? null : null);
  const attributes = usePlayerStore(s => s.player.attributes);
  const session = usePlayerStore(s => s.player.currentSession);
  const [saying, setSaying] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { logRef.current?.scrollTo?.(0, logRef.current.scrollHeight); }, [log.length, busy]);
  useEffect(() => { if (subject) inputRef.current?.focus(); }, [subject]);
  // The screen it was opened on is gone: a death, a way out, another view. So is the talk.
  useEffect(() => () => useTalk.getState().close(), []);

  if (!subject) return null;

  const isMonster = subject.kind === 'MONSTER';
  const inTheField = subject.kind !== 'CITY';
  const line = StatSystem.recruitDisposition(attributes);
  const lines = isMonster
    ? [{ at: line, label: 'neutral' }, { at: Math.round(line + (100 - line) * 2 / 3), label: 'friendly' }]
    : subject.kind === 'FIELD_PERSON' ? [{ at: line, label: 'follows' }] : [];
  const last = rounds[rounds.length - 1];
  const marks = TalkLaw.dayMarks(log, worldDay());

  const send = async () => {
    const text = saying.trim();
    if (!text || busy) return;
    setSaying('');
    await say(text);
    inputRef.current?.focus();
  };

  return (
    <Modal title={isMonster ? `BARGAIN: ${title.toUpperCase()}` : `TALK: ${title.toUpperCase()}`} onClose={close} width={620}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="ws-row" style={{ alignItems: 'center' }}>
          <span className="ws-small">Regard {meter} of 100{stance ? ` · ${stance.toLowerCase()}` : ''}</span>
          {inTheField && <Chip title="What a round costs out of your day">{TALK_ENERGY} energy a round · {Math.floor(session?.energy ?? 0)} held</Chip>}
        </div>
        <MeterTrack value={meter} lines={lines} />

        {goal && (
          <Panel title="WHAT THEY ARE AFTER" right={<Chip title="The rung of the needs ladder they stand on">{goal.need}</Chip>}>
            <span className="ws-small">{goal.text}</span>
            {onTheBoard && <div className="ws-small" style={{ marginTop: 4 }}><b>ON THE BOARD: </b>{onTheBoard}</div>}
          </Panel>
        )}
        {isMonster && wants && (
          <Panel title="WHAT IT WANTS">
            <span className="ws-small">{wants}</span>
          </Panel>
        )}

        <div ref={logRef} style={{ height: 230, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, border: '1px solid var(--ws-text-dim)', padding: 8 }}>
          {log.length === 0 && <span className="ws-dim ws-small">Say something. Everything you say counts, and you can only say it once.</span>}
          {log.map((entry, i) => (
            <React.Fragment key={i}>
              {/* C13: where another day's lines start, a dashed rule says which day, so nothing old reads as today's */}
              {marks[i] && (
                <div className="ws-dim" role="separator" aria-label={marks[i]!} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, letterSpacing: '0.08em', flexShrink: 0 }}>
                  <span style={{ flex: 1, borderTop: '1px dashed var(--ws-text-dim)' }} />{marks[i]}<span style={{ flex: 1, borderTop: '1px dashed var(--ws-text-dim)' }} />
                </div>
              )}
              <div className="ws-small" style={entry.who === 'THEM' ? { paddingLeft: 24, textAlign: 'right' } : entry.who === 'NOTE' ? { fontStyle: 'italic' } : { paddingRight: 24 }}>
                {entry.who === 'THEM' ? <b>YOU: </b> : entry.who === 'NPC' ? <b>{title.toUpperCase()}: </b> : null}{entry.text}
              </div>
            </React.Fragment>
          ))}
          {busy && <Busy label={`${title} is thinking`} />}
        </div>

        {last && (
          <div className="ws-small" aria-label="The last round">
            Rolled {last.roll}{last.bonus !== 0 ? ` ${last.bonus > 0 ? '+' : '−'} ${Math.abs(last.bonus)}` : ''} against {last.required}: {last.landed ? 'it landed' : 'it missed'}, regard {last.delta >= 0 ? '+' : '−'}{Math.abs(last.delta)}. {last.by === 'FLOOR' ? 'No bonus: no voice judged it.' : `They took your words ${TalkLaw.tookAs(last.band)}.`}
          </div>
        )}
        {note && <div className="ws-dim ws-small" role="status">{note}</div>}

        <div style={{ display: 'flex', gap: 6 }}>
          <input
            ref={inputRef}
            className="ws-input"
            aria-label="What you say"
            value={saying}
            maxLength={TALK_MESSAGE_LIMIT}
            disabled={!ready}
            placeholder={isMonster ? 'Say something to it' : 'Say something'}
            style={{ flex: 1, minWidth: 0 }}
            onChange={e => setSaying(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void send(); } }}
          />
          <Button tone="signal" primary disabled={busy || !ready || !saying.trim()} onClick={() => void send()}>SAY IT</Button>
        </div>

        <div className="ws-row" style={{ flexWrap: 'wrap', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {/* A person has no name until it is asked, and this is the asking. It stands only while there is something to ask */}
            {subject.kind === 'FIELD_PERSON' && !named && (
              <Button tone="quiet" disabled={busy || !ready} onClick={() => void askName()}
                title={`Nobody has a name until it is asked. It takes ${TALK_ENERGY} energy, as a round does, and they give it.`}>
                ASK THEIR NAME
              </Button>
            )}
            <Button tone="quiet" disabled={busy || !ready} onClick={() => void ask()}
              title={inTheField ? `Your mind against theirs. It takes ${TALK_ENERGY} energy, as a round does.` : 'Your mind against theirs.'}>
              ASK IF THEY WANT SOMETHING
            </Button>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {inTheField && (session?.inventory.length ?? 0) > 0 && (
              <Button tone="quiet" disabled={busy} onClick={give} title="The least of what you carry goes">OFFER SOMETHING</Button>
            )}
            {subject.kind === 'FIELD_PERSON' && meterOpensFollowing(meter) && (
              <Button tone="proof" primary disabled={busy} onClick={bring}>THEY WILL COME</Button>
            )}
            {isMonster && <Chip title="It waits while you talk. Whatever is with it does not.">IT HOLDS WHILE YOU TALK</Chip>}
          </div>
        </div>
      </div>
    </Modal>
  );
};
