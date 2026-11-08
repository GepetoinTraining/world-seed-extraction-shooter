# Leg 2: the whole game played as a newcomer

Two runs, compared. Claude played first, on a test character with no key, on 2026-11-07. Pedro plays second, on his own world. This file records what the screens showed and offered, what was done, and what happened, in the order played, so the second run can walk the same road. Whether something feels right is Pedro's call; this run only says what works and what a newcomer meets.

## How this run was made

- **Code:** the store-pass tip, `claude/shared-store-1e09bd` at `bf36a91` (main `ebe1bb1` plus the world, player and hub store passes). The aim was also to check those passes in the real interface before they are merged.
- **Machine:** the game's dev server on port 3130, from a worktree with no `.env`, with `WS_LLM_PROVIDER=local` and `WS_LOCAL_MODEL=gemma4:e4b-it-qat`. A local test hub (`npm run hub`) answered on port 3951. Ollama was not running at the start; its installed copy was started, with no setting changed. Nothing was spent.
- **The pane was hidden the whole time,** so nothing here says how anything feels. Frames were paced by a Web Worker, as in leg 1. Keys and clicks went through the real screens. The walk in the city and the field was steered by held keys, reading the character's position from the page.
- **The dev path has no landing page.** It opens straight on creation, and the account is made under SYSTEM, THE HUB. The landing page served by the hub stand-in was read at the end (step 1).
- **Scripted, by name:**
  1. 1 Compound Oak and 2 Clear Pane, minted and added to the vault through the player store's own change (step 6). Glass is sold nowhere.
  2. The clock, moved one day at a time for ten days, from character select (steps 6, 9, 10). After this the hub refuses the receipts, as it should (step 11).
  3. Reading Orrin's memory from the page (step 6). Memory is never shown on screen.
  Everything else was played.

## 1. Arriving

**What the screen showed.** GENESIS PROTOCOL, with "[◆] VOICE: CAN RUN HERE" and "RESTORE A BACKUP" at the top, and five steps:
1. WHO YOU WERE: eight backgrounds, and "OR SAY NOTHING ABOUT IT: FATE GAMBLER". Picking one opens "THE SHAPE YOU WEAR" below it (OPERATOR, STREET SAMURAI, NOMAD, ARCANIST). The page grows under the pointer: the next click, aimed at NEXT, landed on ARCANIST.
2. WHAT YOU CARRY: three kits, the first already chosen ("WHAT A BENCH WANTS": Ledger Saw, Stamping Hammer, Clip Belt). "500 G stays in the account."
3. THE FACE OF THE WORLD: one place to arrive (NEW CARLEON) and one first world (The Long Audit), with its ground, what lives and grows there, and a line of lore.
4. THE SEED: three fixed questions with four answers each, then a free line ("Nothing is an answer").
5. THE SIGNATURE: the skills given, a summary, and the name.

**What was done.** "YOU KNEW HOW THINGS WORK" (intelligence, then engineering), the bench kit, "SOMETHING FINE.", "HAVE PREPARED FOR THIS.", "THE WORK.", then "SAY NOTHING MORE". The screen read "THE SEED IS CONSIDERING 0:03 · DO NOT WAIT FOR IT". The local model answered in 12 s.

**What happened.**
- Skills given: Mining, Felling and Quarrying. All three are gathering skills, and the bench kit carries no pick and no hatchet (see step 4).
- Named WAYFARER: "IDENTITY MINTED", a face, "MAIN FOCUS INTELLIGENCE 5 · SUB FOCUS ENGINEERING 4", "IN THE VAULT: WORLD DEED: SMALL".
- ENTER WORLD SEED put the character in the city's Central Plaza with 500 G. Three lines read "First in this hub to reach Mining. The bank has it signed.", and the same for Felling and Quarrying.
- Nothing in the city points anywhere. The Nexus was found by its sign.

**The hub.** SYSTEM, THE HUB read "[◆] NOT SIGNED IN" and the hub's address, with HANDLE and PASSWORD fields. MAKE AN ACCOUNT made a test account (handle `wayfarer-test`; the password was made in the page and never shown). Then "Not registered on this hub", and REGISTER THIS CHARACTER: "IN GOOD STANDING", "! Registered. The hub signed its word for it." SEND RECEIPTS: "Checked. The hub now holds 17 and signed for it. It reran 0 drops from 0 sessions. It checked 1 of 1 people of this city."

