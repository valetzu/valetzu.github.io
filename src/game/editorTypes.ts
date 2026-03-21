import { obstacleDefMap, resolveParams, ObstacleParams } from './obstacleDefinitions';

export const GRID_SIZE = 50;
export const EDITOR_WIDTH = 200; // grid cells wide
export const EDITOR_HEIGHT = 16; // grid cells tall

export type TileType =
  | 'empty' | 'rail' | 'rail_start' | 'rail_end' | 'rail_crossing'
  | 'spinner' | 'bouncer'
  | 'pendulum' | 'crusher' | 'laser' | 'swoop'
  | 'orbiter' | 'boulder' | 'mine' | 'stalactite';

export type EditorTool =
  | 'none'
  | 'rail'
  | 'rail_start'
  | 'rail_end'
  | 'rail_crossing'
  | 'spinner'
  | 'bouncer'
  | 'pendulum'
  | 'crusher'
  | 'laser'
  | 'swoop'
  | 'orbiter'
  | 'boulder'
  | 'mine'
  | 'stalactite'
  | 'eraser'
  | 'arc'
  | 'curve'
  | 'circular_curve'
  | 'circle'
  | 'line'
  | 'line2'
  | 'draw_rail';

export interface EditorTile {
  type: TileType;
}

/** Smooth segment between two rail tiles: rendered and played as a curve, not tile-stepped */
export interface SmoothSegment {
  type: 'circular' | 'bezier';
  startKey: string;
  endKey: string;
  pivotGx: number;
  pivotGy: number;
}

/** Stable id for a rail component (min tile key by gx,gy) so it doesn't change when start tile moves */
export function componentId(keys: string[]): string {
  if (keys.length === 0) return '';
  return keys.slice().sort((a, b) => {
    const [ax, ay] = parseTileKey(a);
    const [bx, by] = parseTileKey(b);
    return ax - bx || ay - by;
  })[0];
}

export type FreeLineAttach =
  | { segmentId: string; endpoint: 'start' | 'end' }
  | { segmentId: string; atWorld: { x: number; y: number } };

export interface FreeLineSegment {
  /** Logical attach reference (segment + endpoint or world point on a segment) */
  attach: FreeLineAttach;
  /** Cached world position where the Line 2 started, so it survives rail graph changes */
  attachWorld?: { x: number; y: number };
  end: { x: number; y: number };
  target?: { segmentId: string; endpoint: 'start' | 'end' };
  /** Drawn rail: smoothed polyline between attach and end */
  waypoints?: { x: number; y: number }[];
  /** Drawn rail: original freehand points for re-smoothing */
  rawDrawnPoints?: { x: number; y: number }[];
  /** Drawn rail: smoothness slider value 0..1 */
  smoothness?: number;
}

// ─── Unified Rail Segment Model ──────────────────────────────────────────────

/** A single rail piece created by one tool action (tile chain, smooth curve, free line, or drawn rail). */
export interface IndividualRailSegment {
  id: string;
  kind: 'tile_chain' | 'smooth_curve' | 'free_line' | 'drawn_rail';
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
  endpoint: 'A' | 'B';
}

export interface EditorLevel {
  name: string;
  /** Stable unique identifier used for music folder paths and deduplication. */
  id: string;
  tiles: Record<string, TileType>; // "x,y" -> type
  createdAt: number;
  // Optional explicit rail connection graph: tileKey -> array of connected tileKeys.
  connections?: Record<string, string[]>;
  /** Smooth arcs/curves between tiles; expanded to dense world points for game rail */
  smoothSegments?: SmoothSegment[];
  /** World-space line extensions attached to main rail */
  freeLines?: FreeLineSegment[];
  /** Music filename relative to public/assets/music/customLevels/{id}/ */
  musicFile?: string;
  /**
   * Per-tile obstacle parameters keyed by "gx,gy".
   * Absence of a key means use the obstacle type's defaultParams.
   */
  obstacleParams?: Record<string, ObstacleParams>;
}

/** Generate a short random level id that is stable across saves. */
export function generateLevelId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function tileKey(gx: number, gy: number): string {
  return `${gx},${gy}`;
}

