function playSfx(path: string): void {
  const audio = new Audio(path);
  audio.volume = 1.0;
  audio.play().catch(() => {
    // Browser autoplay policy — will play after first user interaction
  });
}

export const soundManager = {
  playLevelComplete(): void {
    playSfx('/assets/sound/level_complete.mp3');
  },
  playNewBest(): void {
    playSfx('/assets/sound/level_complete_best.mp3');
  },
  playStarCollect(): void {
    playSfx('/assets/sound/star_collect.mp3');
  },
  playHit(): void {
    playSfx('/assets/sound/hit.mp3');
  },
};
