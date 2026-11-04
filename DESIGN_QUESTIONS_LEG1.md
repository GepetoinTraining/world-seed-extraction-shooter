# Design questions from leg 1, for leg 3

Collated 2026-11-04 from the seven streams of leg 1 (arrival, the field, a person's road, the city's week, worlds over time, rest and growth, the door): their lines in the shared list, and the questions in their reports that were not on it. Grouped by where a person meets them; the questions about how the model is asked and what the law takes are under the door. A question met by several streams is one entry, with every place it was met.

Each entry: the question; where it was met; what the game does today; whose call. A stream's own reading is kept where it gave one, marked as that stream's. No entry is answered in code.

**Sorted, 2026-11-04, after Pedro asked how many of these were questions at all.**
- Answered by him: Q1, Q2, Q11, Q14 and Q21.
- Decided as common sense or by a ruling he had already given: 29. Each says so on its own line, and he may overrule any of them.
- Words, for leg 4, and not his to answer: Q7, Q10, Q15, Q23, Q30, Q36, Q42 and Q51.
- Real design calls, left to him: eight, with Q24 and Q37 merged into one.
  - Q16: a person walks beside you, or rides as a bond?
  - Q17: does the levy read a person?
  - Q24: is the game with no key ever a player's mode?
  - Q27: one study act, or three?
  - Q43: what retires a world?
  - Q45: the pace of camps and bosses.
  - Q46: how to find a boss.
  - Q50: what a talk shows it cost.

Leg 1's play was on test avatars with the pane hidden (no window), so frames ran throttled. Nothing here judges feel. The integrated game (JOINER, on the joined tree, 2026-11-04) met Q11, Q21 and Q22 again, and added Q51.

---

## First: with a key, the Seed cannot write a world or a chain

**Q1. How should a theme, and a chain, be asked for, when the API refuses their schemas?**