export function parseTileKey(key: string): [number, number] {
  const [x, y] = key.split(',').map(Number);
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
  pivot: { x: number; y: number }
): { x: number; y: number }[] {
  const x1 = start.x, y1 = start.y;
  const x2 = end.x, y2 = end.y;
  const x3 = pivot.x, y3 = pivot.y;
  const d = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
  if (Math.abs(d) < 1e-6) {
    return [start, end];
  }
  const ux = ((x1 * x1 + y1 * y1) * (y2 - y3) + (x2 * x2 + y2 * y2) * (y3 - y1) + (x3 * x3 + y3 * y3) * (y1 - y2)) / d;
  const uy = ((x1 * x1 + y1 * y1) * (x3 - x2) + (x2 * x2 + y2 * y2) * (x1 - x3) + (x3 * x3 + y3 * y3) * (x2 - x1)) / d;
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
  const A1 = norm(a1), A2 = norm(a2), A3 = norm(a3);
  const isBetweenCCW = (from: number, to: number, mid: number) => {
    let f = from, t = to, m = mid;
    const tau = Math.PI * 2;
    if (t < f) t += tau;
    if (m < f) m += tau;
    return m >= f && m <= t;
  };
  const ccwContainsPivot = isBetweenCCW(A1, A2, A3);
  let startAngle = A1, endAngle = A2;
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
    out.push({ x: ux + Math.cos(angle) * radius, y: uy + Math.sin(angle) * radius });
  }
  return out;
}

/** Sample quadratic Bezier in world space. Returns dense points. */
export function sampleBezierWorld(
  start: { x: number; y: number },
  end: { x: number; y: number },
  control: { x: number; y: number }
): { x: number; y: number }[] {
  const dist = Math.hypot(end.x - start.x, end.y - start.y);
  const steps = Math.max(16, Math.min(80, Math.ceil(dist / 6)));
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    out.push({
      x: mt * mt * start.x + 2 * mt * t * control.x + t * t * end.x,
      y: mt * mt * start.y + 2 * mt * t * control.y + t * t * end.y,
    });
  }
  return out;
}

