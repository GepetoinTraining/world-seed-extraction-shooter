/**
 * DIALOGUE ACTIONS (Wave 9.7): every option on every NPC does something, or is
 * not there. This registry is the whole set — the dialogue window refuses an
 * action that is not here, and a test holds every authored option to this map.
 *
 * An effect is one of:
 *   reply     — the NPC answers; the words are the effect (a balance, a rumor)
 *   navigate  — the terminal switches screen (bank, missions, holdings)
 *   open      — a working panel opens (shop, sell, repair, lore, missions)
 *   deploy    — straight into a world through the one deploy door
 *   close     — the conversation ends
 */

import { GameClock } from '../../logic/time/GameClock';
import { IItem, ItemType, Rarity, UniversalRank } from '../../../shared/types';
import { usePlayerStore } from '../player/store';
import { useHubStore } from './store';
import { useWorldStore } from '../world/store';
import { WorldClock } from '../world/WorldClock';
import { ItemFactory } from '../../../shared/entities/item/ItemFactory';
import { Rng } from '../../../shared/logic/rng/DeterministicRNG';
import { GoldCommit } from '../../logic/economy/GoldCommit';
import { LORE_FRAGMENTS } from '../lore/LoreBible';
import { ContentRegistry } from '../../../shared/logic/theme/ContentRegistry';
import { INN_FEE, RestSystem } from '../../logic/systems/RestSystem';
import { RestDoor } from '../../logic/systems/RestDoor';
import { Tutorial } from '../../logic/systems/Tutorial';
import { StatSystem } from '../../../shared/logic/systems/StatSystem';
import { StudySystem } from '../../logic/systems/StudySystem';
import { StudyDoor } from '../../logic/systems/StudyDoor';

export type DialogueEffect =
  | { kind: 'reply'; text: string }
  | { kind: 'navigate'; view: 'BANK' | 'MISSIONS' | 'HOLDINGS' }
  | { kind: 'open'; panel: 'shop'; category: 'weapon' | 'armor' | 'consumable' }
  | { kind: 'open'; panel: 'repair' | 'lore' | 'missions' | 'ledger' | 'plan' | 'tavern' | 'guild' }
  | { kind: 'open'; panel: 'sell'; npcId?: string }
  | { kind: 'open'; panel: 'apprentices'; npcId: string }
  | { kind: 'deploy' }
  | { kind: 'close' };

type Handler = (payload?: any) => DialogueEffect;

const bank = () => usePlayerStore.getState().player.bank;
const stashItems = () => bank().stashTabs[0]?.items || [];

/** Gold out of the player, into the hub treasury, onto the ledger. */
function charge(amount: number, reason: string, data: Record<string, any> = {}): boolean {
  const p = usePlayerStore.getState().player;
  const hubId = useHubStore.getState().activeHubId || 'hub_unknown';
  if (p.bank.gold < amount) return false;
  usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: s.player.bank.gold - amount } } }));
  void GoldCommit.commit({
    rows: [{ type: 'GOLD_DELTA', data: { reason, amount: -amount, treasuryId: hubId, treasuryDelta: amount, ...data } }],
    treasury: { worldUid: hubId, delta: amount }
  });
  return true;
}

/** D50: even a paid reader needs the night. What she has is known at the next rest. */
function studyOvernight(ids: string[]) {
  usePlayerStore.setState(s => ({ player: ids.reduce((p, id) => RestSystem.queueStudy(p, id), s.player) }));
}

/** Repair cost: a quarter of the item's value, scaled by what's missing. */
export function repairCost(item: { value: number; stats: { durability?: number; maxDurability?: number } }, attributes = usePlayerStore.getState().player.attributes): number {
  const { durability, maxDurability } = item.stats;
  if (durability === undefined || !maxDurability || durability >= maxDurability) return 0;
  const missing = (maxDurability - durability) / maxDurability;
  return Math.max(5, Math.ceil((item.value || 20) * 0.25 * missing * StatSystem.repairFactor(attributes)));
}

/** The one door to what can be repaired: the stash and the body (R6). */
export function repairable(): IItem[] {
  const equipment = usePlayerStore.getState().player.equipment;
  return [...stashItems(), ...(equipment?.items ?? [])]
    .filter(i => i.stats?.maxDurability && (i.stats.durability ?? 0) < i.stats.maxDurability);
}

