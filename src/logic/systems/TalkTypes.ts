/**
 * THE TALK'S WORDS (D113, D116): the bands a model may answer in and the shape of what is
 * sent, with nothing else here, so the server's prompts can read them without the game.
 *
 * A model never writes a number (D57). It says a band, the law judges it, and the formula
 * in TalkLaw writes what the band is worth.
 */

/** The longest thing one person can say in one round. It guards the bill, and it is said to them. */
export const TALK_MESSAGE_LIMIT = 600;

/** How a thing said sits with who they are, from worst to best. */
export const JUDGE_BANDS = ['repels', 'grates', 'idle', 'lands', 'moves'] as const;
export type JudgeBand = typeof JUDGE_BANDS[number];

/** What an action does to someone's given word. The law axis reads this. */
export const PROMISE_BANDS = ['keeps', 'bends', 'breaks'] as const;
export type PromiseBand = typeof PROMISE_BANDS[number];

/** What an action does to somebody else, for gain. The good axis reads this. */
export const HARM_BANDS = ['none', 'some', 'grave'] as const;
export type HarmBand = typeof HARM_BANDS[number];

/** How much a quest asks. The formula turns it, and who asks, into a count. */
export const QUEST_SIZES = ['small', 'fair', 'large'] as const;
export type QuestSize = typeof QUEST_SIZES[number];

/** What an action asks of a person, and all alignment ever reads. */
export interface IMeans { promise: PromiseBand; harm: HarmBand }

export interface ILogLine {
  who: 'THEM' | 'NPC' | 'NOTE';
  text: string;
  /** Who said it, in a city where more than one person talks to the same keeper. */
  name?: string;
}

/** A person, in words: what a model has to work from. It holds no raw stat. */
export interface ITalkSurface {
  name: string;
  rank: string;
  temperament: string;
  objective: string;
  want: string;
  alignment: string;
  /** Each mental attribute, low, fair or high for their rank. */
  mind: Record<string, 'low' | 'fair' | 'high'>;
  /** What their hands know, by name. */
  hands: string[];
  /** A monster only: what kind of body says this, with its name kept out (D60). */
  body?: { tags: string[]; behavior?: string; size?: string; blurb?: string };
  /** A leader only: what drives it. */
  drive?: string;
  /** A keeper of the city center only: everything the hub has built, which they speak for. */
  city?: { knows: string[]; opens: string[] };
}

/**
 * One thing a person remembers, slot by slot, as it comes back to them (MemoryLaw.ts). A slot they
 * have forgotten reads "?", and a role the memory never held is left out. `ledger` marks a debt,
 * promise, threat or secret, open or settled.
 */
export type IMemoryLine = { day: number; ledger?: string } & Partial<Record<'who' | 'did' | 'what' | 'toWhom' | 'when' | 'where' | 'how' | 'why', string>>;

/** What a person will remember of a round, in words only. Code fills who, to whom, when and where. */
export interface IRememberWords { did: string; what: string; how: string; why: string }

export interface IRoundAsk {
  who: ITalkSurface;
  /** What comes to mind, oldest first: the strongest of what they remember and any open ledger entry this touches. */
  memory: IMemoryLine[];
  /** What the person said this round. */
  said: string;
  /** The keyed roll, 1 to 100. */
  roll: number;
  /** What the roll and the bonus must reach. */
  required: number;
  /** What the formula gives each band this round, so the words can fit how it will land. */
  bonuses: Record<string, number>;
  /** The disposition number as it stands. */
  meter: number;
  /** A person in a city: the goal set before this answer. */
  goal?: string;
  /** Q48: where the one speaking stands, so nobody is told to come to the counter they stand at. */
  where?: string;
  /** A monster: where it stands now, and whether what it wants may be said. */
  stance?: string;
  mayTellWant?: boolean;
}

export interface IRoundWords {
  band: JudgeBand;
  /** What the person asked of them, if anything. Alignment reads it. */
  asked: IMeans;
  reply: string;
  /** A monster's own want, in its words. Empty otherwise. */
  wants: string;
  /** What this person will remember of the round. Optional to the law: without it, code writes what it knows. */
  remember?: IRememberWords;
}

export interface IQuestWords { tag: string; size: QuestSize; text: string }

export interface IGoalWords {
  need: string;
  /** What they mean to do next, in their words. A leader's is one of its choices. */
  goal: string;
  means: IMeans;
  /** A building their goal needs, from what they are offered, or empty. */
  building: string;
  quest: IQuestWords | null;
}

export interface IGoalAsk {
  /** LADDER: people, who climb (D104). FREE: a leader, who holds a goal of its own (D93, D103). */
  binding: 'LADDER' | 'FREE';
  who: Partial<ITalkSurface>;
  /** What comes to mind, as a round's ask carries it. */
  memory: IMemoryLine[];
  /** What was just said to them, this round. */
  said?: string;
  /** The rung this person stands on. Their goal must answer it. */
  need?: string;
  /** The ladder in order, each rung saying whether it is met. */
  rungs?: { need: string; says: string; met: boolean }[];
  /** What a FREE goal may be, and the one it was dealt. */
  choices?: string[];
  dealt?: string;
  buildings: string[];
  questTags: string[];
  /** False when they already have one open: the law takes no second. */
  mayPost?: boolean;
  mayAsk?: boolean;
}
