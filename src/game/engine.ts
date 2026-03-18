import { WorldType, Upgrades, Point, Obstacle, WORLD_CONFIG } from './types';
import { spriteManager } from './spriteManager';

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
  passengers: number = 3;
  distance: number = 0;
  obstacles: Obstacle[] = [];
  keys = { up: false, down: false, left: false, right: false, space: false, shift: false };
  noBackground = false;
  hasFinitePath = false;
  // For editor-defined finite levels: which segment + point is the end tile (complete when touching it)
  endSegmentIndex: number | null = null;
  endPointIndex: number | null = null;
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

  clouds: Cloud[] = [];
  stars: Star[] = [];
  mountains: Mountain[] = [];
  nextObstacleX = 600;

  onUpdate?: (dist: number, passengers: number, speed: number) => void;
  onGameOver?: (dist: number, cash: number) => void;
  onLevelComplete?: (time: number) => void;

  constructor(
    canvas: HTMLCanvasElement,
    world: WorldType,
    upgrades: Upgrades,
    callbacks: {
      onUpdate?: (d: number, p: number, s: number) => void;
      onGameOver?: (d: number, c: number) => void;
      onLevelComplete?: (time: number) => void;
    }
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.world = world;
    this.upgrades = upgrades;
    this.onUpdate = callbacks.onUpdate;
    this.onGameOver = callbacks.onGameOver;
    this.onLevelComplete = callbacks.onLevelComplete;
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
      const dy = (Math.random() - 0.48) * maxSlope;
      lastY = Math.max(120, Math.min(520, lastY + dy));
      this.rail.push({ x, y: lastY });

      // Ground follows below rail with variation
      const isChasm = Math.random() < 0.04 + difficulty * 0.03;
      const targetOffset = isChasm ? 400 + Math.random() * 200 : 100 + Math.random() * 120;
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
      const r = Math.random();

      let obs: Obstacle;
      if (r < 0.5) {
        // Spinner
        const armLen = (50 + Math.random() * 40) * 3;
        obs = {
          id: `obs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          typeId: 'obstacle.spinner',
          type: 'spinner',
          x, y: railY - 10 - Math.random() * 40,
          radius: 12, angle: Math.random() * Math.PI * 2,
          rotSpeed: -(0.3 + Math.random() * 0.4 + difficulty * 0.4),
          baseY: 0, amplitude: 0, bounceSpeed: 0,
          armLength: armLen, hit: false, hp: 1,
        };
      } else {
        // Bouncer
        obs = {
          id: `obs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          typeId: 'obstacle.bouncer',
          type: 'bouncer',
          x, y: railY,
          radius: 18, angle: Math.random() * Math.PI * 2,
          rotSpeed: 0,
          baseY: railY - 20, amplitude: 100 + Math.random() * 80,
          bounceSpeed: 0.6 + Math.random() * 0.8,
          armLength: 0, hit: false, hp: 1,
        };
      }
      this.obstacles.push(obs);
      this.nextObstacleX = x + OBSTACLE_MIN_GAP + Math.random() * (OBSTACLE_MAX_GAP - OBSTACLE_MIN_GAP) * (1 - difficulty * 0.3);
    }
  }

  generateBackground() {
    // Clouds or stars
    if (this.world === 'moon') {
      for (let i = 0; i < 200; i++) {
        this.stars.push({ x: Math.random() * 10000, y: Math.random() * 400, s: 1 + Math.random() * 2 });
      }
    } else {
      for (let i = 0; i < 15; i++) {
        this.clouds.push({
          x: Math.random() * 5000, y: 30 + Math.random() * 150,
          w: 80 + Math.random() * 120, h: 30 + Math.random() * 40,
        });
      }
    }
    // Mountains
    for (let i = 0; i < 20; i++) {
      this.mountains.push({
        x: i * 500 + Math.random() * 200,
        y: 0, w: 200 + Math.random() * 300, h: 150 + Math.random() * 200,
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
  }

  loop = () => {
    if (!this.running) return;
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    this.lastDt = dt;

    if (!this.paused && !this.gameOver && !this.levelCompleted) {
      this.update(dt);
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

      // Try to snap back to any rail segment if we pass near it
      const snapRadius = 40;
      const segmentsToSearch = this.allRailSegments.length > 0 ? this.allRailSegments : [this.rail];
      let bestSeg: Point[] | null = null;
      let bestIdx = -1;
      let bestDist = snapRadius;
      for (const seg of segmentsToSearch) {
        if (seg.length < 2) continue;
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

        this.onRail = true;
        this.rail = bestSeg;
        this.pos = bestIdx;
        this.speed = tangentialSpeed;
        this.airVX = this.airVY = 0;

        // Level complete when we snapped onto the end tile (any segment)
        if (this.touchedEndTile() && !this.levelCompleted) {
          this.pos = this.endPointIndex!;
          this.speed = 0;
          this.levelCompleted = true;
          this.onLevelComplete?.(this.elapsedTime);
        }
      }

      // Camera follows airborne gondola
      const gondolaWorld = this.getGondolaPos();
      this.camera.x += (gondolaWorld.x - this.canvas.width * 0.35 - this.camera.x) * (1 - Math.exp(-5.0 * dt));
      this.camera.y += (gondolaWorld.y - this.canvas.height * 0.45 - this.camera.y) * (1 - Math.exp(-3.7 * dt));

      // Timers
      if (this.invulnTimer > 0) this.invulnTimer -= dt;
      if (this.rocketTimer > 0) this.rocketTimer -= dt;
      if (this.shieldTimer > 0) this.shieldTimer -= dt;
      if (this.flashTimer > 0) this.flashTimer -= dt;

      // No rail generation or obstacle collisions while off-track
      this.onUpdate?.(this.distance, this.passengers, Math.abs(this.speed) * 0.1);
      return;
    }

    const i = Math.floor(this.pos);
    if (i < 0) return;
    if (i >= this.rail.length - 1) {
      // Reached or passed the end of this segment. Complete if we touched the end tile (on any segment).
      if (this.hasFinitePath && this.touchedEndTile() && !this.levelCompleted) {
        this.pos = this.endPointIndex!;
        this.speed = 0;
        this.levelCompleted = true;
        this.onLevelComplete?.(this.elapsedTime);
        return;
      }
      // Otherwise ran off the end: launch into airborne mode.
      if (this.hasFinitePath && this.onRail && !this.levelCompleted && this.rail.length >= 2) {
        const lastIdx = this.rail.length - 2;
        const p0 = this.rail[lastIdx];
        const p1 = this.rail[lastIdx + 1];
        const dx = p1.x - p0.x;
        const dy = p1.y - p0.y;
        const segLen = Math.sqrt(dx * dx + dy * dy) || 1;
        const dir = this.speed >= 0 ? 1 : -1;
        const tx = (dx / segLen) * dir;
        const ty = (dy / segLen) * dir;

        this.onRail = false;
        const launchPoint = dir >= 0 ? p1 : p0;
        this.airX = launchPoint.x;
        this.airY = launchPoint.y;
        this.airVX = tx * Math.abs(this.speed);
        this.airVY = ty * Math.abs(this.speed);
        this.airRotation = Math.atan2(dy, dx);
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
    if (this.keys.down) throttle = -THROTTLE_BASE * motorMult * 0.7;
    if (this.rocketTimer > 0) throttle += THROTTLE_BASE * 1.5;

    const gravity = cfg.gravity * Math.sin(angle) * 0.15;
    const friction = -this.speed * cfg.friction * gripMult;
    const drag = -this.speed * Math.abs(this.speed) * 0.0003;

    this.speed += (throttle + gravity + friction + drag) * dt;
    this.speed = Math.max(-maxSpeed * 0.4, Math.min(maxSpeed, this.speed));

    const dPos = (this.speed * dt) / segLen;
    this.pos += dPos;
    this.pos = Math.max(0, this.pos);

    this.distance += Math.abs(this.speed * dt) * 0.1; // px to meters
    this.elapsedTime += dt;

    // Check level completion: touched the end tile (on any segment)
    if (this.hasFinitePath && this.touchedEndTile() && !this.levelCompleted) {
      this.pos = this.endPointIndex!;
      this.speed = 0;
      this.levelCompleted = true;
      this.onLevelComplete?.(this.elapsedTime);
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

    // Camera
    const gondolaWorld = this.getGondolaPos();
    this.camera.x += (gondolaWorld.x - this.canvas.width * 0.35 - this.camera.x) * (1 - Math.exp(-5.0 * dt));
    this.camera.y += (gondolaWorld.y - this.canvas.height * 0.45 - this.camera.y) * (1 - Math.exp(-3.7 * dt));

    // Callbacks
    this.onUpdate?.(this.distance, this.passengers, Math.abs(this.speed) * 0.1);
  }

  getGondolaPos(): Point {
    if (this.hasFinitePath && !this.onRail) {
      return { x: this.airX, y: this.airY };
    }

    const i = Math.floor(this.pos);
    const f = this.pos - i;
    if (i < 0 || i >= this.rail.length - 1) return { x: 0, y: 300 };
    const p0 = this.rail[i];
    const p1 = this.rail[i + 1];
    return { x: p0.x + (p1.x - p0.x) * f, y: p0.y + (p1.y - p0.y) * f };
  }

  /** True if the player is on the segment that has the end tile and has reached that point (any segment). */
  touchedEndTile(): boolean {
    if (this.endSegmentIndex == null || this.endPointIndex == null || this.allRailSegments.length === 0) return false;
    const endSeg = this.allRailSegments[this.endSegmentIndex];
    if (!endSeg || this.rail !== endSeg) return false;
    return this.pos >= this.endPointIndex - 0.01;
  }

  checkCollisions() {
    if (this.invulnTimer > 0 || this.shieldTimer > 0) return;
    const gp = this.getGondolaPos();
    const cx = gp.x;
    const cy = gp.y + GONDOLA_HANG;

    for (const obs of this.obstacles) {
      if (obs.hit) continue;
      let hitDist: number;

      if (obs.type === 'spinner') {
        // Point-to-segment distance squared helper
        const ptSegDistSq = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
          const dx = bx - ax, dy = by - ay;
          const lenSq = dx * dx + dy * dy;
          if (lenSq === 0) return (px - ax) ** 2 + (py - ay) ** 2;
          const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
          return (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
        };
        const ARM_HALF = 9;  // half of arm lineWidth 18
        const POLE_HALF = 5; // half of pole lineWidth 10
        const spinRot = obs.rotation ?? 0;
        // Check arm segments (capsule collision) — rotation-aware
        for (let a = 0; a < 4; a++) {
          const armAngle = obs.angle + spinRot + (a * Math.PI) / 2;
          const tipX = obs.x + Math.cos(armAngle) * obs.armLength;
          const tipY = obs.y + Math.sin(armAngle) * obs.armLength;
          const dSq = ptSegDistSq(cx, cy, obs.x, obs.y, tipX, tipY);
          if (dSq < (HIT_RADIUS + ARM_HALF) ** 2) {
            this.hitPassenger(obs);
            return;
          }
        }
        // Check pole segment — rotated endpoint
        const poleEndX = obs.x - 60 * Math.sin(spinRot);
        const poleEndY = obs.y + 60 * Math.cos(spinRot);
        const dPoleSq = ptSegDistSq(cx, cy, obs.x, obs.y, poleEndX, poleEndY);
        if (dPoleSq < (HIT_RADIUS + POLE_HALF) ** 2) {
          this.hitPassenger(obs);
          return;
        }
        // Check center hub
        hitDist = Math.sqrt((cx - obs.x) ** 2 + (cy - obs.y) ** 2);
        if (hitDist < HIT_RADIUS + obs.radius) {
          this.hitPassenger(obs);
          return;
        }
      } else if (obs.type === 'bouncer') {
        // Rotate player offset into bouncer-local space
        const bRot = obs.rotation ?? 0;
        const bdx = cx - obs.x, bdy = cy - obs.baseY;
        const bldx =  bdx * Math.cos(bRot) + bdy * Math.sin(bRot);
        const bldy = -bdx * Math.sin(bRot) + bdy * Math.cos(bRot);
        const localOffset = Math.sin(obs.angle) * obs.amplitude;
        hitDist = Math.sqrt(bldx ** 2 + (bldy - localOffset) ** 2);
        if (hitDist < HIT_RADIUS + obs.radius) {
          this.hitPassenger(obs);
          return;
        }
      } else if (obs.type === 'pendulum') {
        // Rotate player offset into pendulum-local space
        const pRot = obs.rotation ?? 0;
        const pdx = cx - obs.x, pdy = cy - obs.y;
        const pldx =  pdx * Math.cos(pRot) + pdy * Math.sin(pRot);
        const pldy = -pdx * Math.sin(pRot) + pdy * Math.cos(pRot);
        const currentSwing = (obs.swingAngle ?? 0.8) * Math.sin(obs.angle);
        const cableLen = obs.cableLength ?? 120;
        const localBobX = Math.sin(currentSwing) * cableLen;
        const localBobY = Math.cos(currentSwing) * cableLen;
        hitDist = Math.sqrt((pldx - localBobX) ** 2 + (pldy - localBobY) ** 2);
        if (hitDist < HIT_RADIUS + (obs.bobRadius ?? obs.radius)) {
          this.hitPassenger(obs);
          return;
        }
      } else if (obs.type === 'laser') {
        const warnRadC = obs.bounceSpeed * (obs.warningTime ?? 2.0);
        const phaseC = (obs.angle ?? 0) % (warnRadC + Math.PI);
        if (phaseC < warnRadC) continue; // still in warning phase — beam off
        const ptSegDistSqL = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
          const dx = bx - ax, dy = by - ay;
          const lenSq = dx * dx + dy * dy;
          if (lenSq === 0) return (px - ax) ** 2 + (py - ay) ** 2;
          const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
          return (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
        };
        const baseDir = obs.beamDirection === 'left' ? Math.PI : 0;
        const beamAngle = baseDir + (obs.rotation ?? 0);
        const beamLen = obs.beamLength ?? obs.armLength;
        const beamEndX = obs.x + Math.cos(beamAngle) * beamLen;
        const beamEndY = obs.y + Math.sin(beamAngle) * beamLen;
        const BEAM_HALF = 5;
        const dSq = ptSegDistSqL(cx, cy, obs.x, obs.y, beamEndX, beamEndY);
        if (dSq < (HIT_RADIUS + BEAM_HALF) ** 2) {
          this.hitPassenger(obs);
          return;
        }
      } else if (obs.type === 'swoop') {
        const birdWorldX = obs.x + Math.sin(obs.angle) * (obs.patrolWidth ?? 160) / 2;
        const birdWorldY = obs.baseY + obs.amplitude;
        hitDist = Math.sqrt((cx - birdWorldX) ** 2 + (cy - birdWorldY) ** 2);
        if (hitDist < HIT_RADIUS + obs.radius) {
          this.hitPassenger(obs);
          return;
        }
      } else if (obs.type === 'orbiter') {
        const ballX = obs.x + Math.cos(obs.angle + (obs.rotation ?? 0)) * obs.armLength;
        const ballY = obs.y + Math.sin(obs.angle + (obs.rotation ?? 0)) * obs.armLength;
        hitDist = Math.sqrt((cx - ballX) ** 2 + (cy - ballY) ** 2);
        if (hitDist < HIT_RADIUS + obs.radius) {
          this.hitPassenger(obs);
          return;
        }
      } else if (obs.type === 'boulder') {
        // Only collidable while falling
        if (obs.armLength === 2) {
          hitDist = Math.sqrt((cx - obs.x) ** 2 + (cy - obs.y) ** 2);
          if (hitDist < HIT_RADIUS + obs.radius) {
            obs.hit = true; // despawn on hit
            this.hitPassenger(obs);
            return;
          }
        }
      } else {
        hitDist = Math.sqrt((cx - obs.x) ** 2 + (cy - obs.y) ** 2);
        if (hitDist < HIT_RADIUS + obs.radius) {
          this.hitPassenger(obs);
          return;
        }
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
        // Sprite handled; continue to next obstacle.
        if (obs.type === 'spinner') {
          obs.angle += obs.rotSpeed * this.lastDt;
        } else if (obs.type === 'bouncer' || obs.type === 'pendulum') {
          obs.angle += obs.bounceSpeed * this.lastDt;
        }
        continue;
      }

      if (obs.type === 'spinner') {
        obs.angle += obs.rotSpeed * this.lastDt;
        ctx.save();
        ctx.translate(screenX, obs.y - cy);
        ctx.rotate(obs.rotation ?? 0);

        // Non-hitbox structural parts — gray, reduced opacity (background feel)
        ctx.globalAlpha = 0.35;

        // Pole (local: 0,0 → 0,60)
        ctx.strokeStyle = '#888';
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, 60);
        ctx.stroke();

        // Arms
        ctx.lineWidth = 18;
        ctx.lineCap = 'round';
        for (let a = 0; a < 4; a++) {
          const armAngle = obs.angle + (a * Math.PI) / 2;
          ctx.strokeStyle = '#999';
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(armAngle) * obs.armLength, Math.sin(armAngle) * obs.armLength);
          ctx.stroke();
        }

        // Center hub
        ctx.fillStyle = '#aaa';
        ctx.beginPath();
        ctx.arc(0, 0, obs.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#777';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.globalAlpha = 1.0;

        // Tip balls — hitbox, full opacity
        for (let a = 0; a < 4; a++) {
          const armAngle = obs.angle + (a * Math.PI) / 2;
          const tipLX = Math.cos(armAngle) * obs.armLength;
          const tipLY = Math.sin(armAngle) * obs.armLength;
          ctx.fillStyle = '#cc3333';
          ctx.beginPath();
          ctx.arc(tipLX, tipLY, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ff6666';
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        ctx.restore();

      } else if (obs.type === 'bouncer') {
        obs.angle += obs.bounceSpeed * this.lastDt;
        const localOffset = Math.sin(obs.angle) * obs.amplitude;
        ctx.save();
        ctx.translate(screenX, obs.baseY - cy);
        ctx.rotate(obs.rotation ?? 0);

        // Spring (local: from ball bottom to spring mount)
        const springBottomLocal = obs.amplitude + 30;
        ctx.strokeStyle = '#FFD700';
        ctx.lineWidth = 3;
        for (let s = 0; s < 6; s++) {
          const t = s / 6;
          const lz = localOffset + (springBottomLocal - localOffset) * t;
          const lx = Math.sin(t * Math.PI * 4) * 10;
          if (s === 0) { ctx.beginPath(); ctx.moveTo(0, localOffset + obs.radius); }
          ctx.lineTo(lx, lz);
        }
        ctx.lineTo(0, springBottomLocal);
        ctx.stroke();

        // Ball
        ctx.fillStyle = '#E53935';
        ctx.beginPath();
        ctx.arc(0, localOffset, obs.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#B71C1C';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Spikes
        for (let s = 0; s < 8; s++) {
          const sa = (s / 8) * Math.PI * 2;
          ctx.fillStyle = '#B71C1C';
          ctx.beginPath();
          ctx.moveTo(Math.cos(sa) * obs.radius, localOffset + Math.sin(sa) * obs.radius);
          ctx.lineTo(Math.cos(sa + 0.15) * (obs.radius + 8), localOffset + Math.sin(sa + 0.15) * (obs.radius + 8));
          ctx.lineTo(Math.cos(sa - 0.15) * (obs.radius + 8), localOffset + Math.sin(sa - 0.15) * (obs.radius + 8));
          ctx.closePath();
          ctx.fill();
        }

        ctx.restore();

      } else if (obs.type === 'pendulum') {
        obs.angle += obs.bounceSpeed * this.lastDt;
        const currentSwing = (obs.swingAngle ?? 0.8) * Math.sin(obs.angle);
        const cableLen = obs.cableLength ?? 120;
        const bobR = obs.bobRadius ?? obs.radius;
        const bLX = Math.sin(currentSwing) * cableLen;
        const bLY = Math.cos(currentSwing) * cableLen;

        ctx.save();
        ctx.translate(screenX, obs.y - cy);
        ctx.rotate(obs.rotation ?? 0);

        // Anchor mount
        ctx.fillStyle = '#888';
        ctx.beginPath();
        ctx.arc(0, 0, 6, 0, Math.PI * 2);
        ctx.fill();

        // Cable
        ctx.strokeStyle = '#888';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(bLX, bLY);
        ctx.stroke();

        // Bob spikes
        for (let s = 0; s < 6; s++) {
          const sa = (s / 6) * Math.PI * 2;
          ctx.fillStyle = '#555';
          ctx.beginPath();
          ctx.moveTo(bLX + Math.cos(sa) * bobR, bLY + Math.sin(sa) * bobR);
          ctx.lineTo(bLX + Math.cos(sa + 0.2) * (bobR + 7), bLY + Math.sin(sa + 0.2) * (bobR + 7));
          ctx.lineTo(bLX + Math.cos(sa - 0.2) * (bobR + 7), bLY + Math.sin(sa - 0.2) * (bobR + 7));
          ctx.closePath();
          ctx.fill();
        }

        // Bob
        ctx.fillStyle = '#444';
        ctx.beginPath();
        ctx.arc(bLX, bLY, bobR, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.restore();

      } else if (obs.type === 'laser') {
        obs.angle += obs.bounceSpeed * this.lastDt;
        // Cycle = [warning: warningTime s] + [active beam: π/bounceSpeed s]
        // angle advances at ~bounceSpeed rad/s, so warningTime s = bounceSpeed*warningTime rad
        const warnRad = obs.bounceSpeed * (obs.warningTime ?? 2.0);
        const activeRad = Math.PI;
        const totalCycle = warnRad + activeRad;
        const phase = obs.angle % totalCycle;
        const isActive = phase >= warnRad;
        const isWarning = !isActive;

        const baseDir = obs.beamDirection === 'left' ? Math.PI : 0;
        const beamAngle = baseDir + (obs.rotation ?? 0);
        const beamLen = obs.beamLength ?? obs.armLength;
        const pivotX = screenX;
        const pivotY = obs.y - cy;
        const beamEndX = pivotX + Math.cos(beamAngle) * beamLen;
        const beamEndY = pivotY + Math.sin(beamAngle) * beamLen;

        // Emitter body (rotated to face beam direction)
        ctx.save();
        ctx.translate(pivotX, pivotY);
        ctx.rotate(beamAngle);
        ctx.fillStyle = '#444';
        ctx.fillRect(-10, -8, 18, 16);
        ctx.fillStyle = '#777';
        ctx.fillRect(6, -5, 8, 10);
        ctx.strokeStyle = '#999';
        ctx.lineWidth = 1;
        ctx.strokeRect(-10, -8, 18, 16);
        // Lens dot
        ctx.fillStyle = isActive ? '#ff4444' : (isWarning ? '#ff9944' : '#888');
        ctx.beginPath();
        ctx.arc(13, 0, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Warning flicker (dashed preview)
        if (isWarning) {
          const wAlpha = 0.2 + Math.random() * 0.25;
          ctx.strokeStyle = `rgba(255, 80, 80, ${wAlpha})`;
          ctx.lineWidth = 2;
          ctx.setLineDash([10, 10]);
          ctx.beginPath();
          ctx.moveTo(pivotX, pivotY);
          ctx.lineTo(beamEndX, beamEndY);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Active beam with glow
        if (isActive) {
          ctx.save();
          ctx.shadowColor = '#ff0000';
          ctx.shadowBlur = 14;
          ctx.lineCap = 'round';
          // Outer glow
          ctx.strokeStyle = 'rgba(255, 40, 40, 0.3)';
          ctx.lineWidth = 16;
          ctx.beginPath();
          ctx.moveTo(pivotX, pivotY);
          ctx.lineTo(beamEndX, beamEndY);
          ctx.stroke();
          // Core beam
          ctx.strokeStyle = '#ff3030';
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.moveTo(pivotX, pivotY);
          ctx.lineTo(beamEndX, beamEndY);
          ctx.stroke();
          // Bright center line
          ctx.strokeStyle = '#ffaaaa';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(pivotX, pivotY);
          ctx.lineTo(beamEndX, beamEndY);
          ctx.stroke();
          ctx.restore();
        }

      } else if (obs.type === 'swoop') {
        const pw    = obs.patrolWidth  ?? 160;
        const ph    = obs.patrolHeight ?? 80;
        const dd    = obs.diveDepth    ?? 120;
        const DIVE_SPEED = 320; // px/s downward
        const RISE_SPEED = 160; // px/s upward

        // Current world position
        const birdWorldX = obs.x + Math.sin(obs.angle) * pw / 2;
        const birdWorldY = obs.baseY + obs.amplitude;

        // State machine via armLength: 0=patrol, >0=diving, <0=rising
        if (obs.armLength > 0) {
          obs.amplitude += DIVE_SPEED * this.lastDt;
          if (obs.amplitude >= dd) {
            obs.amplitude = dd;
            obs.armLength = -1;
          }
        } else if (obs.armLength < 0) {
          obs.amplitude -= RISE_SPEED * this.lastDt;
          if (obs.amplitude <= 0) {
            obs.amplitude = 0;
            obs.armLength = 0;
          }
        } else {
          // Patrol: advance horizontal oscillation
          obs.angle += obs.bounceSpeed * this.lastDt;
          // Detect player: dive if player is within detection zone below bird
          const gp = this.getGondolaPos();
          const px = gp.x;
          const py = gp.y + GONDOLA_HANG;
          const dxP = px - birdWorldX;
          const dyP = py - birdWorldY;
          if (Math.abs(dxP) < pw / 2 && dyP > -obs.radius && dyP < ph) {
            obs.armLength = 1;
          }
        }

        // ── Draw ──────────────────────────────────────────────────────────
        const bSX = birdWorldX - cx;
        const bSY = birdWorldY - cy;
        const isDiving = obs.armLength !== 0;
        const movingRight = Math.cos(obs.angle) >= 0;
        const dir = movingRight ? 1 : -1;
        const flap = isDiving ? 0 : Math.sin(obs.angle * 5) * 5;

        ctx.save();
        ctx.translate(bSX, bSY);

        // Tail feathers
        ctx.fillStyle = '#4a3020';
        ctx.beginPath();
        if (isDiving) {
          ctx.moveTo(-dir * 8, 0);
          ctx.lineTo(-dir * 20, 14);
          ctx.lineTo(-dir * 16, 6);
          ctx.lineTo(-dir * 12, 14);
          ctx.lineTo(-dir * 8, 4);
        } else {
          ctx.moveTo(-dir * 8, 0);
          ctx.lineTo(-dir * 22, 4);
          ctx.lineTo(-dir * 18, 8);
          ctx.lineTo(-dir * 14, 4);
          ctx.lineTo(-dir * 8, 6);
        }
        ctx.closePath();
        ctx.fill();

        // Wing
        ctx.fillStyle = '#7a5030';
        if (isDiving) {
          // Tucked wings sweeping back
          ctx.beginPath();
          ctx.moveTo(0, -4);
          ctx.lineTo(-dir * 18, -2);
          ctx.lineTo(-dir * 16, 8);
          ctx.lineTo(0, 6);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#9a6840';
          ctx.beginPath();
          ctx.moveTo(0, -4);
          ctx.lineTo(-dir * 18, -10);
          ctx.lineTo(-dir * 20, -2);
          ctx.lineTo(-dir * 8, -2);
          ctx.closePath();
          ctx.fill();
        } else {
          // Spread wings with flap
          ctx.beginPath();
          ctx.moveTo(-dir * 2, 2);
          ctx.lineTo(-dir * 28, -6 + flap);
          ctx.lineTo(-dir * 24, 6 + flap);
          ctx.lineTo(-dir * 4, 6);
          ctx.closePath();
          ctx.fill();
          // Wing tip lighter
          ctx.fillStyle = '#9a6840';
          ctx.beginPath();
          ctx.moveTo(-dir * 22, -5 + flap);
          ctx.lineTo(-dir * 32, -2 + flap);
          ctx.lineTo(-dir * 28, 5 + flap);
          ctx.closePath();
          ctx.fill();
        }

        // Body
        ctx.fillStyle = '#4a3020';
        ctx.beginPath();
        ctx.ellipse(dir * 2, 0, 12, 7, isDiving ? dir * 0.4 : 0, 0, Math.PI * 2);
        ctx.fill();

        // Head
        ctx.fillStyle = '#3a2010';
        ctx.beginPath();
        ctx.arc(dir * 12, -3, 6, 0, Math.PI * 2);
        ctx.fill();

        // Beak
        ctx.fillStyle = '#bb8800';
        ctx.beginPath();
        ctx.moveTo(dir * 17, -3);
        ctx.lineTo(dir * 25, -1);
        ctx.lineTo(dir * 17, 1);
        ctx.fill();

        // Eye
        ctx.fillStyle = '#ffaa00';
        ctx.beginPath();
        ctx.arc(dir * 13, -4, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#111';
        ctx.beginPath();
        ctx.arc(dir * 13.5, -4, 1.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();

      } else if (obs.type === 'orbiter') {
        obs.angle += obs.rotSpeed * this.lastDt;
        const orbitR = obs.armLength;
        const rot = obs.rotation ?? 0;
        const ballSX = screenX + Math.cos(obs.angle + rot) * orbitR;
        const ballSY = (obs.y - cy) + Math.sin(obs.angle + rot) * orbitR;

        // Orbit ring (dashed)
        ctx.save();
        ctx.translate(screenX, obs.y - cy);
        ctx.strokeStyle = 'rgba(180, 80, 255, 0.3)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.arc(0, 0, orbitR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Center anchor
        ctx.fillStyle = '#7030aa';
        ctx.beginPath();
        ctx.arc(0, 0, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#9050cc';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();

        // Arm line
        ctx.save();
        ctx.strokeStyle = 'rgba(180, 80, 255, 0.45)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(screenX, obs.y - cy);
        ctx.lineTo(ballSX, ballSY);
        ctx.stroke();
        ctx.restore();

        // Orbiting ball
        ctx.save();
        ctx.translate(ballSX, ballSY);
        ctx.fillStyle = '#b450ff';
        ctx.beginPath();
        ctx.arc(0, 0, obs.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#d890ff';
        ctx.lineWidth = 2;
        ctx.stroke();
        // Highlight
        ctx.fillStyle = 'rgba(255, 220, 255, 0.6)';
        ctx.beginPath();
        ctx.arc(-obs.radius * 0.3, -obs.radius * 0.35, obs.radius * 0.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

      } else if (obs.type === 'boulder') {
        const GRAVITY = 700; // px/s²

        // ── State machine ──────────────────────────────────────────────────
        if (obs.armLength === 0) {
          // Idle: watch for player entering trigger radius
          const gp = this.getGondolaPos();
          const dx = gp.x - obs.x;
          const dy = (gp.y + GONDOLA_HANG) - obs.y;
          if (Math.sqrt(dx * dx + dy * dy) < (obs.triggerRadius ?? 120)) {
            obs.armLength = 1; // start countdown
          }
        } else if (obs.armLength === 1) {
          // Countdown: bounceSpeed holds remaining delay time
          obs.bounceSpeed -= this.lastDt;
          if (obs.bounceSpeed <= 0) {
            obs.armLength = 2;  // start falling
            obs.bounceSpeed = 0; // reset: now = fall velocity (px/s)
            obs.amplitude = 0;   // reset: now = elapsed fall time
          }
        } else if (obs.armLength === 2) {
          // Falling
          obs.bounceSpeed += GRAVITY * this.lastDt; // accelerate downward
          obs.y += obs.bounceSpeed * this.lastDt;
          obs.angle += (obs.bounceSpeed / Math.max(obs.radius, 1)) * this.lastDt; // roll
          obs.amplitude += this.lastDt;
          if (obs.amplitude > (obs.fallTimeout ?? 4)) {
            obs.hit = true; // despawn after timeout
          }
        }

        if (obs.hit) continue; // skip render if just despawned

        // ── Draw ──────────────────────────────────────────────────────────
        const r = obs.radius;
        const sy = obs.y - cy;
        // Shake during countdown — intensifies as timer runs out
        const shakeX = obs.armLength === 1
          ? Math.sin(now * 45) * Math.max(0, 2.5 - obs.bounceSpeed) * 1.5
          : 0;

        ctx.save();
        ctx.translate(screenX + shakeX, sy);
        ctx.rotate(obs.angle);

        // Shadow layer (darker offset circle)
        ctx.fillStyle = '#3d2e12';
        ctx.beginPath();
        ctx.arc(r * 0.08, r * 0.08, r, 0, Math.PI * 2);
        ctx.fill();

        // Main stone body
        ctx.fillStyle = '#7a6438';
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();

        // Mid-tone face
        ctx.fillStyle = '#9c8252';
        ctx.beginPath();
        ctx.arc(-r * 0.12, -r * 0.15, r * 0.8, 0, Math.PI * 2);
        ctx.fill();

        // Bright highlight patch
        ctx.fillStyle = '#b89a6a';
        ctx.beginPath();
        ctx.arc(-r * 0.22, -r * 0.28, r * 0.45, 0, Math.PI * 2);
        ctx.fill();

        // Crack lines
        ctx.strokeStyle = '#4a3820';
        ctx.lineWidth = Math.max(1, r / 18);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-r * 0.1, -r * 0.45);
        ctx.lineTo(r * 0.18, r * 0.08);
        ctx.lineTo(r * 0.04, r * 0.52);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-r * 0.55, r * 0.08);
        ctx.lineTo(-r * 0.12, -r * 0.08);
        ctx.stroke();

        // Outline
        ctx.strokeStyle = '#2a1e0a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();

        ctx.restore();

      } else {
        // Static - rock
        const sx = screenX;
        const sy = obs.y - cy;
        ctx.fillStyle = '#777';
        ctx.beginPath();
        ctx.arc(sx, sy, obs.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#666';
        ctx.beginPath();
        ctx.arc(sx - 3, sy - 3, obs.radius * 0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, obs.radius, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  renderGondola(cx: number, cy: number) {
    const { ctx } = this;
    const gp = this.getGondolaPos();
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

    // Labels (highlight when key is actively pressed)
    const throttleActive = this.keys.up;
    const brakeActive = this.keys.down;

    ctx.font = 'bold 13px system-ui';
    ctx.textAlign = 'right';
    ctx.fillStyle = throttleActive ? '#A5D6A7' : '#4CAF50';
    ctx.fillText('THROTTLE ▶', barX - 8, barY + 20);

    ctx.textAlign = 'left';
    ctx.fillStyle = brakeActive ? '#FFCDD2' : '#E53935';
    ctx.fillText('◀ BRAKE', barX + barW + 8, barY + 20);

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