**The landing page** (the hub stand-in, read at the end). It has WHAT RUNS WHERE, MAKE AN ACCOUNT and PLAY IN THIS BROWSER. Its THE MODEL section says "Played here, the game has no voice yet", and that a model on your own machine reaching the page "is the next piece to be built". `DEPLOY.md` says the page's own door to a local Ollama is built, so these words are out of date.

**Time:** creation took about a minute, most of it the Seed's 12 s and the clicks.

## 2. The tutorial world

**What the screen showed.** The Conduit at the Nexus offers TALK WITH THEM, VIEW EXTRACTION ZONES, QUICK DEPLOY, STUDY THEM and LEAVE. The zones list has "+ MINT NEW WORLD" and one card: THE TUTORIAL, "FIRST ORDER", F, "ARCHITECT THE NEXUS", "THE LONG AUDIT — pinned at mint", "ALWAYS OPEN — NOTHING YOU BRING IS LOST HERE", and "Your first order: scan the marked block, drop on it, meet what lives there, and walk out by the beacon." Then DEPLOY.

**Recon.** "FIRST ORDER — SCAN THE MARKED BLOCK". The block 14·16 came selected. SECTOR INTEL read BIOME "CYBER_CITY" (an internal name) and "Not scanned".
- The first SPACE gave THREAT F and BEACON PRESENT.
- The second gave CONTACTS: "1150× MOB · 9057× RESOURCE · 54× NPC · 100× STRUCTURE · 100× CONTAINER · 4× EXTRACTION". That is for one block.
- LEADERS AND PACKS gave 8 leader lines ("! ▲ LEADER [F] Unknown contact, 3 behind it") and about 630 pack lines ("! ≡ PACK OF 3 [F] Unknown contact"), one under the other. The panel runs to about 640 lines.
- The MANIFEST still names things by internal id (`res_7c21a3eb_compound_oak`, `npc_survivor`, `chest_ruin`, `struct_ruin`).

**The field.**
- On landing, the lesson read "FIRST ORDER — THE WAY OUT", with an arrow and "BEACON 65m SE". The lesson box sits over the top-left readout ("DAY" and "TAB" are hidden behind it).
- When a tally rat came within about 40 px, the lesson changed to "THE CONTACTS" ("SPACE or the mouse fires where you aim; Q reads what is near. Walking away breaks a chase. Harm here costs nothing you carry."). It went back to THE WAY OUT after the kill.
- The rat (12 health) died to aimed fire. It cost 15 health (130 to 115) and gave +50 XP.
- Two queue pigeons died at the beacon. Two more fled at 2 and 4 health.
- Sovereign Silver said "Needs pickaxe". The character's own skills had no tool to work with.
- At the beacon, E gave "CHANNELING… HOLD POSITION · ESC ABORT · Damage breaks the channel. Five seconds of stillness buy the way home." Then SEALED.

**The receipt:** THE TUTORIAL, 3m 09s, 10 actions, "HAUL VALUE 0 G", "HUB LEVY 0 G", "Came home empty-handed. The record is kept anyway." The feed said "First order sealed. Every other world keeps what falls with you." The card lost FIRST ORDER and now reads "Sealed once. It stays open while your own world is written." "CONNECT HUB TO ONLINE WORLD" appeared above MINT. The 500 G were kept, and the hammer from the pack came back to the vault.

## 3. The first city

- **Land Office** (AURELIO QUINT): THE DEEDS lists six lots, Lot #1 at 18,500 G down to Lot #6 at 4,350 G, each with its size and distance from the road and the centre. Lot #1 offers "DISMEMBER INTO 4 (4,650 G)".
- **Hall of Banners** (GRAND MARSHAL VEX): THE BOARD, THE PEOPLE, THE TRIAL and MAPS.
  - The board: "Nothing on the board. Nobody in this city wants anything from you yet: a person has to come through the gate first."
  - THE PEOPLE: "The treasury holds 30,996 G. The city runs on 2,214 G a day, so that is 14 days." Each building of the centre has its line, then "The shops' week, as stocked 2,056 G a day". One line reads "People here hold 3,069 G of their own" just above "0 people in this city"; the gold is the keepers'.
  - THE TRIAL: rank F to E, bring three things from above your rank.
  - MAPS: none.
