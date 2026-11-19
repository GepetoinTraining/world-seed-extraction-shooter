/**
 * The rest, reaching out: the part of a rest that touches stores, the ledger and the
 * door. The rules are in RestSystem and stay pure; this is where they meet the world.
 */

import type { IPlayerPort } from '../../entities/player/playerView';
import type { IHubPort } from '../../entities/hub/hubView';
import type { IWorldPort } from '../../entities/world/worldView';
import { useFeed } from '../../components/ui/stores';
import { GoldCommit } from '../economy/GoldCommit';
import { Ledger } from '../ledger/Ledger';
import { ContentRegistry } from '../../../shared/logic/theme/ContentRegistry';
import { IntelligenceClient } from '../intelligence/IntelligenceClient';
import { WebSystem } from '../../../shared/logic/systems/WebSystem';
import { hubTreeOf } from '../../entities/hub/hubTech';
import { HubUnlock } from './HubUnlock';
import { WorldClock } from '../../entities/world/WorldClock';
import { PlayerPersistence } from '../persistence/PlayerPersistence';
import { IDreamResult, INN_FEE, RestPlace, RestSystem } from './RestSystem';
import { LoreSystem } from './LoreSystem';
import { PROCESS_FAMILIES, ProcessFamily } from '../../../shared/logic/systems/ProcessSystem';
import { SkillNames } from './SkillNames';
import { MakeAsk, isGearKind, isToolKind } from '../../../shared/logic/systems/MakeAsk';
import { makeGround } from './MakeGround';
import { ProgressionSystem } from '../../../shared/entities/player/systems/ProgressionSystem';
import { ownerHasStationFor } from '../../../shared/entities/hub/room';
import { Provenance } from '../sovereignty/Provenance';
import type { IMakeWords, IPlayer } from '../../../shared/types';


let waking = false;
const feed =(text: string, tone: 'plain' | 'signal' | 'proof' | 'loss' = 'plain') => useFeed.getState().push(text, tone);

