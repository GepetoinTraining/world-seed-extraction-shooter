/**
 * THE CREATION FLOW (D35-D37): who you were, what you carry, the face of the world, the
 * conversation. One screen each, and under a minute if you know what you want: everything
 * after the first choice comes chosen, and a person only has to agree.
 *
 * The bank's ids and the kind of story this is stay out of sight. The Seed speaks through
 * the terminal, in the bank's voice (D36). Nothing here chooses the face: that comes from
 * the certificate, and the person meets it after the mint.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { BiomeType } from '../entities/world/types';
import { WorldCertificateSystem, WorldType } from '../entities/world/WorldCertificate';
import { WorldGenerator } from '../entities/world/WorldGenerator';
import { HubGenerator } from '../entities/hub/HubGenerator';
import { firstPlan } from '../entities/hub/hubManifest';
import { VectorStore, VectorNamespace } from '../entities/data/VectorStore';
import { OriginBank, SILHOUETTES } from '../logic/content/OriginBank';
import { CreationDoor } from '../logic/systems/CreationDoor';
import { CreationSystem, ICreationSheet, ICreationWords } from '../logic/systems/CreationSystem';
import { FREE_DEED_SIZE, WorldDeed } from '../logic/systems/WorldDeed';
import { ContentRegistry } from '../logic/theme/ContentRegistry';
import { ThemeStore } from '../logic/theme/ThemeStore';
import { IDoorUsage } from '../logic/intelligence/IntelligenceClient';
import { Sprite, gearMaterial, hashBytes, itemArt } from '../render/atoms/atoms';
import { cityMinimap } from '../render/atoms/minimap';
import { Archetype, figure } from '../render/atoms/people';
import { RECON_CELL_ATOMS, reconCell } from '../render/atoms/recon';
import { useCreationDraft } from './ui/creationDraft';
import { ArmedButton, Busy, Button, Input, Panel, SpriteView } from './ui/kit';
import { ThemePreview } from './ThemeTalk';

const STEPS = ['WHO YOU WERE', 'WHAT YOU CARRY', 'THE FACE OF THE WORLD', 'THE SEED', 'THE SIGNATURE'];

const SILHOUETTE_LINES: Record<string, string> = {
  OPERATOR: 'Reads the machine. Pack and antenna; the terminal answers faster.',
  STREET_SAMURAI: 'Angular shoulders, a topknot, and no patience for locked doors.',
  NOMAD: 'Hood and cloak. Walks out of places others are carried out of.',
  ARCANIST: 'Robe and halo. Asks the Seed directly and sometimes it answers.'
};

const encoder = new TextEncoder();
const attr = (a: string) => a.replace(/_/g, ' ').toUpperCase();

/** A choice says so by a mark and a seam, never by hue alone. */
const Choice: React.FC<{ chosen: boolean; onPick: () => void; children: React.ReactNode; title?: string }> = ({ chosen, onPick, children, title }) => (
  <button
    type="button" onClick={onPick} aria-pressed={chosen} title={title} className="ws-ui"
    style={{
      display: 'flex', gap: 10, alignItems: 'flex-start', textAlign: 'left', cursor: 'pointer', width: '100%',
      background: chosen ? 'var(--ws-signal-0)' : 'var(--ws-void-2)',
      border: `1px solid ${chosen ? 'var(--ws-signal-2)' : 'var(--ws-void-4)'}`,
      borderLeft: chosen ? '4px double var(--ws-signal-2)' : '1px solid var(--ws-void-4)',
      padding: 8, color: 'inherit', fontFamily: 'var(--ws-mono)'
    }}
  >
    <span className={chosen ? 'ws-signal' : 'ws-dim'} aria-hidden style={{ flex: 'none' }}>{chosen ? '[X]' : '[ ]'}</span>
    <span style={{ minWidth: 0, flex: 1 }}>{children}</span>
  </button>
);

const Stepper: React.FC<{ at: number }> = ({ at }) => (
  <div className="ws-small" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
    {STEPS.map((s, i) => (
      <span key={s} className={i === at ? 'ws-bright' : 'ws-dim'} style={i === at ? { borderBottom: '2px solid currentColor' } : undefined}>{i + 1} {s}</span>
    ))}
  </div>
);

