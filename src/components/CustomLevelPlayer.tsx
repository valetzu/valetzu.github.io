import { useEffect, useRef, useState, useCallback } from "react";
import { GameEngine } from "@/game/engine";
import {
  EditorLevel,
  convertLevelToGameDataV3,
  GRID_SIZE,
  SKY_THEMES,
} from "@/game/editorTypes";
import {
  recordTime,
  getRecords,
  formatTime,
  LevelRecord,
} from "@/game/types";
import { musicManager } from "@/game/musicManager";
import { obstacleDefMap } from "@/game/obstacleDefinitions";
import {
  GhostRecorder,
  GhostPlayer,
  computeLevelHash,
  saveReplay,
  getReplay,
  getReplaysForLevel,
} from "@/game/replay";
import PauseMenu from "./PauseMenu";

interface CustomLevelPlayerProps {
  level: EditorLevel;
  raceGhost: boolean;
  onBack: () => void;
}

export default function CustomLevelPlayer({
  level,
  raceGhost,
  onBack,
}: CustomLevelPlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const ghostRecorderRef = useRef<GhostRecorder | null>(null);
  const gameOverRef = useRef(false);
  const [paused, setPaused] = useState(false);
  const [levelComplete, setLevelComplete] = useState<{
    time: number;
    records: LevelRecord[];
    isNewBest: boolean;
    starsCollected: number;
  } | null>(null);

  const levelId = level.id || level.name;

  const startEngine = useCallback(
    (canvas: HTMLCanvasElement, withGhost: boolean) => {
      const {
        railPoints,
        allSegments,
        obstacles: obsData,
        stars: starData,
        endTileWorldPos,
        isLoop,
      } = convertLevelToGameDataV3(level);

      if (railPoints.length < 3) return;

      const engine = new GameEngine(
        canvas,
        "overworld",
        { motor: 0, health: 0, grip: 0, rocket: 0, shield: 0 },
        {
          onGameOver: () => {
            gameOverRef.current = true;
          },
          onLevelComplete: (time: number, starsCollected: number) => {
            const result = recordTime(levelId, time, starsCollected);
            setLevelComplete({
              time,
              records: result.records,
              isNewBest: result.isNewBest,
              starsCollected,
            });
          },
        },
      );

      engine.rail = railPoints;
      engine.allRailSegments = allSegments;
      engine.buildSegmentBounds();
      (engine as any).hasFinitePath = true;
      (engine as any).isLoop = isLoop;
      (engine as any).startTilePos =
        railPoints.length > 0 ? railPoints[0] : null;
      (engine as any).endTilePos = endTileWorldPos;
      engine.ground = engine.rail.map((p) => p.y + 150);
      engine.noBackground = true;
      const theme = SKY_THEMES[level.skyTheme ?? 'day'];
      engine.skyOverride = { skyTop: theme.skyTop, skyBottom: theme.skyBottom };
      if (level.bgTiles) {
        engine.bgTiles = level.bgTiles;
        engine.bgTileSize = GRID_SIZE;
      }
      engine.obstacles = [];

      let nextObsId = 1;
      for (const obs of obsData) {
        const obsWorldX = (obs.gx + 0.5) * GRID_SIZE;
        const obsWorldY = (obs.gy + 0.5) * GRID_SIZE;
        const def = obstacleDefMap.get(obs.tileType);
        if (!def) continue;
        const gameObs = def.toGameObstacle(
          `editor_obs_${nextObsId++}`,
          obsWorldX,
          obsWorldY,
          obs.params as any,
        );
        if (gameObs) engine.obstacles.push(gameObs);
      }

      engine.collectibleStars = starData.map((s) => ({
        x: s.worldX,
        y: s.worldY,
        collected: false,
      }));
      engine.starsCollected = 0;

      engine.generateRail = () => {};
      engine.spawnObstacles = () => {};
      engine.hasFinitePath = true;
      engine.pos = 0;
      engine.initDirection();

      // Personal best time
      const records = getRecords(levelId);
      if (records.length > 0) {
        engine.personalBestTime = records[0].time;
      }

      // Ghost recording
      const recorder = new GhostRecorder();
      engine.ghostRecorder = recorder;
      ghostRecorderRef.current = recorder;

      // Ghost playback
      if (withGhost) {
        const replay = getReplay(levelId);
        if (replay) {
          engine.ghostPlayer = new GhostPlayer(replay);
          engine.ghostTime = replay.time;
        }
      }

      engineRef.current = engine;

      if (level.musicFile) {
        musicManager.playForLevel(level.musicFile);
      }

      engine.start();
    },
    [level, levelId],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    startEngine(canvas, raceGhost);

    const handleKey = (e: KeyboardEvent) => {
      if (e.code === "Enter" && gameOverRef.current) {
        engineRef.current?.stop();
        musicManager.stop();
        onBack();
        return;
      }
      if (e.code === "Escape") {
        if (gameOverRef.current || levelComplete) {
          engineRef.current?.stop();
          musicManager.stop();
          onBack();
          return;
        }
        setPaused((prev) => {
          const next = !prev;
          if (next) {
            engineRef.current?.pause();
          } else {
            engineRef.current?.resume();
          }
          return next;
        });
      }
    };
    window.addEventListener("keydown", handleKey);

    return () => {
      engineRef.current?.stop();
      musicManager.stop();
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", handleKey);
    };
  }, [raceGhost, startEngine, onBack]);

  const handleReplay = (withGhost: boolean) => {
    engineRef.current?.stop();
    setLevelComplete(null);
    gameOverRef.current = false;
    const canvas = canvasRef.current;
    if (canvas) {
      startEngine(canvas, withGhost);
    }
  };

  const handleSaveGhost = (name: string) => {
    const recorder = ghostRecorderRef.current;
    if (!recorder || recorder.frames.length === 0 || !levelComplete) return;
    const hash = computeLevelHash(level);
    const replay = recorder.toReplayData(
      levelId,
      hash,
      name,
      levelComplete.time,
      levelComplete.starsCollected,
    );
    saveReplay(replay);
  };

  return (
    <>
      <canvas
        ref={canvasRef}
        className="fixed inset-0 w-full h-full"
        style={{ cursor: "none" }}
      />

      {paused && (
        <PauseMenu
          levelName={level.name}
          onResume={() => {
            setPaused(false);
            engineRef.current?.resume();
          }}
          onRestart={() => {
            engineRef.current?.stop();
            setPaused(false);
            setLevelComplete(null);
            gameOverRef.current = false;
            const canvas = canvasRef.current;
            if (canvas) startEngine(canvas, raceGhost);
          }}
          onQuit={() => {
            engineRef.current?.stop();
            musicManager.stop();
            onBack();
          }}
        />
      )}

      {levelComplete && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-20">
          <div className="bg-game-card border-2 border-game-accent rounded-2xl p-8 w-96 text-center">
            <h2 className="text-4xl font-bold text-game-accent mb-2">
              {levelComplete.isNewBest ? "🏆 New Best!" : "🎉 Level Complete!"}
            </h2>
            <p className="text-game-subtitle text-lg mb-4">{level.name}</p>

            <div className="flex justify-center gap-2 mb-3">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className={`text-3xl ${i < levelComplete.starsCollected ? "opacity-100" : "opacity-25"}`}
                >
                  ⭐
                </span>
              ))}
            </div>
            <p className="text-game-subtitle text-sm mb-4">
              {levelComplete.starsCollected}/3 Stars
            </p>

            <div className="bg-game-bg rounded-xl p-4 mb-4">
              <p className="text-game-subtitle text-sm">Completion Time</p>
              <p className="text-game-title text-3xl font-bold">
                {formatTime(levelComplete.time)}
              </p>
              {levelComplete.records.length > 0 &&
                levelComplete.records[0].time < levelComplete.time && (
                  <p className="text-game-subtitle text-sm mt-1">
                    Best: {formatTime(levelComplete.records[0].time)}
                  </p>
                )}
            </div>

            {levelComplete.records.length > 1 && (
              <div className="bg-game-bg rounded-xl p-3 mb-4 text-left">
                <p className="text-game-subtitle text-xs mb-2 text-center font-bold">
                  Top Times
                </p>
                {levelComplete.records.map((r, i) => (
                  <div
                    key={i}
                    className={`flex justify-between text-sm py-0.5 ${
                      r.time === levelComplete.time &&
                      r.date ===
                        Math.max(
                          ...levelComplete.records
                            .filter((x) => x.time === levelComplete.time)
                            .map((x) => x.date),
                        )
                        ? "text-game-accent font-bold"
                        : "text-game-subtitle"
                    }`}
                  >
                    <span>#{i + 1}</span>
                    <span>{formatTime(r.time)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Ghost buttons */}
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => {
                  handleSaveGhost("Personal Best");
                  alert("Ghost saved as Personal Best!");
                }}
                className="flex-1 py-2 rounded-lg bg-purple-600 text-white font-bold text-sm hover:bg-purple-500"
              >
                👻 Save Ghost
              </button>
              <button
                onClick={() => {
                  const name = prompt("Name this ghost replay:");
                  if (!name) return;
                  handleSaveGhost(name);
                  alert(`Ghost saved as "${name}"!`);
                }}
                className="flex-1 py-2 rounded-lg bg-purple-800 text-white font-bold text-sm hover:bg-purple-700"
              >
                💾 Save As...
              </button>
            </div>

            {/* Action buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => handleReplay(false)}
                className="flex-1 py-3 rounded-lg bg-green-600 text-white font-bold text-lg hover:bg-green-500"
              >
                🔄 Replay
              </button>
              {getReplaysForLevel(levelId).length > 0 && (
                <button
                  onClick={() => handleReplay(true)}
                  className="flex-1 py-3 rounded-lg bg-blue-600 text-white font-bold text-lg hover:bg-blue-500"
                >
                  👻 Race Ghost
                </button>
              )}
              <button
                onClick={() => {
                  engineRef.current?.stop();
                  musicManager.stop();
                  onBack();
                }}
                className="flex-1 py-3 rounded-lg bg-game-accent text-game-bg font-bold text-lg hover:brightness-110"
              >
                ← Menu
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