export const RestDoor = {
  /** Settling, at any rest. A return to the hub comes through here too (D30). */
  settle(pc: IPlayerPort, hp: IHubPort): { emerged: { id: string }[] } {
    const { player, read, emerged, wanting, learned, floorNamed, made } = RestSystem.settle(pc.view().player, hubTreeOf(hp.view().tech));
    pc.apply({ kind: 'SET', player });
    // Pedro, 2026-11-11: "Yes, ask for lore". What was learned says what it took; what wanted lore says it waits
    RestSystem.settledWords(emerged as { id: string; rank?: number }[], []).forEach(line => feed(line, 'proof'));
    RestSystem.settledWords([], wanting).forEach(line => feed(line, 'plain'));
    for (const item of read) feed(`You know what ${item.name} is now. It reads exactly as it was banked.`, 'proof');
    // What was made by setting one thing on another is read now, and not before (PairCraft)
    for (const m of made) {
      if (m.outcome === 'major_failure') feed(`What you made came to nothing: ${m.item.name}. ${m.item.description}`, 'loss');
      else feed(`What you made is ${m.item.name}${m.outcome === 'failure' ? ', and crudely done' : m.outcome === 'major_win' ? ', and better than you had any right to' : ''}.`, 'proof');
      // The trade it worked is practised whatever came of it: trying is how it is learned
      if (m.trade && (PROCESS_FAMILIES as readonly string[]).includes(m.trade)) pc.apply({ kind: 'PRACTICE_TRADE', family: m.trade as ProcessFamily });
    }
    for (const id of learned) feed(`It settled: you could cast ${ContentRegistry.ability(id)?.name ?? 'what you saw'} now.`, 'proof');
    for (const id of floorNamed) void RestDoor.unlockFrom(id, pc, hp);
    return { emerged };
  },

  /** D49: the first magic settled in a hub unlocks that hub, and says so once. */
  async unlockFrom(what: string, pc: IPlayerPort, hp: IHubPort): Promise<void> {
    const p = pc.view().player;
    if (await HubUnlock.unlock(p.id, what, hp.view().activeHubId ?? '')) {
      feed('Something in this hub has changed. What is found from now on may carry more than its name.', 'signal');
      hp.generateDailyStock();
    }
  },

  /** A chosen rest begins (D79): the fee, what is queued goes to the door, and this character is down until it ends. */
  async sleep(place: RestPlace, world: IWorldPort, pc: IPlayerPort, hp: IHubPort): Promise<{ ok: boolean; reason?: string }> {
    const before = pc.view().player;
    const now = Date.now();
    const verdict = RestSystem.canRest(before, place, now);
    if (!verdict.ok) {
      feed(verdict.reason!, 'loss');
      return verdict;
    }

    if (place === 'INN') {
      const hubId = hp.view().activeHubId ?? 'hub_unknown';
      pc.apply({ kind: 'GOLD', delta: -INN_FEE });
      void GoldCommit.commit({
        player: pc.view().player,
        rows: [{ type: 'GOLD_DELTA', data: { reason: 'INN', amount: -INN_FEE, treasuryId: hubId, treasuryDelta: INN_FEE } }],
        treasury: { worldUid: hubId, delta: INN_FEE }
      });
    }

    await RestDoor.collect(pc, hp);
    const { emerged } = RestDoor.settle(pc, hp);
    const lying = RestSystem.beginRest(pc.view().player, place, now);
    pc.apply({ kind: 'SET', player: lying });
    await hp.creditHeld();
    await RestDoor.file(emerged, world, pc, hp);
    if (!(await RestDoor.wakeIfDue(pc, hp, now))) {
      feed(`You lie down. This character is at rest for ${WorldClock.say(lying.rest!.until - now)}. Another can go.`, 'signal');
      await PlayerPersistence.flush('rest', pc.view().player);
    }
    return { ok: true };
  },

  /** The rest ends when its time is up, whoever is watching. Called on a timer and at any door out. */
  async wakeIfDue(pc: IPlayerPort, hp: IHubPort, now = Date.now()): Promise<boolean> {
    const { rest } = pc.view().player;
    if (!rest || now < rest.until || waking) return false;
    waking = true;
    try {
      await RestDoor.collect(pc, hp);
      pc.apply({ kind: 'WAKE' });
      // Inside a world the sleep was that world's. Anywhere else the day is the clock's, and a rest does not turn it
      feed(rest.place === 'FIELD' ? 'You slept. It is another day.' : 'You slept. You wake rested, and it is the same day.', 'signal');
      await PlayerPersistence.flush('rest', pc.view().player);
    } finally {
      waking = false;
    }
    return true;
  },

  /** Send what was queued, if there is anything and a door. Nothing waits on this. */
  async file(emerged: { id: string }[], world: IWorldPort, pc: IPlayerPort, hp?: IHubPort): Promise<void> {
    const player = pc.view().player;
    if (player.pendingDream) return;
    // D119: what was laid to be made goes with the sleep, with what their hands know and what this hub could raise
    const wanted = hp ? MakeAsk.request(player, makeGround(hp)) : null;
    const queue = RestSystem.dreamQueue(player, emerged, wanted);
    const made = wanted ? (player.makeAsks ?? []).map(a => a.id) : [];
    const skills = queue.skills as unknown[];
    const weaves = queue.weaves as unknown[];
    const gifts = queue.gifts as { id: string }[];
    const studied = queue.studied as { id: string }[];
    // D118: gifts also cost lore. What it cannot reach stays owed, and the person is told.
    for (const g of LoreSystem.giftsWaiting(player)) {
      feed(`${SkillNames.nameOf(g.id)} is owed a gift. It waits on ${g.price} lore; you hold ${LoreSystem.held(player)}.`, 'plain');
    }
    if (skills.length === 0 && weaves.length === 0 && gifts.length === 0 && studied.length === 0 && made.length === 0 && !LoreSystem.worthFiling(player)) return;

    const view = world.view();
    const card = view.availableWorlds.find(w => w.id === view.activeWorldId) ?? view.availableWorlds[0];
    const theme = ContentRegistry.get(card?.themeId) ?? ContentRegistry.list()[0];
    const summary = theme ? { name: theme.name, premise: theme.premise, regions: theme.regions.map(r => r.name), elements: [...new Set(theme.abilities.flatMap(a => a.elements))] } : {};

    const id = `rest_${player.id}_${player.dayCount ?? 0}`;
    const out = await IntelligenceClient.fileRest(id, queue, summary);
    if (out.status === 'PENDING' && out.batchId) {
      pc.apply({ kind: 'PENDING_DREAM', dream: {
        batchId: out.batchId!,
        filedAt: Date.now(),
        themeId: theme?.themeId,
        asked: {
          skills: (skills as { id: string }[]).map(q => q.id),
          weaves: (weaves as { id: string }[]).map(q => q.id),
          gifts: gifts.map(q => q.id),
          sittings: studied.map(q => q.id),
          made
        }
      } });
      if (made.length > 0) feed(`What you laid to be made went with you into sleep: ${(player.makeAsks ?? []).map(a => a.words).join('; ')}.`, 'signal');
    } else if (out.status !== 'NO_KEY' && out.status !== 'OFFLINE') {
      console.log(`[REST] The batch waits for the next rest: ${out.status}. ${out.reason ?? ''}`);
    }
    if (out.status !== 'PENDING' && studied.length > 0) feed('What you studied waits. Nothing is lost; it comes to something at a rest the dream can reach.', 'plain');
    // A gift the log could pay for went into the batch, so the line above it never named it.
    if (out.status !== 'PENDING') for (const g of gifts) feed(`${SkillNames.nameOf(g.id)} is owed a gift. It waits for a rest the dream can reach.`, 'plain');
    if (out.status !== 'PENDING' && made.length > 0) feed('What you laid to be made waits. Nothing is lost; it is answered at a rest the dream can reach.', 'plain');
  },

  /**
   * D119: what came back for each thing laid to be made, one by one. A sound "yes" is a technology settled in this hub
   * and the thing itself in the vault; a "no" gives the components back; an answer nobody can read leaves the ask
   * waiting. Each is judged apart (MakeAsk.judge), so a broken one spoils no other and nothing else of the sleep.
   */
  async settleMade(answers: IMakeWords[], asked: string[], pc: IPlayerPort, hp: IHubPort): Promise<void> {
    const ground = makeGround(hp);
    const hubId = hp.view().activeHubId;
    for (const id of asked) {
      const before: IPlayer = pc.view().player;
      const ask = (before.makeAsks ?? []).find(a => a.id === id);
      // Taken back while it was away: nothing to answer
      if (!ask) continue;
      const words = answers.find(a => a.id === id);
      const verdict = MakeAsk.judge(words, ask, ground);
      if (!verdict.ok || !words) {
        console.warn(`[REST] What came back for "${ask.words}" could not be read: ${verdict.reason}`);
        const out = MakeAsk.unread(before, id);
        pc.apply({ kind: 'SET', player: out.player });
        feed(out.givenBack
          ? `Nothing you could read came of "${ask.words}". What you laid is back in your vault.`
          : `Nothing you could read came of "${ask.words}" this time. It waits for your next rest.`, 'plain');
        continue;
      }
      if (!words.makes) {
        pc.apply({ kind: 'SET', player: MakeAsk.takeBack(before, id) });
        feed(`"${ask.words}": ${words.line} What you laid is back in your vault.`, 'plain');
        continue;
      }
      // Pedro, 2026-11-19: gear is "made by a tool". Whatever tool the answer names, the hand must hold one that answers
      const lacks = MakeAsk.lacking(before, words.tools);
      if (lacks.length > 0) {
        pc.apply({ kind: 'SET', player: MakeAsk.takeBack(before, id) });
        feed(`"${ask.words}": it could be ${words.name}, made with ${lacks.join(' and ')}, and you hold none. What you laid is back in your vault.`, 'plain');
        continue;
      }
      const view = hp.view();
      const stash = before.bank.stashTabs.flatMap(t => t.items);
      const { tech, fresh, made } = MakeAsk.settle(ask, words, {
        rank: ProgressionSystem.rankOf(before),
        dexterity: before.attributes?.dexterity ?? 1,
        skillLevel: skillId => before.bank.universalSkills[skillId]?.level ?? 0,
        hasBench: asks => ownerHasStationFor(asks, before.id, { lots: view.lots, rooms: view.rooms, stash }),
        hasTool: word => MakeAsk.lacking(before, [word]).length === 0
      }, { by: before.id, at: Date.now() }, view.tech?.made ?? []);
      if (fresh) await hp.settleTech(tech);
      const consumedIds = ask.parts.map(p => p.id);
      pc.apply({ kind: 'SET', player: { ...before, makeAsks: (before.makeAsks ?? []).filter(a => a.id !== id) } }, { kind: 'STASH_ADD', items: [made.item] });
      await Provenance.record(made.item, 'MINT', { origin: 'IMPROVISATION', consumedIds, techId: tech.id });
      await Ledger.append('TECH', { kind: 'TECH_MADE', techId: tech.id, name: tech.name, wanted: ask.words, outcome: made.outcome, hubId, by: before.id, first: fresh, consumedIds });
      if (fresh) feed(`${tech.name}${isToolKind(tech.kind) ? ', a tool' : isGearKind(tech.kind) ? ', to wear or carry' : ''}: ${tech.is} Nobody here had made one. It is known here now, and the same things make it again with nobody asked.`, 'proof');
      if (made.outcome === 'major_failure') feed(`"${ask.words}": ${words.line} But your hands lost it: ${made.item.name}. ${made.item.description}`, 'loss');
      else feed(`"${ask.words}": ${words.line} ${made.item.name} is in your vault${made.outcome === 'failure' ? ', crudely done' : made.outcome === 'major_win' ? ', better than you had any right to' : ''}.`, 'proof');
      if (tech.trade && (PROCESS_FAMILIES as readonly string[]).includes(tech.trade)) pc.apply({ kind: 'PRACTICE_TRADE', family: tech.trade as ProcessFamily });
    }
  },

  /** Bring back what was filed, if it is ready: judged by the law, signed, and applied. */
  async collect(pc: IPlayerPort, hp: IHubPort): Promise<void> {
    const pending = pc.view().player.pendingDream;
    if (!pending) return;
    const out = await IntelligenceClient.collectRest<IDreamResult>(pending.batchId);
    if (out.status === 'PENDING' || out.status === 'OFFLINE' || out.status === 'NO_KEY') return;
    if (out.status !== 'OK' || !out.data) {
      pc.apply({ kind: 'PENDING_DREAM' });
      return;
    }
    const asker = pc.view().player;
    const held = ContentRegistry.get(pending.themeId);
    const hub = hubTreeOf(hp.view().tech);
    const verdict = RestSystem.judgeDream(out.data, pending.asked, asker, held ? [...new Set(held.abilities.flatMap(a => a.elements))] : undefined, hub);
    if (!verdict.ok) {
      console.warn(`[REST] What came back was refused whole: ${verdict.reason}`);
      pc.apply({ kind: 'PENDING_DREAM' });
      return;
    }
    const before = pc.view().player;
    const said = (out.data.studied ?? []).map(w => {
      const sitting = RestSystem.queueOf(before).sittings.find(s => s.id === w.id)!;
      const lore = LoreSystem.loreOf(sitting);
      return { ...w, name: sitting.target.name, lore, gained: lore.amount };
    });
    pc.apply({ kind: 'SET', player: RestSystem.applyDream(before, out.data, hub) });
    const hubId = hp.view().activeHubId;
    await RestDoor.settleMade(out.data.made ?? [], pending.asked.made ?? [], pc, hp);
    if (out.usage) await Ledger.append('TECH', { kind: 'INTELLIGENCE_USE', hubId, door: 'rest', ...out.usage });
    for (const w of out.data.weaves) {
      // Spellcraft's rule: the first to name it names it for everyone, signed
      if (!(before.weaveNames ?? {})[w.id] || before.weaveNames![w.id].startsWith('Unnamed')) {
        await Ledger.append('TECH', { kind: 'WEAVE_NAMED', weaveId: w.id, name: w.name, hubId, by: before.id });
        feed(`What you wove has a name now: ${w.name}. The bank has it signed.`, 'proof');
      }
    }
    for (const s of out.data.skills) feed(`${s.name}: ${s.flavor}`, 'signal');
    for (const g of out.data.gifts ?? []) feed(`${SkillNames.nameOf(g.skill)} gave you ${g.name}. ${g.blurb}`, 'proof');
    // The lore pass: what a sitting gave, by kind; a misreading reads as lore of its category, and high
    for (const w of said) feed(LoreSystem.saidOf(w.name, w.line, w.lore), 'proof');
    for (const t of out.data.taught ?? []) feed(`You woke knowing ${t.name}. ${t.flavor}`, 'proof');
    for (const r of out.data.raised ?? []) feed(r.line, 'proof');
    // D118: a skill taught is held like any other, so the hub's web hears of it by the same door.
    if ((out.data.taught ?? []).length > 0) await hp.creditHeld();
    if (said.length + (out.data.taught?.length ?? 0) + (out.data.raised?.length ?? 0) > 0) {
      await Ledger.append('TECH', {
        kind: 'LORE', hubId, by: before.id, gained: said.reduce((sum, w) => sum + w.gained, 0),
        taught: (out.data.taught ?? []).map(t => t.name), raised: (out.data.raised ?? []).map(r => r.gift),
        held: LoreSystem.held(pc.view().player)
      });
    }
  }
};
