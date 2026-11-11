# Stats and their trees

Pedro, 2026-11-10: "I need you to give me the following, all the stats and their logical trees, we're going to send out a fan to think thorough every system and make a balance + affix {suffix, preffix} run, then we're going to re scale the uncommon magical rare epic... so on so forth with stats, and we're going to rebalance the combat. we're also needing a design pass."

This is that list, read from the code at `dbd5461`. Nothing here is a proposal: it says what the game does today.

| Section | What it holds |
|---|---|
| 1 | The shape of it, on one screen |
| 2 | The fifteen attributes: where a value comes from, and everything that reads it |
| 3 | What a character adds up to |
| 4 | The three ladders, rank, rarity and quality, and everything that reads each |
| 5 | A piece of gear: how it is minted, every stat it can carry, and an affix from end to end |
| 6 | A fight, as a tree |
| 7 | A creature |
| 8 | The numbers side by side, rank by rank |
| 9 | Where the numbers disagree with themselves |
| 10 | Every system that holds numbers, for splitting the work |

**How it was read.** The core files (`StatSystem`, `CombatMath`, `ThemeFormula`, `ItemFactory`, `constants`, `ProgressionSystem`) were read by hand. The tables in section 8 were computed by the game's own functions, not by hand. The rest was gathered by five sweeps of the code (attributes, ladders, item stats, the fight, a census of every tunable number) and spot-checked. A line marked *by reading* is something the code appears to do that was not run. Section 10 ends with what was not read at all.

Most numbers below are marked in the code as guesses to be tuned ("a guess until Wave 12" appears in 47 files).

How to read a tree: a line is what a thing is and how it is worked out, with the function that does it. A line indented under it is something that reads it. `s` is a rank's step: F is 0, E is 1, up to SSS at 8.

## 1. The shape of it

```
a character
├─ 15 attributes, floor 1, no top                      dealt at creation, +1 point a level, moved by frames
│   └─ each feeds one to five derived numbers          section 2
├─ what is worn                                        StatSystem.total(stat) = sum over whole worn pieces + what skill circles made permanent
│   ├─ a piece's stats   = its kind's implicits x (1 + quality)  +  its affixes' rolled stats
│   ├─ a piece's power   = base power(rank, kind) x rank multiplier x rarity multiplier x (1 + quality)
│   └─ a weapon's damage is read from its power, never from a stat on it
├─ skills (the tech web): a tool on a material, held by doing; they add to a hit and cut what work costs
├─ aether: what a working spends, held in reserves sized by focus
└─ the day: energy, spent by every act and returned by a rest

a creature
├─ rank, build, threat, pace, size  ->  health, damage, speed, sight        ThemeFormula.creatureNumbers
├─ its line: +25% health and damage for each step down it
├─ a leader: more health and damage, from its own sheet
└─ a trait from the Director, only after a hub's magic unlock: more health and damage
```

## 2. The fifteen attributes

An attribute of 1 is the floor: someone at the floor plays as the bare numbers. `over(x)` below is the points above 1. Where a number must never pass a limit it climbs a curve that approaches it: `climb(p) = 2p / (2p + 100)`, so 10 points are 17% of the way, 50 points half, and it never arrives. All of this is `shared/logic/systems/StatSystem.ts` unless a line says otherwise.

No attribute is unread. Endurance and constitution have one reader each.

### Where a value comes from

```
an attribute's value
├─ at creation        fifteen values dealt: 5, 4, 4, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1, 1 (35 in all), shuffled,
│                     the two highest swapped onto the origin's main and second attribute
│                     a person the world makes gets the same deal, each value + their rank's step        NpcSheet (STAT_DEAL), creation
├─ a level            +1 point, put anywhere, no top                                                     ProgressionSystem (POINTS_PER_LEVEL)
├─ frames             six exist, written by hand; up to 3 worn; each moves several attributes by -3 to +4, floor 1
│                     they move the body's attributes too, not only the mind's                           cognitiveFrames.ts, LoadoutSystem (MAX_FRAMES)
└─ nothing else       no gear, no working and no status changes an attribute today
                      (the ten mind attributes can be written on an affix, but only for a frame, and nothing rolls on a frame)
```

### The body (HARDWARE on the sheet)

```
strength
├─ carry limit, kg = 30 + 10 x STR  + the worn bag's carry_bonus_kg + worn carry_capacity     InventorySystem.maxCarryWeight, LoadoutSystem.carryLimit
│   └─ above 80% of it the walk is halved                                                     InventorySystem.speedModifier (HEAVY_LOAD_RATIO 0.8, HEAVY_SPEED_MOD 0.5)
├─ melee damage x (1 + 0.04 x over)                                                           meleeScale -> CombatMath.outgoing
│   └─ a weapon tagged melee only: not a bare hand, not a thrown stone, not a tool's swing
├─ asked by heavy and two-handed gear: 1 + 2 x s                                              LoadoutSystem.requirementsFor
├─ a leader's damage: + base x 0.1 x STR above its rank's start                               ThemeFormula.leaderNumbers
└─ an escort who falls weighs 30 + 10 x their STR                                             Escort.ts

constitution
├─ health = 100 + 10 x CON + worn max_health                                                  maxHealth
└─ a leader's health: + base x (0.5 + 0.25 x CON above its rank's start)                      ThemeFormula.leaderNumbers

agility
├─ walk + 1.5% x over                                                                         paceBonus -> LoadoutSystem.walkTilesPerSecond (base 4 tiles a second)
├─ evasion rating + 2 x over, with worn evasion_rating                                        evasionRating -> CombatMath.incoming
│   └─ chance a blow misses = rating / (rating + 100)
└─ asked by light gear: 1 + 2 x s

dexterity
├─ rate of fire x (1 + 0.02 x over)                                                           fireRateScale -> CombatMath.fireCooldownMs
├─ accuracy rating + 3 x over, with worn accuracy_rating                                      accuracyRating -> CombatMath.outgoing
│   └─ chance a hit glances (half damage) = 0.2 x 100 / (100 + accuracy)
├─ the making roll: + (DEX - 1) on the twenty-sided roll                                      PairCraft.make
└─ asked by blades, one-handed and ranged gear: 1 + 2 x s

endurance
└─ energy for a day = 50 + 0.2 x END + worn max_energy                                        maxEnergy (Pedro: "0.2 of endurance + initial value + items")
```

### The mind (SOFTWARE)

