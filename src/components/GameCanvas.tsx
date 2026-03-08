import { useEffect, useRef, useCallback } from 'react';
import { GameEngine } from '@/game/engine';
import { WorldType, Upgrades } from '@/game/types';

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

  const handleGameOver = useCallback((distance: number, cash: number) => {
    gameOverRef.current = true;
    onGameOver(distance, cash);
  }, [onGameOver]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const engine = new GameEngine(canvas, world, upgrades, {
      onGameOver: handleGameOver,
    });
    engineRef.current = engine;
    engine.start();

    const handleEnter = (e: KeyboardEvent) => {
      if (e.code === 'Enter' && gameOverRef.current) {
        onBack();
      }
      if (e.code === 'Escape') {
        onBack();
      }
    };
    window.addEventListener('keydown', handleEnter);

    return () => {
      engine.stop();
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', handleEnter);
    };
  }, [world, upgrades, handleGameOver, onBack]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full"
      style={{ cursor: 'none' }}
    />
  );
}
