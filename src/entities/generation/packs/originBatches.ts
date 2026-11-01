/**
 * WHO YOU WERE: the bank behind the first screens of creation (Pedro's June design, D35-D37).
 * Add a batch and the flow grows, with no code. `OriginBank` is its law.
 *
 * `id` is what the record keeps and what stays hidden. Everything else in `says`, `line`,
 * `asks` and the like is shown, so those strings are plain: a person picks a life, and is
 * never told what kind of story it is.
 *
 * Words and tags only. A kit asks for a kind of thing, and the world's content answers.
 */

export interface IOrigin {
  id: string;
  says: string;
  line: string;
  /** An attribute, or null: the top of what the certificate dealt is the focus. */
  main: string | null;
  sub: string | null;
  /** One of the four silhouettes. It only starts chosen. */
  silhouette: string;
  /** What fits, best first. The first starts chosen. */
  kits: string[];
  /** Tags the first skills lean toward. */
  leans: { main: string[]; sub: string[] };
}

export type KitSource = 'weapon' | 'armor' | 'tool' | 'carrier' | 'wardrobe' | 'consumable';
export interface IKitAsk { from: KitSource; tag?: string }
export interface IKit { id: string; says: string; line: string; pieces: IKitAsk[] }

export interface IAnswer { id: string; says: string; leans: string[] }
export interface IQuestion { id: string; asks: string; answers: IAnswer[] }

export interface IOriginBatch {
  id: string;
  origins: IOrigin[];
  kits: IKit[];
  questions: IQuestion[];
  /** What the Seed says last, when no model is there to say it. */
  closings: string[];
  /** One line for a skill, when no model is there to write one. */
  flavors: string[];
  /** What fate calls a person when Kami does not answer, and what it says. */
  fateNames?: string[];
  fateLines?: string[];
}

