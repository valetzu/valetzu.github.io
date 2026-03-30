import { useEffect, useRef, useState } from 'react';
import { GameEngine } from '@/game/engine';
import { loadSettings } from '@/game/settings';

interface MobileControlsProps {
  engineRef: React.RefObject<GameEngine | null>;
  onPause: () => void;
  isEndless: boolean;
}

/** Returns true if the device likely has a touch screen (mobile/tablet). */
export function isMobileDevice(): boolean {
  return (
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    window.matchMedia('(pointer: coarse)').matches
  );
}

function useIsLandscape() {
  const [landscape, setLandscape] = useState(
    () => window.matchMedia('(orientation: landscape)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape)');
    const handler = (e: MediaQueryListEvent) => setLandscape(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return landscape;
}

/** Read the screen-relative left/right tilt from a DeviceOrientationEvent. */
function getScreenTilt(e: DeviceOrientationEvent): number {
  const angle = screen.orientation?.angle ?? 0;
  if (Math.abs(angle) === 90) {
    // Landscape: beta becomes the left/right axis; sign depends on rotation direction
    return (e.beta ?? 0) * (angle > 0 ? -1 : 1);
  }
  // Portrait: gamma is left/right (-90..+90)
  return e.gamma ?? 0;
}

interface HoldButtonProps {
  label: string;
  onStart: () => void;
  onEnd: () => void;
  className?: string;
}

function HoldButton({ label, onStart, onEnd, className = '' }: HoldButtonProps) {
  return (
    <button
      className={`select-none touch-none flex items-center justify-center rounded-full bg-white/20 active:bg-white/40 border border-white/40 text-white font-bold text-2xl ${className}`}
      style={{ WebkitUserSelect: 'none', userSelect: 'none' }}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); onStart(); }}
      onPointerUp={onEnd}
      onPointerCancel={onEnd}
      onPointerLeave={onEnd}
    >
      {label}
    </button>
  );
}

function TapButton({ label, onClick, className = '' }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button
      className={`select-none touch-none flex items-center justify-center rounded-full text-white text-xs font-bold ${className}`}
      style={{ WebkitUserSelect: 'none', userSelect: 'none' }}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); onClick(); }}
    >
      {label}
    </button>
  );
}

// ----- Gyro mode -----

function useGyroTilt(engineRef: React.RefObject<GameEngine | null>, enabled: boolean) {
  const calibrationRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      if (engineRef.current) engineRef.current.analogTiltInput = 0;
      return;
    }

    calibrationRef.current = null; // recalibrate on (re)enable

    const handler = (e: DeviceOrientationEvent) => {
      const raw = getScreenTilt(e);
      // Auto-calibrate on first reading
      if (calibrationRef.current === null) calibrationRef.current = raw;
      const relative = raw - calibrationRef.current;
      // 30° of tilt = full torque; clamp to ±1; negated so tilt direction matches expectation
      const input = Math.max(-1, Math.min(1, -(relative / 30)));
      if (engineRef.current) engineRef.current.analogTiltInput = input;
    };

    window.addEventListener('deviceorientation', handler);
    const recalibrateHandler = () => { calibrationRef.current = null; };
    window.addEventListener('gyro-recalibrate', recalibrateHandler as EventListener);
    return () => {
      window.removeEventListener('deviceorientation', handler);
      window.removeEventListener('gyro-recalibrate', recalibrateHandler as EventListener);
      if (engineRef.current) engineRef.current.analogTiltInput = 0;
    };
  }, [enabled, engineRef]);

  const recalibrate = () => { calibrationRef.current = null; };
  return { recalibrate };
}

// ----- Main component -----

