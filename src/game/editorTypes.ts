import {
  obstacleDefMap,
  resolveParams,
  ObstacleParams,
} from "./obstacleDefinitions";

export const GRID_SIZE = 50;
export const EDITOR_WIDTH = 200; // grid cells wide
export const EDITOR_HEIGHT = 16; // grid cells tall

export const SKY_THEMES = {
  day:   { name: 'Day',   skyTop: '#4BA3E3', skyBottom: '#87CEEB' },
  dusk:  { name: 'Dusk',  skyTop: '#2C1654', skyBottom: '#E8735A' },
  night: { name: 'Night', skyTop: '#0A0A2E', skyBottom: '#1A1A4E' },
  dawn:  { name: 'Dawn',  skyTop: '#1A1A4E', skyBottom: '#FFB366' },
} as const;

export type SkyThemeId = keyof typeof SKY_THEMES;

/** Background decoration tile — purely visual, no collision. */
export interface BgTile {
  color: string;
  outline?: boolean;
  outlineColor?: string;
}

/** Standard palette for background tiles. */
export const BG_PALETTE = [
  '#4CAF50', '#2E7D32', '#1B5E20',  // greens
  '#795548', '#5D4037', '#3E2723',  // browns
  '#607D8B', '#455A64', '#263238',  // grays
  '#F5F5F5', '#212121', '#000000',  // white/black
  '#F44336', '#FF9800', '#FFEB3B',  // warm
  '#2196F3', '#9C27B0', '#00BCD4',  // cool
] as const;

export type TileType =
  | "empty"
  | "rail"
  | "rail_start"
  | "rail_end"
  | "rail_crossing"
  | "spinner"
  | "bouncer"
  | "pendulum"
  | "crusher"
  | "laser"
  | "swoop"
  | "orbiter"
  | "boulder"
  | "mine"
  | "stalactite";

export type ObstacleTileType =
  | "spinner"
  | "bouncer"
  | "pendulum"
  | "crusher"
  | "laser"
  | "swoop"
  | "orbiter"
  | "boulder"
  | "mine"
  | "stalactite";

export function isRailTileType(t: string): boolean {
  return t === "rail" || t === "rail_start" || t === "rail_end" || t === "rail_crossing";
}

export function isObstacleTileType(t: string): t is ObstacleTileType {
  return obstacleDefMap.has(t);
}

export type EditorTool =
  | "none"
  | "rail"
  | "rail_start"
  | "rail_end"
  | "rail_crossing"
  | "spinner"
  | "bouncer"
  | "pendulum"
  | "crusher"
  | "laser"
  | "swoop"
  | "orbiter"
  | "boulder"
  | "mine"
  | "stalactite"
  | "star"
  | "eraser"
  | "arc"
  | "curve"
  | "loop"
  | "circular_curve"
  | "polygon"
  | "line"
  | "line2"
  | "draw_rail"
  | "paint";

export interface EditorTile {
  type: TileType;
}

/** Smooth segment between two rail tiles: rendered and played as a curve, not tile-stepped */
export interface SmoothSegment {
  type: "circular" | "bezier";
  startKey: string;
  endKey: string;
  pivotGx: number;
  pivotGy: number;
}

export interface FreeLineSegment {
  /** World-space start point of this free line */
  start: { x: number; y: number };
  end: { x: number; y: number };
  /** Drawn rail: smoothed polyline between start and end */
  waypoints?: { x: number; y: number }[];
  /** Drawn rail: original freehand points for re-smoothing */
  rawDrawnPoints?: { x: number; y: number }[];
  /** Drawn rail: smoothness slider value 0..1 */
  smoothness?: number;
}

/** A polyline rail segment — the unified storage format (v3). */
export interface RailSegment {
  points: { x: number; y: number }[];
  /** Drawn rail: original freehand points for re-smoothing */
  rawDrawnPoints?: { x: number; y: number }[];
  /** Drawn rail: smoothness slider value 0..1 */
  smoothness?: number;
}

// ─── Unified Rail Segment Model ──────────────────────────────────────────────

/** A single rail piece created by one tool action (tile chain, smooth curve, free line, or drawn rail). */
export interface IndividualRailSegment {
  id: string;
  kind: "tile_chain" | "smooth_curve" | "free_line" | "drawn_rail";
  points: { x: number; y: number }[];
  snapA: { x: number; y: number };
  snapB: { x: number; y: number };
  /** Tile keys this segment is built from (tile_chain & smooth_curve) */
  sourceKeys?: string[];
  /** Index into smoothSegments[] (smooth_curve only) */
  sourceSmoothIndex?: number;
  /** Index into freeLines[] (free_line & drawn_rail only) */
  sourceFreeLineIndex?: number;
}

/** A group of connected individual segments forming one continuous rail path. */
export interface ContinuousRailSegment {
  id: string;
  individualIds: string[];
}

export interface SnapPoint {
  segmentId: string;
  point: { x: number; y: number };
  endpoint: "A" | "B";
}