export const ORIGIN_BATCHES: IOriginBatch[] = [
  {
    id: 'origins_001',
    origins: [
      {
        id: 'economic_genius', says: 'YOU COULD MAKE MONEY FROM NOTHING',
        line: 'You read a market the way other people read a street. Prices told you things.',
        main: 'bartering', sub: 'charisma', silhouette: 'OPERATOR',
        kits: ['kit_light', 'kit_working', 'kit_field'], leans: { main: ['metal', 'ore'], sub: ['paper', 'grain'] }
      },
      {
        id: 'science_wielder', says: 'YOU KNEW HOW THINGS WORK',
        line: 'You took it apart first. The explanation was usually the most useful thing in the room.',
        main: 'intelligence', sub: 'engineering', silhouette: 'OPERATOR',
        kits: ['kit_bench', 'kit_focus', 'kit_working'], leans: { main: ['glass', 'sand', 'mineral'], sub: ['ore', 'laser_cutter', 'drill', 'mining_laser'] }
      },
      {
        id: 'power_fantasy', says: 'YOU WERE THE STRONGEST IN ANY ROOM',
        line: 'People stepped aside. You rarely asked them to, and you rarely had to ask twice.',
        main: 'strength', sub: 'constitution', silhouette: 'STREET_SAMURAI',
        kits: ['kit_field', 'kit_long', 'kit_working'], leans: { main: ['blunt', 'pickaxe'], sub: ['ore', 'stone'] }
      },
      {
        id: 'infrastructure_politics', says: 'YOU BUILT THINGS, AND RAN THEM',
        line: 'Roads, councils, who answers to whom. You liked a place better once it had a plan.',
        main: 'leadership', sub: 'engineering', silhouette: 'OPERATOR',
        kits: ['kit_working', 'kit_bench', 'kit_light'], leans: { main: ['stone', 'mineral'], sub: ['saw', 'wood'] }
      },
      {
        id: 'jack_of_all_trades', says: 'YOU DID A LITTLE OF EVERYTHING',
        line: 'Nobody ever called you the best at anything. They called you when the best was busy.',
        main: null, sub: null, silhouette: 'NOMAD',
        kits: ['kit_working', 'kit_field', 'kit_light'], leans: { main: ['axe', 'wood'], sub: ['fiber', 'flora'] }
      },
      {
        id: 'slow_life', says: 'YOU WANTED A QUIET LIFE',
        line: 'A field, a door that sticks, a long day of small work. You were very nearly left alone.',
        main: 'endurance', sub: 'perception', silhouette: 'NOMAD',
        kits: ['kit_pantry', 'kit_working', 'kit_light'], leans: { main: ['grain', 'seed'], sub: ['fruit', 'berry'] }
      },
      {
        id: 'cooking', says: 'YOU COOKED',
        line: 'People came back for it, and some of them stayed. Anything can be made to feed someone.',
        main: 'dexterity', sub: 'perception', silhouette: 'NOMAD',
        kits: ['kit_pantry', 'kit_bench', 'kit_light'], leans: { main: ['berry', 'fruit'], sub: ['grain', 'seed'] }
      },
      {
        id: 'animal_tamer', says: 'ANIMALS CAME TO YOU',
        line: 'You never quite worked out why. The ones that bit everyone else slept at your door.',
        main: 'charisma', sub: 'leadership', silhouette: 'ARCANIST',
        kits: ['kit_long', 'kit_light', 'kit_pantry'], leans: { main: ['fiber', 'flora'], sub: ['cloth', 'wood'] }
      }
    ],
    kits: [
      {
        id: 'kit_field', says: 'SOMETHING TO HIT WITH',
        line: 'A weapon for close work, something to wear, a bag. It is what most people ask for.',
        pieces: [{ from: 'weapon', tag: 'melee' }, { from: 'armor', tag: 'armor' }, { from: 'wardrobe', tag: 'bag' }]
      },
      {
        id: 'kit_long', says: 'SOMETHING TO KEEP THEM AT A DISTANCE',
        line: 'A weapon for the far end of a field, a holder for what it looses, something to wear.',
        pieces: [{ from: 'weapon', tag: 'ranged' }, { from: 'wardrobe', tag: 'quiver' }, { from: 'armor', tag: 'armor' }]
      },
      {
        id: 'kit_focus', says: 'SOMETHING TO ASK THROUGH',
        line: 'A focus to hold, something to wear, a case for small things. What answers is not the bank\'s concern.',
        pieces: [{ from: 'weapon', tag: 'caster' }, { from: 'armor', tag: 'armor' }, { from: 'carrier', tag: 'pouch' }]
      },
      {
        id: 'kit_working', says: 'THE TOOLS OF THE WORK',
        line: 'A tool for what grows, a tool for what is under it, a bag to bring it home in.',
        pieces: [{ from: 'tool', tag: 'chopping' }, { from: 'tool', tag: 'mining' }, { from: 'wardrobe', tag: 'bag' }]
      },
      {
        id: 'kit_bench', says: 'WHAT A BENCH WANTS',
        line: 'Tools for a steady hand, and a belt to keep them on.',
        pieces: [{ from: 'tool', tag: 'saw' }, { from: 'tool', tag: 'blunt' }, { from: 'wardrobe', tag: 'belt' }]
      },
      {
        id: 'kit_pantry', says: 'FOOD, AND A WAY TO GET MORE',
        line: 'What grows and can be eaten, a tool to cut it with, somewhere to keep it.',
        pieces: [{ from: 'consumable', tag: 'food' }, { from: 'consumable', tag: 'food' }, { from: 'tool', tag: 'chopping' }, { from: 'wardrobe', tag: 'bag' }]
      },
      {
        id: 'kit_light', says: 'ALMOST NOTHING',
        line: 'A bag, a belt, one good thing to eat. You can walk out of anything like this.',
        pieces: [{ from: 'wardrobe', tag: 'bag' }, { from: 'wardrobe', tag: 'belt' }, { from: 'consumable', tag: 'food' }]
      }
    ],
    questions: [
      {
        id: 'q_left',
        asks: 'What did you leave unfinished.',
        answers: [
          { id: 'a_left_work', says: 'THE WORK.', leans: ['blunt', 'saw', 'stone'] },
          { id: 'a_left_people', says: 'SOMEONE WAS WAITING.', leans: ['cloth', 'fiber', 'grain'] },
          { id: 'a_left_nothing', says: 'NOTHING. I MADE SURE.', leans: ['paper', 'glass', 'sand'] },
          { id: 'a_left_land', says: 'THE LAND. IT WANTS TENDING.', leans: ['seed', 'grain', 'flora'] }
        ]
      },
      {
        id: 'q_hands',
        asks: 'Your hands are new. What do they reach for.',
        answers: [
          { id: 'a_hands_edge', says: 'AN EDGE.', leans: ['axe', 'saw'] },
          { id: 'a_hands_weight', says: 'SOMETHING HEAVY.', leans: ['blunt', 'pickaxe'] },
          { id: 'a_hands_fine', says: 'SOMETHING FINE.', leans: ['fiber', 'glass', 'berry'] },
          { id: 'a_hands_soil', says: 'THE GROUND.', leans: ['grain', 'fruit', 'flora'] }
        ]
      },
      {
        id: 'q_hurt',
        asks: 'Something here will try to hurt you. It is not personal. What do you do.',
        answers: [
          { id: 'a_hurt_stand', says: 'STAND THERE.', leans: ['metal', 'ore'] },
          { id: 'a_hurt_leave', says: 'BE ELSEWHERE.', leans: ['fiber', 'wood'] },
          { id: 'a_hurt_talk', says: 'ASK WHAT IT WANTS.', leans: ['paper', 'cloth'] },
          { id: 'a_hurt_trap', says: 'HAVE PREPARED FOR THIS.', leans: ['stone', 'sand', 'mineral'] }
        ]
      }
    ],
    closings: [
      'The bank honors it. What your hands knew, they still know.',
      'It is noted. You will find the work where you left it, under other names.',
      'That will do. The account is open, and it is yours to overdraw.',
      'Signed. Nobody here will ask where you learned that.'
    ],
    flavors: [
      'It was in your hands before you had these hands.',
      'You will not remember learning it. You will only find you can.',
      'The bank holds no record of where this came from. It holds a record of you having it.',
      'You did this somewhere else, for other reasons.'
    ],
    fateNames: ['THE ONE WHO THREW IT', 'A LOSING HAND, HELD', 'NOBODY\'S MARKER', 'THE HOUSE\'S MISTAKE', 'THE LAST STAKE', 'WHATEVER CAME UP'],
    fateLines: [
      'Nobody answered. The dice came up anyway.',
      'He did not come to the table. It was thrown without him, and it stands.',
      'The bank records what came up. It does not record why.'
    ]
  }
];
