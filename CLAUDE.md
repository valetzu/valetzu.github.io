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

`src/pages/Index.tsx` is the root controller. It manages the top-level `phase` state: `'menu'` → `'game'` → `'editor'`. All major UI components are rendered here conditionally.

### Game Engine (`src/game/engine.ts`)

`GameEngine` is a class (not React) that owns the entire game loop. It is instantiated from `GameCanvas.tsx` and runs imperatively on a `<canvas>`.

Key design decisions:
- `RAIL_SPACING = 100` — world-space distance between sampled rail points
- The player position is a float index (`pos`) into `this.rail[]` (array of `{x, y}` world points)
- Two modes: **infinite procedural** (main game) and **finite editor-level** (`hasFinitePath = true`)
- Airborne mode (`onRail = false`) activates when the player leaves the rail, with gravity + rotation physics
- `allRailSegments` holds all disconnected rail segments (for rendering and snap-back); `this.rail` is the segment the player currently rides

### Level Editor (`src/components/LevelEditor.tsx` + `src/game/editorTypes.ts`)

The editor is a canvas-based tool separate from the game engine. It stores level data as:

- `tiles: Record<string, TileType>` — grid cells keyed by `"gx,gy"`
- `railConnectionsRef` — explicit connection graph (`Map<string, Set<string>>`), max 2 connections per tile
- `smoothSegments: SmoothSegment[]` — circular arcs or bezier curves between tile endpoints (bypass tile grid for smooth curves)
- `freeLines: FreeLineSegment[]` — world-space line extensions that attach to rail segment endpoints
- `circles: CircleMeta[]` — Circle tool metadata for true circular rail sampling
- `GRID_SIZE = 25` (halved from 50, current version is v2; saved levels have `version: 2`)

**Level conversion pipeline** (`convertLevelToGameData` in `editorTypes.ts`):
1. Build rail connection graph from tiles
2. Walk connected components from `rail_start` tile
3. Apply `circleOverrides` from `CircleMeta` (mathematically circular world positions)
4. Expand `SmoothSegment` curves into dense world points
5. Apply `FreeLineSegment` extensions in order, merging target segments
6. Return `railPoints` (main path), `allSegments`, `endSegmentIndex`, `endPointIndex`

### Sprite System (`src/game/spriteManager.ts` + `src/game/sprites.json`)

`spriteManager` is a singleton. Each entity type in `sprites.json` has an `enabled` flag (all `false` by default). When `enabled: false`, `drawSpriteOrFallback()` returns `false` and the caller uses existing canvas drawing. When `enabled: true`, the sprite image is loaded from `public/assets/sprites/<sprite path>`.

To activate a sprite: set `"enabled": true` in `sprites.json` and place the image at `public/assets/sprites/<path>`.

### Entity Type System (`src/game/entityTypes.ts`)

`EntityTypeId` strings (e.g. `"obstacle.spinner"`, `"player.gondola"`, `"rail.startTile"`) are the keys used in `sprites.json` and passed to `spriteManager`. `Obstacle` objects in `types.ts` carry `id` and `typeId` fields.

### Save / Persistence

- **Game saves**: `localStorage` via `loadSave()` / `saveSave()` in `types.ts`
- **Custom levels**: `localStorage` key `customLevels` — array of `EditorLevel` objects serialized as JSON
- **Level version**: `EditorLevel.version === 2` means `GRID_SIZE = 25`. On load, v1 levels are migrated (coordinates doubled).

## Key Constants

| Constant | Location | Value | Purpose |
|---|---|---|---|
| `GRID_SIZE` | `editorTypes.ts` | 25 | Editor tile size in world pixels |
| `EDITOR_WIDTH` | `editorTypes.ts` | 200 | Editor grid width in cells |
| `EDITOR_HEIGHT` | `editorTypes.ts` | 16 | Editor grid height in cells |
| `RAIL_SPACING` | `engine.ts` | 100 | World-space distance between rail points |

## TypeScript Notes

`tsconfig.json` has `noImplicitAny: false` and `strictNullChecks: false`. Null checks are lenient throughout the codebase — do not add strict null guards unless they fix actual bugs.
