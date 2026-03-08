export const GRID_SIZE = 50;
export const EDITOR_WIDTH = 200; // grid cells wide
export const EDITOR_HEIGHT = 16; // grid cells tall

export type TileType = 'empty' | 'rail' | 'rail_start' | 'rail_end' | 'spinner' | 'bouncer';
export type EditorTool = 'rail' | 'rail_start' | 'rail_end' | 'spinner' | 'bouncer' | 'eraser' | 'arc' | 'curve';

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
// Resamples rail to uniform RAIL_SPACING (100px) intervals for engine compatibility
export function convertLevelToGameData(tiles: Record<string, TileType>) {
  const rawRail: { x: number; y: number }[] = [];
  const obstacles: { type: 'spinner' | 'bouncer'; gx: number; gy: number }[] = [];

  for (const [key, type] of Object.entries(tiles)) {
    const [gx, gy] = parseTileKey(key);
    if (type === 'rail' || type === 'rail_start' || type === 'rail_end') {
      rawRail.push({ x: gx * GRID_SIZE, y: gy * GRID_SIZE });
    } else if (type === 'spinner' || type === 'bouncer') {
      obstacles.push({ type, gx, gy });
    }
  }

  // Sort by x then y
  rawRail.sort((a, b) => a.x - b.x || a.y - b.y);

  if (rawRail.length < 2) {
    return { railPoints: rawRail, obstacles };
  }

  // Resample the rail path at uniform RAIL_SPACING (100px) intervals
  const RAIL_SPACING = 100;
  const resampled: { x: number; y: number }[] = [];
  
  // Build cumulative distances along the polyline
  const totalDist: number[] = [0];
  for (let i = 1; i < rawRail.length; i++) {
    const dx = rawRail[i].x - rawRail[i - 1].x;
    const dy = rawRail[i].y - rawRail[i - 1].y;
    totalDist.push(totalDist[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }

  // Walk through at RAIL_SPACING intervals using x-coordinate
  const minX = rawRail[0].x;
  const maxX = rawRail[rawRail.length - 1].x;
  
  for (let x = minX; x <= maxX; x += RAIL_SPACING) {
    // Find the two raw points that bracket this x
    let idx = 0;
    while (idx < rawRail.length - 1 && rawRail[idx + 1].x < x) idx++;
    
    if (idx >= rawRail.length - 1) {
      resampled.push({ x, y: rawRail[rawRail.length - 1].y });
    } else if (rawRail[idx].x === rawRail[idx + 1].x) {
      resampled.push({ x, y: rawRail[idx].y });
    } else {
      const t = (x - rawRail[idx].x) / (rawRail[idx + 1].x - rawRail[idx].x);
      const y = rawRail[idx].y + t * (rawRail[idx + 1].y - rawRail[idx].y);
      resampled.push({ x, y });
    }
  }

  // Remap to engine format: rail[i].x = i * RAIL_SPACING
  const railPoints = resampled.map((p, i) => ({ x: i * RAIL_SPACING, y: p.y }));

  return { railPoints, obstacles };
}
