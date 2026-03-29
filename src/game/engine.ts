import { WorldType, Upgrades, Point, Obstacle, WORLD_CONFIG, formatTime } from './types';
import { spriteManager } from './spriteManager';
import { OBSTACLE_BEHAVIORS, GameUpdateContext, checkRectVsObstacle, rectVsCircle } from './obstacleBehaviors';
import { createRng } from './rng';
import { GhostRecorder, GhostPlayer } from './replay';
import { soundManager } from './soundManager';
import type { BgTile } from './editorTypes';

const RAIL_SPACING = 100;
const THROTTLE_BASE = 350;
const MAX_SPEED_BASE = 500;
const GONDOLA_HANG = 38;
const CABIN_W = 56;
const CABIN_H = 36;
const HIT_RADIUS = 26;
const WHEEL_RADIUS = 7;
const INVULN_TIME = 2;
const ROCKET_DURATION = 3;
const SHIELD_DURATION = 2.5;
const OBSTACLE_MIN_GAP = 280;
const OBSTACLE_MAX_GAP = 500;
const ROLLING_INERTIA_FACTOR = 1.5; // effective mass multiplier (solid disk: 1 + I/mr² = 1.5)
const PENDULUM_DAMPING = 4.5;        // angular velocity damping (~0.5× critical, settles naturally)
const PENDULUM_PLAYER_TORQUE = 15;   // rad/s² strong torque matching airborne rotation control
const AIRBORNE_PLAYER_TORQUE = 25;   // rad/s² strong torque for full rotation in air
const PENDULUM_MASS_RATIO = 0.15;    // cabin reaction force ratio on wheel

interface Cloud { x: number; y: number; w: number; h: number }
interface Star { x: number; y: number; s: number }
interface Mountain { x: number; y: number; w: number; h: number }

export class GameEngine {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  world: WorldType;
  upgrades: Upgrades;

  rail: Point[] = [];
  /** All rail segments for finite levels (for rendering + snap). Index 0 = start segment. */
  allRailSegments: Point[][] = [];
  /** Precomputed AABBs for each rail segment (built once at level load) */
  segmentBounds: { seg: Point[]; minX: number; minY: number; maxX: number; maxY: number }[] = [];
  ground: number[] = []; // groundY for each rail point
  pos: number = 0;
  speed: number = 0;
  direction: 1 | -1 = 1;
  directionFlipped: boolean = false;
  passengers: number = 3;
  distance: number = 0;
  obstacles: Obstacle[] = [];
  keys = { up: false, down: false, left: false, right: false, space: false, shift: false };
  noBackground = false;
  skyOverride: { skyTop: string; skyBottom: string } | null = null;
  bgTiles: Record<string, BgTile> = {};
  bgTileSize = 50;
  hasFinitePath = false;
  isLoop = false;
  /** Trigger radius for end tile proximity check (world pixels) */
  static END_TRIGGER_RADIUS = 30;
  onRail = true;

  // Optional world positions for explicit start/end tiles in finite/editor levels
  startTilePos: Point | null = null;
  endTilePos: Point | null = null;

  // Airborne state (when the player leaves the rail)
  airX = 0;
  airY = 0;
  airVX = 0;
  airVY = 0;
  airborneTime = 0; // time spent airborne — cooldown for snap-back to exited rail
  airborneFromSeg: Point[] | null = null; // the rail segment the player launched from

  wheelAngle = 0; // cumulative rotation for visual spin

  // Pendulum state — cabin swings from wheel joint
  pendulumAngle = 0;   // angle from vertical (radians, positive = right)
  pendulumVel = 0;     // angular velocity (rad/s)
  prevWheelVX = 0;     // previous frame wheel world velocity X
  prevWheelVY = 0;     // previous frame wheel world velocity Y

  // Tracked rail normal for continuity (prevents flipping on loops)
  prevNormalX = 0;
  prevNormalY = -1;    // default: upward

  elapsedTime = 0;
  levelCompleted = false;
  camera = { x: 0, y: 0 };

  invulnTimer = 0;
  rocketTimer = 0;
  shieldTimer = 0;
  rocketCharges = 0;
  shieldCharges = 0;

  lastTime = 0;
  lastDt = 0.016;
  animFrame = 0;
  running = false;
  paused = false;
  gameOver = false;
  flashTimer = 0;

  // Fixed timestep for deterministic physics
  readonly FIXED_DT = 1 / 60;
  accumulator = 0;
  interpolationAlpha = 0;
  prevGondolaX = 0;
  prevGondolaY = 0;
  frameDt = 0;

  clouds: Cloud[] = [];
  stars: Star[] = [];
  mountains: Mountain[] = [];
  nextObstacleX = 600;
  rng: () => number;

  collectibleStars: { x: number; y: number; collected: boolean }[] = [];
  starsCollected = 0;

  ghostRecorder: GhostRecorder | null = null;
  ghostPlayer: GhostPlayer | null = null;
  ghostNickname: string | null = null;
  debugHitbox = false;

  /** Personal best time for the current level (seconds), or null if none */
  personalBestTime: number | null = null;
  /** Ghost's completion time (seconds), or null if not racing a ghost */
  ghostTime: number | null = null;

  onUpdate?: (dist: number, passengers: number, speed: number) => void;
  onGameOver?: (dist: number, cash: number) => void;
  onLevelComplete?: (time: number, starsCollected: number) => void;

  constructor(
    canvas: HTMLCanvasElement,
    world: WorldType,
    upgrades: Upgrades,
    callbacks: {
      onUpdate?: (d: number, p: number, s: number) => void;
      onGameOver?: (d: number, c: number) => void;
      onLevelComplete?: (time: number, starsCollected: number) => void;
    }
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.world = world;
    this.upgrades = upgrades;
    this.onUpdate = callbacks.onUpdate;
    this.onGameOver = callbacks.onGameOver;
    this.onLevelComplete = callbacks.onLevelComplete;
    this.rng = createRng(Date.now());
    this.passengers = 3 + upgrades.health;
    this.rocketCharges = upgrades.rocket > 0 ? 1 + upgrades.rocket : 0;
    this.shieldCharges = upgrades.shield > 0 ? 1 + upgrades.shield : 0;
    this.generateRail(300);
    this.generateBackground();
  }

  // --- Rail Generation ---
  generateRail(count: number) {
    const startIdx = this.rail.length;
    let lastY = startIdx > 0 ? this.rail[startIdx - 1].y : 300;
    let lastGroundOffset = startIdx > 0 ? (this.ground[startIdx - 1] - this.rail[startIdx - 1].y) : 160;

    for (let i = 0; i < count; i++) {
      const idx = startIdx + i;
      const x = idx * RAIL_SPACING;
      // Smooth random walk for rail height
      const difficulty = Math.min(1, (idx * RAIL_SPACING) / 30000);
      const maxSlope = 25 + difficulty * 35;
      const dy = (this.rng() - 0.48) * maxSlope;
      lastY = Math.max(120, Math.min(520, lastY + dy));
      this.rail.push({ x, y: lastY });

      // Ground follows below rail with variation
      const isChasm = this.rng() < 0.04 + difficulty * 0.03;
      const targetOffset = isChasm ? 400 + this.rng() * 200 : 100 + this.rng() * 120;
      lastGroundOffset += (targetOffset - lastGroundOffset) * 0.15;
      this.ground.push(lastY + lastGroundOffset);
    }

    // Spawn obstacles in new section
    this.spawnObstacles(startIdx, startIdx + count);
  }

  spawnObstacles(from: number, to: number) {
    for (let i = from; i < to; i++) {
      const x = this.rail[i].x;
      if (x < this.nextObstacleX) continue;

      const railY = this.rail[i].y;
      const difficulty = Math.min(1, x / 30000);
      const r = this.rng();

      let obs: Obstacle;
      if (r < 0.5) {
        // Spinner
        const armLen = (50 + this.rng() * 40) * 3;
        obs = {
          id: `obs_${Date.now()}_${this.rng().toString(36).slice(2, 7)}`,
          typeId: 'obstacle.spinner',
          type: 'spinner',
          x, y: railY - 10 - this.rng() * 40,
          radius: 12, angle: this.rng() * Math.PI * 2,
          rotSpeed: -(0.3 + this.rng() * 0.4 + difficulty * 0.4),
          baseY: 0, amplitude: 0, bounceSpeed: 0,
          armLength: armLen, hit: false, hp: 1,
        };
      } else {
        // Bouncer
        obs = {
          id: `obs_${Date.now()}_${this.rng().toString(36).slice(2, 7)}`,
          typeId: 'obstacle.bouncer',
          type: 'bouncer',
          x, y: railY,
          radius: 18, angle: this.rng() * Math.PI * 2,
          rotSpeed: 0,
          baseY: railY - 20, amplitude: 100 + this.rng() * 80,
          bounceSpeed: 0.6 + this.rng() * 0.8,
          armLength: 0, hit: false, hp: 1,
        };
      }
      this.obstacles.push(obs);
      this.nextObstacleX = x + OBSTACLE_MIN_GAP + this.rng() * (OBSTACLE_MAX_GAP - OBSTACLE_MIN_GAP) * (1 - difficulty * 0.3);
    }
  }

