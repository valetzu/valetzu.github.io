import { useState } from "react";
import { loadSettings, updateSetting, GameSettings } from "@/game/settings";
import { musicManager } from "@/game/musicManager";

export type SettingsTab = "sound" | "editor";

interface SettingsMenuProps {
  onClose: () => void;
  initialTab?: SettingsTab;
}

const MAX_SNAP = 250;
const MIN_SNAP = 5;

export default function SettingsMenu({
  onClose,
  initialTab = "sound",
}: SettingsMenuProps) {
  const [settings, setSettings] = useState<GameSettings>(loadSettings);
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  const handleMusicVolume = (vol: number) => {
    const next = updateSetting("musicVolume", vol);
    setSettings(next);
    musicManager.setVolume(vol);
  };

  const handleNickname = (val: string) => {
    const next = updateSetting("nickname", val.slice(0, 20));
    setSettings(next);
  };

  const handleSnapRadius = (val: number) => {
    const clamped = Math.max(MIN_SNAP, Math.min(MAX_SNAP, val));
    const next = updateSetting("snapRadius", clamped);
    setSettings(next);
  };

  const handleDefaultFreeLineToolBehaviour = (
    behaviour: GameSettings["defaultFreeLineToolBehaviour"],
  ) => {
    const next = updateSetting("defaultFreeLineToolBehaviour", behaviour);
    setSettings(next);
  };

  const tabClass = (tab: SettingsTab) =>
    `px-6 py-3 font-bold text-sm transition-colors ${
      activeTab === tab
        ? "text-game-accent border-b-2 border-game-accent"
        : "text-game-subtitle hover:text-game-title"
    }`;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-game-card border-2 border-game-card-border rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-game-card-border">
          <h2 className="text-2xl font-black text-game-title">SETTINGS</h2>
          <button
            onClick={onClose}
            className="text-game-subtitle hover:text-game-title transition-colors text-2xl leading-none"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-game-card-border">
          <button
            onClick={() => setActiveTab("sound")}
            className={tabClass("sound")}
          >
            🔊 Sound
          </button>
          <button
            onClick={() => setActiveTab("editor")}
            className={tabClass("editor")}
          >
            🛤️ Level Editor
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {activeTab === "sound" && (
            <>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="font-bold text-game-title">Nickname</label>
                  <span className="text-game-subtitle text-xs tabular-nums">
                    {settings.nickname.length}/20
                  </span>
                </div>
                <input
                  type="text"
                  maxLength={20}
                  value={settings.nickname}
                  onChange={(e) => handleNickname(e.target.value)}
                  placeholder="Your name on replays…"
                  className="w-full px-3 py-2 rounded-lg bg-game-bar-bg border-2 border-game-card-border text-game-title text-sm focus:border-game-accent outline-none"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="font-bold text-game-title">
                    Music Volume
                  </label>
                  <span className="text-game-subtitle text-sm tabular-nums">
                    {Math.round(settings.musicVolume * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={settings.musicVolume}
                  onChange={(e) =>
                    handleMusicVolume(parseFloat(e.target.value))
                  }
                  className="w-full h-2 rounded-full appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, var(--game-accent) ${settings.musicVolume * 100}%, var(--game-bar-bg) ${settings.musicVolume * 100}%)`,
                  }}
                />
              </div>
            </>
          )}

          {activeTab === "editor" && (
            <>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="font-bold text-game-title">
                    Snap Radius
                  </label>
                  <span className="text-game-subtitle text-sm tabular-nums">
                    {Math.round(settings.snapRadius)} px
                  </span>
                </div>
                <input
                  type="range"
                  min={MIN_SNAP}
                  max={MAX_SNAP}
                  step={1}
                  value={settings.snapRadius}
                  onChange={(e) => handleSnapRadius(parseFloat(e.target.value))}
                  className="w-full h-2 rounded-full appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, var(--game-accent) ${((settings.snapRadius - MIN_SNAP) / (MAX_SNAP - MIN_SNAP)) * 100}%, var(--game-bar-bg) ${((settings.snapRadius - MIN_SNAP) / (MAX_SNAP - MIN_SNAP)) * 100}%)`,
                  }}
                />
                <div className="flex justify-between text-xs text-game-subtitle mt-1">
                  <span>{MIN_SNAP}px</span>
                  <span>{MAX_SNAP}px</span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="font-bold text-game-title">
                    default free line tool behaviour
                  </label>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDefaultFreeLineToolBehaviour("normal")}
                    className={`px-3 py-2 rounded-lg text-sm font-bold transition-all ${
                      settings.defaultFreeLineToolBehaviour === "normal"
                        ? "bg-game-accent text-game-bg"
                        : "bg-game-bar-bg text-game-title hover:brightness-110"
                    }`}
                  >
                    Regular
                  </button>
                  <button
                    onClick={() =>
                      handleDefaultFreeLineToolBehaviour("grid_snap")
                    }
                    className={`px-3 py-2 rounded-lg text-sm font-bold transition-all ${
                      settings.defaultFreeLineToolBehaviour === "grid_snap"
                        ? "bg-game-accent text-game-bg"
                        : "bg-game-bar-bg text-game-title hover:brightness-110"
                    }`}
                  >
                    Grid snap
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-5">
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-game-bar-bg border-2 border-game-card-border text-game-title font-bold hover:brightness-110 active:scale-[0.98] transition-all"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
