# The balance run

Pedro, 2026-11-10: "we're going to send out a fan to think thorough every system and make a balance + affix {suffix, preffix} run, then we're going to re scale the uncommon magical rare epic... so on so forth with stats, and we're going to rebalance the combat. we're also needing a design pass."

This is what the fan thought. It is a proposal from end to end: no code has changed. `STAT_TREES.md` says what the game does today, and its section 11 holds Pedro's rulings.

The fan went out in two waves. Part 1 is the spine: four workers, each alone and none told what the coordinator expected, on what a rank is worth, the fight triangle (twice, from the body's sheet and from the seconds of an encounter), and the ladder with the affix law. Part 1 is their four proposals reconciled into one. Part 2 is every other system, thought through with the spine in hand.

Every table the workers give was computed by a script of theirs, many by running the game's own pure functions. Nothing was run inside the game. Their full proposals and scripts are kept outside the repository, in the notes folder under `balance-run/`.

# Part 1. The spine

## 1.1 What the four agree on without having been told

Each worker saw only the rulings and the code. These came back from more than one of them.

- **A same-rank fight between equals lasts about ten seconds, at every rank.** Three workers arrived at it separately. It is what rank F is today by the game's own functions, the rank Pedro played and said felt good (see 2.1). The spine holds every other rank to it.
- **Rank enters a number once, on one scale.** Today seven different ratios grow from one rank to the next, and rank reaches gear power twice.
- **An affix is a share of what its piece gives at its own rank.** So it feels the same at F and at SSS. Today a middling damage affix is 90% of a rank-F blade and 0.6% of a rank-SSS one.
- **Protection is one rating read against the rank of the blow, with no top.** Today a plain common set of armour reaches the 60% top at rank S, and before the top its sum is 116% at SSS: the top is doing the balancing (see 2.1).
- **Tiles, seconds and the day's energy do not grow with rank.** Today one major walk affix on a rank-S piece is a walk of 9.8 tiles a second against a fastest creature of 3.7.
- **The triangle needs the same handful of rules**, found from both ends: a shot is drawn before it flies and the draw costs the shooter their feet; a heavy hit is felt by the body it lands on; a swing reaches further than a stab; a blow on a body that has not noticed is worth more; heavy pieces cost pace.
- **An edge of the triangle is worth about twice a body**: the favoured side wins and keeps about half its health. That is under a rank and over a step of the ladder.
- **A working is not a fourth side.** It is a blow, on the side its reach puts it on.

## 1.2 What a rank is worth

```
one scale            scale(rank) = 2^step: F 1, E 2, D 4, C 8, B 16, A 32, S 64, SS 128, SSS 256
rank enters once     an amount in a fight = scale(the rank of whatever owns the number) x a share that reads no rank
                     no bare constant stands beside it (today's "6 +" on a weapon is 60% of a rank-F blow and nothing of an SSS one)
whose rank           a body's health and bare hand: the body's own (a person's from the guild's trial, a creature's own)
                     a weapon's blow, a piece's rating, a tool's power: the piece's
                     an affix: the piece it sits on. A creature's trait: the body it sits on.
                     a working: the working's. A heal: the draught's. A made piece: what it was made of.
a share is a rating  whatever is not an amount (how much of a blow is stopped, a chance to dodge, crit or block, a slow, haste, pace, quiet, luck)
                     is carried as a rating that doubles with its piece's rank and is read as  rating / (rating + knee x scale)
                     against the other side's rank for what is set against the other side, and the bearer's own rank for the rest
                     it approaches its limit and never arrives, so nothing needs a top and nothing rounds to a certainty
no rank at all       seconds, tiles, reach, wind-ups, kilograms, and the day's energy (Pedro: "0.2 of endurance + initial value + items")
```

What follows from it:

| | Today, F to SSS | Under the spine, F to SSS |
|---|---|---|
| A character's health | 110 to 110 | 100 to 25,600: `100 x scale(own rank) x constitution's share` |
| A common weapon's blow, one a second | 10 to 31,776 | 10 to 2,560: a fixed share of power, with rank in power once |
| A plain creature's health and blow | 20 to 30,518; 5 to 349 | 25 to 6,400; 6 to 1,568 |
| A plain creature of your own rank | 2 blows and 5% of you at F; one blow kills you at SSS | 3 blows and 6% of you, at every rank |
| A plain creature one rank above | 16% of you at F; it kills you at C | 5 blows and a quarter of you, at every rank |
| A moderate damage affix, of its weapon | 90% to 0.6% | a sixth, at every rank |
| A heal draught | 30 to 3,306 | 30 to 7,680: three tenths of a plain body of its rank |
| An energy draught | 10 to 1,102, against a day of 50 | no rank |

Bodies by class, as shares of a person of the same rank. With a rank doubling, each class is one rank of power from the next:

| Class | Health and damage | Power | The same as |
|---|---|---|---|
| plain, one of a pack | a quarter and a quarter | 1/16 | a person two ranks down |
| elite, a leader one person can bring down | a half and a half | 1/4 | a person one rank down |
| a person | 1 and 1 | 1 | |
| boss, holds ground and asks for a party (see 2.1) | 2 and 2 | 4 | a person one rank up |

Meeting something that is not your rank: one rank is x 4 in power (twice the body, twice the tool). A plain creature takes 2 blows one below, 3 at your rank, 5 one above, 10 two above, and costs you 1.6%, 6%, 25% and all of you. Two above, a plain creature is your equal, which is where a world's ground stops climbing. Three apart is settled.

The order of worth the spine needs kept:

| What | Worth, in power | In ranks |
|---|---|---|
| A rank, body and tool | x 4 | 1 |
| Two people striking one body | x 4 | 1 |
| An edge of the triangle | about x 2 | a half |
| A full kit at epic, over a plain kit (see 2.1) | no more than x 2 | a half |
| The levels a person gains inside one rank | about x 1.3 to x 1.5 | a quarter |
| One piece's quality, crude to superior | x 0.8 to x 1.2 | |

An attribute is read against the floor of its body's rank, `1 + step`, as the code already does in three places. A point of constitution over the floor adds a tenth of the rank's health; under it, it divides, so a body that has not kept up has less and never has nothing.

## 1.3 The triangle

Pedro: "same rank fight should be jokenpo style, ranged beats meele, speed beats ranged (assassin or stealth, mounted) and meele beats speed."

The two workers described the same thing from two ends.

From the body: every body has three measures on its sheet, and each side is first in one, second in another and last in the third. No rule names a winner.

| Measure | The owner's word | Attributes that already feed it | What is worn or held |
|---|---|---|---|
| reach: how far its blow goes | ranged | dexterity, perception | the hand: a bow, a stone, a ranged working |
| pace: how fast it covers ground | speed | agility, subterfuge | the feet and the load: light pieces, boots, a mount |
| weight: what it holds and deals at contact | melee | strength, constitution, intimidation | the frame: heavy pieces, a heavy weapon |

From the field: an encounter runs in one order, and each side owns one stretch of it. Speed owns the opening (who notices whom, and from how far), ranged owns the gap, melee owns the contact. Each side beats the one whose stretch comes next by settling the fight before that stretch begins, and the cycle closes because an opening cannot finish a body that is made for contact.

Played today, with today's numbers, there are no sides at all: in 369 simulated fights against an equal creature no blow reaches the person, whether they hold a bow or a blade. The win belongs to walking backward.

The rules both workers need:

```
1. every blow has a wind-up that can be seen          a creature's has one today (0.45 s, standing); a person's has none
   a shot is drawn standing; a swing keeps half its maker's pace; a stab keeps all of it
   this is what ranged pays: melee closes only while the shooter stands to draw
2. a hit is felt                                      share = weight / (weight + the poise of the one it lands on) (see 2.1)
   it takes that share of the target's pace, and breaks a wind-up the target had to stand for
   (a hit already breaks a rest and a channel; a draw is a short channel)
   this is why speed beats ranged at contact, and why a heavy swing holds a fast body
3. reach belongs to the kind                          a shot far, a swing about 3 tiles, a stab or a light blade about 1.5 to 2 (see 2.1)
   speed must come inside melee's reach to use its own
4. the opening blow                                   a blow on a body that has not noticed its striker is worth more: the assassin
5. weight costs pace                                  heavy pieces carry a pace penalty (the key is read today and nothing writes it)
6. each side's gear asks its own attribute            a bow asks dexterity, a light blade agility, heavy and two-handed melee strength
7. a working is a blow                                its delivery is its reach, its telegraph is its draw (a person's cast has none today),
                                                      and its effect lends a measure: a slow takes pace, haste lends it, a ward lends weight
```

How big an edge is, at the same rank, with nothing but those rules and equal bodies:

| Pairing | From the body's sheet | From the field's seconds |
|---|---|---|
| ranged over melee | never struck with room; keeps half its fire; the fight takes 2.6 times as long | wins 41 starts of 41, keeps 48% |
| speed over ranged | keeps 51% (loud 39%, unseen opener 68%, mounted 47%) | wins 41 of 41, keeps 49% |
| melee over speed | keeps 55% | wins 41 of 41, keeps 57% |

Two of the same side: a shoot-out is the shortest fight, and who sees first decides it; two heavy fighters slug to the last blow and the sheet decides; two fast ones do the same, faster.

Where the two differ. These are the fight worker's to settle by simulation in Part 2:

| | From the body | From the field |
|---|---|---|
| A shot's reach | bow 10 tiles; inside 3 tiles it glances | bow 20 tiles, but a shot flies and a free body can step out of it from far enough |
| The draw | a share of the cycle paid out of pace: shot 0.40, swing 0.20 | seconds: bow 0.6 s standing, swing 0.4 s at half pace, stab 0.15 s on the move |
| Evasion | whole against a shot, half against a swing, none against an area | should shorten the time to answer a shot, and not roll a miss |
| A held blow | not proposed | a ready swing may be kept and let go when something enters reach |
| The opening blow | x 3.75 for ten points of subterfuge | doubled, and meets half the poise |

Speed's three words, in Pedro's order:

- **Assassin** needs the opening blow, and a body that can go unnoticed.
- **Stealth** needs "noticed" to be true both ways. A creature noticing a person exists. A person noticing a creature does not: creatures are always drawn. That is the hiding pass, which is later and its own.
- **Mounted** needs a creature that can be ridden; a tamed one only follows. Both workers leave it to the design pass and found two rules already in the code that price it: a rider weighs `30 + 10 x strength` kg against the mount's carry limit, and a rider has one hand.

## 1.4 A piece above normal

Pedro: "uncommon is technological with 1 stat (prefix or suffix), then magical 2 stats (one suffix one affix), rare 4 epic 6. the ranks are tiers". And: "Yes, rank is tier".

A piece has three separate facts, tangled today: rank says how big its numbers are, step says how many properties it holds, quality says how well it was made.

```
the step             read off the piece, never written on it: nothing is common; one property on either side is uncommon;
                     then count pairs of one prefix with one suffix: one pair magical, two rare, three epic. No last step.
a step multiplies    nothing. Today's power table by rarity is 1 + a quarter for each affix, almost exactly:
nothing              an affix is paid for twice, once as itself and once in the piece's power.
size of an affix     band x ruler(stat, the carrier's rank) x (1 + the carrier's quality)
                     the ruler is what one piece that natively carries the stat gives at that rank (a necklace for health, a blade for damage)
                     bands: minor a twelfth, moderate a sixth, major a third. Six moderates are one more piece.
prefix or suffix     every stat is an amount (added to a figure) or a rating (read through a curve against a rank)
                     an amount goes before the name: a prefix. A rating goes after it: a suffix.
                     so a pair is always one of each, and the side of a stat nobody has invented yet is decided by its reader
                     the shipped theme, written with no rule, already does this in 12 of its 19 affixes
the two routes       Pedro: "the materials being better make the stats better, roll affixes or even enhance the weapon"
                     a better material brings an amount; a working done to the piece brings a rating
uncommon             one of the two, with its cause on the piece's own chain. Plain craft at its best: it needs no magic and reads at sight.
magical and up       one of each in one object, which no single technique leaves. It comes unread; studying it roots its two techs in the web.
how often, found     the chance a found thing goes at least d steps deep is q^d. Today's roll table (60, 25, 10, 4, 1) already is this law with q = 0.4.
                     the body it was found on and the finder's luck move the odds, never the chance, so it climbs and never arrives
how often, made      nothing is rolled for the count: each property must take on the making roll, and the bar rises 3 for each one already held
"enhance the weapon" working one more property into a finished piece at a bench, on that same roll
legendary, artifact  not counts. Whose the piece was: a boss's own, or a titan's or a god's, carrying that body's traits, its working and its name.
                     the old drop code already renames the piece "{its name}'s ..." and then rolls it like any other.
where it roots       an affix is a tech: a workstation, tools, materials. An amount is named for the material that brings it,
                     a rating for the tool and the bench that work it in.
```

Off gear, the same law: a creature's trait is a property on a body, sized by the body's rank (today a trait is 75% to 150% of a rank-F creature's health and a tenth of a percent of an SSS one's, which is one reason "I haven't seen the monsters get stronger yet"). A creature with one of each reads as magical.

The stat keys, cleaned: `defense` and `physical_reduction` become one rating; the two carry keys become one; `attack_speed` splits into a weapon's own rate (never an affix) and haste; luck gets the reader it never had (it multiplies the odds of depth on what its bearer finds); nothing numeric is kept on a piece, so nothing is rounded (a blade's 1.2 stays 1.2, and a major crit affix can no longer become a certain crit).

What the ladder found in the shipped theme: it cannot fill the ruled ladder. A weapon has one or two suffixes that fit, jewellery has no prefix, and a quiver, a pouch and every tool have nothing. Run 200,000 times it yields 5.5% magical where the place offers 9.6%.

## 1.5 Decided by the coordinator, open to overrule

Where a ruling, the code or plain sense settles it. Each is one line to undo.

- An affix gives one stat. Pedro counted in stats, so six means six.
- A downside is a price: it takes a smaller band of its own stat and adds the same to the gift.
- The tier number a theme's writer puts on an affix is retired. The tier is the rank.
- Energy reads no rank anywhere, by his ruling on the day.
- Protection is one rating and the 60% top goes, by his ruling on caps.
- A step of the ladder multiplies nothing in a piece's power.
- An uncommon piece exists before a hub's magic unlock, because he ruled uncommon technological. The unlock opens pairs.
- Experience for a kill follows the fight's power (x 4 a rank), from his rule that experience is tied to the risk (see 2.11).
- Mounted waits for the design pass. Stealth's other half waits for the hiding pass.

## 1.6 Calls that are Pedro's

Each with what the workers recommend.

1. **Does a rank double?** It is the one number everything hangs on. Recommended: yes, 2. Lower leaves a world's worst ground open and makes a rank no bigger than one piece's quality; higher closes the ground the guild's trial sends you to.
2. **Ten seconds between equals, and a plain creature worth a quarter of a person?** Recommended: yes. Both are what rank F is today. The second sets how many fights a run holds, since nothing regenerates: about sixteen plain creatures met one at a time, with a heal undoing five (see 2.1).
3. **A person's blows get wind-ups** (a bow drawn standing, a swing begun at half pace). It changes how the game feels in the hand more than anything else here. Recommended: yes. Without it ranged keeps everything against both other sides and there is no triangle.
4. **The empty hand.** He ruled the free throw stays ("nope, you should throw it"). A free shot of 20 tiles with no draw and no end is the one thing that makes everyone ranged before they own anything. One worker keeps the throw, at 8 tiles and under the draw. The other has a hand with no stone strike at arm's length. Recommended: keep his ruling, at 8 tiles and under the draw (see 2.11).
5. **May a creature be faster than a walk?** Today none is, on purpose, "so a person can always leave". Speed cannot be a creature's side without it. One worker lets swift things out-walk a person outright. The other allows a burst, with a rest the formula sets so that the creature's pace over the whole cycle stays under a walk. Recommended: the burst. A person can still always leave, from outside it.
6. **Legendary and artifact are whose the piece was**, not the next counts. Recommended: yes.
7. **One roll on a piece (its quality, which moves every number on it together), or a roll for each affix as today?** Recommended: one. A piece then keeps words and one number, the hub can check all of it, and a rebalance moves every piece that already exists.
8. **How heavy the ladder is.** A moderate affix as a sixth of a piece makes an epic's six weigh one more piece. Today's table says a quarter, by accident.
9. **Do standing worlds move with the law?** The formula's own header says a later version never moves a standing world, and worlds never retire. But a character's health is one law for every world. Recommended: the numbers move and the words stay (see 2.1).

# Part 2. The systems

The second wave took the spine into every other system. Seven workers had one system each: the fight, creatures, a character's growth, gear, the world, the city's economy, and talk and minds. An eighth, the checker, read all eleven proposals against one another and against the rulings in `PLAN.md`, `PLAYTEST_LEDGER.md` and `DESIGN_ASK.md`, and ran or read the code where a claim turned on it.

As in part 1, a table here is a worker's script: a proposal computed outside the game, many by calling the game's own pure functions, never a fact about the game. A number called reasoned was chosen, not computed. Nothing was played in the game and no code changed. Each worker's proposal, summary and scripts are in the notes folder under `balance-run/`.

## 2.1 Where the systems break the spine

Each place a worker or the checker shows part 1 wrong or short. "Settled" means a worker settled it by play, or a ruling settles it, one line to undo. A call number points to 2.11.

**The triangle.** From the fight worker, who played it in a field model; the checker ran its tables again.

- Protection read against the rank of the blow is blind inside a rank. Read against the blow itself, guard / (guard + blow), a heavy set stops 40% of a knife and 22% of a bludgeon, and melee over speed goes from 21% kept to 37%. At a blow of the rank's own size, one rank either way, it gives part 1's numbers. Settled: the checker keeps it, as the only reading that was played.
- Rule 2 needs a condition. A hit may break a standing wind-up only when its weight is at least the poise, or two quick hands hold a boss in its wind-up for good. And the first wave's setting back of a moving wind-up must go: under it six stalkers beat the melee person, keeping 80%. Settled as plain sense.
- Rule 3 is missing a near end for a shot. With none, a bow in a heavy set beats speed (keeps 19%); at 3 tiles, melee beats ranged (keeps 21%). At 2 tiles, between a stab's reach of 1.5 and where a swinger stands (2.4 to 3), both meetings hold. Settled: 1 + half the shot's heft, 2 tiles for a bow, over the body worker's 3.
- "An edge is worth about twice a body" is true of one edge. With bodies that carry their sets the three are x 1.29, x 2.0 and x 1.62 in the loser's health. Ranged over melee has no size when the shooter is the faster and has room: it gives ground and is never struck (48 s). The checker found that edge belongs to the open field: 35% kept from 20 and 30 tiles, 22% from 14, and from 10 tiles melee wins 15 starts of 24, from 6 tiles all 24. The other two edges do not move between 6 and 30 tiles.
- Ranged's edge rests on sight, which part 1 does not hold. With everyone seeing 12 tiles, ranged keeps 10% against melee. Today a person's sight is their window: 1,400 px wide shows 35 tiles each side, where no creature notices from further than 20 (30 at night). Left to the design pass (2.12).
- Rule 4, the opening blow, needs a size in seconds and "by hand". A multiple does nothing in a pack, or, at the x 9.25 needed to lift speed from 73% to 87% against three biters, turns melee over (a bludgeon's opening blow is 109). Settled: the blow plus 1 to 3 seconds of its maker's damage.
- Rule 7, a working is a blow, needs what a cast is worth: with its telegraph, today's working is 0.33 to 0.9 of a bow for each second stood, and costs aether besides. Call 19.
- Rule 5, weight costs pace, already breaks "a person can always leave": a heavy walk of 3.6 is under a swift creature's 3.7, and a full pack halves the walk to a slow creature's 2 today. Call 14 is not only about bursts.
- A dodge as a die spreads the winner's health by 8 to 10 points from start to start; a share slipped spreads it by 0 to 3, with the same edges. Settled by D38, which chose a rolled range over a to-hit die.
- The classes assume the body can reach: two contact fighters against a boss of twice a person come out even, as part 1 says, but a pair with a shooter wins with the shooter whole.

**Bodies and packs.** From the creature and world workers.

- A boss of two of a person in health and in damage takes 49% of a person with one blow, so nobody alone can wear it down. That is a bare body, before armour (twice a person's damage a second for the 2.45 s between a creature's blows); behind a set that stops a quarter it is about 37%. Pedro, 2026-11-11, on that figure: "in wow if you're not a tank the boss kills you by walking close, every game has this, positioning and knowing what you can and can't do". Read as: a boss's blow being more than a body not built for it can take is right, and is what makes the heavy side and where you stand matter. What stays against a ruling is the doubled health. D93 was approved as written: "Not health: a boss's health stays ordinary for its rank". Settled by the ruling: a boss's body is the leader it was. Gear, economy, character, world and talk used part 1's boss row anyway; their boss figures need working again.
- The class table prices one body and the land stands herds. Several alike at once cost n(n+1)/2 times one: a plain creature of your rank 6% of you, two 18%, three 36% to 37%, four 60%, five fell you (104%). One rank above, a pair costs about three quarters (74% and 75% in the two workers' sums) and three kill. From a world's first regeneration over half the bodies in two of three sectors stand in groups of five or more, and one hit wakes a group. So "about sixteen plain creatures met one at a time" (part 1's call 2) does not happen. The fight worker adds that a bow in the open is never touched by four of today's biters and fells 48 in a row.
- The elite at a half and a half is a full rank over its pack. With today's pack of 2 to 5 behind it, it costs 67% at the least and kills from four heads, against the ruling that one person can bring it down. Today's leader is worth x 2.06, about one edge. The creature worker: a leader holds twice what its kind holds and strikes as its kind.
- Size is not in the spine. "Three blows and 6% of you" is a MEDIUM, sturdy, sharp body, alone. Call 2.
- A creature's working takes its caster's rank and none of its body: 1.63 times a TINY body's blow and a tenth of a GIGANTIC one's.
- A line that keeps its letter and gains a quarter a generation: by the real functions a farmed hound line changes form 8 times in 60 regenerations and stands at 5.4 times its health and 7.8 times its blow on the same letter (x 42 in power); a line that only fells people changes 43 times. Call 21.
- The first wave's odds of a trait, straight in the regeneration, read 99.6% and a mean depth of 254 by a small world's second year. Settled: an age that saturates (2.3).
- Where nothing hunts it, the fastest breeder wins: left alone a small rank-F world is 70% Tally Rat a week after its mint. And the promise that a person can always leave should bind what comes at a person and not what flees one, or prey that runs is walked down and the hunt has no chase (world worker).

**Growth, the sheet and experience.** From the character, creature and talk workers.

- The floor as written fails for a player. With the sheet left where it is, standing still costs 15 points a rank (7 on the fight attributes) against about 4 gained, and the readers that take no rank go backward on the day of the trial: carry 40 to 36 kg, sight half a tile shorter, the walk 1.5% slower. That goes against D83, which promises no stat hit at a trial. It holds if the trial lifts the sheet one point on each attribute, as `NpcSheet` already deals everyone the world makes. Call 5.
- The levels inside a rank are a quarter of a rank only at four of them, and nothing makes it four. On today's level curve with experience at x 4 a rank, the third level gained already costs x 1.3 the first of the next rank, so the cheap count is two.
- Part 1 does not say the points are kept. Kept, four a rank on the fight are x 6.76 by SSS, 1.38 ranks over a floor body, and a plain creature of one's own rank then costs 0.9% and not 6.3%. One change of form in a creature's line is about a rank's levels (x 1.56), so the two clocks should be tuned as a pair.
- Experience by power has no end. Paid by power, one rank-SSS kill takes a rank-F character to level 64 on today's level curve and 23 on the proposed one (16 on today's experience table); paid by risk, to level 2. Part 1 decided for power (1.5); the character worker overrules it openly. Call 8.
- A level's price reads only the killer's letter, so a rank-F body with a rank-C weapon is paid 128 rank-F kills' worth for each health bar it loses, where everyone else is paid 16 (creature worker). Call 8.
- The order of worth leaves out four things a person holds: a skill in the hand (x 5.61 today at rank SSS, level 10), frames (21 points from three, where a rank's levels give 4), a passive raised by lore (x 87 after twenty raises), and a follower (one equal beside you, bare-handed, is 0.84 of a rank; two are 1.35).
- Ten seconds between equals holds only for bodies that grow evenly. Two equals who put every point on the blow trade for 5 s at rank C and 2.8 s at SSS; on health, 18 s and 32 s.
- A person is not a floor body: a character dealt for the fight is x 1.82 of part 1's person in power (0.43 of a rank) before any level. And a player's working takes the caster's rank today (`WorldCanvas.tsx` line 343), so if the body doubles at the trial a caster gains x 4 that day and a fighter x 2.
- Rank enters a talk twice, in the other's will and in the line they follow at, as a fight takes it in the body and the tool: 7.6 rounds for an equal, 32.7 for one rank above, x 4.3. So "rank enters a number once" should read "once in each number". Part 1 also has no law for a contest that is not a fight (mine / (mine + theirs)), does not carry D6 (three ranks is an automatic success outside a fight), and does not say whether a body's class reaches its mind.
- The floor is the whole sheet's budget. A dealt person gains 15 points a rank and a character 3 to 5, so at rank A a character holds 7 to 9 of fifteen attributes at the floor. And an attribute on a twenty-sided roll is not read over the floor today: at rank S, intelligence kept at the floor adds 6 more than at F to the same roll.

**The day.** From the character, world, economy and talk workers.

- "The day's energy does not grow with rank" still has four doors open: a harvest's energy (6 at F, 22 at SSS), an energy draught (22 days at SSS), a skill's cut on energy (x 0.18 at rank SSS, level 10) and a worn energy property (one major at SSS is 11.8 days). An energy draught's rank is then a label: it should carry none (economy).
- A thrown stone costs 2 energy to pick up, so the hand that throws spends a day in 25 throws, eight plain creatures at most.
- Decisions a week grow by one a rank by D103, and a leader's tenure is counted in a world's cycles, against the ruling that the server's clock is the clock.
- Time has no size in the spine: a world's cycle runs from 3 hours to 14 days, so a small world lives a hundred times as fast as the biggest.

**Gear and rank.** From the gear worker.

- Rank has no supply. Part 1 says whose rank a number reads and never where a piece gets one. Today a rank is written on each kind: the shipped world's found gear stops at rank D (22 of its 25 pieces are F), a written world's gear is all rank F (the checker read it at `WorldWriter.ts` line 763), and a node ignores its ground's rank. Call 7.
- The bound on a full epic kit is not in the band. With fight ratings read anywhere on the body, an all-moderate epic kit is x 3.84 to x 4.33, a whole rank; read only on their own family of piece, x 2.25 to x 2.47. Then a step past rare adds 0.6% to 1% of power: past two pairs a piece gets wider, not sharper. Call 9.
- Amounts that rank does not move have no law: flat makes a rank-F bag as good as an SSS one, doubling gives 2,560 kg. The gear worker supplies a lift (2.5).
- "A made piece: what it was made of" is not enough while a material has one rank: nothing above the ground's own kinds can be made. Two of a thing refining into one of the next rank makes it true. Call 7.
- Part 1's bar for making (+ 3 for each property held) gives an epic in 20 tries to a maker adding 8 and in 141 to one adding 4, and every deep made piece comes out crude, so honing is needed. And the making roll does not hold a rank: a maker adding 6 gets a piece three ranks above their own 19 times in 20. Only what a piece asks of its wearer holds it.

**Money.** The economy worker found nothing in part 1 broken and five places short.

- It has no money twin of "no bare constant beside a ranked number". The inn sells a day for 20 G, and under the law that day gathers 100 G at F and 25,600 at SSS.
- "Whose rank" needs six more rows: a service (who is served), a wage and a living (the person's own), a building (its station's), a charm (its own), a deed (the ground or world it names), a want (the asker's).
- A ratio of 2 for prices has a stronger reason than part 1 gives. Experience follows the fight at x 4; if gold did too, a life spent would pay the same on any ground and a blow 2.4 times as much one rank up, so nobody would earn at their own rank. Prices sit under the fight's ratio on purpose.
- Nobody sets how often a run ends in death. A death takes the pack and what is worn: a plain kit of five pieces is seven whole runs, so at one death in ten runs it is most of what a run leaves.
- "The numbers move and the words stay" has a second half: a minted piece keeps the value stamped on it. A rank-A blade in a vault says 20,420 G where the law says 3,200.

**Standing worlds.**

- Part 1's call 9 is smaller than it is written. The checker read `ThemeCompiler`, `ContentRegistry`, `ThemeLaw` and `CreatureLines`: a creature's numbers are not kept by formula version but compiled from the theme's words each time a theme is installed, so a new formula already moves every standing world's creatures and materials. What is pinned is the theme's words and what the seed lays. The creature worker is right; the ladder worker and the formula's own header are not. What call 18 still decides is minted pieces with baked numbers and prices, the fold, and saved characters.
- The world worker adds that formulas can move in a standing world and the mint cannot, since the pebble ruling pins the ground by its version; and a standing world put under the proposed fold loses about half its bodies in 17 cycles (925 to 508 a sector) before it recovers by cycle 112.

**Part 1's own ground.**

- "Ten seconds between equals ... the rank Pedro played and said felt good." The checker found the words "felt good" in none of the root documents or section 11; the workers were told them. What he played at rank F is the field the fight worker ran as T0, where no blow reaches a person who walks backward. Every proposal takes that feel as its anchor and then takes away what made it.
- "Two above, a plain creature is your equal, which is where a world's ground stops climbing" stands on `MAX_CLIMB`, a hard stop, which is also the fix for R4. The rule against caps and R4 pull opposite ways. Call 15.

## 2.2 The fight

What it is for: who wins a meeting at the same rank and by how much, in tiles and seconds, so that the triangle Pedro ruled exists in the hand. Today there are no sides: a person is struck only by creatures that shoot. The worker built a field model in two dimensions, matched it to the first wave's field worker (59%, 50% and 54% where that script gave 48%, 49% and 57%), and settled part 1's five disputes by play.

```
a blow          a wind-up by its kind, fixed in seconds; a faster hand (attack_speed, dexterity, haste) shortens the recovery only
                stab 0.15 s on the move; swing 0.3 to 0.5 s at half pace; shot six tenths of its cycle, standing; throw 0.4 s standing
a hit is felt   share = weight / (weight + poise): that share of pace lost for that share of a second, a push of share x weight x half a tile
                a standing wind-up breaks only when the weight is at least the poise; a moving wind-up is never set back
armour          guard / (guard + the blow itself), no top
a shot          flies at its own speed and glances inside its near end, 1 + half its heft in tiles
evasion         a share slipped, no die: evasion x (1 a shot, 1/2 a swing or stab, 0 an area) x the body's footing
opening blow    the blow plus 1 to 3 seconds of its maker's damage (1 for anybody, 2 more through a rating), half the poise, by hand only
a working       a blow on the side of its delivery; its band's telegraph is its wind-up; twice a bow a second stood; an aether buys 3 damage
spent           an arrow, as a stone is
```

| | Today | Proposed |
|---|---|---|
| A person's wind-up | none: a blow lands in the frame the button goes down | stab 0.15 s; swing at half pace, blade 0.4 s, bludgeon 0.5 s; bow 0.6 s standing |
| A bow | 20 tiles at 10 tiles a second, no draw, one a second | 20 tiles at 30 a second, drawn 0.6 s, 0.4 s to recover, glances inside 2 tiles |
| What a set stops | min(0.6, physical_reduction + defense / (defense + 100)) | light set a tenth of a one-second blow, heavy a quarter: 40% of a knife, 22% of a bludgeon, 10% of a medium working |
| Evasion | a keyed roll, rating / (rating + 100); the blow misses whole | a share slipped, by delivery and footing |
| The three edges between equals, winner's health kept | no sides | ranged over melee 35% (x 1.29), speed over ranged 45% (x 2.0), melee over speed 37% (x 1.62); fights of 15 to 17 s |
| The wrong hand one rank up | | wins, keeping 64% to 69% |
| Walks | 4 for everyone; no piece costs pace | heavy set 3.6, ranged 4, speed 4.8 |
| A swing | 3 tiles and 86 degrees | reach 2 + 0.5 for a second hand + 0.25 a step of heft (blade 2.25, bludgeon 3); 46 degrees one-handed, 86 two-handed |
| A working's magnitude, five bands, beside a weapon's 10 a second | 3, 6, 10, 15, 24; no telegraph for a person | 18, 23, 29, 38, 53; its telegraph 0.55 to 1.6 s |
| A working's aether, five bands | 2, 5, 10, 18, 30 | 6, 8, 10, 13, 18 |
| A focus with no working set | a burst of 8 shots for 10 of a day's 50 energy: 80 inside 20 px | an aura at the low band paid in aether; with no reserve, the hand |
| A ward; a debuff | absorbs 2 m; does 1.75 to 3 m, never dodged or stopped | absorbs m; does 1.25 m |
| A pack of four plain creatures | | the right hand keeps 87% to 100%, the wrong hand 59%; at six the wrong hand wins two in three; at eight it loses |

What struck the worker most:

- The triangle hides in the armour formula. Read against the blow, many small blows bounce and one big blow bites, and no bonus names a side.
- Under the set-back of a moving wind-up, six small creatures lock a heavy swing for good: a law that reads well between two bodies was a stun-lock among seven.
- Today's escort is a shield with a name. Beside a shooter against six biters the character keeps 100% and the escort 11%.
- One line of a body's habit decided an edge: the melee body kept 12% against speed when it walked on into the knife's reach and 55% once it stopped at its own. What `MobAI` does with the longer reach is worth more than most numbers.

Not checked, by its own word: nothing was played in the game, and how a wind-up, a push or a broken draw feels in the hand is not something a script can say. Every number in its kits is reasoned, a set that works and not the only one. Each cell is 24 starts with no dice outside the evasion table; crit, glance, block, intimidation, a skill's hand power, wear and energy are left out. The checker ran its scripts again and got its tables byte for byte (550 lines) and the edges over 96 starts (36%, 45%, 37%). One fault was found and not mended: in speed's kit the blade outdoes the knife in every meeting but the opening.

## 2.3 Creatures

What it is for: what a creature is, from its six words, on the same sheet a person stands on; how many stand together; how a kind changes over a world that never retires; and what it pays.

```
a body's share    mass / 4 of a person in health and in work a second; mass is today's appetite
build and threat  points over the rank's floor, dealt from a person's own fifteen values: low 0, middle 2, top 4 (3 for a second top word)
pace              0.5 + 0.5 x p^2 / (p^2 + 4) of a bare walk, p the points of agility: never a walk
a pack            one roll of food (1 to 3 MEDIUM mouths), heads = food / mass, at every regeneration; a kind that is not social stands alone
a leader          holds twice what its kind holds and strikes as its kind; a boss's body is the leader it was (D93)
a property        odds = (0.4 / 0.6) x g / (g + 4) x the kind's weight, g the world's age; depth d with chance q^d
                  sized as a band of the body's own figure
standing          weight x 1.1^((par x felled - fell) / (par x felled + fell)), par = 1 / (share held x share struck); no floor
change of form    one band: two points on the measure the pressure names
a kill pays       50 x the body's power over a plain MEDIUM rank-F body, x (1 + others of its herd awake)
```

| | Today | Proposed |
|---|---|---|
| A body's share of a person, by size | size moves sight, appetite and births only | TINY 1/8, MEDIUM 1/4, LARGE 1/2, GIGANTIC 2, COLOSSAL 5 |
| Build and threat, highest over lowest in power inside a rank | x 7.3 to x 8 (1.44 ranks) | x 1.82 (0.43 of a rank) |
| Standing pace in bare walks | slow 0.5, steady 0.75, swift 0.925, by table | 0.5, 0.75, 0.9 by the curve; 0.95 at 6 points, 0.99 at 20 |
| What stands and wakes together | 1 to 3 at the mint; from regeneration 1 a ground's whole count, largest 9 to 29, and 19 to 61 by the thirtieth | MEDIUM 1, 2 or 3 heads; TINY 2, 4 or 6; LARGE a half to one and a half |
| A MEDIUM leader with 1 to 3 heads | part 1's elite with today's pack: 67%, 98%, then death | 25% to 67%; alone 12% |
| A property's chance at regeneration 1, 5, 10, 23 | 12%, 28%, 48%, certain | 11.8%, 27%, 32.3%, 36%; toward 40% and never there |
| A trait's size | flat: + 30 to 53 health is 150% to 265% of a rank-F body and 0.1% to 0.2% of an SSS one | a twelfth, a sixth or a third of the body's own figure; three of each is x 1.87 in power |
| A kind's standing | x 3 a regeneration of only felling; 1.4 x 10^28 after 60 | 7.3 regenerations to double or halve |
| A change of form | x 2.5 to x 2.89 (0.66 to 0.77 of a rank), same letter | x 1.17; 8 changes x 2.0; 18 changes x 4 |
| A kill pays | by the letter alone: 50, 100, 250, 600 ... 100,000 | a rank-D plain body 800, with a pair 985, a rank-D leader 1,600 |
| A level's price | the killer's letter | the body's scale x the tool's scale: 16 a bar for everyone |
| A post's health | 60 x 1.9^step: 6 s of a common weapon at F, 0.3 s at SSS | 60 x 2^step x the share of what paid for it: 6 s at every rank |
| A leader's tenure | a quarter of it added to two twenty-sided rolls, no end (+ 25 at tenure 100) | its level: a point on the stat its goals named |

What struck the worker most:

- The spine's three classes are already in the code as what a body eats: appetite for MEDIUM, LARGE and GIGANTIC is 1, 2 and 8, over four a quarter, a half and two. The checker found the numbers (`APPETITE` in `ThemeFormula.ts`) and notes that they are marked as guesses and that two of the five sizes are held by one shipped creature.
- At today's numbers ten rats kill a rank-F person in 13 s, and five hounds a rank-E one.
- A kind that only fells people reaches a weight of 1.4 x 10^28 in sixty regenerations, and a warded boss nobody can yet bring down does exactly that to its whole kind.
- A creature's own ward is stored and never read (by reading `MobAI` and `CombatSystems`, not run).

Not checked: every fight is stand and trade, with no movement, dice, armour or triangle. The proposed roll and the standing by rolls were not run through `Population`, nor the line through `CreatureLines`; strength's tenth a point is assumed, and the pace curve was fitted to today's three numbers.

## 2.4 A character's growth

What it is for: what a point, a level, a skill and a rank are worth to a person, and how the day bounds them.

```
a reader        reads only the points over the body's floor, 1 + step; under the floor an amount divides
the trial       adds one to each of the fifteen attributes
a point         an amount: x (1 + over / 10)
                a share of a limit: over / (over + 10), half the way at ten points
                a roll: d20 + over + 10 x the skill's share, against base + 3 x (the task's rank - the roller's)
experience      17 x p / (p + 16) plain kills of the hunter's own rank, p the body's power in plain equals
a level         12 x 1.4142^(level - 1) kills of one's own rank: four levels cost what the first costs a rank up
a skill         x (1 + share), share = levels x 2^rank / (levels x 2^rank + 10 x 2^(task's rank)); paid in work; a level asks 50 x level
the day         a harvest 6 energy at every rank; worn energy a band of a base day; a draught 10; no rest shorter than a base day's
frames          a piece with a rank; a mind carries its focus over the floor and one more
```

| | Today | Proposed |
|---|---|---|
| What a reader reads | points above 1 for most; constitution, endurance, focus and charisma count the first too | points over the floor, for every reader |
| A rank and the sheet | a player gains no point; a person the world makes holds 15 more a rank (35 at F, 155 at SSS) | one more on each of the fifteen |
| A point on an amount | health + 10 flat; melee 4%; a working 2% | a tenth each |
| A point on a share of a limit | 2p / (2p + 100): half the way at fifty | half the way at ten |
| Experience for a fall | a table, x 2 to x 4 a rank | a plain equal 1, one rank above 3.4, the hunter's equal 8.5, never 17 |
| A level, in kills of one's own rank | 5 x level^1.5: 5, 14, 26, 40 (85 for four) | 12, 17, 24, 34 (87 for four) |
| A skill on a blow | x 1.18 at rank F level 10, x 5.61 at SSS level 10, x 26 at level 50 | x 1.29 at four levels, x 1.5 at ten, never x 2 |
| Level 10 of a skill | 17,268 blows at rank F, 210 at A, 6 at SSS | 50 x level of work at every rank |
| A skill born unheld | about 30 tries at F, 62 for a rank-SSS skill | 26 at F, 875 for rank A, 6,477 for SSS by a rank-F person |
| A passive's raise | adds a quarter of itself: x 87 after twenty | adds a minor band: x 6 after twenty for a major |
| A harvest's energy | 6 + 2 x step: 6 at F, 22 at SSS | 6 at every rank: 8 uses a day |
| Energy worn; a draught | one major on a rank-SSS piece 336 to 588; a draught 10 at F, 1,102 at SSS | a band of a base day (4, 8 or 17); a draught 10 |
| A rest | 8 h x (spent / 500)^2.14: 3.5 min for 50, 2.4 s in all for fifty rests of one | 8 h x (max(spent, 50) / 500)^2.14 |
| Frames | six written by hand, 6 or 7 points each, three at most | a piece with a rank: one to four frames take 0, 1, 2, 3 points of focus at rank F, and 3, 7, 11, 15 at rank C |

What struck the worker most:

- The hand's skill never reaches a blow in the shipped world. Run through the game's own functions, a skill minted on a rat, a hound, a humanoid or a machine adds 0% to a blade's blow at level 10: `handPower` wants every tag of the skill on the weapon, and a skill minted in a fight carries the creature's family.
- A skill is paid by the size of the blow: level 10 takes 17,268 blows with a rank-F weapon and 6 at SSS, and 1,295 days of nothing else for a gatherer.
- Fifty rests of one energy restore a day in 2.4 seconds, where one rest takes 3.5 minutes.
- The world's people are already lifted: a rank-SSS person the world makes holds 155 attribute points, a player who reached SSS with four levels a rank 67.

Not checked: the seven fight attributes are not sized beyond health and a blow. The level curve was not played; twelve kills for a first level holds today's total and is otherwise a guess. The bend on experience was "not fought". Nothing was designed for characters that exist.

## 2.5 Gear

What it is for: where a piece's rank comes from, what a piece is worth found or made, how often one is come by, and what a body bears.

```
rank            a kind has no rank; a thing takes the rank of where it came from: ground, body, chest; made, the least rank that went in
refining        two of a thing make one of the next rank on the making roll; a miss spends one and makes nothing
power           50 x 2^step x (1 + quality), found or made; a tool a third
worth           the pattern's bill and labour at its rank, about 8 common materials (W)
a rating        ruler and knee: one native piece gives a quarter of what the rating can ever give (ruler 25, knee 75, both x 2 a rank)
an amount rank  ruler x 4x / (x + 3), x = 2^(the piece's step - the bearer's)
does not move
the ask         1 + step of the attribute of the piece's side; each point short costs the piece one rank; nothing refused
supply          a tool-holding body leaves pieces as its power: plain 1 in 16, leader 1 in 4, boss 4; a chest holds one
the burden      worn + pack + a quarter of the cart; can bear 60 kg x strength's share + bag; walk x 1 / (1 + (borne / can)^4)
```

| | Today | Proposed |
|---|---|---|
| A piece's rank | written on each kind: 22 of 25 found pieces F, 3 D; a written world all F | where it came from |
| A piece's power | found common 50 at F to 397,131 at SSS; made 83 to 387 | 50 x 2^step x (1 + quality) for both |
| A full epic kit over a plain kit, all moderate | no law | x 3.84 to x 4.33 with fight ratings anywhere; x 2.25 to x 2.47 on their own family |
| A rating's knee | 100 for defense and evasion; raw chances for crit and block | three native pieces' worth at the other's rank |
| A bag | 10 + 5 kg a rank on any body (35 kg at A) | 10 kg at an equal, 5.7 one rank below, 16 one above, never 40 |
| What a piece asks | 1 + 2 x step of one attribute, refused under it (17 at SSS); a bow asks strength | 1 + step: bow dexterity, light agility, heavy strength, medium constitution, jewellery nothing |
| Pieces a plain creature leaves | 2.9% a kill | 1 in 16 from a tool-holder; a body with no tools leaves matter |
| Pieces a chest holds | 3.7 | 1, and goods |
| Pieces a run turns up | about 7.9 | about 2.9: 20 over a rank's seven runs, against 15 positions |
| How deep found pieces go, a rank | the 60/25/10/4/1 roll, empty until the unlock | q = 0.4: 3.3 magical or deeper, 1.3 rare or deeper |
| Making an epic by enhancing | nothing adds to a finished piece | a maker adding 8: 20 tries, 2.7 pieces begun; adding 4: 141 tries, 21 pieces |
| A tool against a node | 15 x 1.6^s against 5 + 8s; a rank-B tool opens every node to SS | 15 x 2^s x (1 + quality) against 10 x 2^(ground's step); the rank above only superior with a major prefix |
| A heal | 30 x 1.8^s: 27% of a body at F, 3,005% at SSS | 30 x 2^s: 30% of a body of its rank |
| Carrying | 30 + 10 x strength; worn weighs nothing; x 0.5 above 80%; a pickup past the limit refused | one curve: at the floor a heavy set alone x 0.81, a medium kit with 30 kg x 0.75 |
| Kilograms | bludgeon 20, bow 8, chest 15, ring 1 | sets 9 / 20 / 42 light to heavy; bludgeon 8, bow 2, light blade 1.5, jewellery 0.1 |
| Wear | 100 uses; only the firing hand and the chest piece wear | the piece that did the work wears; a full repair a quarter of its bill |

What struck the worker most:

- Nothing found is above rank D. A rank-A creature asked for gear of its rank hands over one of three rank-D pieces.
- Nine pieces in ten come from chests: sixteen kills leave 0.47 of a piece and the 1.45 chests among them hold 5.37.
- Where a stat may sit is worth a whole rank: the same kit is x 4.3 if a ring may carry guard and x 2.5 if it may not.
- At today's ask a person can hold about three attributes by rank SSS, and aiming above oneself is always right at the bench as built.

Not checked: the kit comparison is health against damage a second through today's reader shapes, with no movement, triangle or dice, so its ratios are trusted and not its sizes. The rulers, knees, kilograms, the 60 kg, the fourth power of the burden and W = 8 are chosen. The checker finds several of these against rulings (2.10): the list of where a stat may sit, a ruler and knee hand-set for every stat, seven gift words for a material, a tool still refused a rank up, and an energy draught that reads two ranks.

## 2.6 The world

What it is for: what the land holds, how it changes when nobody is in it, what a place costs to take from, and how much of it a mind may read in a cycle.

```
ground          share at least d ranks above the world's = 0.4^d, the ladder's own q
a drop          the nearest open ground of the world's own rank
a node          its kind picked at or under the ground's rank, each rank further counting 0.4 as much
a taking        a channel made standing that a hit breaks: 5 s with a tool of the node's rank, 2 s by hand
a weak tool     never refused: seconds = the form's x (1 + the node's ask / the tool's power)
the land        a hunter draws half its food from the ground and catches the rest; the hunt follows hunger with reach 2;
                a bigger hunter of at least its rank takes a smaller; minted at 85% of its food, a fifth of its bodies hunters
recon           intelligence + perception + focus sector-levels a cycle of a world; a reading fades 0.75 a cycle;
                a map costs what its reader would have paid for the same readings, fixed at writing
```

| | Today | Proposed |
|---|---|---|
| Ground at the world's rank, one above, two above | 60.2%, 17.3%, 22.5%, and a hard stop at two | 60%, 24%, 16% if it stops; 60%, 24%, 9.6%, 3.8%, 1.5% and on if not |
| Drops that land above the world's rank | 34% in a rank-F pocket world, 46% in the tutorial | none |
| A harvest and a chest | instant; 2.5 to 6.5 s promised for a harvest and never waited | 5 s with a tool, 2 s by hand, standing, broken by a hit |
| The commonest creature a week after the mint, small rank-F world | Tally Rat, 70% (32% at the mint) | no kind over about a third (model) |
| The mint | 60% of food eaten at rank F, 105% at rank D; 46% to 50% hunters | 85% eaten; about a fifth hunters, swinging by two |
| Chest guards that never strike | 47.8% in a rank-F world, 12.9% in a rank-D one | none: a guard is drawn from what hunts |
| A tool one, two, three ranks under the node | refused | 7.5, 12.5, 22.5 s; 5 s at par, 3.75 s one over |
| A snare on a fresh body | 50% at F falling to 10% at SSS, whatever it is tied from | 50% at the snare's rank, 33% one above, 20% two above, 67% one under |
| A plot of grain, 16 beds | ripe in an hour, reaped for no energy; its trough feeds 6,912 mouths | ripe in a day, reaped at the hands' energy; a day feeds about 150 mouths |
| What a character may read of a world in a cycle | all of it, free: a small world is 546 presses of a key | 3 sector-levels at the floor, 7 for the mean deal, 30 for an analyst |
| A world deed's chance | 1 in 5,000 plain kills at F to 1 in 45 at SSS | 1 in 5,000 at every rank, x 4 on an elite, x 16 on a boss |
| The last warning before a gate shuts | a sixtieth of the up time: 1 minute small, 2 hours biggest | 3 minutes at every size |
| Clear ground at a drop | 14 tiles everywhere | 14 tiny, 17 middling, 20 large: the widest night sight plus a pack's spread |

Left out of the table on purpose: the world worker's money of a day (75 gold by hand, 24 with an axe; a rank-E pick on rank-F ground 653 against a hand's 75). The checker found its script priced a material by a value the game never reads. The stamp the counter pays on makes a day of ore with a pick 720 where the script has 24, and the silver day 750 where it has 653. "A tool makes the hand poorer" and "a body and a day already pay the same at rank F" are not true of the code. The proposed law of a day may still be chosen, but not because rank F already does it. That a node ignores its ground's rank is true, and the gear worker found it too.

What struck the worker most:

- Left alone, every world becomes rats: a slow slide to one kind, the same in every world, bounded by food. Nothing dies out and nothing explodes.
- After one cycle the land stops dealing packs: the fold stands a kind's whole count on a chunk in one spot (19 on the middle chunk a week on, 54 on the fullest).
- Every gate closes in the dark: the closing warning lies wholly inside the last night, at every size.
- Half the guards of a rank-F world's chests are hens, moths and pigeons.

Not checked: the model is not the fold. It leaves out leaders, territory and changes of form, and matches the real fold within 2% only under today's law. The proposed land was tried on eight sectors of two worlds; in the rank-D world it tilts toward the smallest grazer (17% to 41% of bodies) and thins hunters to about 10%, and that was not mended. Its five numbers were found by sweeping, and only "reach must exceed 1" is derived.

## 2.7 The city's economy

What it is for: one coin and one unit of worth, so that what a run earns, what things cost and what a hub prints keep the same proportions at every rank. Pedro's two complaints are both true today and come from different places: too much is ore, pebbles and chests; not any is what creatures leave.

```
coin            coin(rank) = 2^step, the spine's scale; a price = coin(rank of what is priced) x a count that reads no rank
a piece         one common piece of gear, 100 G at F: the unit every price is counted in
income          a life of fighting wins two pieces; a day's energy gathers one
a drop          2 pieces x the body's share of a person's power, at the body's rank
a material      worth the energy it took
counter, shelf  counter value x (1/2 + k/2); shelf value x (1 + (1 - k)/2); k = favour / (favour + 100)
services        a bed or a reading: a fifth of a piece of who is served; a charm, a permit, a deed, labour: their own rank's coin;
                a house, bare ground and a lot stay flat
a room          one rating, additions + the house's own + leadership, read as R / (R + 135 x coin(building's rank))
```

| | Today | Proposed |
|---|---|---|
| The ratio a rank prices by | gear x 2.52 to x 3.5; junk, anchors and tolls x 2.2; lore x 1.5; ore + 20 G a rank; services, permits, charms, deeds, labour x 1 | x 2 for all of them |
| A common piece in ore of its own rank, F / A / SSS | 1.7 / 127.6 / 3,610 | 12.5 at every rank |
| A day of ore at F / D / A | 720 / 750 / 720 G | one piece: 100 / 400 / 3,200 G |
| A plain creature's drop | 5.7 G at F, 0.03 to 0.06 of a piece; 0.002 of a piece at A | an eighth of a piece; a leader a half; a boss 8 pieces |
| One chest, F / D / A | 4.2 / 3.5 / 3.4 pieces | 1 piece (a stand-in) |
| What a whole run leaves off the shelf, F / D / A | 1.05 / 1.42 / 1.27 pieces | 0.75 at every rank; fighting alone 0.35 |
| Bartering at which the counter out-pays the shelf | 189 plain, 100 with a pressed keeper, 46 to a pressed trader's patron | never (searched to 200,000) |
| Treasury coin for one piece sold at the counter | x 1.76 of its value | x 0.5 |
| Identify; a night at the inn | 100 G and 20 G at every rank | a fifth of a piece of who is served: 20 G at F, 640 G at A |
| A heal draught | value 1 G, 5 G on the shelf | a tenth of a piece; 15 G x coin on the shelf |
| A room's upkeep with six moderate additions / 100 | 40% / 40% (the top) | 25% / 84.7% |
| A clasp; a permit; a world deed; a second of labour | 180 G; 150 G; 150 G; 1 G, at every rank | 1.8 pieces of the charm's rank; 1.5 of the station's; 1.5 of the world it may mint; 1 G x coin |
| What a model call may spend | $0.05 a talk, $0.50 a rest, $0.50 a world's window | unchanged |

What struck the worker most:

- A material has two prices and the game reads the wrong one. The formula writes 2 x 2.2^step x worth on its definition; the factory stamps the item weight x 4 + hardness and never looks, so ore is 60 G at F where its definition says 2. The checker confirmed it by running the game's functions.
- A day of ore is worth the same gold at every rank (720, 750, 720), because a taking's energy and hardness climb in step.
- Rank F is already the law for what creatures leave, by accident: the shipped tables land a plain creature and a leader on the spine's sixteenth and quarter of a person, counted in pieces.
- The weekly tax has no rate; the map sets it. A 4 by 4 lot pays an eighth of everything the web has made that the city holds, each week, and the largest lot of the second chunk pays twice all of it. A person's vault and what they wear count as the city's, by reading.

Not checked: the reference run is a stand-in, part 1's sixteen plain creatures at three blows. How often a run ends in death is unknown, and the cost of a death and the price of insurance both hang on it. Two pieces for a life, one for a day, the favours and every share of a piece are reasoned: they hold the orderings and their sizes are for play. The farm, herds, capture, cooking and making by two were not read.

## 2.8 Talk and minds

What it is for: every roll of one mind against another (a round of talk, asking, a leader's seat, a meeting nobody watched) on one law, so that equals contest the same way at every rank.

```
a contest       mine / (mine + theirs); each side is its rank's scale x a share of its points over the floor
a round         the voice: charisma + the attribute their want names; the will: intelligence + focus; a point a tenth
                the judge's band multiplies the voice by 1/2, 0.71, 1, 1.41 or 2: the best words are worth one rank
regard          100 x standing / (standing + 1); a landing doubles standing, a miss divides it by 2^(1/4)
following       standing 2 x 2^(their rank - yours) x (1 + how many already follow) / share(leadership over your floor)
a gift          standing + its worth / a plain piece of their rank, twice if a gift is what they want; coin the same
needs           days in hand; three of the five rungs are facts the books hold, belonging is the one meter
a want          1, 3 or 5 days of that need at their keep, and it gives those days
a leader        d20 + the stat's points over its own floor, against the bar + 3 a rank its ground stands over it
                tenure: + 3 x weeks / (weeks + 8), weeks on the server's clock
memory          90 days and the usual, as ruled
```

| | Today | Proposed |
|---|---|---|
| A plain round against an equal | 47% at F falling to 23% at SSS, charisma at the floor of your rank | 44% at every rank |
| A rank of gap | + 8 on the roll for each rank they hold, an equal included (+ 64 at SSS) | x 2 on their side: one above 28%, two above 16%, three above 9%, one under 61% |
| A judged round | - 25, - 10, 0, + 10, + 25 on the roll | shown as - 16, - 8, 0, + 9, + 17 against an equal |
| The meter's five marks | 10, 30, 50, 70, 90 | 11.1, 33.3, 50, 66.7, 88.9 (standing 1/8, 1/2, 1, 2, 8) |
| Rounds to turn an equal stranger: plain, good, best words | 10.2, 6.8, 4.6 at F; 339, 30.2, 9.7 at SSS | 7.6, 5.6, 4.5 at every rank |
| One rank above, plain and best words | 16.6 and 5.5 from rank F with charisma 1 | 32.7 and 11; two above, never on plain words and 42.7 on the best |
| The line someone follows at | 70 less 2 a point of leadership, any number of followers; 0 at 36 | rises with each follower; leadership brings it down; no limit |
| A gift | + 10, or + 25, for the least valuable thing carried; 2 energy, no roll, no rank | its worth against a plain piece of their rank |
| Asking what someone one rank above wants | 43% at F, 47% at C, 49% at SS | 33% at every rank |
| A leader's bad decisions | 10% at F, 5% at E, never from D | 5% to 10% at every rank; a 1 is always bad |
| Tenure | a goal done each cycle, a quarter on the roll with no end | toward one rank's worth, on the server's clock |
| Needs | five meters held 0 to 100; five days unfed leave survival at 45 for good | days in hand |
| A round in the city | no energy | 5 energy, as in the field |
| A talking creature's will | 1.7 points against a person's 2.7, whatever its body | that, times its class: plain a quarter, elite a half, boss twice |

What struck the worker most:

- Four of the cheapest things carried bring home anyone of any rank: a gift costs 2 energy and moves the meter 10 with no roll, where a talk on plain words costs 51 energy at rank F.
- Today's five marks are within 3.3 points of doublings, and under the law a rank costs about four times the rounds, as it is four times the power in a fight. Neither was aimed at.
- From rank D no leader can make a bad decision, so no seat is ever challenged from inside; tenure puts a seat beyond challenge after 5.6 days on a one-hour world.
- The judge is told the roll before it judges and asked not to use it. Today its band decides the round on 50 of the hundred faces.
- By the code's own doors a frame is not owned and the same one can sit in three places, so any character can wear + 12 charisma.

Not checked: no round was played against a model, and every table holds one band for a whole talk, so how often a real judge gives each band is unknown. A leader's cycle was not folded. What Persuasion and worn voice add were not sized.

## 2.9 The affix run

Part 1's law: an amount, added to a figure, is a prefix; a rating, read through a curve against a rank, is a suffix; so the side of a stat is decided by its reader. Part 1 cleaned the keys: `defense` and `physical_reduction` become one rating, guard; the two carry keys become one; `attack_speed` splits into a weapon's own rate, never an affix, and haste; luck gets a reader; nothing numeric is kept on a piece.

The seven lists hold about 160 rows. Merged, with the lanes that name each stat:

| Stat | Side | Reader, as it is or as it needs | What roots it |
|---|---|---|---|
| **On a weapon** | | | |
| damage (gear, fight, creatures) | amount: prefix | `CombatMath.weaponDamage`, off the weapon in the hand (today summed over the body) | the weapon's bench or the forge; a hammer; a harder material |
| poison: venom, poison_damage (gear, fight, creatures) | amount: prefix | `CombatMath.outgoing`; a creature's plain blow needs one | the weapon's or the apothecary's bench; a vessel or mortar; a toxic material (toxicity is read and never written) |
| weight of a blow, new (fight, gear) | rating: suffix | needs the hit's share in `CombatMath.incoming` | the forge; a hammer; a dense metal |
| arc, new (fight) | rating: suffix | needs one: 0.75 is inline in `CombatSystems` | the forge; a grindstone; a long or curved head |
| reach of a blow, new (fight, creatures) | two sides | needs one: inline in `WorldCanvas`, `Escort`, `EffectSystem`; `MobAI` uses 50 px for every creature | a carpenter's bench, a lathe, a long shaft; on a body, limb or bone |
| flight, new (fight) | rating: suffix | needs one: one speed for every projectile | a fletcher's bench; a knife; straight shafts and feather |
| crit, crit power, accuracy (gear, fight, creatures) | rating: suffix | `CombatMath.outgoing`, raw today; no settled reader under the fight's law | the weapon's bench; a whetstone, hammer or plane; honing, weighting a head, fletching |
| haste: attack_speed worn off the hand (part 1, gear, fight, creatures) | rating: suffix | `CombatMath.fireCooldownMs`, split into wind-up and recovery; the recovery only | a fletcher's or jeweller's bench; balancing |
| ambush, new (fight) | rating: suffix | needs `CombatMath.outgoing` told the target had not noticed | a whetting bench; whetstone and soot |
| arrows carried, new (fight) | amount: prefix | needs the count `FieldInput.throwsLeft` keeps for stones | a tanner's bench; an awl; hide |
| **Worn for the fight** | | | |
| guard: defense and physical_reduction (part 1, gear, fight, creatures) | rating: suffix | `CombatMath.mitigationOf` | the armourer's bench; tempering (gear), or plate and hide (fight, creatures) |
| evasion (gear, fight, creatures) | rating: suffix | `CombatMath.incoming`, told the delivery and footing; no kind carries it today | a tailor's or cobbler's bench; cutting close (gear), supple hide (fight) |
| block (gear, fight, creatures) | rating: suffix | `CombatMath.incoming`; needs a shield, which is not a kind | the armourer's or carpenter's bench; rimming, a rim |
| poise, new (gear, fight, creatures) | rating: suffix | needs the hit's share | the armourer's bench; padding, bracing, a dense plate; on a body, its bulk |
| pace: movement_speed (gear, fight, creatures) | rating: suffix | `LoadoutSystem.walkTilesPerSecond`; on a body, `def.speed` in `MobAI` | a cobbler's bench; an awl; soling |
| the cost of weight: movement_speed_penalty (fight, gear, ladder) | no agreed fate | read today, written by nothing | a kind's own word (fight); gone into the burden (gear); folded into pace (ladder) |
| max_health (gear, creatures) | amount: prefix | `StatSystem.maxHealth`; on a body, `bonusHealth` | a jeweller's or armourer's bench; a dense material |
| quiet: noise_reduction (gear, fight, creatures) | rating: suffix | `MobAI.tick`; a person noticing a creature waits on the hiding pass | a tailor's or cobbler's bench; muffling, felt |
| sight: light_radius (gear, fight, creatures, world) | two sides | `StatSystem.sightPx`; nothing reads it as noticing | glassworks or a chandler's; a luminous material; the fight worker leaves it to the hiding pass |
| **Workings** | | | |
| reserve: aether held (fight; the character worker keeps the key focus) | amount: prefix | `WeaveSystem.capacity`, read and never written | a jeweller's bench; a drill; a resonant stone |
| potency, new (fight) | rating: suffix | `EffectSystem.resolve`, where castPower enters | a jeweller's bench; a conductive setting (nothing writes conductivity) |
| thrift of a cast, lasting, new (fight) | rating: suffix | need `WeaveSystem.aetherPerElement` and `EffectSystem.statusOf` | a jeweller's bench; a finer cut |
| **The day, the hands and carrying** | | | |
| max_energy (gear, character) | two sides (below) | `StatSystem.maxEnergy` | the piece's own tech: a resonant material (gear), weaving (character) |
| energy_restore (character); restore: health_restore (gear) | amount: prefix | `RestSystem.refillEnergy`; the store's `useConsumable`, which three writers feed on unrelated scales | alchemy or cooking; a still or hearth |
| carry, one key (part 1, gear); reach of the hands: pickup_radius (gear) | two sides (below) | `LoadoutSystem.carryLimit` as the one door; `StatSystem.pickupRadiusPx` | a loom or tannery; a needle or hook; fibre or hide |
| durability, lightness, new as properties (gear) | amount, a share of the piece itself | `wearSlot` and `repairCost`; `ItemFactory.getWeight` into the burden | the piece's own bench; a tougher or lighter material |
| luck: luck_find_rarity (part 1, gear) | rating: suffix | none today: the depth roll at the mint | a jeweller's bench; a graver; a working, never a material |
| reading: field_analysis_speed (gear, character) | rating: suffix | `StudySystem.askAt` | glassworks; a lens grinder |
| mastery, fed; rest_ease, learning, study_care, lore_yield, forgiving (character) | the first two amounts, the rest ratings | each needs one (the skill's share in `WebSystem`, a day-long record, `restMs`, `learnRate`, `harmItem`, `paysFor`, `energyFor`) | the tool's, the kitchen's or the station's own trade; a scribe's station for lore |
| experience (character) | rating: suffix | needs `ProgressionSystem.gainXp` | none: not to be minted before the pace of a rank is ruled |
| a meal's lent measure (fight) | the side of the stat it lends | needs one: a meal's affix is written and never read | a kitchen; pot and knife |
| a cart's lock, rolling, alarm (gear) | lock an amount; the others ratings | `towBreakSeconds`; `towSpeedModifier`; `securityOf` | a smithy, a file; a wheelwright's bench; a bell |
| **Taking from the land** | | | |
| tool power: mining_power, chopping_power (ladder, gear, world) | two sides | the gate in `InteractionEngine` today; needs the seconds in the harvest | a toolmaker's bench; head and haft |
| yield, new (gear, world) | two sides | needs the harvest roll | a toolmaker's bench; setting an edge |
| thrift of a taking; sure hands, new (world) | rating: suffix | `WebSystem.energyFor`; `StatSystem.channelMs`, which reads hacking alone | the haft's material; the signal tech of the eyes piece |
| survey, new (character, world) | two sides | needs the recon budget where `reconEfficiency` stands | the recon station, lens and glass (world); unrooted (character) |
| hold of a map; hold of a snare (world) | rating: suffix | `SurveySystem.levelNow`; `Capture.trapOdds` | the scribe's table and pen; trapping and fibre |
| lure, calm, patience (world) | rating: suffix | none for lure; `Herd.daysToKeep`; `Farm.growMs` | cooking; husbandry; farming |
| fodder, tilth (world) | amount: prefix | `Herd.worthOf`; `Farm.yieldOf` | farming: bed, hoe, seed |
| worth of a material (world, economy) | amount: prefix | `materialNumbers.value`, which the mint never reads | the material's own entry |
| a node's richness; its stubbornness and regrowth (world) | an amount; ratings | `FORM_USES`; the harvest's seconds; `FORM_REGROW_MS` | the material; farming, forestry |
| **A body and a kind** | | | |
| health, damage, poison, reach, sight, what it leaves (creatures) | amount: prefix | `bonusHealth` and `bonusDamage` today; the rest need one | what works what the body leaves: the creature is the material |
| a body's guard, evasion, block, accuracy, crit, haste, poise, quiet (creatures, fight) | rating: suffix | all wait on one door: a blow on a creature going through the sums a blow on a person does | as above |
| wariness; will, called composure in talk (creatures, world, talk) | rating: suffix | Capture's temper and Herd's wariness; `TalkLaw.toughness` | none (creatures); husbandry and trapping (world); the intelligent skill (talk) |
| births, called fecundity in world; roaming (creatures, world) | births two sides; roaming a rating | `bodyNumbers.birthRate` and `roam` | none (creatures); husbandry and herding (world) |
| appetite (world); meat (world) | amount: prefix | `bodyNumbers`, by size word; `preyYield`, one number for every kind | husbandry or hunting; butchery |
| a boss's works: a post's hardness, the works' gift, a watch's reach, a muster's heads (creatures) | amount: prefix | `Territory.entityFor` and `layOver`; `WATCH_TILES` | the works as workstation, the boss's trade as tool, what paid as material |
| a world's odds and density (creatures) | rating; amount | the trait chance and the mint's depth roll; `mobDensityMultiplier`, read by nothing | handed to the world worker, who lists neither |
| **Minds and talk** | | | |
| voice, presence, insight (talk) | rating: suffix | `TalkLaw.required`; the follow line; `TalkLaw.askRequired` | Persuasion, a seal; Escort, the tavern; Appraisal, a lens |
| gift_worth, keepsake (talk) | amount: prefix | the gift in the store, which reads nothing of the thing; `Deeds.gift` | what the thing is made by |
| company, called seats in economy (talk, economy) | amount: prefix | the follow line's count; `ApprenticeRoad.roomFor` | carpentry: bench, saw, wood |
| welcome, familiarity (talk) | amount: prefix | `MeetLaw.fillOf`; `HabitLaw.routine` | carpentry; cooking |
| temper: where standing starts (talk) | amount: prefix, negative as a price | `MonsterMind.startingMeter` | the kind's own line |
| command; counsel (talk) | a rating; an amount | `stepLeader` and Territory; `DecisionLayer.perWeek` | the place's own works |
| tutelage, called teaching in economy (talk, economy) | rating: suffix | `ApprenticeRoad.day`, whose stop at 1.5 hours would become a curve | the trade's own bench |
| steadiness (talk) | rating: suffix | needs one: `FieldEscort.fall` writes nothing to regard | Escort |
| an attribute on a frame (character; talk refuses it) | amount (character); neither (talk) | `recalcAttributes`, which reads frames from a table | a scribe's station (character); outside the web (talk) |
| **Making and the city** | | | |
| thrift of upkeep: upkeep_discount_pct; bench_pace: craft_speed_pct (economy) | rating: suffix | `roomProcessBonus`, whose tops of 40 and 30 go | the wall's own trade; the station's own tech |
| haggle, false_bottom, mending, careful_hands, raising (economy) | rating: suffix | `vendorOffer` and `shopPrice`; `levyDodgeOdds`; `repairFactor`; `SalvageSystem.components`; the build clocks in `room.ts` | weaving; tax evasion at the scribe's table; smelting; the trade that makes the thing; masonry or carpentry |
| keeping_days, room_asked (economy) | amount: prefix | `ShopWeek.stockDays`; `stationMinAreaOf` | glassblowing; the station's own tech |
| safe_conduct, hearth (economy) | rating: suffix | `Toll.owed`; `residentUpkeepPerDay` | the scribe's table; cooking |
| toll, assay (economy) | amount: prefix | `tollOwed`; `anchorNumbers` | what a leader builds; assaying |
| kept, called slots kept in world; the hour of a scroll; opening of a forced way out (economy, world) | an amount; ratings | `InsuranceSystem`; `durationSeconds`; `channelMs` | the scribe's table or the charm's bench; the working's own tech |

The checker's faults in the merged run, and how each would be settled:

```
two sides         tool power: an amount (ladder, gear), a rating against the node's rank (world)
                    settled with call 11: a rating if a taking is a channel, an amount if not
                  survey: an amount (character), a rating (world)
                    the world's, since the checker keeps the world's recon
                  yield (an amount in world, a rating in gear); a creature's sight (an amount in creatures and fight,
                  a rating in world); a blow's reach (tiles in creatures, a share in fight); births (an amount in creatures,
                  a rating in world)
                    part 1's law decides once the reader is chosen; nobody has chosen it
                  energy, carry, sight and pickup on a piece: amounts in ladder, gear and character; gear's lift reads them
                  against a rank, which by the ladder's own test makes them ratings
                    open between part 1's "no rank at all" and gear's lift
