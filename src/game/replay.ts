// ---------------------------------------------------------------------------
// Replay / Ghost system for time-trial mode
// ---------------------------------------------------------------------------

import type { EditorLevel } from "./editorTypes";

// --- Types -----------------------------------------------------------------

export interface GhostFrame {
  x: number; // wheel world X
  y: number; // wheel world Y
  pa: number; // pendulumAngle
  wa: number; // wheelAngle
  p: number; // passengers
  flags: number; // bit 0: shield, bit 1: rocket, bit 2: onRail
}

export interface ReplayData {
  version: 1;
  levelId: string;
  levelHash: string;
  name: string; // user-chosen or auto-generated formatted time
  time: number; // completion time (seconds)
  starsCollected: number;
  date: number; // Date.now()
  sampleRate: number; // snapshots per second (default 15)
  frameSize: number; // bytes per frame (14 for v1)
  frames: string; // base64-encoded binary
  auto?: boolean; // true for automatically saved replays (PB auto-save, Race Ghost)
}

// --- Constants -------------------------------------------------------------

const SAMPLE_INTERVAL = 4; // record every 4th physics tick → 15 Hz at 60 Hz
const SAMPLE_RATE = 15;
const FRAME_SIZE = 14; // bytes per frame in v1

// --- Binary encode / decode ------------------------------------------------

