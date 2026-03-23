export interface GameSettings {
  musicVolume: number; // 0–1
  snapRadius: number; // pixels, min 5
}

const SETTINGS_KEY = "game-settings";

const defaults: GameSettings = {
  musicVolume: 0.7,
  snapRadius: 25,
};

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {}
  return { ...defaults };
}

export function saveSettings(settings: GameSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function updateSetting<K extends keyof GameSettings>(
  key: K,
  value: GameSettings[K],
): GameSettings {
  const next = { ...loadSettings(), [key]: value };
  saveSettings(next);
  return next;
}