  generateBackground() {
    // Clouds or stars
    if (this.world === 'moon') {
      for (let i = 0; i < 200; i++) {
        this.stars.push({ x: this.rng() * 10000, y: this.rng() * 400, s: 1 + this.rng() * 2 });
      }
    } else {
      for (let i = 0; i < 15; i++) {
        this.clouds.push({
          x: this.rng() * 5000, y: 30 + this.rng() * 150,
          w: 80 + this.rng() * 120, h: 30 + this.rng() * 40,
        });
      }
    }
    // Mountains
    for (let i = 0; i < 20; i++) {
      this.mountains.push({
        x: i * 500 + this.rng() * 200,
        y: 0, w: 200 + this.rng() * 300, h: 150 + this.rng() * 200,
      });
    }
  }

  // --- Input ---
  handleKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'ArrowUp') { this.keys.up = true; e.preventDefault(); }
    if (e.code === 'ArrowDown') { this.keys.down = true; e.preventDefault(); }
    if (e.code === 'ArrowLeft') { this.keys.left = true; e.preventDefault(); }
    if (e.code === 'ArrowRight') { this.keys.right = true; e.preventDefault(); }
    if (e.code === 'Space') {
      this.directionFlipped = !this.directionFlipped;
      e.preventDefault();
    }
    if (e.code === 'KeyX' && this.rocketTimer <= 0 && this.rocketCharges > 0) {
      this.rocketTimer = ROCKET_DURATION;
      this.rocketCharges--;
      e.preventDefault();
    }
    if (e.code === 'ShiftLeft' && this.shieldTimer <= 0 && this.shieldCharges > 0) {
      this.shieldTimer = SHIELD_DURATION;
      this.shieldCharges--;
      e.preventDefault();
    }
    if (e.code === 'F9') {
      this.debugHitbox = !this.debugHitbox;
      e.preventDefault();
    }
  };

  handleKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'ArrowUp') this.keys.up = false;
    if (e.code === 'ArrowDown') this.keys.down = false;
    if (e.code === 'ArrowLeft') this.keys.left = false;
    if (e.code === 'ArrowRight') this.keys.right = false;
  };

  // --- Lifecycle ---
  start() {
    this.running = true;
    this.lastTime = performance.now();
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    this.loop();
  }

  stop() {
    this.running = false;
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
    this.lastTime = performance.now(); // prevent dt spike after pause
    this.accumulator = 0; // reset accumulator to prevent catch-up steps after pause
  }

  loop = () => {
    if (!this.running) return;
    const now = performance.now();
    const frameDt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    this.frameDt = frameDt;

    if (!this.paused && !this.gameOver && !this.levelCompleted) {
      this.accumulator += frameDt;
      // Cap accumulator to prevent spiral of death (max 12 steps at 60Hz)
      this.accumulator = Math.min(this.accumulator, 0.2);

      while (this.accumulator >= this.FIXED_DT) {
        // Save previous gondola position for render interpolation
        const prevPos = this.getGondolaPos();
        this.prevGondolaX = prevPos.x;
        this.prevGondolaY = prevPos.y;

        this.lastDt = this.FIXED_DT;
        this.update(this.FIXED_DT);
        this.accumulator -= this.FIXED_DT;
      }

      this.interpolationAlpha = this.accumulator / this.FIXED_DT;
    }

    this.render();
    this.animFrame = requestAnimationFrame(this.loop);
  };

  // --- Physics ---
  update(dt: number) {
    const cfg = WORLD_CONFIG[this.world];

    // Airborne physics for finite, editor-defined levels
    if (this.hasFinitePath && !this.onRail) {
      // Basic mid-air motion with gravity and rotation control
      const g = cfg.gravity * 0.9;
      this.airVY += g * dt;

      // Simple air drag
      const drag = 0.0006;
      const vMag = Math.sqrt(this.airVX * this.airVX + this.airVY * this.airVY);
      if (vMag > 0) {
        const dragForce = drag * vMag * vMag;
        const dragX = (this.airVX / vMag) * dragForce;
        const dragY = (this.airVY / vMag) * dragForce;
        this.airVX -= dragX * dt;
        this.airVY -= dragY * dt;
      }

      // Pendulum physics — gravity restores cabin, strong torque for full rotation control
      const gEff = cfg.gravity * 0.9;
      let pendAlpha = -(gEff / GONDOLA_HANG) * Math.sin(this.pendulumAngle);
      if (this.keys.left) pendAlpha -= AIRBORNE_PLAYER_TORQUE;
      if (this.keys.right) pendAlpha += AIRBORNE_PLAYER_TORQUE;
      pendAlpha -= PENDULUM_DAMPING * this.pendulumVel;
      this.pendulumVel += pendAlpha * dt;
      this.pendulumAngle += this.pendulumVel * dt;
      // No angle clamp — full 360° rotation allowed

      // Swept circle collision + position integration
      const moveX = this.airVX * dt;
      const moveY = this.airVY * dt;

      let earliestT = 1.0;
      let hitSeg: Point[] | null = null;
      let hitSegIdx = -1;

      // Movement AABB expanded by wheel radius for broad-phase
      const movMinX = Math.min(this.airX, this.airX + moveX) - WHEEL_RADIUS;
      const movMinY = Math.min(this.airY, this.airY + moveY) - WHEEL_RADIUS;
      const movMaxX = Math.max(this.airX, this.airX + moveX) + WHEEL_RADIUS;
      const movMaxY = Math.max(this.airY, this.airY + moveY) + WHEEL_RADIUS;

      for (const bound of this.segmentBounds) {
        // AABB overlap test (broad-phase)
        if (bound.maxX < movMinX || bound.minX > movMaxX ||
            bound.maxY < movMinY || bound.minY > movMaxY) continue;
        // Skip the exited segment during cooldown
        if (bound.seg === this.airborneFromSeg && this.airborneTime <= 0.3) continue;

        for (let i = 0; i < bound.seg.length - 1; i++) {
          const result = this.sweepCircleVsSegment(
            this.airX, this.airY, moveX, moveY,
            WHEEL_RADIUS, bound.seg[i], bound.seg[i + 1]
          );
          if (result && result.t < earliestT) {
            earliestT = result.t;
            hitSeg = bound.seg;
            hitSegIdx = i;
          }
        }
      }

      // Apply movement (full or partial up to collision)
      this.airX += moveX * earliestT;
      this.airY += moveY * earliestT;

      // Update distance for HUD (approximate)
      this.distance += vMag * dt * 0.1;
      this.elapsedTime += dt;
      this.airborneTime += dt;

      if (hitSeg != null) {
        // Snap to rail at collision point
        const p0 = hitSeg[hitSegIdx];
        const p1 = hitSeg[hitSegIdx + 1];
        const segDx = p1.x - p0.x;
        const segDy = p1.y - p0.y;
        const segLen = Math.sqrt(segDx * segDx + segDy * segDy) || 1;
        const tx = segDx / segLen;
        const ty = segDy / segLen;
        const tangentialSpeed = this.airVX * tx + this.airVY * ty;

        const relX = this.airX - p0.x;
        const relY = this.airY - p0.y;
        const proj = Math.max(0, Math.min(1, (relX * tx + relY * ty) / segLen));

        this.onRail = true;
        this.rail = hitSeg;
        this.pos = hitSegIdx + proj;
        this.directionFlipped = false;
        this.initDirection(this.pos);
        this.speed = tangentialSpeed * this.direction;
        this.airVX = this.airVY = 0;
        // Seed normal direction from approach side (wheel was above/below rail)
        this.seedNormalFromApproach(hitSegIdx + proj, this.airX, this.airY);
        // Pendulum keeps running — just init prevWheel to avoid acceleration spike
        this.prevWheelVX = this.direction * this.speed * tx;
        this.prevWheelVY = this.direction * this.speed * ty;

        if (this.touchedEndTile() && !this.levelCompleted) {
          this.speed = 0;
          this.levelCompleted = true;
          this.onLevelComplete?.(this.elapsedTime, this.starsCollected);
        }
      } else {
        // No swept collision — fallback proximity snap for slow approaches
        const snapRadius = 20;
        const snapMinX = this.airX - snapRadius;
        const snapMinY = this.airY - snapRadius;
        const snapMaxX = this.airX + snapRadius;
        const snapMaxY = this.airY + snapRadius;

        let bestSeg: Point[] | null = null;
        let bestIdx = -1;
        let bestDist = snapRadius;
        for (const bound of this.segmentBounds) {
          if (bound.maxX < snapMinX || bound.minX > snapMaxX ||
              bound.maxY < snapMinY || bound.minY > snapMaxY) continue;
          if (bound.seg === this.airborneFromSeg && this.airborneTime <= 0.3) continue;
          for (let i = 0; i < bound.seg.length; i++) {
            const p = bound.seg[i];
            const pdx = p.x - this.airX;
            const pdy = p.y - this.airY;
            const d = Math.sqrt(pdx * pdx + pdy * pdy);
            if (d < bestDist) {
              bestDist = d;
              bestSeg = bound.seg;
              bestIdx = i;
            }
          }
        }

        if (bestSeg != null && bestIdx >= 0 && bestIdx < bestSeg.length - 1) {
          const p0 = bestSeg[bestIdx];
          const p1 = bestSeg[bestIdx + 1];
          const segDx = p1.x - p0.x;
          const segDy = p1.y - p0.y;
          const segLen = Math.sqrt(segDx * segDx + segDy * segDy) || 1;
          const tx = segDx / segLen;
          const ty = segDy / segLen;
          const tangentialSpeed = this.airVX * tx + this.airVY * ty;

          const relX = this.airX - p0.x;
          const relY = this.airY - p0.y;
          const proj = Math.max(0, Math.min(1, (relX * tx + relY * ty) / segLen));

          this.onRail = true;
          this.rail = bestSeg;
          this.pos = bestIdx + proj;
          this.directionFlipped = false;
          this.initDirection(this.pos);
          this.speed = tangentialSpeed * this.direction;
          this.airVX = this.airVY = 0;
          // Seed normal direction from approach side (wheel was above/below rail)
          this.seedNormalFromApproach(bestIdx + proj, this.airX, this.airY);
          // Pendulum keeps running — just init prevWheel to avoid acceleration spike
          this.prevWheelVX = this.direction * this.speed * tx;
          this.prevWheelVY = this.direction * this.speed * ty;

          if (this.touchedEndTile() && !this.levelCompleted) {
            this.speed = 0;
            this.levelCompleted = true;
            this.onLevelComplete?.(this.elapsedTime, this.starsCollected);
          }
        }
      }

      // Timers
      if (this.invulnTimer > 0) this.invulnTimer -= dt;
      if (this.rocketTimer > 0) this.rocketTimer -= dt;
      if (this.shieldTimer > 0) this.shieldTimer -= dt;
      if (this.flashTimer > 0) this.flashTimer -= dt;

      // Obstacle collisions and star collection while airborne
      this.checkCollisions();
      this.checkStarCollection();

      // Update obstacle state machines and animations
      const octx = this.getGameUpdateContext();
      for (const obs of this.obstacles) {
        if (obs.hit) continue;
        const behavior = OBSTACLE_BEHAVIORS[obs.type];
        if (behavior) behavior.update(obs, dt, octx);
      }

      this.ghostRecorder?.onTick(this);
      this.onUpdate?.(this.distance, this.passengers, Math.abs(this.speed) * 0.1);
      return;
    }

    // Loop wrapping: last point === first point, so cycle length is rail.length - 1
    if (this.isLoop && this.rail.length > 2) {
      const cycleLen = this.rail.length - 1;
      while (this.pos >= cycleLen) this.pos -= cycleLen;
      while (this.pos < 0) this.pos += cycleLen;
    }

    const i = Math.floor(this.pos);
    if (i < 0 || i >= this.rail.length - 1) {
      // Reached or passed the end of this segment. Complete if we touched the end tile.
      if (i >= this.rail.length - 1 && this.hasFinitePath && this.touchedEndTile() && !this.levelCompleted) {
        this.speed = 0;
        this.levelCompleted = true;
        this.onLevelComplete?.(this.elapsedTime, this.starsCollected);
        return;
      }
      // Launch into airborne mode from whichever end was crossed
      if (this.hasFinitePath && this.onRail && !this.levelCompleted && this.rail.length >= 2) {
        const atEnd = i >= this.rail.length - 1;
        const segIdx = atEnd ? this.rail.length - 2 : 0;
        const p0 = this.rail[segIdx];
        const p1 = this.rail[segIdx + 1];
        const dx = p1.x - p0.x;
        const dy = p1.y - p0.y;
        const segLen = Math.sqrt(dx * dx + dy * dy) || 1;
        // Effective speed in index-space (positive = toward end, negative = toward start)
        const effSpeed = this.direction * this.speed;
        const launchPoint = atEnd ? p1 : p0;

        // Offset launch point by rail normal so wheel center is continuous
        const endPos = atEnd ? this.rail.length - 1.001 : 0.001;
        const { nx: lnx, ny: lny } = this.getRailNormal(endPos);

        this.onRail = false;
        this.airborneTime = 0;
        this.airborneFromSeg = this.rail;
        this.airX = launchPoint.x + lnx * WHEEL_RADIUS;
        this.airY = launchPoint.y + lny * WHEEL_RADIUS;
        this.airVX = (dx / segLen) * effSpeed;
        this.airVY = (dy / segLen) * effSpeed;
        // Pendulum continues running in airborne — no transfer needed
      }
      return;
    }

    const p0 = this.rail[i];
    const p1 = this.rail[i + 1];
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);

    // Forces
    const motorMult = 1 + this.upgrades.motor * 0.25;
    const gripMult = 1 + this.upgrades.grip * 0.3;
    const maxSpeed = (MAX_SPEED_BASE + this.upgrades.motor * 80) * (this.rocketTimer > 0 ? 1.8 : 1);

    let throttle = 0;
    const goForward = this.directionFlipped ? this.keys.down : this.keys.up;
    const goBackward = this.directionFlipped ? this.keys.up : this.keys.down;
    if (goForward) throttle = THROTTLE_BASE * motorMult;
    if (goBackward) throttle = -THROTTLE_BASE * motorMult;
    if (this.rocketTimer > 0) throttle += THROTTLE_BASE * 1.5;

    const gravity = this.direction * cfg.gravity * Math.sin(angle) * 0.15;
    const friction = -this.speed * cfg.friction * gripMult;
    const drag = -this.speed * Math.abs(this.speed) * 0.0003;

    this.speed += (throttle + gravity + friction + drag) * dt / ROLLING_INERTIA_FACTOR;
    this.speed = Math.max(-maxSpeed, Math.min(maxSpeed, this.speed));

    const dPos = (this.direction * this.speed * dt) / segLen;
    this.pos += dPos;
    this.wheelAngle += (this.direction * this.speed * dt) / WHEEL_RADIUS;
    if (this.isLoop && this.rail.length > 2) {
      const cycleLen = this.rail.length - 1;
      while (this.pos >= cycleLen) this.pos -= cycleLen;
      while (this.pos < 0) this.pos += cycleLen;
    }

    // --- Pendulum physics ---
    const { tx: rTx, ty: rTy } = this.getRailNormal(this.pos);
    const wheelVX = this.direction * this.speed * rTx;
    const wheelVY = this.direction * this.speed * rTy;
    const wheelAX = (wheelVX - this.prevWheelVX) / dt;
    const wheelAY = (wheelVY - this.prevWheelVY) / dt;

    // Pendulum equation: θ̈ = -(1/L)*((g - aY)*sin(θ) - aX*cos(θ)) + input - damping
    const gEff = cfg.gravity * 0.9;
    let pendAlpha = -(1 / GONDOLA_HANG) * ((gEff - wheelAY) * Math.sin(this.pendulumAngle) - wheelAX * Math.cos(this.pendulumAngle));

    // Player tilt input (on-rail only)
    if (this.keys.left) pendAlpha -= PENDULUM_PLAYER_TORQUE;
    if (this.keys.right) pendAlpha += PENDULUM_PLAYER_TORQUE;

    pendAlpha -= PENDULUM_DAMPING * this.pendulumVel;

    this.pendulumVel += pendAlpha * dt;
    this.pendulumAngle += this.pendulumVel * dt;
    // No angle clamp — full 360° rotation allowed

    // Reaction force: cabin weight component along rail tangent
    const pendForceX = PENDULUM_MASS_RATIO * gEff * Math.sin(this.pendulumAngle);
    this.speed += pendForceX * rTx * dt / ROLLING_INERTIA_FACTOR;

    this.prevWheelVX = wheelVX;
    this.prevWheelVY = wheelVY;

    this.distance += Math.abs(this.speed * dt) * 0.1; // px to meters
    this.elapsedTime += dt;

    // Check level completion: touched the end tile (on any segment)
    if (this.hasFinitePath && this.touchedEndTile() && !this.levelCompleted) {
      this.speed = 0;
      this.levelCompleted = true;
      this.onLevelComplete?.(this.elapsedTime, this.starsCollected);
      return;
    }

    // Timers
    if (this.invulnTimer > 0) this.invulnTimer -= dt;
    if (this.rocketTimer > 0) this.rocketTimer -= dt;
    if (this.shieldTimer > 0) this.shieldTimer -= dt;
    if (this.flashTimer > 0) this.flashTimer -= dt;

    // Generate more rail
    if (!this.hasFinitePath && this.pos > this.rail.length - 80) {
      this.generateRail(100);
    }

    // Collision
    this.checkCollisions();
    this.checkStarCollection();

    // Update obstacle state machines and animations
    this.updateObstacles(dt);

    // Callbacks
    this.ghostRecorder?.onTick(this);
    this.onUpdate?.(this.distance, this.passengers, Math.abs(this.speed) * 0.1);
  }

  getGondolaPos(): Point {
    if (this.hasFinitePath && !this.onRail) {
      return { x: this.airX, y: this.airY };
    }

    const i = Math.floor(this.pos);
    const f = this.pos - i;
    if (i < 0) return this.rail.length > 0 ? this.rail[0] : { x: 0, y: 300 };
    if (i >= this.rail.length - 1) return this.rail.length > 0 ? this.rail[this.rail.length - 1] : { x: 0, y: 300 };
    const p0 = this.rail[i];
    const p1 = this.rail[i + 1];
    const rx = p0.x + (p1.x - p0.x) * f;
    const ry = p0.y + (p1.y - p0.y) * f;
    // Offset wheel center perpendicular to rail (wheel sits on top of rail)
    const { nx, ny } = this.getRailNormal(this.pos);
    return { x: rx + nx * WHEEL_RADIUS, y: ry + ny * WHEEL_RADIUS };
  }

  /**
   * Smoothed upward-pointing normal and tangent at any fractional pos along this.rail.
   * Uses Phong-style averaging at polyline joints to prevent jitter.
   */
  getRailNormal(pos: number): { nx: number; ny: number; tx: number; ty: number } {
    const rail = this.rail;
    const len = rail.length;
    if (len < 2) return { nx: 0, ny: -1, tx: 1, ty: 0 };

    let i = Math.floor(pos);
    let f = pos - i;
    if (i < 0) { i = 0; f = 0; }
    if (i >= len - 1) { i = len - 2; f = 1; }

    // Segment tangent helper (normalized)
    const segTan = (a: number) => {
      const dx = rail[a + 1].x - rail[a].x;
      const dy = rail[a + 1].y - rail[a].y;
      const l = Math.sqrt(dx * dx + dy * dy) || 1;
      return { tx: dx / l, ty: dy / l };
    };

    // Smoothed tangent at a rail point by averaging adjacent segment tangents
    const smoothTanAt = (idx: number) => {
      if (idx <= 0) return segTan(0);
      if (idx >= len - 1) return segTan(len - 2);
      const prev = segTan(idx - 1);
      const curr = segTan(idx);
      const ax = prev.tx + curr.tx;
      const ay = prev.ty + curr.ty;
      const al = Math.sqrt(ax * ax + ay * ay) || 1;
      return { tx: ax / al, ty: ay / al };
    };

    // Lerp smoothed tangents at endpoints of current segment
    const t0 = smoothTanAt(i);
    const t1 = smoothTanAt(i + 1);
    let tx = t0.tx + (t1.tx - t0.tx) * f;
    let ty = t0.ty + (t1.ty - t0.ty) * f;
    const tl = Math.sqrt(tx * tx + ty * ty) || 1;
    tx /= tl;
    ty /= tl;

    // Perpendicular — two candidates
    let nx = -ty;
    let ny = tx;

    // Use continuity with previous normal to prevent flipping on loops.
    // If we have a meaningful previous normal, pick the candidate that agrees with it.
    const dot = nx * this.prevNormalX + ny * this.prevNormalY;
    if (dot < 0) {
      // The other perpendicular is closer to previous normal
      nx = ty;
      ny = -tx;
    } else if (dot === 0) {
      // Ambiguous (perpendicular to previous) — fall back to upward heuristic
      if (ny > 0) { nx = ty; ny = -tx; }
    }

    // Update tracked normal
    this.prevNormalX = nx;
    this.prevNormalY = ny;

    return { nx, ny, tx, ty };
  }

  /**
   * Seed prevNormal based on which side the wheel is approaching from.
   * This ensures getRailNormal picks the correct side after landing.
   */
  seedNormalFromApproach(pos: number, fromX: number, fromY: number) {
    const rail = this.rail;
    const len = rail.length;
    if (len < 2) { this.prevNormalX = 0; this.prevNormalY = -1; return; }
    let i = Math.floor(pos);
    let f = pos - i;
    if (i < 0) { i = 0; f = 0; }
    if (i >= len - 1) { i = len - 2; f = 1; }
    const p0 = rail[i];
    const p1 = rail[i + 1];
    const rx = p0.x + (p1.x - p0.x) * f;
    const ry = p0.y + (p1.y - p0.y) * f;
    // Direction from rail point toward where the wheel came from
    let dx = fromX - rx;
    let dy = fromY - ry;
    const dl = Math.sqrt(dx * dx + dy * dy) || 1;
    this.prevNormalX = dx / dl;
    this.prevNormalY = dy / dl;
  }

  /** Actual world-space cabin center, accounting for pendulum swing or airborne rotation. */
  getCabinCenter(): Point {
    const gp = this.getGondolaPos();
    // Canvas rotate(θ) maps local (0, HANG) to world (-sin(θ)*HANG, cos(θ)*HANG)
    return {
      x: gp.x - Math.sin(this.pendulumAngle) * GONDOLA_HANG,
      y: gp.y + Math.cos(this.pendulumAngle) * GONDOLA_HANG,
    };
  }

  /**
   * Set direction so positive speed moves rightward (increasing X).
   * Exception: purely vertical rails — positive speed moves upward.
   */
  initDirection(_entryPos?: number) {
    if (this.rail.length < 2) return;
    const first = this.rail[0];
    const last = this.rail[this.rail.length - 1];

    // Purely vertical: positive speed moves upward (screen y inverted)
    if (first.x === last.x) {
      this.direction = last.y <= first.y ? 1 : -1;
      return;
    }

    // Positive speed moves rightward (increasing X)
    this.direction = last.x > first.x ? 1 : -1;
  }

  /** Build AABBs for all rail segments (call once after allRailSegments is set). */
  buildSegmentBounds() {
    this.segmentBounds = this.allRailSegments.map(seg => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of seg) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      return { seg, minX, minY, maxX, maxY };
    });
  }

  /**
   * Swept circle vs line segment collision.
   * Returns earliest t ∈ [0,1] where a circle of `radius` moving from (cx,cy) by (dx,dy)
   * first touches the segment A→B, or null if no collision.
   */
  sweepCircleVsSegment(
    cx: number, cy: number,
    dx: number, dy: number,
    radius: number,
    a: Point, b: Point
  ): { t: number } | null {
    let bestT: number | null = null;
    const accept = (t: number) => {
      if (t >= 0 && t <= 1 && (bestT === null || t < bestT)) bestT = t;
    };

    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const eLenSq = ex * ex + ey * ey;
    const eLen = Math.sqrt(eLenSq);
    if (eLen < 0.001) {
      // Degenerate segment — treat as endpoint circle only
    } else {
      // Sub-check 1: ray vs infinite line at distance = radius (linear in t)
      const fx = cx - a.x;
      const fy = cy - a.y;
      const crossFE = fx * ey - fy * ex;
      const crossDE = dx * ey - dy * ex;

      if (Math.abs(crossDE) > 0.0001) {
        // Two solutions: cross = +radius*eLen and cross = -radius*eLen
        const t1 = (radius * eLen - crossFE) / crossDE;
        const t2 = (-radius * eLen - crossFE) / crossDE;
        for (const t of [t1, t2]) {
          if (t >= 0 && t <= 1) {
            // Check projection s ∈ [0,1]
            const px = cx + t * dx - a.x;
            const py = cy + t * dy - a.y;
            const s = (px * ex + py * ey) / eLenSq;
            if (s >= 0 && s <= 1) accept(t);
          }
        }
      }
    }

    // Sub-check 2 & 3: ray vs endpoint circles (quadratic)
    const endpoints = [a, b];
    for (const ep of endpoints) {
      const gx = cx - ep.x;
      const gy = cy - ep.y;
      const A = dx * dx + dy * dy;
      const B = 2 * (gx * dx + gy * dy);
      const C = gx * gx + gy * gy - radius * radius;
      const disc = B * B - 4 * A * C;
      if (disc >= 0 && A > 0) {
        const sqrtDisc = Math.sqrt(disc);
        const t1 = (-B - sqrtDisc) / (2 * A);
        const t2 = (-B + sqrtDisc) / (2 * A);
        accept(t1);
        accept(t2);
      }
    }

    return bestT !== null ? { t: bestT } : null;
  }

  /** True if the gondola cabin rect or cable probe overlaps the end tile trigger zone. */
  touchedEndTile(): boolean {
    if (!this.endTilePos) return false;
    const ex = this.endTilePos.x, ey = this.endTilePos.y;
    const R = GameEngine.END_TRIGGER_RADIUS;
    const wheel = this.getGondolaPos();
    const cabin = this.getCabinCenter();
    if (rectVsCircle(cabin.x, cabin.y, CABIN_W / 2, CABIN_H / 2, this.pendulumAngle, ex, ey, R)) return true;
    const cableMidX = (wheel.x + cabin.x) / 2, cableMidY = (wheel.y + cabin.y) / 2;
    return Math.hypot(cableMidX - ex, cableMidY - ey) < 4 + R;
  }

  getGameUpdateContext(): GameUpdateContext {
    return {
      getGondolaPos: () => this.getGondolaPos(),
      getCabinCenter: () => this.getCabinCenter(),
      gondolaHang: GONDOLA_HANG,
      hitRadius: HIT_RADIUS,
      dealDamage: (obs: Obstacle) => this.hitPassenger(obs),
      gondolaOverlapsCircle: (cx, cy, r) => {
        const cabin = this.getCabinCenter();
        if (rectVsCircle(cabin.x, cabin.y, CABIN_W / 2, CABIN_H / 2, this.pendulumAngle, cx, cy, r)) return true;
        const wheel = this.getGondolaPos();
        return Math.hypot((wheel.x + cabin.x) / 2 - cx, (wheel.y + cabin.y) / 2 - cy) < 4 + r;
      },
    };
  }

  updateObstacles(dt: number) {
    const ctx = this.getGameUpdateContext();
    for (const obs of this.obstacles) {
      if (obs.hit) continue;
      const behavior = OBSTACLE_BEHAVIORS[obs.type];
      if (behavior) behavior.update(obs, dt, ctx);
    }
  }

  checkCollisions() {
    if (this.invulnTimer > 0 || this.shieldTimer > 0) return;
    const wheel = this.getGondolaPos();
    const cabin = this.getCabinCenter();
    const cableMidX = (wheel.x + cabin.x) / 2;
    const cableMidY = (wheel.y + cabin.y) / 2;

    for (const obs of this.obstacles) {
      if (obs.hit) continue;
      const behavior = OBSTACLE_BEHAVIORS[obs.type];
      if (!behavior) continue;
      if (
        checkRectVsObstacle(obs, cabin.x, cabin.y, CABIN_W / 2, CABIN_H / 2, this.pendulumAngle) ||
        behavior.checkCollision(obs, cableMidX, cableMidY, 4)
      ) {
        this.hitPassenger(obs);
        return;
      }
    }
  }

  checkStarCollection() {
    const STAR_RADIUS = 18;
    const wheel = this.getGondolaPos();
    const cabin = this.getCabinCenter();
    const cableMidX = (wheel.x + cabin.x) / 2;
    const cableMidY = (wheel.y + cabin.y) / 2;
    for (const star of this.collectibleStars) {
      if (star.collected) continue;
      if (
        rectVsCircle(cabin.x, cabin.y, CABIN_W / 2, CABIN_H / 2, this.pendulumAngle, star.x, star.y, STAR_RADIUS) ||
        Math.hypot(cableMidX - star.x, cableMidY - star.y) < 4 + STAR_RADIUS
      ) {
        star.collected = true;
        this.starsCollected++;
        soundManager.playStarCollect();
      }
    }
  }

  hitPassenger(_obs: Obstacle) {
    this.passengers--;
    soundManager.playHit();
    this.invulnTimer = INVULN_TIME;
    this.flashTimer = 0.3;
    if (this.passengers <= 0) {
      this.gameOver = true;
      soundManager.playGameOver();
      const cash = Math.floor(this.distance * 0.5);
      this.onGameOver?.(this.distance, cash);
    }
  }

  // --- Rendering ---
  render() {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    const cfg = WORLD_CONFIG[this.world];

    // Camera tracks interpolated gondola position (per-frame, not per-tick)
    const gondolaWorld = this.getInterpolatedGondolaPos();
    const dt = this.frameDt;
    this.camera.x += (gondolaWorld.x - canvas.width * 0.35 - this.camera.x) * (1 - Math.exp(-5.0 * dt));
    this.camera.y += (gondolaWorld.y - canvas.height * 0.45 - this.camera.y) * (1 - Math.exp(-3.7 * dt));

    const cx = this.camera.x;
    const cy = this.camera.y;

    // Sky
    const skyGrad = ctx.createLinearGradient(0, 0, 0, h);
    skyGrad.addColorStop(0, this.skyOverride?.skyTop ?? cfg.skyTop);
    skyGrad.addColorStop(1, this.skyOverride?.skyBottom ?? cfg.skyBottom);
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, h);

    // Stars (moon)
    if (this.world === 'moon') {
      ctx.fillStyle = '#FFF';
      for (const s of this.stars) {
        const sx = ((s.x - cx * 0.05) % (w + 200)) - 100;
        const sy = s.y;
        ctx.beginPath();
        ctx.arc(sx, sy, s.s, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (!this.noBackground) {
      // Mountains (parallax)
      ctx.fillStyle = cfg.mountainColor;
      for (const m of this.mountains) {
        const mx = m.x - cx * 0.15;
        const my = h * 0.55 + cy * 0.05 - m.h + m.y;
        ctx.beginPath();
        ctx.moveTo(mx, my + m.h);
        ctx.lineTo(mx + m.w / 2, my);
        ctx.lineTo(mx + m.w, my + m.h);
        ctx.closePath();
        ctx.fill();
        // Snow cap
        if (this.world !== 'moon') {
          ctx.fillStyle = cfg.snowColor;
          ctx.beginPath();
          ctx.moveTo(mx + m.w * 0.35, my + m.h * 0.3);
          ctx.lineTo(mx + m.w / 2, my);
          ctx.lineTo(mx + m.w * 0.65, my + m.h * 0.3);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = cfg.mountainColor;
        }
      }

      // Clouds
      if (this.world !== 'moon') {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        for (const c of this.clouds) {
          const cloudX = ((c.x - cx * 0.08 + performance.now() * 0.005) % (w + 300)) - 150;
          ctx.beginPath();
          ctx.ellipse(cloudX, c.y - cy * 0.02, c.w / 2, c.h / 2, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(cloudX - c.w * 0.25, c.y - cy * 0.02 + 5, c.w * 0.3, c.h * 0.4, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(cloudX + c.w * 0.3, c.y - cy * 0.02 + 3, c.w * 0.25, c.h * 0.35, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Ground
    if (!this.noBackground) {
      this.renderGround(cx, cy, w, h, cfg);
    }

    // Background decoration tiles
    const bgKeys = Object.keys(this.bgTiles);
    if (bgKeys.length > 0) {
      const gs = this.bgTileSize;
      for (const key of bgKeys) {
        const ci = key.indexOf(',');
        const bgx = +key.slice(0, ci) * gs - cx;
        const bgy = +key.slice(ci + 1) * gs - cy;
        if (bgx + gs < 0 || bgx > w || bgy + gs < 0 || bgy > h) continue;
        const bg = this.bgTiles[key];
        ctx.fillStyle = bg.color;
        ctx.fillRect(bgx, bgy, gs, gs);
        if (bg.outline) {
          ctx.strokeStyle = bg.outlineColor ?? '#000000';
          ctx.lineWidth = 2;
          ctx.strokeRect(bgx + 1, bgy + 1, gs - 2, gs - 2);
        }
      }
    }

    // Rail cable
    this.renderRail(cx, cy, w);

    // Explicit start/end tiles for finite/editor levels, if configured
    if (this.hasFinitePath) {
      if (this.startTilePos) {
        spriteManager.drawSpriteOrFallback(
          ctx,
          'rail.startTile',
          this.startTilePos.x - cx,
          this.startTilePos.y - cy,
          { hitboxRadius: 20 }
        );
      }
      if (this.endTilePos) {
        spriteManager.drawSpriteOrFallback(
          ctx,
          'rail.endTile',
          this.endTilePos.x - cx,
          this.endTilePos.y - cy,
          { hitboxRadius: 20 }
        );
      }
    }

    // Obstacles
    this.renderObstacles(cx, cy);
    this.renderCollectibleStars(cx, cy);

    // Gondola
    this.renderGhost(cx, cy);
    this.renderGondola(cx, cy);

    if (this.debugHitbox) this.renderDebugHitboxes(cx, cy);

    // HUD
    this.renderHUD(w, h);
  }

  findVisibleRange(cx: number, w: number): [number, number] {
    const { rail } = this;
    let startIdx = 0;
    let endIdx = rail.length - 1;
    // Find first rail point visible (with margin)
    for (let i = 0; i < rail.length; i++) {
      if (rail[i].x >= cx - 200) { startIdx = Math.max(0, i - 1); break; }
    }
    // Find last rail point visible
    for (let i = startIdx; i < rail.length; i++) {
      if (rail[i].x > cx + w + 200) { endIdx = i; break; }
    }
    return [startIdx, endIdx];
  }

  renderGround(cx: number, cy: number, w: number, h: number, cfg: { grassColor: string; dirtColor: string }) {
    const { ctx, rail, ground } = this;

    const [startIdx, endIdx] = this.findVisibleRange(cx, w);

    if (endIdx <= startIdx) return;

    // Dirt fill
    ctx.fillStyle = cfg.dirtColor;
    ctx.beginPath();
    ctx.moveTo(rail[startIdx].x - cx, ground[startIdx] - cy);
    for (let i = startIdx; i <= endIdx; i++) {
      ctx.lineTo(rail[i].x - cx, ground[i] - cy);
    }
    ctx.lineTo(rail[endIdx].x - cx, h + 100);
    ctx.lineTo(rail[startIdx].x - cx, h + 100);
    ctx.closePath();
    ctx.fill();

    // Grass on top
    ctx.fillStyle = cfg.grassColor;
    ctx.beginPath();
    ctx.moveTo(rail[startIdx].x - cx, ground[startIdx] - cy);
    for (let i = startIdx; i <= endIdx; i++) {
      ctx.lineTo(rail[i].x - cx, ground[i] - cy);
    }
    for (let i = endIdx; i >= startIdx; i--) {
      ctx.lineTo(rail[i].x - cx, ground[i] - cy + 25);
    }
    ctx.closePath();
    ctx.fill();
  }

  renderRail(cx: number, cy: number, w: number) {
    const { ctx } = this;
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 4;

    // Always render all rail segments, without relying on x-mono visibility
    // assumptions. This ensures that any rail geometry that lands on screen
    // is drawn, even for loops or tracks that double back.
    const segmentsToDraw = this.allRailSegments.length > 0 ? this.allRailSegments : [this.rail];
    for (const seg of segmentsToDraw) {
      if (seg.length < 2) continue;
      ctx.beginPath();
      for (let i = 0; i < seg.length; i++) {
        const sx = seg[i].x - cx;
        const sy = seg[i].y - cy;
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }
  }

  findVisibleRangeForRail(rail: Point[], cx: number, w: number): [number, number] {
    let startIdx = 0;
    let endIdx = rail.length - 1;
    for (let i = 0; i < rail.length; i++) {
      if (rail[i].x >= cx - 200) { startIdx = Math.max(0, i - 1); break; }
    }
    for (let i = startIdx; i < rail.length; i++) {
      if (rail[i].x > cx + w + 200) { endIdx = i; break; }
    }
    return [startIdx, endIdx];
  }

  renderObstacles(cx: number, cy: number) {
    const { ctx } = this;
    const now = performance.now() / 1000;

    for (const obs of this.obstacles) {
      if (obs.hit) continue;
      const screenX = obs.x - cx;
      if (screenX < -150 || screenX > this.canvas.width + 150) continue;

      // Try sprite-based rendering first; if it succeeds, skip legacy vector drawing.
      const usedSprite = spriteManager.drawSpriteOrFallback(
        ctx,
        obs.typeId,
        screenX,
        obs.type === 'bouncer'
          ? obs.baseY + Math.sin(obs.angle) * obs.amplitude - cy
          : obs.y - cy,
        {
          rotation: obs.type === 'spinner' ? obs.angle : 0,
          hitboxRadius: obs.radius
        }
      );

      if (usedSprite) {
        continue;
      }

      const behavior = OBSTACLE_BEHAVIORS[obs.type];
      if (behavior) {
        behavior.render(obs, ctx, screenX, obs.y - cy, now);
      }
    }
  }

  renderCollectibleStars(cx: number, cy: number) {
    const { ctx } = this;
    const now = performance.now() / 1000;
    for (const star of this.collectibleStars) {
      if (star.collected) continue;
      const sx = star.x - cx;
      if (sx < -60 || sx > this.canvas.width + 60) continue;
      const sy = star.y - cy;

      // Gentle pulse
      const pulse = 1 + Math.sin(now * 3) * 0.08;
      const r = 18 * pulse;

      // Draw 5-pointed star
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(Math.sin(now * 0.7) * 0.15);
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
        const innerAngle = angle + Math.PI / 5;
        ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
        ctx.lineTo(Math.cos(innerAngle) * r * 0.4, Math.sin(innerAngle) * r * 0.4);
      }
      ctx.closePath();
      ctx.fillStyle = '#FFD700';
      ctx.fill();
      ctx.strokeStyle = '#DAA520';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Glow
      ctx.shadowColor = '#FFD700';
      ctx.shadowBlur = 12 * pulse;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
    }
  }


  getInterpolatedGondolaPos(): Point {
    const current = this.getGondolaPos();
    const alpha = this.interpolationAlpha;
    return {
      x: this.prevGondolaX + (current.x - this.prevGondolaX) * alpha,
      y: this.prevGondolaY + (current.y - this.prevGondolaY) * alpha,
    };
  }

  renderGhost(cx: number, cy: number) {
    const gp = this.ghostPlayer;
    if (!gp) return;

    const frame = gp.getFrame(this.elapsedTime);
    const { ctx } = this;

    if (frame) {
      const sx = frame.x - cx;
      const sy = frame.y - cy;

      ctx.save();
      ctx.globalAlpha = 0.35;

      // Wheel
      ctx.fillStyle = '#888';
      ctx.beginPath();
      ctx.arc(sx, sy, WHEEL_RADIUS, 0, Math.PI * 2);
      ctx.fill();

      // Spokes
      ctx.strokeStyle = '#aaa';
      ctx.lineWidth = 1.5;
      for (let s = 0; s < 3; s++) {
        const a = frame.wa + (s * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + Math.cos(a) * (WHEEL_RADIUS - 1), sy + Math.sin(a) * (WHEEL_RADIUS - 1));
        ctx.stroke();
      }

      // Cable + cabin in rotated frame
      ctx.translate(sx, sy);
      ctx.rotate(frame.pa);

      ctx.strokeStyle = '#888';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, WHEEL_RADIUS);
      ctx.lineTo(0, GONDOLA_HANG - CABIN_H / 2);
      ctx.stroke();

      ctx.translate(0, GONDOLA_HANG);
      ctx.fillStyle = '#888';
      ctx.fillRect(-CABIN_W / 2, -CABIN_H / 2, CABIN_W, CABIN_H);

      // Shield indicator
      if (frame.flags & 1) {
        ctx.strokeStyle = 'rgba(100, 200, 255, 0.5)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, CABIN_W / 2 + 6, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();

      // Ghost nickname label — visible for first 5s, fades out in the last second
      // Drawn after restore() so coordinates are in screen space
      if (this.ghostNickname && this.elapsedTime < 5) {
        const labelAlpha = Math.min(1, 5 - this.elapsedTime);
        const cableEnd = GONDOLA_HANG + CABIN_H / 2;
        const labelX = sx - Math.sin(frame.pa) * cableEnd;
        const labelY = sy + Math.cos(frame.pa) * cableEnd + 16;
        ctx.save();
        ctx.globalAlpha = labelAlpha * 0.9;
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.strokeText(`👻 ${this.ghostNickname}`, labelX, labelY);
        ctx.fillStyle = '#90CAF9';
        ctx.fillText(`👻 ${this.ghostNickname}`, labelX, labelY);
        ctx.restore();
      }
    } else if (gp.lastFrame && gp.finishedAge < 2) {
      // Ghost finished — show checkered flag indicator for 2s
      gp.finishedAge += this.FIXED_DT;
      const lf = gp.lastFrame;
      const sx = lf.x - cx;
      const sy = lf.y - cy;
      const alpha = Math.max(0, 0.6 * (1 - gp.finishedAge / 2));

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = 'bold 14px monospace';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText('🏁 Ghost finished!', sx, sy - 30);
      ctx.restore();
    }
  }

  renderGondola(cx: number, cy: number) {
    const { ctx } = this;
    const gp = this.getInterpolatedGondolaPos();
    const sx = gp.x - cx;
    const sy = gp.y - cy;

    // Flash effect when hit
    if (this.invulnTimer > 0 && Math.floor(this.invulnTimer * 8) % 2 === 0) return;

    if (this.debugHitbox) {
      this.renderGondolaDebug(cx, cy, sx, sy);
      return;
    }

    // Wheel on rail — rotating with spokes
    ctx.fillStyle = '#555';
    ctx.beginPath();
    ctx.arc(sx, sy, WHEEL_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    // 3 spokes at 120° intervals
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 1.5;
    for (let s = 0; s < 3; s++) {
      const a = this.wheelAngle + (s * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(a) * (WHEEL_RADIUS - 1), sy + Math.sin(a) * (WHEEL_RADIUS - 1));
      ctx.stroke();
    }
    // Hub
    ctx.fillStyle = '#AAA';
    ctx.beginPath();
    ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
    ctx.fill();

    const swing = this.pendulumAngle;

    // Rotate everything (cable + cabin) around the wheel pivot
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(swing);

    // Cable from wheel to cabin (straight down in rotated frame)
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, WHEEL_RADIUS);
    ctx.lineTo(0, GONDOLA_HANG - CABIN_H / 2);
    ctx.stroke();

    // Cabin center is straight down from wheel in the rotated frame
    ctx.translate(0, GONDOLA_HANG);

    // Shield glow
    if (this.shieldTimer > 0) {
      ctx.strokeStyle = 'rgba(100, 200, 255, 0.6)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, HIT_RADIUS + 15, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Rocket flame
    if (this.rocketTimer > 0) {
      ctx.fillStyle = '#FF6600';
      ctx.beginPath();
      const flameLen = 15 + Math.random() * 15;
      ctx.moveTo(-CABIN_W / 2, 0);
      ctx.lineTo(-CABIN_W / 2 - flameLen, 5);
      ctx.lineTo(-CABIN_W / 2, 10);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#FFCC00';
      ctx.beginPath();
      ctx.moveTo(-CABIN_W / 2, 2);
      ctx.lineTo(-CABIN_W / 2 - flameLen * 0.6, 5);
      ctx.lineTo(-CABIN_W / 2, 8);
      ctx.closePath();
      ctx.fill();
    }

    // Cabin body (drawn centered at 0,0 = cabin center)
    const cabX = -CABIN_W / 2;
    const cabY = -CABIN_H / 2;

    // Main body
    ctx.fillStyle = '#E53935';
    ctx.strokeStyle = '#B71C1C';
    ctx.lineWidth = 2;
    this.roundRect(cabX, cabY, CABIN_W, CABIN_H, 6);
    ctx.fill();
    ctx.stroke();

    // Roof
    ctx.fillStyle = '#C62828';
    this.roundRect(cabX - 2, cabY - 4, CABIN_W + 4, 8, 3);
    ctx.fill();

    // Window
    ctx.fillStyle = 'rgba(135, 206, 250, 0.7)';
    ctx.fillRect(cabX + 4, cabY + 4, CABIN_W - 8, CABIN_H * 0.45);
    ctx.strokeStyle = '#B71C1C';
    ctx.lineWidth = 1;
    ctx.strokeRect(cabX + 4, cabY + 4, CABIN_W - 8, CABIN_H * 0.45);

    // Passengers (dogs in window)
    const passengerSpace = CABIN_W - 16;
    const pSize = Math.min(8, passengerSpace / (this.passengers + this.upgrades.health));
    for (let p = 0; p < this.passengers; p++) {
      const maxP = 3 + this.upgrades.health;
      const px = cabX + 8 + (p / maxP) * (passengerSpace - pSize) + pSize / 2;
      const py = cabY + 10;
      const r = pSize * 0.72;

      // Fat body
      ctx.fillStyle = '#C8A050';
      ctx.beginPath();
      ctx.ellipse(px, py + r * 0.9, r * 0.9, r * 0.65, 0, 0, Math.PI * 2);
      ctx.fill();

      // Floppy ears (drawn before head so head overlaps their tops)
      ctx.fillStyle = '#A07030';
      ctx.beginPath();
      ctx.ellipse(px - r * 0.75, py + r * 0.15, r * 0.32, r * 0.55, -0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(px + r * 0.75, py + r * 0.15, r * 0.32, r * 0.55, 0.25, 0, Math.PI * 2);
      ctx.fill();

      // Head
      ctx.fillStyle = '#C8A050';
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();

      // Snout
      ctx.fillStyle = '#DDB870';
      ctx.beginPath();
      ctx.ellipse(px, py + r * 0.25, r * 0.42, r * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();

      // Nose
      ctx.fillStyle = '#4A2A10';
      ctx.beginPath();
      ctx.ellipse(px, py + r * 0.1, r * 0.18, r * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();

      // Eyes
      ctx.fillStyle = '#1A0A00';
      ctx.beginPath();
      ctx.arc(px - r * 0.38, py - r * 0.18, r * 0.17, 0, Math.PI * 2);
      ctx.arc(px + r * 0.38, py - r * 0.18, r * 0.17, 0, Math.PI * 2);
      ctx.fill();

      // Eye shine
      ctx.fillStyle = '#FFF';
      ctx.beginPath();
      ctx.arc(px - r * 0.32, py - r * 0.24, r * 0.07, 0, Math.PI * 2);
      ctx.arc(px + r * 0.44, py - r * 0.24, r * 0.07, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore(); // cabin rotation
  }

  renderDebugHitboxes(cx: number, cy: number) {
    const { ctx } = this;

    const obsStroke = 'rgba(255, 80, 80, 0.9)';
    const obsFill   = 'rgba(255, 50, 50, 0.2)';

    ctx.save();
    ctx.lineWidth = 1.5;

    for (const obs of this.obstacles) {
      if (obs.hit) continue;
      const sx = obs.x - cx;
      if (sx < -300 || sx > this.canvas.width + 300) continue;
      const sy = obs.y - cy;

      ctx.strokeStyle = obsStroke;
      ctx.fillStyle   = obsFill;
      ctx.setLineDash([]);

      switch (obs.type) {
        case 'spinner': {
          const spinRot = obs.rotation ?? 0;
          // Center hub
          ctx.beginPath(); ctx.arc(sx, sy, obs.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          // 4 arms as thick lines (ARM_HALF = 9 → lineWidth 18)
          ctx.save();
          ctx.strokeStyle = obsStroke;
          ctx.lineCap = 'round';
          ctx.lineWidth = 18;
          ctx.globalAlpha = 0.25;
          for (let a = 0; a < 4; a++) {
            const armAngle = obs.angle + spinRot + (a * Math.PI) / 2;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx + Math.cos(armAngle) * obs.armLength, sy + Math.sin(armAngle) * obs.armLength);
            ctx.stroke();
          }
          // Pole (POLE_HALF = 5 → lineWidth 10)
          ctx.lineWidth = 10;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx - 60 * Math.sin(spinRot), sy + 60 * Math.cos(spinRot));
          ctx.stroke();
          ctx.restore();
          break;
        }
        case 'bouncer': {
          const baseScreenY = obs.baseY - cy;
          const localOffset = Math.sin(obs.angle) * obs.amplitude;
          ctx.save();
          ctx.translate(sx, baseScreenY);
          ctx.rotate(obs.rotation ?? 0);
          ctx.beginPath(); ctx.arc(0, localOffset, obs.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.restore();
          break;
        }
        case 'pendulum': {
          const currentSwing = (obs.swingAngle ?? 0.8) * Math.sin(obs.angle);
          const cableLen = obs.cableLength ?? 120;
          const bobR = obs.bobRadius ?? obs.radius;
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(obs.rotation ?? 0);
          const localBobX = Math.sin(currentSwing) * cableLen;
          const localBobY = Math.cos(currentSwing) * cableLen;
          ctx.beginPath(); ctx.arc(localBobX, localBobY, bobR, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.restore();
          break;
        }
        case 'laser': {
          const warnRad = obs.bounceSpeed * (obs.warningTime ?? 2.0);
          const phase = (obs.angle ?? 0) % (warnRad + Math.PI);
          const isActive = phase >= warnRad;
          const beamAngle = (obs.beamDirection === 'left' ? Math.PI : 0) + (obs.rotation ?? 0);
          const beamLen = obs.beamLength ?? obs.armLength;
          const beamEndX = sx + Math.cos(beamAngle) * beamLen;
          const beamEndY = sy + Math.sin(beamAngle) * beamLen;
          ctx.save();
          ctx.strokeStyle = isActive ? 'rgba(255, 50, 50, 0.9)' : 'rgba(255, 150, 50, 0.45)';
          ctx.lineWidth = 10; // BEAM_HALF * 2
          ctx.lineCap = 'round';
          ctx.globalAlpha = isActive ? 0.4 : 0.2;
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(beamEndX, beamEndY); ctx.stroke();
          ctx.restore();
          break;
        }
        case 'swoop': {
          const pw = obs.patrolWidth ?? 160;
          const birdSX = obs.x + Math.sin(obs.angle) * pw / 2 - cx;
          const birdSY = obs.baseY + obs.amplitude - cy;
          ctx.beginPath(); ctx.arc(birdSX, birdSY, obs.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          break;
        }
        case 'orbiter': {
          const ballSX = sx + Math.cos(obs.angle + (obs.rotation ?? 0)) * obs.armLength;
          const ballSY = sy + Math.sin(obs.angle + (obs.rotation ?? 0)) * obs.armLength;
          ctx.beginPath(); ctx.arc(ballSX, ballSY, obs.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          break;
        }
        case 'boulder': {
          if (obs.armLength === 2) {
            ctx.beginPath(); ctx.arc(sx, sy, obs.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          }
          break;
        }
        case 'mine': {
          if (obs.armLength === 0) {
            // Idle: show trigger radius as dashed
            ctx.strokeStyle = 'rgba(255, 160, 50, 0.7)';
            ctx.fillStyle   = 'rgba(255, 160, 50, 0.08)';
            ctx.setLineDash([5, 4]);
            ctx.beginPath(); ctx.arc(sx, sy, obs.triggerRadius ?? 40, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.setLineDash([]);
          } else if (obs.armLength === 1) {
            // Armed: show explosion radius
            ctx.strokeStyle = 'rgba(255, 50, 50, 0.85)';
            ctx.fillStyle   = 'rgba(255, 50, 50, 0.12)';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(sx, sy, obs.explosionRadius ?? 80, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          }
          break;
        }
        case 'crusher':
        case 'stalactite': {
          ctx.beginPath(); ctx.arc(sx, sy, obs.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          break;
        }
      }
    }

    // Stars — collision radius is 18px
    ctx.strokeStyle = 'rgba(255, 220, 0, 0.9)';
    ctx.fillStyle   = 'rgba(255, 220, 0, 0.18)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    for (const star of this.collectibleStars) {
      if (star.collected) continue;
      ctx.beginPath(); ctx.arc(star.x - cx, star.y - cy, 18, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }

    // End tile trigger zone
    if (this.endTilePos) {
      ctx.strokeStyle = 'rgba(0, 255, 80, 0.85)';
      ctx.fillStyle   = 'rgba(0, 255, 80, 0.1)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.arc(this.endTilePos.x - cx, this.endTilePos.y - cy, GameEngine.END_TRIGGER_RADIUS, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  renderGondolaDebug(cx: number, cy: number, sx: number, sy: number) {
    const { ctx } = this;
    const cabin = this.getCabinCenter();
    const cabSX = cabin.x - cx;
    const cabSY = cabin.y - cy;

    // Cable line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(cabSX, cabSY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Wheel point
    ctx.fillStyle = 'rgba(255, 0, 255, 0.6)';
    ctx.beginPath();
    ctx.arc(sx, sy, WHEEL_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FF00FF';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Cabin collision rect
    ctx.save();
    ctx.translate(cabSX, cabSY);
    ctx.rotate(this.pendulumAngle);
    ctx.fillStyle = 'rgba(0, 255, 0, 0.2)';
    ctx.strokeStyle = 'rgba(0, 255, 0, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.fillRect(-CABIN_W / 2, -CABIN_H / 2, CABIN_W, CABIN_H);
    ctx.strokeRect(-CABIN_W / 2, -CABIN_H / 2, CABIN_W, CABIN_H);
    ctx.restore();

    // Cable midpoint probe
    const cableMidSX = (sx + cabSX) / 2;
    const cableMidSY = (sy + cabSY) / 2;
    ctx.fillStyle = 'rgba(0, 200, 255, 0.5)';
    ctx.beginPath();
    ctx.arc(cableMidSX, cableMidSY, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 200, 255, 1)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  roundRect(x: number, y: number, w: number, h: number, r: number) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  renderHUD(w: number, h: number) {
    const { ctx } = this;

    // Elapsed time + PB/Ghost times (top-left)
    const totalSeconds = Math.floor(this.elapsedTime);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    const timeLabel = `⏱ ${mins}:${secs.toString().padStart(2, '0')}`;
    ctx.font = 'bold 18px system-ui, sans-serif';
    const timeLabelW = ctx.measureText(timeLabel).width + 20; // 10px padding each side

    let timeBadges: { label: string; color: string }[] = [];
    if (this.personalBestTime != null) {
      timeBadges.push({ label: `🏆 ${formatTime(this.personalBestTime)}`, color: '#FFD54F' });
    }
    if (this.ghostTime != null) {
      timeBadges.push({ label: `👻 ${formatTime(this.ghostTime)}`, color: '#90CAF9' });
    }

    // Measure badge widths
    ctx.font = 'bold 14px system-ui, sans-serif';
    const badgeMetrics = timeBadges.map(b => ({
      ...b,
      w: ctx.measureText(b.label).width + 16, // 8px padding each side
    }));
    const badgeTotalW = badgeMetrics.reduce((s, b) => s + b.w + 6, 0); // 6px gap

    const panelW = Math.max(180, timeLabelW + badgeTotalW + 10);
    const hasBadges = badgeMetrics.length > 0;
    const panelH = hasBadges ? 54 : 36;

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    this.roundRect(10, 10, panelW, panelH, 6);
    ctx.fill();

    ctx.fillStyle = '#FFD54F';
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(timeLabel, 20, 34);

    // PB and ghost time badges to the right of elapsed time
    let badgeX = 20 + timeLabelW + 4;
    for (const badge of badgeMetrics) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      this.roundRect(badgeX, 16, badge.w, 24, 4);
      ctx.fill();
      ctx.fillStyle = badge.color;
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(badge.label, badgeX + 8, 33);
      badgeX += badge.w + 6;
    }

    // Speed + distance panel (top-right)
    const speedText = `⚡ ${Math.floor(Math.abs(this.speed) * 0.36)} km/h`;
    const distText = `📏 ${Math.floor(this.distance)}m`;
    ctx.font = 'bold 18px system-ui, sans-serif';
    const speedTextW = ctx.measureText(speedText).width;
    ctx.font = 'bold 14px system-ui, sans-serif';
    const distTextW = ctx.measureText(distText).width;
    const speedPanelW = Math.max(speedTextW, distTextW) + 24;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    this.roundRect(w - speedPanelW - 10, 10, speedPanelW, 52, 6);
    ctx.fill();
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.fillStyle = '#FFF';
    ctx.textAlign = 'right';
    ctx.fillText(speedText, w - 20, 34);
    ctx.fillStyle = '#FFF';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillText(distText, w - 20, 50);

    // Passengers
    const passengersY = 10 + panelH + 30;
    ctx.textAlign = 'left';
    for (let p = 0; p < 3 + this.upgrades.health; p++) {
      ctx.fillStyle = p < this.passengers ? '#E53935' : 'rgba(255,255,255,0.2)';
      ctx.font = '22px system-ui';
      ctx.fillText('❤️', 15 + p * 28, passengersY);
    }

    // Star count (below health) — only in levels that have collectible stars
    if (this.collectibleStars.length > 0) {
      const total = this.collectibleStars.length;
      const collected = this.starsCollected;
      const starsY = passengersY + 28;
      if (total > 3) {
        // Numeric display for many stars
        const label = `⭐ ${collected} / ${total}`;
        ctx.font = 'bold 16px system-ui, sans-serif';
        ctx.fillStyle = '#FFD54F';
        ctx.textAlign = 'left';
        ctx.fillText(label, 15, starsY);
      } else {
        // Icon display for ≤3 stars
        ctx.font = '22px system-ui';
        ctx.textAlign = 'left';
        for (let s = 0; s < total; s++) {
          ctx.globalAlpha = s < collected ? 1.0 : 0.25;
          ctx.fillText('⭐', 15 + s * 28, starsY);
        }
        ctx.globalAlpha = 1.0;
      }
    }

    // Throttle/Brake bar
    const barW = 280;
    const barH = 30;
    const barX = (w - barW) / 2;
    const barY = h - 50;
    const arrowRowH = 22; // height reserved above bar for the throttle direction indicator


    // Throttle direction arrow (shows which physical direction ▲ UP key will propel the gondola)
    {
      const upMeansForward = !this.directionFlipped;
      const upPressed = this.keys.up;
      // The arrow showing UP key's mapped direction
      const upArrow = upMeansForward ? '▶' : '◀';
      const cx = w / 2;
      const arrowY = barY - arrowRowH / 2 + 6;

      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.textAlign = 'center';

      // UP key direction indicator
      if (upPressed) {
        ctx.fillStyle = '#4CAF50';
        ctx.fillText(upArrow, cx, arrowY);
      } else {
        ctx.strokeStyle = '#FFF';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.strokeText(upArrow, cx, arrowY);
        ctx.fillStyle = '#000';
        ctx.fillText(upArrow, cx, arrowY);
      }
    }

    // Bar background
    ctx.fillStyle = '#333';
    this.roundRect(barX, barY, barW, barH, 4);
    ctx.fill();

    // Speed indicator
    const speedFrac = this.speed / (MAX_SPEED_BASE + this.upgrades.motor * 80);
    const fillW = Math.abs(speedFrac) * barW / 2;
    if (speedFrac > 0) {
      ctx.fillStyle = '#4CAF50';
      ctx.fillRect(barX + barW / 2, barY + 2, fillW, barH - 4);
    } else if (speedFrac < 0) {
      ctx.fillStyle = '#E53935';
      ctx.fillRect(barX + barW / 2 - fillW, barY + 2, fillW, barH - 4);
    }

    // Center mark
    ctx.fillStyle = '#FFF';
    ctx.fillRect(barX + barW / 2 - 1, barY, 2, barH);

    // Power-ups
    let pyOffset = 100;
    if (this.rocketCharges > 0 || this.rocketTimer > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      this.roundRect(10, pyOffset, 140, 28, 4);
      ctx.fill();
      ctx.fillStyle = this.rocketTimer > 0 ? '#FF6600' : '#FFF';
      ctx.font = '14px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText(`🚀 Rocket x${this.rocketCharges} [SPACE]`, 18, pyOffset + 20);
      pyOffset += 34;
    }
    if (this.shieldCharges > 0 || this.shieldTimer > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      this.roundRect(10, pyOffset, 140, 28, 4);
      ctx.fill();
      ctx.fillStyle = this.shieldTimer > 0 ? '#64B5F6' : '#FFF';
      ctx.font = '14px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText(`🛡️ Shield x${this.shieldCharges} [SHIFT]`, 18, pyOffset + 20);
    }

    // Game over
    if (this.gameOver) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = '#FFF';
      ctx.font = 'bold 48px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('GAME OVER', w / 2, h / 2 - 40);

      ctx.font = '24px system-ui';
      ctx.fillStyle = '#FFD700';
      ctx.fillText(`Distance: ${Math.floor(this.distance)}m`, w / 2, h / 2 + 10);
      ctx.fillText(`Cash earned: $${Math.floor(this.distance * 0.5)}`, w / 2, h / 2 + 45);

      ctx.font = '18px system-ui';
      ctx.fillStyle = '#AAA';
      ctx.fillText('Press ENTER to continue', w / 2, h / 2 + 90);
    }

    ctx.restore();
  }
}