```
intelligence
├─ skill experience kept x (1 + 0.03 x over)                                                  learnRate
├─ recon depth: 1 + floor((INT + PER + FOC - 3) / 6) levels a scan                            LoadoutSystem.reconEfficiency
├─ study roll: + (INT - 1) on the twenty-sided roll                                           StudySystem.rollSitting
├─ "Analyze Structure" is offered above INT 3                                                 InteractionEngine
├─ a person's will against being talked round: + 3 for each point of INT and of FOC above their rank's floor      TalkLaw.toughness
└─ an apprentice's trial: twenty-sided roll + level + (INT - 2 - rank step) against 18        ApprenticeRoad

focus
├─ working power + 2% x FOC (not over: the first point counts)                                castPower -> EffectSystem.resolve
├─ aether reserve = 20 + 5 x (FOC + worn focus)                                               WeaveSystem.capacity
├─ recon depth (with INT and PER, above)
├─ a person's will (with INT, above)
└─ asked by casters' gear: 1 + 2 x s

engineering
├─ a repair costs x (1 - 0.5 x climb(over))                                                   repairFactor
│   └─ repair = max(5, ceil(value x 0.25 x share missing x that factor))
├─ a bench job takes x 1 / (1 + 0.02 x over)                                                  craftClockFactor
└─ asked by tech gear: 1 + 2 x s

hacking
├─ beacon opens in 5000 ms x (1 - 0.6 x climb(over))                                          channelMs (also the forced exit)
└─ eyes that read a signal + 0.05 x over (shortens identify and study clocks)                 signalEyes -> StudySystem.askAt

perception
├─ crit chance + 0.5% x over, with worn crit_chance                                           critChance -> CombatMath.outgoing
├─ sight + 0.5 tile x over, with worn light_radius                                            sightPx
└─ recon depth (with INT and FOC, above)
```

### The self (WETWARE)

```
charisma
└─ a talk lands: 0.5 + 0.05 x CHA; with someone who wants respect 0.35 + 0.05 x CHA + 0.02 x over(INTIMIDATION)     talkOdds
    └─ what a round's roll must reach (1 to 100) = 100 x (1 - that) + 8 x their rank step + their will, kept within 5 to 95     TalkLaw.required

intimidation
├─ blows that land on you x (1 - 0.5 x climb(over))                                           blowFactor -> CombatMath.incoming
└─ talk with someone who wants respect (above)

subterfuge
├─ noise reduction + 2 x over, with worn noise_reduction                                      noiseReduction -> MobAI.tick
│   └─ how far a creature notices = its sight x 20 / (20 + reduction)
└─ dodging the exit levy: 0.05 + 0.70 x climb(over + skill level - 1)                         levyDodgeOdds

bartering
├─ the counter pays value x (0.6 + 0.4 x climb(over))                                         vendorOffer
├─ the shelf asks price x (1 - 0.3 x climb(over))                                             shopPrice
└─ a toll-keeper's own bartering raises the toll: x (1 + 0.05 x theirs)                       tollOwed

leadership
├─ a person follows at disposition 70 - 2 x over                                              recruitDisposition
├─ upkeep on what you own - 50% x climb(over)                                                 upkeepDiscountPct
├─ a keeper's seats at the bench: 1 + floor((LEA - 1) / 2)                                    ApprenticeRoad.roomFor (a keeper's sheet, not the player's)
└─ a leader contesting ground: twenty-sided roll + floor(LEA / 2)                             Territory.contest
```

### The mind as one number

```
the mind = the ten mind attributes added up (each at least 1)                                 TalkLaw.mindOf
├─ asking what someone wants: must reach 2 + 96 x theirs / (yours + theirs)                   TalkLaw.askRequired
└─ a leader's decisions a week = max(1, floor(the mind / 10))                                 DecisionLayer.perWeek
```

## 3. What a character adds up to

```
health            = 100 + 10 x CON + worn max_health                         StatSystem.maxHealth          full at each drop; nothing regenerates it
energy for a day  = 50 + 0.2 x END + worn max_energy                         StatSystem.maxEnergy          levels give none
aether reserve    = 20 + 5 x (FOC + worn focus), +2 for each gathering       WeaveSystem.capacity
carry limit, kg   = 30 + 10 x STR + bag + worn carry_capacity                LoadoutSystem.carryLimit      what is worn weighs nothing against it
walk, tiles/s     = 4 x max(0.1, 1 + 1.5% x over(AGI) + worn movement_speed + worn movement_speed_penalty)
                    x 0.5 when the pack is over 80% of the carry limit       LoadoutSystem.walkTilesPerSecond, InventorySystem.speedModifier
sight, tiles      = worn light_radius + 0.5 x over(PER)                      StatSystem.sightPx            added to what the window shows
pickup, px        = max(10, 30 + 20 x worn pickup_radius)                    StatSystem.pickupRadiusPx
pack              = 8 x 6 cells                                              InventorySystem (GRID_W, GRID_H)
level             = from experience. Level n asks 5 x n^1.5 common foes of the character's own rank
                    (5, then 14, then 26; the tenth asks 158). 1 attribute point a level, no top.      ProgressionSystem.levelCost
rank (F to SSS)   = granted by the guild's trial, never by experience (D83): hand in 3 + s identified things ranked above your own      guild.ts
```

## 4. The three ladders

### Rank: F, E, D, C, B, A, S, SS, SSS

Everything below reads a rank. The right-hand column is how much it grows from one rank to the next, which is what a balance run has to line up.

