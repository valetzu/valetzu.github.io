import { Obstacle } from './types';
import { EntityTypeId } from './entityTypes';

// ---------------------------------------------------------------------------
// Reach zone geometry primitives
// ---------------------------------------------------------------------------

export type ObstacleReachZone =
  | { kind: 'circle'; radius: number; color: string }
  | { kind: 'ring'; innerRadius: number; outerRadius: number; color: string }
  | { kind: 'arc'; radius: number; startAngle: number; span: number; offsetX: number; offsetY: number; color: string }
  | { kind: 'rect'; width: number; height: number; offsetX: number; offsetY: number; color: string }
  | { kind: 'line'; dx: number; dy: number; thickness: number; color: string };

// ---------------------------------------------------------------------------
// Per-instance serialisable params (one concrete type per obstacle)
// ---------------------------------------------------------------------------

export interface SpinnerParams   { obstacleType: 'spinner';    armLength: number; rotSpeed: number; radius: number }
export interface BouncerParams   { obstacleType: 'bouncer';    amplitude: number; bounceSpeed: number; radius: number }
export interface PendulumParams  { obstacleType: 'pendulum';   cableLength: number; swingAngle: number; bobRadius: number }
export interface CrusherParams   { obstacleType: 'crusher';    zoneWidth: number; zoneHeight: number }
export interface LaserParams     { obstacleType: 'laser';      beamLength: number; direction: 'left' | 'right' }
export interface SwoopParams     { obstacleType: 'swoop';      patrolWidth: number; patrolHeight: number; diveDepth: number }
export interface OrbiterParams   { obstacleType: 'orbiter';    orbitRadius: number; orbRadius: number }
export interface BoulderParams   { obstacleType: 'boulder';    radius: number }
export interface MineParams      { obstacleType: 'mine';       triggerRadius: number; explosionRadius: number }
export interface StalactiteParams { obstacleType: 'stalactite'; triggerRadius: number; dropZoneWidth: number; dropZoneHeight: number }

export type ObstacleParams =
  | SpinnerParams | BouncerParams | PendulumParams | CrusherParams
  | LaserParams   | SwoopParams   | OrbiterParams  | BoulderParams
  | MineParams    | StalactiteParams;

// ---------------------------------------------------------------------------
// ObstacleDefinition — registry entry
// ---------------------------------------------------------------------------

export interface ObstacleDefinition<P extends ObstacleParams = ObstacleParams> {
  /** Matches TileType key */
  tileType: string;
  /** EntityTypeId for the game engine */
  typeId: EntityTypeId;
  /** Toolbar label */
  label: string;
  /** Toolbar + tile icon */
  emoji: string;
  /** Editor tile background color (rgba string) */
  tileColor: string;
  /** Default params used when no per-tile params are stored */
  defaultParams: P;
  /** Returns reach zones relative to obstacle world origin */
  getReach: (params: P) => ObstacleReachZone[];
  /**
   * Produces a live game Obstacle. Returns null for stubs not yet
   * implemented in the engine — they will be silently skipped in test mode.
   */
  toGameObstacle: (id: string, worldX: number, worldY: number, params: P) => Obstacle | null;
}

// ---------------------------------------------------------------------------
// Shared canvas reach renderer
// ---------------------------------------------------------------------------

/**
 * Draw all reach zones for one obstacle.
 * screenX/screenY are already in canvas-pixel space (world coord - camera offset).
 * Zone geometry values are in world units; the canvas zoom transform scales them.
 */
