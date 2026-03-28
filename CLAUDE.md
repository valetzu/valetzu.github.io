# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Always be critical to suggestions and ask clarifying questions. Think whether the approach makes sense and is consistent.
## Commands

```bash
npm run dev          # Start dev server (port 8080)
npm run build        # Production build
npm run build:dev    # Dev build with source maps
npm run lint         # ESLint
npm run test         # Run tests once
npm run test:watch   # Tests in watch mode
npm run preview      # Preview production build
```

## Architecture Overview

This is a **gondola/cable-car physics game** built with React + TypeScript + Vite. The player rides a gondola along rails, controlling speed and tilt, across three worlds with different physics.

### Phase Management

`src/pages/Index.tsx` is the root controller. It manages the top-level `phase` state: `'menu' | 'playing' | 'editor' | 'customPlay'`. All major UI components are rendered here conditionally.

### Game Engine (`src/game/engine.ts`)

`GameEngine` is a class (not React) that owns the entire game loop. It is instantiated from `GameCanvas.tsx` (endless mode) or `CustomLevelPlayer.tsx` (custom levels) and runs imperatively on a `<canvas>`.

Key design decisions:
- `RAIL_SPACING = 100` — world-space distance between sampled rail points
- The player position is a float index (`pos`) into `this.rail[]` (array of `{x, y}` world points)
- Two modes: **infinite procedural** (main game) and **finite editor-level** (`hasFinitePath = true`)
- Airborne mode (`onRail = false`) activates when the player leaves the rail, with gravity + rotation physics
- `allRailSegments` holds all disconnected rail segments (for rendering and snap-back); `this.rail` is the segment the player currently rides
- Fixed timestep physics at 60Hz with accumulator pattern and render interpolation
- `noBackground = true` disables mountains, clouds, and ground polygon rendering (used by custom levels)
- `skyOverride` overrides world config sky gradient colors (used by custom levels for sky themes)
- `bgTiles` renders colored decoration tiles behind gameplay elements

### Level Editor (`src/components/LevelEditor.tsx` + `src/game/editorTypes.ts`)

The editor is a canvas-based tool separate from the game engine. It stores level data as unified polyline segments (V3 format):

- `segments: RailSegment[]` — polyline rail segments (each is an array of world-space points)
- `obstacles: Record<"gx,gy", ObstacleTileType>` — obstacle placements on grid
- `obstacleParams: Record<"gx,gy", ObstacleParams>` — per-obstacle parameter overrides
- `startMarker / endMarker` — world-space start/end positions
- `stars: Record<"gx,gy", "star">` — collectible star placements (max 3)
- `bgTiles: Record<"gx,gy", BgTile>` — background decoration tiles
- `skyTheme: SkyThemeId` — sky gradient theme ('day', 'dusk', 'night', 'dawn')
- `GRID_SIZE = 50` (current version is v3; legacy v2 levels are auto-migrated)

**Editor tools include:** rail placement, start/end markers, crossings, 10 obstacle types, arc/bezier/loop/line/freehand drawing tools, star placement, paint tool (background tiles), and eraser.

**Level conversion pipeline** (`convertLevelToGameDataV3` in `editorTypes.ts`):
1. Build individual segments from `RailSegment[]`
2. Group into continuous segments by snap-point proximity
3. Walk continuous paths from start marker, handling crossings
4. Subdivide sharp corners and resample to uniform spacing
5. Return `railPoints`, `allSegments`, obstacles, stars, endTileWorldPos, isLoop

### Sky Themes

