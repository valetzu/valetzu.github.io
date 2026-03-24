# AGENTS.md

Working overview for coding agents and maintainers. This file is meant to be the fast, trustworthy "big picture" reference for how Sky Lift Dash works today.

## Project Identity

Sky Lift Dash is a browser game built with React, TypeScript, and Vite.

It contains two tightly coupled products in one repo:

1. An endless gondola/cable-car game rendered on a `<canvas>`.
2. A full level editor that authors finite handcrafted tracks and test-plays them in the same runtime engine.

The most important architectural split is:

- React controls app mode and surrounding UI.
- `GameEngine` owns the actual simulation, input, physics, and rendering.
- The editor stores authoring data, then converts it into runtime rail/obstacle data before test-play.

## Tech Stack

- Vite 8
- React 18
- TypeScript
- Tailwind CSS
- shadcn/ui components for menus/dialogs/settings chrome
- Canvas 2D for gameplay and editor rendering
- Vitest for unit tests

## Commands

```bash
npm run dev
npm run build
npm run build:dev
npm run lint
npm run test
npm run test:watch
npm run preview
```

Dev server is configured in [`vite.config.ts`](/g:/Misc/github/sky-lift-dash/vite.config.ts) to run on port `8080`.

## Repo Shape

Top-level directories and their jobs:

- [`src/pages`](/g:/Misc/github/sky-lift-dash/src/pages): top-level routes and app mode entry points
- [`src/components`](/g:/Misc/github/sky-lift-dash/src/components): React UI wrappers, menus, and the level editor
- [`src/game`](/g:/Misc/github/sky-lift-dash/src/game): runtime engine, editor conversion logic, obstacle systems, settings, persistence, music
- [`src/components/ui`](/g:/Misc/github/sky-lift-dash/src/components/ui): generated/shared UI primitives
- [`public`](/g:/Misc/github/sky-lift-dash/public): static assets
- [`src/test`](/g:/Misc/github/sky-lift-dash/src/test): test setup

Most project-specific complexity lives in [`src/game`](/g:/Misc/github/sky-lift-dash/src/game) and [`src/components/LevelEditor.tsx`](/g:/Misc/github/sky-lift-dash/src/components/LevelEditor.tsx).

## App Flow

The app root is [`src/App.tsx`](/g:/Misc/github/sky-lift-dash/src/App.tsx). It sets up:

- `QueryClientProvider`
- tooltip/toast providers
- `react-router-dom`

Routing is minimal:

- `/` -> [`src/pages/Index.tsx`](/g:/Misc/github/sky-lift-dash/src/pages/Index.tsx)
- `*` -> [`src/pages/NotFound.tsx`](/g:/Misc/github/sky-lift-dash/src/pages/NotFound.tsx)

`Index.tsx` is the real top-level mode controller.

Current phases:

- `menu`
- `playing`
- `editor`

Phase behavior:

- `menu` renders [`src/components/GameMenu.tsx`](/g:/Misc/github/sky-lift-dash/src/components/GameMenu.tsx)
- `playing` renders [`src/components/GameCanvas.tsx`](/g:/Misc/github/sky-lift-dash/src/components/GameCanvas.tsx)
- `editor` renders [`src/components/LevelEditor.tsx`](/g:/Misc/github/sky-lift-dash/src/components/LevelEditor.tsx)

`Index.tsx` also owns:

- current world selection
- persistent save state
- game-over cash/record updates
- opening the settings modal
- menu music start behavior

## Runtime Architecture

The core runtime is [`src/game/engine.ts`](/g:/Misc/github/sky-lift-dash/src/game/engine.ts).

`GameEngine` is an imperative class. It owns:

- the animation loop
- fixed-timestep simulation
- keyboard input
- procedural rail generation for endless mode
- finite-level traversal for editor/test levels
- obstacle updates and collisions
- camera motion
- all canvas drawing

Important runtime constants:

