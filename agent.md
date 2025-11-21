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