- **The sheet** (TAB) fits the 1024×768 window. The right-hand panel's last lines run under its bottom edge and scroll. Energy shows there ("ENERGY 50 / 50", "A sitting takes 15 energy and 11s. It can go badly.").

## 4. The field

**Minting.**
- MINT NEW WORLD opens four steps: CONCEPT, LAWS, ECONOMY, SIGN.
- CONCEPT asks for a name, a description and "THE WORLD'S FACE … SAY / WRITE IT", or "OR A WORLD ALREADY WRITTEN" (The Long Audit). It also offers a world type, the deed it spends ("Its gate stays open 1:00:00, then goes down for 1:30:00, then boots for 30:00 of recon") and the sky.
- WRITE IT with the local model, for "THE STILL ORCHARD" ("A drowned orchard where clockwork bees still harvest for an owner who never came back."):
  - "THE SEED IS WRITING: THE LAY OF THE LAND (1 OF 7)". After about 40 s: "What it wrote did not pass: Refused twice: the OVERGROWTH: tangled_mounds is crossed with a skill, and "climb" is not a registered word. Register it in "words"."
  - A second WRITE IT, about 60 s: "Refused twice: nothing says what the OVERGROWTH ground is called in this world."
  - With no key, no new world can be written: the first of seven passes fails.
- The minted world was therefore The Long Audit under the name typed.
- LAWS: DANGER LEVEL came set to Rank F, the character's rank.
- ECONOMY: a 5% tax, a 3% creator share, and an estimate of 150 G a day.
- SIGN & MINT WORLD was instant. The card reads THE STILL ORCHARD, F, "ARCHITECT WAYFARER", "59:57 GATE OPEN — IT CLOSES IN", "ALPHA, AS MINTED · IT TURNS", AGENTS 0, RECON and DEPLOY.

**Recon.** "WHERE TO START: Nothing recorded yet. Start in the middle". The land's patterns show faintly over the whole map, with 8·8 marked "SCAN HERE". Two scans: OVERGROWTH, THREAT F, BEACON PRESENT, 1197 creatures, 8047 resources, 59 people, 3 leaders and 332 pack lines.

