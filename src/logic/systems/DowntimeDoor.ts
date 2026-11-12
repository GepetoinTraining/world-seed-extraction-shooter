/**
 * DOWNTIME, REACHING OUT (the design pass, part 5b): laying a stack where a character rests, and the return. The rule is
 * `Downtime` and the acts are `DowntimeActs`, both pure; this is where they meet the stores, the ledger and the clock.
 *
 * The clock is the game's (GameClock: the server's, never the device's). On return, and every few seconds while the
 * player is here, the time since the walk last reached is walked through the stack on the player's own side, as math over
 * the stack and the clock's reading: nothing runs anywhere while they are away. A rest the stack takes files what waits on a
 * dream the way a hand's rest does, and with no key it waits and says so.
 */

import type { IPlayerPort } from '../../entities/player/playerView';
import type { IHubPort } from '../../entities/hub/hubView';
import type { IWorldPort } from '../../entities/world/worldView';
import { hubTreeOf } from '../../entities/hub/hubTech';
import { ownerHasStationFor } from '../../../shared/entities/hub/room';
import { Downtime, DowntimePlace, IDowntimeAct } from '../../../shared/logic/systems/Downtime';
import { useFeed } from '../../components/ui/stores';
import { Ledger } from '../ledger/Ledger';
import { GoldCommit } from '../economy/GoldCommit';
import { GameClock } from '../time/GameClock';
import { DowntimeActs } from './DowntimeActs';
import { INN_FEE } from './RestSystem';
import { RestDoor } from './RestDoor';

let walking = false;
const feed = (text: string, tone: 'plain' | 'signal' | 'proof' | 'loss' = 'plain') => useFeed.getState().push(text, tone);

export const DowntimeDoor = {
  /** Laid at the resting place, as the character lies down: it begins where that rest ends. */
  lay(acts: IDowntimeAct[], place: DowntimePlace, pc: IPlayerPort): { ok: boolean; reason?: string } {
    const out = Downtime.lay(pc.view().player, place, acts, GameClock.now());
    if (!out.ok || !out.stack) { feed(out.reason ?? 'It could not be stacked.', 'loss'); return out; }
    pc.apply({ kind: 'DOWNTIME', downtime: out.stack.acts.length > 0 ? { stack: out.stack } : undefined });
    if (out.stack.acts.length > 0) feed(`Stacked for while you are away: ${out.stack.acts.map(a => DowntimeActs.wordOf(a)).join(', ')}.`, 'signal');
    return { ok: true };
  },

  clear(pc: IPlayerPort): void {
    pc.apply({ kind: 'DOWNTIME', downtime: undefined });
  },

  /** The return: the time since the walk last reached, walked through what is stacked, and said in plain words. */
  async resolve(pc: IPlayerPort, hp: IHubPort, world: IWorldPort): Promise<void> {
    const first = pc.view().player;
    const record = first.downtime;
    if (walking || !record || record.stack.acts.length === 0 || first.currentSession) return;
    walking = true;
    try {
      const now = GameClock.now();
      // The rest being taken comes first, and ends as a hand's rest ends
      if (first.rest) {
        if (now < first.rest.until) return;
        await RestDoor.wakeIfDue(pc, hp, now);
      }
      const before = pc.view().player;
      const view = hp.view();
      const stash = before.bank.stashTabs.flatMap(t => t.items);
      const rules = DowntimeActs.rules({
        place: record.stack.place,
        hub: hubTreeOf(view.tech),
        who: p => ({ uid: p.id, name: p.username || 'Someone' }),
        stationMissing: (target, p) => !target.station || ownerHasStationFor(target.station, p.id, { lots: view.lots, rooms: view.rooms, stash })
          ? null : 'You have no workstation for that. A bench of your own would do.'
      });
      const out = Downtime.walk(before, record.stack, now, rules);
      const stopKey = out.account.stopped ? `${DowntimeActs.wordOf(out.account.stopped.act)}|${out.account.stopped.reason}` : undefined;
      // Nothing new since the last return: say nothing again
      if (out.account.done.length === 0 && stopKey === record.stopKey) return;
      const lines = DowntimeActs.words(out.account, out.stack.acts);
      pc.apply({ kind: 'SET', player: { ...out.player, downtime: { stack: out.stack, account: { at: now, lines }, ...(stopKey ? { stopKey } : {}) } } });
      feed('While you were away:', 'signal');
      lines.forEach(line => feed(line, line.startsWith('It stopped') ? 'loss' : 'plain'));

      // What a hand's doors also write down: the walk on the ledger, the inn's coin to its treasury, a dream filed
      const hubId = view.activeHubId ?? 'hub_unknown';
      if (out.account.done.length > 0) {
        await Ledger.append('TECH', { kind: 'DOWNTIME_WALKED', hubId, from: record.stack.walkedTo, to: out.stack.walkedTo, acts: out.account.done.map(d => ({ act: d.act.kind, at: d.at, said: d.said })) });
      }
      for (const done of out.account.done) {
        if (done.act.kind !== 'REST' || record.stack.place !== 'INN') continue;
        await GoldCommit.commit({
          player: pc.view().player,
          rows: [{ type: 'GOLD_DELTA', data: { reason: 'INN', via: 'DOWNTIME', amount: -INN_FEE, treasuryId: hubId, treasuryDelta: INN_FEE } }],
          treasury: { worldUid: hubId, delta: INN_FEE }
        });
      }
      if (out.account.done.some(d => d.act.kind === 'REST')) {
        const emerged = Object.keys(out.player.bank.universalSkills).filter(id => !before.bank.universalSkills[id]).map(id => ({ id }));
        await RestDoor.file(emerged, world, pc);
      }
    } finally {
      walking = false;
    }
  }
};