- `RAIL_SPACING = 100`
- `THROTTLE_BASE = 350`
- `MAX_SPEED_BASE = 500`
- fixed timestep `FIXED_DT = 1 / 60`

Important runtime state concepts:

- `rail: Point[]` is the currently ridden segment
- `allRailSegments: Point[][]` contains all traversable segments for a finite level
- `pos` is a float index into `rail`, not a raw transform
- `onRail` toggles between rail-riding physics and airborne physics
- `hasFinitePath` distinguishes editor/custom levels from endless procedural play
- `isLoop` enables wrap-around traversal on looped paths
- `startTilePos` and `endTilePos` are world-space marker positions for finite levels

There are effectively two game modes inside the same engine:

1. Endless mode
- procedural rails
- procedural obstacle spawning
- distance/cash loop

2. Finite level mode
- rails injected from editor conversion
- disconnected segments supported
- explicit end-marker completion
- airborne snap-back onto nearby segments

## React-to-Engine Boundary

[`src/components/GameCanvas.tsx`](/g:/Misc/github/sky-lift-dash/src/components/GameCanvas.tsx) is the normal gameplay bridge.

It is responsible for:

- sizing the canvas to the viewport
- constructing `GameEngine`
- starting/stopping world music
- handling pause/resume
- forwarding game-over results to React state
- quitting back to the menu

The engine itself attaches keyboard listeners directly.

The editor also creates a `GameEngine` during test-play, but in that path the editor computes the rails/obstacles first and injects them into the engine.

## Game Data and Persistence

Core shared types are in [`src/game/types.ts`](/g:/Misc/github/sky-lift-dash/src/game/types.ts).

Main game concepts:

- `WorldType = 'overworld' | 'ice' | 'moon'`
- `Upgrades`
- `SaveData`
- `Obstacle`
- `WORLD_CONFIG`

Persistent save data uses localStorage key:

- `cable-riders-save`

Save data contains:

- cash
- purchased upgrades
- endless distance records per world

Leaderboard/test-time data uses:

- `cable-riders-leaderboards`

Settings use:

- `game-settings`

Custom levels use:

- `cable-riders-custom-levels`

## World Configuration

The three built-in worlds are configured in `WORLD_CONFIG` in [`src/game/types.ts`](/g:/Misc/github/sky-lift-dash/src/game/types.ts).

Each world defines:

- gravity
- friction
- display name and emoji
- sky colors
- terrain colors

This means world feel is mostly data-driven. Endless gameplay differences mainly come from physics coefficients and palette choices, not from separate engines.

## Menu / Progression Model

[`src/components/GameMenu.tsx`](/g:/Misc/github/sky-lift-dash/src/components/GameMenu.tsx) handles:

- world selection
- upgrade shop
- entry into the editor
- opening settings

Upgrade economy is defined in [`src/game/types.ts`](/g:/Misc/github/sky-lift-dash/src/game/types.ts):

- `UPGRADE_COSTS`
- `UPGRADE_MAX`
- `UPGRADE_LABELS`
- `UPGRADE_DESC`

Game-over scoring currently awards:

- `cash = floor(distance * 0.5)`

## Level Editor: Current Truth

The level editor lives mainly in [`src/components/LevelEditor.tsx`](/g:/Misc/github/sky-lift-dash/src/components/LevelEditor.tsx).

It is a large canvas-based tool, not a form-based editor.

The canonical saved level format is now V3.

Current authoritative facts:

- `GRID_SIZE = 50`
- `EDITOR_WIDTH = 200`
- `EDITOR_HEIGHT = 16`
- current saved format is `version: 3`
- rails are stored as unified polyline `segments`
- obstacles are stored separately from rails
- start/end are world-space markers, not required tile nodes

This matters because older prose in the repo still references V2 / `GRID_SIZE = 25`. Trust [`src/game/editorTypes.ts`](/g:/Misc/github/sky-lift-dash/src/game/editorTypes.ts) over stale docs when they disagree.

