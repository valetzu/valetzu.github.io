import customLevelsConfig from './configs/music/music_customLevels.json';
import endlessConfig from './configs/music/gamemodes/music_endless.json';
import menuConfig from './configs/music/menus/music_main_menu.json';
import type { WorldType } from './types';

export interface MusicTrack {
  file: string;
  label: string;
}

class MusicManager {
  private audio: HTMLAudioElement | null = null;
  private currentSrc: string | null = null;

  /** Returns the list of tracks available for custom level selection (from config). */
  get availableTracks(): MusicTrack[] {
    return (customLevelsConfig as any).available ?? [];
  }

  private async play(src: string, loop = true): Promise<void> {
    if (this.currentSrc === src) return;
    this.stop();
    this.audio = new Audio(src);
    this.audio.loop = loop;
    this.currentSrc = src;
    try {
      await this.audio.play();
    } catch {
      // Browser autoplay policy — will play after first user interaction
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
    await this.play(`/assets/music/menus/${file}`);
  }

  async playForWorld(world: WorldType): Promise<void> {
    const file = (endlessConfig as any)[world];
    if (!file) return;
    await this.play(`/assets/music/gamemodes/endless/${world}/${file}`);
  }

  /**
   * Play music for a custom level.
   * @param levelId  The level's unique id (used to build the folder path).
   * @param musicFile  Filename stored on the level (e.g. "track.mp3").
   *                   Falls back to music_customLevels.json config if not provided.
   */
  async playForLevel(levelId: string, musicFile?: string): Promise<void> {
    const file = musicFile || ((customLevelsConfig as any).levels ?? {})[levelId];
    if (!file) return;
    await this.play(`/assets/music/customLevels/${levelId}/${file}`);
  }
}

export const musicManager = new MusicManager();