| What reads the rank | How | Grows each step by |
|---|---|---|
| A creature's health | `20 x 2.5^s x build` | x 2.5 |
| A creature's damage | `5 x 1.7^s x threat` | x 1.7 |
| A character's health | `100 + 10 x CON` | nothing: rank does not enter it |
| Gear's base power | `50 x 2.1^s` (a tool a third) | x 2.1 |
| Gear's power, as minted | base power `x RANK_MULTIPLIERS` (1, 1.2, 1.5, 2, 3, 5, 8, 13, 21) | x 2.5 to x 3.5, because rank is applied twice |
| A weapon's damage | `6 + 0.08 x power` | x 1.6 at first, then x 3.4 |
| An affix's value | banked range `x RANK_MULTIPLIERS` | x 1.2 to x 1.67 |
| Gear's implicit stats | each kind's own growth | x 1.25 (armour) to x 1.6 (accuracy, tool power) |
| What gear asks of an attribute | `1 + 2 x s` | + 2 |
| A working's magnitude | `6 x 1.7^s x cost` | x 1.7 |
| A heal, an energy draught | `30 x 1.8^s`, `10 x 1.8^s` | x 1.8 |
| Experience for a kill | 50, 100, 250, 600, 1500, 4000, 10000, 25000, 100000 | x 2 to x 4 |
| A level's cost | that x 5 x level^1.5 | the same |
| A skill's experience and power | cost `250 x level^2.1 x 1.6^skill rank`, power `(level - 1) x 2% x 1.5^skill rank` | x 1.6 and x 1.5 |
| Study, and making by two | bar `8 + 3 x (its rank - yours) + 2 x harm`; making `8 + 3 x rank` (+5 with no bench) | + 3 |
| Lore prices | gift 30, teach 40, raise 20, each `x 1.5^s` | x 1.5 |
| Talking someone round | + 8 to what the roll must reach | + 8 |
| Harvest | energy `6 + 2s`, seconds `2.5 + 0.5s`, tool power asked `5 + 8s`, hardness `x (1 + 0.5s)` | linear |
| A material's worth, a shelf price, a toll | `2 x 2.2^s x worth`, `6 x 2.2^s`, `8 x 2.2^s` | x 2.2 |
| Gear found on a creature | chance 5%, 8%, 12%, 18%, 25%, 35%, 50%, 75%, 100% | about x 1.45 |
| Which creature a place holds | weight `0.35^(ranks away)`, leaders x 0.04 | |
| A boss's posts and anchors | health `60 x 1.9^s`, anchors `2 + floor(s / 2)` | x 1.9 |
| Catching a creature | odds `x / (x + 1 + s)` | |
| A resident's keep | `5 + 2 x (s + 1)` a day | + 2 |
| A world deed found | `0.0002 x 1.8^s` | x 1.8 |
| The ground's own rank | bands of the land's noise: F below 0.42, E 0.50, D 0.57, C 0.63, B 0.68, A 0.74, then S; with a world difficulty set, at most 2 ranks over it | |

### Rarity: SCRAP, COMMON, UNCOMMON, RARE, EPIC, LEGENDARY, ARTIFACT

There is no tier named "magical" in the code. SCRAP is never produced. ARTIFACT is never rolled: it is set by hand on a god's or titan's drop and on the two highest deeds.

| What reads the rarity | How |
|---|---|
| The roll for a found piece | COMMON 60%, UNCOMMON 25%, RARE 10%, EPIC 4%, LEGENDARY 1% (`ItemFactory.rollRarity`) |
| How many affixes | COMMON none, UNCOMMON one (prefix or suffix, a coin), RARE 1 + 1, EPIC 2 + 2, LEGENDARY 3 + 3. ARTIFACT has no rule. |
| Power, and so a weapon's damage and its price | `RARITY_MULTIPLIERS`: 0.5, 1, 1.2, 1.5, 2, 2.5, 3.5 |
| Experience for a kill | a second table: 0.5, 1, 1.2, 1.5, 2.5, 5, 10. Every creature is spawned COMMON, so only the 1 is ever read. |
| Experience for a harvest or a chest | a share of the kill's worth: harvest 4%, chest 50%, + 25% for each hostile within 12 tiles |
| A chest filling again | waits `1 + floor((s + rarity step) / 2)` cycles; its roll must reach `min(20, 2 + 3 x rarity step + s)` |
| The ground's rarity | the same noise bands as rank (COMMON, UNCOMMON, RARE, EPIC, LEGENDARY, LEGENDARY, ARTIFACT) |
| How long a shop keeps a thing | `7 x (1 + uniqueness)` days |
| A room addition's tier | `min(4, 1 + rank tier + rarity tier)` |
| The card's frame | one per rarity |

A boss's piece (EPIC, LEGENDARY) and a chest's bonus piece (RARE) are given their rarity by hand. *By reading*, that changes the word on the card and not the power or the affixes.

Two other ladders stand beside this one and do not read it: a material's worth is `common, fine, rare` at x 1, x 3, x 9, and a drop table's odds are five bands (always, 60%, 25%, 5%, 0.5%).

### Quality: -0.20 to +0.20

```
quality
├─ rolled once at the mint, flat between -0.20 and +0.20                    ItemFactory
├─ scales a piece's implicits, its power and its price. It does not touch its affixes.
├─ the card's word: Crude below -0.12, Rough below -0.04, Standard to +0.04, Fine to +0.12, Superior above
├─ salvage takes 0.10 off, never below -0.20                                SalvageSystem
├─ a study that harms takes 0.10 off                                        StudySystem
└─ making by two sets it by how the roll came out                           PairCraft (QUALITY_SPAN 0.2)
```

## 5. What a piece of gear is

```
a found piece                                                                ItemFactory.createFromTemplate
├─ rarity            one roll (section 4)
├─ quality           one roll, -0.20 to +0.20
├─ base stats        each implicit of its kind (table below), rolled in its range, x (1 + quality)
├─ affixes           by rarity (section 4), drawn from the pool of the world it was found in
├─ item power        = floor(base_ip x RANK_MULTIPLIERS[rank] x RARITY_MULTIPLIERS[rarity] x (1 + quality))
│   └─ base_ip       = 50 x 2.1^s, a third of that for a tool                                                             ThemeFormula.gearBaseIp
├─ value, gold       = item power x 2
├─ durability        100 of 100. At 0 the piece adds nothing and cannot be fired                                          StatSystem.worn, CombatMath.isUsable
│   └─ wear          1 for each use of the firing hand, 1 for each blow on the chest piece. Nothing else wears.
├─ level             1, 10, 20 ... 80 by rank. Nothing reads it.
└─ asks              one attribute at 1 + 2 x s, chosen by its tags (section 2)                                           LoadoutSystem.requirementsFor

a made piece                                                                 ItemFactory.createComposedItem
├─ rarity COMMON always, quality rolled the same way (or set by making by two)
├─ item power        = the power budget of what went into it (hardness and density of its materials, and its steps)       CompositionSystem.powerBudget
├─ value             = what its materials are worth + labour (1 gold a second)                                             CompositionSystem.priceOf
└─ affixes           only those its components carried
```

### The kinds, and what each carries before any affix

Computed by `GEAR_SHAPES` at rank F. Each grows with rank at its own rate.

