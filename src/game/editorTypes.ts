export const GRID_SIZE = 50;
export const EDITOR_WIDTH = 200; // grid cells wide
export const EDITOR_HEIGHT = 16; // grid cells tall

export type TileType = 'empty' | 'rail' | 'rail_start' | 'rail_end' | 'spinner' | 'bouncer';
export type EditorTool = 'rail' | 'rail_start' | 'rail_end' | 'spinner' | 'bouncer' | 'eraser' | 'arc' | 'curve' | 'line';

export interface EditorTile {
  type: TileType;
}

export interface EditorLevel {
  name: string;
  tiles: Record<string, TileType>; // "x,y" -> type
  createdAt: number;
}

export function tileKey(gx: number, gy: number): string {
  return `${gx},${gy}`;
}

export function parseTileKey(key: string): [number, number] {
  const [x, y] = key.split(',').map(Number);
  return [x, y];
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
// Returns start segment, ALL segments, and which segment+point is the end tile (for completion on any segment)
export function convertLevelToGameData(
  tiles: Record<string, TileType>,
  connections?: Record<string, Set<string>>
): {
  railPoints: { x: number; y: number }[];
  allSegments: { x: number; y: number }[][];
  obstacles: { type: 'spinner' | 'bouncer'; gx: number; gy: number }[];
  /** Index in allSegments of the segment that contains the end tile */
  endSegmentIndex: number | null;
  /** Index within that segment of the end tile */
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
    const rawRail = railKeys.map(k => {
      const [gx, gy] = parseTileKey(k);
      return { x: gx * GRID_SIZE, y: gy * GRID_SIZE };
    });
    return { railPoints: rawRail, allSegments: rawRail.length > 0 ? [rawRail] : [], obstacles, endSegmentIndex: null, endPointIndex: null };
  }

  const conns = connections && Object.keys(connections).length > 0 ? connections : ({} as Record<string, Set<string>>);
  const components = getRailComponents(railKeys, conns);

  const keyToPoints = (keys: string[]) =>
    keys.map(k => {
      const [gx, gy] = parseTileKey(k);
      return { x: gx * GRID_SIZE, y: gy * GRID_SIZE };
    });

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
    railPoints = keyToPoints(startOrdered);
    if (endKey && startOrdered.includes(endKey)) {
      endSegmentIndex = 0;
      endPointIndex = startOrdered.indexOf(endKey);
    }

    allSegments.push(railPoints);
    const startSet = new Set(startOrdered);
    let segIdx = 1;
    for (const comp of components) {
      if (comp.some(k => startSet.has(k))) continue;
      const pts = keyToPoints(comp);
      if (pts.length >= 2) {
        if (endKey && endSegmentIndex === null && comp.includes(endKey)) {
          endSegmentIndex = segIdx;
          endPointIndex = comp.indexOf(endKey);
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
    railPoints = keyToPoints(sorted);
    allSegments.push(railPoints);
    const endKey = railKeys.find(k => tiles[k] === 'rail_end');
    if (endKey) {
      const idx = sorted.indexOf(endKey);
      if (idx >= 0) {
        endSegmentIndex = 0;
        endPointIndex = idx;
      }
    }
  }

  return { railPoints, allSegments, obstacles, endSegmentIndex, endPointIndex };
}
