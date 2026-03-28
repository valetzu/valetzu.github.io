import { Obstacle, Point } from './types';

// ---------------------------------------------------------------------------
// Behavior interface — each obstacle type implements update, collision, render
// ---------------------------------------------------------------------------

export interface GameUpdateContext {
  getGondolaPos: () => Point;
  getCabinCenter: () => Point;
  gondolaHang: number;
  hitRadius: number;
  dealDamage: (obs: Obstacle) => void;
}

export interface ObstacleBehavior {
  update(obs: Obstacle, dt: number, ctx: GameUpdateContext): void;
  checkCollision(obs: Obstacle, cx: number, cy: number, hitRadius: number): boolean;
  render(obs: Obstacle, drawCtx: CanvasRenderingContext2D, screenX: number, screenY: number, now: number): void;
}

// ---------------------------------------------------------------------------
// Helper: point-to-segment distance squared
// ---------------------------------------------------------------------------

function ptSegDistSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return (px - ax) ** 2 + (py - ay) ** 2;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

export const spinnerBehavior: ObstacleBehavior = {
  update(obs, dt) {
    obs.angle += obs.rotSpeed * dt;
  },

  checkCollision(obs, cx, cy, hitRadius) {
    const ARM_HALF = 9;
    const POLE_HALF = 5;
    const spinRot = obs.rotation ?? 0;
    for (let a = 0; a < 4; a++) {
      const armAngle = obs.angle + spinRot + (a * Math.PI) / 2;
      const tipX = obs.x + Math.cos(armAngle) * obs.armLength;
      const tipY = obs.y + Math.sin(armAngle) * obs.armLength;
      if (ptSegDistSq(cx, cy, obs.x, obs.y, tipX, tipY) < (hitRadius + ARM_HALF) ** 2) return true;
    }
    const poleEndX = obs.x - 60 * Math.sin(spinRot);
    const poleEndY = obs.y + 60 * Math.cos(spinRot);
    if (ptSegDistSq(cx, cy, obs.x, obs.y, poleEndX, poleEndY) < (hitRadius + POLE_HALF) ** 2) return true;
    const hitDist = Math.sqrt((cx - obs.x) ** 2 + (cy - obs.y) ** 2);
    return hitDist < hitRadius + obs.radius;
  },

  render(obs, ctx, screenX, screenY, _now) {
    ctx.save();
    ctx.translate(screenX, screenY);
    ctx.rotate(obs.rotation ?? 0);

    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 60);
    ctx.stroke();

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

    ctx.fillStyle = '#aaa';
    ctx.beginPath();
    ctx.arc(0, 0, obs.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#777';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.globalAlpha = 1.0;
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
  }
};

// ---------------------------------------------------------------------------
// Bouncer
// ---------------------------------------------------------------------------

