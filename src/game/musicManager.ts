import catalog from './configs/music/music_catalog.json';
import endlessConfig from './configs/music/gamemodes/music_endless.json';
import menuConfig from './configs/music/menus/music_main_menu.json';
import type { WorldType } from './types';

export interface MusicTrack {
  file: string;
  label: string;
}

/** All music files available for selection — sourced from music_catalog.json. */
export const availableTracks: MusicTrack[] = catalog as MusicTrack[];

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
      // Browser autoplay policy — will resume after first user interaction
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

  /** Play a custom level's music by its stored filename. */
  async playForLevel(musicFile: string): Promise<void> {
    if (!musicFile) return;
    await this.play(`/assets/music/${musicFile}`);
  }
}

export const musicManager = new MusicManager();
