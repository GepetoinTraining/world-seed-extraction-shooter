/**
 * THE SHIPPED WEB BATCHES (D27, under D20's batch law and D28's tag law)
 *
 * Each batch is one dev-time run, banked as data. Run 005 is the registry: every
 * tag the game already used, audited, given one kind and one meaning, with the
 * three the audit retired on the record. Tools, stations, goods and recipes come
 * from each theme, compiled at install (D53).
 *
 * The law these pass through is WebBank.validateBatch. Nothing here is a cap and
 * no code reads a list of them by name: add a run, and the web grows.
 */

import { IWebBatch } from '../../../types';


export const WEB_BATCHES: IWebBatch[] = [
  {
    runId: 'run_005_the_registry',
    model: 'claude-opus-5-5 (dev batch, D27)',
    ranAt: 1793404800000, // 2026-10-31
    tags: [
      // TOOLS: what the work is done with. A weapon is a tool.
      { tag: 'axe', kind: 'tool', say: 'chopping', meaning: 'A wedge on a haft, swung to fell and split.', refuses: ['hatchet'] },
      { tag: 'saw', kind: 'tool', say: 'sawing', meaning: 'A toothed blade drawn back and forth through a thing.' },
      { tag: 'laser_cutter', kind: 'tool', say: 'cutting', meaning: 'A powered beam that parts what it is pointed at.' },
      { tag: 'pickaxe', kind: 'tool', say: 'mining', meaning: 'A pointed head on a haft, swung to break rock.', refuses: ['pick', 'mattock'] },
      { tag: 'drill', kind: 'tool', say: 'drilling', meaning: 'A turning bit that bores into what it is pressed against.' },
      { tag: 'mining_laser', kind: 'tool', say: 'mining', meaning: 'A powered beam tuned to loosen ore from a face.' },
      { tag: 'impact_hammer', kind: 'tool', say: 'breaking', meaning: 'A powered head that breaks rock by repeated blows.' },
      { tag: 'blade', kind: 'tool', say: 'slashing', meaning: 'An edge held in the hand and drawn or thrust.', refuses: ['sword'] },
      { tag: 'blunt', kind: 'tool', say: 'hammering', meaning: 'A mass held in the hand and brought down to crush.', refuses: ['bludgeon'] },
      { tag: 'projectile', kind: 'tool', say: 'shooting', meaning: 'Something loosed that does its work at a distance.', refuses: ['bullet', 'arrow'] },
      { tag: 'caster', kind: 'tool', say: 'casting at', meaning: 'A focus held in the hand that magic flows through.' },

      // FAMILIES: the broad nature of what is worked.
      { tag: 'flora', kind: 'family', say: 'plants', meaning: 'It grew: a living plant or a part of one.' },
      { tag: 'mineral', kind: 'family', say: 'rock', meaning: 'It was dug or picked up: rock, ore, sand, the ground itself.' },
      { tag: 'biological', kind: 'family', say: 'animals', meaning: 'A living animal body with no thought to speak of.' },
      { tag: 'humanoid', kind: 'family', say: 'people', meaning: 'Shaped like a person and fights like one.' },
      { tag: 'beast', kind: 'family', say: 'beasts', meaning: 'A wild animal grown large and dangerous.' },
      { tag: 'mechanical', kind: 'family', say: 'machines', meaning: 'Built, not born: joints, servos and plate.' },
      { tag: 'horror', kind: 'family', say: 'horrors', meaning: 'A body that should not hold together, and does.' },
      { tag: 'titan', kind: 'family', say: 'titans', meaning: 'A body so large that it is terrain with an opinion.' },
      { tag: 'vehicle', kind: 'family', say: 'vehicles', meaning: 'A machine that carries its own crew into a fight.' },
      { tag: 'god', kind: 'family', say: 'gods', meaning: 'A power with a body, and no interest in yours.' },
      { tag: 'tech', kind: 'family', say: 'devices', meaning: 'Engineered and powered: a made thing that runs on more than hands.' },
      { tag: 'ancient', kind: 'family', say: 'relics', meaning: 'Left behind by whoever came before the Seed last turned over.' },
      { tag: 'magic', kind: 'family', say: 'magic', meaning: 'Touched by what the Seed does when nobody asks it to.' },

      // MATERIALS: the substance worked.
      { tag: 'wood', kind: 'material', say: 'wood', meaning: 'Bears wood: it is timber or will saw into it, and answers a wood bill.', refuses: ['timber', 'lumber'] },
      { tag: 'stone', kind: 'material', say: 'stone', meaning: 'Bears stone: dense cut or uncut rock.', refuses: ['rock', 'boulder'] },
      { tag: 'ore', kind: 'material', say: 'ore', meaning: 'Rock that still holds its metal.' },
      { tag: 'metal', kind: 'material', say: 'metal', meaning: 'Bears metal: it is metal or melts down to it, and answers a metal bill.' },
      { tag: 'glass', kind: 'material', say: 'glass', meaning: 'Bears glass: it is glass or melts to it, and answers a glass bill.' },
      { tag: 'sand', kind: 'material', say: 'sand', meaning: 'Loose grains of rock that flow.' },
      { tag: 'fiber', kind: 'material', say: 'fiber', meaning: 'Long plant strands that can be spun or lashed.' },
      { tag: 'grain', kind: 'material', say: 'grain', meaning: 'The seed heads of grasses, gathered for food or straw.' },
      { tag: 'berry', kind: 'material', say: 'berries', meaning: 'A small soft fruit of a shrub.' },
      { tag: 'fruit', kind: 'material', say: 'fruit', meaning: 'The large fleshy fruit of a tree or vine.' },
      { tag: 'seed', kind: 'material', say: 'seeds', meaning: 'A young plant carried away to be set in new ground.' },
      { tag: 'cloth', kind: 'material', say: 'cloth', meaning: 'Woven stuff: threads made into a sheet.' },
      { tag: 'paper', kind: 'material', say: 'paper', meaning: 'Pressed sheets that take ink.' },
      { tag: 'ink', kind: 'material', say: 'ink', meaning: 'A dark liquid that stays where it was written.' },
      { tag: 'fire', kind: 'material', say: 'fire', meaning: 'Flame itself, as the thing being worked.' },

      // TRADES: a body of work with no one tool. Their tags compute the old track ids.
      { tag: 'carpentry', kind: 'trade', say: 'joining', meaning: 'Working wood at a bench: milling, joining, pressing.' },
      { tag: 'smelting', kind: 'trade', say: 'smelting', meaning: 'Burning metal out of what holds it.' },
      { tag: 'weaving', kind: 'trade', say: 'weaving', meaning: 'Making strands into sheets.' },
      { tag: 'glassblowing', kind: 'trade', say: 'firing', meaning: 'Firing sand and shaping what it becomes.' },
      { tag: 'alchemy', kind: 'trade', say: 'brewing', meaning: 'Boiling things together until something new is left.' },
      { tag: 'masonry', kind: 'trade', say: 'dressing', meaning: 'Squaring stone into something a wall can use.' },
      { tag: 'smithing', kind: 'trade', say: 'smithing', meaning: 'Shaping hot metal by the blow.' },
      { tag: 'identify_weapon', kind: 'trade', say: 'reading weapons', meaning: 'The schooled eye for what is worked into a weapon.' },
      { tag: 'identify_armor', kind: 'trade', say: 'reading armor', meaning: 'The schooled eye for what is worked into armor.' },
      { tag: 'identify_tool', kind: 'trade', say: 'reading tools', meaning: 'The schooled eye for what is worked into a tool.' },
      { tag: 'identify_material', kind: 'trade', say: 'reading goods', meaning: 'The schooled eye for what is worked into a good.' },
      { tag: 'identify_furniture', kind: 'trade', say: 'reading furniture', meaning: 'The schooled eye for what is worked into furniture.' },

      // ACTIONS: work of the body, with no object of its own.
      { tag: 'melee', kind: 'action', say: 'fighting', meaning: 'Fighting within arm\'s reach.' },
      { tag: 'ranged', kind: 'action', say: 'shooting', meaning: 'Fighting from a distance.' },
      { tag: 'defense', kind: 'action', say: 'standing up to', meaning: 'Standing up to harm: taking the blow, or being built to.' },
      { tag: 'social', kind: 'action', say: 'talking to', meaning: 'Moving a person with words or gifts.' },
      { tag: 'rescue', kind: 'action', say: 'rescuing', meaning: 'Getting a person out alive.' },
      { tag: 'scavenging', kind: 'action', say: 'scavenging', meaning: 'Going through what was left behind.' },
      { tag: 'analysis', kind: 'action', say: 'studying', meaning: 'Working out what a thing is by looking hard at it.' },
      { tag: 'survival', kind: 'action', say: 'living off', meaning: 'Making do with what is at hand and nothing else.' },
      { tag: 'sprint', kind: 'action', say: 'outrunning', meaning: 'Moving as fast as the body will go.' },
      { tag: 'stealth', kind: 'action', say: 'slipping past', meaning: 'Not being noticed.' },
      { tag: 'block', kind: 'action', say: 'blocking', meaning: 'Putting something in the way of a blow.' },

      // DESCRIPTIVE: true of a thing, and never a reason to split a skill.
      { tag: 'crafted', kind: 'descriptive', meaning: 'Made at a bench rather than found.' },
      { tag: 'heavy', kind: 'descriptive', meaning: 'A burden to carry or to wear.' },
      { tag: 'light', kind: 'descriptive', meaning: 'Little burden to carry or to wear.' },
      { tag: 'rare', kind: 'descriptive', meaning: 'Seldom found.' },
      { tag: 'salvage', kind: 'descriptive', meaning: 'A piece of something that was already something else.' },
      { tag: 'improvised', kind: 'descriptive', meaning: 'Made in the field with no bench.' },
      { tag: 'masterwork', kind: 'descriptive', meaning: 'Made at the very top of what a maker can do.' },
      { tag: 'generic', kind: 'descriptive', meaning: 'Plain of its kind, with nothing to mark it.' },
      { tag: 'crit', kind: 'descriptive', meaning: 'Built to land the rare blow that matters.' },
      { tag: 'one_hand', kind: 'descriptive', meaning: 'Held in one hand.' },
      { tag: 'two_hand', kind: 'descriptive', meaning: 'Held in both hands.' },
      { tag: 'armored', kind: 'descriptive', meaning: 'Plated against blows.' },
      { tag: 'flying', kind: 'descriptive', meaning: 'Moves through the air.' },
      { tag: 'chopping', kind: 'descriptive', meaning: 'What a tool says it does: cut by the swing.' },
      { tag: 'mining', kind: 'descriptive', meaning: 'What a tool says it does: break into rock.' },
      { tag: 'offense', kind: 'descriptive', meaning: 'Worn to hit harder rather than to last longer.' },
      { tag: 'rogue', kind: 'descriptive', meaning: 'Suited to a quick and quiet way of fighting.' },
      { tag: 'physical', kind: 'descriptive', meaning: 'Does its harm by plain force.' },
      { tag: 'precision', kind: 'descriptive', meaning: 'Done by aim rather than by force.' },
      { tag: 'energy', kind: 'descriptive', meaning: 'Does its work through stored charge.' },
      { tag: 'poison', kind: 'descriptive', meaning: 'Harmful to whoever swallows it.' },

      // MAGNITUDE: how much of something. Rank rides beside identity, and so does this.
      { tag: 'grunt', kind: 'magnitude', meaning: 'The common weight of a creature.' },
      { tag: 'elite', kind: 'magnitude', meaning: 'A heavier weight of creature than the rest of its kind.' },
      { tag: 'boss', kind: 'magnitude', meaning: 'The heaviest weight of creature, one to a place.' },

      // USES: what a thing answers.
      { tag: 'building', kind: 'use', meaning: 'Answers a building bill: a wall can be raised from it.' },
      { tag: 'food', kind: 'use', meaning: 'Can be eaten for what it gives.' },
      { tag: 'drink', kind: 'use', meaning: 'Can be drunk for what it gives.' },
      { tag: 'consumable', kind: 'use', meaning: 'Used up when used.' },
      { tag: 'station', kind: 'use', meaning: 'Stands in a room and is worked at.' },
      { tag: 'untradeable_on_death', kind: 'use', meaning: 'Does not change hands when its holder falls.' },

      // CLASSES: what kind of item it is.
      { tag: 'tool', kind: 'class', meaning: 'An item carried to work with, in its own slot.' },
      { tag: 'armor', kind: 'class', meaning: 'An item worn on the body against harm.' },
      { tag: 'weapon', kind: 'class', meaning: 'An item carried to fight with.' },
      { tag: 'jewelry', kind: 'class', meaning: 'A small worn piece: a ring, a stud, a pendant.' },
      { tag: 'ring', kind: 'class', meaning: 'A band worn on a finger.' },
      { tag: 'bag', kind: 'class', meaning: 'An item that adds to what can be carried.' },
      { tag: 'belt', kind: 'class', meaning: 'A strap worn at the waist that opens pouch slots.' },
      { tag: 'pouch', kind: 'class', meaning: 'A small holder that hangs from a belt.' },
      { tag: 'quiver', kind: 'class', meaning: 'A holder for what a ranged weapon looses.' },
      { tag: 'shoulder', kind: 'class', meaning: 'A piece worn across the shoulders.' },
      { tag: 'cart', kind: 'class', meaning: 'A towed bed that unfolds from a kit.' },
      { tag: 'deed', kind: 'class', meaning: 'A paper that says who owns a lot.' },
      { tag: 'template', kind: 'class', meaning: 'A signed plan a building can be raised from.' },
      { tag: 'charm', kind: 'class', meaning: 'An item whose magic names what a death keeps.' },
      { tag: 'lore', kind: 'class', meaning: 'An item that exists to be read.' },
      { tag: 'document', kind: 'class', meaning: 'A sheet or stack with writing on it.' },
      { tag: 'scroll', kind: 'class', meaning: 'A rolled sheet whose writing does something.' },
      { tag: 'trade_note', kind: 'class', meaning: 'A note in a maker\'s own hand about their trade.' },
      { tag: 'npc_contract', kind: 'class', meaning: 'A bond that says a person walks with you.' },
      { tag: 'frame', kind: 'class', meaning: 'A cognitive frame: mind held in a head position.' },
      { tag: 'accessory', kind: 'class', meaning: 'A worn piece that is neither armor nor jewelry.' },
      { tag: 'boots', kind: 'class', meaning: 'Worn on the feet.' },
      { tag: 'gloves', kind: 'class', meaning: 'Worn on the hands.' },
      { tag: 'staff', kind: 'class', meaning: 'A long rod carried in both hands.' },
      { tag: 'helmet', kind: 'class', meaning: 'A hard piece worn on the head.' },
      { tag: 'head', kind: 'class', meaning: 'Sits on the head, whatever it is made of.' },
      { tag: 'chest', kind: 'class', meaning: 'A piece worn over the chest.' },
      { tag: 'body', kind: 'class', meaning: 'Covers the whole trunk.' },
      { tag: 'amulet', kind: 'class', meaning: 'A charm hung from the neck.' },
      { tag: 'plate', kind: 'class', meaning: 'Armor of rigid sheets rather than cloth or hide.' },
      { tag: 'evasion', kind: 'class', meaning: 'Armor built to not be where the blow lands.' },
      { tag: 'energy_shield', kind: 'class', meaning: 'Armor built to soak harm with stored charge.' },
      { tag: 'utility', kind: 'class', meaning: 'Carried for what it reads rather than what it hits.' },

      // SCOPES: what a banked affix may roll on.
      { tag: 'mob', kind: 'scope', meaning: 'A banked affix that may land on a monster, once magic is unlocked.' },
      { tag: 'resource', kind: 'scope', meaning: 'Rolls on a harvested material.' },
      { tag: 'process_carpentry', kind: 'scope', meaning: 'Banked for what carpentry leaves behind.' },
      { tag: 'process_smelting', kind: 'scope', meaning: 'Banked for what smelting leaves behind.' },
      { tag: 'process_weaving', kind: 'scope', meaning: 'Banked for what weaving leaves behind.' },
      { tag: 'process_glassblowing', kind: 'scope', meaning: 'Banked for what glassblowing leaves behind.' },
      { tag: 'process_alchemy', kind: 'scope', meaning: 'Banked for what alchemy leaves behind.' },
      { tag: 'process_masonry', kind: 'scope', meaning: 'Banked for what masonry leaves behind.' },
      { tag: 'process_smithing', kind: 'scope', meaning: 'Banked for what smithing leaves behind.' },

      // STATS AND CONTEXTS: what a moment was like. Neither ever identifies.
      { tag: 'strength', kind: 'stat', meaning: 'The strength attribute, named in a context.' },
      { tag: 'charisma', kind: 'stat', meaning: 'The charisma attribute, named in a context.' },
      { tag: 'gathering', kind: 'context', meaning: 'The moment was a harvest.' },
      { tag: 'craft', kind: 'context', meaning: 'The moment was a job at a bench, or in the hand.' },
      { tag: 'study', kind: 'context', meaning: 'The moment was a sitting with a piece.' },
      { tag: 'intel', kind: 'context', meaning: 'The moment turned up something worth knowing.' },
      { tag: 'pain', kind: 'context', meaning: 'The moment hurt.' },
      { tag: 'durability', kind: 'context', meaning: 'The moment tested what something could take.' },
      { tag: 'violence', kind: 'context', meaning: 'The moment was a blow landing.' },
      { tag: 'trade', kind: 'context', meaning: 'The moment was something changing hands.' },
      { tag: 'pickup', kind: 'context', meaning: 'The moment was picking a thing up.' },
      { tag: 'movement', kind: 'context', meaning: 'The moment was getting from one place to another.' },
      { tag: 'meme', kind: 'context', meaning: 'The moment was an idea moving between people.' },

      // The audit's retirements. The spellings stay on the books and are never reused.
      { tag: 'crafting', kind: 'context', meaning: 'Retired spelling of the bench moment.' },
      { tag: 'improvisation', kind: 'context', meaning: 'Retired spelling of the field-made moment.' },
      { tag: 'science', kind: 'context', meaning: 'Retired spelling of looking hard at a thing.' },

      // VERBS: what a held skill lets its holder do.
      { tag: 'fell', kind: 'verb', meaning: 'To bring a standing tree down.' },
      { tag: 'hew', kind: 'verb', meaning: 'To shape timber by the blow, without a mill.' },
      { tag: 'limb', kind: 'verb', meaning: 'To take a felled trunk clean of its branches.' },
      { tag: 'mine', kind: 'verb', meaning: 'To take metal-bearing rock out of a face.' },
      { tag: 'quarry', kind: 'verb', meaning: 'To take whole stone out of the ground.' },
      { tag: 'prospect', kind: 'verb', meaning: 'To read a rock face for what it holds.' },
      { tag: 'forage', kind: 'verb', meaning: 'To gather what grows, by hand, knowing what is safe.' },
      { tag: 'glean', kind: 'verb', meaning: 'To take grain by hand from standing stalks.' },
      { tag: 'pluck', kind: 'verb', meaning: 'To take fruit from the branch without bruising it.' },
      { tag: 'mill', kind: 'verb', meaning: 'To run wood into boards at a bench.' },
      { tag: 'join', kind: 'verb', meaning: 'To make boards into a thing that stands.' },
      { tag: 'smelt', kind: 'verb', meaning: 'To run ore through the fire until only metal is left.' },
      { tag: 'square', kind: 'verb', meaning: 'To true a stone until a wall will take it.' },
      { tag: 'weave', kind: 'verb', meaning: 'To cross strands into a sheet.' },
      { tag: 'fire_glass', kind: 'verb', meaning: 'To run sand through the fire until it clears.' },
      { tag: 'boil', kind: 'verb', meaning: 'To cook things down until something new is left.' },
      { tag: 'forge', kind: 'verb', meaning: 'To shape metal at heat by hammer.' },
      { tag: 'swing', kind: 'verb', meaning: 'To land a blow that goes where it was meant.' },
      { tag: 'parley', kind: 'verb', meaning: 'To talk a person round.' }
    ],
    retire: [
      { tag: 'crafting', replacedBy: 'craft', why: 'The audit: craft, crafting and crafted were three spellings of one root. The context keeps craft.' },
      { tag: 'improvisation', replacedBy: 'improvised', why: 'The audit: improvisation and improvised were two spellings of one thing.' },
      { tag: 'science', replacedBy: 'analysis', why: 'The audit: science, intel and analysis all named looking hard at a thing. The action keeps analysis.' }
    ],
    verbLinks: [
      { tags: ['berry'], verb: 'forage', rung: 0 },
      { tags: ['fiber'], verb: 'forage', rung: 0 },
      { tags: ['grain'], verb: 'glean', rung: 0 },
      { tags: ['fruit'], verb: 'pluck', rung: 0 },
      { tags: ['carpentry'], verb: 'mill', rung: 0 },
      { tags: ['carpentry'], verb: 'join', rung: 1 },
      { tags: ['smelting'], verb: 'smelt', rung: 0 },
      { tags: ['masonry'], verb: 'square', rung: 0 },
      { tags: ['weaving'], verb: 'weave', rung: 0 },
      { tags: ['glassblowing'], verb: 'fire_glass', rung: 0 },
      { tags: ['alchemy'], verb: 'boil', rung: 0 },
      { tags: ['smithing'], verb: 'forge', rung: 0 },
      { tags: ['melee'], verb: 'swing', rung: 0 },
      { tags: ['social'], verb: 'parley', rung: 0 }
    ],
    names: [
      { tags: ['axe', 'flora', 'wood'], name: 'Felling', flavor: 'Knowing where a trunk wants to fall.' },
      { tags: ['mineral', 'pickaxe', 'stone'], name: 'Quarrying', flavor: 'Hearing where the stone already wants to split.' },
      { tags: ['metal', 'mineral', 'ore', 'pickaxe'], name: 'Mining', flavor: 'Following a vein the rock would rather keep.' },
      { tags: ['berry', 'flora'], name: 'Foraging', flavor: 'Knowing which berry to leave alone.' },
      { tags: ['flora', 'fruit'], name: 'Fruit-Picking' },
      { tags: ['flora', 'grain'], name: 'Gleaning' },
      { tags: ['fiber', 'flora'], name: 'Fiber-Stripping' },
      { tags: ['glass', 'mineral', 'sand'], name: 'Sand-Sifting' },
      { tags: ['glass', 'mineral'], name: 'Shard-Picking' },
      { tags: ['metal', 'mineral'], name: 'Scrap-Hauling' },
      { tags: ['mineral', 'stone'], name: 'Stone-Gathering' },
      { tags: ['flora', 'seed', 'wood'], name: 'Sapling-Lifting' },
      { tags: ['blade', 'melee'], name: 'Bladework' },
      { tags: ['blunt', 'melee'], name: 'Bludgeoning' },
      { tags: ['melee'], name: 'Brawling' },
      { tags: ['projectile', 'ranged', 'tech'], name: 'Ballistics' },
      { tags: ['fire', 'magic'], name: 'Pyromancy' },
      { tags: ['defense'], name: 'Pain Tolerance' },
      { tags: ['block', 'defense'], name: 'Aegis' },
      { tags: ['sprint'], name: 'Athletics' },
      { tags: ['stealth'], name: 'Covert Work' },
      { tags: ['ancient', 'analysis'], name: 'Archaeology' },
      { tags: ['analysis', 'tech'], name: 'Reverse Engineering' },
      { tags: ['analysis'], name: 'Appraisal' },
      { tags: ['social'], name: 'Persuasion' },
      { tags: ['rescue', 'social'], name: 'Escort' },
      { tags: ['scavenging'], name: 'Scavenging' },
      { tags: ['survival'], name: 'Field-Making' },
      { tags: ['carpentry'], name: 'Carpentry' },
      { tags: ['smelting'], name: 'Smelting' },
      { tags: ['weaving'], name: 'Weaving' },
      { tags: ['glassblowing'], name: 'Glassblowing' },
      { tags: ['alchemy'], name: 'Alchemy' },
      { tags: ['masonry'], name: 'Masonry' },
      { tags: ['smithing'], name: 'Smithing' },
      { tags: ['identify_weapon'], name: 'The Weapon Eye' },
      { tags: ['identify_armor'], name: 'The Armor Eye' },
      { tags: ['identify_tool'], name: 'The Tool Eye' },
      { tags: ['identify_material'], name: 'The Goods Eye' },
      { tags: ['identify_furniture'], name: 'The Furniture Eye' }
    ]
  },
  // D100: "it becomes a skill as well, tax evasion!" Moves WebBank.version(), so the next world pins this.
  {
    runId: 'run_007_the_books',
    model: 'claude-opus-5-5',
    ranAt: 20261101,
    tags: [
      { tag: 'tax_evasion', kind: 'trade', meaning: 'Keeping part of a haul off a world\'s books at the gate.' }
    ],
    names: [
      { tags: ['tax_evasion'], name: 'Tax Evasion', flavor: 'Knowing which crate the clerk will not open.' }
    ]
  },
  {
    runId: 'run_008_the_three_benches',
    model: 'claude-opus-5-5',
    ranAt: 20261101,
    tags: [
      { tag: 'craftsmanship', kind: 'trade', meaning: 'Knowing how things go together, before anyone has named a way of doing it.' }
    ],
    names: [
      { tags: ['craftsmanship'], name: 'Crafting', flavor: 'Three benches, and none of them taught it by name.' }
    ]
  },
  {
    runId: 'run_009_the_land',
    model: 'claude-opus-5-5',
    ranAt: 20261101,
    tags: [
      { tag: 'farming', kind: 'trade', meaning: 'Sowing a plot and taking what comes up.' },
      { tag: 'grove_keeping', kind: 'trade', meaning: 'Keeping what stands and bears, year on year.' },
      { tag: 'herding', kind: 'trade', meaning: 'Keeping living things at home, and getting them to stay.' },
      { tag: 'cooking', kind: 'trade', meaning: 'Making a meal out of what can be eaten.' },
      { tag: 'trapping', kind: 'trade', meaning: 'Taking something alive, without a fight.' },
      { tag: 'taming', kind: 'trade', meaning: 'Getting something caught to answer to a hand.' },
      { tag: 'snare', kind: 'class', meaning: 'Tied to hold something alive. It is spent when it is set.' },
      { tag: 'cage', kind: 'class', meaning: 'Holds something alive, for carrying.' },
      { tag: 'meal', kind: 'class', meaning: 'Food someone cooked.' },
      { tag: 'meat', kind: 'descriptive', meaning: 'Came off an animal.' }
    ],
    names: [
      { tags: ['farming'], name: 'Farming', flavor: 'The ground does most of it. Do not tell the ground.' },
      { tags: ['grove_keeping'], name: 'Grove Keeping', flavor: 'For anyone in no hurry.' },
      { tags: ['herding'], name: 'Herding', flavor: 'Counting them is the easy part.' },
      { tags: ['cooking'], name: 'Cooking', flavor: 'Some of this was alive this morning.' },
      { tags: ['trapping'], name: 'Trapping', flavor: 'Patience, and a good knot.' },
      { tags: ['taming'], name: 'Taming', flavor: 'It has not forgiven you. It has only stopped mentioning it.' }
    ]
  },
  // D114, Pedro: intelligent "is a skill". Moves WebBank.version(), so the next world pins this.
  {
    runId: 'run_010_a_mind_of_its_own',
    model: 'claude-opus-5-5',
    ranAt: 20261101,
    tags: [
      { tag: 'intelligent', kind: 'trade', meaning: 'A thing that can develop a mind and come to speak.' }
    ],
    names: [
      { tags: ['intelligent'], name: 'Intelligence', flavor: 'It has begun to think about you.' }
    ]
  }
];
