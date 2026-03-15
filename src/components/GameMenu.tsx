import { useState } from 'react';
import {
  WorldType, SaveData, Upgrades, WORLD_CONFIG,
  UPGRADE_COSTS, UPGRADE_MAX, UPGRADE_LABELS, UPGRADE_DESC,
  saveSave,
} from '@/game/types';

interface GameMenuProps {
  save: SaveData;
  onStartGame: (world: WorldType) => void;
  onUpdateSave: (save: SaveData) => void;
  onOpenEditor: () => void;
  onOpenSettings: () => void;
}

type MenuView = 'main' | 'shop';

export default function GameMenu({ save, onStartGame, onUpdateSave, onOpenEditor, onOpenSettings }: GameMenuProps) {
  const [view, setView] = useState<MenuView>('main');

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
      <div className="fixed inset-0 flex items-center justify-center bg-game-bg">
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
            onClick={() => setView('main')}
            className="mt-6 w-full py-3 rounded-xl bg-game-card border-2 border-game-card-border text-game-title font-bold text-lg hover:brightness-110 active:scale-[0.98] transition-all"
          >
            ← Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-game-bg">
      <h1 className="text-6xl font-black text-game-title mb-2 tracking-tight drop-shadow-lg">
        🚡 CABLE RIDERS
      </h1>
      <p className="text-game-subtitle text-lg mb-8">
        Ride the rails. Dodge obstacles. Go far!
      </p>

      <div className="text-xl font-bold text-game-cash mb-6">💰 ${save.cash}</div>

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

      <div className="flex gap-3 w-full max-w-md">
        <button
          onClick={() => setView('shop')}
          className="flex-1 py-4 rounded-xl bg-game-accent text-game-bg font-bold text-xl hover:brightness-110 active:scale-[0.98] transition-all"
        >
          🔧 Upgrades
        </button>
        <button
          onClick={onOpenEditor}
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

      <div className="mt-8 text-game-subtitle text-sm text-center space-y-1">
        <p>⬆️ Arrow Up = Throttle &nbsp; ⬇️ Arrow Down = Brake/Reverse</p>
        <p>🚀 SPACE = Rocket Boost &nbsp; 🛡️ SHIFT = Shield</p>
      </div>
    </div>
  );
}
