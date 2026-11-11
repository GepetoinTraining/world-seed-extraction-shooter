# The balance run

Pedro, 2026-11-10: "we're going to send out a fan to think thorough every system and make a balance + affix {suffix, preffix} run, then we're going to re scale the uncommon magical rare epic... so on so forth with stats, and we're going to rebalance the combat. we're also needing a design pass."

This is what the fan thought. It is a proposal from end to end: no code has changed. `STAT_TREES.md` says what the game does today, and its section 11 holds Pedro's rulings.

The fan went out in two waves. Part 1 is the spine: four workers, each alone and none told what the coordinator expected, on what a rank is worth, the fight triangle (twice, from the body's sheet and from the seconds of an encounter), and the ladder with the affix law. Part 1 is their four proposals reconciled into one. Part 2 is every other system, thought through with the spine in hand.

Every table the workers give was computed by a script of theirs, many by running the game's own pure functions. Nothing was run inside the game. Their full proposals and scripts are kept outside the repository, in the notes folder under `balance-run/`.

# Part 1. The spine

## 1.1 What the four agree on without having been told

Each worker saw only the rulings and the code. These came back from more than one of them.

- **A same-rank fight between equals lasts about ten seconds, at every rank.** Three workers arrived at it separately. It is what rank F is today by the game's own functions, the rank Pedro played and said felt good. The spine holds every other rank to it.
- **Rank enters a number once, on one scale.** Today seven different ratios grow from one rank to the next, and rank reaches gear power twice.
- **An affix is a share of what its piece gives at its own rank.** So it feels the same at F and at SSS. Today a middling damage affix is 90% of a rank-F blade and 0.6% of a rank-SSS one.
- **Protection is one rating read against the rank of the blow, with no top.** Today a plain common set of armour reaches the 60% top at rank S, and before the top its sum is 116% at SSS: the top is doing the balancing.
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
| boss, holds ground and asks for a party | 2 and 2 | 4 | a person one rank up |

Meeting something that is not your rank: one rank is x 4 in power (twice the body, twice the tool). A plain creature takes 2 blows one below, 3 at your rank, 5 one above, 10 two above, and costs you 1.6%, 6%, 25% and all of you. Two above, a plain creature is your equal, which is where a world's ground stops climbing. Three apart is settled.

The order of worth the spine needs kept:

| What | Worth, in power | In ranks |
|---|---|---|
| A rank, body and tool | x 4 | 1 |
| Two people striking one body | x 4 | 1 |
| An edge of the triangle | about x 2 | a half |
| A full kit at epic, over a plain kit | no more than x 2 | a half |
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
2. a hit is felt                                      share = weight / (weight + the poise of the one it lands on)
   it takes that share of the target's pace, and breaks a wind-up the target had to stand for
   (a hit already breaks a rest and a channel; a draw is a short channel)
   this is why speed beats ranged at contact, and why a heavy swing holds a fast body
3. reach belongs to the kind                          a shot far, a swing about 3 tiles, a stab or a light blade about 1.5 to 2
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
- Experience for a kill follows the fight's power (x 4 a rank), from his rule that experience is tied to the risk.
- Mounted waits for the design pass. Stealth's other half waits for the hiding pass.

## 1.6 Calls that are Pedro's

Each with what the workers recommend.

1. **Does a rank double?** It is the one number everything hangs on. Recommended: yes, 2. Lower leaves a world's worst ground open and makes a rank no bigger than one piece's quality; higher closes the ground the guild's trial sends you to.
2. **Ten seconds between equals, and a plain creature worth a quarter of a person?** Recommended: yes. Both are what rank F is today. The second sets how many fights a run holds, since nothing regenerates: about sixteen plain creatures met one at a time, with a heal undoing five.
3. **A person's blows get wind-ups** (a bow drawn standing, a swing begun at half pace). It changes how the game feels in the hand more than anything else here. Recommended: yes. Without it ranged keeps everything against both other sides and there is no triangle.
4. **The empty hand.** He ruled the free throw stays ("nope, you should throw it"). A free shot of 20 tiles with no draw and no end is the one thing that makes everyone ranged before they own anything. One worker keeps the throw, at 8 tiles and under the draw. The other has a hand with no stone strike at arm's length. Recommended: keep his ruling, at 8 tiles and under the draw.
5. **May a creature be faster than a walk?** Today none is, on purpose, "so a person can always leave". Speed cannot be a creature's side without it. One worker lets swift things out-walk a person outright. The other allows a burst, with a rest the formula sets so that the creature's pace over the whole cycle stays under a walk. Recommended: the burst. A person can still always leave, from outside it.
6. **Legendary and artifact are whose the piece was**, not the next counts. Recommended: yes.
7. **One roll on a piece (its quality, which moves every number on it together), or a roll for each affix as today?** Recommended: one. A piece then keeps words and one number, the hub can check all of it, and a rebalance moves every piece that already exists.
8. **How heavy the ladder is.** A moderate affix as a sixth of a piece makes an epic's six weigh one more piece. Today's table says a quarter, by accident.
9. **Do standing worlds move with the law?** The formula's own header says a later version never moves a standing world, and worlds never retire. But a character's health is one law for every world. Recommended: the numbers move and the words stay.

# Part 2. The systems

Not yet written: the second wave is out.
