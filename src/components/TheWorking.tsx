/**
 * THE WORKING (Layer 4, D41; D58): on the character sheet, because it is yours.
 *
 * Pick elements and test them: what the set does shows at once and is fixed, and it
 * has no name until you rest. Known abilities sit beside them. Reads by position and
 * text, never hue. Resting in the field shows only if a minted skill lets you.
 */

import React, { useMemo, useState } from 'react';
import { usePlayerStore } from '../entities/player/store';
import { useWorldStore } from '../entities/world/store';
import { ContentRegistry } from '../../shared/logic/theme/ContentRegistry';
import { EffectSystem } from '../../shared/logic/systems/EffectSystem';
import { WeaveSystem } from '../logic/systems/WeaveSystem';
import { RestSystem } from '../logic/systems/RestSystem';
import { RestDoor } from '../logic/systems/RestDoor';
import { ProgressionSystem } from '../../shared/entities/player/systems/ProgressionSystem';
import { Button, Chip, Panel } from './ui/kit';

const ACT_WORDS: Record<string, string> = {
  damage: 'hurts what it reaches', control: 'slows what it reaches', heal: 'mends you', buff: 'quickens you',
  debuff: 'keeps hurting what it reaches', ward: 'wards you against the next blows'
};

export const TheWorking: React.FC = () => {
  const { player } = usePlayerStore();
  const world = useWorldStore();
  const [picked, setPicked] = useState<string[]>([]);
  const rank = ProgressionSystem.rankOf(player);

  const card = world.availableWorlds.find(w => w.id === world.activeWorldId);
  const elements = useMemo(() => {
    const theme = ContentRegistry.get(card?.themeId) ?? ContentRegistry.list()[0];
    const fromTheme = theme ? [...new Set(theme.abilities.flatMap(a => a.elements))] : [];
    return [...new Set([...fromTheme, ...Object.keys(player.reserves ?? {})])].sort();
  }, [card?.themeId, player.reserves]);

  const cap = WeaveSystem.capacity(player.attributes, player.equipment);
  const preview = picked.length > 0 ? WeaveSystem.weave(picked) : null;
  const receipt = preview ? EffectSystem.resolve(preview, { rank }, 'preview') : null;
  const canRestHere = !!player.currentSession && RestSystem.grantsFieldRest(player);
  const known = player.knownAbilities ?? [];
  const gifted = Object.values(player.skillGifts ?? {}).flat().filter(g => g.kind === 'active');

  const toggle = (e: string) => setPicked(p => (p.includes(e) ? p.filter(x => x !== e) : [...p, e]));
  const setCast = (activeCast: NonNullable<typeof player.activeCast> | undefined) =>
    usePlayerStore.setState(s => ({ player: { ...s.player, activeCast } }));
  const weaveId = preview?.id;

  if (elements.length === 0 && known.length === 0 && gifted.length === 0 && !canRestHere) return null;

  return (
    <Panel title="THE WORKING" right={<span className="ws-dim ws-small">a focus casts it</span>}>
      {elements.length > 0 && (
        <div style={{ display: 'grid', gap: 4 }}>
          {elements.map(e => (
            <label key={e} className="ws-row ws-small" style={{ cursor: 'pointer' }}>
              <span><input type="checkbox" checked={picked.includes(e)} onChange={() => toggle(e)} aria-label={`Weave ${e}`} /> {e}</span>
              <span className="ws-dim">{Math.floor(player.reserves?.[e] ?? 0)} of {cap}</span>
            </label>
          ))}
        </div>
      )}

      {preview && receipt && (
        <div className="ws-small" style={{ marginTop: 6 }}>
          <div>{(weaveId && player.weaveNames?.[weaveId]) ?? 'It has no name until you rest.'}</div>
          <div className="ws-dim">It {ACT_WORDS[preview.effect] ?? preview.effect}, by {preview.delivery}. It draws {WeaveSystem.aetherPerElement(preview, rank)} of each.</div>
          <div style={{ marginTop: 4 }}>
            <Button tone="signal" onClick={() => setCast({ kind: 'weave', elements: picked })}>SET TO THE FOCUS</Button>
          </div>
        </div>
      )}

      {known.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="ws-dim ws-small">WHAT YOU HAVE SEEN CAST</div>
          {known.map(id => {
            const ability = ContentRegistry.ability(id);
            if (!ability) return null;
            return (
              <div key={id} className="ws-row ws-small">
                <span>{ability.name}</span>
                <Button tone="quiet" onClick={() => setCast({ kind: 'ability', id })}>SET</Button>
              </div>
            );
          })}
        </div>
      )}

      {gifted.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="ws-dim ws-small">WHAT YOUR SKILLS GAVE</div>
          {gifted.map(g => (
            <div key={g.id} className="ws-row ws-small" title={g.blurb}>
              <span>{g.name}</span>
              <Button tone="quiet" onClick={() => setCast({ kind: 'gift', id: g.id })}>SET</Button>
            </div>
          ))}
        </div>
      )}

      {player.activeCast && (
        <div className="ws-row ws-small" style={{ marginTop: 6 }}>
          <Chip tone="proof">ON THE FOCUS</Chip>
          <Button tone="quiet" onClick={() => setCast(undefined)}>CLEAR</Button>
        </div>
      )}

      {canRestHere && (
        <div style={{ marginTop: 8 }}>
          <Button tone="signal" onClick={() => void RestDoor.sleep('FIELD')}>REST HERE</Button>
        </div>
      )}
    </Panel>
  );
};
