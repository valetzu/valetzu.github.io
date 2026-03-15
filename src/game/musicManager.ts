import catalogJson from './configs/music/music_catalog.json';
import endlessConfig from './configs/music/gamemodes/music_endless.json';
import menuConfig from './configs/music/menus/music_main_menu.json';
import type { WorldType } from './types';

export interface MusicTrack {
  file: string;
  label: string;
}

const CATALOG_STORAGE_KEY = 'music-catalog-custom';

// ---------------------------------------------------------------------------
// File discovery — lazy glob so we never actually import binary MP3 data;
// we only need the Object.keys() to learn what files exist at build time.
// ---------------------------------------------------------------------------
const _musicGlob = import.meta.glob(
  '/public/assets/music/*.{mp3,ogg,wav,flac,aac,m4a}',
);

function getDiscoveredFiles(): string[] {
  return Object.keys(_musicGlob).map(p => p.replace('/public/assets/music/', ''));
}

// ---------------------------------------------------------------------------
// Catalog helpers (JSON base + localStorage overrides)
// ---------------------------------------------------------------------------
function loadStoredCatalog(): MusicTrack[] {
  try {
    const raw = localStorage.getItem(CATALOG_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function saveStoredCatalog(entries: MusicTrack[]): void {
  localStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(entries));
}

/** Effective label map: JSON catalog merged with localStorage additions. */
function effectiveLabelMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const e of catalogJson as MusicTrack[]) map.set(e.file, e.label);
  for (const e of loadStoredCatalog()) map.set(e.file, e.label);
  return map;
}

/**
 * All music files discovered in public/assets/music/, labelled from the
 * effective catalog or auto-derived from the filename.
 * Catalog entries are shown first, then remaining discovered files.
 */
export function getAvailableTracks(): MusicTrack[] {
  const labels = effectiveLabelMap();
  const files = getDiscoveredFiles();

  const inCatalog = files.filter(f => labels.has(f));
  const uncatalogued = files.filter(f => !labels.has(f));

  const autoLabel = (file: string) =>
    labels.get(file) ?? file.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');

  return [...inCatalog, ...uncatalogued].map(file => ({
    file,
    label: autoLabel(file),
  }));
}

/**
 * Record a file into the localStorage catalog so it appears with a label
 * next time the dialog opens. No-ops if the file is already in the JSON
 * catalog or was already added to localStorage.
 */
export function addToCatalog(file: string, label?: string): void {
  if ((catalogJson as MusicTrack[]).some(e => e.file === file)) return;
  const stored = loadStoredCatalog();
  if (stored.some(e => e.file === file)) return;
  const autoLabel = label ?? file.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
  stored.push({ file, label: autoLabel });
  saveStoredCatalog(stored);
}

// ---------------------------------------------------------------------------
// MusicManager
// ---------------------------------------------------------------------------
class MusicManager {
  private audio: HTMLAudioElement | null = null;
  private currentSrc: string | null = null;

  private async play(src: string, loop = true): Promise<void> {
    if (this.currentSrc === src) return;
    this.stop();
    this.audio = new Audio(src);
    this.audio.loop = loop;
    this.currentSrc = src;
    try {
      await this.audio.play();
    } catch {
      // Browser autoplay policy — resumes after first user interaction
    }
  }

  stop(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.src = '';
      this.audio = null;
      this.currentSrc = null;
    }
  }

  setVolume(vol: number): void {
    if (this.audio) this.audio.volume = Math.max(0, Math.min(1, vol));
  }

  async playForMenu(): Promise<void> {
    const file = (menuConfig as any).file;
    if (!file) return;
    await this.play(`/assets/music/${file}`);
  }

  async playForWorld(world: WorldType): Promise<void> {
    const file = (endlessConfig as any)[world];
    if (!file) return;
    await this.play(`/assets/music/${file}`);
  }

  async playForLevel(musicFile: string): Promise<void> {
    if (!musicFile) return;
    await this.play(`/assets/music/${musicFile}`);
  }
}

export const musicManager = new MusicManager();
