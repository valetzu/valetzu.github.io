import soundConfig from './configs/sound/sounds.json';

function createSfx(file: string, volume: number) {
  const audio = new Audio(soundConfig.basePath + file);
  audio.preload = 'auto';
  audio.volume = volume;
  audio.load();
  let lastPlayed = 0;
  return {
    play() {
      const now = performance.now();
      if (now - lastPlayed < soundConfig.debounceMs) return;
      lastPlayed = now;
      audio.currentTime = 0;
      audio.play().catch(() => {
        // Browser autoplay policy — will play after first user interaction
      });
    },
  };
}

const { sounds } = soundConfig;

const sfx = {
  level_complete:      createSfx(sounds.level_complete.file,      sounds.level_complete.volume),
  level_complete_best: createSfx(sounds.level_complete_best.file, sounds.level_complete_best.volume),
  star_collect:        createSfx(sounds.star_collect.file,        sounds.star_collect.volume),
  hit:                 createSfx(sounds.hit.file,                 sounds.hit.volume),
  laser_fire:          createSfx(sounds.laser_fire.file,          sounds.laser_fire.volume),
  mine_explode:        createSfx(sounds.mine_explode.file,        sounds.mine_explode.volume),
  game_over:           createSfx(sounds.game_over.file,           sounds.game_over.volume),
  beat_ghost:          createSfx(sounds.beat_ghost.file,          sounds.beat_ghost.volume),
};

export const soundManager = {
  playLevelComplete():  void { sfx.level_complete.play(); },
  playNewBest():        void { sfx.level_complete_best.play(); },
  playStarCollect():    void { sfx.star_collect.play(); },
  playHit():            void { sfx.hit.play(); },
  playLaserFire():      void { sfx.laser_fire.play(); },
  playMineExplode():    void { sfx.mine_explode.play(); },
  playGameOver():       void { sfx.game_over.play(); },
  playBeatGhost():      void { sfx.beat_ghost.play(); },
};