- **Met:** the door. MINT NEW REALITY on SALT ARREARS, WRITE IT after one talk round (`theme`, Sonnet); the server's route for `theme_large` (Opus, size 64); the server's route for `chain` (Haiku and Sonnet; no resident with a home and a theme profession reached it in play).
- **Today:** the API answers 400, "The compiled grammar is too large", before any token is billed. The person reads "The Seed did not answer." and can only pick a world already written. With a key the game goes on exactly as with none, which is why no other stream saw it. The whole `THEME_SCHEMA` is over the limit even with every enum taken out. `CHAIN_SCHEMA` (the theme's tags, stations, materials, gear and goods, with a look on each) is refused the same way, so the tech web (D129) cannot be written either.
- **The split trial (the door's, not built):** the door's own theme prompt and the SALT ARREARS talk, sent as four parts in turn on Sonnet at high effort, each part given the earlier parts in its message. The four parts each compile: (1) world, creatures, materials; (2) stations, goods, gear; (3) consumables, affixes, abilities, lore, junk; (4) anchors, professions. All four came back whole, in 91 s, 70 s, 67 s and 52 s (about four minutes): 16 creatures, 18 materials, 6 stations, 13 goods, 27 gear, 8 consumables, 19 affixes, 16 abilities, 8 lore, 16 junk, 14 anchors, 23 professions. Output 40,435 tokens, **$0.53**. The system text did not cache across parts (the schema differs each time), about 17,600 tokens of cache writes for one world. **The law (`ContentRegistry.judge`, as the mint calls it) refused it whole:** first `tideline_receipts` tagged "receipt", a word not registered (inside part one); with that word registered by hand, a station naming the tool "blow_pipe" (part two). So a split write reaches the law, and the law then refuses on words the model used without registering them, which a single ask would also risk. Nothing was saved or installed. The door's whole spend in leg 1 was $0.62 of the $10 limit.
- **The door's framing of the choice:** in parts, each told what the earlier parts wrote; a smaller schema with more left to the law; or no schema, the law judging parsed text.
- **Pedro, 2026-11-04 (in his words):** "we gated the first simulation to content from the tech web, and only the second one gets the pass initially, it was a decision to not make the player wait, if we leave a tutorial world on until the player can have his, I think it works to allow the theme itself and everything to be generated. Also, it needs to be inside the theme, and only the suffix and preffix list for the names, they get "what" they do from studying. Claude doesn't decide anything that's rollable, we first ML and then LLM"
- **Pedro, 2026-11-04, the second answer (in his words):** "theme is what that dive is about, zombie, fantasy, fantasy space opera, dungeons, a moiuntain setting. The main thing that needs to be generated is the tiles, the creature types, the possible professions inside, the flora and fauna... that's why we give time, an initial pull comes from the DB of things that are semantically near the tyhemes decrsiption and then the LLM starts selecting from them and making the world richer, it first SELECTS then adds, we don't EVER want to recreate the same basic thing, an oak tree is an oak tree, so oak -> mountain oak with difficutly 1 and 2 don't happen... that's why we use the two systems. also, a space scenarion on a moon without oxygen doesn't get trees, and the "water" or "mountains" (imapassle and passable but with skill) terrains might be tunnels <-> water and dark side crater <-> mountasin"
- **The reading taken from both answers:**
  - **What a theme is:** what a dive is about, in a few words: zombie, fantasy, fantasy space opera, dungeons, a mountain setting. It is not the content pack.
  - **What is generated for a world:** its tiles, creature types, the professions it can hold, its flora and fauna.
  - **The wait:** today a world's first deploy uses only tech the tech web already fits, and the model is called from the second cycle (D129, PLAN.md bar 164), so the player never waits. With a tutorial world open until the player's own world is ready, all of the above can be generated before the first deploy.
  - **How, in two steps ("first ML and then LLM"):**
    1. A pull from the database of everything near the theme's description, by meaning.
    2. The model selects from that pull, and only then adds what the world still lacks.
  - **No copies:** a thing that exists is never written again under a new name. An oak is an oak: no "mountain oak" at difficulty 1 and another at 2. That is why there are two steps.
  - **The theme rules out what cannot be there:** a moon without air gets no trees.
  - **Terrain is two roles, each dressed by the theme:** an impassable one ("water") and one passable with a skill ("mountains"). On an airless moon, tunnels can take water's role and a crater on the dark side can take the mountain's.
  - **Names:** for names, the model writes only prefix and suffix lists, inside the theme.
  - **What a thing does:** found by studying (D118), not written up front.
  - **Numbers:** the model decides nothing that is rolled.
- **What follows, not checked:**
  - Selecting is answering with ids from a given list, and adding is only for what is missing. Both are far smaller asks than today's template, which writes every entry whole.
  - New words come from the theme's own lists, so they are registered by construction. That may answer the law's refusal.
  - The database door exists: `VectorStore`'s `semanticSearch`. But `EmbeddingService` is a hashed bag of words (D46), so it only finds shared words. "an airless moon" would not find "vacuum" or "regolith". The first step needs a real embedding to work as ruled.
  - Terrain as two roles dressed by the theme is not how terrain is built today. `TerrainSystem` has four fixed kinds, all hardcoded and none themed: water (blocked), rock (blocked), mud (half speed) and ground. No kind is passable with a skill.
- **Pedro, 2026-11-04, on each cycle after (in his words):** "then each cycle we call the LLM up simply to check the director and upgrade a the monsters, or, to add things that have been collected, change a loot table for certain places, request the isnertion of a special quest zone (not done yet), that's the idea"
- **The reading:** once the world is generated, each cycle calls the model only to do these things:
  - check the director;
  - upgrade the monsters;
  - add things that have been collected;
  - change a loot table for certain places;
  - ask for a special quest zone to be inserted. This one is not designed yet.
- **Where it stands:** the scan window does not call the model yet (PLAN.md, leg 2). `DirectorStore` exists. There are no quest zones.
- **Call:** ruled, 2026-11-04. Not built.

---

## Arrival

**Q2. What is a new person's first order, and who gives it?**
- **Met:** arrival, the whole first day in New Carleon.
- **Today:** nothing in the city points a newcomer anywhere. The Hall's board says "Nothing on the board... a person has to come through the gate first", Mags's beds are empty, and the Nexus is found by walking. Vex's answer about the Hall explains the trial and bonds, which a newcomer cannot act on yet.
- **Answered by Pedro, 2026-11-04:** the tutorial world (Q14) is the first order: it shows a newcomer where to scan, the way to the extract, and the mobs.

**Q3. Vex says people come out of the gate "with a little coin"; D128 says a person from a bond carries years of living (2,600 G and up). Which stands?**
- **Met:** arrival, Hall of Banners, ASK ABOUT THE HALL (`src/entities/hub/dialogue.ts`, about line 207). The person's road then met a person from a bond holding 7,924 G of their own.
- **Today:** the line stands. The words are leg 4's; this one contradicts a ruling.
- **Decided, common sense or an existing ruling (Pedro may overrule):** D128 stands; Vex's line is wrong and changes to match it.

**Q4. Should a first world's danger follow the person's rank?**
- **Met:** MINT NEW REALITY, step 2 LAWS, by arrival, the field, a person's road and worlds over time, each with a rank F newcomer.
- **Today:** the free deed's danger defaults to Rank D. Every stream set Rank F by hand.
- **Decided, common sense or an existing ruling (Pedro may overrule):** the free deed's danger defaults to the person's rank, and can be raised by hand.

**Q5. What does a world card call its maker?**
- **Met:** the ZONES card of the person's own world: "ARCHITECT WS_2EF4E" (arrival), "ARCHITECT WS_A9774" (the field), "ARCHITECT WS_E5546" (worlds over time).
- **Today:** the first eight characters of the maker's id, where the person is named. The certificate carries only the maker's id, so another person's world would need a name from somewhere (D134).
- **Decided, common sense or an existing ruling (Pedro may overrule):** the card names the maker by their name. Another person's world carries the name in its certificate (D134).

**Q6. Which weight does the city show?**
- **Met:** arrival, the Agent tab (Vault keeper, ACCESS STASH; `PlayerHub.tsx`, about lines 182 and 207).
- **Today:** "LOADOUT — NEXT DROP 4.5 / 49 kg" counts the pick that rides; the line under it, "Current bank weight: 0.0 / 49 kg", reads the field pack and is always 0 in the city.
- **Decided, common sense or an existing ruling (Pedro may overrule):** the city shows one weight, the one that rides on the next drop. The always-zero line goes.

**Q7. One word for two deeds.**
- **Met:** arrival. The Land Office's THE DEEDS lists lots; the only deed a newcomer holds is WORLD DEED: SMALL, spent at the Nexus.
- **Today:** both are "deed".
- **Words, for leg 4:** not a question for Pedro. Moved to leg 4's list.

**Q8. The character sheet is wider than a 1024-wide window: should it wrap, scroll, or is there a minimum window?**
- **Met:** TAB in the city (arrival); in the field while carrying (the field); again by rest and growth.
- **Today:** the sheet is pinned right in a fixed strip (`justify-content: flex-end`), the first panel starts at -36 px, and the left column (name, attributes, skills) is cut off at the window's edge.
- **Decided, common sense or an existing ruling (Pedro may overrule):** the sheet fits the window. It is a bug.

**Q9. Which name does a skill from creation go by? Does the first to reach a skill at creation name it for the hub?**
- **Met:** the door, WAGER (Kami's path) and SALTER (the Seed's path). Arrival met the same feed lines: "first in this hub: TRELLIS" on all three starting skills, three feed lines at first arrival (B3's item 4).
- **Today:** the sheet shows the name the model gave (WAGER's "Quiet Sawing", "Hammer and Hinge", kept by `skillWords`); the feed's "First in this hub to reach …" and the ledger's FIRST row use the hub bank's name for the same id ("Saw on wood", "Blunt on metal"), because a creation name never enters the bank. D35 says creation passes the same law and is signed.
- **Decided, common sense or an existing ruling (Pedro may overrule):** one skill has one name. Creation passes the same law and is signed (D35), so its name enters the bank, and the feed and the ledger read that name.

**Q10. Words a newcomer meets on day one (for leg 4, not stripped).**
- **Met:** arrival.
- **Today:** each life on creation's first screen prints its stat words ("BARTERING, THEN CHARISMA"); the floor's granted skills read as tag lists ("Mineral, Sand", "Blunt on mineral, stone"; see Q47); the sheet's "THE WORKING · A FOCUS CASTS IT · debt 0 of 35"; recon's "SECTOR INTEL" counts; the signature's summary does not say where the person arrives.
- **Words, for leg 4:** not a question for Pedro. Moved to leg 4's list.

---

## The field

**Q11. What should a newcomer's first drop cost them? Should the first drop, the start recon suggests, or the kit be treated differently, or is this the welcome?**
- **Met:**
  - the field: FIELD TRIP (rank F), sector 5-11, level 1. Recon's WHERE TO START offered "Threat D with a beacon in it" (the worst ground climbs two ranks above the world's, by R4); a pack of three rank E aggressive creatures at the drop point took 120 health in under half a minute. The death took the whole creation kit (222 G), leaving 500 G and nothing to work with, two minutes after arriving. Pedro, watching: "felt bad for you bud.... happened to me first time as well".
  - a person's road, at the way out: ROADSIDE, rank F, threat F centre, level 1. Six rank F tally rats sat on the beacon and killed the person during the five-second channel (140 health in about half a minute); the kit, a pick and two stones went (452 G).
  - rest and growth: a level 4 person died in 1 m 14 s on a quick deploy walking north, kit lost (202 G).
  - worlds over time: threat D at the centre of a rank F world, and three deaths to a leader by the falls road.
  - the integrated game: JOINER, SEAM TEST (rank F), threat D at the centre. Died while talking to a person in the field: the talk window was open, the field went on, and 114 of 130 health went in the rounds, 1 m 28 s, 191 G of kit. Earlier, a reload mid-run returned JOINER to the city and the pick in the pack was gone; mid-run resume is already Pedro's open question (`PLAN.md`, `HANDOVER.md` section 9).
- **Today:** as above. The streams raised health in memory to go on (a test tool, not balance).
- **Answered by Pedro, 2026-11-04:** "welcome to albiojn.... never read that?" A hard first death is the genre's welcome, so it stays. The talk does not pause the field. The tutorial world (Q14) is where a newcomer does not lose the 500 G.

**Q12. Should a receipt show the worth of pieces nobody has read? How is a levy charged on what neither side has read, and what does the receipt say?**
- **Met:** the field, SEALED, after a chest gave three unread pieces.
- **Today:** HAUL VALUE read 2,803 G, the sum of every piece's true value, while the pack showed them as "Unidentified Signal". The levy is a share of the same sum, so a levy that is caught would show it too. Banking reads every piece at once, so the vault shows them in full a moment later.
- **Decided, common sense or an existing ruling (Pedro may overrule):** a receipt does not show the worth of what nobody has read. The levy is charged on that worth unseen, and the receipt says only that a levy was taken.

**Q13. Which scale names a piece's quality, and where does the word go?**
- **Met:** the field, at the vault, the counter and the armory shelf.
- **Today:** the item factory writes "Broken" below -15% and "Superior" above +15% into the stored name; the card reads five bands (Crude to Superior) at ±4% and ±12%. So a +12% to +15% piece reads "Superior +12%" on its card with no word in its name, beside "Superior Clerk's Abacus". A word lands in front of a name that begins "The": "Crude The Repossessor". Since `a66a666`, every door the field met says what the card says at the low end (Crude, not Broken); the rest stands.
- **Decided, common sense or an existing ruling (Pedro may overrule):** one scale. The card's five bands are the scale, the stored name carries no quality word, and the word is never put before a name that starts with "The". It is a bug.

**Q14. Should a debug world sit on a new person's zones list?**
- **Met:** VIEW EXTRACTION ZONES on the first visit (the field; arrival, "known since Wave A"); first in QUICK DEPLOY (worlds over time).
- **Today:** "SIMULATION_DEBUG · SECTOR DEV-SA · ARCHITECT SYSTEM · SIMULATION — OUTSIDE THE CLOCK" is the only world shown until the person mints their own, with a live DEPLOY.
- **Answered by Pedro, 2026-11-04:** "we'll change it to a tutorial world, and actually make the recon map work, right now there's no view from the map itself to choose where to scan... then you can force the scan on a known block and arrow their way to the extract, teach them about mobs, see the tutorial? and the no losing the 500gs". Four parts: the debug world becomes a tutorial world; recon gets a view of the map to choose where to scan from; the tutorial forces a scan on a known block, arrows the person to the extract, and teaches mobs; and the 500 G is not lost there. Not built.

**Q15. Should the writ's card say what it does?**
- **Met:** the field, the Alchemist's shelf and the vault.
- **Today:** the Writ of Breach's card shows rarity, rank, weight and origin, and nothing of the way out it opens; a newcomer paid 764 G of 828 G for it. It worked as B5 built it (7.1 s, 30 energy, sealed).
- **Words, for leg 4:** not a question for Pedro. Moved to leg 4's list.

---

## A person's road

**Q16. Who walks beside you after "they will come"?**
- **Met:** a person's road, in the field with Sera Basalt (rank F, ROADSIDE).
- **Today:** the feed says "Sera Basalt walks beside you now. Reach the beacon together." The person leaves the world at once and becomes an Escort Bond in the pack (weight 0); nobody is drawn beside you and nothing can harm them on the way.
- **Pedro's, a real design call.** Is a person brought out a bond in the pack, as built, or a body that walks beside you and can be hurt on the way? Whichever it is, the feed line must say what happens.

**Q17. Is a person brought out a haul the levy reads?**
- **Met:** a person's road, SEALED after the bond.
- **Today:** HAUL VALUE 200 G (the bond's value) and HUB LEVY · CAUGHT: PAID IN FULL 10 G, taken from the player's own gold. The bond's card says "Worth more than gold, redeemable for some anyway". Related: Q12.
- **Pedro's, a real design call.** Does the levy read a person brought out?

**Q18. Once a person is home, where do you talk to them?**
- **Met:** a person's road, the Rusty Anchor, then Sera's own door on Lot #6.
- **Today:** while lodging, Mags's WHO IS STAYING HERE has TALK WITH THEM. Once the house stands they leave that list, and neither their drawn body at the door nor the house's inside offers a talk, so their regard (93, carried home from the field) and their ladder can no longer be reached.
- **Decided, common sense or an existing ruling (Pedro may overrule):** a person at home is talked to where they are: at their door, in their house, wherever they walk. Everything is walked over (the ruling that NPCs walk by goals).

**Q19. Which want is the person's want?**
- **Met:** a person's road, the tavern talk and the Hall's board on the same day.
- **Today:** the talk's WHAT THEY ARE AFTER said "SAFETY: Working toward a house of their own"; the board posted "could use 1 thing marked stone" (the sheet's HOARD objective, by `wantFor`). Two readers of one person name two wants, and the board's is the one that moves gold and ground.
- **Decided, common sense or an existing ruling (Pedro may overrule):** one want. The board reads the goal the talk set, which follows Maslow (the talk loop ruling). Two readers naming two wants is a bug.

**Q20. What does a person want after the house?**
- **Met:** a person's road, Sera home, the next day.
- **Today:** the board posts another stone (their hands' work), paid from their wallet, which only goes down (7,924 → 7,861 G): nothing pays them and they pay nothing to live. Their ladder's rung should have moved past "a house", but no talk can show it (Q18). Walking by goals is not built: they stand at their door.
- **Decided, common sense or an existing ruling (Pedro may overrule):** the next rung of Maslow's ladder after shelter, walked to by goals. Their wallet takes pay for their hands' work and pays for their living, through the economy chain.

**Q21. Can a newcomer meet a person's first want?**
- **Met:** a person's road (report, "what the integrated game must know"): Sera's first want was stone, and the house's bill asked for glass. The integrated game: Kael Gantry's first want was 3 grain. No shelf sells grain, and Chaffwheat grows only on wasteland and overgrowth, so it took a recon search and a second drop (sector 5·6) to gather it by hand. Their next want was ore. The house's bill again asked 7 building, 1 wood, 2 glass, minted by script.
- **Today:** no shelf sells stone or glass. Stone needs a pick and a drop; glass is a glassblowing chain from sand. The stream minted the bill's materials by script.
- **Answered by Pedro, 2026-11-04:** "that's the gaem lloop". A want that has to be gathered in the field is the loop. Nothing changes.

**Q22. Should a resident be drawn apart from the player?**
- **Met:** a person's road, Sera at the tavern and at their door. The integrated game: in the plaza, with the camera held at the map's edge, JOINER's walk was read off Kael Gantry for several tries; only the corner brackets, zoomed, told them apart.
- **Today:** a resident is drawn in the same figure and colour ramp as the player, told apart only by where they stand. B4 said so; the stream notes that, for a colourblind eye, it reads as two of you.
- **Decided, common sense or an existing ruling (Pedro may overrule):** yes. A resident is drawn apart from the player by shape, not colour (the colourblind rule).

**Q51. The Hall's ground button says "ON THE TREASURY: SURE?", and no gold moves. Which is meant?**
- **Met:** the integrated game, the Hall's THE PEOPLE: Lot #6 bought for Kael Gantry, 4,450 G.
- **Today:** the treasury read 39,928 G before and after. The store says so on purpose: "The seller is the treasury that backs the buyer, so no gold moves. The row says so" (`hub/store.ts` about line 1109). Only the free ground's line on the city's day dropped by 5 G. Kael Gantry held 14,679 G of their own throughout. Ledger L33.
- **Words, for leg 4:** not a question for Pedro. Moved to leg 4's list.

**Q23. Words met on the road (for leg 4, not stripped).**
- **Met:** a person's road.
- **Today:** "Winging it: Persuasion / Escort / Quarrying / Tax Evasion. It costs more without the skill" on each first try, and nothing cost more (ledger N13); the field prompt "TALK (SERA BASALT · 50/100)" shows the meter as a bare fraction before any talk; "Wants gift. Set on hoard. Hands know Blunt on stone." on the tavern and Hall rows.
- **Words, for leg 4:** not a question for Pedro. Moved to leg 4's list.

---

## Rest and growth

**Q24. With no key, does a sitting ever pay lore, and so can a gift ever come?**
- **Met:** rest and growth, DORMER: two sittings that succeeded (a typed thought, the city), then three rests at the inn with no key. With a key the door's rest paid lore 5 under "social" for one shallow sitting.
- **Today:** lore is written only by the dream (D126), so with no key every sitting waits and lore stays 0. Three circles in a skill owe a gift that costs lore, so the gift waits for ever, and the circles give nothing. The rest otherwise restores, as D35 asks, and since `9b0db17` it names the waiting gift.
- **Rest and growth's reading, to overrule:** a sitting could pay its middle depth by the formula when no dream can be reached, the dream then only naming topics.
- **Pedro's, a real design call.** Merged with Q37. Is the game with no key a mode a player ever gets, or only a stand-in for building? If only a stand-in, nothing about it needs designing.

**Q25. Should a rest with nothing spent be offered, and what does it cost?**
- **Met:** rest and growth, the Rusty Anchor, REST THE NIGHT at full energy; the door met the same 20 G.
- **Today:** it takes the 20 G and ends at once ("You slept. It is another day."), and the day turns. A rest's length reads only energy spent (`RestSystem.restMs`). A first rest after a failed sitting filed nothing and still took 20 G (the door).
- **Decided, common sense or an existing ruling (Pedro may overrule):** it stays. An inn charges for the night whether you are tired or not.

**Q26. Where does a person read their energy in the city?**
- **Met:** rest and growth, the sheet's study panel ("A sitting takes 15 energy and 11s. It can go badly") and the inn.
- **Today:** the field's bar shows ENERGY and the talk window shows "held" only in the field. No city screen shows what is held, though a sitting, an identify and a station's study all spend it there and a rest's length follows it.
- **Decided, common sense or an existing ruling (Pedro may overrule):** energy shows in the city wherever something spends it: the sheet's study panel and the inn.

**Q27. Three buttons read a thing, two of them called STUDY. Should they merge?**
- **Met:** rest and growth: the sheet (IDENTIFY, and STUDY, the sitting for lore, D126) and a workstation's panel ("STUDY (weapon)", Wave 10E's identify eye trained by the piece, `studyItemAtStation`).
- **Today:** the same word, a different roll, cost and result. C9 left IDENTIFY beside STUDY for Pedro.
- **Pedro's, a real design call.** Merge IDENTIFY and the two STUDY buttons into one act, or keep them as three acts and give them three names? The names are leg 4's.

**Q28. Should the city's bar say what waits after a level?**
- **Met:** rest and growth, after level 4 was reached.
- **Today:** the field chip says "LV 4 · 3 TO SPEND · 3 TO FILL"; the city's bar says "F · LV 4" and nothing waiting; the sheet says "3 POINTS TO SPEND" and "3 TO FILL".
- **Decided, common sense or an existing ruling (Pedro may overrule):** yes, the city's bar says what waits, as the field chip does.

**Q29. Are a hub's firsts meant to be study topics?**
- **Met:** rest and growth, a fresh avatar's `bank.lore`; arrival met the same firsts as feed lines (Q9).
- **Today:** B3's firsts are written as lore topics ("First in this hub: Mineral, Sand"). C9's lore reads `bank.lore` as topics known, so these are topics the dream is told and that teach prices read.
- **Decided, common sense or an existing ruling (Pedro may overrule):** yes, a hub's firsts are topics the dream is told. It is what is built, and it does no harm.

**Q30. The sitting on the city is named "The city around you", not the city.**
- **Met:** rest and growth, the sheet's study panel and the feed ("You sat with The city around you...").
- **Today:** the dream is told that name.
- **Words, for leg 4:** not a question for Pedro. Moved to leg 4's list.

---

## The city's week

**Q31. Which day's cost is a print's 14 days?**
- **Met:** the city's week, the week's close on day 24 of TITHE's city.
- **Today:** the close printed 12,418 G, which is 14 × 887 G, the cost read with the old week's shelf emptied. The new stock then rolls, and the Hall reads 1,551 G a day, so right after a print of "14 days" it says the treasury holds 7.
- **The city's week's reading, to overrule:** the print covers the week ahead, so it reads the shelf just stocked.
- **Decided, common sense or an existing ruling (Pedro may overrule):** the print covers the week ahead, so it reads the shelf just stocked (the city's week's reading).

**Q32. Should a keeper's shelf in the centre keep a rare piece longer than a week?**
- **Met:** the city's week, the first close, against Pedro's "a time per rank and per rarity they are kept in stock".
- **Today:** `ShopWeek.stockDays` (7 days for F common, 42 for C rare) is read only by a master's own shop; the three keepers bin everything unsold at every close, whatever its rank or rarity.
- **Decided, common sense or an existing ruling (Pedro may overrule):** the keepers' shelves use `ShopWeek.stockDays`, as Pedro already ruled: "a time per rank and per rarity they are kept in stock".

**Q33. What does a hub founded mid-week do with its opening stock?**
- **Met:** the city's week; TITHE's city opened on day 5 of its week.
- **Today:** two days later the close binned the whole opening shelf (97 pieces), and three days after that it came apart as 14,539 G of loss, which the Hall covered.
- **Decided, common sense or an existing ruling (Pedro may overrule):** opening stock lives its own stock days from the day the hub opens. Binning it two days later is a bug.

**Q34. Is the general tax meant to be nothing in a new city, and where does a holder read their lot's tax?**
- **Met:** the city's week, the deeds and the Hall, with a house and a farm plot held.
- **Today:** what the tech web produces is worth 0 G until a skill in it makes something in the city, so every lot pays 0 G a week, and no screen a holder reads says what their lot's tax is.
- **Decided, common sense or an existing ruling (Pedro may overrule):** zero is right while the city produces nothing taxable (the city tax ruling). A holder's lot shows its weekly tax on the deeds screen.

**Q35. Should a world deed sell at the counter? (ledger W1)**
- **Met:** the city's week, the Alchemist's Corner, SELL ITEMS, beside a tonic.
- **Today:** it sells, for 94 G.
- **Decided, common sense or an existing ruling (Pedro may overrule):** yes. A deed can be found and exchanged (D72), and the counter is an exchange.

**Q36. Should the counter's line say it pays more for a kind that keeper saw selling, or is the premium meant to be found?**
- **Met:** the city's week, SELL TO THE COUNTER: a 1 G tonic offered 2 G (the 1.25 premium, rounded up). The field's sale also included the keeper's choice premium.
- **Today:** the line says it pays 62% of value.
- **Words, for leg 4:** not a question for Pedro. Moved to leg 4's list.

**Q37. What should a keeper say with no key?**
- **Met:** the city's week, TALK WITH THEM at the Land Office, asking about a workshop and the weekly charge.
- **Today:** the round rolled (regard 40 → 53) and no words came ("No voice on this server"). D122's keeper working for a charge is not built. With a key, see Q48.
- **Pedro's, a real design call.** Merged into Q24.

**Q38. Should a bin list each piece as its own row?**
- **Met:** the city's week, the Alchemist's shelf after the first close.
- **Today:** seven "Interest Tonic · BARGAIN BIN" rows, and two Gambler's Knots at different bin prices (each piece's parts are its own roll).
- **Decided, common sense or an existing ruling (Pedro may overrule):** identical pieces at one price share a row with a count. A piece with its own roll keeps its own row.

**Q39. Should a city fold its days while the person stays in it?**
- **Met:** the city's week (report, "what the integrated game must know").
- **Today:** days and weeks fold only when the city is opened (`loadHub`). Someone who stays in the city across a midnight sees nothing fold until they leave and come back.
- **Decided, common sense or an existing ruling (Pedro may overrule):** yes. The city folds its days at midnight while the person stays in it.

---

## Worlds over time

**Q40. Which anchors does recon's "Chunks · anchors" count: posts standing, the ward, or should it say which?**
- **Met:** worlds over time, recon, sector 7·10 of SLOW CLOCK at regeneration 62.
- **Today:** a builder's camp had a seat and one built anchor post; the map drew the post (a diagonal stroke) and the panel read "12 · 0". The number is the boss's ward (`Territory.layOver`, `ward?.slots.length ?? 0`), and the Hall's chain posts only when it is above 0 ("only a boss posts"), so changing the count would post chains for camps. At regeneration 162 two camps became bosses and read "· 3".
- **Decided, common sense or an existing ruling (Pedro may overrule):** the line says which count it shows, and names the ward as the ward. The count itself does not change, so chains still post only for bosses.

**Q41. What does AGENTS on a world card count, and who writes it?**
- **Met:** worlds over time, the zones list, SLOW CLOCK after three drops.
- **Today:** "AGENTS 0". It reads the certificate's `stats.totalVisitors`; `WorldCertificate.recordSession`, its only writer, has no caller. The debug world's "AGENTS 1" is a fixed value. The stats sit inside the signed certificate.
- **Decided, common sense or an existing ruling (Pedro may overrule):** AGENTS counts drops into the world. `recordSession` gets its caller at deploy, and the debug world's fixed 1 goes with it (Q14).

**Q42. A gate's close with nothing carried reads as a death and a loss.**
- **Met:** worlds over time, the receipt after the gate closed with the person inside, empty-handed.
- **Today:** "DIED", "THE GATE CLOSED WITH YOU INSIDE — THE WORLD KEEPS WHAT FELL", "LOST TO THE WORLD 0 G", "Nothing was carried. Nothing was lost.", and ACKNOWLEDGE THE LOSS. D77 makes it a death.
- **Words, for leg 4:** not a question for Pedro. Moved to leg 4's list.

**Q43. Is there a road in play that retires a world, and what happens to what it held?**
- **Met:** worlds over time, by flagging a card in memory (scripted).
- **Today:** a world retires only when the grid version or its theme leaves the registry, which only a code change does. The card reads "RETIRED · NO GATE · RETIRED — the record stands; the ground is gone", RECON and DEPLOY disabled with the reason on hover. Open: its minter, its age, a theme withdrawn; and its bosses, holdings on maps handed to the Hall, a minter's toll treasury.
- **Pedro's, a real design call.** What retires a world in play, and where do its bosses, its holdings and its toll's treasury go?

**Q44. Is a sighting by scan meant to be invisible to the person, and to count as seeing?**
- **Met:** worlds over time, recon, sector 8·8 at alpha.
- **Today:** six leaders went into `seen`, which fixes their goal's outcome for that cycle (D93), while the manifest lists only "Unknown contact" counts and no mark for a leader or pack.
- **Decided, common sense or an existing ruling (Pedro may overrule):** what a scan sees shows in the manifest, leaders and packs marked. Seeing that fixes an outcome and leaves no mark is a bug. Hiding is its own later pass (D127).

**Q45. Is this the pace: five camps, then two bosses, in one sector of a rank F world in under three weeks?**
- **Met:** worlds over time, SLOW CLOCK (rank F by hand), sector 7·10.
- **Today:** five builders settled by regeneration 62 and two were bosses at 159 (about 20 days of a small world's clock), with one anchor rising about every 28 cycles. 8·8's packs grew from 2–5 to 5–12. Nothing brings a boss down until C6, so a world keeps filling. C4 named this pace as the number to watch.
- **Pedro's, a real design call.** Is this the pace: five camps, then two bosses, in one sector of a rank F world in under three weeks? Only play can say.

**Q46. How does a person find a boss?**
- **Met:** worlds over time (report, "what the integrated game must know").
- **Today:** to see a boss the drone must be aimed at a builder's sector. Nothing on the zones card or in recon points at one, and the Hall shows nothing until a map is handed in. The stream found the sector from the roster by script.
- **Pedro's, a real design call.** How does a person find a boss? The recon map's own view (Q14) may be the start of the answer.

---

## The door: how the model is asked, and what the law takes

**Q47. A skill named by its tag list: should the ask leave unnamed candidates nameless, or the law refuse a name that is the tag list?**
- **Met:** the door, SALTER's Seed: Haiku gave "Fiber, Flora, Grain" beside "Foraging" and "Gleaning". Arrival met the same shape from the floor with no key ("Mineral, Sand", "Blunt on mineral, stone").
- **Today:** the ask hands each candidate with its bank name, and for an unnamed pair that name is the tags; the law takes any non-empty name.
- **Decided, common sense or an existing ruling (Pedro may overrule):** the law refuses a name that is the tag list. The ask leaves an unnamed candidate nameless for the model to name.

**Q48. A keeper tells the person to come to the counter they stand at. Should the ask say where the person stands?**
- **Met:** the door, Aurelio Quint at the Land Office, asked what a workshop costs: "I don't hand out prices across a plaza. Come to my counter and we'll talk."
- **Today:** the keeper prompt says work is "done at their counter and paid for there" and never says the person is already there (`server/intelligence/prompts.ts`, C2's wording).
- **Decided, common sense or an existing ruling (Pedro may overrule):** yes, the ask says where the person stands.

**Q49. Should Kami's persona law refuse "player"?**
- **Met:** the door, the third avatar's arrival at New Carleon: Haiku's persona says "he has grown weary of players who ask him to explain his luck."
- **Today:** the persona goes into Kami's system text for everyone in the hub. `KamiPersona.judge` refuses only archetype, trope and isekai; the talk prompts forbid "game" and "player".
- **Decided, common sense or an existing ruling (Pedro may overrule):** yes, Kami's persona law refuses "player" and "game", as the talk prompts already do.

**Q50. Is the person meant to see real money for a talk?**
- **Met:** the door, the TALK and BARGAIN windows: "This talk has cost $0.0012."
- **Today:** the cost is shown in dollars. D55's charged use is undecided.
- **Pedro's, a real design call.** Charged use is undecided (D55): does a person see what a talk costs, and in what money?
