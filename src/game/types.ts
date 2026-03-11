export type WorldType = 'overworld' | 'ice' | 'moon';

export interface Upgrades {
  motor: number;   // 0-5
  health: number;  // 0-5
  grip: number;    // 0-5
  rocket: number;  // 0-3
  shield: number;  // 0-3
}

export interface SaveData {
  cash: number;
  upgrades: Upgrades;
  records: Record<WorldType, number>;
}

export interface Point {
  x: number;
  y: number;
}

// Basic entity identity; more detail in entityTypes.ts
export type EntityId = string;

export interface Obstacle {
  id: EntityId;
  // Logical type identifier used by the sprite system
  typeId: 'obstacle.spinner' | 'obstacle.bouncer' | 'obstacle.staticRock';
  type: 'spinner' | 'bouncer' | 'static';
  x: number;
  y: number;
  radius: number;
  angle: number;
  rotSpeed: number;
  baseY: number;
  amplitude: number;
  bounceSpeed: number;
  armLength: number;
  hit: boolean;
}

export const DEFAULT_UPGRADES: Upgrades = {
  motor: 0, health: 0, grip: 0, rocket: 0, shield: 0
};

export const DEFAULT_SAVE: SaveData = {
  cash: 0,
  upgrades: { ...DEFAULT_UPGRADES },
  records: { overworld: 0, ice: 0, moon: 0 }
};

export const UPGRADE_COSTS: Record<string, number[]> = {
  motor:  [100, 250, 500, 1000, 2000],
  health: [150, 400, 800, 1500, 3000],
  grip:   [100, 250, 500, 1000, 2000],
  rocket: [200, 500, 1200],
  shield: [200, 500, 1200],
};

export const UPGRADE_MAX: Record<string, number> = {
  motor: 5, health: 5, grip: 5, rocket: 3, shield: 3
};

export const UPGRADE_LABELS: Record<string, string> = {
  motor: '⚡ Motor',
  health: '❤️ Health',
  grip: '🔧 Grip',
  rocket: '🚀 Rocket Boost',
  shield: '🛡️ Shield',
};

export const UPGRADE_DESC: Record<string, string> = {
  motor: 'Increases acceleration and top speed',
  health: 'Extra passenger (extra hit point)',
  grip: 'Better rail control, less sliding',
  rocket: 'Press SPACE for temporary speed boost',
  shield: 'Press SHIFT for brief invulnerability',
};

export const WORLD_CONFIG = {
  overworld: {
    gravity: 800,
    friction: 0.35,
    name: 'Overworld',
    emoji: '🌿',
    skyTop: '#4BA3E3',
    skyBottom: '#87CEEB',
    grassColor: '#4CAF50',
    dirtColor: '#8B6914',
    mountainColor: '#6B8E23',
    snowColor: '#FFFFFF',
  },
  ice: {
    gravity: 800,
    friction: 0.06,
    name: 'Frozen World',
    emoji: '❄️',
    skyTop: '#B0D4F1',
    skyBottom: '#E0F0FF',
    grassColor: '#E8F4FD',
    dirtColor: '#A8C8E0',
    mountainColor: '#C8DFF0',
    snowColor: '#FFFFFF',
  },
  moon: {
    gravity: 160,
    friction: 0.3,
    name: 'Moon',
    emoji: '🌙',
    skyTop: '#0A0A2E',
    skyBottom: '#1A1A4E',
    grassColor: '#555555',
    dirtColor: '#3A3A3A',
    mountainColor: '#444444',
    snowColor: '#666666',
  },
} as const;

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem('cable-riders-save');
    if (raw) return JSON.parse(raw);
  } catch {}
  return { ...DEFAULT_SAVE, upgrades: { ...DEFAULT_UPGRADES }, records: { overworld: 0, ice: 0, moon: 0 } };
}

export function saveSave(data: SaveData) {
  localStorage.setItem('cable-riders-save', JSON.stringify(data));
}