export function drawReach(
  ctx: CanvasRenderingContext2D,
  zones: ObstacleReachZone[],
  screenX: number,
  screenY: number
): void {
  for (const zone of zones) {
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.5;

    switch (zone.kind) {
      case 'circle': {
        const [r, g, b] = hexToRgb(zone.color);
        ctx.fillStyle = `rgba(${r},${g},${b},0.18)`;
        ctx.strokeStyle = `rgba(${r},${g},${b},0.65)`;
        ctx.beginPath();
        ctx.arc(screenX, screenY, zone.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'ring': {
        const [r, g, b] = hexToRgb(zone.color);
        ctx.fillStyle = `rgba(${r},${g},${b},0.18)`;
        ctx.strokeStyle = `rgba(${r},${g},${b},0.65)`;
        // Draw ring using two arcs with even-odd fill
        ctx.beginPath();
        ctx.arc(screenX, screenY, zone.outerRadius, 0, Math.PI * 2);
        ctx.arc(screenX, screenY, zone.innerRadius, 0, Math.PI * 2, true);
        ctx.fill('evenodd');
        ctx.beginPath();
        ctx.arc(screenX, screenY, zone.outerRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(screenX, screenY, zone.innerRadius, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'arc': {
        const [r, g, b] = hexToRgb(zone.color);
        ctx.strokeStyle = `rgba(${r},${g},${b},0.65)`;
        ctx.fillStyle = `rgba(${r},${g},${b},0.12)`;
        const ox = screenX + zone.offsetX;
        const oy = screenY + zone.offsetY;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.arc(ox, oy, zone.radius, zone.startAngle, zone.startAngle + zone.span);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'rect': {
        const [r, g, b] = hexToRgb(zone.color);
        ctx.fillStyle = `rgba(${r},${g},${b},0.18)`;
        ctx.strokeStyle = `rgba(${r},${g},${b},0.65)`;
        const rx = screenX + zone.offsetX - zone.width / 2;
        const ry = screenY + zone.offsetY - zone.height / 2;
        ctx.fillRect(rx, ry, zone.width, zone.height);
        ctx.strokeRect(rx, ry, zone.width, zone.height);
        break;
      }
      case 'line': {
        const [r, g, b] = hexToRgb(zone.color);
        ctx.strokeStyle = `rgba(${r},${g},${b},0.65)`;
        ctx.lineWidth = zone.thickness;
        ctx.beginPath();
        ctx.moveTo(screenX, screenY);
        ctx.lineTo(screenX + zone.dx, screenY + zone.dy);
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }
}

// Parse "#rrggbb" or named color into [r,g,b].  Falls back to orange on failure.
function hexToRgb(color: string): [number, number, number] {
  const m = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  // named fallback map for the colors we use
  const named: Record<string, [number, number, number]> = {
    orange: [255, 165, 0], red: [220, 50, 50], yellow: [255, 215, 0],
    cyan: [0, 200, 220], lime: [100, 220, 50], purple: [180, 60, 220],
    white: [220, 220, 220], blue: [50, 120, 255],
  };
  return named[color.toLowerCase()] ?? [255, 120, 0];
}

// ---------------------------------------------------------------------------
// resolveParams — merge stored params with defaults
// ---------------------------------------------------------------------------

export function resolveParams(tileType: string, stored?: ObstacleParams): ObstacleParams | null {
  const def = obstacleDefMap.get(tileType);
  if (!def) return null;
  if (!stored) return def.defaultParams;
  return { ...def.defaultParams, ...stored } as ObstacleParams;
}

// ---------------------------------------------------------------------------
// Registry — one entry per obstacle type
// ---------------------------------------------------------------------------

export const OBSTACLE_DEFINITIONS: ObstacleDefinition[] = [
  // ── Spinner ──────────────────────────────────────────────────────────────
  {
    tileType: 'spinner',
    typeId: 'obstacle.spinner',
    label: 'Spinner',
    emoji: '🌀',
    tileColor: 'rgba(255,107,53,0.3)',
    defaultParams: { obstacleType: 'spinner', armLength: 120, rotSpeed: -0.5, radius: 12 } as SpinnerParams,
    getReach(params: SpinnerParams): ObstacleReachZone[] {
      return [
        { kind: 'circle', radius: params.armLength + params.radius, color: '#ff6b35' },
      ];
    },
    toGameObstacle(id, worldX, worldY, params: SpinnerParams): Obstacle {
      return {
        id, typeId: 'obstacle.spinner', type: 'spinner',
        x: worldX, y: worldY,
        radius: params.radius, angle: 0,
        rotSpeed: params.rotSpeed,
        baseY: 0, amplitude: 0, bounceSpeed: 0,
        armLength: params.armLength, hit: false,
      };
    },
  } as ObstacleDefinition<SpinnerParams>,

  // ── Bouncer ───────────────────────────────────────────────────────────────
  {
    tileType: 'bouncer',
    typeId: 'obstacle.bouncer',
    label: 'Bouncer',
    emoji: '🔴',
    tileColor: 'rgba(229,57,53,0.3)',
    defaultParams: { obstacleType: 'bouncer', amplitude: 80, bounceSpeed: 0.7, radius: 18 } as BouncerParams,
    getReach(params: BouncerParams): ObstacleReachZone[] {
      const totalH = params.amplitude * 2 + params.radius * 2;
      return [
        { kind: 'rect', width: params.radius * 2, height: totalH, offsetX: 0, offsetY: 0, color: '#e53935' },
      ];
    },
    toGameObstacle(id, worldX, worldY, params: BouncerParams): Obstacle {
      return {
        id, typeId: 'obstacle.bouncer', type: 'bouncer',
        x: worldX, y: worldY,
        radius: params.radius, angle: 0,
        rotSpeed: 0,
        baseY: worldY - 20, amplitude: params.amplitude,
        bounceSpeed: params.bounceSpeed,
        armLength: 0, hit: false,
      };
    },
  } as ObstacleDefinition<BouncerParams>,

  // ── Pendulum ──────────────────────────────────────────────────────────────
  {
    tileType: 'pendulum',
    typeId: 'obstacle.pendulum',
    label: 'Pendulum',
    emoji: '⏱️',
    tileColor: 'rgba(100,180,255,0.3)',
    defaultParams: { obstacleType: 'pendulum', cableLength: 120, swingAngle: 0.8, bobRadius: 18 } as PendulumParams,
    getReach(params: PendulumParams): ObstacleReachZone[] {
      const arcR = params.cableLength + params.bobRadius;
      const span = params.swingAngle * 2;
      const startAngle = Math.PI / 2 - params.swingAngle; // centred downward
      return [
        { kind: 'arc', radius: arcR, startAngle, span, offsetX: 0, offsetY: 0, color: '#64b4ff' },
        { kind: 'circle', radius: params.bobRadius, color: '#64b4ff' },
      ];
    },
    toGameObstacle(_id, _wx, _wy, _params: PendulumParams): null {
      return null; // engine not yet implemented
    },
  } as ObstacleDefinition<PendulumParams>,

  // ── Crusher ───────────────────────────────────────────────────────────────
  {
    tileType: 'crusher',
    typeId: 'obstacle.crusher',
    label: 'Crusher',
    emoji: '🔩',
    tileColor: 'rgba(180,180,180,0.3)',
    defaultParams: { obstacleType: 'crusher', zoneWidth: 80, zoneHeight: 60 } as CrusherParams,
    getReach(params: CrusherParams): ObstacleReachZone[] {
      return [
        { kind: 'rect', width: params.zoneWidth, height: params.zoneHeight, offsetX: 0, offsetY: 0, color: '#aaaaaa' },
      ];
    },
    toGameObstacle(_id, _wx, _wy, _params: CrusherParams): null {
      return null;
    },
  } as ObstacleDefinition<CrusherParams>,

  // ── Laser ─────────────────────────────────────────────────────────────────
  {
    tileType: 'laser',
    typeId: 'obstacle.laser',
    label: 'Laser',
    emoji: '🔦',
    tileColor: 'rgba(255,50,50,0.3)',
    defaultParams: { obstacleType: 'laser', beamLength: 200, direction: 'right' } as LaserParams,
    getReach(params: LaserParams): ObstacleReachZone[] {
      const dx = params.direction === 'right' ? params.beamLength : -params.beamLength;
      return [
        { kind: 'line', dx, dy: 0, thickness: 6, color: '#ff3232' },
      ];
    },
    toGameObstacle(_id, _wx, _wy, _params: LaserParams): null {
      return null;
    },
  } as ObstacleDefinition<LaserParams>,

  // ── Swoop ─────────────────────────────────────────────────────────────────
  {
    tileType: 'swoop',
    typeId: 'obstacle.swoop',
    label: 'Swoop',
    emoji: '🦅',
    tileColor: 'rgba(255,200,50,0.3)',
    defaultParams: { obstacleType: 'swoop', patrolWidth: 120, patrolHeight: 60, diveDepth: 80 } as SwoopParams,
    getReach(params: SwoopParams): ObstacleReachZone[] {
      return [
        // Patrol range (above)
        { kind: 'rect', width: params.patrolWidth, height: params.patrolHeight, offsetX: 0, offsetY: -params.patrolHeight / 2, color: '#ffc832' },
        // Dive zone (below patrol)
        { kind: 'rect', width: params.patrolWidth, height: params.diveDepth, offsetX: 0, offsetY: params.patrolHeight / 2 + params.diveDepth / 2, color: '#ff8832' },
      ];
    },
    toGameObstacle(_id, _wx, _wy, _params: SwoopParams): null {
      return null;
    },
  } as ObstacleDefinition<SwoopParams>,

  // ── Orbiter ───────────────────────────────────────────────────────────────
  {
    tileType: 'orbiter',
    typeId: 'obstacle.orbiter',
    label: 'Orbiter',
    emoji: '🪐',
    tileColor: 'rgba(180,80,255,0.3)',
    defaultParams: { obstacleType: 'orbiter', orbitRadius: 80, orbRadius: 14 } as OrbiterParams,
    getReach(params: OrbiterParams): ObstacleReachZone[] {
      return [
        { kind: 'ring', innerRadius: params.orbitRadius - params.orbRadius, outerRadius: params.orbitRadius + params.orbRadius, color: '#b450ff' },
      ];
    },
    toGameObstacle(_id, _wx, _wy, _params: OrbiterParams): null {
      return null;
    },
  } as ObstacleDefinition<OrbiterParams>,

  // ── Rolling Boulder ───────────────────────────────────────────────────────
  {
    tileType: 'boulder',
    typeId: 'obstacle.boulder',
    label: 'Boulder',
    emoji: '🪨',
    tileColor: 'rgba(140,120,80,0.3)',
    defaultParams: { obstacleType: 'boulder', radius: 30 } as BoulderParams,
    getReach(params: BoulderParams): ObstacleReachZone[] {
      return [
        { kind: 'circle', radius: params.radius, color: '#8c7850' },
      ];
    },
    toGameObstacle(_id, _wx, _wy, _params: BoulderParams): null {
      return null;
    },
  } as ObstacleDefinition<BoulderParams>,

  // ── Floating Mine ─────────────────────────────────────────────────────────
  {
    tileType: 'mine',
    typeId: 'obstacle.mine',
    label: 'Mine',
    emoji: '💣',
    tileColor: 'rgba(255,220,0,0.3)',
    defaultParams: { obstacleType: 'mine', triggerRadius: 40, explosionRadius: 80 } as MineParams,
    getReach(params: MineParams): ObstacleReachZone[] {
      return [
        { kind: 'circle', radius: params.explosionRadius, color: '#ff4400' },
        { kind: 'circle', radius: params.triggerRadius, color: '#ffcc00' },
      ];
    },
    toGameObstacle(_id, _wx, _wy, _params: MineParams): null {
      return null;
    },
  } as ObstacleDefinition<MineParams>,

  // ── Stalactite ────────────────────────────────────────────────────────────
  {
    tileType: 'stalactite',
    typeId: 'obstacle.stalactite',
    label: 'Stalactite',
    emoji: '🗡️',
    tileColor: 'rgba(180,220,255,0.3)',
    defaultParams: { obstacleType: 'stalactite', triggerRadius: 60, dropZoneWidth: 20, dropZoneHeight: 100 } as StalactiteParams,
    getReach(params: StalactiteParams): ObstacleReachZone[] {
      return [
        { kind: 'circle', radius: params.triggerRadius, color: '#b4dcff' },
        // Drop zone extends downward from the tile centre
        { kind: 'rect', width: params.dropZoneWidth, height: params.dropZoneHeight, offsetX: 0, offsetY: params.dropZoneHeight / 2, color: '#7ab8ff' },
      ];
    },
    toGameObstacle(_id, _wx, _wy, _params: StalactiteParams): null {
      return null;
    },
  } as ObstacleDefinition<StalactiteParams>,
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export const obstacleDefMap: Map<string, ObstacleDefinition> =
  new Map(OBSTACLE_DEFINITIONS.map(d => [d.tileType, d]));