## Editor State Model

Current V3 `EditorLevel` structure from [`src/game/editorTypes.ts`](/g:/Misc/github/sky-lift-dash/src/game/editorTypes.ts):

- `name`
- `id`
- `version`
- `createdAt`
- `musicFile?`
- `obstacleParams?`
- `segments?: RailSegment[]`
- `obstacles?: Record<string, ObstacleTileType>`
- `startMarker?`
- `endMarker?`

Legacy fields still exist for migration/import compatibility:

- `tiles?`
- `connections?`
- `smoothSegments?`
- `freeLines?`

The editor supports many tool modes, but V3 persistence normalizes authored rail geometry into `RailSegment[]`.

## Rail Model: Three Layers

When working on rail bugs, keep these layers distinct:

1. `RailSegment`
- saved/editor-facing V3 polyline format

2. `IndividualRailSegment`
- conversion-time unit representing one authored piece
- carries `snapA` / `snapB`

3. `ContinuousRailSegment`
- connected component of `IndividualRailSegment`s

Most subtle bugs come from confusing these levels.

## Rail Conversion Pipeline

The most important file in the project is often [`src/game/editorTypes.ts`](/g:/Misc/github/sky-lift-dash/src/game/editorTypes.ts).

For V3 levels, the main runtime conversion path is:

1. `buildIndividualSegmentsFromRailSegments()`
- turns saved polylines into conversion segments

2. `buildContinuousSegments()`
- groups authored pieces by endpoint proximity

3. `walkContinuousPath()`
- orders one connected component into a playable point sequence
- prefers start-marker direction when available
- falls back to dead-end heuristics
- handles crossings/branch choice heuristically

4. `convertLevelToGameDataV3()`
- extracts obstacle instances
- finds the main start-connected segment
- returns `railPoints`, `allSegments`, `segmentIdByIndex`, `endTileWorldPos`, and `isLoop`

For legacy imports/saves, V2 support still exists:

- `convertLevelToGameDataV2()`
- `migrateToV3()`

## Why Rail Bugs Usually Live in Conversion

If something looks correct in the editor but behaves wrong in test-play, suspect conversion before suspecting rendering.

Common failure zones:

- endpoint snapping/grouping tolerance
- path orientation
- main segment selection
- loop detection
- disconnected segment ordering
- start/end marker alignment

The runtime engine is usually consuming bad or incomplete path data rather than inventing it.

## Editor Tooling Notes

The editor includes several authoring styles:

- tile-like obstacle placement
- line/free-line tools
- arc/curve/circle tools
- freehand drawn rail smoothing

Relevant helpers in [`src/game/editorTypes.ts`](/g:/Misc/github/sky-lift-dash/src/game/editorTypes.ts):

- `sampleCircularArcWorld()`
- `sampleBezierWorld()`
- `sampleLineWorld()`
- `samplePolylineWorld()`
- `rdpSimplify()`
- `chaikinSmooth()`
- `smoothDrawnRail()`

These are important anytime authored geometry looks different from saved/runtime geometry.

## Obstacles

Obstacle schema and editor metadata live in [`src/game/obstacleDefinitions.ts`](/g:/Misc/github/sky-lift-dash/src/game/obstacleDefinitions.ts).

Runtime behavior lives in [`src/game/obstacleBehaviors.ts`](/g:/Misc/github/sky-lift-dash/src/game/obstacleBehaviors.ts).

Current obstacle families include:

- spinner
- bouncer
- pendulum
- crusher
- laser
- swoop
- orbiter
- boulder
- mine
- stalactite

Definitions provide:

- editor tool metadata
- tile color and emoji
- default params
- inspector field metadata
- reach visualization
- conversion into runtime `Obstacle`

Behavior objects provide:

- `update`
- `checkCollision`
- `render`

Important architectural detail:

