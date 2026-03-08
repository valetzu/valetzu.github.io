import { useState, useCallback } from 'react';
import { WorldType, SaveData, loadSave, saveSave } from '@/game/types';
import GameCanvas from '@/components/GameCanvas';
import GameMenu from '@/components/GameMenu';

type Phase = 'menu' | 'playing';

const Index = () => {
  const [phase, setPhase] = useState<Phase>('menu');
  const [save, setSave] = useState<SaveData>(loadSave);
  const [world, setWorld] = useState<WorldType>('overworld');

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

  return <GameMenu save={save} onStartGame={startGame} onUpdateSave={setSave} />;
};

export default Index;