export interface LevelMeta {
  /** Display title — shown in-game; separate from the storage filename (`name`). */
  title?: string;
  /** Short description shown in level lists. */
  description?: string;
  /** Author nickname at time of save. */
  author?: string;
}

export interface EditorLevel {
  name: string;
  /** Stable unique identifier used for music folder paths and deduplication. */
  id: string;
  /** Level data version — 2 = legacy (tiles+connections), 3 = unified segments. */
  version?: number;
  createdAt: number;
  updatedAt?: number;
  /** Optional display metadata (title, description, author). */
  meta?: LevelMeta;
  /** Music filename relative to public/assets/music/customLevels/{id}/ */
  musicFile?: string;
  /** Sky gradient theme — defaults to 'day' when absent. */
  skyTheme?: SkyThemeId;
  /** Background decoration tiles keyed by "gx,gy". */
  bgTiles?: Record<string, BgTile>;
  /**
   * Per-tile obstacle parameters keyed by "gx,gy".
   * Absence of a key means use the obstacle type's defaultParams.
   */
  obstacleParams?: Record<string, ObstacleParams>;

  // ── V3 fields (unified polyline format) ───────────────────────────────────
  /** All rail segments as polylines (v3+) */
  segments?: RailSegment[];
  /** Grid-based obstacles only — "gx,gy" → obstacle type (v3+) */
  obstacles?: Record<string, ObstacleTileType>;
  /** World-space start marker position (v3+, replaces rail_start tile) */
  startMarker?: { x: number; y: number };
  /** World-space end marker position (v3+, replaces rail_end tile) */
  endMarker?: { x: number; y: number };
  /** Collectible stars keyed by "gx,gy" — max 3 per level (v3+) */
  stars?: Record<string, "star">;

  // ── Legacy V2 fields (kept for migration) ─────────────────────────────────
  /** @deprecated V2 — grid tiles (rails + obstacles). Use segments + obstacles in V3. */
  tiles?: Record<string, TileType>;
  /** @deprecated V2 — explicit rail connection graph. */
  connections?: Record<string, string[]>;
  /** @deprecated V2 — smooth arcs/curves between tiles. */
  smoothSegments?: SmoothSegment[];
  /** @deprecated V2 — world-space line extensions. */
  freeLines?: FreeLineSegment[];
}

/** Generate a short random level id that is stable across saves. */
export function generateLevelId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function tileKey(gx: number, gy: number): string {
  return `${gx},${gy}`;
}

export function parseTileKey(key: string): [number, number] {
  const [x, y] = key.split(",").map(Number);
  return [x, y];
}

export function keyToWorld(key: string): { x: number; y: number } {
  const [gx, gy] = parseTileKey(key);
  return { x: (gx + 0.5) * GRID_SIZE, y: (gy + 0.5) * GRID_SIZE };
}

/** Sample a circular arc in world space (start, end, pivot). Returns dense points along the arc. */
export function sampleCircularArcWorld(
  start: { x: number; y: number },
  end: { x: number; y: number },
  pivot: { x: number; y: number },
): { x: number; y: number }[] {
  const x1 = start.x,
    y1 = start.y;
  const x2 = end.x,
    y2 = end.y;
  const x3 = pivot.x,
    y3 = pivot.y;
  const d = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
  if (Math.abs(d) < 1e-6) {
    return [start, end];
  }
  const ux =
    ((x1 * x1 + y1 * y1) * (y2 - y3) +
      (x2 * x2 + y2 * y2) * (y3 - y1) +
      (x3 * x3 + y3 * y3) * (y1 - y2)) /
    d;
  const uy =
    ((x1 * x1 + y1 * y1) * (x3 - x2) +
      (x2 * x2 + y2 * y2) * (x1 - x3) +
      (x3 * x3 + y3 * y3) * (x2 - x1)) /
    d;
  const radius = Math.sqrt((x1 - ux) ** 2 + (y1 - uy) ** 2);
  if (!isFinite(radius) || radius < 1) return [start, end];
  const a1 = Math.atan2(y1 - uy, x1 - ux);
  const a2 = Math.atan2(y2 - uy, x2 - ux);
  const a3 = Math.atan2(y3 - uy, x3 - ux);
  const norm = (a: number) => {
    let r = a;
    const tau = Math.PI * 2;
    while (r < 0) r += tau;
    while (r >= tau) r -= tau;
    return r;
  };
  const A1 = norm(a1),
    A2 = norm(a2),
    A3 = norm(a3);
  const isBetweenCCW = (from: number, to: number, mid: number) => {
    let f = from,
      t = to,
      m = mid;
    const tau = Math.PI * 2;
    if (t < f) t += tau;
    if (m < f) m += tau;
    return m >= f && m <= t;
  };
  const ccwContainsPivot = isBetweenCCW(A1, A2, A3);
  let startAngle = A1,
    endAngle = A2;
  if (!ccwContainsPivot) {
    if (startAngle < endAngle) startAngle += Math.PI * 2;
    else endAngle += Math.PI * 2;
  } else if (endAngle < startAngle) {
    endAngle += Math.PI * 2;
  }
  const angleSpan = endAngle - startAngle;
  const arcLength = Math.abs(angleSpan) * radius;
  const steps = Math.max(16, Math.min(120, Math.ceil(arcLength / 8)));
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = startAngle + angleSpan * t;
    out.push({
      x: ux + Math.cos(angle) * radius,
      y: uy + Math.sin(angle) * radius,
    });
  }
  return out;
}

