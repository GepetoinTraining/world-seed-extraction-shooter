/**
 * WHAT YOU WILL DO WHILE AWAY (the design pass, part 5b). Made where a character rests: Old Mags' at the inn, or one's own
 * bed. It offers what a hand could do here with no live roll in front of the player (a sitting with a thing held or known,
 * writing a held skill out, a rest), says what each asks today, holds as many as focus allows, and can be filled from
 * what the character works toward on the web. Lying down lays it: it begins where that rest ends. Words, never hue.
 *
 * D119 (Pedro, 2026-11-19: "we really do need to make that "what do you want to study" and "what do you want to make" input
 * work correctly. it takes input materials that the user adds, or, input study things that they list, and sends them as a
 * list with the skills for the next long sleep"). So it also asks both in words. Anything typed to study is a sitting in
 * the stack like any other. What is wanted made is said, the components are put in from the vault, and it is laid for the
 * night (MakeDoor): the sleep carries it and answers it. Components that already make something this hub knows offer that
 * at once, with nobody asked.
 */

import React, { useMemo, useState } from 'react';
import { usePlayerStore, playerPort } from '../entities/player/store';
import { useHubStore, hubPort } from '../entities/hub/store';
import { worldPort } from '../entities/world/store';
import { hubTreeOf } from '../entities/hub/hubTech';
import { Downtime, DowntimePlace, IDowntimeAct } from '../../shared/logic/systems/Downtime';
import { WebSystem } from '../../shared/logic/systems/WebSystem';
import { RESOURCE_DEFINITIONS } from '../../shared/entities/item/data/resourceDefinitions';
import { CRAFTED_DEFINITIONS } from '../../shared/entities/economy/data/recipeDefinitions';
import { StudySystem } from '../logic/systems/StudySystem';
import { LorePiece } from '../logic/systems/LorePiece';
import { RestSystem, INN_FEE } from '../logic/systems/RestSystem';
import { RestDoor } from '../logic/systems/RestDoor';
import { WebMap } from '../logic/systems/WebMap';
import { DowntimeActs } from '../logic/systems/DowntimeActs';
import { DowntimeDoor } from '../logic/systems/DowntimeDoor';
import { Button, Input, Modal, Panel } from './ui/kit';
import { MakeAsk } from '../../shared/logic/systems/MakeAsk';
import { PairCraft } from '../../shared/logic/systems/PairCraft';
import { MakeDoor } from '../logic/systems/MakeDoor';
import { SkillNames } from '../logic/systems/SkillNames';