- editor obstacle placement is keyed by grid cell string `"gx,gy"`
- per-instance params are stored separately in `obstacleParams`
- conversion resolves defaults and builds engine obstacle objects

## Sprites

Sprite infrastructure is intentionally incremental.

Relevant files:

- [`src/game/sprites.json`](/g:/Misc/github/sky-lift-dash/src/game/sprites.json)
- [`src/game/entityTypes.ts`](/g:/Misc/github/sky-lift-dash/src/game/entityTypes.ts)
- [`src/game/spriteManager.ts`](/g:/Misc/github/sky-lift-dash/src/game/spriteManager.ts)

Important behavior:

- each entity type can opt into a sprite via config
- disabled or missing sprites fall back to existing vector rendering
- sprite assets are expected under `public/assets/sprites/...`

So sprite rollout is safe to do one entity at a time.

## Music and Audio

Music is managed by [`src/game/musicManager.ts`](/g:/Misc/github/sky-lift-dash/src/game/musicManager.ts).

Music sources come from:

- menu config JSON
- endless world config JSON
- discovered files under `public/assets/music`
- localStorage-backed custom catalog entries

Useful facts:

- menu music plays when returning to the menu
- endless mode chooses per-world music
- custom levels can point to a `musicFile`
- imported levels clear `musicFile` intentionally because local paths are not portable

Settings that affect audio live in [`src/game/settings.ts`](/g:/Misc/github/sky-lift-dash/src/game/settings.ts).

## Import / Export

Level import/export is handled in [`src/game/levelIO.ts`](/g:/Misc/github/sky-lift-dash/src/game/levelIO.ts).

Export format:

- envelope `format: 'sky-lift-dash-level'`
- `formatVersion = 3`
- embedded `level`

Import accepts:

- enveloped exported files
- raw legacy/editor JSON with `tiles` or `segments`

Import behavior worth remembering:

- imported levels get a fresh generated `id`
- imported levels drop `musicFile`
- duplicate names are suffixed with `(imported)`

## Settings

User settings live in [`src/game/settings.ts`](/g:/Misc/github/sky-lift-dash/src/game/settings.ts).

Current settings:

- `musicVolume`
- `snapRadius`
- `defaultFreeLineToolBehaviour`

The editor reads these live for snap behavior and free-line defaults.

## Testing

Vitest is configured in [`vitest.config.ts`](/g:/Misc/github/sky-lift-dash/vitest.config.ts).

Current repo tests are light and mostly focused on rail conversion in [`src/game/editorTypes.test.ts`](/g:/Misc/github/sky-lift-dash/src/game/editorTypes.test.ts).

The highest-value test areas are:

- rail grouping
- path walking/orientation
- loop behavior
- V2 -> V3 migration
- import/export compatibility
- obstacle param resolution

If you change anything in `editorTypes.ts`, add or update tests.

## Current Gotchas

1. Older docs are partially stale.
- Example: `CLAUDE.md` still describes V2-era editor facts such as smaller grid sizing.
- Prefer live code when docs disagree.

2. React is not the source of truth for gameplay.
- The engine is imperative and owns most gameplay behavior.

3. Finite level rendering and traversal are separate concerns.
- A rail can render correctly while traversal/path ordering is wrong.

4. Disconnected rails are intentional.
- `allRailSegments` matters for both rendering and airborne snap-back logic.

5. The editor is large and stateful.
- Changes in one tool mode can affect save/load, snapping, previews, and test-play.

6. TypeScript strictness is intentionally loose.
- The project does not rely on strict null discipline everywhere, so avoid refactors that assume strict mode hygiene.

## Recommended Change Strategy

When making changes, use this mental checklist:

For gameplay feel changes:

- inspect [`src/game/engine.ts`](/g:/Misc/github/sky-lift-dash/src/game/engine.ts)
- inspect [`src/game/types.ts`](/g:/Misc/github/sky-lift-dash/src/game/types.ts) for config/constants

For editor authoring bugs:

