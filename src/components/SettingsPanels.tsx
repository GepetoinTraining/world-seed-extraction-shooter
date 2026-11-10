/**
 * CONFIGURATION AND ACCESSIBILITY (Pedro, 2026-11-10: "configuration (we'll have sound, believe me ... so
 * we need the volume), accessibility (font size, color blind type controls)").
 *
 * Both are the person's own settings on this device (src/logic/settings). They are drawn on the entry
 * view and again a step inside the game, under SYSTEM. Every state is said by a mark and a word: a
 * chosen row reads [■], an unchosen one [ ], whatever colour the screen is showing.
 */
import React, { useState } from 'react';
import { Button, Panel } from './ui/kit';
import { COLOUR_VISIONS, TEXT_PERCENT } from '../logic/settings/Settings';
import { useSettings } from '../logic/settings/store';
import { Sound } from '../logic/settings/Sound';

const KEPT = <span className="ws-dim ws-small">KEPT ON THIS DEVICE</span>;

const sliderRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 };
const slider: React.CSSProperties = { flex: 1, minWidth: 120, accentColor: 'var(--ws-signal-2)' };
const readout: React.CSSProperties = { minWidth: '5ch', textAlign: 'right' };

export const ConfigurationPanel: React.FC<{ style?: React.CSSProperties }> = ({ style }) => {
  const settings = useSettings(s => s.settings);
  const change = useSettings(s => s.change);
  const [heard, setHeard] = useState('');

  return (
    <Panel title="CONFIGURATION" right={KEPT} style={{ whiteSpace: 'normal', ...style }}>
      <div className="ws-small ws-dim">The game has no sound of its own yet. The volume is set here so that it is ready when sound arrives.</div>

      <div style={sliderRow}>
        <span className="ws-bright" style={{ minWidth: '9ch' }}>VOLUME</span>
        <input
          type="range" aria-label="Volume" min={0} max={100} step={5} value={settings.volume} style={slider}
          onChange={e => change({ volume: Number(e.target.value) })}
        />
        <span className="ws-bright" style={readout}>{settings.volume}%</span>
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button tone="quiet" aria-pressed={settings.muted} onClick={() => change({ muted: !settings.muted })}>
          {settings.muted ? 'MUTE: ON' : 'MUTE: OFF'}
        </Button>
        <Button
          tone="signal"
          onClick={async () => {
            if (settings.muted) { setHeard('Muted: nothing was played.'); return; }
            setHeard((await Sound.testTone()) ? `Two notes were played at ${settings.volume}%.` : 'This browser did not play a sound. Press it once more.');
          }}
        >
          TEST THE SOUND
        </Button>
        {heard && <span className="ws-small">{heard}</span>}
      </div>
    </Panel>
  );
};

export const AccessibilityPanel: React.FC<{ style?: React.CSSProperties }> = ({ style }) => {
  const settings = useSettings(s => s.settings);
  const change = useSettings(s => s.change);
  const moved = settings.colourVision !== 'full';

  return (
    <Panel title="ACCESSIBILITY" right={KEPT} style={{ whiteSpace: 'normal', ...style }}>
      <div className="ws-bright">TEXT SIZE</div>
      <div style={sliderRow}>
        <input
          type="range" aria-label="Text size" min={TEXT_PERCENT.min} max={TEXT_PERCENT.max} step={TEXT_PERCENT.step} value={settings.textPercent} style={slider}
          onChange={e => change({ textPercent: Number(e.target.value) })}
        />
        <span className="ws-bright" style={readout}>{settings.textPercent}%</span>
      </div>
      <div style={{ marginTop: 6 }}>A person has no name until it is asked.</div>
      <div className="ws-small ws-dim">The smallest text in the game, at this size. It never goes under the size it was drawn for.</div>

      <div className="ws-bright" style={{ marginTop: 16 }}>COLOUR VISION</div>
      <div className="ws-small ws-dim">Meaning in this game is carried by marks and position, never by colour alone. This moves colours apart for one kind of eye, across the whole screen.</div>
      <div className="ws-list" style={{ marginTop: 6 }}>
        {COLOUR_VISIONS.map(kind => {
          const chosen = kind.id === settings.colourVision;
          return (
            <Button
              key={kind.id} tone="quiet" aria-pressed={chosen}
              style={{ display: 'block', width: '100%', textAlign: 'left', whiteSpace: 'normal', height: 'auto', padding: '6px 8px', marginTop: 4, ...(chosen ? { borderLeft: '3px solid currentColor' } : {}) }}
              onClick={() => change({ colourVision: kind.id })}
            >
              <span className={chosen ? 'ws-bright' : undefined}>{chosen ? '[■]' : '[ ]'} {kind.name}</span>
              <span className="ws-small ws-dim" style={{ display: 'block', textTransform: 'none', letterSpacing: 0 }}>{kind.says}</span>
            </Button>
          );
        })}
      </div>

      <div style={sliderRow}>
        <span className={moved ? 'ws-bright' : 'ws-dim'} style={{ minWidth: '9ch' }}>STRENGTH</span>
        <input
          type="range" aria-label="Strength" min={0} max={100} step={10} value={settings.colourStrength} disabled={!moved} style={slider}
          onChange={e => change({ colourStrength: Number(e.target.value) })}
        />
        <span className={moved ? 'ws-bright' : 'ws-dim'} style={readout}>{settings.colourStrength}%</span>
      </div>

      <div style={{ display: 'flex', gap: 14, marginTop: 12, flexWrap: 'wrap' }} aria-label="The interface's three colours, as they are drawn now">
        {[
          { word: 'SIGNAL', mark: '►', css: 'ws-signal', fill: 'var(--ws-signal-3)' },
          { word: 'PROOF', mark: '◆', css: 'ws-proof', fill: 'var(--ws-proof-3)' },
          { word: 'LOSS', mark: '!', css: 'ws-loss', fill: 'var(--ws-loss-3)' }
        ].map(role => (
          <span key={role.word} className={role.css} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span aria-hidden style={{ display: 'inline-block', width: 28, height: 14, background: role.fill, border: '1px solid var(--ws-text-ghost)' }} />
            {role.mark} {role.word}
          </span>
        ))}
      </div>
      <div className="ws-small ws-dim" style={{ marginTop: 4 }}>How far each kind is moved is a first guess, made without that kind of eye to judge it.</div>
    </Panel>
  );
};