**The drop.**
- "BEACON 120m SW". The right hand was empty: the bench kit's saw is a tool, so every fight in this run before step 6 was bare-handed.
- Six tally rats and two moths. Moths hit from about 200 units away. Health went from 130 to 55.
- A ruin chest: "Chest opened: 6 items, one of them a fragment. +62 XP", and "Winging it: Scavenging. It costs more without the skill, and it counts toward it." The second was a level ("LV 2 · 1 TO SPEND · 1 TO FILL").
- Walking picked up two "Recovered Unidentified Signal." pieces.
- The sheet in the field showed no IDENTIFY anywhere. Unread pieces show as "Unidentified Signal". With the sheet open, health kept falling (109 to 94): the field does not stop for it, as ruled.
- Ground south of the chest could not be walked (OVERGROWTH's dark ground). The way to the beacon went round it to the east.

**A person met** (step 5, below) walked out with the character.

**The receipt:** THE STILL ORCHARD, 5m 19s, 46 actions, "HAUL VALUE 70 G READ", "UNREAD 3 pieces · worth unknown", "BROUGHT OUT Orrin Error", "HUB LEVY · CAUGHT: PAID IN FULL · TAKEN", and "IT SETTLED Ranged on biological, tech · the hands know it now". Gold went 500 to 481. The 19 G is 5% of the read and unread pieces, with nothing for the person. The vault held the three unread pieces, the read ones, and "Escort Bond: Orrin Error".

**The sale.**
- The Exchange (QUICKFINGERS) sells nothing: "Buy low, sell high! Or you would, if the block weren't dark."
- The Alchemist's SELL ITEMS reads "The counter pays 60% of value, from the hub treasury". It lists each unread piece with its worth ("Unidentified Signal 98G listed value · SELL 58G"), and lists "Escort Bond: Orrin Error 200G listed value · SELL 120G".
- A collar tag sold for 2 G after "SELL FOR 2G: SURE?". Gold went 481 to 483.
- The game's own gold audit balanced: player 483, treasury 31,013, wallets 3,069.

## 5. A person

- Orrin Error stood near the chest. The prompt read "TALK (ORRIN ERROR · 50/100) · 5 energy", and the talk window "Regard 50 of 100 · 5 energy a round · 48 held".
- First line: "I'm new here and these rats nearly had me. Are you safe out here alone? I could walk you to the city." They answered "They're alright. Stay put." "Rolled 93 against 52: it landed, regard +16."
- ASK IF THEY WANT SOMETHING: "Rolled 49 against 47. Coin is what moves them. They want to see what happens here."
- A second line about the city paying for hands: "The city provides for what hands can do. Follow me, and I'll handle the vermin." Regard 77, and "THEY WILL COME".
- E then offered "Secure for Extraction · 5 energy · 2s". After it: "Orrin Error walks beside you now. Reach the beacon together."
- They followed about 40 px behind. They struck three times and took one blow (140 to 137). They walked out at the beacon ("Orrin Error walks out beside you.").
- The levy did not count them.
- Not met: their death and the heavy body. Nobody struck them hard enough.

## 6. A person's road

**Home.** At the Rusty Anchor, Mags's WHO IS STAYING HERE listed "BONDS YOU HOLD · Orrin Error, passive · BRING THEM IN". That asked "THE BOND IS SPENT: SURE?", then:
- "IN THE ROOMS 1: Orrin Error · rank F · passive · Wants gold. Set on witness. Hands know Saw on flora, wood. Waiting on the Hall of Banners for ground."
- "On the board at the Hall: Orrin Error could use 2 things marked wood, whenever someone is passing."

**Talked to where they are.**
- At the tavern the window showed no cost.
- The ask gave "They are after a house of their own … could use 2 things marked wood".
- A line ("What would make this place feel like yours?") took about 20 s on the local model. It answered "I have what you need here. It's ready when you are." (it reads like a shopkeeper's line), with "Rolled 26 + 10 against 52: it missed, regard −2. They took it as: lands."
- After that the window showed "WHAT THEY ARE AFTER · SAFETY · Working toward a house of their own. · ON THE BOARD: … 2 things marked wood". The talk's goal and the board's want are the same.

**The talk line** (one turn at a time, the rest queue) was not met: only one person was talking.

**The want met.**
- The Armory (BJORN IRONFIST) sells Clerk's Hatchet (54 and 60 G) and Claim Pick (45 and 66 G) among its weapons. A hatchet (54 G) and a Letter Opener (141 G) were bought: gold 483 to 429 to 288, both in the vault, the audit balanced.
- Right-click wore them: the Letter Opener in the right hand, the hatchet in the tool slot.
- The level's point went to constitution (3 to 4) and its circle into Felling.
- Back in the world: AGENTS 1, and recon remembered the last visit ("CHESTS YOU KNOW 5 · 1 last seen empty"; creatures 1197 to 1187).
- "EXTRACT COMPOUND OAK · 6 energy", then "Harvested 1× Compound Oak. +14 XP". Three oak, then out: "105 G READ", "UNREAD 2 pieces", levy 17 G.
- The board: "ORRIN ERROR 2 OF 2 · Goes: Compound Oak, Compound Oak. · Orrin Error pays 70 G for these. · HAND OVER". Gold 271 to 341. Then "1 met, on record. Orrin Error has what they wanted, and pays 70 G."

**Ground and a house.**
- THE PEOPLE: "Holds 10,024 G of their own", "Brought out by WAYFARER, who answers for their upkeep: 7 G a day once they are in", and a Keeper's House on each lot.
- BUY on Lot #6 asked "ON THE TREASURY: SURE?". "The Hall bought Lot #6 for Orrin Error." The treasury read 31,225 G before and after.
- The house asked: building 0 of 7, wood 0 of 1, glass 0 of 2.
- One oak went in as wood.
- After a rest (step 8), six more oak came from the world: energy 50 to 2, with the last three swings giving nothing. They went in as building (6 of 7).
- **Scripted:** 1 Compound Oak and 2 Clear Pane were minted and added. Glass is on no shelf. Clear Pane is a recipe from 2 Counting Sand with no station, but nothing on screen led there.
- The deposit list offered Clear Pane under building too.
- With the last three in: "RISING · 0 of 7 steps stand · The bill is met. Orrin Error's house is rising. RAISING A HOUSE 1:19". About two minutes later: "HOME".
- The next rung showed at once: "Lapsed Actuary … THEIR WORKSHOP · Sawing Desk · Asks 6 building, 2 metal, 4 wood. A 150 G permit. 8 tiles of floor."

**Over several days** (clock scripted, one day per reload from character select):
- **Their memory of the character** (read from the page): "well known". It holds the ask that let the wood want slip (an open secret), the offered place, and the wood brought and paid for.
- **Day +1.** The city folded once while the character stayed. Orrin's wallet rose (10,024 to 10,038), a new want was posted ("2 things marked document"), and the character's gold fell 7 G for their upkeep.
  - Their living was not charged, and no meeting was queued, until the next load.
  - Orrin was found by the Alchemist's door ("Orrin Error · E · TALK"). The window read "BELONGING · Working toward a spouse and children."
  - They answered "Settled things are settled. I need that document."
- **Day +3.** On the reload, three days of living were folded at once and three meetings with their feeder went to the local model as a batch. They came back about two minutes later with one habit kept.
- **Day +4.** Goal "Acquire needed document from passing individuals." A line about the day they met got "That talk's on old stuff. I need documents." (regard −6, "grates", "They will not do that, whatever you say."). The talk window still shows day one's ask at the top ("They are after a house of their own").
- **Days +4, +5 and +6.** One meeting each went to the model.
- **Days +7 and +8.** The meeting settled with nothing sent: **the usual, from the seventh meeting**. The model calls that day were all the tech web's chain (below).

## 7. Study

- An unread piece in the sheet offers only "CARRY ON THE NEXT DROP" and "DISCARD": no STUDY.
- The game asks for a workstation of one's own before an unread piece can be studied, and a newcomer has none. So the road to learning to identify cannot start. The only way to read a piece is the keeper's paid identify. This is the field build's open question, met again (see the calls at the end).
- With nothing chosen, the panel offers "STUDY", a free line ("Anything…"), "THE CITY AROUND YOU" and "GRAND MARSHAL VEX, GUILD REGISTRAR".
- THE CITY AROUND YOU: "Sitting with The city around you. 15 energy, 11s." It landed as a failure: nothing kept, one harm on the record, energy 16 to 1.

## 8. Rest and growth

- **A level** came in the field, from a chest. The bar read "LV 2 · 1 TO SPEND · 1 TO FILL" until the point and circle were placed.
- **Mags, REST THE NIGHT (20G):** gold 341 to 321, "You lie down. This character is at rest for 3:20. Another can go." Then "You slept. It is another day.", with energy 50 of 50.
- **No dream:** the one sitting had failed, so nothing waited for it.
- **Not met:** a sitting paid, the dream, a gift.

## 9. A week

Ten days, moved one at a time from character select (scripted).

| Day | What showed | The books |
|---|---|---|
| +1 to +6 | Orrin's day as in step 6; 7 G of their upkeep off the character each day | the audit balanced each day checked |
| +7 | Week 2966 closed once (2967). "WARNING 1 OF 3: the database needs maintaining. It runs by itself in 2d 23:10, at a time you did not pick." with RUN NOW | treasury 29,878 G on day +8, 73 rows, balanced |
| +9 | "WARNING 2 OF 3 … It runs by itself in 23:09:25" | 29,725 G, 76 rows, balanced |
| +10 | No warning: maintenance ran by itself | 29,572 G, 79 rows, balanced |

- The Hall printed nothing in the ten days ("Printed 0 times"); the treasury stayed above its 14 days.
- Each day the hub reloaded, the tech web asked the model for Orrin's workshop chain, and each round came back refused. By day +7 it held 16 calls and "Round refused whole: wood_lumber is tagged "descriptive", which is not registered." It is still open, so it is asked again on every load.

## 10. A world's turn

- After ten days the card read "REGENERATION 80 · IT TURNS", AGENTS 3, gate open.
- Recon showed "SINCE IT LAST STOOD OPEN": 0 kinds changed, "What it grew 0", "Still being written 1". It also showed "SINCE REGENERATION 0 · Contacts 9511 → 10916 · That have changed 0 → 1164".
- In 8·8, creatures went from 1187 to 2590. Leaders now have 6 to 10 behind them, and one pack is "PACK OF 117".
- Dropped in, the world loaded: 209 tally rats and 22 moths nearby, all rank F with 12 health. Tougher here means more, not stronger.
- WHERE TO START again said "the way out is already under your feet" while the beacon was 120 m away.
- Out with 95 of 140 health, "HUB LEVY · DODGED 0 G".

## 11. The receipts

- **After the honest play** (before the clock moved): "Checked. The hub now holds 48 and signed for it. It reran 1 drop from 4 sessions. It checked 2 of 2 people of this city." IN GOOD STANDING.
- **After the scripted days:** "! Row 49 is dated a day this hub has not reached. Nothing in this batch was held." The standing stayed good. The hub keeps the real date and the page's clock had been moved ahead, so this is the check doing its job, not a find.

## What the store passes did in the real interface

**Nothing was found broken.** Every change that went through the new single writers landed on screen and in the books:
- gold from sales, purchases, levies, the inn, a want's payment and the resident's upkeep;
- items into and out of the vault and the pack;
- the bond spent into a resident;
- the lot bought;
- deposits and the house rising;
- the tech web's state;
- a world's kills and chests, remembered between drops;
- a level's point and circle;
- the escort's health and strikes.

The game's gold audit balanced at every check, from 23 to 79 rows. The two things that looked like breaks were not:
- **A resident's living is folded only when the hub loads.** `ebe1bb1` does the same (`turnTheDay` has never called `resolveLiving`).
- **The levy on carried tools.** It does skip the carried kit.

## The few real calls

Sorted first: what a ruling, a bug or the genre already answers is decided below, under "Decided, open to overrule".

1. **How does a newcomer begin to learn identifying?** The field build asked this on 2026-11-04 and it is still open. It blocks step 7.
   - Today an unread piece offers no STUDY until the character holds a workstation of their own, which a newcomer cannot have. The only way to read a piece is the keeper's paid identify.
   - Your words were "study unided items and you start to figure out how to identify".
   - The choices: a public bench in the centre (a charged service, by the city-tax ruling), or studying an unread piece with no bench, in town only.
2. **What stops the tech web asking for a chain the law keeps refusing?**
   - Today a refused round is asked again on every hub load, with no end. Orrin's workshop chain reached 16 calls in ten days on the local model ("wood_lumber is tagged "descriptive", which is not registered").
   - On the local model it costs nothing. With a key, every load bills more rounds.
   - A cap is ruled out. What is left is your call: wait for something new (a word registered, the chain changing), or wait for the player.

## Decided, open to overrule

- **The counter showing an unread piece's worth** ("Unidentified Signal 98G listed value") breaks the Q12 ruling that nothing tells an unread piece's worth. It is a bug.
- **An Escort Bond sold at the counter for 120 G** sells a person, against Q17 (a person is not haul). The counter should not buy one.
- **A resident's living folds only on a load,** not at the midnight fold while the character stays. Q39 rules the city folds its days while the person stays, so it is a bug, though the days are made up on the next load.
- **No key, no new world.** With the local model, writing a world fails on its first pass: the law refuses an unregistered word or a ground with no name. The door's local asks already carry a tightened schema for creation, Kami and keepers. Giving the world's passes the same (the registered words and the names asked for) is the fix. It is a bug against Q24 (no key means the local model), not a call.
- **"They took it as: lands" under "it missed, regard −2"** reads as a contradiction. It is words, for leg 4.
- **The tutorial's recon lists about 640 lines** of leaders and packs for one block, since Q44 took the cut-off away. Packs of the same kind should share a line, as identical bin pieces do (Q38). It is a bug of the screen, not a call.
- **The landing page's THE MODEL section is out of date.** It is words.

## To compare

These are the places where a newcomer's road most depends on feel, for Pedro to judge on his run:
- Creation's page growing under the pointer after the first pick.
- Nothing in the city pointing to the Nexus before the first order.
- The walk: how long the plaza takes (this run had no way to judge it).
- The tutorial: whether "THE WAY OUT" before "THE CONTACTS" reads right, and whether the lesson box over the readout matters.
- The first own world: a bench kit with no weapon, and skills with no tools.
- The recon panel's length.
- How long the local model takes to answer in a talk (about 20 s at the tavern), and whether its lines sound like the person.
- A house: gathering seven pieces of building, and glass found nowhere.
- The rest's 3:20 wait.
- Whether "tougher" after ten days (twice the creatures, the same strength) is the tougher meant.

## Pedro's run

### 1. Arriving

### 2. The tutorial world

### 3. The first city

### 4. The field

### 5. A person

### 6. A person's road

### 7. Study

### 8. Rest and growth

### 9. A week

### 10. A world's turn

### 11. The receipts