/** Sample quadratic Bezier in world space. Returns dense points. */
export function sampleBezierWorld(
  start: { x: number; y: number },
  end: { x: number; y: number },
  control: { x: number; y: number },
): { x: number; y: number }[] {
  // Sample densely using the control polygon length, then resample by arc
  // length so the runtime sees a more uniform rail with cleaner endpoint tangents.
  const controlPolyLen =
    Math.hypot(control.x - start.x, control.y - start.y) +
    Math.hypot(end.x - control.x, end.y - control.y);
  const steps = Math.max(24, Math.min(240, Math.ceil(controlPolyLen / 3)));
  const raw: { x: number; y: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    raw.push({
      x: mt * mt * start.x + 2 * mt * t * control.x + t * t * end.x,
      y: mt * mt * start.y + 2 * mt * t * control.y + t * t * end.y,
    });
  }
  return samplePolylineWorld(raw, 8);
}

/** Sample a loop-the-loop style rail with open endpoints and a full circular loop through the midpoint. */
export function sampleLoopRailWorld(
  start: { x: number; y: number },
  end: { x: number; y: number },
  control: { x: number; y: number },
): { x: number; y: number }[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chordLength = Math.hypot(dx, dy);
  if (chordLength < 1) return [start, end];

  const ux = dx / chordLength;
  const uy = dy / chordLength;
  const perpX = -uy;
  const perpY = ux;
  const midpoint = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  };

  const controlOffsetX = control.x - midpoint.x;
  const controlOffsetY = control.y - midpoint.y;
  const signedHeight = controlOffsetX * perpX + controlOffsetY * perpY;
  const radius = Math.abs(signedHeight);

  if (radius < 8) {
    return sampleLineWorld(start, end, 20);
  }

  const normalSign = signedHeight >= 0 ? 1 : -1;
  const nx = perpX * normalSign;
  const ny = perpY * normalSign;
  const center = {
    x: midpoint.x + nx * radius,
    y: midpoint.y + ny * radius,
  };

  const entry = sampleLineWorld(start, midpoint, 20);
  const circumference = 2 * Math.PI * radius;
  const loopSteps = Math.max(24, Math.min(240, Math.ceil(circumference / 8)));
  const loop: { x: number; y: number }[] = [];
  for (let i = 0; i <= loopSteps; i++) {
    const angle = (i / loopSteps) * Math.PI * 2;
    loop.push({
      x: center.x + radius * (-nx * Math.cos(angle) + ux * Math.sin(angle)),
      y: center.y + radius * (-ny * Math.cos(angle) + uy * Math.sin(angle)),
    });
  }
  const exit = sampleLineWorld(midpoint, end, 20);

  return [...entry, ...loop.slice(1), ...exit.slice(1)];
}

export function sampleLineWorld(
  start: { x: number; y: number },
  end: { x: number; y: number },
  stepPx: number = 25,
): { x: number; y: number }[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= stepPx) return [start, end];
  const steps = Math.max(2, Math.ceil(dist / stepPx));
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    out.push({ x: start.x + dx * t, y: start.y + dy * t });
  }
  return out;
}

/** Resample an arbitrary polyline at uniform spacing. */
export function samplePolylineWorld(
  points: { x: number; y: number }[],
  stepPx: number = 25,
): { x: number; y: number }[] {
  if (points.length < 2) return [...points];
  // Compute cumulative distances
  const cumDist: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    cumDist.push(
      cumDist[i - 1] +
        Math.hypot(
          points[i].x - points[i - 1].x,
          points[i].y - points[i - 1].y,
        ),
    );
  }
  const totalDist = cumDist[cumDist.length - 1];
  if (totalDist < stepPx) return [points[0], points[points.length - 1]];
  const steps = Math.max(2, Math.ceil(totalDist / stepPx));
  const out: { x: number; y: number }[] = [];
  let seg = 0;
  for (let i = 0; i <= steps; i++) {
    const d = (i / steps) * totalDist;
    while (seg < points.length - 2 && cumDist[seg + 1] < d) seg++;
    const segLen = cumDist[seg + 1] - cumDist[seg];
    const t = segLen > 0 ? (d - cumDist[seg]) / segLen : 0;
    out.push({
      x: points[seg].x + (points[seg + 1].x - points[seg].x) * t,
      y: points[seg].y + (points[seg + 1].y - points[seg].y) * t,
    });
  }
  return out;
}

