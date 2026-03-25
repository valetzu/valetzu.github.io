import { WorldType, Upgrades, Point, Obstacle, WORLD_CONFIG } from './types';
import { spriteManager } from './spriteManager';
import { OBSTACLE_BEHAVIORS, GameUpdateContext } from './obstacleBehaviors';
import { createRng } from './rng';

const RAIL_SPACING = 100;
const THROTTLE_BASE = 350;
const MAX_SPEED_BASE = 500;
const GONDOLA_HANG = 38;
const CABIN_W = 56;
const CABIN_H = 36;
const HIT_RADIUS = 26;
const INVULN_TIME = 2;
const ROCKET_DURATION = 3;
const SHIELD_DURATION = 2.5;
const OBSTACLE_MIN_GAP = 280;
const OBSTACLE_MAX_GAP = 500;

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
  ground: number[] = []; // groundY for each rail point
  pos: number = 0;
  speed: number = 0;
  direction: 1 | -1 = 1;
  passengers: number = 3;
  distance: number = 0;
  obstacles: Obstacle[] = [];
  keys = { up: false, down: false, left: false, right: false, space: false, shift: false };
  noBackground = false;
  hasFinitePath = false;
  isLoop = false;
  /** Trigger radius for end tile proximity check (world pixels) */
  static END_TRIGGER_RADIUS = 60;
  onRail = true;

  // Optional world positions for explicit start/end tiles in finite/editor levels
  startTilePos: Point | null = null;
  endTilePos: Point | null = null;

  // Airborne state (when the player leaves the rail)
  airX = 0;
  airY = 0;
  airVX = 0;
  airVY = 0;
  airRotation = 0;
  airRotVel = 0;
  airborneTime = 0; // time spent airborne — cooldown for snap-back to exited rail
  airborneFromSeg: Point[] | null = null; // the rail segment the player launched from

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
    if (e.code === 'Space' && this.rocketTimer <= 0 && this.rocketCharges > 0) {
      this.rocketTimer = ROCKET_DURATION;
      this.rocketCharges--;
      e.preventDefault();
    }
    if (e.code === 'ShiftLeft' && this.shieldTimer <= 0 && this.shieldCharges > 0) {
      this.shieldTimer = SHIELD_DURATION;
      this.shieldCharges--;
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

      // Mid-air rotation via left/right keys
      const rotAccel = 4;
      if (this.keys.left) this.airRotVel -= rotAccel * dt;
      if (this.keys.right) this.airRotVel += rotAccel * dt;

      // Rotation damping
      this.airRotVel *= Math.exp(-2 * dt);
      this.airRotation += this.airRotVel * dt;

      // Integrate position
      this.airX += this.airVX * dt;
      this.airY += this.airVY * dt;

      // Update distance for HUD (approximate)
      this.distance += vMag * dt * 0.1;
      this.elapsedTime += dt;
      this.airborneTime += dt;

      // Try to snap back to any rail segment if we pass near it (after brief cooldown)
      const snapRadius = 20
      const segmentsToSearch = this.allRailSegments.length > 0 ? this.allRailSegments : [this.rail];
      let bestSeg: Point[] | null = null;
      let bestIdx = -1;
      let bestDist = snapRadius;
      for (const seg of segmentsToSearch) {
        if (seg.length < 2) continue;
        // Skip the exited segment during cooldown
        if (seg === this.airborneFromSeg && this.airborneTime <= 0.3) continue;
        for (let i = 0; i < seg.length; i++) {
          const p = seg[i];
          const dx = p.x - this.airX;
          const dy = p.y - this.airY;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < bestDist) {
            bestDist = d;
            bestSeg = seg;
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

        // Interpolate pos along segment for smooth placement
        const relX = this.airX - p0.x;
        const relY = this.airY - p0.y;
        const proj = Math.max(0, Math.min(1, (relX * tx + relY * ty) / segLen));

        this.onRail = true;
        this.rail = bestSeg;
        this.pos = bestIdx + proj;
        this.initDirection(this.pos);
        // Use only the rail-aligned component of velocity
        this.speed = tangentialSpeed * this.direction;
        this.airVX = this.airVY = 0;

        // Level complete when we snapped onto the end tile (any segment)
        if (this.touchedEndTile() && !this.levelCompleted) {
          this.speed = 0;
          this.levelCompleted = true;
          this.onLevelComplete?.(this.elapsedTime, this.starsCollected);
        }
      }

      // Timers
      if (this.invulnTimer > 0) this.invulnTimer -= dt;
      if (this.rocketTimer > 0) this.rocketTimer -= dt;
      if (this.shieldTimer > 0) this.shieldTimer -= dt;
      if (this.flashTimer > 0) this.flashTimer -= dt;

      // No rail generation or obstacle collisions while off-track
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

        this.onRail = false;
        this.airborneTime = 0;
        this.airborneFromSeg = this.rail;
        this.airX = launchPoint.x;
        this.airY = launchPoint.y;
        this.airVX = (dx / segLen) * effSpeed;
        this.airVY = (dy / segLen) * effSpeed;
        this.airRotation = 0;
        this.airRotVel = 0;
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
    if (this.keys.up) throttle = THROTTLE_BASE * motorMult;
    if (this.keys.down) throttle = -THROTTLE_BASE * motorMult;
    if (this.rocketTimer > 0) throttle += THROTTLE_BASE * 1.5;

    const gravity = this.direction * cfg.gravity * Math.sin(angle) * 0.15;
    const friction = -this.speed * cfg.friction * gripMult;
    const drag = -this.speed * Math.abs(this.speed) * 0.0003;

    this.speed += (throttle + gravity + friction + drag) * dt;
    this.speed = Math.max(-maxSpeed, Math.min(maxSpeed, this.speed));

    const dPos = (this.direction * this.speed * dt) / segLen;
    this.pos += dPos;
    if (this.isLoop && this.rail.length > 2) {
      const cycleLen = this.rail.length - 1;
      while (this.pos >= cycleLen) this.pos -= cycleLen;
      while (this.pos < 0) this.pos += cycleLen;
    }

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
    return { x: p0.x + (p1.x - p0.x) * f, y: p0.y + (p1.y - p0.y) * f };
  }

  /**
   * Set direction so arrow-up moves toward the farther rail end from the entry point.
   * Exception: purely vertical rails — arrow-up moves upward.
   */
  initDirection(entryPos?: number) {
    if (this.rail.length < 2) return;
    const first = this.rail[0];
    const last = this.rail[this.rail.length - 1];

    // Purely vertical: arrow-up moves upward (screen y inverted)
    if (first.x === last.x) {
      this.direction = last.y <= first.y ? 1 : -1;
      return;
    }

    // Arrow-up moves toward the farther end from entry
    const idx = entryPos != null ? Math.floor(Math.max(0, Math.min(this.rail.length - 1, entryPos))) : 0;
    const entry = this.rail[idx];
    const dFirst = Math.hypot(first.x - entry.x, first.y - entry.y);
    const dLast = Math.hypot(last.x - entry.x, last.y - entry.y);
    // Farther end is at higher indices → direction 1, at lower indices → direction -1
    this.direction = dLast >= dFirst ? 1 : -1;
  }

  /** True if the gondola is within the end tile trigger area (world-space proximity). */
  touchedEndTile(): boolean {
    if (!this.endTilePos) return false;
    const gp = this.onRail ? this.getGondolaPos() : { x: this.airX, y: this.airY };
    const d = Math.hypot(gp.x - this.endTilePos.x, gp.y - this.endTilePos.y);
    return d < GameEngine.END_TRIGGER_RADIUS;
  }

  getGameUpdateContext(): GameUpdateContext {
    return {
      getGondolaPos: () => this.getGondolaPos(),
      gondolaHang: GONDOLA_HANG,
      hitRadius: HIT_RADIUS,
      dealDamage: (obs: Obstacle) => this.hitPassenger(obs),
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
    const gp = this.getGondolaPos();
    const cx = gp.x;
    const cy = gp.y + GONDOLA_HANG;

    for (const obs of this.obstacles) {
      if (obs.hit) continue;
      const behavior = OBSTACLE_BEHAVIORS[obs.type];
      if (behavior && behavior.checkCollision(obs, cx, cy, HIT_RADIUS)) {
        this.hitPassenger(obs);
        return;
      }
    }
  }

  checkStarCollection() {
    const gp = this.getGondolaPos();
    const cx = gp.x;
    const cy = gp.y + GONDOLA_HANG;
    for (const star of this.collectibleStars) {
      if (star.collected) continue;
      const dist = Math.hypot(cx - star.x, cy - star.y);
      if (dist < 30) {
        star.collected = true;
        this.starsCollected++;
      }
    }
  }

  hitPassenger(_obs: Obstacle) {
    this.passengers--;
    this.invulnTimer = INVULN_TIME;
    this.flashTimer = 0.3;
    if (this.passengers <= 0) {
      this.gameOver = true;
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
    skyGrad.addColorStop(0, cfg.skyTop);
    skyGrad.addColorStop(1, cfg.skyBottom);
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
    this.renderGondola(cx, cy);

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

  renderGondola(cx: number, cy: number) {
    const { ctx } = this;
    const gp = this.getInterpolatedGondolaPos();
    const sx = gp.x - cx;
    const sy = gp.y - cy;

    // Flash effect when hit
    if (this.invulnTimer > 0 && Math.floor(this.invulnTimer * 8) % 2 === 0) return;

    // Apply rotation around gondola center when airborne
    ctx.save();
    const pivotX = sx;
    const pivotY = sy + GONDOLA_HANG;
    if (this.hasFinitePath && !this.onRail) {
      ctx.translate(pivotX, pivotY);
      ctx.rotate(this.airRotation);
      ctx.translate(-pivotX, -pivotY);
    }

    // Shield glow
    if (this.shieldTimer > 0) {
      ctx.strokeStyle = 'rgba(100, 200, 255, 0.6)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(sx, sy + GONDOLA_HANG, HIT_RADIUS + 15, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Rocket flame
    if (this.rocketTimer > 0) {
      ctx.fillStyle = '#FF6600';
      ctx.beginPath();
      const flameLen = 15 + Math.random() * 15;
      ctx.moveTo(sx - CABIN_W / 2, sy + GONDOLA_HANG);
      ctx.lineTo(sx - CABIN_W / 2 - flameLen, sy + GONDOLA_HANG + 5);
      ctx.lineTo(sx - CABIN_W / 2, sy + GONDOLA_HANG + 10);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#FFCC00';
      ctx.beginPath();
      ctx.moveTo(sx - CABIN_W / 2, sy + GONDOLA_HANG + 2);
      ctx.lineTo(sx - CABIN_W / 2 - flameLen * 0.6, sy + GONDOLA_HANG + 5);
      ctx.lineTo(sx - CABIN_W / 2, sy + GONDOLA_HANG + 8);
      ctx.closePath();
      ctx.fill();
    }

    // Wheel on rail
    ctx.fillStyle = '#555';
    ctx.beginPath();
    ctx.arc(sx, sy, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#888';
    ctx.beginPath();
    ctx.arc(sx, sy, 4, 0, Math.PI * 2);
    ctx.fill();

    // Cable to cabin
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, sy + 7);
    ctx.lineTo(sx, sy + GONDOLA_HANG - CABIN_H / 2);
    ctx.stroke();

    // Cabin body
    const cabX = sx - CABIN_W / 2;
    const cabY = sy + GONDOLA_HANG - CABIN_H / 2;

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

    // Passengers (brown blobs in window)
    const passengerSpace = CABIN_W - 16;
    const pSize = Math.min(8, passengerSpace / (this.passengers + this.upgrades.health));
    for (let p = 0; p < this.passengers; p++) {
      const maxP = 3 + this.upgrades.health;
      const px = cabX + 8 + (p / maxP) * (passengerSpace - pSize) + pSize / 2;
      const py = cabY + 10;

      // Head
      ctx.fillStyle = '#8B6914';
      ctx.beginPath();
      ctx.arc(px, py, pSize * 0.7, 0, Math.PI * 2);
      ctx.fill();
      // Eyes
      ctx.fillStyle = '#FFF';
      ctx.beginPath();
      ctx.arc(px - 2, py - 1, 1.5, 0, Math.PI * 2);
      ctx.arc(px + 2, py - 1, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(px - 1.5, py - 1, 0.8, 0, Math.PI * 2);
      ctx.arc(px + 2.5, py - 1, 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
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

    // Distance
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    this.roundRect(10, 10, 180, 36, 6);
    ctx.fill();
    ctx.fillStyle = '#FFF';
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`📏 ${Math.floor(this.distance)}m`, 20, 34);

    // Speed + timer panel (top-right)
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    this.roundRect(w - 190, 10, 180, 52, 6);
    ctx.fill();
    ctx.fillStyle = '#FFF';
    ctx.textAlign = 'right';
    ctx.fillText(`⚡ ${Math.floor(Math.abs(this.speed) * 0.36)} km/h`, w - 20, 34);

    // Elapsed time (visible game timer in top-right section)
    const totalSeconds = Math.floor(this.elapsedTime);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    const timeLabel = `${mins}:${secs.toString().padStart(2, '0')}`;
    ctx.fillStyle = '#FFD54F';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillText(`⏱ ${timeLabel}`, w - 20, 50);

    // Passengers
    ctx.textAlign = 'left';
    for (let p = 0; p < 3 + this.upgrades.health; p++) {
      ctx.fillStyle = p < this.passengers ? '#E53935' : 'rgba(255,255,255,0.2)';
      ctx.font = '22px system-ui';
      ctx.fillText('❤️', 15 + p * 28, 72);
    }

    // Throttle/Brake bar
    const barW = 280;
    const barH = 30;
    const barX = (w - barW) / 2;
    const barY = h - 50;

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    this.roundRect(barX - 80, barY - 2, barW + 160, barH + 4, 8);
    ctx.fill();

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
