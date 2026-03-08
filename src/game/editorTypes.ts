export const GRID_SIZE = 50;
export const EDITOR_WIDTH = 200; // grid cells wide
export const EDITOR_HEIGHT = 16; // grid cells tall

export type TileType = 'empty' | 'rail' | 'spinner' | 'bouncer';
export type EditorTool = 'rail' | 'spinner' | 'bouncer' | 'eraser' | 'arc';

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
export function convertLevelToGameData(tiles: Record<string, TileType>) {
  const railPoints: { x: number; y: number }[] = [];
  const obstacles: { type: 'spinner' | 'bouncer'; gx: number; gy: number }[] = [];

  // Collect all tiles by type
  for (const [key, type] of Object.entries(tiles)) {
    const [gx, gy] = parseTileKey(key);
    if (type === 'rail') {
      railPoints.push({ x: gx, y: gy });
    } else if (type === 'spinner' || type === 'bouncer') {
      obstacles.push({ type, gx, gy });
    }
  }

  // Sort rail points left to right, then by y for same x
  railPoints.sort((a, b) => a.x - b.x || a.y - b.y);

  return { railPoints, obstacles };
}