| Kind | Slot | Tags | Implicit at rank F |
|---|---|---|---|
| blade | main hand | melee, one hand, blade | accuracy 10 to 20, rate 1.2 |
| bludgeon | main hand | melee, two hand, heavy | crit multiplier 0.1 to 0.2, rate 0.85 |
| bow | main hand | ranged, two hand | accuracy 15 to 30, rate 1 |
| focus | main hand | magic, one hand, caster | energy 5 to 10, rate 0.9 |
| head | head | armor, light | physical reduction 0.01 to 0.02 |
| chest | chest | armor, heavy | physical reduction 0.04 to 0.07 |
| legs | legs | armor, light | physical reduction 0.02 to 0.03 |
| feet | feet | armor, boots, light | walk + 0.03 to 0.06 |
| shoulder | shoulder | armor, light | defense 2 to 4 |
| eyes | eyes | jewelry | signal reading + 0.1 to 0.2 |
| necklace | necklace | jewelry | health 5 to 10 |
| earring | earring | jewelry | noise reduction 1 to 2 |
| ring | ring | jewelry | luck 0.02 to 0.05 |
| quiver | quiver | quiver | rate + 0.02 to 0.05 |
| bag | bag | bag | carry + 10 kg (+ 5 a rank) |
| belt, pouch, cart | | | none |
| axe, pick | tool | tool | chopping or mining power 12 to 18 |

### Every stat a piece can carry

`StatSystem.total` adds a stat over every worn piece that is not broken, plus what skill circles made permanent. An affix that has not been identified or studied still acts in full. "Affix" below is the banked range at tier 1, minor to major, before the rank multiplier.

| Stat | Written by | Affix range | Read by |
|---|---|---|---|
| `damage` | affix | 3 to 21 | added to every hit: weapon, stone, bare hand. On a creature's trait, its damage. |
| `defense` | shoulder; affix | 4 to 28 | mitigation: `defense / (defense + 100)` |
| `physical_reduction` | head, chest, legs | none | mitigation, summed straight. Skill circles do not count toward it. |
| `max_health` | necklace; affix | 8 to 53 | health. On a creature's trait, its health. |
| `max_energy` | focus; affix | 4 to 28 | energy for a day |
| `attack_speed` | every weapon (its whole rate); quiver; affix | 0.04 to 0.28 | time between hits |
| `accuracy_rating` | blade, bow; affix | 8 to 53 | chance a hit glances |
| `evasion_rating` | affix | 6 to 42 | chance a blow misses |
| `crit_chance` | affix | 0.02 to 0.11 | chance of a crit |
| `crit_multiplier` | bludgeon; affix | 0.08 to 0.53 | a crit is x (1.5 + this) |
| `block_chance` | affix | 0.02 to 0.14 | chance a blow is halved |
| `poison_damage` | affix | 2 to 11 | that much each second for three seconds |
| `light_radius` | affix | 1 to 7 | sight, in tiles |
| `pickup_radius` | affix | 2 to 11 | pickup reach, 20 px each |
| `carry_capacity` | affix | 2 to 11 | carry limit, kg |
| `carry_bonus_kg` | bag | none | carry limit, kg |
| `noise_reduction` | earring; affix | 2 to 11 | how near before a creature notices |
| `movement_speed` | feet; affix | 0.03 to 0.18 | walk |
| `movement_speed_penalty` | nothing | none | walk |
| `luck_find_rarity` | ring; affix | 0.05 to 0.35 | **nothing** |
| `field_analysis_speed` | eyes; affix | 0.05 to 0.35 | identify and study clocks |
| `craft_speed_pct` | affix on a room addition | 3 to 18 | the room's bench, at most 30 |
| `upkeep_discount_pct` | affix on a room addition | 3 to 18 | the room's upkeep, at most 40 |
| `cart_lock` | affix on a cart kit | 1 to 4 | ten seconds each to break in |
| `cart_alarm` | affix on a cart kit | 1 to 4 | read as yes or no |
| the ten mind attributes | affix on a frame | 1 to 7 | the attribute. Nothing rolls on a frame, so never. |
| `mining_power`, `chopping_power` | a tool | none | against what a node asks, `5 + 8s` |
| `health_restore`, `energy_restore` | a draught, a meal | none | given at once when used |

A material's own properties are a separate set. HARDNESS and DENSITY are written and read (a thrown stone's damage, weight, a made piece's power and price). CONDUCTIVITY, LUMINOSITY, TOXICITY, RESONANCE and ELASTICITY are read and never written.

### An affix, end to end

```
an affix
├─ its words         key, name, PREFIX or SUFFIX, allowedTags, biome, tier, gives: [stat, band, downside]
│                    written by a theme (a model's words), kept per world by the bank                    AffixBank
├─ its numbers       never the model's:  band x STAT_SCALE[stat] x 1.5^(tier - 1)                        ThemeFormula.affixRange
│                    band: minor 0.5 to 1, moderate 1 to 2, major 2 to 3.5. A downside is the same range, negative.
├─ at the mint       one roll in that range x RANK_MULTIPLIERS[the piece's rank]                         ItemFactory.generateAffixes
│                    none twice on a piece; only those whose allowedTags the piece carries
│                    by reading: every rolled affix is stamped tier 1 on the piece, whatever its bank tier
├─ prefix or suffix  decides where the name sits and which count it fills. By the code nothing ties a stat to one side.
├─ the gate          a world's pool is empty until its hub's magic unlock (D49, ledger H12),
│                    so today every found piece is bare whatever its rarity
└─ where else an affix lands, by its allowedTags
    ├─ mob           a creature's trait: only max_health and damage are read, and no rank multiplier is applied
    ├─ resource      a material that was dreamt on: no rank multiplier
    ├─ frame         the mind's attributes: nothing rolls on a frame
    ├─ cart          a cart kit: only cart_lock and cart_alarm are read
    └─ a room addition: only craft_speed_pct and upkeep_discount_pct are read
```

The shipped theme holds 19 affixes: 10 prefixes and 9 suffixes; 17 at tier 1 and 2 at tier 2; 10 minor, 12 moderate and 3 major stats; 5 downsides; 6 that give two stats.

## 6. A fight, as a tree