export function repairItem(itemId: string): { ok: boolean; text: string } {
  const item = [...stashItems(), ...(usePlayerStore.getState().player.equipment?.items ?? [])].find(i => i.id === itemId);
  if (!item) return { ok: false, text: 'That is not in your stash or on your body.' };
  const cost = repairCost(item as any);
  if (cost === 0) return { ok: false, text: `${item.name} needs no work.` };
  if (!charge(cost, 'REPAIR', { itemId })) return { ok: false, text: `Repair costs ${cost}G. You carry ${bank().gold}G.` };
  const mended = <T extends IItem>(i: T): T => i.id === itemId ? { ...i, stats: { ...i.stats, durability: i.stats.maxDurability } } : i;
  usePlayerStore.setState(s => ({
    player: {
      ...s.player,
      equipment: s.player.equipment ? { ...s.player.equipment, items: s.player.equipment.items.map(mended) } : s.player.equipment,
      bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((tab, idx) =>
        idx === 0 ? { ...tab, items: tab.items.map(mended) } : tab
      ) }
    }
  }));
  return { ok: true, text: `${item.name} restored for ${cost}G. The frame remembers its shape.` };
}

/** The city hears from every world it serves. */
export const allLore = (): string[] => [...LORE_FRAGMENTS, ...ContentRegistry.list().flatMap(t => t.lore)];

/** The day's rumor: deterministic per hub and day, so the whole bar hears the same one. */
export function rumorOfTheDay(): string {
  const hubId = useHubStore.getState().activeHubId || 'hub_unknown';
  const day = GameClock.day();
  const rng = Rng.fromKey(`${hubId}:rumor:${day}`);
  const lore = allLore();
  return lore.length > 0 ? lore[rng.int(0, lore.length)] : 'Nobody is saying anything today.';
}