the root rule     "a rating roots in a working, an amount in a material" (1.4) is broken by the fight's roots (weight in a
                  dense metal, guard in plate or hide, evasion in supple hide, reach in a long shaft) and by the creature
                  worker, who roots every property on a body, ratings too, in what the body leaves
                    either the rule holds and those roots move to the working (gear's guard in tempering already does),
                    or "the creature is the material" becomes the rule for bodies; open
named twice       reserve and focus; venom, poison and poison_damage; hide and guard; footwork and evasion; will and
                  composure; births and fecundity; what it leaves and meat; kept and slots kept; seats and company;
                  teaching and tutelage; reading and field_analysis_speed; restore and health_restore;
                  stubbornness and hardness; thrift and bench_pace for upkeep_discount_pct and craft_speed_pct
                    one key each; the ladder keeps the code's old keys where there are any; reserve and not focus,
                    since focus is a mind attribute (D22)
one name,         reach (the hands' pickup, a blow's length, a watch's sight); thrift (a cast's aether, a taking's energy,
several stats     a station's fee, a building's upkeep); hold (a map, a snare); temper (where regard starts in talk; in the
                  code, a creature's wariness); build (the fight's poise and the creature's word); haste (worn rate of fire,
                  and the effect door's pace); weight (a blow's, and kilograms); quiver; worth; density
                    a name each
a collision       appetite as a property on a kind (world); under the creature worker's law appetite is mass, so moving
                  it resizes the body's health and blow
                    follows from call 2
no reader         every rating on a creature's body waits on one door: a blow on a creature going through the sums a blow
                  on a person does; until then eight stats are read by nothing
                  crit, crit power, accuracy and block have rulers from gear and no reader under the fight's law
                  a creature's accuracy (under the fight's law a blow is not dodged, and accuracy is fewer glances)
                  movement_speed_penalty has three fates                                                 call 10
                  sight as noticing, a creature's quiet, ambush                                       the hiding pass
                  steadiness, keepsake, temper; a world's density and odds; experience (character: do not mint it)
