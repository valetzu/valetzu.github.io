# Sky Lift Dash - Game Design Document for Godot Reimplementation

This document covers everything needed to reimplement Sky Lift Dash (Cable Riders) in Godot Engine. The game is a 2D gondola/cable-car physics game where the player rides a gondola along rails, controlling speed and tilt. The focus is on preserving the exact gameplay feel, mechanics, and physics.

---

## Table of Contents

1. [Epic 1: Core Physics & Rail Riding](#epic-1-core-physics--rail-riding)
2. [Epic 2: Gondola Rendering & Camera](#epic-2-gondola-rendering--camera)
3. [Epic 3: Endless Mode & Procedural Generation](#epic-3-endless-mode--procedural-generation)
4. [Epic 4: Airborne Physics & Rail Transitions](#epic-4-airborne-physics--rail-transitions)
5. [Epic 5: Obstacle System](#epic-5-obstacle-system)
6. [Epic 6: HUD, Menus & Game Flow](#epic-6-hud-menus--game-flow)
7. [Epic 7: Progression, Upgrades & Persistence](#epic-7-progression-upgrades--persistence)
8. [Epic 8: Level Editor & Custom Levels](#epic-8-level-editor--custom-levels)
9. [Epic 9: Ghost Replay System](#epic-9-ghost-replay-system)
10. [Epic 10: Audio, Sprites & Polish](#epic-10-audio-sprites--polish)

---

## Epic 1: Core Physics & Rail Riding

**Goal:** Implement the deterministic 60Hz fixed-timestep physics loop with rolling-on-rail mechanics and pendulum cabin swing. This is the heart of the game and must feel identical.

### 1.1 Fixed Timestep Loop

The game uses a fixed physics timestep with render interpolation:

```
FIXED_DT = 1/60 (0.01667 seconds)

Each frame:
  frameDt = actual frame delta (seconds)
  accumulator += frameDt
  accumulator = min(accumulator, 0.2)  // spiral-of-death cap (max 12 physics steps)

  while accumulator >= FIXED_DT:
    prevGondolaPos = getGondolaPos()
    update(FIXED_DT)
    accumulator -= FIXED_DT

  interpolationAlpha = accumulator / FIXED_DT
  render(interpolationAlpha)  // blend between prev and current positions
```

**Godot notes:** Use `_physics_process(delta)` at 60 TPS for the physics, and `_process(delta)` for rendering with interpolation. Set `Engine.physics_ticks_per_second = 60`.

### 1.2 Rail Representation

Rails are polyline arrays of `{x, y}` world-space points. The player position is a **float index** (`pos`) into this array. For example `pos = 5.3` means 30% of the way between `rail[5]` and `rail[6]`.

```
rail: Array of {x, y} points
pos: float  // fractional index into rail array
direction: +1 or -1  // which way "forward" is
speed: float  // world pixels per second along rail
```

**Direction initialization:**
- If rail goes left-to-right: direction = +1
- If rail is purely vertical: direction based on Y direction
- Player can flip direction with Space key (toggles `directionFlipped`)

### 1.3 Rolling Physics (On-Rail)

Every physics tick, when the gondola is on the rail:

```
// Upgrade multipliers
motorMult = 1 + upgrades.motor * 0.25
gripMult  = 1 + upgrades.grip * 0.3
maxSpeed  = (MAX_SPEED_BASE + upgrades.motor * 80) * (1.8 if rocketActive else 1.0)

// Input forces
throttle = 0
if keys.up:   throttle = +THROTTLE_BASE * motorMult * (1.5 if rocketActive else 1.0)
if keys.down: throttle = -THROTTLE_BASE * motorMult * (1.5 if rocketActive else 1.0)
// (If directionFlipped, up/down are swapped)

// Rail angle at current position
railAngle = atan2(rail[i+1].y - rail[i].y, rail[i+1].x - rail[i].x)

// Gravity along rail
gravityForce = direction * worldGravity * sin(railAngle) * 0.15

// Friction (velocity-proportional)
frictionForce = -speed * worldFriction * gripMult

// Aerodynamic drag (velocity-squared)
dragForce = -speed * abs(speed) * 0.0003

// Acceleration with rolling inertia
acceleration = (throttle + gravityForce + frictionForce + dragForce) / ROLLING_INERTIA_FACTOR
speed += acceleration * dt
speed = clamp(speed, -maxSpeed, maxSpeed)
```

**Constants:**
| Constant | Value | Purpose |
|---|---|---|
| THROTTLE_BASE | 350 | Base motor force (px/s^2) |
| MAX_SPEED_BASE | 500 | Base max speed (px/s) |
| ROLLING_INERTIA_FACTOR | 1.5 | Effective mass multiplier for rolling |
| Gravity factor | 0.15 | Scales world gravity for rail slope component |
| Drag coefficient | 0.0003 | Quadratic air drag |

### 1.4 Position Integration

```
// Convert speed to position delta
segLen = distance(rail[floor(pos)], rail[floor(pos)+1])
pos += (direction * speed * dt) / segLen
```

For loops:
```
if isLoop and rail.length > 2:
  cycleLen = rail.length - 1
  pos = ((pos % cycleLen) + cycleLen) % cycleLen
```

### 1.5 Pendulum Physics (Cabin Swing)

The cabin hangs from the wheel on a cable of length `GONDOLA_HANG = 38 px` and swings like a physical pendulum. This is what gives the game its distinctive feel.

**State variables:**
```
pendulumAngle: float  // angle from vertical (radians), positive = clockwise
pendulumVel: float    // angular velocity (rad/s)
prevWheelVX, prevWheelVY: float  // previous frame wheel velocity
```

**Update (every physics tick):**
```
// Compute wheel acceleration from velocity change
wheelAX = (wheelVX - prevWheelVX) / dt
wheelAY = (wheelVY - prevWheelVY) / dt

// Effective gravity (slightly reduced)
gEff = worldGravity * 0.9

// Angular acceleration from forces (pendulum equation)
pendAlpha = -(1.0 / GONDOLA_HANG) * ((gEff - wheelAY) * sin(pendulumAngle) - wheelAX * cos(pendulumAngle))

// Player tilt input (left/right arrows)
if keys.left:  pendAlpha -= PENDULUM_PLAYER_TORQUE   // 15 rad/s^2
if keys.right: pendAlpha += PENDULUM_PLAYER_TORQUE

// Damping (~0.5x critical)
pendAlpha -= PENDULUM_DAMPING * pendulumVel  // 4.5

// Integration
pendulumVel += pendAlpha * dt
pendulumAngle += pendulumVel * dt
// NO angle clamping - full 360 degree rotation is allowed
```

**Cabin position from pendulum:**
```
cabinX = wheelX + sin(pendulumAngle) * GONDOLA_HANG
cabinY = wheelY + cos(pendulumAngle) * GONDOLA_HANG
```

### 1.6 Pendulum Reaction Force on Wheel

The swinging cabin exerts a force back on the wheel along the rail tangent:

```
pendForceX = PENDULUM_MASS_RATIO * gEff * sin(pendulumAngle)  // 0.15
speed += pendForceX * railTangentX * dt / ROLLING_INERTIA_FACTOR
```

This means aggressive swinging actually affects your speed - a critical gameplay mechanic.

### 1.7 Rail Normal Calculation

Rails use Phong-style smoothed normals at polyline joints to prevent visual/physics discontinuities:

1. Get segment tangent (normalized direction vector)
2. At joints: average adjacent segment tangents for smooth interpolation
3. Lerp between smoothed tangents at segment endpoints
4. Perpendicular gives two candidate normals: `nx = -ty, ny = tx`
5. Pick the candidate with `dot(prevNormal) > 0` for continuity
6. Track `prevNormal` between frames to prevent flipping (critical for loops)

**Normal seeding on landing from air:**
```
seedNormalFromApproach(pos, fromX, fromY):
  // Direction from rail point toward approach point
  dx = fromX - railPointX
  dy = fromY - railPointY
  prevNormal = normalize(dx, dy)
```

### 1.8 World Physics Configurations

Three worlds with distinct physics feel:

| World | Gravity (px/s^2) | Friction | Feel |
|-------|---|---|---|
| **Overworld** | 800 | 0.35 | Standard, balanced |
| **Ice** | 800 | 0.06 | Ultra-slippery, long slides |
| **Moon** | 160 | 0.30 | Floaty, slow falls, big air |

### 1.9 Key Physics Constants Reference

| Constant | Value | Notes |
|---|---|---|
| GONDOLA_HANG | 38 | Cable length wheel→cabin (px) |
| CABIN_W | 56 | Cabin width (px) |
| CABIN_H | 36 | Cabin height (px) |
| HIT_RADIUS | 26 | Collision radius around cabin center |
| WHEEL_RADIUS | 7 | Wheel visual radius (px) |
| PENDULUM_DAMPING | 4.5 | Angular velocity damping |
| PENDULUM_PLAYER_TORQUE | 15 | On-rail tilt torque (rad/s^2) |
| AIRBORNE_PLAYER_TORQUE | 25 | Airborne rotation torque (rad/s^2) |
| PENDULUM_MASS_RATIO | 0.15 | Cabin→wheel reaction force ratio |
| INVULN_TIME | 2.0 | Post-hit invulnerability (seconds) |
| ROCKET_DURATION | 3.0 | Rocket boost duration (seconds) |
| SHIELD_DURATION | 2.5 | Shield active duration (seconds) |
| FIXED_DT | 1/60 | Physics timestep (seconds) |
| END_TRIGGER_RADIUS | 60 | Level completion proximity (px) |

---

## Epic 2: Gondola Rendering & Camera

**Goal:** Render the gondola with all visual components and implement the smooth-follow camera with parallax backgrounds.

### 2.1 Gondola Visual Components

Draw order (back to front within gondola):

#### Wheel
- Circle at rail position, radius 7px
- Fill: #555 (dark gray)
- 3 spokes at 120 degree intervals, length 6px, color #555
- Hub circle: radius 2.5px, color #AAA (light gray)
- Rotates: `wheelAngle += (direction * speed * dt) / WHEEL_RADIUS`

#### Cable
- Line from wheel center to cabin top
- Length: GONDOLA_HANG (38px), along pendulum angle
- Width: 2px, color #444

#### Cabin
- Rounded rectangle: 56x36px, corner radius 6px
- Body fill: #E53935 (red), outline: #B71C1C (dark red), 2px stroke
- Roof: 2px bar above cabin, color #C62828
- Window: 48x16px, color rgba(135, 206, 250, 0.7) (sky blue semi-transparent), outlined in dark red

#### Passengers (in window)
- Each passenger: brown circle head (radius 8-11px), color #8B6914
- White eyes with black pupils
- Evenly spaced across window width
- Only top 14px visible (clipped by window)
- Count: 3 + upgrades.health (max 8)
- Lost passengers shown as faded/missing

#### Active Power-up Effects
- **Shield:** Blue glow circle, radius = CABIN_W/2 + 15 (43px), color rgba(100, 200, 255, 0.6)
- **Rocket:** Orange/yellow flame triangle from left cabin edge, length 15-30px (randomized), height 10px

### 2.2 Camera System

Smooth exponential follow camera:

```
// Target: gondola at 35% from left, 45% from top
targetX = gondolaWorldX - canvasWidth * 0.35
targetY = gondolaWorldY - canvasHeight * 0.45

// Exponential smoothing
camera.x += (targetX - camera.x) * (1 - exp(-5.0 * frameDt))
camera.y += (targetY - camera.y) * (1 - exp(-3.7 * frameDt))
```

**Key details:**
- X smoothing is faster (5.0) than Y smoothing (3.7) - intentional asymmetry
- Uses `frameDt` (actual frame time), NOT the fixed physics dt
- Gondola position is interpolated between physics frames using `interpolationAlpha`

### 2.3 Background Rendering

Draw order (back to front):

#### Sky
- Vertical linear gradient, full canvas
- Colors determined by world config or sky theme override:
  - Overworld: #4BA3E3 (top) → #87CEEB (bottom)
  - Ice: #B0D4F1 → #E0F0FF
  - Moon: #0A0A2E → #1A1A4E
  - Custom themes: day, dusk (#2C1654→#E8735A), night (#0A0A2E→#1A1A4E), dawn (#1A1A4E→#FFB366)

#### Stars (Moon only)
- 200 white circles, radius 1-3px
- Random positions: x in [0, 10000], y in [0, 400]
- Parallax: 5% of camera X, wrapping

#### Mountains
- 20 triangular peaks
- Properties per mountain: x (spaced ~500px apart with randomness), width 200-500px, height 150-350px
- Triangle shape with snow cap (top 30%, 35%-65% width)
- Colors per world config
- Parallax: 15% of camera X

#### Clouds (non-Moon worlds only)
- 15 clouds
- Composed of 3 overlapping ellipses (main + 2 bumps)
- Color: rgba(255, 255, 255, 0.85)
- Parallax: 8% of camera X + slow animated drift (performance.now() * 0.005)
- Wrapping

#### Ground/Terrain
- Polygon following rail points
- Dirt fill between ground line and canvas bottom
- Grass strokes 25px above ground line
- Ground height: rail.y + configurable offset (100-600px, procedural per-point)
- Colors per world config (grass + dirt separate colors)

#### Background Tiles (custom levels only)
- Grid-aligned colored squares, 50x50px each
- Painted in editor, stored as `Record<"gx,gy", {color, outline?, outlineColor?}>`
- 18-color palette, optional outlines

### 2.4 Parallax Layer Summary

| Layer | Parallax Factor | Notes |
|---|---|---|
| Stars | 0.05 | Moon only, wrapping |
| Clouds | 0.08 | Non-moon, animated drift, wrapping |
| Mountains | 0.15 | All worlds |
| Ground | 1.0 | Follows camera exactly |
| Rail | 1.0 | Follows camera exactly |

---

## Epic 3: Endless Mode & Procedural Generation

**Goal:** Implement the infinite procedural rail generation with dynamic obstacle spawning.

### 3.1 Rail Generation

Rails are generated on-demand as the player progresses. New points are appended when `pos > rail.length - 80`.

```
RAIL_SPACING = 100  // pixels between rail points

For each new point (at index i):
  x = i * RAIL_SPACING

  // Difficulty ramps over 30,000 pixels
  difficulty = min(1.0, x / 30000)
  maxSlope = 25 + difficulty * 35  // range: 25-60

  // Random height variation (slight upward bias from 0.48)
  dy = (rng() - 0.48) * maxSlope
  y = clamp(lastY + dy, 120, 520)  // vertical bounds
```

**Ground generation (below rail):**
```
isChasm = rng() < 0.04 + difficulty * 0.03  // 4-7% chance
targetOffset = isChasm ? (400 + rng() * 200) : (100 + rng() * 120)
groundY = smooth interpolation toward targetOffset below rail
```

### 3.2 Obstacle Spawning (Endless Mode)

Only 2 obstacle types in endless mode (spinner and bouncer):

```
For each rail point beyond nextObstacleX:
  difficulty = min(1.0, railX / 30000)

  50% chance: Spinner
    armLength = (50 + rng() * 40) * 3  // 150-270
    rotSpeed = -(0.3 + rng() * 0.4 + difficulty * 0.4)
    position: slightly above rail

  50% chance: Bouncer
    amplitude = 100 + rng() * 80
    bounceSpeed = 0.6 + rng() * 0.8
    position: baseY = railY - 20

  // Gap between obstacles
  nextObstacleX = x + OBSTACLE_MIN_GAP + rng() * (OBSTACLE_MAX_GAP - OBSTACLE_MIN_GAP) * (1 - difficulty * 0.3)
```

**Gap constants:**
- OBSTACLE_MIN_GAP = 280
- OBSTACLE_MAX_GAP = 500

### 3.3 Initial Setup

- Generate 300 initial rail points
- Player starts at pos ~= 5 (near beginning)
- Speed starts at 0
- Direction determined by rail direction

---

## Epic 4: Airborne Physics & Rail Transitions

**Goal:** Implement the airborne (off-rail) physics system used in custom finite levels, including launch, flight, collision sweep, and landing.

### 4.1 Launch (Leaving Rail)

When the player reaches the end of a finite rail segment:

```
// Offset wheel position by rail normal
launchPos = railEndPoint + railNormal * WHEEL_RADIUS

// Calculate launch velocity from tangential speed
tangent = normalized(railEnd - railSecondToLast)
effSpeed = direction * speed
airVX = tangent.x * effSpeed
airVY = tangent.y * effSpeed

// State transition
onRail = false
airborneTime = 0
airborneFromSeg = currentSegmentIndex  // cooldown to prevent re-snap
```

### 4.2 Airborne Physics

```
gEff = worldGravity * 0.9

// Gravity
airVY += gEff * dt

// Drag (quadratic)
velMag = sqrt(airVX^2 + airVY^2)
drag = 0.0006 * velMag^2
if velMag > 0:
  airVX -= (airVX / velMag) * drag * dt
  airVY -= (airVY / velMag) * drag * dt

// Position integration
airX += airVX * dt
airY += airVY * dt

// Track time for cooldown
airborneTime += dt
```

### 4.3 Pendulum While Airborne

Same pendulum equation as on-rail, but:
- Uses AIRBORNE_PLAYER_TORQUE = 25 (stronger than on-rail 15)
- Full 360-degree rotation allowed
- No angle clamping

### 4.4 Swept Circle Collision (Landing Detection)

Tests a moving circle (wheel, radius 7px) against all rail segments each tick:

```
sweepCircleVsSegment(cx, cy, dx, dy, radius, segA, segB):
  // 1. Ray vs infinite line at distance = radius
  //    Solve linear equation for parameter t
  // 2. Check if contact point projects within segment [0,1]
  // 3. Ray vs endpoint circles (quadratic equation)
  // Return earliest t in [0,1] or null

For each rail segment (skipping airborneFromSeg if airborneTime <= 0.3s):
  t = sweepCircleVsSegment(wheelPos, velocity*dt, WHEEL_RADIUS, segA, segB)
  if t is not null and t < bestT:
    bestT = t
    bestSegment = segment
```

### 4.5 Landing (Snapping to Rail)

On collision detection:

```
// Compute tangential speed (preserve momentum along rail direction)
tangent = normalized(segB - segA)
speed = (airVX * tangent.x + airVY * tangent.y) * direction

// Project position onto rail
pos = segmentIndex + projection_along_segment

// Seed normal from approach side (prevents flip on loops)
seedNormalFromApproach(pos, airX, airY)

// State transition
onRail = true
```

### 4.6 Fallback Proximity Snap

For slow approaches where swept circle misses:

```
PROXIMITY_SNAP_RADIUS = 20  // pixels

For each rail segment (with same cooldown rules):
  closestDist = pointToSegmentDistance(wheelPos, segA, segB)
  if closestDist < PROXIMITY_SNAP_RADIUS:
    // Same landing logic as swept collision
```

### 4.7 Multi-Segment Support

Custom levels have multiple disconnected rail segments stored in `allRailSegments[][]`. The player rides one segment at a time (`this.rail`), and collision detection checks ALL segments for landing.

Pre-computed AABB bounding boxes (`segmentBounds[]`) allow early rejection of distant segments.

---

## Epic 5: Obstacle System

**Goal:** Implement all 10 obstacle types with their update logic, collision detection, and rendering.

### 5.1 Obstacle Architecture

Each obstacle type has:
- **Definition:** metadata, default params, reach zone geometry, factory method
- **Behavior:** `update(dt)`, `checkCollision(cx, cy, hitRadius)`, `render(ctx)`

### 5.2 Collision Probes

The gondola has 4 collision probes checked against each obstacle:

```
1. Cabin center:     (cabinX, cabinY),           radius = CABIN_H/2 (18px)
2. Cabin left edge:  cabin + perpendicular * 28,  radius = CABIN_H/2
3. Cabin right edge: cabin - perpendicular * 28,  radius = CABIN_H/2
4. Cable midpoint:   halfway wheel→cabin,         radius = 4px

Perpendicular to cable:
  axisX = cos(pendulumAngle)
  axisY = -sin(pendulumAngle)
```

### 5.3 Damage System

```
On collision (if not invulnerable and not shielded):
  passengers -= 1
  invulnTimer = INVULN_TIME (2.0 seconds)
  flashTimer = 0.3 seconds  // visual flash

  if passengers <= 0:
    gameOver = true
    cash = floor(distance * 0.5)
```

### 5.4 Obstacle Type Details

#### 5.4.1 Spinner

Rotating arm obstacle. The most common obstacle in endless mode.

**Parameters:**
- armLength: 20-300 (default 120) - arm tip distance from center
- rotSpeed: 0.1-5 (default 0.5) - rotation speed (rad/s)
- radius: 4-40 (default 12) - hub circle radius
- rotation: 0-360 (default 0) - initial angle offset

**Update:** `angle += rotSpeed * dt`

**Visual:** Gray hub with crosshairs, 4 red-tipped arms at 90-degree intervals rotating around center, semi-transparent pole extending 60 units downward.

**Collision:** 4 arm line segments (half-width 9px each) + 1 pole segment (half-width 5px, 60px long) + hub circle. Uses point-to-segment distance.

#### 5.4.2 Bouncer

Vertically oscillating spiked ball.

**Parameters:**
- amplitude: 10-300 (default 80) - vertical travel distance
- bounceSpeed: 0.1-5 (default 0.7) - oscillation frequency (rad/s)
- radius: 4-50 (default 18) - ball radius
- rotation: 0-360 (default 0) - orientation offset

**Update:** `angle += bounceSpeed * dt`

**Position:** `ballY = baseY + sin(angle) * amplitude` (baseY = worldY - 20)

**Visual:** Gold spring connecting base to ball, red ball with 8 triangular spikes around perimeter.

**Collision:** Circle at ball position, accounting for rotation. Distance check to ball center.

#### 5.4.3 Pendulum

Swinging bob from a fixed pivot point.

**Parameters:**
- cableLength: 30-400 (default 220) - cable distance
- swingAngle: 0.1-1.55 rad (default 1.2) - max swing amplitude
- bobRadius: 4-50 (default 18) - bob sphere radius
- swingSpeed: 0.1-5 (default 1.2) - swing frequency (rad/s)
- rotation: 0-360 (default 0)

**Update:** `angle += swingSpeed * dt`

**Bob position:**
```
currentSwing = swingAngle * sin(angle)
bobX = centerX + sin(currentSwing) * cableLength
bobY = centerY + cos(currentSwing) * cableLength
```

**Visual:** Fixed pivot circle, rope to bob, dark gray bob with triangular spikes.

**Collision:** Circle at bob position, radius = bobRadius.

#### 5.4.4 Crusher

Static collision zone. Simple but effective placement obstacle.

**Parameters:**
- zoneWidth: 20-400 (default 80)
- zoneHeight: 20-400 (default 60)
- rotation: 0-360 (default 0)

**Update:** Static (none).

**Visual:** Concentric gray circles with shadow.

**Collision:** Circle with radius = min(zoneWidth, zoneHeight) / 2.

#### 5.4.5 Laser

Pulsing beam with warning phase.

**Parameters:**
- beamLength: 20-600 (default 200) - maximum beam extent
- direction: 'left' or 'right' (default 'right')
- cycleSpeed: 0.2-5 (default 1.5) - cycle frequency (rad/s)
- warningTime: 0.5-8 (default 2.0) - warning duration before firing (seconds)
- rotation: 0-360 (default 0)

**Update:** `angle += cycleSpeed * dt`

**Cycle phases:**
```
warningRad = warningTime * cycleSpeed
fullCycle = warningRad + PI

phase = angle % fullCycle
if phase < warningRad: WARNING (beam off, dashed line flickers)
else: FIRING (beam on, solid red)
```

**Visual:**
- Emitter body: gray box with colored indicator light (orange warning, red firing)
- Warning: dashed red line with random alpha flicker
- Firing: glowing red beam with shadow blur, multi-layer glow

**Collision:** Point-to-segment distance from probe to beam line, half-width 5px. Only during FIRING phase.

#### 5.4.6 Swoop

Bird that patrols and dives at the player.

**Parameters:**
- patrolWidth: 20-600 (default 160) - horizontal patrol range
- patrolHeight: 10-300 (default 80) - trigger zone height
- diveDepth: 10-400 (default 120) - how far down the bird dives
- patrolSpeed: 0.1-4 (default 0.8) - patrol cycle frequency
- rotation: 0-360 (default 0)

**State machine (stored in armLength field):**
```
State 0 (Patrol):
  angle += patrolSpeed * dt
  birdX = centerX + sin(angle) * patrolWidth/2
  birdY = baseY
  → State 1 when player cabin enters patrol zone

State 1 (Diving):
  amplitude += DIVE_SPEED * dt  // 320 px/s
  birdY = baseY + amplitude
  → State 2 when amplitude >= diveDepth

State 2 (Rising):
  amplitude -= RISE_SPEED * dt  // 160 px/s
  birdY = baseY + amplitude
  → State 0 when amplitude <= 0
```

**Visual:** Bird sprite with body, wings (flapping animation), head, orange beak, yellow eye. Wing animation sinusoidal during patrol, different pose during dive.

**Collision:** Circle at bird world position with obs.radius.

#### 5.4.7 Orbiter

Ball orbiting a fixed center point.

**Parameters:**
- orbitRadius: 10-300 (default 80) - orbit path radius
- orbRadius: 4-50 (default 14) - orbiting ball radius
- orbitSpeed: 0.1-8 (default 1.2) - angular velocity (rad/s)
- rotation: 0-360 (default 0)

**Update:** `angle += orbitSpeed * dt`

**Ball position:**
```
ballX = centerX + cos(angle + rotation) * orbitRadius
ballY = centerY + sin(angle + rotation) * orbitRadius
```

**Visual:** Central purple hub, dashed orbit ring, arm line, orbiting ball with highlights and sparkle.

**Collision:** Circle at ball position, radius = orbRadius.

#### 5.4.8 Boulder

Trigger-activated falling rock.

**Parameters:**
- radius: 8-120 (default 30) - boulder size
- triggerRadius: 20-400 (default 120) - activation proximity
- dropDelay: 0-5 (default 0.5) - countdown before falling (seconds)
- fallTimeout: 1-15 (default 4) - max fall time before despawn
- rotation: 0-360 (default 0)

**State machine:**
```
State 0 (Idle):
  Waiting at original position
  → State 1 when cabin distance < triggerRadius

State 1 (Countdown):
  Timer decreasing (bounceSpeed -= dt)
  Visual shake
  → State 2 when timer <= 0

State 2 (Falling):
  bounceSpeed += GRAVITY * dt  // GRAVITY = 700
  y += bounceSpeed * dt
  amplitude += dt  // tracks fall duration
  Rotating as it falls
  → Despawn when amplitude > fallTimeout or hit detected
```

**Visual:** Layered shading, shadow/highlights, scratch marks. Shake during countdown. Rolling rotation during fall.

**Collision:** Circle, only during State 2 (falling). Sets hit=true on impact.

#### 5.4.9 Mine

Proximity-triggered explosive with countdown fuse.

**Parameters:**
- triggerRadius: 5-200 (default 40) - activation proximity
- explosionRadius: 10-300 (default 80) - explosion damage zone
- triggerDelay: 0-10 (default 1.5) - fuse countdown (seconds)
- rotation: 0-360 (default 0)

**State machine:**
```
State 0 (Idle):
  Slow rotation: angle += 0.4 * dt
  → State 1 when cabin distance < triggerRadius

State 1 (Armed):
  Fast rotation: angle += 2.5 * dt
  Countdown: bounceSpeed -= dt
  Visual: pulsing red glow, spike arc shows countdown progress
  → State 2 when countdown <= 0 (checks explosion zone, deals damage)

State 2 (Exploding):
  Animation for 0.55 seconds
  Visual: expanding radial gradient blast rings
  → Despawn after animation
```

**Collision:** Damage dealt at explosion moment (State 1→2 transition), not as continuous collision. Checks if player within explosionRadius at detonation.

**Visual:** Rotating mine body (radius 14px) with spikes. Glow and pulse when armed. Radial blast effect when exploding.

#### 5.4.10 Stalactite

Falling icicle triggered by proximity. Uses crusher behavior (static collision) but with icicle visual.

**Parameters:**
- triggerRadius: 10-300 (default 60) - activation proximity
- dropZoneWidth: 4-100 (default 20) - projectile width
- dropZoneHeight: 10-400 (default 100) - projectile height
- rotation: 0-360 (default 0)

**Collision:** Circle with radius = dropZoneWidth/2. Static (uses crusher behavior).

**Visual:** Light blue icicle shape with gradient.

### 5.5 Shared Obstacle Fields

All obstacle instances share a common data structure:

```
id: string              // unique identifier
typeId: string          // "obstacle.spinner", etc.
type: string            // "spinner", etc.
x, y: float            // world position
radius: float          // primary collision radius
angle: float           // current rotation (radians)
rotSpeed: float        // rotation speed
baseY: float           // reference Y position
amplitude: float       // multi-purpose (bounce height, fall distance, etc.)
bounceSpeed: float     // multi-purpose (frequency, velocity, countdown)
armLength: float       // multi-purpose (arm length, state machine flag)
hit: boolean           // despawn flag
hp: int                // hit points (always 1)
rotation: float        // fixed rotation offset
```

Plus type-specific fields (cableLength, beamLength, beamDirection, etc.).

---

## Epic 6: HUD, Menus & Game Flow

**Goal:** Implement the complete UI layer: in-game HUD, main menu, shop, pause screen, and game-over screen.

### 6.1 Phase State Machine

```
Phase = 'menu' | 'playing' | 'editor' | 'customPlay'

Transitions:
  menu → playing       (select world, start endless game)
  menu → editor        (open level editor)
  menu → customPlay    (play custom level, optionally with ghost)
  playing → menu       (game over or quit)
  editor → menu        (save/cancel)
  customPlay → menu    (complete or quit)
```

### 6.2 Main Menu

Views within menu phase:
1. **World Selection** - Three world buttons (Overworld, Ice, Moon) with per-world distance records
2. **Play** button, **Shop** button, **Editor** button, **Custom Levels** button, **Settings** button
3. **Shop/Upgrades** - 5 upgrade categories with level bars, costs, cash balance
4. **Custom Level Browser** - List of saved levels with Play/Edit/Delete/Import/Export/Race Ghost options
5. **Leaderboard** per custom level (top 5 times)

### 6.3 In-Game HUD

| Element | Position | Format | Style |
|---|---|---|---|
| Distance | Top-left | "distance m" | Black rounded rect 180x36, white bold 18px |
| Speed | Top-right | "speed km/h" | Black rounded rect 180x52, white bold 18px |
| Time | Top-right (below speed) | "M:SS" | Yellow #FFD54F, bold 14px |
| Passengers | Top-left (below distance) | Heart icons | Red = alive, gray = dead, 22px |
| Throttle bar | Bottom-center | Horizontal bar | 280x30px, green=forward, red=backward, white center mark |
| Rocket status | Left side | "Rocket xN [SPACE]" | #FF6600 when active, white otherwise |
| Shield status | Left side | "Shield xN [SHIFT]" | #64B5F6 when active, white otherwise |

**Speed conversion:** `displaySpeed = abs(speed) * 0.36` (to km/h)

### 6.4 Game Over Screen

- Full-screen overlay: rgba(0, 0, 0, 0.7)
- "GAME OVER" - white, bold, 48px
- Distance and cash earned - yellow, 24px
- "Press ENTER to continue" - gray, 18px
- All centered

### 6.5 Input Mapping

| Key | Action |
|---|---|
| Arrow Up | Throttle forward (or backward if flipped) |
| Arrow Down | Throttle backward (or forward if flipped) |
| Arrow Left | Tilt cabin left (pendulum) |
| Arrow Right | Tilt cabin right (pendulum) |
| Space | Toggle direction flip |
| X | Activate rocket boost (if charges > 0) |
| Left Shift | Activate shield (if charges > 0) |
| Escape | Toggle pause menu |
| Enter | Dismiss game over / confirm |

### 6.6 Pause Menu

- Semi-transparent overlay
- Resume / Quit options
- Pauses physics loop

---

## Epic 7: Progression, Upgrades & Persistence

**Goal:** Implement the upgrade shop, currency system, and save/load.

### 7.1 Save Data Structure

```
SaveData:
  cash: int                        // accumulated currency
  upgrades:
    motor:  int (0-5)              // +80 px/s max speed per level, +0.25 throttle mult
    health: int (0-5)              // +1 passenger per level
    grip:   int (0-5)              // +0.3 friction multiplier per level
    rocket: int (0-3)              // 1+level boost charges
    shield: int (0-3)              // 1+level shield charges
  records:
    overworld: float               // best distance
    ice: float                     // best distance
    moon: float                    // best distance
```

### 7.2 Upgrade Costs

| Upgrade | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
|---|---|---|---|---|---|
| Motor | 100 | 250 | 500 | 1000 | 2000 |
| Health | 150 | 400 | 800 | 1500 | 3000 |
| Grip | 100 | 250 | 500 | 1000 | 2000 |
| Rocket | 200 | 500 | 1200 | - | - |
| Shield | 200 | 500 | 1200 | - | - |

### 7.3 Upgrade Effects

| Upgrade | Effect per Level |
|---|---|
| Motor | maxSpeed += 80, throttleMult += 0.25 |
| Health | passengers += 1 (base is 3) |
| Grip | frictionMult += 0.3 |
| Rocket | +1 charge (level 0 = no charges) |
| Shield | +1 charge (level 0 = no charges) |

### 7.4 Cash Earning

- On game over (endless): `cash += floor(distance * 0.5)`
- On level complete (custom): bonus tracked separately

### 7.5 Starting State Per Game

```
passengers = 3 + upgrades.health
rocketCharges = upgrades.rocket > 0 ? 1 + upgrades.rocket : 0
shieldCharges = upgrades.shield > 0 ? 1 + upgrades.shield : 0
```

### 7.6 Storage Keys (localStorage)

| Key | Contents |
|---|---|
| cable-riders-save | SaveData (cash, upgrades, records) |
| cable-riders-custom-levels | Array of EditorLevel objects |
| cable-riders-leaderboards | Top 5 times per level |
| cable-riders-replays | Ghost replay data per level |
| game-settings | Music volume, snap radius, tool behavior |
| music-catalog-custom | Custom track labels |

---

## Epic 8: Level Editor & Custom Levels

**Goal:** Implement the full level editor with all drawing tools, obstacle placement, and the level conversion pipeline.

### 8.1 Editor Grid

- GRID_SIZE = 50 pixels per cell
- Canvas: 200 cells wide x 16 cells tall (10,000 x 800 world pixels)
- Multi-level zoom with pan support
- Snap tolerance: 8 pixels for endpoint merging

### 8.2 Editor Tools

#### Rail Drawing Tools
| Tool | Description |
|---|---|
| rail | Single rail tile placement on grid |
| line | Straight line segment between two points |
| line2 | Free-form line (click to place vertices) |
| arc | Circular arc curve between two endpoints |
| curve | Quadratic Bezier curve (start, end, control point) |
| loop | Full loop-the-loop through a midpoint |
| circular_curve | Circular arc via 3-point input |
| polygon | Enclosed polygon rail |
| draw_rail | Freehand drawing with configurable smoothing (0-1) |

#### Marker Tools
| Tool | Description |
|---|---|
| rail_start | Level start marker (green) - where player spawns |
| rail_end | Level finish marker (pink) - triggers completion |
| rail_crossing | 4-way junction point (orange) |

#### Object Placement Tools
- All 10 obstacle types (placed on grid, configurable parameters via inspector)
- star - Collectible star (max 3 per level)
- paint - Background tile painting (18-color palette, variable brush size 1/2/3/5 tiles, optional outline)
- eraser - Remove placed elements

### 8.3 Level Format (V3 - Current)

```
EditorLevel:
  name: string
  id: string                          // stable unique ID
  version: 3
  createdAt: timestamp

  // Rails
  segments: RailSegment[]             // polyline rail segments
    - points: [{x, y}, ...]          // world-space coordinates
    - rawDrawnPoints?: [{x, y}, ...] // original freehand points
    - smoothness?: 0..1              // draw_rail smoothing slider

  // Markers
  startMarker?: {x, y}               // world-space start position
  endMarker?: {x, y}                 // world-space end position

  // Objects
  obstacles?: Record<"gx,gy", type>  // obstacle placements
  obstacleParams?: Record<"gx,gy", params>  // per-obstacle overrides
  stars?: Record<"gx,gy", "star">    // collectible stars

  // Visuals
  skyTheme?: "day"|"dusk"|"night"|"dawn"
  bgTiles?: Record<"gx,gy", BgTile>  // background decoration

  // Audio
  musicFile?: string                  // optional custom music
```

### 8.4 Level Conversion Pipeline

When playing a custom level, the editor format is converted to game data:

```
convertLevelToGameDataV3(level):
  1. buildIndividualSegmentsFromRailSegments(segments)
     → Map each RailSegment to an IndividualRailSegment with snappoints

  2. buildContinuousSegments(individual)
     → Group segments by proximity (8px snap tolerance)
     → BFS connected components
     → Returns ordered ContinuousRailSegment groups

  3. walkContinuousPath(individual, continuous, startMarkerPos)
     → Walk segments into ordered point sequence
     → Prefer dead-ends as start points (or closest to startMarker)
     → Handle crossings by preferring straightest continuation (dot product)
     → Detect loops (closed paths)

  4. subdivideSharps(points, thresholdDeg=60, arcRadius, samplesPerCorner)
     → Detect corners sharper than threshold
     → Insert arc points via angle interpolation
     → Prevents wheel clipping on tight turns

  5. Resample to uniform spacing (RESAMPLE_STEP = 20px)

  6. Extract obstacles and stars from grid positions

  7. Return: railPoints, allSegments, obstacles, stars, endTileWorldPos, isLoop
```

### 8.5 Curve Sampling Functions

| Function | Input | Output |
|---|---|---|
| sampleCircularArcWorld | start, end, pivot | Arc passing through pivot, adaptive step count |
| sampleBezierWorld | start, end, control | Quadratic Bezier, uniform arc-length resampling |
| sampleLoopRailWorld | start, end, control | Full circular loop with entry/exit lines |
| sampleLineWorld | start, end, stepPx | Straight line, uniform spacing |
| samplePolylineWorld | points, stepPx | Arbitrary polyline, uniform spacing |

### 8.6 Smoothing Algorithms

**RDP Simplification** (Ramer-Douglas-Peucker):
- Removes redundant points within epsilon distance
- Used on freehand-drawn rails
- epsilon = 2 + smoothness * 38

**Chaikin Corner-Cutting:**
- Iterative 25/75 weight blend at corners
- 0-3 iterations based on smoothness slider
- Produces smooth curves from angular polylines

### 8.7 Level Import/Export

Export envelope:
```
{
  format: "sky-lift-dash-level",
  formatVersion: 3,
  exportedAt: timestamp,
  level: EditorLevel
}
```

- Files: `.gondola.json`
- Import supports both envelope and raw EditorLevel
- Rejects incompatible future versions
- Deduplicates names on import
- Clears musicFile on import (local path incompatibility)

### 8.8 Custom Level Playback Setup

```
1. convertLevelToGameDataV3(level) → rail, segments, obstacles, stars, endPos, isLoop
2. Create GameEngine with overworld physics (custom levels always use overworld base)
3. Populate engine:
   engine.rail = railPoints
   engine.allRailSegments = allSegments
   engine.obstacles = created via obstacle definitions
   engine.collectibleStars = star positions
   engine.ground = rail.map(p => p.y + 150)
   engine.hasFinitePath = true
   engine.isLoop = isLoop
   engine.skyOverride = theme colors from skyTheme
   engine.bgTiles = background tiles
   engine.noBackground = true  // disable mountains, clouds, ground polygon
4. Procedural generation disabled (no new rail or obstacle spawning)
5. Level completes when player reaches endTileWorldPos within END_TRIGGER_RADIUS (60px)
```

---

## Epic 9: Ghost Replay System

**Goal:** Implement ghost recording, storage, and playback for custom levels.

### 9.1 Recording

- Sample rate: 15 Hz (every 4th physics tick at 60Hz)
- Frame data (14 bytes per frame):

```
GhostFrame:
  float32 x       (4 bytes) - wheel world X
  float32 y       (4 bytes) - wheel world Y
  int16   pa      (2 bytes) - pendulumAngle * 10000
  int16   wa      (2 bytes) - (wheelAngle % 2PI) * 1000
  uint8   p       (1 byte)  - passengers count
  uint8   flags   (1 byte)  - bit 0: shield, bit 1: rocket, bit 2: onRail
```

### 9.2 Storage Format

```
ReplayData:
  version: 1
  levelId: string
  levelHash: string          // FNV-1a 32-bit hash of level geometry
  name: string               // "Personal Best" or custom name
  time: float                // completion time (seconds)
  starsCollected: int
  date: timestamp
  sampleRate: 15
  frameSize: 14
  frames: string             // base64-encoded binary
```

### 9.3 Level Hashing

FNV-1a 32-bit hash of: segments, startMarker, endMarker, obstacles, stars. Used to detect if a replay is stale (level was modified after recording).

### 9.4 Playback

- GhostPlayer interpolates between frames based on elapsed time
- Ghost rendered at 35% global alpha
- Same visual structure as player (wheel, cable, cabin) but thinner/grayed
- Shield indicator (blue circle) if flag set
- Returns null when replay is finished

### 9.5 Replay Management

- Storage key: `cable-riders-replays`
- Indexed by levelId
- "Personal Best" auto-overwrites if faster
- CRUD: save, get by level, get by name, delete

---

## Epic 10: Audio, Sprites & Polish

**Goal:** Implement music playback, sprite system, collectible stars, and visual polish.

### 10.1 Music System

- Single audio element (replaces on new track)
- Loop enabled by default
- Volume: 0-1, synced from settings (default 0.7)
- Track discovery via file glob at build time

**Playlists:**
- Menu music: configured in JSON
- Endless mode: per-world playlists (overworld, ice, moon)
- Custom levels: optional per-level music file

### 10.2 Sprite System

Optional sprite overlay system. Each entity type has an `enabled` flag (default false). When enabled, loads images from assets directory. When disabled, uses canvas vector drawing (the default).

```
drawSpriteOrFallback(ctx, typeId, x, y, opts):
  if sprite enabled and loaded: draw sprite → return true
  else: return false (caller uses canvas drawing)
```

Features: lazy image loading, anchor points, hitbox scaling, rotation support.

### 10.3 Collectible Stars

- Max 3 per custom level
- 5-pointed star shape, base radius 18px
- Animation: pulse `1 + sin(time*3) * 0.08`, rotation `sin(time*0.7) * 0.15`
- Glow: shadow blur 12-15px, color #FFD700 (gold)
- Collection radius: 30px from cabin center
- Tracked in leaderboard and replay data

### 10.4 Entity Type IDs

Used as keys for sprite system and obstacle identification:

```
Player:        player.gondola
Obstacles:     obstacle.spinner, obstacle.bouncer, obstacle.pendulum,
               obstacle.crusher, obstacle.laser, obstacle.swoop,
               obstacle.orbiter, obstacle.boulder, obstacle.mine,
               obstacle.stalactite
Rail:          rail.segment, rail.startTile, rail.endTile
Collectibles:  collectible.star
Background:    background.mountain, background.cloud
```

### 10.5 Distance & Scoring

```
// On-rail:
distance += abs(speed * dt) * 0.1    // pixels to meters

// Airborne:
distance += velocityMagnitude * dt * 0.1
```

### 10.6 Settings

```
GameSettings:
  musicVolume: float (0-1, default 0.7)
  snapRadius: int (min 5, default 25)
  defaultFreeLineToolBehaviour: "normal" | "grid_snap"
  continuousLine: boolean
```

### 10.7 Rendering Pipeline (Complete Draw Order)

1. Sky gradient (full canvas)
2. Stars (moon only, 5% parallax)
3. Mountains (15% parallax)
4. Clouds (8% parallax + animated drift)
5. Ground/terrain polygon
6. Background decoration tiles
7. Rail cable (polyline, color #333, width 4px)
8. Start/end tile markers
9. Obstacles (per-type rendering)
10. Collectible stars (animated)
11. Ghost replay (35% alpha)
12. Gondola (player)
13. HUD overlay

---

## Appendix A: World Visual Themes

| Property | Overworld | Ice | Moon |
|---|---|---|---|
| Sky Top | #4BA3E3 | #B0D4F1 | #0A0A2E |
| Sky Bottom | #87CEEB | #E0F0FF | #1A1A4E |
| Grass | #4CAF50 | #E8F4FD | #555555 |
| Dirt | #8B6914 | #A8C8E0 | #3A3A3A |
| Mountain | #6B8E23 | #C8DFF0 | #444444 |
| Snow | #FFFFFF | #FFFFFF | #666666 |
| Stars | No | No | Yes (200) |
| Clouds | Yes (15) | Yes (15) | No |

## Appendix B: Sky Theme Colors (Custom Levels)

| Theme | Sky Top | Sky Bottom |
|---|---|---|
| day | #4BA3E3 | #87CEEB |
| dusk | #2C1654 | #E8735A |
| night | #0A0A2E | #1A1A4E |
| dawn | #1A1A4E | #FFB366 |

## Appendix C: Background Tile Palette

18 colors available for background painting in the editor. Tiles are 50x50px grid-aligned squares with optional outline stroke. Brush sizes: 1, 2, 3, or 5 tiles.

## Appendix D: Recommended Godot Implementation Notes

- **Fixed timestep:** Use `Engine.physics_ticks_per_second = 60` and `_physics_process()` for all physics. Use `_process()` with interpolation for rendering.
- **Rail polylines:** Can be represented as `PackedVector2Array` or `Path2D` with `Curve2D`.
- **Pendulum:** Implement as custom physics in `_physics_process()`, not Godot's built-in physics joints.
- **Camera:** Use `Camera2D` with custom smoothing (override `_process()` with the exponential smoothing formula).
- **Parallax backgrounds:** `ParallaxBackground` + `ParallaxLayer` nodes with appropriate motion scales.
- **Canvas drawing:** Use `_draw()` overrides or `Line2D` / `Polygon2D` nodes.
- **Obstacle behaviors:** Custom `Node2D` subclasses with `_physics_process()` for update logic.
- **Grid-based editor:** Consider `TileMap` for the editor grid, with custom tools overlaying.
- **Save system:** `ConfigFile` or JSON via `FileAccess` to user:// directory.
- **Audio:** `AudioStreamPlayer` with stream swapping for music.