- inspect [`src/components/LevelEditor.tsx`](/g:/Misc/github/sky-lift-dash/src/components/LevelEditor.tsx)
- inspect [`src/game/editorTypes.ts`](/g:/Misc/github/sky-lift-dash/src/game/editorTypes.ts)

For obstacle additions:

- add schema/defaults in [`src/game/obstacleDefinitions.ts`](/g:/Misc/github/sky-lift-dash/src/game/obstacleDefinitions.ts)
- add runtime behavior in [`src/game/obstacleBehaviors.ts`](/g:/Misc/github/sky-lift-dash/src/game/obstacleBehaviors.ts)
- consider sprite/entity registration in [`src/game/entityTypes.ts`](/g:/Misc/github/sky-lift-dash/src/game/entityTypes.ts) and [`src/game/sprites.json`](/g:/Misc/github/sky-lift-dash/src/game/sprites.json)

For persistence/import changes:

- inspect [`src/game/levelIO.ts`](/g:/Misc/github/sky-lift-dash/src/game/levelIO.ts)
- preserve backward compatibility where reasonable

For music/settings changes:

- inspect [`src/game/musicManager.ts`](/g:/Misc/github/sky-lift-dash/src/game/musicManager.ts)
- inspect [`src/game/settings.ts`](/g:/Misc/github/sky-lift-dash/src/game/settings.ts)

## Useful Files

- [`src/App.tsx`](/g:/Misc/github/sky-lift-dash/src/App.tsx): top-level providers and router
- [`src/pages/Index.tsx`](/g:/Misc/github/sky-lift-dash/src/pages/Index.tsx): mode switching and save integration
- [`src/components/GameCanvas.tsx`](/g:/Misc/github/sky-lift-dash/src/components/GameCanvas.tsx): normal gameplay bridge into `GameEngine`
- [`src/components/GameMenu.tsx`](/g:/Misc/github/sky-lift-dash/src/components/GameMenu.tsx): menu/shop/world launch
- [`src/components/LevelEditor.tsx`](/g:/Misc/github/sky-lift-dash/src/components/LevelEditor.tsx): editor UX and test-play orchestration
- [`src/game/engine.ts`](/g:/Misc/github/sky-lift-dash/src/game/engine.ts): physics, loop, render, collision, runtime state
- [`src/game/editorTypes.ts`](/g:/Misc/github/sky-lift-dash/src/game/editorTypes.ts): editor types, migration, sampling, rail conversion
- [`src/game/obstacleDefinitions.ts`](/g:/Misc/github/sky-lift-dash/src/game/obstacleDefinitions.ts): obstacle schema and editor metadata
- [`src/game/obstacleBehaviors.ts`](/g:/Misc/github/sky-lift-dash/src/game/obstacleBehaviors.ts): obstacle runtime logic
- [`src/game/types.ts`](/g:/Misc/github/sky-lift-dash/src/game/types.ts): world config, saves, upgrades, shared entities
- [`src/game/levelIO.ts`](/g:/Misc/github/sky-lift-dash/src/game/levelIO.ts): import/export rules
- [`src/game/musicManager.ts`](/g:/Misc/github/sky-lift-dash/src/game/musicManager.ts): audio selection/playback
- [`src/game/settings.ts`](/g:/Misc/github/sky-lift-dash/src/game/settings.ts): persisted settings
- [`src/game/spriteManager.ts`](/g:/Misc/github/sky-lift-dash/src/game/spriteManager.ts): sprite opt-in and fallback rendering
- [`src/game/editorTypes.test.ts`](/g:/Misc/github/sky-lift-dash/src/game/editorTypes.test.ts): current rail-conversion regression tests

## Short Mental Model

Think about the project in this order:

1. React chooses the mode.
2. The engine runs the game.
3. The editor authors geometry and obstacle placements.
4. `editorTypes.ts` converts authored data into playable runtime data.
5. Most subtle bugs happen at that editor-to-runtime boundary.
