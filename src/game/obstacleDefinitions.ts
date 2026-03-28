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

export interface SpinnerParams    { obstacleType: 'spinner';    armLength: number; rotSpeed: number; radius: number; rotation: number }
export interface BouncerParams    { obstacleType: 'bouncer';    amplitude: number; bounceSpeed: number; radius: number; rotation: number }
export interface PendulumParams   { obstacleType: 'pendulum';   cableLength: number; swingAngle: number; bobRadius: number; swingSpeed: number; rotation: number }
export interface CrusherParams    { obstacleType: 'crusher';    zoneWidth: number; zoneHeight: number; rotation: number }
export interface LaserParams      { obstacleType: 'laser';      beamLength: number; direction: 'left' | 'right'; cycleSpeed: number; warningTime: number; rotation: number }
export interface SwoopParams      { obstacleType: 'swoop';      patrolWidth: number; patrolHeight: number; diveDepth: number; patrolSpeed: number; rotation: number }
export interface OrbiterParams    { obstacleType: 'orbiter';    orbitRadius: number; orbRadius: number; orbitSpeed: number; rotation: number }
export interface BoulderParams    { obstacleType: 'boulder';    radius: number; triggerRadius: number; dropDelay: number; fallTimeout: number; rotation: number }
export interface MineParams       { obstacleType: 'mine';       triggerRadius: number; explosionRadius: number; triggerDelay: number; rotation: number }
export interface StalactiteParams { obstacleType: 'stalactite'; triggerRadius: number; dropZoneWidth: number; dropZoneHeight: number; rotation: number }

export type ObstacleParams =
  | SpinnerParams | BouncerParams | PendulumParams | CrusherParams
  | LaserParams   | SwoopParams   | OrbiterParams  | BoulderParams
  | MineParams    | StalactiteParams;

// ---------------------------------------------------------------------------
// ParamFieldMeta — inspector field descriptor
// ---------------------------------------------------------------------------

