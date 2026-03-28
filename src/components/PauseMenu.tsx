import { useState } from 'react';
import SettingsMenu from './SettingsMenu';

interface PauseMenuProps {
  levelName?: string;
  onResume: () => void;
  onRestart?: () => void;
  onQuit: () => void;
}

export default function PauseMenu({ levelName, onResume, onRestart, onQuit }: PauseMenuProps) {
  const [showSettings, setShowSettings] = useState(false);

  if (showSettings) {
    return <SettingsMenu onClose={() => setShowSettings(false)} />;
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center z-40 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-xs bg-game-card border-2 border-game-card-border rounded-2xl shadow-2xl p-6 flex flex-col gap-3">
        <h2 className="text-3xl font-black text-game-title text-center mb-1">PAUSED</h2>
        {levelName && (
          <p className="text-game-subtitle text-sm text-center mb-1">{levelName}</p>
        )}

        <button
          onClick={onResume}
          className="w-full py-3 rounded-xl bg-game-accent text-game-bg font-bold text-lg hover:brightness-110 active:scale-[0.98] transition-all"
        >
          ▶ Resume
        </button>

        {onRestart && (
          <button
            onClick={onRestart}
            className="w-full py-3 rounded-xl bg-game-bar-bg border-2 border-game-card-border text-game-title font-bold text-lg hover:brightness-110 active:scale-[0.98] transition-all"
          >
            ↺ Restart
          </button>
        )}

        <button
          onClick={() => setShowSettings(true)}
          className="w-full py-3 rounded-xl bg-game-bar-bg border-2 border-game-card-border text-game-title font-bold text-lg hover:brightness-110 active:scale-[0.98] transition-all"
        >
          ⚙ Settings
        </button>

        <button
          onClick={onQuit}
          className="w-full py-3 rounded-xl bg-game-bar-bg border-2 border-game-card-border text-game-title font-bold text-lg hover:brightness-110 active:scale-[0.98] transition-all"
        >
          ✕ Quit to Menu
        </button>
      </div>
    </div>
  );
}