function uint8ToBase64(arr: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < arr.length; i += 8192) {
    binary += String.fromCharCode(...arr.subarray(i, i + 8192));
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

// Wrap angle to [-π, π] so it always fits in int16 with 10000 precision (max ±3.2767 rad).
// Purely visual: rotation repeats every 2π, so no information is lost.
function wrapToPi(a: number): number {
  const TWO_PI = Math.PI * 2;
  return ((a % TWO_PI) + TWO_PI + Math.PI) % TWO_PI - Math.PI;
}

export function encodeFrames(frames: GhostFrame[]): string {
  const buf = new ArrayBuffer(frames.length * FRAME_SIZE);
  const view = new DataView(buf);
  for (let i = 0; i < frames.length; i++) {
    const off = i * FRAME_SIZE;
    view.setFloat32(off, frames[i].x, true);
    view.setFloat32(off + 4, frames[i].y, true);
    // Wrap pa to [-π, π] before encoding — prevents int16 overflow when gondola spins freely airborne
    view.setInt16(off + 8, Math.round(wrapToPi(frames[i].pa) * 10000), true);
    view.setInt16(off + 10, Math.round(((frames[i].wa % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) * 1000), true);
    view.setUint8(off + 12, frames[i].p);
    view.setUint8(off + 13, frames[i].flags);
  }
  return uint8ToBase64(new Uint8Array(buf));
}

export function decodeFrames(b64: string, frameSize: number = FRAME_SIZE): GhostFrame[] {
  const arr = base64ToUint8(b64);
  const view = new DataView(arr.buffer);
  const count = Math.floor(arr.length / frameSize);
  const frames: GhostFrame[] = [];
  for (let i = 0; i < count; i++) {
    const off = i * frameSize;
    frames.push({
      x: view.getFloat32(off, true),
      y: view.getFloat32(off + 4, true),
      pa: view.getInt16(off + 8, true) / 10000,
      wa: view.getInt16(off + 10, true) / 1000,
      p: view.getUint8(off + 12),
      flags: view.getUint8(off + 13),
    });
  }
  return frames;
}

// --- Level hash (FNV-1a 32-bit) --------------------------------------------

export function computeLevelHash(level: EditorLevel): string {
  const data = JSON.stringify({
    segments: level.segments,
    startMarker: level.startMarker,
    endMarker: level.endMarker,
    obstacles: level.obstacles,
    stars: level.stars,
  });
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h ^= data.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

// --- GhostRecorder ---------------------------------------------------------

export interface GhostRecordable {
  getGondolaPos(): { x: number; y: number };
  onRail: boolean;
  airX: number;
  airY: number;
  pendulumAngle: number;
  wheelAngle: number;
  passengers: number;
  shieldTimer: number;
  rocketTimer: number;
}

export class GhostRecorder {
  frames: GhostFrame[] = [];
  private tickCount = 0;

  onTick(engine: GhostRecordable): void {
    if (this.tickCount % SAMPLE_INTERVAL === 0) {
      const pos = engine.getGondolaPos();
      this.frames.push({
        x: pos.x,
        y: pos.y,
        pa: engine.pendulumAngle,
        wa: engine.wheelAngle,
        p: engine.passengers,
        flags:
          (engine.shieldTimer > 0 ? 1 : 0) |
          (engine.rocketTimer > 0 ? 2 : 0) |
          (engine.onRail ? 4 : 0),
      });
    }
    this.tickCount++;
  }

  toReplayData(
    levelId: string,
    levelHash: string,
    name: string,
    time: number,
    starsCollected: number,
  ): ReplayData {
    return {
      version: 1,
      levelId,
      levelHash,
      name,
      time,
      starsCollected,
      date: Date.now(),
      sampleRate: SAMPLE_RATE,
      frameSize: FRAME_SIZE,
      frames: encodeFrames(this.frames),
    };
  }
}

// --- GhostPlayer -----------------------------------------------------------

export class GhostPlayer {
  private frames: GhostFrame[];
  private sampleRate: number;
  /** The completion time this ghost achieved */
  readonly time: number;
  /** Last valid frame (for "ghost finished" indicator) */
  lastFrame: GhostFrame | null = null;
  /** Seconds since ghost finished (for fade-out) */
  finishedAge = 0;

  constructor(replay: ReplayData) {
    this.frames = decodeFrames(replay.frames, replay.frameSize);
    this.sampleRate = replay.sampleRate;
    this.time = replay.time;
  }

  getFrame(elapsedTime: number): GhostFrame | null {
    const idx = elapsedTime * this.sampleRate;
    const i = Math.floor(idx);
    if (i >= this.frames.length - 1) {
      if (this.frames.length > 0) {
        this.lastFrame = this.frames[this.frames.length - 1];
      }
      return null;
    }
    const frac = idx - i;
    const a = this.frames[i];
    const b = this.frames[i + 1];
    // Shortest-path lerp for pa: prevents the ghost cabin from swinging the long way
    // around when pa crosses the ±π boundary between two recorded frames
    let dpa = b.pa - a.pa;
    if (dpa > Math.PI) dpa -= Math.PI * 2;
    if (dpa < -Math.PI) dpa += Math.PI * 2;
    const frame: GhostFrame = {
      x: a.x + (b.x - a.x) * frac,
      y: a.y + (b.y - a.y) * frac,
      pa: a.pa + dpa * frac,
      wa: a.wa + (b.wa - a.wa) * frac,
      p: a.p,
      flags: a.flags,
    };
    this.lastFrame = frame;
    this.finishedAge = 0;
    return frame;
  }
}

// --- localStorage CRUD -----------------------------------------------------

const STORAGE_KEY = "cable-riders-replays";

type ReplayStore = Record<string, ReplayData[]>;

function loadReplayStore(): ReplayStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

function persistStore(store: ReplayStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function saveReplay(replay: ReplayData): void {
  const store = loadReplayStore();
  const list = store[replay.levelId] || [];

  if (replay.name === "Personal Best") {
    const idx = list.findIndex((r) => r.name === "Personal Best");
    if (idx >= 0) {
      // Only overwrite if this run is faster
      if (replay.time < list[idx].time) {
        list[idx] = replay;
      }
    } else {
      list.push(replay);
    }
  } else {
    list.push(replay);
  }

  store[replay.levelId] = list;
  persistStore(store);
}

/**
 * Save an automatically generated replay (PB auto-save or Race Ghost).
 * Always adds as a new entry — never overwrites existing replays.
 * Keeps only the 5 fastest auto-saved entries; user-named replays are untouched.
 */
export function saveAutoReplay(replay: ReplayData): void {
  const store = loadReplayStore();
  const list = store[replay.levelId] || [];

  const entry: ReplayData = { ...replay, auto: true };

  // Split into auto-saved and user-saved
  const autoList = list.filter((r) => r.auto);
  const manualList = list.filter((r) => !r.auto);

  autoList.push(entry);
  // Keep only the 5 fastest auto-saved replays
  autoList.sort((a, b) => a.time - b.time);
  const kept = autoList.slice(0, 5);

  store[replay.levelId] = [...manualList, ...kept];
  persistStore(store);
}

export function getReplaysForLevel(levelId: string): ReplayData[] {
  const store = loadReplayStore();
  return store[levelId] || [];
}

export function getReplay(levelId: string, name?: string): ReplayData | null {
  const list = getReplaysForLevel(levelId);
  if (list.length === 0) return null;
  if (name) return list.find((r) => r.name === name) || null;
  // Default: return Personal Best, or the fastest
  return [...list].sort((a, b) => a.time - b.time)[0];
}

export function deleteReplay(levelId: string, name: string): void {
  const store = loadReplayStore();
  const list = store[levelId] || [];
  store[levelId] = list.filter((r) => r.name !== name);
  if (store[levelId].length === 0) delete store[levelId];
  persistStore(store);
}