export default function MobileControls({ engineRef, onPause, isEndless }: MobileControlsProps) {
  const held = useRef({ up: 0, down: 0, left: 0, right: 0 });
  const [reversing, setReversing] = useState(false);
  const [throttling, setThrottling] = useState(false);
  const isLandscape = useIsLandscape();
  const gyroControls = loadSettings().gyroControls;
  const { recalibrate } = useGyroTilt(engineRef, gyroControls);

  useEffect(() => {
    return () => {
      const eng = engineRef.current;
      if (!eng) return;
      eng.keys.up = false;
      eng.keys.down = false;
      eng.keys.left = false;
      eng.keys.right = false;
    };
  }, [engineRef]);

  const press = (key: 'up' | 'down' | 'left' | 'right') => () => {
    held.current[key]++;
    if (engineRef.current) engineRef.current.keys[key] = true;
  };

  const release = (key: 'up' | 'down' | 'left' | 'right') => () => {
    held.current[key] = Math.max(0, held.current[key] - 1);
    if (held.current[key] === 0 && engineRef.current) {
      engineRef.current.keys[key] = false;
    }
  };

  const safeBottom = 'max(1.5rem, env(safe-area-inset-bottom))';
  const safeLeft   = 'max(0.5rem, env(safe-area-inset-left))';
  const safeRight  = 'max(0.5rem, env(safe-area-inset-right))';

  const tiltSize     = isLandscape ? 'w-16 h-20' : 'w-20 h-24';
  const throttleSize = isLandscape ? 'w-14 h-14' : 'w-16 h-16';
  const actionSize   = isLandscape ? 'w-10 h-10' : 'w-12 h-12';
  const flipSize     = isLandscape ? 'w-20 h-20' : 'w-24 h-24';

  // Shared pause button used by both layouts
  const pauseBtn = (
    <button
      className="pointer-events-auto absolute top-4 w-11 h-11 rounded-full bg-white/20 border border-white/40 text-white text-base flex items-center justify-center select-none"
      style={{ WebkitUserSelect: 'none', userSelect: 'none', right: safeRight }}
      onPointerDown={(e) => { e.stopPropagation(); onPause(); }}
    >
      ⏸
    </button>
  );

  // ---- Gyro mode ----
  if (gyroControls) {
    return (
      <div className="fixed inset-0 pointer-events-none z-50" style={{ touchAction: 'none' }}>
        {/* Left half — reverse (invisible, full half acts as button) */}
        <button
          className="pointer-events-auto select-none touch-none absolute top-0 bottom-0 left-0 w-1/2 rounded-none bg-transparent border-none"
          style={{ WebkitUserSelect: 'none', userSelect: 'none' }}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); press('down')(); setReversing(true); }}
          onPointerUp={() => { release('down')(); setReversing(false); }}
          onPointerCancel={() => { release('down')(); setReversing(false); }}
          onPointerLeave={() => { release('down')(); setReversing(false); }}
        />
        {/* Right half — throttle forward (invisible, full half acts as button) */}
        <button
          className="pointer-events-auto select-none touch-none absolute top-0 bottom-0 right-0 w-1/2 rounded-none bg-transparent border-none"
          style={{ WebkitUserSelect: 'none', userSelect: 'none' }}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); press('up')(); setThrottling(true); }}
          onPointerUp={() => { release('up')(); setThrottling(false); }}
          onPointerCancel={() => { release('up')(); setThrottling(false); }}
          onPointerLeave={() => { release('up')(); setThrottling(false); }}
        />

        {/* Reverse pedal indicator — bottom-left corner */}
        <div
          className={`pointer-events-none absolute left-4 flex items-center justify-center rounded-2xl border-2 text-2xl font-bold transition-colors duration-75 ${reversing ? 'bg-red-500/60 border-red-300 text-white' : 'bg-white/10 border-white/20 text-white/40'}`}
          style={{ bottom: safeBottom, width: 56, height: 68 }}
        >
          ▼
        </div>

        {/* Throttle pedal indicator — bottom-right corner */}
        <div
          className={`pointer-events-none absolute right-4 flex items-center justify-center rounded-2xl border-2 text-2xl font-bold transition-colors duration-75 ${throttling ? 'bg-green-500/60 border-green-300 text-white' : 'bg-white/10 border-white/20 text-white/40'}`}
          style={{ bottom: safeBottom, width: 56, height: 68 }}
        >
          ▲
        </div>

        {/* Pause */}
        {pauseBtn}

        {/* FLIP button — bottom center, twice as big */}
        <div
          className="pointer-events-auto absolute left-1/2 -translate-x-1/2"
          style={{ bottom: safeBottom }}
        >
          <button
            className={`select-none touch-none flex items-center justify-center rounded-full text-white text-base font-bold ${flipSize} bg-white/20 active:bg-white/40 border border-white/40`}
            style={{ WebkitUserSelect: 'none', userSelect: 'none' }}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); engineRef.current?.flipDirection(); }}
          >
            FLIP
          </button>
        </div>
      </div>
    );
  }

  // ---- Button mode ----
  return (
    <div className="fixed inset-0 pointer-events-none z-50" style={{ touchAction: 'none' }}>
      {pauseBtn}

      {/* Tilt LEFT — left side, vertically centered */}
      <div
        className="pointer-events-auto absolute top-1/2 -translate-y-1/2"
        style={{ left: safeLeft }}
      >
        <HoldButton label="◄" onStart={press('left')} onEnd={release('left')} className={tiltSize} />
      </div>

      {/* Tilt RIGHT — right side, vertically centered */}
      <div
        className="pointer-events-auto absolute top-1/2 -translate-y-1/2"
        style={{ right: safeRight }}
      >
        <HoldButton label="►" onStart={press('right')} onEnd={release('right')} className={tiltSize} />
      </div>

      {/* Reverse — bottom-left corner */}
      <div
        className="pointer-events-auto absolute"
        style={{ left: safeLeft, bottom: safeBottom }}
      >
        <HoldButton label="▼" onStart={press('down')} onEnd={release('down')} className={throttleSize} />
      </div>

      {/* Throttle — bottom-right corner */}
      <div
        className="pointer-events-auto absolute"
        style={{ right: safeRight, bottom: safeBottom }}
      >
        <HoldButton label="▲" onStart={press('up')} onEnd={release('up')} className={throttleSize} />
      </div>

      {/* FLIP + optional endless actions — bottom center */}
      <div
        className="pointer-events-auto absolute left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
        style={{ bottom: safeBottom }}
      >
        {isEndless && (
          <div className="flex gap-2">
            <TapButton
              label="🚀"
              onClick={() => engineRef.current?.activateRocket()}
              className={`${actionSize} bg-orange-400/50 active:bg-orange-400/80 border border-orange-300/60`}
            />
            <TapButton
              label="🛡️"
              onClick={() => engineRef.current?.activateShield()}
              className={`${actionSize} bg-blue-400/50 active:bg-blue-400/80 border border-blue-300/60`}
            />
          </div>
        )}
        <button
          className={`select-none touch-none flex items-center justify-center rounded-full text-white text-base font-bold ${flipSize} bg-white/20 active:bg-white/40 border border-white/40`}
          style={{ WebkitUserSelect: 'none', userSelect: 'none' }}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); engineRef.current?.flipDirection(); }}
        >
          FLIP
        </button>
      </div>
    </div>
  );
}