/**
 * Subdivide sharp corners in a polyline by inserting small circular arc points.
 * Any turn sharper than `thresholdDeg` gets extra samples so the game engine
 * can follow the curve without the wheel clipping through the rail.
 */
export function subdivideSharps(
  points: { x: number; y: number }[],
  thresholdDeg: number = 60,
  arcRadius: number = 20,
  samplesPerCorner: number = 6,
): { x: number; y: number }[] {
  if (points.length < 3) return [...points];
  const threshRad = thresholdDeg * (Math.PI / 180);
  const out: { x: number; y: number }[] = [points[0]];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    // Incoming and outgoing direction vectors
    const ax = prev.x - curr.x, ay = prev.y - curr.y;
    const bx = next.x - curr.x, by = next.y - curr.y;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la < 1e-6 || lb < 1e-6) { out.push(curr); continue; }
    const dot = (ax * bx + ay * by) / (la * lb);
    const angle = Math.acos(Math.max(-1, Math.min(1, dot))); // angle at the corner (0 = hairpin, π = straight)
    if (angle >= threshRad) { out.push(curr); continue; }

    // Sharp corner — insert arc points
    const uax = ax / la, uay = ay / la; // unit toward prev
    const ubx = bx / lb, uby = by / lb; // unit toward next
    // Limit arc radius so it doesn't overshoot the adjacent segments
    const r = Math.min(arcRadius, la * 0.4, lb * 0.4);
    const pStart = { x: curr.x + uax * r, y: curr.y + uay * r };
    const pEnd = { x: curr.x + ubx * r, y: curr.y + uby * r };
    // Interpolate along a circular arc via angle subdivision
    for (let s = 0; s <= samplesPerCorner; s++) {
      const t = s / samplesPerCorner;
      // Slerp-like interpolation: blend the two offset directions and project onto arc
      const mx = uax * (1 - t) + ubx * t;
      const my = uay * (1 - t) + uby * t;
      const ml = Math.hypot(mx, my) || 1;
      out.push({ x: curr.x + (mx / ml) * r, y: curr.y + (my / ml) * r });
    }
  }

  out.push(points[points.length - 1]);
  return out;
}