```
you hit                                                                      CombatMath.outgoing, keyed by the session's count of shots
├─ base
│   ├─ a weapon:      round(6 + 0.08 x item power) + worn damage
│   ├─ a stone:       5 + round(0.5 x its hardness) + worn damage           Throwable.thrownDamage
│   └─ a bare hand:   5 + worn damage                                       UNARMED_DAMAGE
├─ x (1 + 0.04 x over(STR)) for a weapon tagged melee
├─ x (1 + hand power), what the skill for this tool adds                    WebSystem.handPower
├─ a crit, chance = worn crit_chance + 0.5% x over(PER):   x (1.5 + worn crit_multiplier)
├─ else a glance, chance = 0.2 x 100 / (100 + accuracy):   x 0.5
└─ poison = worn poison_damage, each second for three seconds

how often                                                                    CombatMath.fireCooldownMs
└─ 1000 ms / ((the weapon's attack_speed, or 1.0 bare) + attack_speed worn elsewhere) x (1 + 0.02 x over(DEX)), never slower than one in 10 s

how it flies                                                                 FieldInput.fireMode, WorldCanvas, projectileSystem
├─ a melee weapon or a tool: a swing, 60 px long, 0.75 rad either side, alive 200 ms, every body in the arc once
├─ a focus (tag magic): a burst of 8 shots, each with the full damage, 10 energy a cast
│     a body within 28 px takes 3 of them, within 20 px all 8
├─ anything else, a stone or a bare hand: one shot, 200 px a second for 2 s (400 px), lands within 20 px of a body, stops at the first
└─ nothing pushes a body back

you are hit                                                                  CombatMath.incoming, WorldCanvas
├─ everything that landed this frame is added up, and one roll is made for the sum
├─ dodged, chance = evasion / (evasion + 100)        evasion = worn evasion_rating + 2 x over(AGI)
├─ blocked, chance = worn block_chance:               x 0.5
├─ x (1 - 0.5 x climb(over(INTIMIDATION)))
├─ x (1 - mitigation), at least 1 lands
│   mitigation = min(0.6, sum of worn physical_reduction
│                         + (a chest piece with none: its item power x 0.0004)
│                         + defense / (|defense| + 100))                    CombatMath.mitigationOf (MAX_MITIGATION 0.6)
├─ a ward takes what is left first                                          EffectSystem
├─ poison and other ticks are never dodged or mitigated
└─ then: the chest piece loses 1 durability, a rest or a channel breaks, "when hurt" workings fire, and "when low" ones under 25% health

at zero health                                                               the world's own rule
├─ INVENTORY_LOSS (the default): the pack and everything worn outside a protected slot are lost; frames are kept
├─ NONE (the tutorial): the pack is banked
└─ XP_LOSS and PERMADEATH are named and have no code of their own
```

### A working (an ability)

```
magnitude = round(6 x 1.7^s x cost) x a roll of 0.85 to 1.15 x (1 + power)   ThemeFormula.abilityNumbers, EffectSystem.resolve
├─ power: a player's cast only, 2% x FOC. A creature, a scroll and a carried trigger have none.
├─ what the magnitude m does
│   ├─ damage      m
│   ├─ control     slows by min(0.7, 0.3 + m / 200) for the duration, + m / 4 on landing
│   ├─ debuff      max(1, m / 4) every 500 ms, + m / 4 on landing
│   ├─ ward        absorbs 2m for three durations
│   ├─ buff        haste min(0.5, 0.1 + m / 300): pace only
│   ├─ heal        + m health;   rest: + m energy
│   └─ forced exit a channel of 7100 ms shortened by hacking, 30 energy
├─ reach, px: self 0, touch 40, melee 60, area 120, aura 80, ranged 400
└─ a player's cast spends aether only: no energy, no cooldown, no telegraph           WeaveSystem
    a weave's cost band is how many elements it holds: 1 low, 2 medium, 3 high, 4 extreme
```

| Cost band | Power | Energy or aether | Cooldown | Duration | Telegraph |
|---|---|---|---|---|---|
| trivial | 0.5 | 2 | 1.5 s | 2.0 s | 0.55 s |
| low | 1 | 5 | 3 s | 2.5 s | 0.7 s |
| medium | 1.6 | 10 | 6 s | 3.1 s | 0.88 s |
| high | 2.5 | 18 | 10 s | 4.0 s | 1.15 s |
| extreme | 4 | 30 | 18 s | 5.5 s | 1.6 s |

Statuses: dot, slow, ward and haste work. Stun and weaken are declared and nothing makes or reads them. A second status of the same kind replaces the first, and poison and a debuff are the same kind.

### Who fights beside you

```
an escort                                                                    Escort.ts, NpcSheet
├─ attributes 1 + rank step + (0 to 4), health 100 + 10 x CON
├─ strikes bare-handed for 5, through the same sums as you, reach 60 px, only at what has engaged
└─ takes blows with no gear; nearer than you, it draws the creature

a tamed creature follows for 5 minutes x (1 + 10% x taming level), never strikes and takes no damage     Capture.ts
```

## 7. A creature

```
a creature's numbers                                                         ThemeFormula.creatureNumbers
├─ health  = round(20 x 2.5^s x build)                build: frail 0.6, sturdy 1, massive 1.8
├─ damage  = max(1, round(5 x 1.7^s x threat))        threat: meek 0.6, sharp 1, deadly 1.5
├─ speed   = pace, tiles a second: slow 2, steady 3, swift 3.7     the fastest stays under a bare walk's 4, so a person can always leave
└─ sight   = size, tiles: TINY 8, MEDIUM 10, LARGE 12, GIGANTIC 16, COLOSSAL 20
        x 20 / (20 + the person's noise reduction)                           MobAI.tick
        x 1 by day, 1.225 at dawn and dusk, 1.425 at night                   WorldClock.noticeFactor

how it strikes                                                               MobAI
├─ a plain blow: 2000 ms between, then a 450 ms wind-up you can see: one every 2.45 s. The first lands 0.9 s after it wakes.
│   └─ its baseDamage (x 1.5 if tagged boss) + what a leader or a trait adds; lands if you are within 50 px when the wind-up ends
├─ a working it knows goes first when ready and in reach: m if it is damage, m / 4 otherwise
├─ a hit wakes it from any distance and it never gives up; unseen, it walks to where it last felt you and stops after 4 s
├─ unprovoked, it turns back at max(16, twice its sight) tiles
└─ by behaviour
    ├─ AGGRESSIVE   strikes within 40 px; one with a ranged working shoots at 80 to 160 px and backs off nearer
    ├─ NEUTRAL      the same, once hit
    ├─ PASSIVE      runs once hit, never strikes
    ├─ SWARM        each takes its own place on a ring around you, then bites
    ├─ SIEGE        walks straight at you, strikes within 60 px, never retreats
    └─ TURRET       shoots within 200 px, never moves

what moves its numbers
├─ its line (a kind that has changed): health and damage x (1 + 0.25 x (generation - 1)); a change also steps one band      ThemeFormula.descendantNumbers
├─ a leader: + health = base x (0.5 + 0.25 x CON above its rank's start), + damage = base x 0.1 x STR above it              ThemeFormula.leaderNumbers
├─ a trait, by the Director, from generation 1 and only with a creature affix to draw (magic unlocked)                      Director.variantOf
│     chance a body carries one = (0.08 + 0.04 x generation) x the kind's weight
│     the kind's weight = 1 + (2 x how many of you it felled - 0.1 x how many of it fell) / all, never under 0.1
│     a learned working at that chance x 0.15
├─ a boss's built works: + (rank step + 1) damage to everything of its seat                                                 Territory
├─ a boss's ward: it takes nothing while any anchor stands                                                                  CombatSystems
└─ the ground's own rank (section 4)

how many
├─ 45% of quadrants hold a pack of 1 to 3; a ruin has 2 guards; a leader's pack is 2 to 5, in 6% of chunks                  WorldGenerator, ThemeFormula
└─ a hit on one wakes its herd; a watch post wakes everything of its seat
```