/** A thing a kit holds, drawn from its own tags at one cell. The real roll comes at the mint. */
const pieceArt = (definitionId: string, tags: string[]): Sprite => itemArt({
  wCells: 1, hCells: 1, tags, material: gearMaterial(tags), rarity: 'COMMON', rank: 'F', identified: true,
  seed: hashBytes(encoder.encode(definitionId))
});

/** A world of this kind, as recon would draw it. Land is a pure function of a seed, so this is real land. */
const landThumb = (seed: string): Sprite => {
  const size = FREE_DEED_SIZE;
  const map = WorldGenerator.generate(seed, size);
  const s = RECON_CELL_ATOMS;
  const w = size * s, h = size * s;
  const data = new Uint8Array(w * h);
  for (const sector of Object.values(map.sectors)) {
    const cell = reconCell({ biome: sector.biome as BiomeType, scanLevel: 1, seed, sx: sector.x, sy: sector.y });
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) data[(sector.y * s + y) * w + sector.x * s + x] = cell.data[y * s + x];
  }
  return { w, h, data };
};

interface IHubFace { id: string; name: string; description: string; thumb: Sprite }

/** The hubs a new arrival may be offered, each drawn from its own plan. With none yet, the one that will be raised. */
async function loadHubFaces(): Promise<IHubFace[]> {
  const draw = (plan: Parameters<typeof HubGenerator.generate>[0]) => {
    const layout = HubGenerator.generate(plan);
    return cityMinimap(layout, {}, { x: Math.floor(layout.width / 2), y: Math.floor(layout.height / 2) });
  };
  try {
    const worlds = (await WorldCertificateSystem.getPublicWorlds()).filter(w => w.data.worldType === WorldType.HUB);
    return await Promise.all(worlds.map(async w => {
      const doc = await VectorStore.get<{ chunks?: never; dismembered?: never }>(VectorNamespace.TERRITORIES, `hub_state_${w.data.worldUid}`);
      const plan = doc?.data?.chunks ? { chunks: doc.data.chunks, dismembered: doc.data.dismembered ?? [] } : firstPlan();
      return { id: w.data.worldUid, name: w.data.worldName, description: w.data.worldDescription, thumb: draw(plan) };
    }));
  } catch {
    return [];
  }
}