export const DowntimePanel: React.FC<{ place: DowntimePlace; onDone?: () => void }> = ({ place, onDone }) => {
  const player = usePlayerStore(s => s.player);
  const web = useHubStore(s => s.web);
  const tech = useHubStore(s => s.tech);
  const hub = hubTreeOf(tech);
  const [draft, setDraft] = useState<IDowntimeAct[]>(() => player.downtime?.stack.acts ?? []);
  const holds = Downtime.capacity(player.attributes);
  const full = draft.length >= holds;
  const [studyWords, setStudyWords] = useState('');
  const [makeWords, setMakeWords] = useState('');
  const [putIn, setPutIn] = useState<string[]>([]);

  const held = player.bank.stashTabs[0]?.items ?? [];
  const known = useMemo(() => WebMap.of(player, { web, tech }).nodes.filter(n => n.kind === 'thing' && n.state === 'yours').map(n => {
    const def = RESOURCE_DEFINITIONS[n.ref] ?? CRAFTED_DEFINITIONS[n.ref];
    return StudySystem.targetOfThing({ id: n.ref, name: n.name ?? n.ref, tags: def?.tags ?? [], rank: def?.rank });
  }), [player, web, tech]);
  const skills = WebSystem.heldSkills(player.bank.universalSkills);
  // D119: what can go into a making is what crafting by two takes: a material, read
  const workable = held.filter(i => i.isIdentified !== false && PairCraft.isMaterial(i));
  const chosen = workable.filter(i => putIn.includes(i.id));
  const laid = player.makeAsks ?? [];
  const knownMakings = MakeAsk.knownFor(chosen, tech.made ?? []);
  const toggle = (id: string) => setPutIn(ids => (ids.includes(id) ? ids.filter(k => k !== id) : [...ids, id]));

  const add = (act: IDowntimeAct) => { if (!full) setDraft(d => [...d, act]); };
  const asks = (act: IDowntimeAct): string => {
    if (act.kind === 'STUDY') { const a = StudySystem.studyAsk(player, act.target, hub); return `${a.cost} energy, ${a.seconds}s`; }
    if (act.kind === 'WRITE') { const skill = LorePiece.heldSkill(player, act.skillId); if (!skill) return 'a skill you hold'; const a = LorePiece.ask(player, skill, hub); return `a sheet of paper, ${a.cost} energy, ${a.seconds}s`; }
    return place === 'INN' ? `the night, ${INN_FEE} G, as long as your energy needs` : 'as long as your energy needs';
  };
  const lieDown = async () => {
    const slept = await RestDoor.sleep(place, worldPort, playerPort, hubPort);
    if (!slept.ok) return;
    DowntimeDoor.lay(draft, place, playerPort);
    onDone?.();
  };

  return (
    <div data-downtime-panel style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="ws-small">
        Lay out what your character does while you are away. It begins when this rest ends, on the game's clock, one thing after another, each costing what it costs by hand; whatever cannot be paid stops it there. Your focus holds {holds}.
      </div>
      <Panel title={`STACKED: ${draft.length} OF ${holds}`}>
        {draft.length === 0 && <div className="ws-dim ws-small">Nothing yet. Add from below.</div>}
        {draft.map((act, i) => (
          <div key={i} className="ws-row ws-small" style={{ gap: 6 }} data-downtime-act>
            <span style={{ minWidth: 0 }}>{i + 1}. {DowntimeActs.wordOf(act)} <span className="ws-dim">({asks(act)})</span></span>
            <span style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              <Button tone="quiet" disabled={i === 0} onClick={() => setDraft(d => { const n = [...d]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })}>EARLIER</Button>
              <Button tone="quiet" onClick={() => setDraft(d => d.filter((_, k) => k !== i))}>REMOVE</Button>
            </span>
          </div>
        ))}
      </Panel>
      {player.webGoal && (
        <Button tone="quiet" onClick={() => setDraft(DowntimeActs.fromGoal(player, { web, tech }))}>FILL FROM WHAT YOU WORK TOWARD</Button>
      )}
      <Panel title="WHAT DO YOU WANT TO STUDY">
        <form
          style={{ display: 'flex', gap: 4 }}
          onSubmit={e => {
            e.preventDefault();
            if (full || !studyWords.trim()) return;
            add({ kind: 'STUDY', target: StudySystem.targetOfWords(studyWords) });
            setStudyWords('');
          }}
        >
          <Input aria-label="What do you want to study" placeholder="Anything, in your own words…" value={studyWords} onChange={e => setStudyWords(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
          <Button tone="quiet" type="submit" disabled={full || !studyWords.trim()}>ADD TO THE STACK</Button>
        </form>
        <div className="ws-dim ws-small">Each thing you list is a sitting while you are away. What they come to is settled at the rest after.</div>
      </Panel>
      <Panel title="WHAT DO YOU WANT TO MAKE" >
        <div data-make-ask style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Input aria-label="What do you want to make" placeholder="Say what you want it to be…" maxLength={200} value={makeWords} onChange={e => setMakeWords(e.target.value)} />
          <div className="ws-dim ws-small">Put in what it is to be made of, from your vault:</div>
          {workable.length === 0 ? <div className="ws-dim ws-small">Nothing in your vault can be worked into another thing.</div> : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {workable.map(item => (
                <Button key={item.id} tone="quiet" aria-pressed={putIn.includes(item.id)} onClick={() => toggle(item.id)}>
                  {putIn.includes(item.id) ? 'IN: ' : '+ '}{item.name.toUpperCase()}
                </Button>
              ))}
            </div>
          )}
          {knownMakings.map(t => (
            <Button key={t.id} tone="quiet" onClick={async () => { if ((await MakeDoor.makeNow(t.id, putIn, playerPort, hubPort)).ok) setPutIn([]); }}>
              THESE MAKE {t.name.toUpperCase()} HERE ALREADY: MAKE IT NOW
            </Button>
          ))}
          <Button
            tone="signal"
            disabled={!makeWords.trim() || chosen.length === 0 || laid.length >= MakeAsk.holds(player)}
            onClick={() => { if (MakeDoor.lay(makeWords, putIn, playerPort).ok) { setMakeWords(''); setPutIn([]); } }}
          >
            LAY IT FOR THE NIGHT
          </Button>
          <div className="ws-dim ws-small">It is answered while you sleep, from what you put in and what your hands know. If it can be made, it is in your vault when you come back, and this place knows how from then on. If it cannot, what you put in comes back.</div>
          {laid.map(a => (
            <div key={a.id} className="ws-row ws-small" style={{ gap: 6 }} data-make-laid>
              <span style={{ minWidth: 0 }}>LAID: "{a.words}", of {a.parts.map(p => p.name).join(', ')}</span>
              <Button tone="quiet" onClick={() => MakeDoor.takeBack(a.id, playerPort)}>TAKE BACK</Button>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="SIT WITH WHAT YOU HOLD">
        {held.length === 0 ? <div className="ws-dim ws-small">Your vault is empty.</div> : held.map(item => (
          <Button key={item.id} tone="quiet" disabled={full} onClick={() => add({ kind: 'STUDY', target: StudySystem.targetOfItem(item) })}>{StudySystem.targetOfItem(item).name.toUpperCase()}</Button>
        ))}
      </Panel>
      <Panel title="SIT WITH WHAT YOU KNOW">
        {known.length === 0 ? <div className="ws-dim ws-small">No material known by name yet.</div> : known.map(target => (
          <Button key={target.ref} tone="quiet" disabled={full} onClick={() => add({ kind: 'STUDY', target })}>{target.name.toUpperCase()}</Button>
        ))}
      </Panel>
      <Panel title="WRITE OUT WHAT YOUR HANDS KNOW">
        {skills.length === 0 ? <div className="ws-dim ws-small">Nothing held yet.</div> : skills.map(s => (
          <Button key={s.id} tone="quiet" disabled={full} onClick={() => add({ kind: 'WRITE', skillId: s.id })}>{(SkillNames.nameOf(s.id, player.skillWords?.[s.id]?.name)).toUpperCase()}</Button>
        ))}
      </Panel>
      <Button tone="quiet" disabled={full} onClick={() => add({ kind: 'REST' })}>ADD A REST</Button>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Button tone="signal" onClick={() => void lieDown()}>LIE DOWN, AND LEAVE THIS STACKED</Button>
        {player.downtime && <Button tone="quiet" onClick={() => { DowntimeDoor.clear(playerPort); setDraft([]); }}>CLEAR WHAT IS STACKED</Button>}
      </div>
      <div className="ws-dim ws-small">Energy now: {Math.floor(RestSystem.energyHeld(player))}. A rest in the stack gives it back.</div>
    </div>
  );
};

/** At the inn: Old Mags' table. */
export const DowntimeModal: React.FC<{ place: DowntimePlace; onClose: () => void }> = ({ place, onClose }) => (
  <Modal title="WHILE YOU ARE AWAY" onClose={onClose} width={560}>
    <DowntimePanel place={place} onDone={onClose} />
  </Modal>
);

/** At one's own bed: folded until asked for. */
export const DowntimeToggle: React.FC<{ place: DowntimePlace }> = ({ place }) => {
  const [open, setOpen] = useState(false);
  return open
    ? <DowntimePanel place={place} onDone={() => setOpen(false)} />
    : <Button tone="quiet" onClick={() => setOpen(true)}>LAY OUT WHAT YOU WILL DO WHILE AWAY</Button>;
};