## 8. The numbers side by side

Computed by the game's own functions (`ThemeFormula`, `constants`), for a common piece of standard quality.

| Rank | Creature health: frail / sturdy / massive | Creature damage: meek / sharp / deadly | Gear power, common | Weapon damage, common | A working: low / medium / high | A heal |
|---|---|---|---|---|---|---|
| F | 12 / 20 / 36 | 3 / 5 / 8 | 50 | 10 | 6 / 10 / 15 | 30 |
| E | 30 / 50 / 90 | 5 / 9 / 13 | 126 | 16 | 10 / 16 / 26 | 54 |
| D | 75 / 125 / 225 | 9 / 14 / 22 | 331 | 32 | 17 / 28 / 43 | 97 |
| C | 188 / 313 / 563 | 15 / 25 / 37 | 926 | 80 | 29 / 47 / 74 | 175 |
| B | 469 / 781 / 1,406 | 25 / 42 / 63 | 2,916 | 239 | 50 / 80 / 125 | 315 |
| A | 1,172 / 1,953 / 3,516 | 43 / 71 / 106 | 10,210 | 823 | 85 / 136 / 213 | 567 |
| S | 2,930 / 4,883 / 8,789 | 72 / 121 / 181 | 34,304 | 2,750 | 145 / 232 / 362 | 1,020 |
| SS | 7,324 / 12,207 / 21,973 | 123 / 205 / 308 | 117,065 | 9,371 | 246 / 394 / 616 | 1,837 |
| SSS | 18,311 / 30,518 / 54,932 | 209 / 349 / 523 | 397,131 | 31,776 | 419 / 670 / 1,046 | 3,306 |

### A same-rank fight today

A common weapon of the rank against a sturdy, sharp creature of the rank, and that creature against a body with constitution 1 and nothing worn.

| Rank | Your hit | Its health | Hits to drop it | Its hit | Your health | Hits to drop you |
|---|---|---|---|---|---|---|
| F | 10 | 20 | 2 | 5 | 110 | 22 |
| E | 16 | 50 | 4 | 9 | 110 | 13 |
| D | 32 | 125 | 4 | 14 | 110 | 8 |
| C | 80 | 313 | 4 | 25 | 110 | 5 |
| B | 239 | 781 | 4 | 42 | 110 | 3 |
| A | 823 | 1,953 | 3 | 71 | 110 | 2 |
| S | 2,750 | 4,883 | 2 | 121 | 110 | 1 |
| SS | 9,371 | 12,207 | 2 | 205 | 110 | 1 |
| SSS | 31,776 | 30,518 | 1 | 349 | 110 | 1 |

A newcomer with a bare hand (5 a hit, one a second, one hit in five glancing) drops a frail rank-F creature in 3 hits and a sturdy rank-E one in about 11. That rank-E creature needs 13 blows, about 30 seconds, to drop the newcomer.

### What rarity does to a weapon

| Rarity | Power multiplier | Damage at rank F | Damage at rank D |
|---|---|---|---|
| SCRAP | 0.5 | 8 | 19 |
| COMMON | 1 | 10 | 32 |
| UNCOMMON | 1.2 | 11 | 38 |
| RARE | 1.5 | 12 | 46 |
| EPIC | 2 | 14 | 59 |
| LEGENDARY | 2.5 | 16 | 72 |
| ARTIFACT | 3.5 | 20 | 99 |

### What an affix adds, by the rank of the piece

A `damage` affix at tier 1, after the rank multiplier, beside a common weapon's own damage at that rank.

| Band | On F | On E | On D | On C | On B | On A | On S |
|---|---|---|---|---|---|---|---|
| minor | 3 to 6 | 4 to 7 | 5 to 9 | 6 to 12 | 9 to 18 | 15 to 30 | 24 to 48 |
| moderate | 6 to 12 | 7 to 14 | 9 to 18 | 12 to 24 | 18 to 36 | 30 to 60 | 48 to 96 |
| major | 12 to 21 | 14 to 25 | 18 to 32 | 24 to 42 | 36 to 63 | 60 to 105 | 96 to 168 |
| the weapon's own damage | 10 | 16 | 32 | 80 | 239 | 823 | 2,750 |

## 9. Where the numbers disagree with themselves

### The curves pull apart

1. **A character's health does not grow with rank; a creature's damage does.** 110 health at every rank against 5, then 25, then 121 a blow. Constitution is the only thing that raises health, at 10 a point, and a level gives one point.
2. **A weapon outgrows what it hits.** Rank is applied to gear power twice (`2.1^s` in the base, then `RANK_MULTIPLIERS`), so a common weapon grows by up to x 3.4 a rank while a creature's health grows by x 2.5. At SSS one hit drops a same-rank creature.
3. **A working falls behind a weapon.** Both start near 10 at rank F. At rank A a high working is 213 and a common weapon 823. Focus adds 2% a point.
4. **An affix shrinks as the piece grows.** A moderate `damage` affix is 60% to 120% of a rank-F weapon and 4% to 7% of a rank-A one.
5. **Rarity moves the power and little else.** Legendary against common is 16 against 10 at rank F. What rarity really gives is the count of affixes, and the pool is empty until a hub's magic unlock.
6. **Armour grows slower than everything.** A piece's physical reduction grows by about x 1.25 a rank, toward a hard top of 60% off.
7. **Four ladders of gear power disagree.** Real common gear runs 50 to 397,131. The comments on the rank list say 0 to 1,500. Deeds are priced 50 to 1,550. The gate on what may be taken into a world reads `RANK_MULTIPLIERS x 100`, 100 to 2,100, and nothing sets it.