export const bouncerBehavior: ObstacleBehavior = {
  update(obs, dt) {
    obs.angle += obs.bounceSpeed * dt;
  },

  checkCollision(obs, cx, cy, hitRadius) {
    const bRot = obs.rotation ?? 0;
    const bdx = cx - obs.x, bdy = cy - obs.baseY;
    const bldx =  bdx * Math.cos(bRot) + bdy * Math.sin(bRot);
    const bldy = -bdx * Math.sin(bRot) + bdy * Math.cos(bRot);
    const localOffset = Math.sin(obs.angle) * obs.amplitude;
    const hitDist = Math.sqrt(bldx ** 2 + (bldy - localOffset) ** 2);
    return hitDist < hitRadius + obs.radius;
  },

  render(obs, ctx, screenX, screenY, _now) {
    const localOffset = Math.sin(obs.angle) * obs.amplitude;
    // screenY = obs.y - cy, but bouncer origin is baseY, so offset by (baseY - y)
    const baseScreenY = screenY + (obs.baseY - obs.y);
    ctx.save();
    ctx.translate(screenX, baseScreenY);
    ctx.rotate(obs.rotation ?? 0);

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

    ctx.fillStyle = '#E53935';
    ctx.beginPath();
    ctx.arc(0, localOffset, obs.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#B71C1C';
    ctx.lineWidth = 2;
    ctx.stroke();

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
  }
};

// ---------------------------------------------------------------------------
// Pendulum
// ---------------------------------------------------------------------------

export const pendulumBehavior: ObstacleBehavior = {
  update(obs, dt) {
    obs.angle += obs.bounceSpeed * dt;
  },

  checkCollision(obs, cx, cy, hitRadius) {
    const pRot = obs.rotation ?? 0;
    const pdx = cx - obs.x, pdy = cy - obs.y;
    const pldx =  pdx * Math.cos(pRot) + pdy * Math.sin(pRot);
    const pldy = -pdx * Math.sin(pRot) + pdy * Math.cos(pRot);
    const currentSwing = (obs.swingAngle ?? 0.8) * Math.sin(obs.angle);
    const cableLen = obs.cableLength ?? 120;
    const localBobX = Math.sin(currentSwing) * cableLen;
    const localBobY = Math.cos(currentSwing) * cableLen;
    const hitDist = Math.sqrt((pldx - localBobX) ** 2 + (pldy - localBobY) ** 2);
    return hitDist < hitRadius + (obs.bobRadius ?? obs.radius);
  },

  render(obs, ctx, screenX, screenY, _now) {
    const currentSwing = (obs.swingAngle ?? 0.8) * Math.sin(obs.angle);
    const cableLen = obs.cableLength ?? 120;
    const bobR = obs.bobRadius ?? obs.radius;
    const bLX = Math.sin(currentSwing) * cableLen;
    const bLY = Math.cos(currentSwing) * cableLen;

    ctx.save();
    ctx.translate(screenX, screenY);
    ctx.rotate(obs.rotation ?? 0);

    ctx.fillStyle = '#888';
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#888';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(bLX, bLY);
    ctx.stroke();

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

    ctx.fillStyle = '#444';
    ctx.beginPath();
    ctx.arc(bLX, bLY, bobR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
};

// ---------------------------------------------------------------------------
// Laser
// ---------------------------------------------------------------------------

export const laserBehavior: ObstacleBehavior = {
  update(obs, dt) {
    obs.angle += obs.bounceSpeed * dt;
  },

  checkCollision(obs, cx, cy, hitRadius) {
    const warnRadC = obs.bounceSpeed * (obs.warningTime ?? 2.0);
    const phaseC = (obs.angle ?? 0) % (warnRadC + Math.PI);
    if (phaseC < warnRadC) return false; // warning phase — beam off
    const baseDir = obs.beamDirection === 'left' ? Math.PI : 0;
    const beamAngle = baseDir + (obs.rotation ?? 0);
    const beamLen = obs.beamLength ?? obs.armLength;
    const beamEndX = obs.x + Math.cos(beamAngle) * beamLen;
    const beamEndY = obs.y + Math.sin(beamAngle) * beamLen;
    const BEAM_HALF = 5;
    return ptSegDistSq(cx, cy, obs.x, obs.y, beamEndX, beamEndY) < (hitRadius + BEAM_HALF) ** 2;
  },

  render(obs, ctx, screenX, screenY, _now) {
    const warnRad = obs.bounceSpeed * (obs.warningTime ?? 2.0);
    const activeRad = Math.PI;
    const totalCycle = warnRad + activeRad;
    const phase = obs.angle % totalCycle;
    const isActive = phase >= warnRad;
    const isWarning = !isActive;

    const baseDir = obs.beamDirection === 'left' ? Math.PI : 0;
    const beamAngle = baseDir + (obs.rotation ?? 0);
    const beamLen = obs.beamLength ?? obs.armLength;
    const beamEndX = screenX + Math.cos(beamAngle) * beamLen;
    const beamEndY = screenY + Math.sin(beamAngle) * beamLen;

    // Emitter body
    ctx.save();
    ctx.translate(screenX, screenY);
    ctx.rotate(beamAngle);
    ctx.fillStyle = '#444';
    ctx.fillRect(-10, -8, 18, 16);
    ctx.fillStyle = '#777';
    ctx.fillRect(6, -5, 8, 10);
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 1;
    ctx.strokeRect(-10, -8, 18, 16);
    ctx.fillStyle = isActive ? '#ff4444' : (isWarning ? '#ff9944' : '#888');
    ctx.beginPath();
    ctx.arc(13, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (isWarning) {
      const wAlpha = 0.2 + Math.random() * 0.25;
      ctx.strokeStyle = `rgba(255, 80, 80, ${wAlpha})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 10]);
      ctx.beginPath();
      ctx.moveTo(screenX, screenY);
      ctx.lineTo(beamEndX, beamEndY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (isActive) {
      ctx.save();
      ctx.shadowColor = '#ff0000';
      ctx.shadowBlur = 14;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255, 40, 40, 0.3)';
      ctx.lineWidth = 16;
      ctx.beginPath();
      ctx.moveTo(screenX, screenY);
      ctx.lineTo(beamEndX, beamEndY);
      ctx.stroke();
      ctx.strokeStyle = '#ff3030';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(screenX, screenY);
      ctx.lineTo(beamEndX, beamEndY);
      ctx.stroke();
      ctx.strokeStyle = '#ffaaaa';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(screenX, screenY);
      ctx.lineTo(beamEndX, beamEndY);
      ctx.stroke();
      ctx.restore();
    }
  }
};

// ---------------------------------------------------------------------------
// Swoop
// ---------------------------------------------------------------------------

export const swoopBehavior: ObstacleBehavior = {
  update(obs, dt, gameCtx) {
    const pw = obs.patrolWidth ?? 160;
    const ph = obs.patrolHeight ?? 80;
    const dd = obs.diveDepth ?? 120;
    const DIVE_SPEED = 320;
    const RISE_SPEED = 160;

    if (obs.armLength > 0) {
      obs.amplitude += DIVE_SPEED * dt;
      if (obs.amplitude >= dd) {
        obs.amplitude = dd;
        obs.armLength = -1;
      }
    } else if (obs.armLength < 0) {
      obs.amplitude -= RISE_SPEED * dt;
      if (obs.amplitude <= 0) {
        obs.amplitude = 0;
        obs.armLength = 0;
      }
    } else {
      obs.angle += obs.bounceSpeed * dt;
      const cab = gameCtx.getCabinCenter();
      const px = cab.x;
      const py = cab.y;
      const birdWorldX = obs.x + Math.sin(obs.angle) * pw / 2;
      const birdWorldY = obs.baseY + obs.amplitude;
      const dxP = px - birdWorldX;
      const dyP = py - birdWorldY;
      if (Math.abs(dxP) < pw / 2 && dyP > -obs.radius && dyP < ph) {
        obs.armLength = 1;
      }
    }
  },

  checkCollision(obs, cx, cy, hitRadius) {
    const pw = obs.patrolWidth ?? 160;
    const birdWorldX = obs.x + Math.sin(obs.angle) * pw / 2;
    const birdWorldY = obs.baseY + obs.amplitude;
    const hitDist = Math.sqrt((cx - birdWorldX) ** 2 + (cy - birdWorldY) ** 2);
    return hitDist < hitRadius + obs.radius;
  },

  render(obs, ctx, _screenX, _screenY, _now) {
    const pw = obs.patrolWidth ?? 160;
    const birdWorldX = obs.x + Math.sin(obs.angle) * pw / 2;
    const birdWorldY = obs.baseY + obs.amplitude;
    // screenX/screenY passed are obs.x - cx, obs.y - cy, but swoop uses birdWorld coords
    // We need to compute the bird screen position from the world position
    const bSX = birdWorldX - (obs.x - _screenX);
    const bSY = birdWorldY - (obs.y - _screenY);
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
      ctx.beginPath();
      ctx.moveTo(-dir * 2, 2);
      ctx.lineTo(-dir * 28, -6 + flap);
      ctx.lineTo(-dir * 24, 6 + flap);
      ctx.lineTo(-dir * 4, 6);
      ctx.closePath();
      ctx.fill();
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
  }
};

// ---------------------------------------------------------------------------
// Orbiter
// ---------------------------------------------------------------------------

export const orbiterBehavior: ObstacleBehavior = {
  update(obs, dt) {
    obs.angle += obs.rotSpeed * dt;
  },

  checkCollision(obs, cx, cy, hitRadius) {
    const ballX = obs.x + Math.cos(obs.angle + (obs.rotation ?? 0)) * obs.armLength;
    const ballY = obs.y + Math.sin(obs.angle + (obs.rotation ?? 0)) * obs.armLength;
    const hitDist = Math.sqrt((cx - ballX) ** 2 + (cy - ballY) ** 2);
    return hitDist < hitRadius + obs.radius;
  },

  render(obs, ctx, screenX, screenY, _now) {
    const orbitR = obs.armLength;
    const rot = obs.rotation ?? 0;
    const ballSX = screenX + Math.cos(obs.angle + rot) * orbitR;
    const ballSY = screenY + Math.sin(obs.angle + rot) * orbitR;

    // Orbit ring
    ctx.save();
    ctx.translate(screenX, screenY);
    ctx.strokeStyle = 'rgba(180, 80, 255, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(0, 0, orbitR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
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
    ctx.moveTo(screenX, screenY);
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
    ctx.fillStyle = 'rgba(255, 220, 255, 0.6)';
    ctx.beginPath();
    ctx.arc(-obs.radius * 0.3, -obs.radius * 0.35, obs.radius * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
};

// ---------------------------------------------------------------------------
// Boulder
// ---------------------------------------------------------------------------

export const boulderBehavior: ObstacleBehavior = {
  update(obs, dt, gameCtx) {
    const GRAVITY = 700;
    if (obs.armLength === 0) {
      const cab = gameCtx.getCabinCenter();
      const dx = cab.x - obs.x;
      const dy = cab.y - obs.y;
      if (Math.sqrt(dx * dx + dy * dy) < (obs.triggerRadius ?? 120)) {
        obs.armLength = 1;
      }
    } else if (obs.armLength === 1) {
      obs.bounceSpeed -= dt;
      if (obs.bounceSpeed <= 0) {
        obs.armLength = 2;
        obs.bounceSpeed = 0;
        obs.amplitude = 0;
      }
    } else if (obs.armLength === 2) {
      obs.bounceSpeed += GRAVITY * dt;
      obs.y += obs.bounceSpeed * dt;
      obs.angle += (obs.bounceSpeed / Math.max(obs.radius, 1)) * dt;
      obs.amplitude += dt;
      if (obs.amplitude > (obs.fallTimeout ?? 4)) {
        obs.hit = true;
      }
    }
  },

  checkCollision(obs, cx, cy, hitRadius) {
    if (obs.armLength !== 2) return false;
    const hitDist = Math.sqrt((cx - obs.x) ** 2 + (cy - obs.y) ** 2);
    if (hitDist < hitRadius + obs.radius) {
      obs.hit = true;
      return true;
    }
    return false;
  },

  render(obs, ctx, screenX, screenY, now) {
    if (obs.hit) return;
    const r = obs.radius;
    const shakeX = obs.armLength === 1
      ? Math.sin(now * 45) * Math.max(0, 2.5 - obs.bounceSpeed) * 1.5
      : 0;

    ctx.save();
    ctx.translate(screenX + shakeX, screenY);
    ctx.rotate(obs.angle);

    ctx.fillStyle = '#3d2e12';
    ctx.beginPath();
    ctx.arc(r * 0.08, r * 0.08, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#7a6438';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#9c8252';
    ctx.beginPath();
    ctx.arc(-r * 0.12, -r * 0.15, r * 0.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#b89a6a';
    ctx.beginPath();
    ctx.arc(-r * 0.22, -r * 0.28, r * 0.45, 0, Math.PI * 2);
    ctx.fill();

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

    ctx.strokeStyle = '#2a1e0a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
};

// ---------------------------------------------------------------------------
// Mine
// ---------------------------------------------------------------------------

export const mineBehavior: ObstacleBehavior = {
  update(obs, dt, gameCtx) {
    const EXPLOSION_DURATION = 0.55;
    if (obs.armLength === 0) {
      obs.angle += 0.4 * dt;
      const cab1 = gameCtx.getCabinCenter();
      const dx = cab1.x - obs.x;
      const dy = cab1.y - obs.y;
      if (Math.sqrt(dx * dx + dy * dy) < (obs.triggerRadius ?? 40)) {
        obs.armLength = 1;
      }
    } else if (obs.armLength === 1) {
      obs.angle += 2.5 * dt;
      obs.bounceSpeed -= dt;
      if (obs.bounceSpeed <= 0) {
        obs.armLength = 2;
        obs.amplitude = 0;
        const cab2 = gameCtx.getCabinCenter();
        const dx = cab2.x - obs.x;
        const dy = cab2.y - obs.y;
        if (Math.sqrt(dx * dx + dy * dy) < gameCtx.hitRadius + (obs.explosionRadius ?? 80)) {
          gameCtx.dealDamage(obs);
        }
      }
    } else if (obs.armLength === 2) {
      obs.amplitude += dt;
      if (obs.amplitude > EXPLOSION_DURATION) {
        obs.hit = true;
      }
    }
  },

  checkCollision(_obs, _cx, _cy, _hitRadius) {
    // Mine damage is dealt at explosion time, not on contact
    return false;
  },

  render(obs, ctx, screenX, screenY, now) {
    if (obs.hit) return;
    const EXPLOSION_DURATION = 0.55;

    if (obs.armLength === 2) {
      const t = obs.amplitude / EXPLOSION_DURATION;
      const expR = (obs.explosionRadius ?? 80) * (0.2 + t * 0.8);
      const alpha = 1 - t;

      ctx.save();
      ctx.strokeStyle = `rgba(255, 200, 50, ${alpha * 0.7})`;
      ctx.lineWidth = 8 * (1 - t * 0.6);
      ctx.beginPath();
      ctx.arc(screenX, screenY, expR, 0, Math.PI * 2);
      ctx.stroke();

      const grad = ctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, expR * 0.8);
      grad.addColorStop(0,   `rgba(255, 255, 180, ${alpha})`);
      grad.addColorStop(0.35, `rgba(255, 140, 20, ${alpha * 0.95})`);
      grad.addColorStop(0.75, `rgba(220, 50, 0, ${alpha * 0.6})`);
      grad.addColorStop(1,    `rgba(100, 20, 0, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(screenX, screenY, expR * 0.8, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `rgba(180, 80, 0, ${alpha * 0.4})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(screenX, screenY, expR * 1.25, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else {
      const BODY_R = 14;
      const isArmed = obs.armLength === 1;
      const pulse = isArmed
        ? Math.sin(now * (6 + (1 - obs.bounceSpeed / Math.max(obs.rotSpeed, 0.01)) * 10)) * 0.5 + 0.5
        : 0;

      ctx.save();
      ctx.translate(screenX, screenY);
      ctx.rotate(obs.angle + (obs.rotation ?? 0));

      if (isArmed) {
        ctx.shadowColor = `rgba(255, 60, 60, ${0.5 + pulse * 0.5})`;
        ctx.shadowBlur = 10 + pulse * 10;
      }

      const SPIKE_COUNT = 6;
      const SPIKE_LEN = BODY_R * 0.85;
      ctx.fillStyle = isArmed ? `rgb(${Math.round(180 + pulse * 60)}, 60, 60)` : '#3a3a3a';
      for (let i = 0; i < SPIKE_COUNT; i++) {
        const a = (i / SPIKE_COUNT) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a - 0.2) * BODY_R, Math.sin(a - 0.2) * BODY_R);
        ctx.lineTo(Math.cos(a + 0.2) * BODY_R, Math.sin(a + 0.2) * BODY_R);
        ctx.lineTo(Math.cos(a) * (BODY_R + SPIKE_LEN), Math.sin(a) * (BODY_R + SPIKE_LEN));
        ctx.closePath();
        ctx.fill();
      }

      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
      const bodyGrad = ctx.createRadialGradient(-BODY_R * 0.3, -BODY_R * 0.35, 1, 0, 0, BODY_R);
      if (isArmed) {
        bodyGrad.addColorStop(0,   `rgba(220, ${Math.round(80 + pulse * 80)}, 80, 1)`);
        bodyGrad.addColorStop(0.6, `rgba(160, 30, 30, 1)`);
      } else {
        bodyGrad.addColorStop(0, '#6a6a6a');
        bodyGrad.addColorStop(0.6, '#3d3d3d');
      }
      bodyGrad.addColorStop(1, '#111');
      ctx.fillStyle = bodyGrad;
      ctx.beginPath();
      ctx.arc(0, 0, BODY_R, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = `rgba(255, 255, 255, ${isArmed ? 0.12 : 0.22})`;
      ctx.beginPath();
      ctx.arc(-BODY_R * 0.28, -BODY_R * 0.32, BODY_R * 0.32, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#111';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, BODY_R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      if (isArmed) {
        const progress = 1 - obs.bounceSpeed / Math.max(obs.rotSpeed, 0.01);
        ctx.save();
        ctx.strokeStyle = `rgba(255, ${Math.round(220 - pulse * 180)}, 0, 0.85)`;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(screenX, screenY, BODY_R + 6, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  }
};

// ---------------------------------------------------------------------------
// Crusher (static zone)
// ---------------------------------------------------------------------------

export const crusherBehavior: ObstacleBehavior = {
  update() {},

  checkCollision(obs, cx, cy, hitRadius) {
    const hitDist = Math.sqrt((cx - obs.x) ** 2 + (cy - obs.y) ** 2);
    return hitDist < hitRadius + obs.radius;
  },

  render(obs, ctx, screenX, screenY, _now) {
    ctx.fillStyle = '#777';
    ctx.beginPath();
    ctx.arc(screenX, screenY, obs.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#666';
    ctx.beginPath();
    ctx.arc(screenX - 3, screenY - 3, obs.radius * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(screenX, screenY, obs.radius, 0, Math.PI * 2);
    ctx.stroke();
  }
};

// ---------------------------------------------------------------------------
// Behavior registry — map obstacle type string to behavior
// ---------------------------------------------------------------------------

export const OBSTACLE_BEHAVIORS: Record<string, ObstacleBehavior> = {
  spinner: spinnerBehavior,
  bouncer: bouncerBehavior,
  pendulum: pendulumBehavior,
  laser: laserBehavior,
  swoop: swoopBehavior,
  orbiter: orbiterBehavior,
  boulder: boulderBehavior,
  mine: mineBehavior,
  crusher: crusherBehavior,
  stalactite: crusherBehavior, // static, same as crusher
};
