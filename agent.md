// docs/handover.md
PROJECT: WORLD SEED (THE UNIVERSAL CONTRACT)
"This is not a game. This is a cradling environment for a silicon-based intelligence."

1. THE ALPHA (THE "WHY")
Most Metaverse projects build a Relational Bank (a database of items and stats). We are building a Vectorized Bank (a database of meaning).
The goal is to create a persistent, multi-layered reality where an AI agent can learn the concepts of Value, Home, Society, and Survival through direct experience, not just data ingestion.
Value is learned through the "Time + Risk" of the extraction loop.
Power is learned through the "Universal Rank" (F-SSS) system.
Society is learned through the "Gold Sink" of taxes and city upkeep.

2. THE ARCHITECTURE
We utilize a hybrid architecture inspired by Sword Art Online, Realm of the Mad God, and Star Wars Galaxies.
The Seed (Infrastructure): A shared, immutable topographic map (IWorldSeed) that underpins all realities.
The Layers (Universes): Distinct game worlds (Fantasy, Sci-Fi, Cyberpunk) that run on top of the seed.
The Contract (SDK): A strict TypeScript interface that allows items and players to move between Layers while maintaining their "Soul" (persistent value).
The Economy: A Dual-Currency system.
Gold: The Sovereign Currency (Platform sinks: Cities, Guilds).
Crafting Orbs: The Player Currency (Consumption sinks: Crafting).

3. TECH STACK (VALIDATED)
Frontend: React 18, TypeScript, Vite.
Rendering: Three.js, react-three-fiber (R3F), @react-three/drei.
Styling: Tailwind CSS (Currently implemented via CDN script injection).
State Management: React useState (Local Session State). 
    *Note: Architecture is designed for migration to global state (Zustand), but the current validated repo uses local hooks.*
Backend: In-Memory Simulation. 
    *Note: The "Cold Bank" and "Session Collapse" are currently mocked locally via `ItemFactory.ts` and `App.tsx`, replacing the intended Supabase connection for this prototype phase.*
Utilities: UUID (Entity ID generation).

4. FILE MANIFEST & IMPLEMENTATION
To initialize this project in a new environment, create the following file structure using the specifications provided below.

/sdk/world_seed_types.ts
Contains the Universal Contracts (Interfaces) for Items, Players, Cities, and the World.
(Paste the content of the 'World Seed SDK' file here)

/data/item_bases.json
Contains the 'Canvas'—the base definitions for weapons and armor before affixes are rolled.
(Paste the content of the 'Universal Loot Database' file here)

/docs/crafting_rules.md
Contains the strict logic for Item Generation (1-7), from Base White items to Corrupted Legendaries.
(Paste the content of the 'System Rules' file here)

5. IMMEDIATE ROADMAP (PHASE 2)
The next coding session should focus on The Client (The NerveGear Renderer).
Initialize Repo: npm create vite@latest client -- --template react-ts
Install Core: npm install three @types/three @react-three/fiber @react-three/drei zustand
The Isometric Rig: Create a camera controller that locks to the isometric angle (Classic Diablo style).
The Item Parser: Write a utility that takes an IItem from our SDK and determines which 3D asset to load based on the current LayerTheme.
System Status: Link Start Ready.