### One thing worked out more than one way

- **The carry limit, three ways.** `LoadoutSystem.carryLimit` counts the bag and worn `carry_capacity`. Two places in the player store (lines 748, 1013) and the hub's sheet count the bag only. The store starts at 50 where strength 1 gives 40.
- **Two rarity tables with nearly one name.** `RARITY_MULTIPLIERS` for power (epic 2, legendary 2.5, artifact 3.5) and `RARITY_MULTIPLIER` for experience (2.5, 5, 10).
- **Whether the first point counts.** Most attributes count points above 1. Constitution (x 10), endurance (x 0.2), focus (x 2% and x 5) and charisma (x 5%) count the first point too, so a character at the floor has 110 health, 50.2 energy, + 2% to a working and a 55% talk.
- **An attribute on a twenty-sided roll, three ways.** Study and making add `attribute - 1`. A leader's goal and a contest add `floor(attribute / 2)`. An apprentice's trial adds `intelligence - 2 - rank step`.
- **`attack_speed` means two things.** On a weapon it is the whole rate. Anywhere else it is added. A second weapon in the off hand adds its whole rate.
- **Two keys for the same protection**, `physical_reduction` (summed straight) and `defense` (through a curve), under one 60% top.
- **Broken, tested two ways** (by the stat sum and by the firing hand).
- **Starting gold**: 100 in the first template, 500 at creation.
- **Reach**: 4 tiles as a named number, 3 tiles written inline for harvest, chest, snare and cart, and 100 to 300 px in the field's canvas.
- **Two kinds of deed, two curves** for finding one.
- **The same number kept in several places**, so they will drift: a markup of 1.5 (four places), the quality bite 0.10 and floor -0.20 (four), the study and making bars 8, 3 and 10 (two), the tile of 20 px (five), a tax of 0.05 (four), identify at 100 and 500 gold (two), the rank order itself (at least seven files).

### Written and never read

- `luck_find_rarity`: on every ring and on a shipped affix. `StatSystem` names `CombatSystem.tick` as its reader and no such read exists. The older `magicFind` raises how often a thing drops, never how rare it is, and nothing feeds it from this stat.
- The ten mind attributes on an affix: allowed on frames only, and nothing rolls on a frame.
- On a creature's trait, any stat but `max_health` and `damage`. On a room addition, any but the two room stats. On a cart kit, any but the two cart stats. On a meal, any affix.
- An item's `level` and its `stats.weight: 5`. Durability on anything but the firing hand and the chest.
- Stun and weaken. A creature's own ward (stored, never read when it is hit, *by reading*).

### Read and never written

- `movement_speed_penalty`; `focus` on gear; a tool's tags; five of a material's seven properties.

### Rounding and scale

- A base stat above 1 is rounded to a whole number at the mint, so **a blade's rate of 1.2 always becomes 1** (`ItemFactory.generateBaseStats`). A bow's 1.0 and a bludgeon's 0.85 are kept.
- The same rounding catches an affix once the rank multiplier lifts a fraction past 1: a major `crit_chance` at SSS becomes 1 or 2, a certain crit.
- Fractions (0.03 crit) and percent points (5 craft speed) share one scale table.
- `cart_alarm` is rolled 1 to 4 and read as yes or no.
- `health_restore` has three writers on unrelated scales.

### In the fight, by reading and not run

- A SIEGE creature stops within 60 px and its blow reaches 50 px: someone standing still may never be hit by it.
- A status from a blow is added before the dodge roll, so a dodged blow still leaves its status.
- A creature drops a status at its end before its last tick: poison lands 2 of 3 on a creature and all 3 on a character.
- A carried trigger is always aimed east.
- An old contact rule still charges a creature's damage every frame within 1 px.
- A creature only ever fires one shot: the spread and spiral patterns have no caller.

### Hard tops and fixed tables in the code today

Listed because of the standing rule against artificial caps.

- Mitigation at most 60%. A room's speed at most 30% and its upkeep discount at most 40%. A room addition's tier at most 4. Frames at most 3 worn, and *by reading* the same frame can sit three times.
- Six frames written by hand. `RANK_MULTIPLIERS`, the kill-experience table, the gear-found chances and the deed values are tables, not formulas.
- The climbing curve (`2p / (2p + 100)`) is not a cap: it approaches its limit and never arrives. It is used for repair, the beacon, blows, the levy, the counter, the shelf and upkeep.

### Dead

`skill.scalingAttribute`, `ProgressionSystem.calculateLearningRate`, `BASE_SIMULATION_STATS` (and it disagrees with the live rules), `stats.attackSpeed`, `toolData.toolPower`, `CombatMath.mitigation` and `applyMitigation`, `RANK_COLORS`, `DAILY_LAND_TAX_GOLD = 100`, `MAX_INVENTORY_SLOTS = 20`, `MAX_BANK_SLOTS_DEFAULT = 50`, a world certificate's `mobDensityMultiplier` and `lootMultiplier`.

## 10. Every system that holds numbers

About 580 tunable numbers outside the fight, gear and attributes, which were read separately and are not counted here. `[G]` marks a file whose header says every number in it is a guess.

