import { WorldType, Upgrades, Point, Obstacle, WORLD_CONFIG } from './types';

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
  ground: number[] = []; // groundY for each rail point
  pos: number = 0;
  speed: number = 0;
  passengers: number = 3;
  distance: number = 0;
  obstacles: Obstacle[] = [];
  noBackground = false;
  camera = { x: 0, y: 0 };

  invulnTimer = 0;
  rocketTimer = 0;
  shieldTimer = 0;
  rocketCharges = 0;
  shieldCharges = 0;

  lastTime = 0;
  animFrame = 0;
  running = false;
  gameOver = false;
  flashTimer = 0;

  clouds: Cloud[] = [];
  stars: Star[] = [];
  mountains: Mountain[] = [];
  nextObstacleX = 600;

  onUpdate?: (dist: number, passengers: number, speed: number) => void;
  onGameOver?: (dist: number, cash: number) => void;

  constructor(
    canvas: HTMLCanvasElement,
    world: WorldType,
    upgrades: Upgrades,
    callbacks: {
      onUpdate?: (d: number, p: number, s: number) => void;
      onGameOver?: (d: number, c: number) => void;
    }
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.world = world;
    this.upgrades = upgrades;
    this.onUpdate = callbacks.onUpdate;
    this.onGameOver = callbacks.onGameOver;
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
          type: 'spinner',
          x, y: railY - 10 - Math.random() * 40,
          radius: 12, angle: Math.random() * Math.PI * 2,
          rotSpeed: -(0.3 + Math.random() * 0.4 + difficulty * 0.4),
          baseY: 0, amplitude: 0, bounceSpeed: 0,
          armLength: armLen, hit: false,
        };
      } else {
        // Bouncer
        obs = {
          type: 'bouncer',
          x, y: railY,
          radius: 18, angle: Math.random() * Math.PI * 2,
          rotSpeed: 0,
          baseY: railY - 20, amplitude: 100 + Math.random() * 80,
          bounceSpeed: 0.6 + Math.random() * 0.8,
          armLength: 0, hit: false,
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

  loop = () => {
    if (!this.running) return;
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    if (!this.gameOver) {
      this.update(dt);
    }
    this.render();
    this.animFrame = requestAnimationFrame(this.loop);
  };

  // --- Physics ---
  update(dt: number) {
    const cfg = WORLD_CONFIG[this.world];
    const i = Math.floor(this.pos);
    if (i < 0 || i >= this.rail.length - 1) return;

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

    // Timers
    if (this.invulnTimer > 0) this.invulnTimer -= dt;
    if (this.rocketTimer > 0) this.rocketTimer -= dt;
    if (this.shieldTimer > 0) this.shieldTimer -= dt;
    if (this.flashTimer > 0) this.flashTimer -= dt;

    // Generate more rail
    if (this.pos > this.rail.length - 80) {
      this.generateRail(100);
    }

    // Collision
    this.checkCollisions();

    // Camera
    const gondolaWorld = this.getGondolaPos();
    this.camera.x += (gondolaWorld.x - this.canvas.width * 0.35 - this.camera.x) * 0.08;
    this.camera.y += (gondolaWorld.y - this.canvas.height * 0.45 - this.camera.y) * 0.06;

    // Callbacks
    this.onUpdate?.(this.distance, this.passengers, Math.abs(this.speed) * 0.1);
  }

  getGondolaPos(): Point {
    const i = Math.floor(this.pos);
    const f = this.pos - i;
    if (i < 0 || i >= this.rail.length - 1) return { x: 0, y: 300 };
    const p0 = this.rail[i];
    const p1 = this.rail[i + 1];
    return { x: p0.x + (p1.x - p0.x) * f, y: p0.y + (p1.y - p0.y) * f };
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
        // Check each arm tip
        for (let a = 0; a < 4; a++) {
          const armAngle = obs.angle + (a * Math.PI) / 2;
          const tipX = obs.x + Math.cos(armAngle) * obs.armLength;
          const tipY = obs.y + Math.sin(armAngle) * obs.armLength;
          const d = Math.sqrt((cx - tipX) ** 2 + (cy - tipY) ** 2);
          if (d < HIT_RADIUS + 12) {
            this.hitPassenger(obs);
            return;
          }
        }
        // Check center
        hitDist = Math.sqrt((cx - obs.x) ** 2 + (cy - obs.y) ** 2);
        if (hitDist < HIT_RADIUS + obs.radius) {
          this.hitPassenger(obs);
          return;
        }
      } else if (obs.type === 'bouncer') {
        const by = obs.baseY + Math.sin(obs.angle) * obs.amplitude;
        hitDist = Math.sqrt((cx - obs.x) ** 2 + (cy - by) ** 2);
        if (hitDist < HIT_RADIUS + obs.radius) {
          this.hitPassenger(obs);
          return;
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

  hitPassenger(obs: Obstacle) {
    obs.hit = true;
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

    // Ground
    this.renderGround(cx, cy, w, h, cfg);

    // Rail cable
    this.renderRail(cx, cy, w);

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
    const { ctx, rail } = this;
    const [startIdx, endIdx] = this.findVisibleRange(cx, w);

    // Cable
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let i = startIdx; i <= endIdx; i++) {
      const sx = rail[i].x - cx;
      const sy = rail[i].y - cy;
      if (i === startIdx) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();

    // Support posts at intervals
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 3;
    for (let i = startIdx; i <= endIdx; i += 8) {
      if (i >= this.ground.length) break;
      const sx = rail[i].x - cx;
      const sy = rail[i].y - cy;
      const gy = this.ground[i] - cy;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx, gy);
      ctx.stroke();
      // Cross beam
      ctx.beginPath();
      ctx.moveTo(sx - 8, sy - 5);
      ctx.lineTo(sx + 8, sy - 5);
      ctx.stroke();
    }
  }

  renderObstacles(cx: number, cy: number) {
    const { ctx } = this;
    const now = performance.now() / 1000;

    for (const obs of this.obstacles) {
      if (obs.hit) continue;
      const screenX = obs.x - cx;
      if (screenX < -150 || screenX > this.canvas.width + 150) continue;

      if (obs.type === 'spinner') {
        // Update angle
        obs.angle += obs.rotSpeed * 0.016;
        const sx = screenX;
        const sy = obs.y - cy;

        // Pole
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 4;
        const groundY = obs.y + 60 - cy;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx, groundY);
        ctx.stroke();

        // Arms (yellow-black striped)
        for (let a = 0; a < 4; a++) {
          const armAngle = obs.angle + (a * Math.PI) / 2;
          const tipX = sx + Math.cos(armAngle) * obs.armLength;
          const tipY = sy + Math.sin(armAngle) * obs.armLength;

          ctx.strokeStyle = a % 2 === 0 ? '#FFD700' : '#333';
          ctx.lineWidth = 8;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(tipX, tipY);
          ctx.stroke();

          // Tip ball
          ctx.fillStyle = a % 2 === 0 ? '#333' : '#FFD700';
          ctx.beginPath();
          ctx.arc(tipX, tipY, 6, 0, Math.PI * 2);
          ctx.fill();
        }

        // Center
        ctx.fillStyle = '#888';
        ctx.beginPath();
        ctx.arc(sx, sy, obs.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 2;
        ctx.stroke();

      } else if (obs.type === 'bouncer') {
        obs.angle += obs.bounceSpeed * 0.016;
        const by = obs.baseY + Math.sin(obs.angle) * obs.amplitude;
        const sx = screenX;
        const sy = by - cy;

        // Spring below
        ctx.strokeStyle = '#FFD700';
        ctx.lineWidth = 3;
        const springBottom = obs.baseY + obs.amplitude + 30 - cy;
        for (let s = 0; s < 6; s++) {
          const t = s / 6;
          const zy = sy + (springBottom - sy) * t;
          const zx = sx + Math.sin(t * Math.PI * 4) * 10;
          if (s === 0) { ctx.beginPath(); ctx.moveTo(sx, sy + obs.radius); }
          ctx.lineTo(zx, zy);
        }
        ctx.stroke();

        // Ball
        ctx.fillStyle = '#E53935';
        ctx.beginPath();
        ctx.arc(sx, sy, obs.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#B71C1C';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Spikes
        for (let s = 0; s < 8; s++) {
          const sa = (s / 8) * Math.PI * 2;
          ctx.fillStyle = '#B71C1C';
          ctx.beginPath();
          ctx.moveTo(
            sx + Math.cos(sa) * obs.radius,
            sy + Math.sin(sa) * obs.radius
          );
          ctx.lineTo(
            sx + Math.cos(sa + 0.15) * (obs.radius + 8),
            sy + Math.sin(sa + 0.15) * (obs.radius + 8)
          );
          ctx.lineTo(
            sx + Math.cos(sa - 0.15) * (obs.radius + 8),
            sy + Math.sin(sa - 0.15) * (obs.radius + 8)
          );
          ctx.closePath();
          ctx.fill();
        }

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

    // Speed
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    this.roundRect(w - 190, 10, 180, 36, 6);
    ctx.fill();
    ctx.fillStyle = '#FFF';
    ctx.textAlign = 'right';
    ctx.fillText(`⚡ ${Math.floor(Math.abs(this.speed) * 0.36)} km/h`, w - 20, 34);

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

    // Labels
    ctx.fillStyle = '#4CAF50';
    ctx.font = 'bold 13px system-ui';
    ctx.textAlign = 'right';
    ctx.fillText('THROTTLE ▶', barX - 8, barY + 20);
    ctx.fillStyle = '#E53935';
    ctx.textAlign = 'left';
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
  }
}