Custom levels use sky themes instead of world-specific backgrounds. Four presets defined in `SKY_THEMES`:
- `day` (default): blue sky (#4BA3E3 → #87CEEB)
- `dusk`: sunset (#2C1654 → #E8735A)
- `night`: dark (#0A0A2E → #1A1A4E)
- `dawn`: warm (#1A1A4E → #FFB366)

### Background Tiles

Purely visual decoration tiles placed with the paint tool. 18-color palette (`BG_PALETTE`), optional outline with configurable color. Variable brush size (1/2/3/5 tiles). Rendered after sky but before rail in the engine pipeline.

### Obstacle System (`src/game/obstacleDefinitions.ts` + `src/game/obstacleBehaviors.ts`)

10 obstacle types, each with:
- `ObstacleDefinition`: metadata, default params, param field descriptors, reach zone geometry, `toGameObstacle()` factory
- `ObstacleBehavior`: `update()`, `checkCollision()`, `render()` methods
- Types: spinner, bouncer, pendulum, crusher, laser, swoop, orbiter, boulder, mine, stalactite

Collision uses 4 probes on the gondola (cabin center, left/right edges, cable midpoint) checked against per-obstacle collision shapes.

### Ghost Replay System (`src/game/replay.ts`)

Records player state at 15Hz (every 4th physics tick) as 14-byte binary frames (x, y as float32, angles as int16, passengers and flags as uint8). Base64-encoded for JSON/localStorage storage. Features:
- `GhostRecorder` — captures frames during gameplay
- `GhostPlayer` — interpolated playback synced to elapsed time
- `computeLevelHash()` — FNV-1a hash of level geometry for stale replay detection
- Named replays with "Personal Best" auto-overwrite logic

### Sprite System (`src/game/spriteManager.ts` + `src/game/sprites.json`)

`spriteManager` is a singleton. Each entity type in `sprites.json` has an `enabled` flag (all `false` by default). When `enabled: false`, `drawSpriteOrFallback()` returns `false` and the caller uses existing canvas drawing. When `enabled: true`, the sprite image is loaded from `public/assets/sprites/<sprite path>`.

### Entity Type System (`src/game/entityTypes.ts`)

`EntityTypeId` strings (e.g. `"obstacle.spinner"`, `"player.gondola"`, `"rail.startTile"`) are the keys used in `sprites.json` and passed to `spriteManager`. `Obstacle` objects in `types.ts` carry `id` and `typeId` fields.

### Save / Persistence

- **Game saves**: `localStorage` key `cable-riders-save` — cash, upgrades, world records
- **Custom levels**: `localStorage` key `cable-riders-custom-levels` — array of `EditorLevel` objects
- **Leaderboards**: `localStorage` key `cable-riders-leaderboards` — top 5 times per level
- **Replays**: `localStorage` key `cable-riders-replays` — ghost replay data per level
- **Settings**: `localStorage` key `game-settings` — music volume, snap radius, tool behavior
- **Music catalog**: `localStorage` key `music-catalog-custom` — custom track labels
- **Level format**: `EditorLevel.version === 3` is current. V2/V1 levels are auto-migrated via `migrateToV3()`.

### Music System (`src/game/musicManager.ts`)

Singleton `musicManager` handles audio playback. Discovers MP3 files via Vite's `import.meta.glob`. Supports JSON-configured playlists for menus, endless mode, and custom levels. 23 music tracks in `public/assets/music/`.

## Key Constants

| Constant | Location | Value | Purpose |
|---|---|---|---|
| `GRID_SIZE` | `editorTypes.ts` | 50 | Editor tile size in world pixels |
| `EDITOR_WIDTH` | `editorTypes.ts` | 200 | Editor grid width in cells |
| `EDITOR_HEIGHT` | `editorTypes.ts` | 16 | Editor grid height in cells |
| `RAIL_SPACING` | `engine.ts` | 100 | World-space distance between rail points (endless mode) |
| `THROTTLE_BASE` | `engine.ts` | 350 | Base throttle force |
| `MAX_SPEED_BASE` | `engine.ts` | 500 | Base max speed |
| `GONDOLA_HANG` | `engine.ts` | 38 | Cable length from wheel to cabin center |
| `CABIN_W / CABIN_H` | `engine.ts` | 56 / 36 | Cabin dimensions |
| `WHEEL_RADIUS` | `engine.ts` | 7 | Wheel visual radius |
| `ROLLING_INERTIA_FACTOR` | `engine.ts` | 1.5 | Effective mass multiplier for rolling |
| `PENDULUM_DAMPING` | `engine.ts` | 4.5 | Angular velocity damping |
| `PENDULUM_PLAYER_TORQUE` | `engine.ts` | 15 | Player tilt torque on-rail (rad/s^2) |
| `AIRBORNE_PLAYER_TORQUE` | `engine.ts` | 25 | Player rotation torque airborne (rad/s^2) |
| `PENDULUM_MASS_RATIO` | `engine.ts` | 0.15 | Cabin reaction force ratio on wheel |
| `FIXED_DT` | `engine.ts` | 1/60 | Physics timestep |
| `END_TRIGGER_RADIUS` | `engine.ts` | 60 | Level completion proximity check |

## TypeScript Notes

`tsconfig.json` has `noImplicitAny: false` and `strictNullChecks: false`. Null checks are lenient throughout the codebase — do not add strict null guards unless they fix actual bugs.
