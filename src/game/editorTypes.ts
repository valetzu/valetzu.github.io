export const GRID_SIZE = 50;
export const EDITOR_WIDTH = 200; // grid cells wide
export const EDITOR_HEIGHT = 16; // grid cells tall

export type TileType = 'empty' | 'rail' | 'rail_start' | 'rail_end' | 'spinner' | 'bouncer';
export type EditorTool =
  | 'rail'
  | 'rail_start'
  | 'rail_end'
  | 'spinner'
  | 'bouncer'
  | 'eraser'
  | 'arc'
  | 'curve'
  | 'circular_curve'
  | 'circle'
  | 'line'
  | 'line2';

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

export interface FreeLineSegment {
  attach: { segmentIndex: number; endpoint: 'start' | 'end' };
  end: { x: number; y: number };
}

export interface EditorLevel {
  name: string;
  tiles: Record<string, TileType>; // "x,y" -> type
  createdAt: number;
  // Optional explicit rail connection graph: tileKey -> array of connected tileKeys.
  connections?: Record<string, string[]>;
  /** Smooth arcs/curves between tiles; expanded to dense world points for game rail */
  smoothSegments?: SmoothSegment[];
  /** World-space line extensions attached to main rail */
  freeLines?: FreeLineSegment[];
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
      const worldA = keyToWorldPt(keyA);
      const worldB = keyToWorldPt(keyB);
      const worldPivot = { x: seg.pivotGx * GRID_SIZE, y: seg.pivotGy * GRID_SIZE };
      const arcPts = seg.type === 'circular'
        ? sampleCircularArcWorld(worldA, worldB, worldPivot)
        : sampleBezierWorld(worldA, worldB, worldPivot);
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

// Walk one connected component from startKey, return ordered keys
function walkRailComponent(
  startKey: string,
  connections: Record<string, Set<string>>
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
    for (const n of neighbors) {
      if (!visited.has(n)) {
        next = n;
        break;
      }
    }
    current = next;
  }
  return ordered;
}

// Find connected components of the rail graph
function getRailComponents(
  railKeys: string[],
  connections: Record<string, Set<string>>
): string[][] {
  const seen = new Set<string>();
  const components: string[][] = [];
  for (const key of railKeys) {
    if (seen.has(key)) continue;
    const comp = walkRailComponent(key, connections);
    for (const k of comp) seen.add(k);
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
  freeLines?: FreeLineSegment[]
): {
  railPoints: { x: number; y: number }[];
  allSegments: { x: number; y: number }[][];
  obstacles: { type: 'spinner' | 'bouncer'; gx: number; gy: number }[];
  endSegmentIndex: number | null;
  endPointIndex: number | null;
} {
  const obstacles: { type: 'spinner' | 'bouncer'; gx: number; gy: number }[] = [];
  const railKeys: string[] = [];

  for (const [key, type] of Object.entries(tiles)) {
    if (type === 'rail' || type === 'rail_start' || type === 'rail_end') {
      railKeys.push(key);
    } else if (type === 'spinner' || type === 'bouncer') {
      const [gx, gy] = parseTileKey(key);
      obstacles.push({ type, gx, gy });
    }
  }

  if (railKeys.length < 2) {
    const rawRail = railKeys.map(k => keyToWorld(k));
    return { railPoints: rawRail, allSegments: rawRail.length > 0 ? [rawRail] : [], obstacles, endSegmentIndex: null, endPointIndex: null };
  }

  const conns = connections && Object.keys(connections).length > 0 ? connections : ({} as Record<string, Set<string>>);
  const components = getRailComponents(railKeys, conns);

  let railPoints: { x: number; y: number }[] = [];
  let endSegmentIndex: number | null = null;
  let endPointIndex: number | null = null;
  const allSegments: { x: number; y: number }[][] = [];

  if (conns && Object.keys(conns).length > 0) {
    const startKey = railKeys.find(k => tiles[k] === 'rail_start')
      || railKeys.find(k => conns[k] && conns[k].size === 1)
      || railKeys[0];
    const endKey = railKeys.find(k => tiles[k] === 'rail_end');

    const startOrdered = walkRailComponent(startKey, conns);
    const expanded = expandPathWithSmoothSegments(startOrdered, smoothSegments);
    railPoints = expanded.points;
    if (endKey && expanded.keyToLastIndex[endKey] != null) {
      endSegmentIndex = 0;
      endPointIndex = expanded.keyToLastIndex[endKey];
    }

    allSegments.push(railPoints);
    const startSet = new Set(startOrdered);
    let segIdx = 1;
    for (const comp of components) {
      if (comp.some(k => startSet.has(k))) continue;
      const { points: pts, keyToLastIndex: compKeyToIdx } = expandPathWithSmoothSegments(comp, smoothSegments);
      if (pts.length >= 2) {
        if (endKey && endSegmentIndex === null && comp.includes(endKey)) {
          endSegmentIndex = segIdx;
          endPointIndex = compKeyToIdx[endKey] ?? comp.indexOf(endKey);
        }
        allSegments.push(pts);
        segIdx++;
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
    const endKey = railKeys.find(k => tiles[k] === 'rail_end');
    if (endKey && expanded.keyToLastIndex[endKey] != null) {
      endSegmentIndex = 0;
      endPointIndex = expanded.keyToLastIndex[endKey];
    }
  }

  // Apply any attached free-line extensions to whichever segment endpoint they attach to.
  if (freeLines && freeLines.length > 0) {
    for (const fl of freeLines) {
      const seg = allSegments[fl.attach.segmentIndex];
      if (!seg || seg.length < 1) continue;
      if (fl.attach.endpoint === 'end') {
        const startPt = seg[seg.length - 1];
        const segPts = sampleLineWorld(startPt, fl.end);
        for (let i = 1; i < segPts.length; i++) seg.push(segPts[i]);
      } else {
        const startPt = seg[0];
        const segPts = sampleLineWorld(fl.end, startPt);
        allSegments[fl.attach.segmentIndex] = [...segPts.slice(0, -1), ...seg];
      }
    }
    // Keep railPoints pointing at segment 0
    railPoints = allSegments[0] ?? railPoints;
  }

  return { railPoints, allSegments, obstacles, endSegmentIndex, endPointIndex };
}
