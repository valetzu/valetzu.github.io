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
  /** Stable segment id per index (so Line 2 doesn't break when start tile moves) */
  segmentIdByIndex: string[];
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
    const segmentIdByIndex = rawRail.length > 0 ? [componentId(railKeys)] : [];
    return { railPoints: rawRail, allSegments: rawRail.length > 0 ? [rawRail] : [], segmentIdByIndex, obstacles, endSegmentIndex: null, endPointIndex: null };
  }

  const conns = connections && Object.keys(connections).length > 0 ? connections : ({} as Record<string, Set<string>>);
  const components = getRailComponents(railKeys, conns);

  // Hoist endKey so it's available in the freeLine post-processing block
  const endKey = railKeys.find(k => tiles[k] === 'rail_end');

  let railPoints: { x: number; y: number }[] = [];
  let endSegmentIndex: number | null = null;
  let endPointIndex: number | null = null;
  const allSegments: { x: number; y: number }[][] = [];
  const segmentIdByIndex: string[] = [];

  if (conns && Object.keys(conns).length > 0) {
    const startKey = railKeys.find(k => tiles[k] === 'rail_start')
      || railKeys.find(k => conns[k] && conns[k].size === 1)
      || railKeys[0];

    const startOrdered = walkRailComponent(startKey, conns);
    const expanded = expandPathWithSmoothSegments(startOrdered, smoothSegments);
    railPoints = expanded.points;
    if (endKey && expanded.keyToLastIndex[endKey] != null) {
      endSegmentIndex = 0;
      endPointIndex = expanded.keyToLastIndex[endKey];
    }

    allSegments.push(railPoints);
    segmentIdByIndex.push(componentId(startOrdered));
    const startSet = new Set(startOrdered);
    let segIdx = 1;
    for (const comp of components) {
      if (comp.some(k => startSet.has(k))) continue;
      const { points: pts, keyToLastIndex: compKeyToIdx } = expandPathWithSmoothSegments(comp, smoothSegments);
      // Include even single-tile components so Line 2 can reliably
      // target hand-placed isolated rail tiles.
      if (pts.length >= 1) {
        if (endKey && endSegmentIndex === null && comp.includes(endKey)) {
          endSegmentIndex = segIdx;
          endPointIndex = compKeyToIdx[endKey] ?? comp.indexOf(endKey);
        }
        allSegments.push(pts);
        segmentIdByIndex.push(componentId(comp));
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
    segmentIdByIndex.push(componentId(sorted));
    if (endKey && expanded.keyToLastIndex[endKey] != null) {
      endSegmentIndex = 0;
      endPointIndex = expanded.keyToLastIndex[endKey];
    }
  }

  // Apply each freeLine independently per chain.
  // Each tile-based segment starts as its own chain. A freeLine only extends the chain
  // it is explicitly attached to; freeLines on different chains stay isolated.
  // Only when a freeLine has a target does it merge the target chain into the attach chain.
  if (freeLines && freeLines.length > 0) {
    // chainById[chainId] = mutable point array for that chain
    const chainById: Record<string, { x: number; y: number }[]> = {};
    // segToChain[segmentId] = which chainId currently owns that segment
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

    const closestIndex = (pts: { x: number; y: number }[], world: { x: number; y: number }) => {
      let bestI = 0, bestD = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const d = Math.hypot(pts[i].x - world.x, pts[i].y - world.y);
        if (d < bestD) { bestD = d; bestI = i; }
      }
      return bestI;
    };

    for (const fl of freeLines) {
      const res = resolveChainOf(fl.attach.segmentId);
      if (!res) {
        // Attach segment was erased. If we have a cached world position, create a floating chain
        // so the segment still exists for in-game physics and its endpoints remain snap-able.
        if (!fl.attachWorld) continue;
        let floatEnd = fl.end;
        let floatMergeChainId: string | null = null;
        if (fl.target) {
          const tgtRes = resolveChainOf(fl.target.segmentId);
          if (tgtRes) {
            const [tgtChainId, tgtPts] = tgtRes;
            if (tgtPts.length > 0) {
              floatEnd = fl.target.endpoint === 'end' ? tgtPts[tgtPts.length - 1] : tgtPts[0];
              floatMergeChainId = tgtChainId;
            }
          }
        }
        const raw = sampleLineWorld(fl.attachWorld, floatEnd);
        if (raw.length < 2) continue;
        const floatPts = raw.slice();
        floatPts[0] = fl.attachWorld;
        floatPts[floatPts.length - 1] = floatEnd;
        const floatId = `orphan_${fl.attachWorld.x.toFixed(0)}_${fl.attachWorld.y.toFixed(0)}`;
        chainById[floatId] = floatPts;
        if (floatMergeChainId) {
          const mPts = chainById[floatMergeChainId];
          if (mPts) {
            const df = Math.hypot(floatEnd.x - mPts[0].x, floatEnd.y - mPts[0].y);
            const dl = Math.hypot(floatEnd.x - mPts[mPts.length - 1].x, floatEnd.y - mPts[mPts.length - 1].y);
            const oriented = df <= dl ? mPts : [...mPts].reverse();
            for (let i = 1; i < oriented.length; i++) chainById[floatId].push(oriented[i]);
            for (const [sid, cid] of Object.entries(segToChain)) {
              if (cid === floatMergeChainId) segToChain[sid] = floatId;
            }
            delete chainById[floatMergeChainId];
          }
        }
        continue;
      }
      const [chainId, pts] = res;

      // Determine attach position and whether we extend from the chain's end or start
      let startPt: { x: number; y: number };
      let appendToEnd: boolean;

      if ('endpoint' in fl.attach) {
        appendToEnd = fl.attach.endpoint === 'end';
        startPt = appendToEnd ? pts[pts.length - 1] : pts[0];
      } else {
        const world = 'atWorld' in fl.attach
          ? fl.attach.atWorld
          : (fl.attachWorld ?? fl.end);
        const bestI = closestIndex(pts, world);
        // If the closest point is in the second half, extend from the end; otherwise from the start
        appendToEnd = bestI >= pts.length / 2;
        startPt = pts[bestI];
      }

      // Resolve the bridge's end point; use the target's exact endpoint vertex if snapped
      let endWorld = fl.end;
      let mergeChainId: string | null = null;

      if (fl.target) {
        const tgtRes = resolveChainOf(fl.target.segmentId);
        if (tgtRes) {
          const [tgtChainId, tgtPts] = tgtRes;
          if (tgtChainId !== chainId && tgtPts.length > 0) {
            endWorld = fl.target.endpoint === 'end'
              ? tgtPts[tgtPts.length - 1]
              : tgtPts[0];
            mergeChainId = tgtChainId;
          }
        }
      }

      // Build the bridge polyline with exact endpoints
      const raw = sampleLineWorld(startPt, endWorld);
      if (raw.length < 2) continue;
      const bridge = raw.slice();
      bridge[0] = startPt;
      bridge[bridge.length - 1] = endWorld;

      if (appendToEnd) {
        // Append bridge (skip bridge[0] = startPt, already the last point of pts)
        for (let i = 1; i < bridge.length; i++) pts.push(bridge[i]);

        if (mergeChainId) {
          const mPts = chainById[mergeChainId];
          if (mPts) {
            const df = Math.hypot(endWorld.x - mPts[0].x, endWorld.y - mPts[0].y);
            const dl = Math.hypot(endWorld.x - mPts[mPts.length - 1].x, endWorld.y - mPts[mPts.length - 1].y);
            const oriented = df <= dl ? mPts : [...mPts].reverse();
            // Append target (skip oriented[0] = endWorld, shared with bridge end)
            for (let i = 1; i < oriented.length; i++) pts.push(oriented[i]);
            for (const [sid, cid] of Object.entries(segToChain)) {
              if (cid === mergeChainId) segToChain[sid] = chainId;
            }
            delete chainById[mergeChainId];
          }
        }
      } else {
        // Prepend: bridge goes pts[0] → endWorld; path becomes [endWorld, …, bridge, pts[0], pts[1], …]
        const toInsert = bridge.slice(1).reverse(); // [endWorld, …, bridge[1]] (pts[0] already in pts)
        pts.splice(0, 0, ...toInsert);

        if (mergeChainId) {
          const mPts = chainById[mergeChainId];
          if (mPts) {
            // Orient so oriented[last] = endWorld (now pts[0] after prepend above)
            const df = Math.hypot(endWorld.x - mPts[0].x, endWorld.y - mPts[0].y);
            const dl = Math.hypot(endWorld.x - mPts[mPts.length - 1].x, endWorld.y - mPts[mPts.length - 1].y);
            const oriented = dl <= df ? mPts : [...mPts].reverse();
            // Prepend target (skip oriented[last] = endWorld, shared point)
            const toIns = oriented.slice(0, -1);
            pts.splice(0, 0, ...toIns);
            for (const [sid, cid] of Object.entries(segToChain)) {
              if (cid === mergeChainId) segToChain[sid] = chainId;
            }
            delete chainById[mergeChainId];
          }
        }
      }
    }

    // Rebuild allSegments: main chain (the one containing segment 0) goes first
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

    // segmentIdByIndex must match the rebuilt allSegments order
    const newSegIds: string[] = [];
    if (mainChainId) newSegIds.push(mainChainId);
    for (const cid of Object.keys(chainById)) {
      if (cid !== mainChainId) newSegIds.push(cid);
    }
    segmentIdByIndex.splice(0, segmentIdByIndex.length, ...newSegIds);

    // Recompute endSegmentIndex/endPointIndex against the rebuilt segments
    // (a freeLine merge may have moved the end tile into a different segment)
    if (endKey) {
      const endWorld = keyToWorld(endKey);
      endSegmentIndex = null;
      endPointIndex = null;
      outer: for (let si = 0; si < newAllSegs.length; si++) {
        const seg = newAllSegs[si];
        for (let pi = 0; pi < seg.length; pi++) {
          if (Math.hypot(seg[pi].x - endWorld.x, seg[pi].y - endWorld.y) < GRID_SIZE * 0.6) {
            endSegmentIndex = si;
            endPointIndex = pi;
            break outer;
          }
        }
      }
    }
  }

  return { railPoints, allSegments, segmentIdByIndex, obstacles, endSegmentIndex, endPointIndex };
}