export interface ParamFieldMeta {
  label: string;
  type?: 'number' | 'select';
  min?: number;
  max?: number;
  step?: number;
  options?: string[]; // for select type
}

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
  /** Inspector field descriptors (excludes obstacleType discriminant) */
  paramMeta: Record<string, ParamFieldMeta>;
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
  screenY: number,
  rotationRad?: number
): void {
  // Translate to obstacle center, optionally rotate, then draw all zones at (0,0)
  ctx.save();
  ctx.translate(screenX, screenY);
  if (rotationRad) ctx.rotate(rotationRad);

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
        ctx.arc(0, 0, zone.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'ring': {
        const [r, g, b] = hexToRgb(zone.color);
        ctx.fillStyle = `rgba(${r},${g},${b},0.18)`;
        ctx.strokeStyle = `rgba(${r},${g},${b},0.65)`;
        ctx.beginPath();
        ctx.arc(0, 0, zone.outerRadius, 0, Math.PI * 2);
        ctx.arc(0, 0, zone.innerRadius, 0, Math.PI * 2, true);
        ctx.fill('evenodd');
        ctx.beginPath();
        ctx.arc(0, 0, zone.outerRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, zone.innerRadius, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'arc': {
        const [r, g, b] = hexToRgb(zone.color);
        ctx.strokeStyle = `rgba(${r},${g},${b},0.65)`;
        ctx.fillStyle = `rgba(${r},${g},${b},0.12)`;
        const ox = zone.offsetX;
        const oy = zone.offsetY;
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
        const rx = zone.offsetX - zone.width / 2;
        const ry = zone.offsetY - zone.height / 2;
        ctx.fillRect(rx, ry, zone.width, zone.height);
        ctx.strokeRect(rx, ry, zone.width, zone.height);
        break;
      }
      case 'line': {
        const [r, g, b] = hexToRgb(zone.color);
        ctx.strokeStyle = `rgba(${r},${g},${b},0.65)`;
        ctx.lineWidth = zone.thickness;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(zone.dx, zone.dy);
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }

  ctx.restore(); // undo translate + rotate
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
    defaultParams: { obstacleType: 'spinner', armLength: 150, rotSpeed: 0.5, radius: 12, rotation: 0 } as SpinnerParams,
    paramMeta: {
      armLength:  { label: 'Arm Length',      min: 20,  max: 300, step: 5  },
      rotSpeed:   { label: 'Rotation Speed',  min: 0.1, max: 5,   step: 0.1 },
      radius:     { label: 'Hub Radius',      min: 4,   max: 40,  step: 1  },
      rotation:   { label: 'Initial Rotation (°)', min: 0, max: 360, step: 1 },
    },
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
        rotSpeed: -params.rotSpeed, // negate so positive = clockwise visually
        baseY: 0, amplitude: 0, bounceSpeed: 0,
        armLength: params.armLength, hit: false, hp: 1,
        rotation: (params.rotation ?? 0) * Math.PI / 180,
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
    defaultParams: { obstacleType: 'bouncer', amplitude: 100, bounceSpeed: 0.7, radius: 18, rotation: 0 } as BouncerParams,
    paramMeta: {
      amplitude:   { label: 'Bounce Height', min: 10, max: 300, step: 5   },
      bounceSpeed: { label: 'Bounce Speed',  min: 0.1, max: 5,  step: 0.1 },
      radius:      { label: 'Ball Radius',   min: 4,  max: 50,  step: 1   },
      rotation:    { label: 'Initial Rotation (°)', min: 0, max: 360, step: 1 },
    },
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
        rotSpeed: 0, rotation: (params.rotation ?? 0) * Math.PI / 180,
        baseY: worldY - 20, amplitude: params.amplitude,
        bounceSpeed: params.bounceSpeed,
        armLength: 0, hit: false, hp: 1,
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
    defaultParams: { obstacleType: 'pendulum', cableLength: 220, swingAngle: 1.5, bobRadius: 18, swingSpeed: 1.2, rotation: 0 } as PendulumParams,
    paramMeta: {
      cableLength: { label: 'Cable Length',  min: 30,  max: 400,  step: 10   },
      swingAngle:  { label: 'Swing Angle',   min: 0.1, max: 2.32, step: 0.05 },
      bobRadius:   { label: 'Bob Radius',    min: 4,   max: 50,   step: 1    },
      swingSpeed:  { label: 'Swing Speed',   min: 0.1, max: 5,    step: 0.1  },
      rotation:    { label: 'Initial Rotation (°)', min: 0, max: 360, step: 1 },
    },
    getReach(params: PendulumParams): ObstacleReachZone[] {
      const arcR = params.cableLength + params.bobRadius;
      const span = params.swingAngle * 2;
      const startAngle = Math.PI / 2 - params.swingAngle;
      return [
        { kind: 'arc', radius: arcR, startAngle, span, offsetX: 0, offsetY: 0, color: '#64b4ff' },
        { kind: 'circle', radius: params.bobRadius, color: '#64b4ff' },
      ];
    },
    toGameObstacle(id, worldX, worldY, params: PendulumParams): Obstacle {
      return { id, typeId: 'obstacle.pendulum', type: 'pendulum', x: worldX, y: worldY, radius: params.bobRadius, angle: 0, rotation: (params.rotation ?? 0) * Math.PI / 180, rotSpeed: 0, baseY: 0, amplitude: 0, bounceSpeed: params.swingSpeed, armLength: 0, hit: false, hp: 1, cableLength: params.cableLength, swingAngle: params.swingAngle, bobRadius: params.bobRadius };
    },
  } as ObstacleDefinition<PendulumParams>,

  // ── Crusher ───────────────────────────────────────────────────────────────
  {
    tileType: 'crusher',
    typeId: 'obstacle.crusher',
    label: 'Crusher',
    emoji: '🔩',
    tileColor: 'rgba(180,180,180,0.3)',
    defaultParams: { obstacleType: 'crusher', zoneWidth: 80, zoneHeight: 60, rotation: 0 } as CrusherParams,
    paramMeta: {
      zoneWidth:  { label: 'Zone Width',  min: 20, max: 400, step: 5 },
      zoneHeight: { label: 'Zone Height', min: 20, max: 400, step: 5 },
      rotation:   { label: 'Initial Rotation (°)', min: 0, max: 360, step: 1 },
    },
    getReach(params: CrusherParams): ObstacleReachZone[] {
      return [
        { kind: 'rect', width: params.zoneWidth, height: params.zoneHeight, offsetX: 0, offsetY: 0, color: '#aaaaaa' },
      ];
    },
    toGameObstacle(id, worldX, worldY, params: CrusherParams): Obstacle {
      return { id, typeId: 'obstacle.crusher', type: 'crusher', x: worldX, y: worldY, radius: Math.min(params.zoneWidth, params.zoneHeight) / 2, angle: 0, rotation: (params.rotation ?? 0) * Math.PI / 180, rotSpeed: 0, baseY: 0, amplitude: 0, bounceSpeed: 0, armLength: 0, hit: false, hp: 1, zoneWidth: params.zoneWidth, zoneHeight: params.zoneHeight };
    },
  } as ObstacleDefinition<CrusherParams>,

  // ── Laser ─────────────────────────────────────────────────────────────────
  {
    tileType: 'laser',
    typeId: 'obstacle.laser',
    label: 'Laser',
    emoji: '🔦',
    tileColor: 'rgba(255,50,50,0.3)',
    defaultParams: { obstacleType: 'laser', beamLength: 200, direction: 'right', cycleSpeed: 1.5, warningTime: 2.0, rotation: 90 } as LaserParams,
    paramMeta: {
      beamLength:   { label: 'Beam Length',        min: 20,  max: 600, step: 10  },
      direction:    { label: 'Direction',           type: 'select', options: ['left', 'right'] },
      cycleSpeed:   { label: 'Cycle Speed',         min: 0.2, max: 5,   step: 0.1  },
      warningTime:  { label: 'Warning Time (sec)',  min: 0.5, max: 8,   step: 0.5  },
      rotation:     { label: 'Initial Rotation (°)', min: 0, max: 360, step: 1 },
    },
    getReach(params: LaserParams): ObstacleReachZone[] {
      const dx = params.direction === 'right' ? params.beamLength : -params.beamLength;
      return [
        { kind: 'line', dx, dy: 0, thickness: 6, color: '#ff3232' },
      ];
    },
    toGameObstacle(id, worldX, worldY, params: LaserParams): Obstacle {
      return { id, typeId: 'obstacle.laser', type: 'laser', x: worldX, y: worldY, radius: 12, angle: 0, rotation: (params.rotation ?? 0) * Math.PI / 180, rotSpeed: 0, baseY: 0, amplitude: 0, bounceSpeed: params.cycleSpeed ?? 1.5, armLength: params.beamLength, hit: false, hp: 1, beamLength: params.beamLength, beamDirection: params.direction, warningTime: params.warningTime ?? 2.0 };
    },
  } as ObstacleDefinition<LaserParams>,

  // ── Swoop ─────────────────────────────────────────────────────────────────
  {
    tileType: 'swoop',
    typeId: 'obstacle.swoop',
    label: 'Swoop',
    emoji: '🦅',
    tileColor: 'rgba(255,200,50,0.3)',
    defaultParams: { obstacleType: 'swoop', patrolWidth: 160, patrolHeight: 80, diveDepth: 120, patrolSpeed: 0.8, rotation: 0 } as SwoopParams,
    paramMeta: {
      patrolWidth:  { label: 'Patrol Width',  min: 20, max: 600, step: 5  },
      patrolHeight: { label: 'Detect Height', min: 10, max: 300, step: 5  },
      diveDepth:    { label: 'Dive Depth',    min: 10, max: 400, step: 5  },
      patrolSpeed:  { label: 'Patrol Speed',  min: 0.1, max: 4,  step: 0.1 },
      rotation:     { label: 'Initial Rotation (°)', min: 0, max: 360, step: 1 },
    },
    getReach(params: SwoopParams): ObstacleReachZone[] {
      return [
        { kind: 'rect', width: params.patrolWidth, height: params.patrolHeight, offsetX: 0, offsetY: -params.patrolHeight / 2, color: '#ffc832' },
        { kind: 'rect', width: params.patrolWidth, height: params.diveDepth, offsetX: 0, offsetY: params.patrolHeight / 2 + params.diveDepth / 2, color: '#ff8832' },
      ];
    },
    toGameObstacle(id, worldX, worldY, params: SwoopParams): Obstacle {
      return { id, typeId: 'obstacle.swoop', type: 'swoop', x: worldX, y: worldY, radius: 18, angle: (params.rotation ?? 0) * Math.PI / 180, rotation: 0, rotSpeed: 0, baseY: worldY, amplitude: 0, bounceSpeed: params.patrolSpeed ?? 0.8, armLength: 0, hit: false, hp: 1, patrolWidth: params.patrolWidth, patrolHeight: params.patrolHeight, diveDepth: params.diveDepth };
    },
  } as ObstacleDefinition<SwoopParams>,

  // ── Orbiter ───────────────────────────────────────────────────────────────
  {
    tileType: 'orbiter',
    typeId: 'obstacle.orbiter',
    label: 'Orbiter',
    emoji: '🪐',
    tileColor: 'rgba(180,80,255,0.3)',
    defaultParams: { obstacleType: 'orbiter', orbitRadius: 100, orbRadius: 14, orbitSpeed: 1.2, rotation: 0 } as OrbiterParams,
    paramMeta: {
      orbitRadius: { label: 'Orbit Radius', min: 10, max: 300, step: 5  },
      orbRadius:   { label: 'Ball Radius',  min: 4,  max: 50,  step: 1  },
      orbitSpeed:  { label: 'Orbit Speed',  min: 0.1, max: 8,  step: 0.1 },
      rotation:    { label: 'Initial Rotation (°)', min: 0, max: 360, step: 1 },
    },
    getReach(params: OrbiterParams): ObstacleReachZone[] {
      return [
        { kind: 'ring', innerRadius: params.orbitRadius - params.orbRadius, outerRadius: params.orbitRadius + params.orbRadius, color: '#b450ff' },
      ];
    },
    toGameObstacle(id, worldX, worldY, params: OrbiterParams): Obstacle {
      return { id, typeId: 'obstacle.orbiter', type: 'orbiter', x: worldX, y: worldY, radius: params.orbRadius, angle: 0, rotation: (params.rotation ?? 0) * Math.PI / 180, rotSpeed: params.orbitSpeed ?? 1.2, baseY: 0, amplitude: 0, bounceSpeed: 0, armLength: params.orbitRadius, hit: false, hp: 1, orbitRadius: params.orbitRadius };
    },
  } as ObstacleDefinition<OrbiterParams>,

  // ── Rolling Boulder ───────────────────────────────────────────────────────
  {
    tileType: 'boulder',
    typeId: 'obstacle.boulder',
    label: 'Boulder',
    emoji: '🪨',
    tileColor: 'rgba(140,120,80,0.3)',
    defaultParams: { obstacleType: 'boulder', radius: 30, triggerRadius: 150, dropDelay: 0.5, fallTimeout: 4, rotation: 0 } as BoulderParams,
    paramMeta: {
      radius:        { label: 'Boulder Radius',    min: 8,   max: 120, step: 2   },
      triggerRadius: { label: 'Trigger Radius',    min: 20,  max: 400, step: 5   },
      dropDelay:     { label: 'Drop Delay (sec)',  min: 0,   max: 5,   step: 0.1 },
      fallTimeout:   { label: 'Fall Timeout (sec)', min: 1,  max: 15,  step: 0.5 },
      rotation:      { label: 'Initial Rotation (°)', min: 0, max: 360, step: 1 },
    },
    getReach(params: BoulderParams): ObstacleReachZone[] {
      return [
        { kind: 'circle', radius: params.triggerRadius, color: '#ffaa00' },
        { kind: 'circle', radius: params.radius, color: '#8c7850' },
      ];
    },
    toGameObstacle(id, worldX, worldY, params: BoulderParams): Obstacle {
      return {
        id, typeId: 'obstacle.boulder', type: 'boulder',
        x: worldX, y: worldY,
        radius: params.radius,
        angle: 0,               // visual roll angle
        rotation: (params.rotation ?? 0) * Math.PI / 180,
        rotSpeed: 0,
        baseY: worldY,          // original Y (unused at runtime but stored)
        amplitude: 0,           // elapsed fall time during state 2
        bounceSpeed: params.dropDelay ?? 0.5, // countdown timer (state 1) → fall velocity (state 2)
        armLength: 0,           // state: 0=idle, 1=countdown, 2=falling
        hit: false, hp: 1,
        triggerRadius: params.triggerRadius ?? 120,
        fallTimeout: params.fallTimeout ?? 4,
      };
    },
  } as ObstacleDefinition<BoulderParams>,

  // ── Floating Mine ─────────────────────────────────────────────────────────
  {
    tileType: 'mine',
    typeId: 'obstacle.mine',
    label: 'Mine',
    emoji: '💣',
    tileColor: 'rgba(255,220,0,0.3)',
    defaultParams: { obstacleType: 'mine', triggerRadius: 80, explosionRadius: 80, triggerDelay: 1.5, rotation: 0 } as MineParams,
    paramMeta: {
      triggerRadius:   { label: 'Trigger Radius',    min: 5,   max: 200, step: 5   },
      explosionRadius: { label: 'Explosion Radius',  min: 10,  max: 300, step: 5   },
      triggerDelay:    { label: 'Fuse Delay (sec)',   min: 0,   max: 10,  step: 0.1 },
      rotation:        { label: 'Initial Rotation (°)', min: 0, max: 360, step: 1  },
    },
    getReach(params: MineParams): ObstacleReachZone[] {
      return [
        { kind: 'circle', radius: params.explosionRadius, color: '#ff4400' },
        { kind: 'circle', radius: params.triggerRadius, color: '#ffcc00' },
      ];
    },
    toGameObstacle(id, worldX, worldY, params: MineParams): Obstacle {
      return {
        id, typeId: 'obstacle.mine', type: 'mine',
        x: worldX, y: worldY,
        radius: params.triggerRadius,
        angle: 0,
        rotation: (params.rotation ?? 0) * Math.PI / 180,
        rotSpeed: params.triggerDelay ?? 1.5, // store initial delay for progress indicator
        baseY: 0, amplitude: 0,
        bounceSpeed: params.triggerDelay ?? 1.5, // countdown remaining time
        armLength: 0,  // state: 0=idle, 1=countdown, 2=exploding
        hit: false, hp: 1,
        triggerRadius: params.triggerRadius,
        explosionRadius: params.explosionRadius,
      };
    },
  } as ObstacleDefinition<MineParams>,

  // ── Stalactite ────────────────────────────────────────────────────────────
  {
    tileType: 'stalactite',
    typeId: 'obstacle.stalactite',
    label: 'Stalactite',
    emoji: '🗡️',
    tileColor: 'rgba(180,220,255,0.3)',
    defaultParams: { obstacleType: 'stalactite', triggerRadius: 60, dropZoneWidth: 20, dropZoneHeight: 100, rotation: 0 } as StalactiteParams,
    paramMeta: {
      triggerRadius:  { label: 'Trigger Radius', min: 10, max: 300, step: 5 },
      dropZoneWidth:  { label: 'Drop Width',     min: 4,  max: 100, step: 2 },
      dropZoneHeight: { label: 'Drop Height',    min: 10, max: 400, step: 5 },
      rotation:       { label: 'Initial Rotation (°)', min: 0, max: 360, step: 1 },
    },
    getReach(params: StalactiteParams): ObstacleReachZone[] {
      return [
        { kind: 'circle', radius: params.triggerRadius, color: '#b4dcff' },
        { kind: 'rect', width: params.dropZoneWidth, height: params.dropZoneHeight, offsetX: 0, offsetY: params.dropZoneHeight / 2, color: '#7ab8ff' },
      ];
    },
    toGameObstacle(id, worldX, worldY, params: StalactiteParams): Obstacle {
      return { id, typeId: 'obstacle.stalactite', type: 'stalactite', x: worldX, y: worldY, radius: params.dropZoneWidth / 2, angle: 0, rotation: (params.rotation ?? 0) * Math.PI / 180, rotSpeed: 0, baseY: 0, amplitude: 0, bounceSpeed: 0, armLength: 0, hit: false, hp: 1, triggerRadius: params.triggerRadius, dropZoneWidth: params.dropZoneWidth, dropZoneHeight: params.dropZoneHeight };
    },
  } as ObstacleDefinition<StalactiteParams>,
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export const obstacleDefMap: Map<string, ObstacleDefinition> =
  new Map(OBSTACLE_DEFINITIONS.map(d => [d.tileType, d]));