export function sampleLineWorld(
  start: { x: number; y: number },
  end: { x: number; y: number },
  stepPx: number = 25
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
  stepPx: number = 25
): { x: number; y: number }[] {
  if (points.length < 2) return [...points];
  // Compute cumulative distances
  const cumDist: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    cumDist.push(cumDist[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
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

/** Ramer-Douglas-Peucker polyline simplification (iterative). */
export function rdpSimplify(
  points: { x: number; y: number }[],
  epsilon: number
): { x: number; y: number }[] {
  if (points.length <= 2) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDist = 0, maxIdx = start;
    const dx = points[end].x - points[start].x;
    const dy = points[end].y - points[start].y;
    const lenSq = dx * dx + dy * dy;
    for (let i = start + 1; i < end; i++) {
      let d: number;
      if (lenSq === 0) {
        d = Math.hypot(points[i].x - points[start].x, points[i].y - points[start].y);
      } else {
        const t = ((points[i].x - points[start].x) * dx + (points[i].y - points[start].y) * dy) / lenSq;
        const px = points[start].x + t * dx;
        const py = points[start].y + t * dy;
        d = Math.hypot(points[i].x - px, points[i].y - py);
      }
      if (d > maxDist) { maxDist = d; maxIdx = i; }
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
  iterations: number
): { x: number; y: number }[] {
  if (iterations <= 0 || points.length < 3) return [...points];
  let pts = points;
  for (let iter = 0; iter < iterations; iter++) {
    const next: { x: number; y: number }[] = [pts[0]]; // keep first point
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i], p1 = pts[i + 1];
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
  smoothness: number
): { x: number; y: number }[] {
  if (rawPoints.length < 2) return [...rawPoints];
  const s = Math.max(0, Math.min(1, smoothness));
  const epsilon = 2 + s * 38;
  const chaikinIter = Math.floor(s * 3);
  let pts = rdpSimplify(rawPoints, epsilon);
  pts = chaikinSmooth(pts, chaikinIter);
  return pts;
}

function getSmoothSegment(segments: SmoothSegment[] | undefined, keyA: string, keyB: string): SmoothSegment | undefined {
  if (!segments) return undefined;
  return segments.find(
    s =>
      (s.startKey === keyA && s.endKey === keyB) || (s.startKey === keyB && s.endKey === keyA)
  );
}

/** Expand an ordered list of tile keys into world points, inserting smooth segment geometry where defined */
export function expandPathWithSmoothSegments(
  orderedKeys: string[],
  smoothSegments: SmoothSegment[] | undefined
): { points: { x: number; y: number }[]; keyToLastIndex: Record<string, number> } {
  const points: { x: number; y: number }[] = [];
  const keyToLastIndex: Record<string, number> = {};
  if (orderedKeys.length === 0) return { points, keyToLastIndex };
  const keyToWorldPt = (k: string) => keyToWorld(k);
  points.push(keyToWorldPt(orderedKeys[0]));
  keyToLastIndex[orderedKeys[0]] = 0;
  for (let i = 1; i < orderedKeys.length; i++) {
    const keyA = orderedKeys[i - 1];
    const keyB = orderedKeys[i];
    const seg = getSmoothSegment(smoothSegments, keyA, keyB);
    if (seg) {
      // Always sample using the segment's stored direction so the arc shape is stable
      const worldStart = keyToWorldPt(seg.startKey);
      const worldEnd = keyToWorldPt(seg.endKey);
      const worldPivot = { x: seg.pivotGx * GRID_SIZE, y: seg.pivotGy * GRID_SIZE };
      let arcPts = seg.type === 'circular'
        ? sampleCircularArcWorld(worldStart, worldEnd, worldPivot)
        : sampleBezierWorld(worldStart, worldEnd, worldPivot);
      // If walk direction is opposite to stored direction, reverse the sampled points
      const reversed = seg.startKey === keyB;
      if (reversed) arcPts = [...arcPts].reverse();
      for (let j = 1; j < arcPts.length; j++) {
        points.push(arcPts[j]);
      }
    } else {
      points.push(keyToWorldPt(keyB));
    }
    keyToLastIndex[keyB] = points.length - 1;
  }
  return { points, keyToLastIndex };
}

export function saveCustomLevel(level: EditorLevel) {
  const levels = loadCustomLevels();
  const idx = levels.findIndex(l => l.name === level.name);
  if (idx >= 0) levels[idx] = level;
  else levels.push(level);
  localStorage.setItem('cable-riders-custom-levels', JSON.stringify(levels));
}

export function loadCustomLevels(): EditorLevel[] {
  try {
    const raw = localStorage.getItem('cable-riders-custom-levels');
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

export function deleteCustomLevel(name: string) {
  const levels = loadCustomLevels().filter(l => l.name !== name);
  localStorage.setItem('cable-riders-custom-levels', JSON.stringify(levels));
}

// Walk one connected component from startKey, return ordered keys.
// crossingKeys: tiles that allow 4 connections; at crossings, the walker
// picks the neighbor most collinear with its approach direction ("straight through").
function walkRailComponent(
  startKey: string,
  connections: Record<string, Set<string>>,
  crossingKeys?: Set<string>
): string[] {
  const visited = new Set<string>();
  const ordered: string[] = [];
  let current: string | null = startKey;
  while (current && !visited.has(current)) {
    visited.add(current);
    ordered.push(current);
    const neighbors = connections[current];
    if (!neighbors) break;

    let next: string | null = null;
    const isCrossing = crossingKeys && crossingKeys.has(current) && neighbors.size > 2;

    if (isCrossing && ordered.length >= 2) {
      // Direction-aware: pick neighbor that continues "straight through"
      const prev = ordered[ordered.length - 2];
      const [cx, cy] = parseTileKey(current);
      const [px, py] = parseTileKey(prev);
      const dx = cx - px;
      const dy = cy - py;
      let bestDot = -Infinity;
      for (const n of neighbors) {
        if (visited.has(n)) continue;
        const [nx, ny] = parseTileKey(n);
        const ndx = nx - cx;
        const ndy = ny - cy;
        const dot = dx * ndx + dy * ndy;
        if (dot > bestDot) {
          bestDot = dot;
          next = n;
        }
      }
    } else {
      for (const n of neighbors) {
        if (!visited.has(n)) {
          next = n;
          break;
        }
      }
    }
    current = next;
  }
  // Close the loop if the last tile connects back to the start
  if (ordered.length > 2) {
    const lastKey = ordered[ordered.length - 1];
    const lastNeighbors = connections[lastKey];
    if (lastNeighbors && lastNeighbors.has(startKey)) {
      ordered.push(startKey);
    }
  }
  return ordered;
}

// Find connected components of the rail graph.
// Crossing tiles are NOT added to the global seen set so multiple
// components can traverse through the same crossing.
function getRailComponents(
  railKeys: string[],
  connections: Record<string, Set<string>>,
  crossingKeys?: Set<string>
): string[][] {
  const seen = new Set<string>();
  const components: string[][] = [];
  for (const key of railKeys) {
    if (seen.has(key)) continue;
    const comp = walkRailComponent(key, connections, crossingKeys);
    for (const k of comp) {
      // Don't mark crossings as seen — they belong to multiple components
      if (!crossingKeys || !crossingKeys.has(k)) {
        seen.add(k);
      }
    }
    components.push(comp);
  }
  return components;
}

// Convert editor tiles to game-compatible rail + obstacles
// Smooth segments are expanded to dense world-space points so rail is truly circular/bezier in-game
export function convertLevelToGameData(
  tiles: Record<string, TileType>,
  connections?: Record<string, Set<string>>,
  smoothSegments?: SmoothSegment[],
  freeLines?: FreeLineSegment[],
  obstacleParams?: Record<string, ObstacleParams>
): {
  railPoints: { x: number; y: number }[];
  allSegments: { x: number; y: number }[][];
  /** Stable segment id per index (so Line 2 doesn't break when start tile moves) */
  segmentIdByIndex: string[];
  obstacles: { tileType: string; gx: number; gy: number; params: ObstacleParams }[];
  endTileWorldPos: { x: number; y: number } | null;
  isLoop: boolean;
} {
  const obstacles: { tileType: string; gx: number; gy: number; params: ObstacleParams }[] = [];
  const railKeys: string[] = [];

  for (const [key, type] of Object.entries(tiles)) {
    if (type === 'rail' || type === 'rail_start' || type === 'rail_end' || type === 'rail_crossing') {
      railKeys.push(key);
    } else if (obstacleDefMap.has(type)) {
      const [gx, gy] = parseTileKey(key);
      const stored = obstacleParams ? obstacleParams[key] : undefined;
      const params = resolveParams(type, stored);
      if (params) obstacles.push({ tileType: type, gx, gy, params });
    }
  }

  if (railKeys.length < 2) {
    const rawRail = railKeys.map(k => keyToWorld(k));
    const segmentIdByIndex = rawRail.length > 0 ? [componentId(railKeys)] : [];
    return { railPoints: rawRail, allSegments: rawRail.length > 0 ? [rawRail] : [], segmentIdByIndex, obstacles, endTileWorldPos: null, isLoop: false };
  }

  const conns = connections && Object.keys(connections).length > 0 ? connections : ({} as Record<string, Set<string>>);
  // Build set of crossing tile keys for direction-aware traversal
  const crossingKeys = new Set<string>();
  for (const key of railKeys) {
    if (tiles[key] === 'rail_crossing') crossingKeys.add(key);
  }
  const hasCrossings = crossingKeys.size > 0;
  const components = getRailComponents(railKeys, conns, hasCrossings ? crossingKeys : undefined);

  // Hoist start/end keys so they're available in the freeLine post-processing block
  const startKey = railKeys.find(k => tiles[k] === 'rail_start');
  const endKey = railKeys.find(k => tiles[k] === 'rail_end');

  let railPoints: { x: number; y: number }[] = [];
  // End tile world position for proximity-based trigger (no fragile index tracking)
  const endTileWorldPos = endKey ? keyToWorld(endKey) : null;
  let isLoop = false;
  const allSegments: { x: number; y: number }[][] = [];
  const segmentIdByIndex: string[] = [];

  if (conns && Object.keys(conns).length > 0) {
    // Direction-neutral: prefer any dead-end tile (1 connection) for walk start.
    // rail_start only influences the final orientation step (reversing so index 0 is near spawn).
    const walkStart = railKeys.find(k => conns[k] && conns[k].size === 1)
      || startKey
      || railKeys[0];

    const startOrdered = walkRailComponent(walkStart, conns, hasCrossings ? crossingKeys : undefined);
    isLoop = startOrdered.length > 2 && startOrdered[0] === startOrdered[startOrdered.length - 1];
    const expanded = expandPathWithSmoothSegments(startOrdered, smoothSegments);
    railPoints = expanded.points;

    allSegments.push(railPoints);
    segmentIdByIndex.push(componentId(startOrdered));
    const startSet = new Set(startOrdered);
    for (const comp of components) {
      if (comp.some(k => startSet.has(k))) continue;
      const { points: pts } = expandPathWithSmoothSegments(comp, smoothSegments);
      // Include even single-tile components so Line 2 can reliably
      // target hand-placed isolated rail tiles.
      if (pts.length >= 1) {
        allSegments.push(pts);
        segmentIdByIndex.push(componentId(comp));
      }
    }
  } else {
    const sorted = [...railKeys].sort((a, b) => {
      const [ax, ay] = parseTileKey(a);
      const [bx, by] = parseTileKey(b);
      return ax - bx || ay - by;
    });
    const expanded = expandPathWithSmoothSegments(sorted, smoothSegments);
    railPoints = expanded.points;
    allSegments.push(railPoints);
    segmentIdByIndex.push(componentId(sorted));
  }

  // ---------------------------------------------------------------------------
  // Free line merging: chains are DIRECTIONLESS point arrays.
  //
  // Each free line is a bridge between two world positions (attachWorld → end).
  // A bridge always connects at a chain's endpoint (first or last point).
  // We orient the chain so the attach point is at the END, then always append.
  // After all merges, we reverse the final rail once so rail_start is at index 0.
  // ---------------------------------------------------------------------------
  if (freeLines && freeLines.length > 0) {
    const chainById: Record<string, { x: number; y: number }[]> = {};
    const segToChain: Record<string, string> = {};

    for (let i = 0; i < allSegments.length; i++) {
      const sid = segmentIdByIndex[i];
      if (sid) {
        chainById[sid] = [...allSegments[i]];
        segToChain[sid] = sid;
      }
    }

    const resolveChainOf = (segId: string): [string, { x: number; y: number }[]] | null => {
      const cid = segToChain[segId];
      return cid && chainById[cid] ? [cid, chainById[cid]] : null;
    };

    /** Which end of `pts` is closer to `world`? Returns the endpoint position. Reverses `pts` in-place so the matched end is always at pts[last]. */
    const orientChainToward = (pts: { x: number; y: number }[], world: { x: number; y: number }): { x: number; y: number } => {
      const dFirst = Math.hypot(world.x - pts[0].x, world.y - pts[0].y);
      const dLast = Math.hypot(world.x - pts[pts.length - 1].x, world.y - pts[pts.length - 1].y);
      if (dFirst < dLast) pts.reverse(); // attach is at pts[0] → flip so it's at pts[last]
      return pts[pts.length - 1];
    };

    /** Orient `pts` so the point closest to `world` is at pts[0] (for target joining). */
    const orientChainAwayFrom = (pts: { x: number; y: number }[], world: { x: number; y: number }) => {
      const dFirst = Math.hypot(world.x - pts[0].x, world.y - pts[0].y);
      const dLast = Math.hypot(world.x - pts[pts.length - 1].x, world.y - pts[pts.length - 1].y);
      if (dLast < dFirst) pts.reverse(); // match is at pts[last] → flip so it's at pts[0]
    };

    const mergeTarget = (chainId: string, pts: { x: number; y: number }[], endWorld: { x: number; y: number }, mergeChainId: string) => {
      const mPts = chainById[mergeChainId];
      if (!mPts) return;
      // Orient target so the join point is at mPts[0]
      orientChainAwayFrom(mPts, endWorld);
      // Append target (skip mPts[0] = shared join point)
      for (let i = 1; i < mPts.length; i++) pts.push(mPts[i]);
      for (const [sid, cid] of Object.entries(segToChain)) {
        if (cid === mergeChainId) segToChain[sid] = chainId;
      }
      delete chainById[mergeChainId];
    };

    for (const fl of freeLines) {
      const attachWorld = fl.attachWorld ?? fl.end;

      const res = resolveChainOf(fl.attach.segmentId);
      if (!res) {
        // Attach segment was erased — create an orphan chain from the bridge
        if (!fl.attachWorld) continue;
        let endWorld = fl.end;
        let floatMergeChainId: string | null = null;
        if (fl.target) {
          const tgtRes = resolveChainOf(fl.target.segmentId);
          if (tgtRes) {
            const [tgtChainId, tgtPts] = tgtRes;
            if (tgtChainId && tgtPts.length > 0) {
              // Use whichever end of target chain is closer to fl.end
              const dFirst = Math.hypot(fl.end.x - tgtPts[0].x, fl.end.y - tgtPts[0].y);
              const dLast = Math.hypot(fl.end.x - tgtPts[tgtPts.length - 1].x, fl.end.y - tgtPts[tgtPts.length - 1].y);
              endWorld = dFirst <= dLast ? tgtPts[0] : tgtPts[tgtPts.length - 1];
              floatMergeChainId = tgtChainId;
            }
          }
        }
        const raw = fl.waypoints && fl.waypoints.length > 0
          ? samplePolylineWorld([fl.attachWorld, ...fl.waypoints, endWorld])
          : sampleLineWorld(fl.attachWorld, endWorld);
        if (raw.length < 2) continue;
        raw[0] = fl.attachWorld;
        raw[raw.length - 1] = endWorld;
        const floatId = `orphan_${fl.attachWorld.x.toFixed(0)}_${fl.attachWorld.y.toFixed(0)}`;
        chainById[floatId] = raw;
        if (floatMergeChainId) {
          mergeTarget(floatId, raw, endWorld, floatMergeChainId);
        }
        continue;
      }

      const [chainId, pts] = res;

      // Orient chain so the attach world position is at pts[last]
      const startPt = orientChainToward(pts, attachWorld);

      // Resolve bridge end: use whichever end of the target chain is closest to fl.end
      let endWorld = fl.end;
      let mergeChainId: string | null = null;

      if (fl.target) {
        const tgtRes = resolveChainOf(fl.target.segmentId);
        if (tgtRes) {
          const [tgtChainId, tgtPts] = tgtRes;
          if (tgtChainId !== chainId && tgtPts.length > 0) {
            const dFirst = Math.hypot(fl.end.x - tgtPts[0].x, fl.end.y - tgtPts[0].y);
            const dLast = Math.hypot(fl.end.x - tgtPts[tgtPts.length - 1].x, fl.end.y - tgtPts[tgtPts.length - 1].y);
            endWorld = dFirst <= dLast ? tgtPts[0] : tgtPts[tgtPts.length - 1];
            mergeChainId = tgtChainId;
          }
        }
      }

      // Build bridge — use waypoints polyline if this is a drawn rail
      const raw = fl.waypoints && fl.waypoints.length > 0
        ? samplePolylineWorld([startPt, ...fl.waypoints, endWorld])
        : sampleLineWorld(startPt, endWorld);
      if (raw.length < 2) continue;
      raw[0] = startPt;
      raw[raw.length - 1] = endWorld;

      // Always append bridge (pts[last] = startPt = raw[0], so skip raw[0])
      for (let i = 1; i < raw.length; i++) pts.push(raw[i]);

      // Merge target chain if the bridge connects to a different chain
      if (mergeChainId) {
        mergeTarget(chainId, pts, endWorld, mergeChainId);
      }
    }

    // Rebuild allSegments: main chain (containing segment 0) goes first
    const mainChainId = segToChain[segmentIdByIndex[0]];
    const newAllSegs: { x: number; y: number }[][] = [];
    const addedChains = new Set<string>();
    if (mainChainId && chainById[mainChainId]) {
      newAllSegs.push(chainById[mainChainId]);
      addedChains.add(mainChainId);
    }
    for (const [cid, cPts] of Object.entries(chainById)) {
      if (!addedChains.has(cid)) {
        newAllSegs.push(cPts);
        addedChains.add(cid);
      }
    }
    railPoints = newAllSegs[0] ?? allSegments[0] ?? [];
    allSegments.splice(0, allSegments.length, ...newAllSegs);

    // Final orientation: ensure railPoints[0] is near rail_start tile.
    // Chains are directionless — riding direction is determined solely by
    // where the player spawns (rail_start).
    if (startKey && railPoints.length >= 2) {
      const startWorld = keyToWorld(startKey);
      const dFirst = Math.hypot(railPoints[0].x - startWorld.x, railPoints[0].y - startWorld.y);
      const dLast = Math.hypot(railPoints[railPoints.length - 1].x - startWorld.x, railPoints[railPoints.length - 1].y - startWorld.y);
      if (dLast < dFirst) {
        railPoints.reverse();
        allSegments[0] = railPoints;
      }
    }

    // segmentIdByIndex must match the rebuilt allSegments order
    const newSegIds: string[] = [];
    if (mainChainId) newSegIds.push(mainChainId);
    for (const cid of Object.keys(chainById)) {
      if (cid !== mainChainId) newSegIds.push(cid);
    }
    segmentIdByIndex.splice(0, segmentIdByIndex.length, ...newSegIds);

  }

  return { railPoints, allSegments, segmentIdByIndex, obstacles, endTileWorldPos, isLoop };
}

// ─── Unified Segment Builders ────────────────────────────────────────────────

/** Build individual rail segments from editor source data.
 *  Each tool action (tile chain, smooth curve, free line, drawn rail) produces
 *  one IndividualRailSegment with two snappoints at its endpoints. */
export function buildIndividualSegments(
  tiles: Record<string, TileType>,
  connections: Record<string, Set<string>>,
  smoothSegments: SmoothSegment[],
  freeLines: FreeLineSegment[]
): IndividualRailSegment[] {
  const result: IndividualRailSegment[] = [];
  let idCounter = 0;

  // ── Tile-based segments ──────────────────────────────────────────────────
  const railKeys: string[] = [];
  for (const [key, type] of Object.entries(tiles)) {
    if (type === 'rail' || type === 'rail_start' || type === 'rail_end' || type === 'rail_crossing') {
      railKeys.push(key);
    }
  }

  // Smooth segment lookup: sorted pair key → { seg, index }
  const smoothLookup = new Map<string, { seg: SmoothSegment; index: number }>();
  for (let i = 0; i < smoothSegments.length; i++) {
    const s = smoothSegments[i];
    const pairKey = [s.startKey, s.endKey].sort().join('|');
    smoothLookup.set(pairKey, { seg: s, index: i });
  }
  const findSmooth = (a: string, b: string) =>
    smoothLookup.get([a, b].sort().join('|'));

  if (railKeys.length > 0) {
    const crossingKeys = new Set<string>();
    for (const key of railKeys) {
      if (tiles[key] === 'rail_crossing') crossingKeys.add(key);
    }
    const hasCrossings = crossingKeys.size > 0;
    const conns = Object.keys(connections).length > 0
      ? connections
      : {} as Record<string, Set<string>>;
    const components = getRailComponents(
      railKeys, conns, hasCrossings ? crossingKeys : undefined
    );

    for (const comp of components) {
      if (comp.length === 0) continue;

      // Single isolated tile
      if (comp.length === 1) {
        const pt = keyToWorld(comp[0]);
        result.push({
          id: `seg_${idCounter++}`,
          kind: 'tile_chain',
          points: [pt],
          snapA: pt,
          snapB: pt,
          sourceKeys: [comp[0]],
        });
        continue;
      }

      // Walk the component, splitting at smooth segment boundaries.
      // Consecutive straight-connected tiles accumulate into one tile_chain;
      // each smooth curve becomes its own smooth_curve segment.
      let chainKeys: string[] = [comp[0]];

      for (let i = 1; i < comp.length; i++) {
        const prevKey = comp[i - 1];
        const currKey = comp[i];
        const smooth = findSmooth(prevKey, currKey);

        if (smooth) {
          // Flush accumulated tile chain
          if (chainKeys.length >= 2) {
            const points = chainKeys.map(k => keyToWorld(k));
            result.push({
              id: `seg_${idCounter++}`,
              kind: 'tile_chain',
              points,
              snapA: points[0],
              snapB: points[points.length - 1],
              sourceKeys: [...chainKeys],
            });
          }

          // Sample the smooth curve
          const { seg, index } = smooth;
          const wStart = keyToWorld(seg.startKey);
          const wEnd = keyToWorld(seg.endKey);
          const wPivot = { x: seg.pivotGx * GRID_SIZE, y: seg.pivotGy * GRID_SIZE };
          let arcPts = seg.type === 'circular'
            ? sampleCircularArcWorld(wStart, wEnd, wPivot)
            : sampleBezierWorld(wStart, wEnd, wPivot);

          // Ensure arc direction matches walk direction
          if (arcPts.length >= 2) {
            const prevWorld = keyToWorld(prevKey);
            const dFirst = Math.hypot(arcPts[0].x - prevWorld.x, arcPts[0].y - prevWorld.y);
            const dLast = Math.hypot(arcPts[arcPts.length - 1].x - prevWorld.x, arcPts[arcPts.length - 1].y - prevWorld.y);
            if (dLast < dFirst) arcPts = [...arcPts].reverse();
          }

          result.push({
            id: `seg_${idCounter++}`,
            kind: 'smooth_curve',
            points: arcPts,
            snapA: arcPts[0],
            snapB: arcPts[arcPts.length - 1],
            sourceSmoothIndex: index,
            sourceKeys: [prevKey, currKey],
          });

          // Start a new chain from the current key
          chainKeys = [currKey];
        } else {
          chainKeys.push(currKey);
        }
      }

      // Flush remaining tile chain (skip single leftover tiles — they're
      // already represented as a smooth curve's snappoint)
      if (chainKeys.length >= 2) {
        const points = chainKeys.map(k => keyToWorld(k));
        result.push({
          id: `seg_${idCounter++}`,
          kind: 'tile_chain',
          points,
          snapA: points[0],
          snapB: points[points.length - 1],
          sourceKeys: [...chainKeys],
        });
      }
    }
  }

  // ── Free line segments ───────────────────────────────────────────────────
  for (let i = 0; i < freeLines.length; i++) {
    const fl = freeLines[i];
    const startPt = fl.attachWorld ?? fl.end;
    const endPt = fl.end;

    let points: { x: number; y: number }[];
    if (fl.waypoints && fl.waypoints.length > 0) {
      points = [startPt, ...fl.waypoints, endPt];
    } else {
      points = [startPt, endPt];
    }

    result.push({
      id: `seg_${idCounter++}`,
      kind: fl.rawDrawnPoints ? 'drawn_rail' : 'free_line',
      points,
      snapA: points[0],
      snapB: points[points.length - 1],
      sourceFreeLineIndex: i,
    });
  }

  return result;
}

/** Group individual segments into continuous segments by matching snappoints. */
export function buildContinuousSegments(
  individualSegments: IndividualRailSegment[]
): ContinuousRailSegment[] {
  const n = individualSegments.length;
  if (n === 0) return [];

  const SNAP_TOLERANCE = 2; // px

  // Build adjacency based on snappoint proximity
  const adj: Set<number>[] = Array.from({ length: n }, () => new Set());
  for (let i = 0; i < n; i++) {
    const si = individualSegments[i];
    for (let j = i + 1; j < n; j++) {
      const sj = individualSegments[j];
      if (
        Math.hypot(si.snapA.x - sj.snapA.x, si.snapA.y - sj.snapA.y) < SNAP_TOLERANCE ||
        Math.hypot(si.snapA.x - sj.snapB.x, si.snapA.y - sj.snapB.y) < SNAP_TOLERANCE ||
        Math.hypot(si.snapB.x - sj.snapA.x, si.snapB.y - sj.snapA.y) < SNAP_TOLERANCE ||
        Math.hypot(si.snapB.x - sj.snapB.x, si.snapB.y - sj.snapB.y) < SNAP_TOLERANCE
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
      individualIds: component.map(idx => individualSegments[idx].id),
    });
  }

  return result;
}

/** Extract all snappoints from individual segments. */
export function getSnapPoints(
  individualSegments: IndividualRailSegment[]
): SnapPoint[] {
  const result: SnapPoint[] = [];
  for (const seg of individualSegments) {
    result.push({ segmentId: seg.id, point: seg.snapA, endpoint: 'A' });
    // Only add snapB if distinct from snapA (skip degenerate single-point segments)
    if (Math.hypot(seg.snapA.x - seg.snapB.x, seg.snapA.y - seg.snapB.y) > 1) {
      result.push({ segmentId: seg.id, point: seg.snapB, endpoint: 'B' });
    }
  }
  return result;
}
