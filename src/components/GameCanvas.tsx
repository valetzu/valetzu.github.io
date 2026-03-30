import { useEffect, useRef, useCallback, useState } from 'react';
import { GameEngine } from '@/game/engine';
import { WorldType, Upgrades } from '@/game/types';
import { musicManager } from '@/game/musicManager';
import PauseMenu from './PauseMenu';
import MobileControls, { isMobileDevice } from './MobileControls';

interface GameCanvasProps {
  world: WorldType;
  upgrades: Upgrades;
  onGameOver: (distance: number, cash: number) => void;
  onBack: () => void;
}

export default function GameCanvas({ world, upgrades, onGameOver, onBack }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const gameOverRef = useRef(false);
  const [paused, setPaused] = useState(false);
  const isMobile = isMobileDevice();

  const handleGameOver = useCallback((distance: number, cash: number) => {
    gameOverRef.current = true;
    onGameOver(distance, cash);
  }, [onGameOver]);

  const handleResume = useCallback(() => {
    setPaused(false);
    engineRef.current?.resume();
  }, []);

  const handlePause = useCallback(() => {
    if (gameOverRef.current) return;
    setPaused(prev => {
      const next = !prev;
      if (next) engineRef.current?.pause();
      else engineRef.current?.resume();
      return next;
    });
  }, []);

  const handleQuit = useCallback(() => {
    engineRef.current?.stop();
    musicManager.stop();
    onBack();
  }, [onBack]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);

    musicManager.playForWorld(world);

    const engine = new GameEngine(canvas, world, upgrades, {
      onGameOver: handleGameOver,
    });
    engine.isMobile = isMobile;
    engineRef.current = engine;
    engine.start();

    const handleKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' && gameOverRef.current) {
        onBack();
        return;
      }
      if (e.code === 'Escape') {
        if (gameOverRef.current) {
          onBack();
          return;
        }
        setPaused(prev => {
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
    window.addEventListener('keydown', handleKey);

    return () => {
      engine.stop();
      musicManager.stop();
      window.removeEventListener('resize', resize);
      window.removeEventListener('orientationchange', resize);
      window.removeEventListener('keydown', handleKey);
    };
  }, [world, upgrades, handleGameOver, onBack]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="fixed inset-0 w-full h-full"
        style={{ cursor: 'none' }}
      />
      {paused && <PauseMenu onResume={handleResume} onQuit={handleQuit} />}
      {isMobile && !paused && (
        <MobileControls engineRef={engineRef} onPause={handlePause} isEndless />
      )}
    </>
  );
}
