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

// Convert editor tiles to game-compatible rail + obstacles
// Uses explicit connection graph to preserve intended rail order
export function convertLevelToGameData(
  tiles: Record<string, TileType>,
  connections?: Record<string, Set<string>>
) {
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
    return { railPoints: rawRail, obstacles };
  }

  // Build ordered rail by walking the connection graph
  let orderedRail: { x: number; y: number }[] = [];

  if (connections && Object.keys(connections).length > 0) {
    // Find start tile (rail_start, or a tile with only 1 connection, or first rail)
    let startKey = railKeys.find(k => tiles[k] === 'rail_start');
    if (!startKey) {
      startKey = railKeys.find(k => connections[k] && connections[k].size === 1);
    }
    if (!startKey) startKey = railKeys[0];

    // Walk the graph
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

    orderedRail = ordered.map(k => {
      const [gx, gy] = parseTileKey(k);
      return { x: gx * GRID_SIZE, y: gy * GRID_SIZE };
    });
  } else {
    // Fallback: sort by x then y (legacy behavior)
    orderedRail = railKeys.map(k => {
      const [gx, gy] = parseTileKey(k);
      return { x: gx * GRID_SIZE, y: gy * GRID_SIZE };
    });
    orderedRail.sort((a, b) => a.x - b.x || a.y - b.y);
  }

  if (orderedRail.length < 2) {
    return { railPoints: orderedRail, obstacles };
  }

  // Resample the path at uniform RAIL_SPACING intervals along arc-length
  const RAIL_SPACING = 100;

  const cumDist: number[] = [0];
  for (let i = 1; i < orderedRail.length; i++) {
    const dx = orderedRail[i].x - orderedRail[i - 1].x;
    const dy = orderedRail[i].y - orderedRail[i - 1].y;
    cumDist.push(cumDist[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  const totalLength = cumDist[cumDist.length - 1];

  const resampled: { x: number; y: number }[] = [];
  let segIdx = 0;

  for (let d = 0; d <= totalLength; d += RAIL_SPACING) {
    while (segIdx < cumDist.length - 2 && cumDist[segIdx + 1] < d) segIdx++;

    const segLen = cumDist[segIdx + 1] - cumDist[segIdx];
    if (segLen === 0) {
      resampled.push({ ...orderedRail[segIdx] });
    } else {
      const t = (d - cumDist[segIdx]) / segLen;
      resampled.push({
        x: orderedRail[segIdx].x + t * (orderedRail[segIdx + 1].x - orderedRail[segIdx].x),
        y: orderedRail[segIdx].y + t * (orderedRail[segIdx + 1].y - orderedRail[segIdx].y),
      });
    }
  }

  // Always include the last point
  const last = orderedRail[orderedRail.length - 1];
  const lastResampled = resampled[resampled.length - 1];
  if (!lastResampled || Math.abs(lastResampled.x - last.x) > 1 || Math.abs(lastResampled.y - last.y) > 1) {
    resampled.push({ ...last });
  }

  // Remap x to sequential spacing for engine
  const railPoints = resampled.map((p, i) => ({ x: i * RAIL_SPACING, y: p.y }));

  return { railPoints, obstacles };
}