/** Ramer-Douglas-Peucker polyline simplification (iterative). */
export function rdpSimplify(
  points: { x: number; y: number }[],
  epsilon: number,
): { x: number; y: number }[] {
  if (points.length <= 2) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDist = 0,
      maxIdx = start;
    const dx = points[end].x - points[start].x;
    const dy = points[end].y - points[start].y;
    const lenSq = dx * dx + dy * dy;
    for (let i = start + 1; i < end; i++) {
      let d: number;
      if (lenSq === 0) {
        d = Math.hypot(
          points[i].x - points[start].x,
          points[i].y - points[start].y,
        );
      } else {
        const t =
          ((points[i].x - points[start].x) * dx +
            (points[i].y - points[start].y) * dy) /
          lenSq;
        const px = points[start].x + t * dx;
        const py = points[start].y + t * dy;
        d = Math.hypot(points[i].x - px, points[i].y - py);
      }
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist > epsilon) {
      keep[maxIdx] = 1;
      if (maxIdx - start > 1) stack.push([start, maxIdx]);
      if (end - maxIdx > 1) stack.push([maxIdx, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Chaikin corner-cutting subdivision. Each iteration produces a smoother curve. */
export function chaikinSmooth(
  points: { x: number; y: number }[],
  iterations: number,
): { x: number; y: number }[] {
  if (iterations <= 0 || points.length < 3) return [...points];
  let pts = points;
  for (let iter = 0; iter < iterations; iter++) {
    const next: { x: number; y: number }[] = [pts[0]]; // keep first point
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i],
        p1 = pts[i + 1];
      next.push({ x: p0.x * 0.75 + p1.x * 0.25, y: p0.y * 0.75 + p1.y * 0.25 });
      next.push({ x: p0.x * 0.25 + p1.x * 0.75, y: p0.y * 0.25 + p1.y * 0.75 });
    }
    next.push(pts[pts.length - 1]); // keep last point
    pts = next;
  }
  return pts;
}

/** Smooth a freehand-drawn rail path. smoothness 0..1 maps to RDP epsilon + Chaikin iterations. */
export function smoothDrawnRail(
  rawPoints: { x: number; y: number }[],
  smoothness: number,
): { x: number; y: number }[] {
  if (rawPoints.length < 2) return [...rawPoints];
  const s = Math.max(0, Math.min(1, smoothness));
  const epsilon = 2 + s * 38;
  const chaikinIter = Math.floor(s * 3);
  let pts = rdpSimplify(rawPoints, epsilon);
  pts = chaikinSmooth(pts, chaikinIter);
  return pts;
}


export function saveCustomLevel(level: EditorLevel) {
  const levels = loadCustomLevels();
  const stamped = { ...level, updatedAt: Date.now() };
  // Match by ID first (preferred), fall back to name for legacy entries without IDs
  const idx = level.id
    ? levels.findIndex((l) => l.id === level.id)
    : levels.findIndex((l) => l.name === level.name);
  if (idx >= 0) levels[idx] = stamped;
  else levels.push(stamped);
  localStorage.setItem("cable-riders-custom-levels", JSON.stringify(levels));
}

export function loadCustomLevels(): EditorLevel[] {
  try {
    const raw = localStorage.getItem("cable-riders-custom-levels");
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

export function deleteCustomLevel(name: string) {
  const levels = loadCustomLevels().filter((l) => l.name !== name);
  localStorage.setItem("cable-riders-custom-levels", JSON.stringify(levels));
}

// Adventure levels — static JSON files in src/game/levels/, bundled at build time
const _adventureLevelModules = import.meta.glob<any>(
  './levels/*.json',
  { eager: true, import: 'default' },
);

export function loadAdventureLevels(): EditorLevel[] {
  return Object.values(_adventureLevelModules)
    .map((raw): EditorLevel => raw?.format === 'sky-lift-dash-level' ? raw.level : raw)
    .filter((l): l is EditorLevel => !!l && !!(l.segments || l.tiles))
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

// ─── Unified Segment Builders ────────────────────────────────────────────────

/** Group individual segments into continuous segments by matching snappoints. */
export function buildContinuousSegments(
  individualSegments: IndividualRailSegment[],
): ContinuousRailSegment[] {
  const n = individualSegments.length;
  if (n === 0) return [];

  const SNAP_TOLERANCE = 8; // px

  // Build adjacency based on snappoint proximity
  const adj: Set<number>[] = Array.from({ length: n }, () => new Set());
  for (let i = 0; i < n; i++) {
    const si = individualSegments[i];
    for (let j = i + 1; j < n; j++) {
      const sj = individualSegments[j];
      if (
        Math.hypot(si.snapA.x - sj.snapA.x, si.snapA.y - sj.snapA.y) <
          SNAP_TOLERANCE ||
        Math.hypot(si.snapA.x - sj.snapB.x, si.snapA.y - sj.snapB.y) <
          SNAP_TOLERANCE ||
        Math.hypot(si.snapB.x - sj.snapA.x, si.snapB.y - sj.snapA.y) <
          SNAP_TOLERANCE ||
        Math.hypot(si.snapB.x - sj.snapB.x, si.snapB.y - sj.snapB.y) <
          SNAP_TOLERANCE
      ) {
        adj[i].add(j);
        adj[j].add(i);
      }
    }
  }

  // BFS to find connected components
  const visited = new Set<number>();
  const result: ContinuousRailSegment[] = [];
  let contId = 0;

  for (let i = 0; i < n; i++) {
    if (visited.has(i)) continue;
    const component: number[] = [];
    const queue = [i];
    visited.add(i);
    while (queue.length > 0) {
      const idx = queue.shift()!;
      component.push(idx);
      for (const nb of adj[idx]) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }

    result.push({
      id: `cont_${contId++}`,
      individualIds: component.map((idx) => individualSegments[idx].id),
    });
  }

  return result;
}

/** Extract all snappoints from individual segments. */
export function getSnapPoints(
  individualSegments: IndividualRailSegment[],
): SnapPoint[] {
  const result: SnapPoint[] = [];
  for (const seg of individualSegments) {
    result.push({ segmentId: seg.id, point: seg.snapA, endpoint: "A" });
    // Only add snapB if distinct from snapA (skip degenerate single-point segments)
    if (Math.hypot(seg.snapA.x - seg.snapB.x, seg.snapA.y - seg.snapB.y) > 1) {
      result.push({ segmentId: seg.id, point: seg.snapB, endpoint: "B" });
    }
  }
  return result;
}

// ─── Unified Game Pipeline (V2) ─────────────────────────────────────────────

const WALK_SNAP = 8; // px — same tolerance as buildContinuousSegments

/** Walk individual segments within a continuous group into an ordered point sequence. */
export function walkContinuousPath(
  allIndividual: IndividualRailSegment[],
  contSeg: ContinuousRailSegment,
  startMarkerPos?: { x: number; y: number } | null,
): { points: { x: number; y: number }[]; isLoop: boolean } {
  const segMap = new Map<string, IndividualRailSegment>();
  for (const seg of allIndividual) segMap.set(seg.id, seg);
  const segs = contSeg.individualIds.map(id => segMap.get(id)!).filter(Boolean);
  if (segs.length === 0) return { points: [], isLoop: false };
  if (segs.length === 1) return { points: [...segs[0].points], isLoop: false };

  // Build adjacency within this continuous group
  const adj = new Map<string, { id: string; matchedVia: "A" | "B"; myEnd: "A" | "B" }[]>();
  for (const s of segs) adj.set(s.id, []);

  const near = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y) < WALK_SNAP;

  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const si = segs[i], sj = segs[j];
      const pairs: [("A" | "B"), ("A" | "B")][] = [];
      if (near(si.snapA, sj.snapA)) pairs.push(["A", "A"]);
      if (near(si.snapA, sj.snapB)) pairs.push(["A", "B"]);
      if (near(si.snapB, sj.snapA)) pairs.push(["B", "A"]);
      if (near(si.snapB, sj.snapB)) pairs.push(["B", "B"]);
      for (const [myEnd, theirEnd] of pairs) {
        adj.get(si.id)!.push({ id: sj.id, matchedVia: theirEnd, myEnd });
        adj.get(sj.id)!.push({ id: si.id, matchedVia: myEnd, myEnd: theirEnd });
      }
    }
  }

  // Find start segment: prefer startMarkerPos, else dead-end
  let startSeg = segs[0];
  let startFromA = true;
  let foundStart = false;

  if (startMarkerPos) {
    let bestDist = Infinity;
    for (const s of segs) {
      const dA = Math.hypot(s.snapA.x - startMarkerPos.x, s.snapA.y - startMarkerPos.y);
      const dB = Math.hypot(s.snapB.x - startMarkerPos.x, s.snapB.y - startMarkerPos.y);
      const d = Math.min(dA, dB);
      if (d < bestDist) {
        bestDist = d;
        startSeg = s;
        startFromA = dA <= dB;
        foundStart = d < WALK_SNAP;
      }
    }
  }

  // Fallback: prefer dead-end segment (neighbors on only one side)
  if (!foundStart) {
    for (const s of segs) {
      const neighbors = adj.get(s.id)!;
      const hasANeighbor = neighbors.some(n => n.myEnd === "A");
      const hasBNeighbor = neighbors.some(n => n.myEnd === "B");
      // If only one endpoint is connected, start from the opposite dead-end so
      // the walk continues through the rest of the chain instead of stopping
      // immediately after the first individual segment.
      if (hasANeighbor && !hasBNeighbor) { startSeg = s; startFromA = false; break; }
      if (hasBNeighbor && !hasANeighbor) { startSeg = s; startFromA = true; break; }
    }
  }

  // Walk the chain
  const visited = new Set<string>();
  const result: { x: number; y: number }[] = [];
  let current = startSeg;
  let exitEnd: "A" | "B" = startFromA ? "B" : "A";

  const firstPts = startFromA ? [...current.points] : [...current.points].reverse();
  result.push(...firstPts);
  visited.add(current.id);

  while (true) {
    const exitPt = exitEnd === "B" ? current.snapB : current.snapA;
    const neighbors = adj.get(current.id)!.filter(n => !visited.has(n.id) && n.myEnd === exitEnd);

    if (neighbors.length === 0) break;

    // Crossing: prefer straightest continuation (dot product)
    let next = neighbors[0];
    if (neighbors.length > 1 && result.length >= 2) {
      const prev = result[result.length - 2];
      const curr = result[result.length - 1];
      const dx = curr.x - prev.x, dy = curr.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      const dirX = dx / len, dirY = dy / len;
      let bestDot = -Infinity;
      for (const n of neighbors) {
        const ns = segMap.get(n.id)!;
        const otherEnd = n.matchedVia === "A" ? ns.snapB : ns.snapA;
        const ndx = otherEnd.x - exitPt.x, ndy = otherEnd.y - exitPt.y;
        const nlen = Math.hypot(ndx, ndy) || 1;
        const dot = (ndx / nlen) * dirX + (ndy / nlen) * dirY;
        if (dot > bestDot) { bestDot = dot; next = n; }
      }
    }

    visited.add(next.id);
    const nextSeg = segMap.get(next.id)!;
    const readForward = next.matchedVia === "A";
    const pts = readForward ? nextSeg.points : [...nextSeg.points].reverse();

    // Deduplicate shared endpoint
    const lastPt = result[result.length - 1];
    const startIdx = (pts.length > 0 && Math.hypot(pts[0].x - lastPt.x, pts[0].y - lastPt.y) < WALK_SNAP) ? 1 : 0;
    for (let i = startIdx; i < pts.length; i++) result.push(pts[i]);

    current = nextSeg;
    exitEnd = readForward ? "B" : "A";
  }

  const isLoop = result.length >= 3 && Math.hypot(
    result[0].x - result[result.length - 1].x,
    result[0].y - result[result.length - 1].y,
  ) < WALK_SNAP;

  return { points: result, isLoop };
}

// ─── Game Pipeline (unified segments) ─────────────────────────────────────────

/** Convert RailSegment[] to IndividualRailSegment[] (trivial mapping). */
export function buildIndividualSegmentsFromRailSegments(
  segments: RailSegment[],
): IndividualRailSegment[] {
  return segments.map((seg, i) => {
    const pts = seg.points;
    return {
      id: `seg_${i}`,
      kind: seg.rawDrawnPoints ? "drawn_rail" as const : "free_line" as const,
      points: pts,
      snapA: pts[0],
      snapB: pts[pts.length - 1],
    };
  });
}

/** V3 game data conversion: works from unified segments format. */
export function convertLevelToGameDataV3(
  level: EditorLevel,
): {
  railPoints: { x: number; y: number }[];
  allSegments: { x: number; y: number }[][];
  segmentIdByIndex: string[];
  obstacles: { tileType: string; gx: number; gy: number; params: ObstacleParams }[];
  stars: { gx: number; gy: number; worldX: number; worldY: number }[];
  endTileWorldPos: { x: number; y: number } | null;
  isLoop: boolean;
} {
  // Extract obstacles from V3 obstacles record
  const obstacles: { tileType: string; gx: number; gy: number; params: ObstacleParams }[] = [];
  if (level.obstacles) {
    for (const [key, type] of Object.entries(level.obstacles)) {
      const [gx, gy] = parseTileKey(key);
      const stored = level.obstacleParams ? level.obstacleParams[key] : undefined;
      const params = resolveParams(type, stored);
      if (params) obstacles.push({ tileType: type, gx, gy, params });
    }
  }

  // Extract collectible stars
  const stars: { gx: number; gy: number; worldX: number; worldY: number }[] = [];
  if (level.stars) {
    for (const key of Object.keys(level.stars)) {
      const [gx, gy] = parseTileKey(key);
      stars.push({ gx, gy, worldX: (gx + 0.5) * GRID_SIZE, worldY: (gy + 0.5) * GRID_SIZE });
    }
  }

  const endTileWorldPos = level.endMarker ?? null;
  const segs = level.segments ?? [];

  const individual = buildIndividualSegmentsFromRailSegments(segs);
  const continuous = buildContinuousSegments(individual);

  if (continuous.length === 0) {
    return { railPoints: [], allSegments: [], segmentIdByIndex: [], obstacles, stars, endTileWorldPos, isLoop: false };
  }

  // Walk each continuous segment, subdivide sharp corners, and resample to uniform spacing
  const RESAMPLE_STEP = 20;
  const walkedSegments: { points: { x: number; y: number }[]; isLoop: boolean; contId: string }[] = [];
  for (const cs of continuous) {
    const { points, isLoop } = walkContinuousPath(individual, cs, level.startMarker);
    if (points.length > 0) {
      const subdivided = subdivideSharps(points);
      const resampled = subdivided.length >= 2 ? samplePolylineWorld(subdivided, RESAMPLE_STEP) : subdivided;
      walkedSegments.push({ points: resampled, isLoop, contId: cs.id });
    }
  }

  // Find main segment: nearest to startMarker
  let mainIdx = 0;
  if (level.startMarker) {
    const sm = level.startMarker;
    for (let i = 0; i < walkedSegments.length; i++) {
      const pts = walkedSegments[i].points;
      const dFirst = Math.hypot(pts[0].x - sm.x, pts[0].y - sm.y);
      const dLast = Math.hypot(pts[pts.length - 1].x - sm.x, pts[pts.length - 1].y - sm.y);
      if (dFirst < WALK_SNAP || dLast < WALK_SNAP) { mainIdx = i; break; }
    }
  }

  // Build output: main segment first
  const allSegments: { x: number; y: number }[][] = [];
  const segmentIdByIndex: string[] = [];
  const order = [mainIdx, ...walkedSegments.map((_, i) => i).filter(i => i !== mainIdx)];
  for (const i of order) {
    allSegments.push(walkedSegments[i].points);
    segmentIdByIndex.push(walkedSegments[i].contId);
  }

  let railPoints = allSegments[0] ?? [];
  const isLoop = walkedSegments[mainIdx]?.isLoop ?? false;

  // Final orientation: ensure railPoints[0] is near startMarker
  if (level.startMarker && railPoints.length >= 2) {
    const sm = level.startMarker;
    const dFirst = Math.hypot(railPoints[0].x - sm.x, railPoints[0].y - sm.y);
    const dLast = Math.hypot(railPoints[railPoints.length - 1].x - sm.x, railPoints[railPoints.length - 1].y - sm.y);
    if (dLast < dFirst) {
      railPoints = [...railPoints].reverse();
      allSegments[0] = railPoints;
    }
  }

  return { railPoints, allSegments, segmentIdByIndex, obstacles, stars, endTileWorldPos, isLoop };
}

// ─── V2 → V3 Migration ─────────────────────────────────────────────────────

/** Migrate a legacy V2 (or V1) level to V3 unified segment format. */
export function migrateToV3(level: EditorLevel): EditorLevel {
  if (level.version === 3 && level.segments) return level;

  const tiles = level.tiles ?? {};

  // Build connections map
  const connections: Record<string, Set<string>> = {};
  if (level.connections) {
    for (const [key, arr] of Object.entries(level.connections)) {
      connections[key] = new Set(arr);
    }
  }

  // Migrate legacy free line formats to { start, end }
  const rawFreeLines = (level.freeLines ?? []) as any[];
  const migratedFreeLines: FreeLineSegment[] = rawFreeLines.map(fl => {
    if (!fl || !fl.end) return null;
    if (fl.start) return fl as FreeLineSegment;
    const startPt = fl.attachWorld ?? fl.attach?.atWorld ?? fl.end;
    const result: FreeLineSegment = { start: startPt, end: fl.end };
    if (fl.waypoints) result.waypoints = fl.waypoints;
    if (fl.rawDrawnPoints) result.rawDrawnPoints = fl.rawDrawnPoints;
    if (fl.smoothness !== undefined) result.smoothness = fl.smoothness;
    return result;
  }).filter(Boolean) as FreeLineSegment[];

  // Build RailSegment[] directly from V2 data
  const segments: RailSegment[] = [];

  // ── Tile-based segments: walk connected rail tiles into chains ──────────
  const railKeys: string[] = [];
  for (const [key, type] of Object.entries(tiles)) {
    if (type === "rail" || type === "rail_start" || type === "rail_end" || type === "rail_crossing") {
      railKeys.push(key);
    }
  }
  if (railKeys.length > 0) {
    const smoothSegments = level.smoothSegments ?? [];
    const smoothLookup = new Map<string, { seg: SmoothSegment; index: number }>();
    for (let i = 0; i < smoothSegments.length; i++) {
      const s = smoothSegments[i];
      smoothLookup.set([s.startKey, s.endKey].sort().join("|"), { seg: s, index: i });
    }
    const findSmooth = (a: string, b: string) => smoothLookup.get([a, b].sort().join("|"));

    // BFS connected components
    const seen = new Set<string>();
    const railSet = new Set(railKeys);
    const crossingKeys = new Set(railKeys.filter(k => tiles[k] === "rail_crossing"));
    for (const key of railKeys) {
      if (seen.has(key)) continue;
      const comp: string[] = [];
      const queue = [key];
      if (!crossingKeys.has(key)) seen.add(key);
      while (queue.length > 0) {
        const cur = queue.shift()!;
        comp.push(cur);
        const neighbors = connections[cur];
        if (!neighbors) continue;
        for (const n of neighbors) {
          if (!railSet.has(n) || seen.has(n)) continue;
          if (!crossingKeys.has(n)) seen.add(n);
          queue.push(n);
        }
      }
      if (comp.length < 2) {
        segments.push({ points: [keyToWorld(comp[0])] });
        continue;
      }
      // Walk component, splitting at smooth segment boundaries
      let chainKeys: string[] = [comp[0]];
      for (let i = 1; i < comp.length; i++) {
        const prevKey = comp[i - 1], currKey = comp[i];
        const smooth = findSmooth(prevKey, currKey);
        if (smooth) {
          if (chainKeys.length >= 2) segments.push({ points: chainKeys.map(k => keyToWorld(k)) });
          const { seg } = smooth;
          const wStart = keyToWorld(seg.startKey), wEnd = keyToWorld(seg.endKey);
          const wPivot = { x: seg.pivotGx * GRID_SIZE, y: seg.pivotGy * GRID_SIZE };
          let arcPts = seg.type === "circular"
            ? sampleCircularArcWorld(wStart, wEnd, wPivot)
            : sampleBezierWorld(wStart, wEnd, wPivot);
          if (arcPts.length >= 2) {
            const prevWorld = keyToWorld(prevKey);
            const dFirst = Math.hypot(arcPts[0].x - prevWorld.x, arcPts[0].y - prevWorld.y);
            const dLast = Math.hypot(arcPts[arcPts.length - 1].x - prevWorld.x, arcPts[arcPts.length - 1].y - prevWorld.y);
            if (dLast < dFirst) arcPts = [...arcPts].reverse();
          }
          segments.push({ points: arcPts });
          chainKeys = [currKey];
        } else {
          chainKeys.push(currKey);
        }
      }
      if (chainKeys.length >= 2) segments.push({ points: chainKeys.map(k => keyToWorld(k)) });
    }
  }

  // ── Free line segments ─────────────────────────────────────────────────
  for (const fl of migratedFreeLines) {
    const points = fl.waypoints?.length
      ? [fl.start, ...fl.waypoints, fl.end]
      : [fl.start, fl.end];
    const rs: RailSegment = { points };
    if (fl.rawDrawnPoints) rs.rawDrawnPoints = fl.rawDrawnPoints;
    if (fl.smoothness !== undefined) rs.smoothness = fl.smoothness;
    segments.push(rs);
  }

  // Extract markers
  let startMarker: { x: number; y: number } | undefined;
  let endMarker: { x: number; y: number } | undefined;
  for (const [key, type] of Object.entries(tiles)) {
    if (type === "rail_start") startMarker = keyToWorld(key);
    if (type === "rail_end") endMarker = keyToWorld(key);
  }

  // Extract obstacles only
  const obstacles: Record<string, ObstacleTileType> = {};
  for (const [key, type] of Object.entries(tiles)) {
    if (isObstacleTileType(type)) {
      obstacles[key] = type;
    }
  }

  return {
    name: level.name,
    id: level.id,
    version: 3,
    createdAt: level.createdAt,
    musicFile: level.musicFile,
    obstacleParams: level.obstacleParams,
    segments,
    obstacles,
    startMarker,
    endMarker,
  };
}