export const CreationFlow: React.FC<{
  onMint: (name: string, sheet: ICreationSheet) => void | Promise<void>;
  creating: boolean;
  error: string | null;
  /** The ways out of this screen that are the gate's own: back to select, restore. */
  aside?: React.ReactNode;
}> = ({ onMint, creating, error, aside }) => {
  const { draft, set, reset } = useCreationDraft();
  const { step, originId, kitId, silhouette, hubId, themeId, answers, said, name, grant } = draft;
  const origin = OriginBank.origin(originId);
  const [asking, setAsking] = useState(false);
  const [hubs, setHubs] = useState<IHubFace[] | null>(null);
  const [themesLoaded, setThemesLoaded] = useState(0);

  // A choice that changes what was said makes what was granted stale
  const choose = (patch: Partial<typeof draft>) => set({ ...patch, grant: null });

  const questions = useMemo(() => (originId ? CreationSystem.questionsFor(originId) : []), [originId]);
  const offeredThemes = useMemo(() => ContentRegistry.offered(), [step, themesLoaded]);
  const nextQuestion = questions.find(q => !answers[q.id]);

  useEffect(() => {
    if (step !== 2 || hubs) return;
    let live = true;
    void loadHubFaces().then(found => {
      if (!live) return;
      // No hub yet: the first arrival raises this one at boot, so it is the face they meet
      const layout = HubGenerator.generate(firstPlan());
      setHubs(found.length > 0 ? found : [{
        id: '', name: 'New Carleon', description: 'The last bastion of humanity. Trade, rest, and prepare for the drop.',
        thumb: cityMinimap(layout, {}, { x: Math.floor(layout.width / 2), y: Math.floor(layout.height / 2) })
      }]);
    });
    void ThemeStore.loadBanked().then(() => { if (live) setThemesLoaded(n => n + 1); }).catch(() => undefined);
    return () => { live = false; };
  }, [step, hubs]);

  // What a person who knows what they want agrees to by pressing on
  useEffect(() => {
    if (step !== 2) return;
    const patch: Partial<typeof draft> = {};
    if (hubs?.length && !hubs.some(h => h.id === hubId)) patch.hubId = hubs[0].id;
    if (offeredThemes.length && !offeredThemes.some(t => t.themeId === themeId)) patch.themeId = offeredThemes[0].themeId;
    if (Object.keys(patch).length > 0) set(patch);
  }, [step, hubs, offeredThemes, hubId, themeId]);

  const pickOrigin = (id: string) => {
    const picked = OriginBank.origin(id)!;
    choose({ originId: id, kitId: picked.kits[0], silhouette: picked.silhouette, answers: {} });
  };

  const hear = async () => {
    setAsking(true);
    const out = await CreationDoor.seek({ originId, kitId, silhouette, hubId, themeId, answers, said });
    setAsking(false);
    // A person who stopped waiting has moved on, and what arrives late changes nothing
    if (useCreationDraft.getState().draft.step !== 3) return;
    set({ grant: { words: out.words, by: out.by, usage: out.usage ?? null }, step: 4 });
  };

  const stopWaiting = () => {
    setAsking(false);
    const words = CreationSystem.floor({ originId, kitId, silhouette, hubId, themeId, answers, said });
    set({ grant: { words, by: 'FLOOR', usage: null }, step: 4 });
  };

  const nav = (canGo: boolean, nextLabel: string, onNext?: () => void) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
      <span style={{ display: 'flex', gap: 6 }}>
        {step > 0 && <Button tone="quiet" onClick={() => set({ step: step - 1 })}>BACK</Button>}
        <ArmedButton tone="quiet" confirmLabel="PRESS AGAIN TO FORGET THIS DRAFT" onConfirm={reset}>START OVER</ArmedButton>
      </span>
      {onNext && <Button tone="signal" primary disabled={!canGo} onClick={onNext}>{nextLabel}</Button>}
    </div>
  );

  const words: ICreationWords | null = (grant?.words as ICreationWords) ?? null;

  return (
    <Panel title="GENESIS PROTOCOL" right={aside} style={{ width: 760, maxHeight: '94vh', overflowY: 'auto' }}>
      <Stepper at={step} />

      {step === 0 && (
        <div>
          <div className="ws-dim ws-small" style={{ marginBottom: 8 }}>Before this. It is the only thing the bank will ever ask about it.</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {OriginBank.origins().map(o => (
              <Choice key={o.id} chosen={o.id === originId} onPick={() => pickOrigin(o.id)}>
                <span className="ws-bright" style={{ display: 'block', letterSpacing: '0.04em' }}>{o.says}</span>
                <span className="ws-dim ws-small" style={{ display: 'block' }}>{o.line}</span>
                {o.main && <span className="ws-small" style={{ display: 'block', marginTop: 2 }}>{attr(o.main)}, THEN {attr(o.sub!)}</span>}
                {!o.main && <span className="ws-small" style={{ display: 'block', marginTop: 2 }}>WHATEVER THE CERTIFICATE DEALS YOU</span>}
              </Choice>
            ))}
          </div>
          {origin && (
            <>
              <div className="ws-dim ws-small" style={{ margin: '12px 0 6px', letterSpacing: '0.08em' }}>THE SHAPE YOU WEAR. THE FACE COMES FROM THE CERTIFICATE, AFTER THE MINT.</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {SILHOUETTES.map(key => (
                  <Choice key={key} chosen={silhouette === key} onPick={() => set({ silhouette: key })} title={SILHOUETTE_LINES[key]}>
                    <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <SpriteView sprite={figure({ uid: 'preview:unborn', archetype: key as Archetype })} scale={2} />
                      <span>
                        <span className="ws-bright" style={{ display: 'block' }}>{key.replace('_', ' ')}</span>
                        <span className="ws-dim ws-small" style={{ display: 'block' }}>{SILHOUETTE_LINES[key]}</span>
                      </span>
                    </span>
                  </Choice>
                ))}
              </div>
            </>
          )}
          {nav(!!origin, 'NEXT: WHAT YOU CARRY', () => set({ step: 1 }))}
        </div>
      )}

      {step === 1 && origin && (
        <div>
          <div className="ws-dim ws-small" style={{ marginBottom: 8 }}>The bank writes it down and charges nothing. 500 G stays in the account. What can be worn is worn.</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {origin.kits.map(id => {
              const kit = OriginBank.kit(id)!;
              return (
                <Choice key={id} chosen={id === kitId} onPick={() => choose({ kitId: id })}>
                  <span className="ws-bright" style={{ display: 'block', letterSpacing: '0.04em' }}>{kit.says}</span>
                  <span className="ws-dim ws-small" style={{ display: 'block' }}>{kit.line}</span>
                  <span style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
                    {CreationSystem.kitPreview(id).map(piece => (
                      <span key={piece.definitionId} className="ws-small" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                        <SpriteView sprite={pieceArt(piece.definitionId, piece.tags)} scale={1} />
                        {piece.name}
                      </span>
                    ))}
                  </span>
                </Choice>
              );
            })}
          </div>
          {nav(!!kitId, 'NEXT: THE FACE OF THE WORLD', () => set({ step: 2 }))}
        </div>
      )}

      {step === 2 && (
        <div>
          <div className="ws-dim ws-small" style={{ marginBottom: 8 }}>
            Where you arrive, and what your first world will be like. You hold one deed: it mints a world of {WorldDeed.say(FREE_DEED_SIZE)}, whenever you sign it.
          </div>
          <div className="ws-dim ws-small" style={{ marginBottom: 4, letterSpacing: '0.08em' }}>WHERE YOU ARRIVE</div>
          {!hubs && <Busy label="READING THE REGISTRY" quietForMs={250} />}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(hubs ?? []).map(hub => (
              <Choice key={hub.id || 'first'} chosen={hub.id === hubId} onPick={() => set({ hubId: hub.id })}>
                <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <SpriteView sprite={hub.thumb} scale={1} title={`The streets of ${hub.name}`} />
                  <span>
                    <span className="ws-bright" style={{ display: 'block' }}>{hub.name.toUpperCase()}</span>
                    <span className="ws-dim ws-small" style={{ display: 'block' }}>{hub.description}</span>
                  </span>
                </span>
              </Choice>
            ))}
          </div>
          <div className="ws-dim ws-small" style={{ margin: '12px 0 4px', letterSpacing: '0.08em' }}>WHAT YOUR FIRST WORLD WILL BE LIKE</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {offeredThemes.map(theme => (
              <Choice key={theme.themeId} chosen={theme.themeId === themeId} onPick={() => set({ themeId: theme.themeId })}>
                <span style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <SpriteView sprite={landThumb(theme.themeId)} scale={0.5} title="Land as recon would draw it" />
                  <span style={{ minWidth: 0 }}><ThemePreview theme={theme} /></span>
                </span>
              </Choice>
            ))}
          </div>
          {nav(!!hubs, 'NEXT: THE SEED', () => set({ step: 3 }))}
        </div>
      )}

      {step === 3 && (
        <div>
          <div style={{ marginBottom: 8 }} aria-label="What was said">
            <div className="ws-small" style={{ marginBottom: 6 }}>THE SEED: You are not where you were. The bank does not ask how. It has a few plain questions, for the record.</div>
            {questions.filter(q => answers[q.id]).map(q => (
              <div key={q.id} style={{ marginBottom: 6 }}>
                <div className="ws-small">THE SEED: {q.asks}</div>
                <div className="ws-small ws-bright" style={{ paddingLeft: 12, borderLeft: '2px solid currentColor' }}>
                  {q.answers.find(a => a.id === answers[q.id])?.says}
                </div>
              </div>
            ))}
          </div>
          {nextQuestion && (
            <div>
              <div className="ws-small" style={{ marginBottom: 6 }}>THE SEED: {nextQuestion.asks}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {nextQuestion.answers.map(a => (
                  <Button key={a.id} tone="quiet" onClick={() => choose({ answers: { ...answers, [nextQuestion.id]: a.id } })}>{a.says}</Button>
                ))}
              </div>
            </div>
          )}
          {!nextQuestion && !asking && (
            <div>
              <div className="ws-small" style={{ marginBottom: 6 }}>THE SEED: Is there anything else the record should hold.</div>
              <Input
                placeholder="Nothing is an answer" aria-label="Say something to the Seed" maxLength={200}
                value={said} onChange={e => choose({ said: e.target.value })}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <Button tone="signal" primary onClick={() => void hear()}>{said.trim() ? 'HEAR IT OUT' : 'SAY NOTHING MORE'}</Button>
              </div>
            </div>
          )}
          {asking && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1 }}><Busy label="THE SEED IS CONSIDERING" /></div>
              <Button tone="quiet" onClick={stopWaiting}>DO NOT WAIT FOR IT</Button>
            </div>
          )}
          {nav(false, '')}
        </div>
      )}

      {step === 4 && origin && words && (
        <div>
          <div className="ws-small" style={{ marginBottom: 8 }}>THE SEED: {words.line}</div>
          <div className="ws-list" style={{ marginBottom: 8 }} aria-label="What your hands know">
            {words.skills.map(s => (
              <div key={s.id} className="ws-row">
                <span style={{ minWidth: 0 }}>
                  <span className="ws-bright" style={{ display: 'block' }}>{s.name}</span>
                  <span className="ws-dim ws-small" style={{ display: 'block' }}>{s.flavor}</span>
                </span>
              </div>
            ))}
          </div>
          <div className="ws-small" style={{ marginBottom: 10, display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 10 }}>
            <span className="ws-dim">YOU WERE</span><span>{origin.says}</span>
            <span className="ws-dim">MAIN FOCUS</span><span>{origin.main ? attr(origin.main) : 'THE TOP OF YOUR DEAL'}</span>
            <span className="ws-dim">SUB FOCUS</span><span>{origin.sub ? attr(origin.sub) : 'THE NEXT OF YOUR DEAL'}</span>
            <span className="ws-dim">YOU CARRY</span><span>{CreationSystem.kitPreview(kitId).map(p => p.name).join(', ')}</span>
            <span className="ws-dim">YOU HOLD</span><span>One world deed: {WorldDeed.say(FREE_DEED_SIZE)}</span>
          </div>
          <Input
            label="THE NAME ON THE CERTIFICATE" placeholder="KAEL / SERA / IO…" autoFocus
            value={name} onChange={e => set({ name: e.target.value })}
            style={{ textTransform: 'uppercase' }}
          />
          <div className="ws-dim ws-small" style={{ marginTop: 6 }}>The certificate signs everything you ever bank. Your numbers and your face come from it, and you will meet them after this.</div>
          {error && <div className="ws-loss ws-small" style={{ marginTop: 8 }}>GENERATION FAILED: {error}</div>}
          {nav(!!name.trim() && !creating, creating ? 'SIGNING…' : 'MINT THE CERTIFICATE', () => {
            const usage = (grant?.usage as IDoorUsage | null) ?? undefined;
            void onMint(name.trim(), CreationSystem.sheet({ originId, kitId, silhouette, hubId, themeId, answers, said }, words, grant?.by ?? 'FLOOR', usage));
          })}
        </div>
      )}

      {/* A draft restored past where its choices still stand starts that screen again */}
      {((step >= 1 && !origin) || (step === 4 && !words)) && (
        <div>
          <div className="ws-dim ws-small">That part of the draft no longer stands.</div>
          <Button tone="signal" onClick={() => set({ step: origin ? 3 : 0 })}>GO BACK TO IT</Button>
        </div>
      )}
    </Panel>
  );
};