| # | System | Numbers | Where they live | What it holds |
|---|---|---|---|---|
| A | Attributes | not counted | `StatSystem.ts` | Sections 2 and 3 |
| B | The fight | not counted | `CombatMath.ts`, `CombatSystems.ts`, `MobAI.ts`, `EffectSystem.ts`, `projectileSystem.ts` | Sections 6 and 7 |
| C | Gear, affixes, the ladders | not counted | `ItemFactory.ts`, `ThemeFormula.ts` [G], `constants.ts`, `AffixBank` | Sections 4 and 5 |
| 1 | Energy and rest | 16 | `StatSystem.ts`, `RestSystem.ts`, `InteractionEngine.ts` (inline) | A day's 50; a rest is 8 h x (spent / 500)^2.14; the inn 20 gold; each act's cost (talk 5, identify 10, making 5, a focus cast 10) |
| 2 | Experience, levels, rank | 15 | `ProgressionSystem.ts`, `guild.ts` | Section 4; shares for harvest, chest and nearby threat |
| 3 | Skills and the tech web | 23 | `WebSystem.ts`, `ProgressionSystem.ts`, `CircleSystem.ts`, `ProcessSystem.ts` | A skill takes x 2.5 as long (D84); rungs at 0, 150, 450, 1050; doing a thing unheld costs + 5 on the roll, x 1.5 energy, x 1.25 time; 3 circles for a gift |
| 4 | Study, lore, identify | 29 | `StudySystem.ts`, `LoreSystem.ts`, `LoreConstants.ts` [G] | A sitting 20 s, identify 12 s down to 2; bar 8 + 3 a rank + 2 a harm; lost for 7 days; lore prices; identify in town 100 gold |
| 5 | Harvest and materials | 23 | `ThemeFormula.ts` [G], `WorldGenerator.ts` | Hardness and uses by form; regrowth 90 s to 600 s; 40 nodes a chunk; a rare find 1 in 2,000 |
| 6 | Loot and chests | 30 | `ThemeFormula.ts`, `ChestSystem.ts` [G], `LootTable.ts` (inline, older) | Odds bands; junk 55%, an anchor 15%; a chest's wait and bar; gear chance by rank; the older rolls for tags, tomes and deeds |
| 7 | The world, its people, its clock | 78 | `WorldGenerator.ts`, `ThemeFormula.ts`, `Population.ts`, `Leaders.ts`, `Territory.ts`, `WorldClock.ts` | Spawn odds per quadrant; appetite and birth rates; the land's numbers; leaders' goals and their bars; a boss's ground and bills; the cycle for each world size (1 h to 5 days up); light by hour |
| 8 | The Director and creature lines | 14 | `Director.ts`, `CreatureLines.ts`, `ScanPass.ts` | Section 7 |
| 9 | Talk and minds | 48 | `TalkLaw.ts` [G], `MeetLaw.ts`, `NpcAgenda.ts` [G], `HabitLaw.ts`, `MemoryLaw.ts`, `NpcSheet.ts` | A judged round's bonus 10 or 25; the meter moves 8 + 20% of the margin; needs start 70 to 30 and fall 5 to 1 a day; a memory's life 90 days; the usual at φ² |
| 10 | Capture, taming, farm, herd | 27 | `Capture.ts` [G], `herd.ts`, `farm.ts` | Temper 2, 1.5 or 1; a snare 2 parts and 30 s; following 5 min; wariness 2, 3 or 6 days; feed and meat by appetite |
| 11 | Escorts | 7 | `Escort.ts`, `FieldEscort.ts` | Section 6 |
| 12 | The city's economy | 88 | `VendorSystem.ts`, `ApprenticeRoad.ts`, `ShopWeek.ts`, `ExitLevy.ts`, `guild.ts`, `money.ts`, `hubManifest.ts`, `hub/store.ts` (inline) | Build and upkeep by building; the exit tax 5%; the counter, the shelf, markups of 1.5; a vendor's day; a resident's keep and wage; the mint's 14 days; a lot at 480 gold a tile; tolls; deed values; starting gold; an apprentice's term and trial |
| 13 | Building, benches, making | 41 | `room.ts`, `template.ts`, `PairCraft.ts` [G], `ProcessSystem.ts`, `SalvageSystem.ts`, `Cooking.ts` [G] | Bills and seconds by piece and shell; a bench's least area; room tops; salvage keeps half; the making bar; a meal's restore |
| 14 | Carrying | 18 | `InventorySystem.ts`, `LoadoutSystem.ts`, `CartSystem.ts`, `StashGrid.ts` | Pack 8 x 6; the 80% mark; a bag's kg; a cart 10 x 8; the stash 12 wide |
| 15 | Maps, recon, survey | 8 | `SurveySystem.ts`, `LoadoutSystem.ts`, `ScanDoor.ts` | A map's worth 10 + 5 a level. No scan cost and no decay curve exist. |
| 16 | Death and insurance | 12 | `player/store.ts`, `InsuranceSystem.ts` | Three charms at 180, 240 and 90 gold; the forced exit |
| 17 | Moving and the field | 42 | `LoadoutSystem.ts`, `StatSystem.ts`, `MobAI.ts`, `FieldInput.ts`, `WorldCanvas.tsx` (inline) | Walk 4 tiles a second; the beacon 5 s; reaches; a creature's sight, wind-up and cooldown; grazing; a shot's speed |
| 18 | Everything else | 62 | `WeaveSystem.ts`, `Throwable.ts`, `WorldDeed.ts`, `shared/intelligence/door.ts` | Aether; throwing; world deeds; creation's 3 questions; what a model call may spend |

The largest: the city's economy (88), the world (78), talk (48), moving (42), building (41).

### What leans on what

```
a rank's step          nearly everything in section 4
gear power             a weapon's damage; its price (x 2), and through the price every counter, shelf and repair;
                       the chest piece's fallback protection; the gate on what may be taken into a world
a kill's experience    a level's cost; the shares a harvest and a chest pay
a creature's numbers   a line's generations, a leader's bonuses and a trait all multiply or add to them
energy for a day       every act's cost, and how long a rest takes
quality                implicits, power and price
the magic unlock       whether any affix, any creature trait or any dream exists at all (D49, ledger H12)
```

### Numbers that sit outside a rules file

- In the field's canvas (`WorldCanvas.tsx`): reaches, the beacon's range, hit radii, a swing's life.
- In the world creator's form: the tops on an entry fee (1,000), a tax (30%) and the creator's share (10%), repeated in the certificate.
- Inline in rules files: a shop's stock and markups (`hub/store.ts`), each act's energy cost (`InteractionEngine.ts`), spawn odds (`WorldGenerator.fillQuadrant`), a leader's thresholds (`Territory.ts`), the older drop odds (`LootTable.ts`), town service prices (`HubGenerator.ts`, `dialogue.ts`).

`src/logic/systems/TuningReadout.ts` with `src/components/debug/TuningPanel.tsx` already shows the Director's odds, the rungs, the levels and the rest curve live.

### Not read

- The shipped theme's own values, creature by creature and recipe by recipe (`shared/entities/generation/packs/*`), beyond counting its affixes.
- `hub/store.ts`, `Territory.ts`, `Population.ts` and `LootTable.ts` were scanned for patterns, not read whole: more inline numbers are likely.
- `server/`, and every number that only draws the screen.
- Affixes on a weapon in a real fight, and the tutorial's own fight rules, were not followed through.
- The counts are estimates.
