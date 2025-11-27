Hey gemini, how are you this morning! hope you`re doing fine! we're now going to hook up this mock data project to an actual running database. Our end goal vision is to use a vector db to serve as the principle engine for generating an extraction battle and use a relational DB for the hub and character loading... I believe that to make this happen we'll need to do a few things



1. Create the cert generation and reading system to make character progression true.

2. Crete the Hub/World cert generation to sign the ledger and create our source of truth.

3. create a service that generates the JSON we'll load as an extraction battle.

a. We need the other entities to populate the JSON:

I. Extractables(natural resources)

i. Fauna related (e.g.: grassy seeds (grains), Shrubs (berries...), Fruit (all kinds of food bearing and poison bearing fruits), Trees (logs and sapplings).

ii. Mineral related (mining, colecting sand (glass and others), collecting rocks and pebbles (smaller portion of a rock that is minable).

ii. Geographical features (Texture and where these above elements are placed)

iii. Ruins and buildings that are containers for mobs, loot chests and Lore.

iv. npc entity (a character like randomly rolled sheet that needs to be extracted through a social interaction.)

b. we need to create the weight mechaninc, making the inventory weight a reality, this needs 2 different vectors of action, size of objects (inventory tetris) and weight of objects (density of material and ammount to carry).

4. Test a game out. (we need to fix the movement speed in game... my character is flying around the chunks)

5. Do this list again to implement next wave.