export const DIALOGUE_HANDLERS: Record<string, Handler> = {
  CLOSE: () => ({ kind: 'close' }),

  // --- The Consortium (Marcus Goldweave) ---
  OPEN_BANK: () => ({ kind: 'navigate', view: 'BANK' }),
  SHOW_BALANCE: () => ({
    kind: 'reply',
    text: `The ledger holds ${bank().gold.toLocaleString()} G under your signature. The bank honors it. The bank always honors it.`
  }),
  OPEN_LEDGER: () => ({ kind: 'open', panel: 'ledger' }),

  // --- Truthsight (Sera) ---
  IDENTIFY_ITEM: (payload) => {
    const cost = payload?.cost ?? 100;
    const unknown = stashItems().filter(i => i.isIdentified === false);
    if (unknown.length === 0) return { kind: 'reply', text: 'Nothing you carry is hiding anything from me.' };
    if (bank().gold < cost) return { kind: 'reply', text: `Truth costs ${cost}G. You carry ${bank().gold}G.` };
    const target = unknown.find(i => !RestSystem.isStudied(usePlayerStore.getState().player, i.id));
    if (!target) return { kind: 'reply', text: 'I have everything of yours already. Sleep on it. You will know when you wake.' };
    charge(cost, 'IDENTIFY', { itemId: target.id });
    studyOvernight([target.id]);
    return { kind: 'reply', text: 'Leave it with me tonight. Nobody knows a thing until they have slept on it, not even me.' };
  },
  IDENTIFY_ALL: (payload) => {
    const cost = payload?.cost ?? 500;
    const unknown = stashItems().filter(i => i.isIdentified === false);
    if (unknown.length === 0) return { kind: 'reply', text: 'Nothing you carry is hiding anything from me.' };
    if (bank().gold < cost) return { kind: 'reply', text: `All of it at once costs ${cost}G. You carry ${bank().gold}G.` };
    charge(cost, 'IDENTIFY_ALL', { count: unknown.length });
    studyOvernight(unknown.map(i => i.id));
    return { kind: 'reply', text: `${unknown.length} signal${unknown.length === 1 ? '' : 's'} on my table. You will know when you wake. Read them before you trust them.` };
  },
  OPEN_LORE: () => ({ kind: 'open', panel: 'lore' }),
  // D118: anyone in town can be studied. What it comes to is settled at a dream.
  STUDY_PERSON: (payload) => {
    const verdict = StudyDoor.start(StudySystem.targetOfPerson(payload));
    if (!verdict.ok) return { kind: 'reply', text: verdict.reason! };
    return { kind: 'reply', text: `Look all you like. ${verdict.seconds} seconds of it, and it will cost you ${verdict.cost} energy.` };
  },

  // --- The Conduit ---
  OPEN_MISSIONS: () => ({ kind: 'open', panel: 'missions' }),
  QUICK_DEPLOY: () => ({ kind: 'deploy' }),

  // --- Vendors ---
  OPEN_SHOP: (payload) => ({
    kind: 'open',
    panel: 'shop',
    category: payload?.category === 'armor' ? 'armor' : payload?.category === 'consumables' ? 'consumable' : 'weapon'
  }),
  OPEN_SELL: (payload) => ({ kind: 'open', panel: 'sell', ...(payload?.npcId ? { npcId: payload.npcId } : {}) }),
  OPEN_REPAIR: () => ({ kind: 'open', panel: 'repair' }),
  OPEN_APPRENTICES: (payload) => {
    void useHubStore.getState().resolveVendors();
    return { kind: 'open', panel: 'apprentices', npcId: payload?.npcId };
  },

  // --- The Rusty Anchor (Old Mags) ---
  REST: () => {
    void RestDoor.sleep('INN');
    return { kind: 'reply', text: `${INN_FEE}G, and the bed by the wall. Whatever you have been carrying around in your head, leave it on the pillow.` };
  },
  BUY_CONSUMABLE: (payload) => {
    const cost = payload?.cost ?? 10;
    if (!charge(cost, 'TAVERN', { itemId: payload?.itemId })) {
      return { kind: 'reply', text: `${cost}G. I water it down, I don't give it away.` };
    }
    const rng = Rng.fromKey(`tavern:ale:${Date.now().toString(36)}`);
    const ale = {
      ...ItemFactory.createResourceItem({
        id: 'drink_ale', name: 'Watered Ale', weight: 0.5,
        dimensions: { width: 1, height: 1 }, tags: ['consumable', 'drink']
      } as any, rng),
      type: ItemType.CONSUMABLE,
      rarity: Rarity.COMMON,
      rank: UniversalRank.F,
      value: 5,
      stats: { health_restore: 15 },
      description: 'Mostly water. The rest is a rumor of barley. Restores a little health in the field.'
    };
    usePlayerStore.setState(s => ({
      player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((tab, idx) =>
        idx === 0 ? { ...tab, items: [...tab.items, ale] } : tab
      ) } }
    }));
    return { kind: 'reply', text: 'One Watered Ale, stashed with your things. Mark it Carry if you want it on the drop.' };
  },
  GET_HINT: () => ({ kind: 'reply', text: `Heard this one today: "${rumorOfTheDay()}"` }),
  OPEN_TAVERN: () => ({ kind: 'open', panel: 'tavern' }),

  // --- The Land Office (Aurelio Quint): everything that develops the city ---
  OPEN_DEEDS: () => ({ kind: 'navigate', view: 'HOLDINGS' }),
  OPEN_PLAN: () => ({ kind: 'open', panel: 'plan' }),

  // --- The Hall of Banners (Grand Marshal Vex) ---
  OPEN_HALL: () => ({ kind: 'open', panel: 'guild' }),
  GUILD_LORE: () => ({
    kind: 'reply',
    text: 'People come out of the gate carrying years of their own living and no ground, and Mags can only give them a bed. They want things, the board fills, and they pay for what you bring. See to someone and we find them ground, and you bring what their house asks. As for you: the rank is ours to give. Bring out what stands above you, carry it yourself, and hand it over here.'
  }),

  // --- Honest closures: these halls are not open, and they say so ---
  AUCTION_LORE: () => ({
    kind: 'reply',
    text: 'The block is dark — the last auction cleared before your time and the gavel never came back. The lots across the plaza still trade, if you own a counter.'
  })
};

/** Every action a dialogue option may carry. The test holds HUB_NPCS to this set. */
export const HANDLED_ACTIONS = Object.keys(DIALOGUE_HANDLERS);

export function runDialogueAction(action: string, payload?: any): DialogueEffect {
  const handler = DIALOGUE_HANDLERS[action];
  if (!handler) {
    console.warn(`[DIALOGUE] Unregistered action refused: ${action}`);
    return { kind: 'reply', text: 'The terminal declines. [REFUSED: unregistered request]' };
  }
  return handler(payload);
}

/** Quick deploy target (Q2): the tutorial while it is the first order, then the first walkable world of the rest. */
export function quickDeployTargetId(): string | null {
  const now = Date.now();
  const worlds = useWorldStore.getState().availableWorlds.filter(w => WorldClock.momentAt(w, now).canDeploy);
  const tutorial = worlds.find(w => Tutorial.isTutorial(w));
  if (tutorial && Tutorial.firstOrderOpen(usePlayerStore.getState().player)) return tutorial.id;
  return (worlds.find(w => !Tutorial.isTutorial(w)) ?? tutorial)?.id ?? null;
}
