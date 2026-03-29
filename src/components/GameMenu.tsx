import { useState } from 'react';
import {
  WorldType, SaveData, Upgrades, WORLD_CONFIG,
  UPGRADE_COSTS, UPGRADE_MAX, UPGRADE_LABELS, UPGRADE_DESC,
  saveSave, getRecords, formatTime,
} from '@/game/types';
import { loadCustomLevels, loadAdventureLevels, deleteCustomLevel, type EditorLevel } from '@/game/editorTypes';
import { getReplaysForLevel, getReplay, type ReplayData } from '@/game/replay';
import GhostReplayDialog from './GhostReplayDialog';

interface GameMenuProps {
  save: SaveData;
  onStartGame: (world: WorldType) => void;
  onUpdateSave: (save: SaveData) => void;
  onOpenEditor: (level?: EditorLevel) => void;
  onOpenSettings: () => void;
  onPlayCustomLevel?: (level: EditorLevel, ghostReplay: ReplayData | null) => void;
}

type MenuView = 'main' | 'shop' | 'playSelect' | 'play' | 'adventure' | 'experimental' | 'endless' | 'editorSelect';

export default function GameMenu({ save, onStartGame, onUpdateSave, onOpenEditor, onOpenSettings, onPlayCustomLevel }: GameMenuProps) {
  const [view, setView] = useState<MenuView>('main');
  const [leaderboardLevelId, setLeaderboardLevelId] = useState<string | null>(null);
  const [ghostListLevelId, setGhostListLevelId] = useState<string | null>(null);
  const [levelListVersion, setLevelListVersion] = useState(0);

  const buyUpgrade = (key: keyof Upgrades) => {
    const level = save.upgrades[key];
    const costs = UPGRADE_COSTS[key];
    if (level >= UPGRADE_MAX[key]) return;
    const cost = costs[level];
    if (save.cash < cost) return;

    const newSave = {
      ...save,
      cash: save.cash - cost,
      upgrades: { ...save.upgrades, [key]: level + 1 },
    };
    saveSave(newSave);
    onUpdateSave(newSave);
  };

  if (view === 'shop') {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-game-bg overflow-y-auto">
        <div className="w-full max-w-lg p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-3xl font-black text-game-title">UPGRADES</h2>
            <div className="text-xl font-bold text-game-cash">💰 ${save.cash}</div>
          </div>

          <div className="space-y-3">
            {(Object.keys(UPGRADE_COSTS) as (keyof Upgrades)[]).map((key) => {
              const level = save.upgrades[key];
              const maxLvl = UPGRADE_MAX[key];
              const isMaxed = level >= maxLvl;
              const cost = isMaxed ? 0 : UPGRADE_COSTS[key][level];
              const canBuy = !isMaxed && save.cash >= cost;

              return (
                <div
                  key={key}
                  className="flex items-center justify-between p-4 rounded-xl bg-game-card border-2 border-game-card-border"
                >
                  <div className="flex-1">
                    <div className="font-bold text-game-title text-lg">{UPGRADE_LABELS[key]}</div>
                    <div className="text-sm text-game-subtitle">{UPGRADE_DESC[key]}</div>
                    <div className="flex gap-1 mt-1">
                      {Array.from({ length: maxLvl }).map((_, i) => (
                        <div
                          key={i}
                          className={`w-5 h-2 rounded-full ${i < level ? 'bg-game-accent' : 'bg-game-bar-bg'}`}
                        />
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => buyUpgrade(key)}
                    disabled={!canBuy}
                    className={`ml-4 px-4 py-2 rounded-lg font-bold text-sm transition-all ${
                      isMaxed
                        ? 'bg-game-bar-bg text-game-subtitle cursor-default'
                        : canBuy
                        ? 'bg-game-accent text-game-bg hover:brightness-110 active:scale-95'
                        : 'bg-game-bar-bg text-game-subtitle cursor-not-allowed'
                    }`}
                  >
                    {isMaxed ? 'MAX' : `$${cost}`}
                  </button>
                </div>
              );
            })}
          </div>

          <button
            onClick={() => setView('endless')}
            className="mt-6 w-full py-3 rounded-xl bg-game-card border-2 border-game-card-border text-game-title font-bold text-lg hover:brightness-110 active:scale-[0.98] transition-all"
          >
            ← Back
          </button>
        </div>
      </div>
    );
  }

  if (view === 'playSelect') {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-game-bg overflow-y-auto">
        <h2 className="text-3xl font-black text-game-title mb-8">PLAY</h2>

        <div className="flex flex-col gap-4 w-full max-w-md mb-6">
          <button
            onClick={() => setView('adventure')}
            className="py-5 rounded-xl bg-green-700 text-white font-bold text-xl hover:bg-green-600 active:scale-[0.98] transition-all"
          >
            🗺️ Adventure
          </button>
          <button
            onClick={() => setView('play')}
            className="py-5 rounded-xl bg-game-card border-2 border-game-card-border text-game-title font-bold text-xl hover:border-game-accent active:scale-[0.98] transition-all"
          >
            🎮 Custom Levels
          </button>
        </div>

        <button
          onClick={() => setView('main')}
          className="w-full max-w-md py-3 rounded-xl bg-game-card border-2 border-game-card-border text-game-title font-bold text-lg hover:brightness-110 active:scale-[0.98] transition-all"
        >
          ← Back
        </button>
      </div>
    );
  }

  if (view === 'adventure') {
    const levels = loadAdventureLevels();

    return (
      <div className="fixed inset-0 flex items-center justify-center bg-game-bg overflow-y-auto">
        <div className="w-full max-w-lg p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-3xl font-black text-game-title">ADVENTURE</h2>
          </div>

          {levels.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-game-subtitle text-lg">No levels yet</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto overscroll-contain pr-1">
              {levels.map((level) => {
                const levelId = level.id || level.name;
                const records = getRecords(levelId);
                const replays = getReplaysForLevel(levelId);
                const bestTime = records.length > 0 ? records[0].time : null;

                return (
                  <div
                    key={levelId}
                    className="p-4 rounded-xl bg-game-card border-2 border-game-card-border"
                  >
                    <div className="mb-3">
                      <div className="font-bold text-game-title text-lg">{level.name}</div>
                      {bestTime !== null && (
                        <div className="text-sm text-game-cash">
                          🏆 Best: {formatTime(bestTime)}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => onPlayCustomLevel?.(level, null)}
                        className="flex-1 py-2 rounded-lg bg-green-600 text-white font-bold text-sm hover:bg-green-500 active:scale-95 transition-all"
                      >
                        ▶ Play
                      </button>
                      {replays.length > 0 && (
                        <button
                          onClick={() => onPlayCustomLevel?.(level, getReplay(levelId))}
                          className="flex-1 py-2 rounded-lg bg-blue-600 text-white font-bold text-sm hover:bg-blue-500 active:scale-95 transition-all"
                        >
                          👻 Race Ghost
                        </button>
                      )}
                      {records.length > 0 && (
                        <button
                          onClick={() => {
                            const next = leaderboardLevelId === levelId ? null : levelId;
                            setLeaderboardLevelId(next);
                            if (next) setGhostListLevelId(null);
                          }}
                          className="py-2 px-3 rounded-lg bg-game-bar-bg text-game-title font-bold text-sm border-2 border-game-card-border hover:border-game-accent active:scale-95 transition-all"
                        >
                          📊
                        </button>
                      )}
                      {replays.length > 0 && (
                        <button
                          onClick={() => {
                            const next = ghostListLevelId === levelId ? null : levelId;
                            setGhostListLevelId(next);
                            if (next) setLeaderboardLevelId(null);
                          }}
                          className="py-2 px-3 rounded-lg bg-game-bar-bg text-game-title font-bold text-sm border-2 border-game-card-border hover:border-game-accent active:scale-95 transition-all"
                        >
                          👻
                        </button>
                      )}
                    </div>
                    {leaderboardLevelId === levelId && records.length > 0 && (
                      <div className="mt-3 bg-game-bg rounded-xl p-3">
                        <p className="text-game-subtitle text-xs mb-2 text-center font-bold">
                          Top Times
                        </p>
                        {records.map((r, i) => {
                          const matchReplay = replays.find(rep => Math.abs(rep.time - r.time) < 0.001);
                          return (
                            <div
                              key={i}
                              className="flex items-center justify-between text-sm py-1 text-game-subtitle"
                            >
                              <span className="w-8">#{i + 1}</span>
                              <span className="flex-1">{formatTime(r.time)}</span>
                              {matchReplay && (
                                <button
                                  onClick={() => onPlayCustomLevel?.(level, matchReplay)}
                                  className="text-xs px-2 py-0.5 rounded-md bg-blue-700 text-white hover:bg-blue-500 active:scale-95 transition-all"
                                >
                                  👻 Race
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {ghostListLevelId === levelId && replays.length > 0 && (
                      <GhostReplayDialog
                        levelId={levelId}
                        replays={replays}
                        onRace={(r) => { setGhostListLevelId(null); onPlayCustomLevel?.(level, r); }}
                        onClose={() => setGhostListLevelId(null)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <button
            onClick={() => { setView('playSelect'); setLeaderboardLevelId(null); setGhostListLevelId(null); }}
            className="mt-6 w-full py-3 rounded-xl bg-game-card border-2 border-game-card-border text-game-title font-bold text-lg hover:brightness-110 active:scale-[0.98] transition-all"
          >
            ← Back
          </button>
        </div>
      </div>
    );
  }

  if (view === 'play') {
    const levels = loadCustomLevels().sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));

    return (
      <div className="fixed inset-0 flex items-center justify-center bg-game-bg overflow-y-auto">
        <div className="w-full max-w-lg p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-3xl font-black text-game-title">CUSTOM LEVELS</h2>
          </div>

          {levels.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-game-subtitle text-lg mb-2">No custom levels yet</p>
              <p className="text-game-subtitle text-sm">Create levels in the Editor!</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto overscroll-contain pr-1">
              {levels.map((level) => {
                const levelId = level.id || level.name;
                const records = getRecords(levelId);
                const replays = getReplaysForLevel(levelId);
                const bestTime = records.length > 0 ? records[0].time : null;

                return (
                  <div
                    key={levelId}
                    className="p-4 rounded-xl bg-game-card border-2 border-game-card-border"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <div className="font-bold text-game-title text-lg">{level.name}</div>
                        {bestTime !== null && (
                          <div className="text-sm text-game-cash">
                            🏆 Best: {formatTime(bestTime)}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => {
                          if (window.confirm(`Delete level "${level.name}"?`)) {
                            deleteCustomLevel(level.name);
                            setLevelListVersion(v => v + 1);
                          }
                        }}
                        className="text-xs px-1.5 py-0.5 rounded-md bg-red-900 text-white hover:bg-red-600 active:scale-95 transition-all"
                        title="Delete level"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => onPlayCustomLevel?.(level, null)}
                        className="flex-1 py-2 rounded-lg bg-green-600 text-white font-bold text-sm hover:bg-green-500 active:scale-95 transition-all"
                      >
                        ▶ Play
                      </button>
                      {replays.length > 0 && (
                        <button
                          onClick={() => onPlayCustomLevel?.(level, getReplay(levelId))}
                          className="flex-1 py-2 rounded-lg bg-blue-600 text-white font-bold text-sm hover:bg-blue-500 active:scale-95 transition-all"
                        >
                          👻 Race Ghost
                        </button>
                      )}
                      {records.length > 0 && (
                        <button
                          onClick={() => {
                            const next = leaderboardLevelId === levelId ? null : levelId;
                            setLeaderboardLevelId(next);
                            if (next) setGhostListLevelId(null);
                          }}
                          className="py-2 px-3 rounded-lg bg-game-bar-bg text-game-title font-bold text-sm border-2 border-game-card-border hover:border-game-accent active:scale-95 transition-all"
                        >
                          📊
                        </button>
                      )}
                      {replays.length > 0 && (
                        <button
                          onClick={() => {
                            const next = ghostListLevelId === levelId ? null : levelId;
                            setGhostListLevelId(next);
                            if (next) setLeaderboardLevelId(null);
                          }}
                          className="py-2 px-3 rounded-lg bg-game-bar-bg text-game-title font-bold text-sm border-2 border-game-card-border hover:border-game-accent active:scale-95 transition-all"
                        >
                          👻
                        </button>
                      )}
                    </div>
                    {leaderboardLevelId === levelId && records.length > 0 && (
                      <div className="mt-3 bg-game-bg rounded-xl p-3">
                        <p className="text-game-subtitle text-xs mb-2 text-center font-bold">
                          Top Times
                        </p>
                        {records.map((r, i) => {
                          const matchReplay = replays.find(rep => Math.abs(rep.time - r.time) < 0.001);
                          return (
                            <div
                              key={i}
                              className="flex items-center justify-between text-sm py-1 text-game-subtitle"
                            >
                              <span className="w-8">#{i + 1}</span>
                              <span className="flex-1">{formatTime(r.time)}</span>
                              {matchReplay && (
                                <button
                                  onClick={() => onPlayCustomLevel?.(level, matchReplay)}
                                  className="text-xs px-2 py-0.5 rounded-md bg-blue-700 text-white hover:bg-blue-500 active:scale-95 transition-all"
                                >
                                  👻 Race
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {ghostListLevelId === levelId && replays.length > 0 && (
                      <GhostReplayDialog
                        levelId={levelId}
                        replays={replays}
                        onRace={(r) => { setGhostListLevelId(null); onPlayCustomLevel?.(level, r); }}
                        onClose={() => setGhostListLevelId(null)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <button
            onClick={() => { setView('playSelect'); setLeaderboardLevelId(null); setGhostListLevelId(null); }}
            className="mt-6 w-full py-3 rounded-xl bg-game-card border-2 border-game-card-border text-game-title font-bold text-lg hover:brightness-110 active:scale-[0.98] transition-all"
          >
            ← Back
          </button>
        </div>
      </div>
    );
  }

  if (view === 'experimental') {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-game-bg overflow-y-auto">
        <h2 className="text-3xl font-black text-game-title mb-2">EXPERIMENTAL</h2>
        <p className="text-game-subtitle text-sm mb-8">Work in progress features</p>

        <div className="flex flex-col gap-3 w-full max-w-md mb-6">
          <button
            onClick={() => setView('endless')}
            className="py-4 rounded-xl bg-game-card border-2 border-game-card-border text-game-title font-bold text-xl hover:border-game-accent active:scale-[0.98] transition-all"
          >
            ♾️ Endless Mode
          </button>
        </div>

        <button
          onClick={() => setView('main')}
          className="w-full max-w-md py-3 rounded-xl bg-game-card border-2 border-game-card-border text-game-title font-bold text-lg hover:brightness-110 active:scale-[0.98] transition-all"
        >
          ← Back
        </button>
      </div>
    );
  }

  if (view === 'endless') {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-game-bg overflow-y-auto">
        <h2 className="text-3xl font-black text-game-title mb-2">ENDLESS MODE</h2>
        <p className="text-game-subtitle text-sm mb-8">Procedural worlds — ride as far as you can</p>

        <div className="grid grid-cols-3 gap-4 mb-6 w-full max-w-md">
          {(Object.keys(WORLD_CONFIG) as WorldType[]).map((w) => {
            const cfg = WORLD_CONFIG[w];
            const record = save.records[w];
            return (
              <button
                key={w}
                onClick={() => onStartGame(w)}
                className="flex flex-col items-center p-5 rounded-2xl bg-game-card border-2 border-game-card-border hover:border-game-accent hover:scale-105 active:scale-95 transition-all"
              >
                <span className="text-4xl mb-2">{cfg.emoji}</span>
                <span className="font-bold text-game-title">{cfg.name}</span>
                {record > 0 && (
                  <span className="text-xs text-game-cash mt-1">🏆 {Math.floor(record)}m</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex gap-3 w-full max-w-md mb-6">
          <button
            onClick={() => setView('shop')}
            className="flex-1 py-4 rounded-xl bg-game-accent text-game-bg font-bold text-xl hover:brightness-110 active:scale-[0.98] transition-all"
          >
            🔧 Upgrades
          </button>
        </div>

        <button
          onClick={() => setView('experimental')}
          className="w-full max-w-md py-3 rounded-xl bg-game-card border-2 border-game-card-border text-game-title font-bold text-lg hover:brightness-110 active:scale-[0.98] transition-all"
        >
          ← Back
        </button>
      </div>
    );
  }

  if (view === 'editorSelect') {
    const levels = loadCustomLevels().sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-game-bg overflow-y-auto">
        <div className="w-full max-w-lg p-6">
          <h2 className="text-3xl font-black text-game-title mb-6">EDITOR</h2>

          <button
            onClick={() => onOpenEditor()}
            className="w-full py-4 rounded-xl bg-game-accent text-game-bg font-bold text-xl hover:brightness-110 active:scale-[0.98] transition-all mb-4"
          >
            + Create New Level
          </button>

          {levels.length > 0 && (
            <div className="space-y-2 max-h-[50vh] overflow-y-auto overscroll-contain pr-1 mb-4">
              {levels.map((level) => (
                <div key={`${levelListVersion}-${level.id}`} className="flex items-center gap-2">
                  <button
                    onClick={() => onOpenEditor(level)}
                    className="flex-1 text-left px-4 py-3 rounded-xl bg-game-card border-2 border-game-card-border hover:border-game-accent active:scale-[0.99] transition-all"
                  >
                    <div className="font-bold text-game-title">{level.name}</div>
                    <div className="text-xs text-game-subtitle mt-0.5">
                      {new Date(level.updatedAt ?? level.createdAt).toLocaleString()}
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`Delete level "${level.name}"?`)) {
                        deleteCustomLevel(level.name);
                        setLevelListVersion(v => v + 1);
                      }
                    }}
                    className="shrink-0 text-xs px-1.5 py-0.5 rounded-md bg-red-900 text-white hover:bg-red-600 active:scale-95 transition-all"
                    title="Delete level"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => setView('main')}
            className="w-full py-3 rounded-xl bg-game-card border-2 border-game-card-border text-game-title font-bold text-lg hover:brightness-110 active:scale-[0.98] transition-all"
          >
            ← Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-game-bg overflow-y-auto">
      <h1 className="text-6xl font-black text-game-title mb-2 tracking-tight drop-shadow-lg">
        🚡 Doggorail
      </h1>
     {/*  <p className="text-game-subtitle text-lg mb-8">
        What the dog doin'
      </p> */}

      <div className="text-xl font-bold text-game-cash mb-6">💰 ${save.cash}</div>

      <div className="flex gap-3 w-full max-w-md mb-3">
        <button
          onClick={() => setView('playSelect')}
          className="flex-1 py-4 rounded-xl bg-green-600 text-white font-bold text-xl hover:bg-green-500 active:scale-[0.98] transition-all"
        >
          ▶ Play
        </button>
      </div>

      <div className="flex gap-3 w-full max-w-md mb-3">
        <button
          onClick={() => setView('editorSelect')}
          className="flex-1 py-4 rounded-xl bg-game-bar-bg text-game-title font-bold text-xl border-2 border-game-card-border hover:border-game-accent active:scale-[0.98] transition-all"
        >
          🗺️ Editor
        </button>
        <button
          onClick={onOpenSettings}
          className="py-4 px-5 rounded-xl bg-game-bar-bg text-game-title font-bold text-xl border-2 border-game-card-border hover:border-game-accent active:scale-[0.98] transition-all"
          title="Settings"
        >
          ⚙
        </button>
      </div>

      <div className="flex gap-3 w-full max-w-md">
        <button
          onClick={() => setView('experimental')}
          className="flex-1 py-3 rounded-xl bg-game-bar-bg text-game-subtitle font-bold text-base border-2 border-game-card-border hover:border-game-accent active:scale-[0.98] transition-all"
        >
          🧪 Experimental
        </button>
      </div>

      <div className="mt-8 text-game-subtitle text-sm text-center space-y-1">
        <p>⬆️ Arrow Up = Throttle &nbsp; ⬇️ Arrow Down = Brake/Reverse</p>
        <p>⬅️ Arrow Left = Tilt Cabin Left&nbsp; ➡️ Arrow Right = Tilt Cabin Right</p>
          <p>Space = Switch Throttle Direction</p>
        {/* <p>🚀 SPACE = Rocket Boost &nbsp; 🛡️ SHIFT = Shield</p> */}
      </div>
    </div>
  );
}