no writer         conductivity: gear's seven gift words leave it out, and the fight roots potency in it
no root           experience; wariness, will, births, roaming (the creature worker says none; the world worker roots three
                  in husbandry and herding); a world's two properties; sight; temper, command, counsel; toll
missing words     four lanes root in a scribe's table and a pen; the economy marks a needle, a pen, a pot and a furnace
                  "to be written": words the registry does not have
root left over    the fight writes "the ladder worker's" for haste, accuracy, crit, pace and max_health; the ladder gives the
                  rule and no root; gear's table gives them
sizes that        energy on a piece (0.83 or 8 for a moderate): the character worker's 8, by the checker
disagree          weight and poise (plain 1 to 3, or ratings that double a rank): the fight and gear workers' to settle
                  guard's knee (100 x scale, six chest pieces, or the blow itself): the fight's
                  tool power (10 or 15 x scale asked): the world's, if a taking is a channel
```

## 2.10 What the checker found

The checker read the eleven proposals against `STAT_TREES.md`, this document and the rulings in `PLAN.md`, `PLAYTEST_LEDGER.md` and `DESIGN_ASK.md`. It checked three claims by running or reading the code, said below. Its report file was refused by the tool that writes files, so its findings come from the run's journal.

**Conflicts between lanes**, and which value the checker would keep:

| What | The values | Kept |
|---|---|---|
| The class of a body | part 1's table, used by gear, economy, character, world and talk; the creature worker's size as mass, a leader twice its kind, a boss the leader it was (under which a middling leader and its boss are each 1/8 of a person in power) | the boss row by D93; the rest is call 2; the five dependents are worked again either way |
| What a kill pays | by power, x 4 a rank, no end (the creature worker's own table pays 16.5 million for one rank-S giant); bent by risk, never over 17 kills | call 8; the checker would keep the bend for what is paid and the creature worker's reading of what a body has become for p |
| A level's cost | 12 x 1.414^(level - 1), 87 for four (character); today's 5 x level^1.5, 85 for four, with the tool's rank (creatures) | call 8; the two agree for four levels and part after |
| Heads to a pack | food fixed at 1.5 mouths (world); food rolled 1 to 3 (creatures) | the creature worker's |
| What a set stops | knee 100 x the scale of the blow's rank (part 1); knee of six chest pieces, light 14%, medium 25%, heavy 33% (gear); the blow itself (fight) | the fight's; gear's sizes run again |
| What weight costs in pace | a fifth for a full set (part 1's body worker); a tenth by heft (fight); one burden (gear); folded into pace (ladder) | call 10; the fight's tenth meanwhile, since its edges were tuned at a walk of 3.6 |
| Evasion and block | a chance (ladder, gear, creatures); a share slipped (fight) | the fight's |
| A weapon's seconds and tiles | bludgeon 0.5 s, blade 2.25 tiles at 46 degrees, a shot weighs 1, near end 2 (fight); 0.4 s, 3 tiles, a bow weighs 0 (gear); near end 3 (part 1's body worker) | the fight's: a weightless shot leaves ranged 24%, a near end of 3 lets melee beat ranged |
| Weight and poise | plain numbers 1 to 3 (fight); ratings that double (gear: a heavy weapon 3 at F, 768 at SSS) | not Pedro's: the fight and gear workers settle it; nobody played a heavy blow of one rank on a set of another |
| A tool against a node | asks 10 x scale, 2 s at par, refused a rank up (gear); asks 15 x scale, 5 s, never refused (world) | the world's if a taking is a channel (call 11), else gear's |
| A day of gathering | one piece, worth words 1, 2, 4 (economy); 75 gold, words 1, 3, 9 (world); a piece and a half (gear) | the economy's, as owner of prices; the size is call 4 |
| What a plain kill leaves | an eighth of a piece (economy); 5.8 x scale (world); a fifth of a piece's worth (gear) | the economy's, once calls 2 and 4 are answered |
| A chest | a piece and goods, two a run (gear); one piece, one a run (economy); 99 a sector (world) | call 4 |
| What a piece comes apart into | a half (economy); three quarters of its bill (gear) | a half: at three quarters the counter is always worse than taking it apart |
| A clasp | 1.8 pieces (economy); one piece (world) | the economy's, with the question of what a death costs |
| A world deed | worth its sectors, no rank (world, by D80); the rank of the hardest world it may mint (economy) | call 24 |
| Energy on a piece | a focus carries 5 and is the ruler (gear); the ruler is a base day of 50 (character) | the character worker's |
| An energy draught | 50 x r / (r + 4 x the drinker's scale) (gear); 10 at every rank (character); no rank, off every shelf (economy) | the character and economy workers': gear's brings rank back into energy |
| The carry limit | 60 kg at the floor, a quarter more a point of strength, worn counts (gear); today's 40 kg (economy, world) | gear owns it; it breaks the character worker's one size for a point, and both money ledgers run again at 60 |
| Bartering and leadership | half the limit at ten points (character); favour on a knee of 100 (economy) | the economy's shape; the size between the two |
| A rank in a talk | 15 of a hundred (character); the other side doubles (talk) | the talk worker's |
| A leader's tenure | goals done, as points on its sheet (creatures); weeks on the server's clock (talk) | the talk worker's clock; sheet or roll, either |
| Recon | 1 + floor(the three attributes over the floor / 6) a scan (character); a budget a cycle on raw points (world) | the world's; raw points or over the floor is open, and matters if the trial lifts the sheet |
| A creature's working | 6 x scale x cost (part 1); its own blow x band (creatures); by its telegraph (fight) | the fight's for a person's cast; for a creature, open |
| A frame | a piece with a rank, as many as focus carries (character); moves points, never adds them (talk) | call 20 |
| The aether reserve | as it is, 20 + 5 x focus (fight); an amount x (1 + over / 10) (character) | the fight's |
| A line's change of form | keeps its letter and a quarter (part 1); two points and the next letter (creatures) | call 21 |
| The odds of a property | straight in regenerations (ladder); an age that saturates (creatures) | the creature worker's |
| The floor | lifted (character); a budget the sheet falls behind (talk); gear's ask written for an unlifted sheet | call 5 |

**Joins nobody wrote.** Each lane assumed the other would write these.

- The size of a point of agility, dexterity, perception, intimidation and subterfuge in a fight. The character worker left them to the fight worker, who asked the character worker. The checker calls it the largest hole in the eleven.
- A creature's own blow from its words. The fight worker owns the formula from words to seconds and the creature worker the words; neither wrote the join.
- What stops a shot: the world worker has the measurement (wood would stop one shot in three at ten tiles), the fight worker has to rule it.
- The trial's count: gear's loot law has to give the chance a plain body leaves a thing the trial counts.
- Rulers and knees for the new stats: gear owns them, and gave them for weight and poise only, where the fight names ten new stats.
- That a fight rating is read only from its own family of piece: gear's whole kit bound turns on it and the fight worker did not take it up (call 9).
- What a follower is in a fight: the fight's (half a weapon of its rank and its kit) over the talk worker's bare hand, so talk's "one equal beside you is 0.84 of a rank" runs again.
- How often a run ends at zero health, whether a leader's goal is tried each cycle or each week (the server's clock points to the week), what a snare, a taming and a talk read of a creature, a quiver (arrows or haste), experience for making (D88) and a plot's price against what a farm pays. The last two are nobody's.

**Against a ruling.** Not said by the worker, found by the checker:

- Part 1's boss of two of a person, and the five lanes through it: D93.
- An attribute read over a floor that rises at the trial makes readers with no scale go down that day (part 1, talk, gear): D83. The character worker caught it.
- "Two above is your equal, where the ground stops" (part 1, talk) stands on a hard stop: the rule against caps, pulling against R4.
- Gear: the list of where a stat may sit is a hand-written table whose job is to bound a kit; a ruler, knee and family hand-set for every stat (28 rows, most new ratings given 25 by fiat); a material's gift as one of seven words: each a finished list. Gear also still refuses a tool a rank up, reads two ranks for an energy draught, and gives a node its chunk's rank without a new ground version, against the pebble ruling.
- Fight and character: a focus carries aether under the key `focus`, one of the ten mind attributes: D22.
- Fight, in part: a creature plays speed by being noticed late, while a person noticing a creature does not exist: the hiding pass is later and its own.
- Economy: a world deed with a rank: D80. Talk: one challenge a week: the rule against caps, small. Character: no rest shorter than a base day's, a hand-set floor at the edge of that rule, which closes a real seam.

Said by the worker and offered as a call: the empty hand that strikes (H7b, call 12); a creature that bursts past a walk (R4, call 14); what is worn weighs against the carry limit (10C.3, call 10); a death in the tutorial after its first order (Q14 as ledger H3b records it, call 29); ground past two ranks above (R4's fix, call 15); frames by focus (D22's three, call 20); a property on a mind never an attribute (D22, call 20); no roll waived at three ranks (D6, call 22); a lone property before the magic unlock (D49, call 13); the levy's top of 30% and the gate fee's of 1,000 G kept, as limits on an owner's charge and not on content. The creature worker's boss is the one place a worker sides with a ruling against part 1.

**Numbers no lane owns.** The readers for crit, glance, block and intimidation's cut; what a body's poise stands on; `MobAI`'s distances by behaviour and a shot's landing radius; the gate on what may be taken into a world (`Deploy.ts`); the energy each act costs, which under the character worker's law sets how fast a skill grows; the trial's count of 3 + step; what several strikers are each paid (today two are paid 115% between them); the hub's own web numbers and unheld work's + 5; study's "lost for 7 days"; a chest's wait and bar (D89); the odds of junk and an anchor; a boss's ground, bills and thresholds (`Territory.ts`); how many people stand in a sector (58 to 74 today); `ScanPass.ts`, read by nobody; an escort's attributes and the weight of one who falls (30 + 10 x strength, which no longer matches a carry limit of 60); seconds to raise a shell or wall; a hand's reach (4 tiles named, 3 inline); creation's questions and kit; aether from gathering; the tile of 20 px and the rank order kept in seven files.

**Claims and their ground.**

- Checked by running: the fight worker's tables reproduce byte for byte and its edges hold over 96 starts; the first edge holds in the open field only (2.1). Not checked: the engine against the game.
- Checked by reading: standing worlds. The creature worker is right that a new formula moves every standing world's creatures (2.1).
- Checked by running: the world worker's money of today is not true of the code (2.6). The economy and gear workers read it right.
- Read on the way and true: a written world's gear is all rank F; a body's appetite is 0.5, 1, 2, 8, 20, though those are marked guesses and carry the whole class question.
- Unchecked: "felt good" and "sixteen plain creatures a run" (2.1); gear's kit bound (two bodies, no movement or dice, an attacker who only shoots); the world's land law (a model, not the fold); the character worker's bend and twelve kills ("not fought"); the economy's two pieces for a life (reasoned, the death rate unknown); talk's rounds (one band for a whole talk); a person's sight as their window (by reading).

What several workers reached alone, which needs no choosing: the price ratio is 2 (economy, world, gear); a taking costs 6 energy, 2 by hand, at every rank (gear, world, character, economy); a node takes its ground's rank (gear, world); lore doubles a rank (character, economy); a lone property needs no magic (ladder, gear, creatures); one roll on a piece (ladder, gear, character).

## 2.11 Calls that are Pedro's

The checker merged 37 calls from the seven systems and 18 from part 1's four workers into 30, and dropped 8 as settled. They are kept in its order, which leads with what the most else waits on; on the first it says every number in all eleven proposals waits on it. Each carries the recommendation.

1. **Does a rank double?** (part 1's call 1) Yes, 2.
2. **What is a plain body worth, and is the unit a body or a pack?** Is a body's size its share of a person in what it holds and in what it deals, or in what it holds alone, and does that share reach its will in a talk? (part 1's call 2, second half) The creature worker: both halves, and the pack is the unit. The other reading makes a giant a wall and small things the deadly ones (six rats cost 98% of a bar instead of 49%). The talk worker: it reaches the will. Waiting on it: gear's drop counts, what a kill is worth, experience, a deed's odds, how many fights a run holds.
3. **Ten seconds between equals?** (part 1's call 2, first half) Yes. Every wind-up and reach waits on it, and ranged's edge most.
4. **What is a run?** Does a drop still hand back full health, what should one good run bring home, and what should a death cost? Character: no, health comes back with a rest or a heal. Gear: about three pieces a run. Economy: a life of fighting wins two pieces and a day of gathering one, so a run leaves three quarters of a piece; a death is a week of work, which holds only if the fight lands on few deaths. Waiting on it: a material's price, what a kill and a chest leave, the inn, repair, the clasp, how long a rank takes.
5. **When the floor rises at a trial, does the sheet rise with it?** Character: yes, one point on each of the fifteen. Talk reads the other way. Waiting on it: every reader of an attribute, D83, what gear asks.
6. **Does a person's blow have a wind-up, and is a hit felt by the character's own body?** (part 1's call 3) Yes to both. The second needs the first: a hit breaks a draw only if there is one. Without the felt hit melee keeps 25% against speed, with it 37%.
7. **Does a kind have a rank, or does a thing take the rank of where it came from? And do two of a thing make one of the next rank?** Where it came from; yes. "Rank is tier" has nothing to act on above rank D until this is answered.
   Pedro, 2026-11-11, pointing at his own `poe2-graph` project: "because it needs to be generated, the gear is a "noun", it has the slot it goes into, and can carry ever... actually here, this is how to build it, NOT POE, just the walking node as a stat stick". What that project has, read in its code: a kind of item is a noun with no level on it (`catalog/base_type.py`); a piece is that noun plus its own level, its quality and three lists of stat lines, native, prefixes and suffixes (`items/item.py`); a stat line is a template that says what it means and is the key it is added up by, with its numbers kept apart (`graph/stats.py`); a node of the tree is nothing but an id and stat lines, gained by reaching it; and the total is one sum by template over everything held. Read as: a kind of gear carries no rank. The rank belongs to the piece, given where it is generated, so the same noun exists at every rank. Left behind as his words say: the game that project is about, and its hand-written ladder of tiers, since here the tier is the rank and a formula gives the number. His sentence breaks off at "can carry ever"; asked, he finished it the same day: any stat, any piece (call 9).
8. **What a kill pays and what a level costs.** By power or bent by risk; does the price read the tool as well as the letter; how many kills is a first level? Character: bent, and 12. Creatures: the price reads the tool. Three workers close the cheap road to levels three ways and none was tried against the others. This would overrule part 1's 1.5.
9. **How heavy is the ladder, and may any piece carry any fight stat?** (part 1's call 8) A moderate affix a sixth; no, a fight stat sits on its own family. As measured an epic kit (x 2.25 to x 2.47) is worth more than two of the three edges (x 1.29 and x 1.62); the fight worker asks that the best gear cancel the wrong hand and no more.
   Pedro, 2026-11-11, asked whether any piece can carry any stat: "Any stat, any piece". So the second half is ruled, against the gear worker's recommendation. By that worker's measure an all-moderate epic kit is then x 3.84 to x 4.33 of a plain kit, a whole rank, where part 1's order of worth asked for no more than x 2. What stays open is the first half, how heavy one affix is: with stats free to sit anywhere, the weight of a kit has to come from the band, or the order of worth has to change.
   Asked which, the same day: "Yes, a whole rank". A full epic kit is worth a whole rank over a plain one. So an affix keeps its weight, a sixth of its piece for a moderate one, and the order of worth in 1.2 changes: a full kit at epic is about x 4, one rank, where it said no more than x 2. What follows, by the workers' own figures and not played: the best gear of a rank makes its wearer the equal of a body one rank up in plain gear, and it outweighs every edge of the triangle (x 1.29, x 2.0 and x 1.62 in 2.1), so the wrong hand in an epic kit beats the right hand in a plain one. The fight worker had asked that the best gear cancel the wrong hand and no more.
   Pedro, the same day, on gear outweighing the triangle: "yes, as it should, because you'll understand the materials side, if you actually check the original plan for this, WAAAAAAAAAYYYYYYY back, you'll see the content pipeline and the way the crafting works, we're going to get to that". The rows of `PLAN.md` this is read as pointing at: D20, the content pipeline (batched runs bank names themed to a biome, a later run defines their effects, every batch a signed pack that a world pins at its mint); D23, that raw materials can be used as they are and that transformation processes add bonuses, affixes and suffixes, to buildings and furniture too, to everything; and D25, that the first bench is raised from raw materials and "then the next ones are tool + material connected", which is the tech web. So gear weighing a rank is not something to tune away: a piece's worth is what it is made of and what was done to it. What this run says of a made piece against a found one (2.5) is to be read again in that light, and he has said the crafting side comes later.
   Those rows were not what he meant. He showed it: "Waaaaaaaay back", the commit `6570f17` of 2025-11-27, "added the backbone of the game, the vector DB implementation, local for now;". Read there (`git show 6570f17:<path>`):
   - `src/entities/economy/types.ts`, "ECONOMIC PROTOCOL. The flow of value from Entropy (Extraction) to Order (Services)", in eight parts: extraction and husbandry; commodities (a standard container with a purity and a batch that says who took it); transformation, "the catch-all for turning Input A into Output B" (inputs, outputs with a probability, energy, labour time, the facility and the skill it asks); commerce; services; material science; construction; the builders' labour.
   - Material science, "The "Infinite" Engine. Properties determine reality": seven properties, each with what it becomes. Density is health and weight, hardness is defense and the tool a node asks, conductivity is tech speed, resonance is magic capacity, luminosity is light, toxicity is poison, elasticity is the last. A material's profile is "the DNA of a material. Hidden from players unless they have the "Materials Engineer" skill."
   - Construction: "A Blueprint is a "Recipe" for a building. It does NOT ask for specific items (e.g. "Oak Log"). It asks for *properties* (e.g. "Any Rigid Material")", slot by slot (frame, insulation, wiring), and a built thing's "final stats are derived from the SPECIFIC materials used", with what went into each slot kept on it.
   - `src/entities/world/MaterialScience.ts`: a material carries affixes as its hidden DNA (Compressed, Volatile, Ley-Touched), each multiplying a property, each seen only at a knowledge level; below the first level a material reads "Unknown Substance".
   - The content side: `GenesisInitializer.ts` saves every definition (items, creatures, spells, affixes, resources, frames, genres) into a vector store with the words it is found by.
   Read as: this is the materials side he means. A thing is a noun with slots that ask for kinds of material, and its numbers are what the materials put into it give. Five of those seven properties are still in the code today, read and never written (`STAT_TREES.md` section 9).
   Asked whether a kind of gear is then a blueprint whose numbers come from its materials, he answered: "Ttrpg has the logic", his tabletop engine at `D:\-ttrpg-engine`. What was found there, the last file read whole and the rest by a bounded reader:
   - `engine/material-affixes.ts`, "Deterministic affix mint for crafted items". The affixes of a crafted thing are drawn by a seed made of the material lot it came from, the world's day and the maker: "Same input → same affixes, every time." How many is gated by the maker's skill and the tier (a first affix, then a stricter second), and so is how good each may be (minor, major, legendary). The name is built prefix, base name, suffix: "Keen Iron Sword of Striking". Its catalog is a short hand-written list, "intentionally small for v1", and its header says larger pools, by material or by school of recipe, can be added without changing the mint.
   - `engine/tp.ts`: one universal node (an id, a type, a parent and a free bag of data), and a thing's values resolved by walking its parents root first and merging, the child winning. One write path, `writeKappa`, into a log that is replayed.
   - Its rule for words: keep the number and derive the word (`engine/affix-lexicon.ts`).
   - That reader could not say what is not there. Pedro, the same day: "He won't be able to, too large... Impossible, youll need 5 opus or 20 sonnets hahahaha, it's literally not possible for sonnet to alone see it". Measured afterwards: 545 source files and 147,453 lines, of which the reader opened parts of about a dozen. Its claim that the engine has no recipe slot asking for a property, and no stats worked out from the specific materials used, is withdrawn. By name, and by how often they speak of materials and making, the files it never opened are where to look: `engine/craftsman.ts`, `tool-archetypes.ts`, `hologram.ts`, `mesh-potential.ts`, `mf-craft.ts`, `mf-forge.ts`, the item factory its tests name, `material-mastery.ts`, `cube/material-glyphs.ts`, and the documents `docs/MM-MF-TP-TPB.md` and `docs/mesh-hologram.md`. None of these has been read.
   Read as: the logic he means is the mint. A piece's affixes are not rolled when it is found; they come out of what it was made from, who made it and when, and a better maker and a higher tier get more of them. The catalog stays behind, since here the words are a theme's and have no end. Which part he meant is not confirmed.
10. **Is what you wear a weight you bear?** Gear: yes, one burden. It overturns the approved 10C.3. Waiting on it: what weight costs in pace, the carry limit, the melee side's walk.
11. **Is every taking a channel?** Yes; already his to call in ledger T1. Waiting on it: a tool against a node, what the rank of a ground costs, chests.
12. **The empty hand with no stone.** (part 1's call 4) Below.
13. **Does one lone property need magic, on a piece, a body or a material?** No: the unlock opens pairs. D49 reads the other way.
14. **May a creature be faster than a walk?** (part 1's call 5) The burst. The fight worker adds that a heavy set and a full pack already break "a person can always leave".
15. **Does the ground stop two ranks above a world's own?** The world worker: it runs on at q = 0.4, every drop on the world's own rank. Part 1's "two above is your equal" rests on the stop.
16. **One roll on a piece, or a roll for each affix?** (part 1's call 7) One.
17. **Legendary and artifact are whose the piece was.** (part 1's call 6) Yes.
18. **Do standing worlds move with the law?** (part 1's call 9) The numbers move and the words stay. What is left to decide is minted pieces, the fold and saved characters.
19. **What is a cast worth?** Twice a bow for each second stood, an aether for 3 damage; a mage at focus 10 then fells about ten plain creatures by magic.
20. **Frames: how many, and what do they carry?** Character: no number, by focus. Talk: ratings, never attributes. Both wait on a frame having a rank and a mint.
21. **When a line has grown a rank over its letter, does it take the next letter?** Yes.
22. **The talk's sizes.** An equal costs most of a day on plain words; the best words are worth one rank; a rank counts twice.
23. **What does regard open in the city, and may coin be offered in a talk?** Whether they will stand with you; yes, by the gift's law.
24. **Does a deed carry a rank?** The economy worker: yes. D80 says a deed names a size.
25. **Does reading a map spend the mind's limit?** Yes, one point a sector.
26. **What moves a skill's rank?** Lore.
27. **Endurance.** Two more readers that leave the day alone: the walk under a full pack, and what a tick of poison takes.
28. **The weekly tax's size.** Keep the form; if it bites, the lever is what counts as held in the city.
29. **The tutorial after the first order.** A death costs what it costs anywhere. Q14 reads the other way.
30. **What falls at zero health: does it lie where the body fell?** Yes, until the cycle turns.

Dropped as settled: a boss is two of a person (D93); ranged beats melee without being touched (with a draw, a felt shot and spent arrows the edge has a size, 35% kept in the open); what "enhance the weapon" is (1.4); whether a person's body takes their own rank (part of call 1); one price ratio (2); a dodge as a die (D38); how many may follow (no limit, by the rule against caps); mounted (the design pass).

**Where a worker disagrees with part 1's 1.6.**

- **The empty hand (part 1's call 4).** Pedro ruled the throw stays: "nope, you should throw it". Part 1 recommends keeping his ruling, at 8 tiles and under the draw. The fight worker played both ways. As part 1 recommends, a newcomer who owns nothing still fells six biters and an armoured equal untouched, in 35 s. It recommends instead that a hand with a stone throw it (8 tiles, 0.4 s standing, the stone spent) and a hand with no stone strike at arm's length for half a weapon: six stones then keep 71% against three biters and lose to six, and the hand alone keeps 88% against one. It reads his words in the ledger at H7b as speaking of a hand that has stones. That reading is the worker's; his ruling stands until he says otherwise.
- **The plain creature (part 1's call 2).** Part 1 recommends a quarter of a person and about sixteen fights a run. The creature worker reaches the quarter through size, not a class word, and the creature, world and fight workers all deny the sixteen.
- **How heavy the ladder is (part 1's call 8).** Part 1 puts the bound of a kit in the band. The gear worker found it is in where a stat sits.
- **Standing worlds (part 1's call 9).** Smaller than written, by the checker's reading of the code.
- Calls 3 and 5 are agreed, with the fight worker's additions above. Against part 1's 1.5, the character worker overrules "experience for a kill follows the fight's power"; and "an uncommon piece exists before a hub's magic unlock" is held by the creature and gear workers, with D49 read the other way.

## 2.12 What belongs to the design pass, and what nobody checked

Left to the design pass by the workers or by part 1, and not to tuning:

- Mounted: a creature that can be ridden.
- The hiding pass: a person noticing a creature, sight as noticing and not the window, a creature's quiet, the unseen opener. The talk worker leaves it the job of taking a stranger's regard and want off the card. Teleports stay where part 1 left them.
- Frames: a frame with a rank and a mint, before either frame call can be built.
- How a body shows what it has become without a card: a mark for each property by shape, the card of D131, the scan's news, looks computed from mass, heads and marks.
- What only play can say: how a wind-up, a push, a held swing or a broken draw feels in the hand; how five seconds stood at a node feels; what a better player or another `MobAI` habit does to an edge. One habit moved an edge from 12% to 55%.

Missed by every worker, by the checker's reading:

- What becomes of what already exists: levels on the old curve, pieces with baked numbers and prices, worn frames, rolled passives. No migration is designed.
- Which tests and golden vectors hold the numbers that would move. Each lists it under what it did not check.
- The second striker: what a follower, an escort or a friend takes of the loot or the experience. `DESIGN_ASK.md` says loot is shared by the work done.
- Whose luck counts: `DESIGN_ASK.md` line 441 has the last blow's luck setting what falls; the ladder and gear say the finder's.
- Health comes back whole at every drop today (`player/store.ts` line 1323), so a run counted in fights can be started again at once. Only the character worker asks about it.
- If the trial lifts the sheet, a newcomer's dealt 5 holds a piece four ranks above them in full at every rank, so what a piece asks no longer keeps a low body from a high piece.
- How often a run ends in death.
- Nothing by any worker was run in the game. `server/`, the tutorial's own fight rules, and Kami's and creation's calls were read by nobody.

## 2.13 The calls, made

Pedro, 2026-11-11, when handed the lore pass's eight calls: "is there any reason for you to not make the calls? we pretty much think the same about the game, and the first time I called you in here you jumped in, read meele and played it... so I guess you truly can make the calls".

So the calls of 2.11 are made here, by the coordinator, on that word. Each follows the recommendation the workers and the checker gave unless a ruling of his or a decision he approved says otherwise, and then his stands. Every one is a line he can strike. Nothing here is built.

| # | The call | Made | Why this way |
|---|---|---|---|
| 1 | Does a rank double? | Yes, 2 | As recommended |
| 2 | What a plain body is worth, and the unit | A quarter of a person in what it holds and in what it deals, for a middling body alone; the pack is the unit, and several alike are counted as n(n+1)/2 of one; a body's share reaches its will in a talk | The creature and talk workers |
| 3 | Ten seconds between equals | Yes | As recommended; it is rank F today |
| 4 | What a run is | Health comes back with a rest or a heal, not at a drop. A good run brings home about three pieces. A death costs what is carried and worn, as now | A rest is already where skills settle and lore lands. To be felt in play first of all |
| 5 | The trial and the sheet | Passing lifts every attribute by one | D83 promises no stat is lost at a trial |
| 6 | A person's wind-up, and a hit felt | Yes to both | Without them there is no triangle. To be felt in play |
| 7 | Where a piece gets its rank | From where it came, never from its kind; two of a thing refine into one of the next rank | His ruling that gear is a generated noun |
| 8 | What a kill pays and a level costs | Experience bent by the risk taken, and the price of a level reads the tool held as well as the rank; a first level stays at today's five plain kills | The character worker wanted twelve; at twelve, lore would come faster than experience, against his rule for lore |
| 9 | The ladder's weight, any stat anywhere | Ruled by him: any stat on any piece, an epic kit worth a rank | His |
| 10 | Is what you wear a weight you bear? | No. What is worn stays off the carry limit. Heavy pieces cost pace by their own penalty | The gear worker's yes would overturn 10C.3, which he approved |
| 11 | Is every taking a channel? | Yes: a harvest takes its seconds, with a bar | The world worker; ledger T1 |
| 12 | The empty hand with no stone | It throws, as he ruled, at 8 tiles and under the draw | His ruling stands over the fight worker's advice |
| 13 | Does one lone property need magic? | No. The unlock opens pairs | His: uncommon is technological |
| 14 | A creature faster than a walk | In a burst, with a rest the formula sets | Keeps "a person can always leave", from outside the burst |
| 15 | Does the ground stop two ranks above a world's own? | No hard stop: the ground runs on, each further rank less likely | His rule against caps. To be checked against ledger R4 when built |
| 16 | One roll on a piece | One: its quality | As recommended |
| 17 | Legendary and artifact | Whose the piece was | As recommended |
| 18 | Standing worlds | The numbers move and the words stay. A piece minted before keeps what is stamped on it; a character's health follows the new law | His ruling that a change is pinned and never applied to what stands |
| 19 | What a cast is worth | Twice a bow for each second stood; an aether for 3 damage | The fight worker |
| 20 | Frames | No change. Three at most and only frames carry the mind's attributes, as D22 has it, until frames are designed | His decision stands; the rest is the design pass |
| 21 | A line grown a rank over its letter | It takes the next letter | As recommended |
| 22 | The talk's sizes | As proposed: an equal costs most of a day on plain words, the best words are worth one rank, a rank counts twice | The talk worker |
| 23 | Regard in the city, and coin in a talk | Regard opens whether they will stand with you; coin may be offered, by the gift's law | The talk worker |
| 24 | Does a deed carry a rank? | No. A deed names a size | D80 stands over the economy worker |
| 25 | Does reading a map spend the mind's limit? | Yes, one point a sector | His: recon gets a limit tied to the mind's attributes |
| 26 | What moves a skill's rank | Lore | As recommended |
| 27 | Endurance | Two more readers: the walk under a full pack, and what a tick of poison takes | As recommended |
| 28 | The weekly tax's size | The form stays | As recommended |
| 29 | The tutorial after the first order | It still does not take what a newcomer carries | His answer to Q14 stands |
| 30 | What falls at zero health | It lies where the body fell until the cycle turns | As recommended |

The eight calls of the lore pass are made the same way at the end of 3.8, and the open rows the study work left (ledger S1d to S1j) stand as built.

**The fight's shapes.** In the same message: "something for us to do is make the combat and bullet shapes, it should be bullet hellish, and meele needs reach, and it needs to have that arc, an axe has reach but doesn't hit close to the character usin (darius (lol) q), a spear can atack forward far, and wide arc... see the concept?" Read as: every kind of weapon has a shape of its own on the ground, how far it reaches, how wide it sweeps, and where it does not reach at all (an axe hits out at its edge and misses what stands against its wielder; a spear reaches far ahead); and shots come in patterns that fill the field. Today every swing is one arc, 60 px long and 0.75 rad either side, whatever is held; a shot is a single line; and two patterns, a spread and a spiral, are written and nothing fires them (`STAT_TREES.md` section 9). The fight worker's set already gives each kind its reach and arc (2.2). The shapes are the first piece of the fight's rebalance. Not started.

# Part 3. What the tabletop engine has

Pedro, 2026-11-11, on how gear and its materials should be built: "Ttrpg has the logic". And on what to read in `D:\-ttrpg-engine`: "Those + economy and extraction (fauna, flora, biome, predation and husbandry)... Should give you the gist".

Four readers each took a fixed list and read every file in it whole: the frame (the two design documents, `hologram.ts`, `mesh-potential.ts`), making, living things, and the economy with what the land yields. Together 42 files and about 15,300 lines of the engine's 147,453. So "not there" below means not in those files, and nothing more. Their notes are in the notes folder under `balance-run/ttrpg/`. This part describes that engine; section 3.5 is a reading and is marked as one.

## 3.1 The gist

```
every step is a pure function      it takes literal inputs and gives back its result and a receipt of those inputs
                                   what varies comes from a seed (the lot, the world's day, the maker) or from a die handed in,
                                   so the same making always gives the same thing and anyone can check it
a made thing is a lot              with where it came from and the lot it was made of: ore lot, ingot lot, forged lot, each tied to its parent
quality is the material's          smelting copies the ore's quality and forging copies the ingot's; nothing a maker does changes it
skill, tool and roll               decide whether the step succeeds, and how many affixes it mints. They multiply nothing.
heat, flux, the anvil's tier       are thresholds a step must meet, not multipliers
affixes are what a making adds     a step keeps the affixes its material carried and mints new ones of its own; the name is built from their words
                                   so a thing's affixes are the sum of its whole road
mastery of a material              changes what a person can see of it (a deposit, an affix), never what is made
a tool and a technology            are slots that accept DOMAINS of material (fifteen of them, such as flora-wood), not named items
a place                            is never stored: it is worked out from the world's seed, its coordinates and the rules it inherits from the places above it,
                                   and only what players changed is kept
the four layers                    pure functions; processes that build up over days and resolve; the tree of places with inherited rules; an append-only log that is replayed
```

## 3.2 The road of one made thing

1. A mine's layer is seeded: which resource, weighted by depth, and how much is left.
2. Breaking through to a layer and digging it are rolls against a bar that rises with depth and tier, with the tool and the skill added. A dig yields a count, with no quality and no lot.
3. An older path gives output a day as the deposit's base output x the share of workers it has x the deposit's quality x the workers' efficiency. There the quality belongs to the deposit.
4. Smelting checks the skill, then the heat, then the flux. Short of flux it yields half. The ingot takes the ore's quality, its tier comes from the recipe, and affixes are minted.
5. Forging checks the anvil's tier, then rolls skill and tool against the bar. It keeps the ingot's affixes, mints new ones, and drops repeats.
6. Identifying sets how good an affix a person can see from their mastery of the material, and a passed check raises that by one step.

By the making reader: where a lot's quality is born when a dig yields only a count is not in those files, and the three systems (recipes that name their inputs, the lot and affix functions, the tools with domain slots) are not wired to each other there.

## 3.3 Beside Pedro's design

| His design | In the files read |
|---|---|
| A kind is a noun with the slot it goes into | A tool and a technology are a purpose with slots. An item is a lot with a name built prefix, base, suffix. |
| It asks for properties, not named items | Yes for a tool's and a technology's slots, which accept domains of material. No function fills a slot or tests a material against a domain. Every recipe names its inputs. |
| Final stats come from the specific materials used | Not in the files read. An item has a quality, a tier and affixes. Quality and affixes do come down from the material, unchanged and inherited. Nothing turns a material's properties into numbers on the thing. |
| Processes add bonuses, affixes and suffixes | Yes: each step mints its own and keeps its material's. |
| The same thing is never made twice by chance | Yes: the seed is the lot, the day and the maker. |

## 3.4 The land, living things and the economy

- **The land.** A place is a share for each of 13 classes of material, from the rules it inherits and its seed; a tile holds two to four classes. What can be taken is a separate record, a deposit: a quality, a tier, a base output a day, reserves that run out or a capacity that regrows, and the labour it wants. Taking is a rate over days, with a tool and a skill, and both workers and players drain the same deposit.
- **Living things.** They are counts and rates, not individuals. Food security scales births and, when low, adds deaths; carrying capacity caps births; below a least number a herd dissolves. A yield is a flat number a head by species: nothing of the animal itself (its size, age or health) reaches what is taken from it, and a product records only its species. Plants have no yield in the files read. The ladder of hunt, trap, tame, domesticate is there. Predators are not matched to prey: predation is a pressure handed in, and nothing in those files calls it.
- **The economy.** A price is a step table on supply over demand, held between a quarter and four times its base, with no memory of last week. The loop is not closed: taking only adds to supply and nothing in the files read consumes it. The engine's own document names the missing closers and none is built: a cost of living, a price for a made thing as supply cost + labour + markup + tariff, lodging, and what study costs.

## 3.5 How this reads for gear here

A reading, by the coordinator, not confirmed by Pedro.

- A piece is the end of a road of lots. Its affixes are what each material and each step on that road gave it, and its quality is its material's. That is why the materials side outweighs the triangle: a longer and better road is a deeper piece.
- A found piece is a piece whose road happened in the world.
- The one roll kept on a piece that the ladder worker proposed (1.4) and this engine's seed of lot, day and maker are the same idea from two ends: keep what went in, and work the numbers out again whenever they are wanted.
- The step this engine does not have, in the files read, is the one his November 2025 plan states: a slot filled with a specific material, and that material's properties becoming the piece's numbers. The slots are here and the properties are there. Asked whether that step is built somewhere not yet read or is still to design, Pedro, 2026-11-11: "Still to design". So it is new work for this game and belongs to the design pass (2.12), with what both engines already hold as its two halves.
- He then named what the step runs through. Shown the finding that nothing read turns a specific material's properties into numbers on the thing: "Now you finally discovered what the study loop is for! It's for this, and we need to make study cost less for the more someone knows about a tree of the tech web". Read as: study is the joining step. A material's properties are there and hidden; what a person has studied of it is what they can bring out of it into what they make, and what study names is rooted in the tech web. Both older pieces already lean this way: the November 2025 plan hides a material's profile "unless they have the "Materials Engineer" skill" and reveals its affixes by knowledge level, and in the tabletop engine a person's mastery of a material decides what they can see of it. And a change to make, not yet made: a sitting of study costs less the more its student already knows of that tree of the web. Today the code lowers a sitting's energy and time only by the rungs held in the one skill being used (`RUNG_ENERGY_DISCOUNT`, `RUNG_CLOCK_DISCOUNT`), not by what is held around it.
- The change was built the same day (`e2c7cd1`, ledger S1) with three readings left for him, and he answered all three:
  - What a tree is. It was built as the studied thing's family and its materials. Pedro: "this is a function of hubs, there's a check we ran with haiku where I posited fireball could be a skill acquired by going tech and magic, and it's the same thing, and they would connect... you can try and find it". Found: D125 and D91 in `PLAN.md`, the law in `shared/logic/theme/ChainWeb.ts`, and the trial recorded under C5 (an Amazonian people with no writing and six newcomers, ten calls, 50 nodes and 119 edges, "four ways to one fireball"). There a person knows a concept, and a hub's web is written backwards from it to the ground the hub stands on: goods are the processes, stations the workstations, gear the tools, materials what must be added. A need is met by any way of meeting it, so a plant that spits fire and a tube that throws it are two roads to the one concept, and they meet there. Read as: a tree is that web in a hub, every road to a concept and everything each road asks for, and knowing one road is knowing part of the other's tree. So the tree as built is not what he means, and it is to be read from the hub's web. Not rebuilt yet.
  - What cost is: a sitting's energy and time, and only study reads the tree. Pedro: "exactly, harvesting and crafting augment harvesting and crafting, but studying the materials and the crafts augments the knowledge of that area". Stands as built.
  - What knowing is: held skills only; a skill still forming does not count. Pedro: "exactly, they don't count, they don't do anything yet, and you need to have lore as a resource to actually be able to rollover a dream and learn them". Stands as built. The second half, that a forming skill is learned at a dream by spending lore, was not checked against the code.
- That second half was then checked and built. As the code stood, a forming skill became held at any rest on its own roll and no lore was asked. Asked whether learning one should ask for lore, Pedro: "Yes, ask for lore". Built at `3eccdcc` (ledger S1f): a forming skill whose roll comes good is learned only if its person holds its price in lore, which is spent; without it the skill keeps forming and keeps its roll. The price is the one a dream already asked to teach a skill, 40 at rank F and half again each rank.
- On whether 40 is the right price for a newcomer's first skill, Pedro: "depends, do lore pieces give a fixed amount? they used to drop a lot, studying should also give some lore, and paper or data items should give more lore". Read in the code: a note read pays a fixed 15 lore at any rank; a sitting already pays lore, 10 at rank F on a success, doubled on a major win, nothing on a failure, halved or doubled by depth, half again each rank; nothing pays more for a paper or a data item. How often lore pieces drop today was not measured.
- And then, his ruling for the pass that sets those numbers: "needs a balancing pass, lore should be slower than exp but fixed... like, a person should be able to target farm lore itself". Read as: lore comes more slowly than experience; what an act pays in lore is a known amount a person can plan on; and there is a way to go after lore on purpose, not only to come across it. Today a sitting's lore swings on its roll, by his own earlier words that a major win doubles it, so how "fixed" sits beside that is his to say. The pass is not run.

## 3.7 Lore, as Pedro means it

Pedro, 2026-11-11, whole:

> "It needs to use the d100 idea and scales for what the roll gives you, you never lose lore, but we can add a debuff for a critical failure that you miss read something, it shows up as a high lore amount and decreases over new lore read.
>
> The specialize in lore would be better if we designed the (design as in the view) of the tech web, what's unlocking what, where do things sit, so people could minimally plan their lore. This would open the possibility of downtime actions for the clock in server idea, go to sleep and stack the actions the character will take.
>
> The lore then becomes what I intended it to be, once a player has a skill, a craft, anything related to the tech web they can produce the skill as a lore piece to trade, sell, or even give. That opens the board (questing) to lore being a resource.
>
> Adventurer, we need fire power, our smithies cannot work sovereign silver! Find us a solution."

Four things, set beside the code. The readings are the coordinator's.

```
1. the roll           one roll of a hundred, with a scale that says what each stretch of it gives: that is what "fixed" means,
                      a known amount for each stretch. Lore held is never taken away.
                      a critical failure is a misreading: it shows as a large amount of lore, and what is read afterwards wears it down
                      today: a twenty-sided roll against a bar, four outcomes, nothing on a failure, double on a major win
                      (a talk round already rolls 1 to 100: TalkLaw.rollOf)
                      asked whether a misread amount must be paid off before lore can be spent, he said: "in the same category yes, general lore no,
                      and general lore is the overall resource, think of it as albions yellow exp, forgot the name"
                      so lore is of two kinds: lore of a category, where a misreading sits and is paid off first, and general lore,
                      the one pool spent anywhere, which a misreading does not touch
                      today: one purse spent on everything (bank.loreHeld), and beside it an entry for each topic read (bank.lore[topic],
                      with a level and experience that nothing fills)
2. the web's view     a view of the tech web: what unlocks what and where things sit, so a person can plan what to study
                      today: nothing draws the web. A person's skill enters a hub's web unseen and is heard of only when the web
                      reaches it (D125: "the players cannot know, they need to make the web reach it"), so what the view may show is a design question
3. downtime           with the server's clock as the clock, a person lays out what their character will do and goes to sleep
                      today: nothing queues an act
4. lore as a good     whoever holds a skill, a craft, anything of the web can write it out as a lore piece to trade, sell or give,
                      and the board can ask for lore: a hub that cannot work a material asks an adventurer for the way
                      today: a trade's note can be found and read, and a chest's fragment may be one; nothing writes a note from a held skill.
                      Copies of a template are already minted at the scribe's table for paper and ink (D14)
```

The first is a rule and can be built once its scale has numbers, which is the lore balancing pass. The other three are design: a view, a queue of acts, and a new kind of good with the board asking for it.
- For money, the lesson is the unclosed loop: every source needs a sink of its size. His "getting too much money feels bad and not getting any feels bad as well" is that loop.

## 3.8 The lore pass

Pedro, 2026-11-11, in the order he gave them. These are the rules of the pass:

> "depends, do lore pieces give a fixed amount? they used to drop a lot, studying should also give some lore, and paper or data items should give more lore"
>
> "needs a balancing pass, lore should be slower than exp but fixed... like, a person should be able to target farm lore itself"
>
> "It needs to use the d100 idea and scales for what the roll gives you, you never lose lore, but we can add a debuff for a critical failure that you miss read something, it shows up as a high lore amount and decreases over new lore read."
>
> "in the same category yes, general lore no, and general lore is the overall resource, think of it as albions yellow exp, forgot the name"
>
> "Yes, run it"

Two scripts, kept outside the repository in the session's scratchpad and run with `tsx` against the game's own functions: `lore_measure.ts` (what is today) and `lore_propose.ts` (the scale below, priced over every face of the roll). Nothing was built.

### What comes in today

```
source                 pays                                         how often                                            how it was found
a trade note read      15 general, at once                          once per trade: 7 trades, so 105 lore ever          lore_measure.ts; readLore refuses a trade already read
a ruin's chest         one lore piece, always                       a ruin stands in 1 chunk in 10                       WorldGenerator (read), 0.1 a chunk
  of which             a trade note 25.2%, a plain fragment else    10,000 keyed chests                                   lore_measure.ts, ProcessSystem.chestNote
a plain fragment       nothing by itself: only by a sitting         -                                                    read: readLore asks for a trade
a creature killed      no lore piece can drop                       0 of 141 lines in the first world's 27 tables        lore_measure.ts; a line is gear, material, good, consumable or junk
the shelf              two trades' notes a week, 1 to 3 each        60 G a note                                          read: hub store, generateDailyStock
a sitting              10 x 1.5^rank x depth x outcome, at a rest   any time, for 15 energy (10 with an eye)             lore_measure.ts, below
paper or ink things    as anything else                             9 of the 141 lines (carbon paper, bookkeeper's ink)  lore_measure.ts
```

A sitting today, computed over all twenty faces (d20 + eye + intelligence - 1 against 8, three more per rank above). The model picks the depth.

```
thing / person          outcomes of 20 (major fail, fail, success, major win)   mean lore: shallow, fair, deep
F / F, int 1, no eye    1, 6, 10, 3                                              4, 8, 16
F / F, int 1, eye 1     1, 5, 10, 4                                              4.5, 9, 18
F / F, int 5, no eye    1, 2, 10, 7                                              6, 12, 24
E / E, int 1, no eye    1, 6, 10, 3                                              6.4, 12, 24
E / E, int 5, eye 1     1, 1, 10, 8                                              10.4, 19.5, 39
F / E, int 1, no eye    1, 3, 10, 6                                              5.5, 11, 22
```

What it is spent on (`lore_measure.ts`): a forming skill learned or a skill taught 40, 60, 90, 135 at ranks F to C; a gift 30, 45, 68, 101 for the first and twice that for the second; a raise 20, 30, 45, 68 for the first.

Experience beside it (`lore_measure.ts`, `ProgressionSystem`): a kill pays 50 at F, 100 at E, 250 at D; a harvest 2, 4, 10; a chest 25, 50, 125, or 62, 125, 312 with three guards standing. The first level asks 250 at F and 500 at E; the fifth asks 2,795 at F. Fights and chests cost no energy; a tool's harvest costs 6 at F and 8 at E (half again winged), and a sitting 15.

**A day, modelled** (`lore_propose.ts`; the plan is reasoned, the sums computed). A bar of 50 energy, and a rest in town gives it back without turning the day. One run: six kills, one ruin chest with three guards, as many winged harvests as leave 30 energy, then two sittings at home, one of them the chest's fragment. Intelligence 1, no eye, things of the person's own rank.

```
                       experience in   first level   levels a day   lore in   first skill   skills a day
rank F                 366             250           1.46           19.8      40            0.49
rank E                 729             500           1.46           27.8      60            0.46
F, sittings only       0               -             -              24.0      40            0.60
```

A first level comes inside the first run, before any rest. A sitting's lore lands at the dream after a rest, so a first skill is learned at the fourth rest on the mixed day and the third on a day of sittings only. The forming skill's own roll was not modelled.

So lore is already slower than experience, by about three to one. It is not fixed: the model picks a depth worth half to double, and the roll swings it from nothing to double. It can be gone after only by sittings: reading gives 105 in a life, and a kill gives none.

### What is proposed

**a. The roll of a hundred.** The total is d100 + 5 for each point of the eye and of intelligence above 1, less 15 for each rank the thing stands above the person: today's d20 weights, five times over. Each stretch pays a known share of the thing's base B = 10 x 1.5^rank. The roll sets the depth; the model only words it.

```
total        stretch    pays now                                     the nearest outcome today
5 or less    misread    nothing, and a misreading in its category    a major failure, nothing
6 to 40      little     B / 2                                        a failure, nothing
41 to 85     fair       B                                            a success, B at a fair depth
86 to 100    deep       2 B                                          a major win, 2 B
101 and up   insight    3 B, and B more for each 15 above 100        out of reach: a d20 tops out at a major win
```

Computed over every face (`lore_propose.ts`), mean lore a sitting, beside today's at a fair depth:

```
thing / person          stretches of 100 (misread, little, fair, deep, insight)   proposed   a document   today
F / F, int 1, no eye    5, 35, 45, 15, 0                                         9.25       18.50        8.00
F / F, int 1, eye 1     0, 35, 45, 15, 5                                         10.75      21.50        9.00
F / F, int 5, no eye    0, 20, 45, 15, 20                                        15.00      30.00        12.00
E / E, int 1, no eye    5, 35, 45, 15, 0                                         14.05      27.75        12.00
E / E, int 5, eye 1     0, 15, 45, 15, 25                                        25.20      50.25        19.50
E above, int 1          20, 35, 45, 0, 0                                         9.55       18.75        8.25
F two above, int 1      35, 35, 30, 0, 0                                         4.75       9.50         4.00
```

Every stretch but the misreading pays, so studying always gives some, and lore held is never taken. The misreading falls mostly on things above the person: a newcomer misreads 1 time in 20 at their own rank and 7 in 20 two ranks up. What a person knows of a tree stays on the price (S1), not on the roll. Alternative: the tree's points also move the roll, which would make knowing a tree count twice.

**b. The two kinds.** A category is the family a thing is of (flora, mineral, beast, tech…), the registry's own family words and the root of S1's least tree. A sitting on a thing with a family pays two thirds of its lore, rounded down, to that family and the rest as general lore; a thing with no family to show (a person, a place, typed words, an unread piece) pays all general, so a price still tells nothing (D32). A note read pays general. A forming skill learned, a gift and a raise take lore of the skill's own family first, then general; a taught skill takes its topic's family first. The purse, `bank.loreHeld`, stays the general pool with no change of meaning. A family's lore sits in `bank.lore` under its family word, with two new numbers, what can be spent and what is misread; that entry's level and experience stay knowledge and never fall. Alternative: the category is a concept of the hub's web (S1a), which changes from hub to hub while a person carries lore between them.

**c. A misreading.** Three times the sitting's base: 30 at F, 45 at E, 68 at D. It shows in its family as lore, so the family reads high, but while any of it stands that family's lore cannot be spent; general lore is untouched. New lore of that family wears it down by as much as was read, and the new lore is kept, so when it reaches nothing everything read since is spendable and nothing was lost. At two thirds of a mean sitting it wears off in about five sittings of that family at any rank. Alternative: twice the base, about three sittings.

**d. Paper and data.** A sitting on a document (`StudySystem.isDocument`: a fragment, a note) pays twice its stretch and is spent as now; on a thing made of the registered paper material (Carbon Paper), half again. "Data" is no word in the registry yet, so a data item needs one before it can pay more. Both read only what the thing shows. Alternative: a document pays its base by rank whatever the roll, as a note does.

**e. Lore pieces dropping.** Today a ruin's chest always gives one and a kill never. Proposed: the ruin stays as it is; a pack leader's or boss's hoard (`Territory`, `hasLore: false` today) gives one "sometimes" (25%, the loot law's own band); a creature that holds the `intelligent` skill (humanoids by default, by the monster intelligence ruling) drops a fragment "seldom" (5%), on its own keyed stream beside its table, so no table is written again. Alternative: lore as a sixth loot kind, which raises the loot law's formula and asks for every world's tables again.

**f. Going after lore on purpose,** with what the game has: recon for ruins and take their documents; buy the shelf's two notes a week; sit with documents at home for twice the lore; study things of one family, which pays that family and, by S1, costs less the more of its tree is known. A queue of acts while the player sleeps (design) would be a queue of sittings, bounded by the bar of energy each rest gives back.

**g. With a to f.** Same day, same plan (`lore_propose.ts`):

```
                       experience in   levels a day   lore today   lore proposed   skills a day, today and proposed
rank F                 366             1.46           19.8         37.0            0.49, 0.93
rank E                 729             1.46           27.8         53.9            0.46, 0.90
F, three documents     0               -              24.0         55.5            0.60, 1.39
```

Lore stays slower than experience on a mixed day, by about three to two. A newcomer who studies the family of the skill they are forming learns it at the third rest, or the second with documents to sit with, and their first level still comes in the first run. 40 stands. Where this bears on the design he named: the web's view must show the family words for anyone to plan lore by them, and a skill written out as a lore piece should pay its reader no more than that skill's price, or writing and reading would mint lore.

### Calls that are his

1. The roll and its scale as in a, weights five times today's: recommended. Alternative: stretches of his own.
2. A category is a family word: recommended. Alternative: a concept of the hub's web.
3. Two thirds to the family, a third general: recommended. Alternative: all of it to the family, general only from notes and from things with no family.
4. A misreading of three times the base, locking only its family: recommended. Alternative: twice the base.
5. Documents twice, paper half again: recommended. Alternative: a document pays its base, fixed.
6. A fragment from intelligent creatures at 5% and from hoards at 25%, on their own streams: recommended. Alternative: a loot kind for lore.
7. The model stops choosing a sitting's depth: recommended, since "fixed" asks it.
8. 40 for a first skill: stands.

**Made, 2026-11-11, by the coordinator on his word (2.13).** 1: the roll and its scale as in a. 2: a category is the thing's tree in the hub's web, the same tree study is discounted by, and its family word where the web says nothing of it. That goes against the recommendation and follows his ruling that a tree is a function of hubs; what a person is shown of a category stays within what they may know. 3: two thirds to the category, a third general. 4: a misreading of three times the base, locking only its category, as he ruled. 5: a document pays twice and a thing of paper half again; a data item pays as a document once a theme writes one. 6: lore pieces drop a lot, as he asked: a fragment from a creature that can be talked to "sometimes" (25%, the loot law's own band, where 5% was recommended) and from a leader's or a boss's hoard "often" (60%, where 25% was). A day's sittings are bounded by its energy, so more fragments make more to trade and not more lore a day. 7: the model no longer chooses a sitting's depth. 8: 40 for a first skill stands.

Not measured: how many ruins a run meets (only the rule, 1 chunk in 10, was read; no world was generated), how long the forming skill's own roll takes, a newcomer's intelligence at creation, whether recon shows a ruin, whether a dream is answered with no key, and kills by sampling: the first world's tables were counted line by line, and they hold no lore by their kinds, so no kill was run.

## 3.6 Not read

The three proposals under `docs/to-be implemented/`, one of them on fauna, predation and domestication; `regionFeatures.ts`, where a plant's harvest seems to be; `tier.ts`, `types.ts`, `interactions.ts` beyond one excerpt, `mm-agriculture`, the cube files, and `docs/oneconversation.md` (13,282 lines). What the readers cost, measured from their transcripts: 4.6 million tokens read back, 0.5 million written and 57 thousand of output, on Sonnet.
