import { useState, useCallback, useEffect } from 'react';
import { WorldType, SaveData, loadSave, saveSave } from '@/game/types';
import { musicManager } from '@/game/musicManager';
import GameCanvas from '@/components/GameCanvas';
import GameMenu from '@/components/GameMenu';
import LevelEditor from '@/components/LevelEditor';
import CustomLevelPlayer from '@/components/CustomLevelPlayer';
import SettingsMenu from '@/components/SettingsMenu';
import type { EditorLevel } from '@/game/editorTypes';
import type { ReplayData } from '@/game/replay';

type Phase = 'menu' | 'playing' | 'editor' | 'customPlay';

const Index = () => {
  const [phase, setPhase] = useState<Phase>('menu');
  const [save, setSave] = useState<SaveData>(loadSave);
  const [world, setWorld] = useState<WorldType>('overworld');
  const [showSettings, setShowSettings] = useState(false);
  const [customLevel, setCustomLevel] = useState<EditorLevel | null>(null);
  const [editLevel, setEditLevel] = useState<EditorLevel | null>(null);
  const [raceGhost, setRaceGhost] = useState<ReplayData | null>(null);
  const [levelPlayList, setLevelPlayList] = useState<EditorLevel[]>([]);
  const [levelPlayIndex, setLevelPlayIndex] = useState(0);
  const [isAdventurePlay, setIsAdventurePlay] = useState(false);

  const startGame = useCallback((w: WorldType) => {
    setWorld(w);
    setPhase('playing');
  }, []);

  const handleGameOver = useCallback((distance: number, cash: number) => {
    setSave((prev) => {
      const newSave: SaveData = {
        ...prev,
        cash: prev.cash + cash,
        records: {
          ...prev.records,
          [world]: Math.max(prev.records[world], distance),
        },
      };
      saveSave(newSave);
      return newSave;
    });
  }, [world]);

  const backToMenu = useCallback(() => {
    setPhase('menu');
  }, []);

  useEffect(() => {
    if (phase === 'menu') {
      musicManager.playForMenu();
    }
  }, [phase]);

  if (phase === 'playing') {
    return (
      <GameCanvas
        world={world}
        upgrades={save.upgrades}
        onGameOver={handleGameOver}
        onBack={backToMenu}
      />
    );
  }

  if (phase === 'editor') {
    return <LevelEditor onBack={backToMenu} initialLevel={editLevel ?? undefined} />;
  }

  if (phase === 'customPlay' && customLevel) {
    const hasNext = isAdventurePlay
      ? levelPlayIndex < levelPlayList.length - 1
      : levelPlayList.length > 1;
    const onNextLevel = hasNext ? () => {
      const nextIndex = isAdventurePlay
        ? levelPlayIndex + 1
        : (levelPlayIndex + 1) % levelPlayList.length;
      setLevelPlayIndex(nextIndex);
      setCustomLevel(levelPlayList[nextIndex]);
      setRaceGhost(null);
    } : null;
    return (
      <CustomLevelPlayer
        key={`${customLevel.id}-${levelPlayIndex}`}
        level={customLevel}
        ghostReplay={raceGhost}
        onBack={backToMenu}
        onNextLevel={onNextLevel}
      />
    );
  }

  return (
    <>
      <GameMenu
        save={save}
        onStartGame={startGame}
        onUpdateSave={setSave}
        onOpenEditor={(level) => { setEditLevel(level ?? null); setPhase('editor'); }}
        onOpenSettings={() => setShowSettings(true)}
        onPlayCustomLevel={(level, ghostReplay, levelList, levelIndex, isAdventure) => {
          setCustomLevel(level);
          setRaceGhost(ghostReplay);
          setLevelPlayList(levelList ?? []);
          setLevelPlayIndex(levelIndex ?? 0);
          setIsAdventurePlay(isAdventure ?? false);
          setPhase('customPlay');
        }}
      />
      {showSettings && <SettingsMenu onClose={() => setShowSettings(false)} />}
    </>
  );
};

export default Index;
