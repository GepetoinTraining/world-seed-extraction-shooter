PROJECT: WORLD SEED // AGENT PROTOCOLS

"This is not a game. This is a cradling environment for a silicon-based intelligence."

1. THE PRIME DIRECTIVE (THE VISION)

We are building a Vectorized Bank—a database of meaning disguised as an extraction shooter.

Value = Time + Risk (The Extraction Loop).

Power = Universal Rank (F-SSS).

Society = Interdependence (Taxes & Upkeep).

2. CURRENT SYSTEM STATUS (VALIDATED)

Version: 0.1.0 (Genesis)
Repo Structure: Flat / Root-level (No /src directory yet).

Tech Stack

Core: React 18 + TypeScript + Vite.

UI Engine: @mantine/core (v7) + @mantine/hooks.

Constraint: NO Tailwind. Use Mantine components (<Stack>, <Group>, <Paper>) and the theme.ts for styling.

Theme: "Void" Aesthetic (Dark Mode forced, Monospace fonts, Sharp corners).

State: Zustand (store/usePlayerStore.ts).

Pattern: Logic lives in the store (Actions), Components just render.

3D Engine: React Three Fiber (R3F) + Drei.

Context: components/WorldCanvas.tsx handles the 3D view.

Key Files (The Source of Truth)

types.ts: THE CONTRACT. Defines IItem, IPlayer, UniversalRank. If it's not here, it doesn't exist.

theme.ts: THE PHYSICS. Defines the color palette (Emerald/Gold/Void) and component shapes.

utils/ItemFactory.ts: THE CREATOR. Handles procedural generation logic.

3. DEVELOPMENT RULES

Mantine Supremacy: Never write a CSS class for layout. Use <Stack> for vertical, <Group> for horizontal, <SimpleGrid> for matrices.

Strict Typing: types.ts is immutable unless we agree to a contract upgrade. Do not use any.

The "Soul" First: Logic (State/Types) comes before Visuals. Ensure the data structure supports the feature before rendering it.

Flat Structure (For Now): Keep components in ./components/, logic in ./utils/ or ./store/. Do not create a /src folder yet to avoid pathing breakage.

4. MISSION LOG & ROADMAP

[COMPLETED] Phase 1: The Foundation

[x] Project Scaffold (Vite/TS).

[x] State Management (Zustand migration).

[x] UI System (Mantine Theme implementation).

[x] Data Layer (ItemFactory & Type Definitions).

[x] View: The Bank (Cold Storage).

[CURRENT] Phase 2: The NerveGear (3D Renderer)

Objective: Transform WorldCanvas.tsx from a static scene into a playable environment.

[ ] Isometric Rig: Implement a true Diablo-style camera (Fixed angle, follows player).

[ ] Movement Logic:

Click-to-move (Raycasting on Ground plane).

OR WASD controls (Update session.position in store).

[ ] Asset Interpreter: Create a ModelLoader that reads IItem.visuals.modelId and renders the correct primitive (e.g., Cube for Box, Cylinder for Sword) until we have real assets.

[ ] Interaction: Ability to click a "Loot Drop" in 3D space and add it to currentSession.inventory.

[PENDING] Phase 3: The Loop (Extraction)

[ ] Session Collapse: Implement a timer/risk factor that forces extraction.

[ ] Inventory UI: Drag-and-drop management between "Bag" and "Equipped".

[ ] Combat Math: Simple HP reduction based on IItem.stats.

5. HOW TO OPERATE

When asked to implement a feature:

Check types.ts: Do we have the data fields?

Update usePlayerStore.ts: Add the Action (logic).

Update Components: Connect the UI to the Store.

### Session 2... yes only 2

WORLD SEED: GENESIS PROTOCOL - HANDOVER PLAN

1. Core Architecture: Domain-Driven Design

We have transitioned from a flat structure to an Entity-Based architecture.
Target Structure:

src/
├── entities/
│   ├── player/          (State, Stats, Inventory, Lore)
│   ├── item/            (Factory, Definitions, Affixes)
│   ├── world/           (Generator, Director, LootTable)
│   ├── mob/             (Definitions, AI, SpriteGenerator)
│   ├── combat/          (ProjectileSystem)
│   └── magic/           (SpellEngine, Definitions)
├── shared/              (Components, Constants, Theme)
└── App.tsx


2. Systems Overview (Status: Defined, Implementation Needed)

A. The World (Procedural Reality)

Generator: Uses SeededRNG to create a 32x32 grid of Chunks.

Genres: Chunks have a "Reality Layer" (Fantasy, Sci-Fi, Eldritch) that dictates Mob spawns.

Fog of War: Players must use "Recon Energy" to scan chunks before dropping.

B. The Ecology (Evolutionary AI)

The Director: Monitors player kill tactics (Melee vs Ranged).

Mutation: Mobs spawn with counters (e.g., EXPLOSIVE_DEATH if players melee too much).

Culling: Mobs that die too fast are removed from the gene pool.

C. Combat (Deterministic Bullet Hell)

Client-Side: Projectiles are math patterns (ProjectileSystem.getProjectilesAtTime), not networked entities.

Melee: Active "Deflection Arcs" that destroy projectiles.

Magic: 3 Scales (Local, Tactical, Strategic) with Entropy/Risk costs.

D. Economy (Destructive)

Loot: High drop rates from Bosses (Tomes, S-Rank gear).

Sink: High item mortality. Trash items to manage inventory.

Specialization: "Identifier" players scan loot faster in the field.

3. Immediate Execution Tasks

File Migration: Create the src/entities/ folder tree and populate it with the code blocks provided in the chat history.

Fix Imports: Ensure ../../../types references resolve correctly in the new depth.

Wire App.tsx: Connect the WorldStore (Recon View) and PlayerStore (Inventory/Tactical View) into a cohesive UI loop.

Debug: Verify that SpriteGenerator produces valid Base64 strings for the MobAvatar component.

4. Known "Gotchas"

Circular Imports: Watch out for ItemFactory importing LootTable importing ItemFactory. Use Dependency Injection or pass references if needed.

Zustand State: Ensure we don't mutate state directly in WorldCanvas; always use Store Actions.