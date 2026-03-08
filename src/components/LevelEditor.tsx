import { useState, useRef, useEffect, useCallback } from 'react';
import {
  GRID_SIZE, EDITOR_HEIGHT, EditorTool, TileType,
  EditorLevel, tileKey, parseTileKey,
  saveCustomLevel, loadCustomLevels, deleteCustomLevel,
  convertLevelToGameData,
} from '@/game/editorTypes';
import { Point, Obstacle, WORLD_CONFIG } from '@/game/types';
import { GameEngine } from '@/game/engine';

interface LevelEditorProps {
  onBack: () => void;
}

const TOOLS: { tool: EditorTool; label: string; emoji: string }[] = [
  { tool: 'rail_start', label: 'Start', emoji: '🟢' },
  { tool: 'rail_end', label: 'End', emoji: '🏁' },
  { tool: 'rail', label: 'Rail', emoji: '🛤️' },
  { tool: 'spinner', label: 'Spinner', emoji: '🌀' },
  { tool: 'bouncer', label: 'Bouncer', emoji: '🔴' },
  { tool: 'eraser', label: 'Eraser', emoji: '🧹' },
  { tool: 'arc', label: 'Arc Tool', emoji: '⭕' },
  { tool: 'curve', label: 'Curve', emoji: '〰️' },
];

const TILE_COLORS: Record<TileType, string> = {
  empty: 'transparent',
  rail: '#FFD700',
  rail_start: '#00E676',
  rail_end: '#FF4081',
  spinner: '#FF6B35',
  bouncer: '#E53935',
};

export default function LevelEditor({ onBack }: LevelEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<EditorTool>('rail');
  const [tiles, setTiles] = useState<Record<string, TileType>>({});
  // Track explicit connections between rail tiles: key -> Set of connected keys
  const railConnectionsRef = useRef<Record<string, Set<string>>>({});
  const lastPlacedRailRef = useRef<string | null>(null);

  const addRailConnection = (keyA: string, keyB: string) => {
    const conns = railConnectionsRef.current;
    if (!conns[keyA]) conns[keyA] = new Set();
    if (!conns[keyB]) conns[keyB] = new Set();
    // Only connect if each has fewer than 2 connections
    if (conns[keyA].size < 2 && conns[keyB].size < 2) {
      conns[keyA].add(keyB);
      conns[keyB].add(keyA);
    }
  };

  const removeRailConnections = (key: string) => {
    const conns = railConnectionsRef.current;
    const myConns = conns[key];
    if (myConns) {
      for (const other of myConns) {
        conns[other]?.delete(key);
      }
      delete conns[key];
    }
  };

  const rebuildConnectionsFromTiles = (tilesData: Record<string, TileType>) => {
    const conns: Record<string, Set<string>> = {};
    const isRailLike = (t: TileType | undefined) => t === 'rail' || t === 'rail_start' || t === 'rail_end';
    const keys = Object.keys(tilesData).filter(k => isRailLike(tilesData[k]));
    for (const key of keys) {
      const [gx, gy] = parseTileKey(key);
      // Only connect orthogonal neighbors (simple chain rebuild)
      for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        const nk = tileKey(gx + dx, gy + dy);
        if (isRailLike(tilesData[nk])) {
          if (!conns[key]) conns[key] = new Set();
          if (!conns[nk]) conns[nk] = new Set();
          if (conns[key].size < 2 && conns[nk].size < 2) {
            conns[key].add(nk);
            conns[nk].add(key);
          }
        }
      }
    }
    railConnectionsRef.current = conns;
  };
  const [camera, setCamera] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [isDrawing, setIsDrawing] = useState(false);
  const [levelName, setLevelName] = useState('');
  const [currentLevelName, setCurrentLevelName] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [savedLevels, setSavedLevels] = useState<EditorLevel[]>([]);
  const [testing, setTesting] = useState(false);
  const [showTilesMenu, setShowTilesMenu] = useState(false);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const testCanvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const gameOverRef = useRef(false);
  const lastSavedTilesRef = useRef<string>('{}');

  const hasUnsavedChanges = () => JSON.stringify(tiles) !== lastSavedTilesRef.current;

  // Arc tool state
  const [arcCenter, setArcCenter] = useState<{ gx: number; gy: number } | null>(null);
  const [arcPreview, setArcPreview] = useState<{ gx: number; gy: number }[]>([]);

  // Curve tool state: click start, click end, then drag control point
  const [curveStart, setCurveStart] = useState<{ gx: number; gy: number } | null>(null);
  const [curveEnd, setCurveEnd] = useState<{ gx: number; gy: number } | null>(null);
  const [curveControl, setCurveControl] = useState<{ gx: number; gy: number } | null>(null);
  const [curvePreview, setCurvePreview] = useState<{ gx: number; gy: number }[]>([]);
  const [isDraggingCurve, setIsDraggingCurve] = useState(false);

  const worldHeight = EDITOR_HEIGHT * GRID_SIZE;

  // Draw the editor grid
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const w = canvas.width;
    const h = canvas.height;

    // Clear
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1A1A2E';
    ctx.fillRect(0, 0, w, h);

    // Apply zoom transform
    ctx.setTransform(zoom, 0, 0, zoom, 0, 0);
    const cx = camera.x;
    const cy = camera.y;
    const vw = w / zoom;
    const vh = h / zoom;

    // Grid
    const startGX = Math.floor(cx / GRID_SIZE);
    const startGY = Math.floor(cy / GRID_SIZE);
    const endGX = Math.ceil((cx + vw) / GRID_SIZE);
    const endGY = Math.ceil((cy + vh) / GRID_SIZE);

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let gx = startGX; gx <= endGX; gx++) {
      const sx = gx * GRID_SIZE - cx;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, vh);
      ctx.stroke();
    }
    for (let gy = startGY; gy <= endGY; gy++) {
      const sy = gy * GRID_SIZE - cy;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(vw, sy);
      ctx.stroke();
    }

    // Horizontal reference line (center)
    const refY = (EDITOR_HEIGHT / 2) * GRID_SIZE - cy;
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(0, refY);
    ctx.lineTo(vw, refY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Tiles
    const connections = railConnectionsRef.current;
    for (const [key, type] of Object.entries(tiles)) {
      if (type === 'empty') continue;
      const [gx, gy] = parseTileKey(key);
      const sx = gx * GRID_SIZE - cx;
      const sy = gy * GRID_SIZE - cy;
      if (sx < -GRID_SIZE || sx > vw + GRID_SIZE || sy < -GRID_SIZE || sy > vh + GRID_SIZE) continue;

      if (type === 'rail' || type === 'rail_start' || type === 'rail_end') {
        // Background color
        ctx.fillStyle = type === 'rail_start' ? '#00E676' : type === 'rail_end' ? '#FF4081' : '#FFD700';
        ctx.fillRect(sx + 2, sy + 2, GRID_SIZE - 4, GRID_SIZE - 4);

        // Draw rail connections using explicit connection map
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 4;
        const centerX = sx + GRID_SIZE / 2;
        const centerY = sy + GRID_SIZE / 2;

        const myConnections = connections[key];
        if (myConnections) {
          ctx.beginPath();
          for (const connKey of myConnections) {
            const [cgx, cgy] = parseTileKey(connKey);
            const dx = cgx - gx;
            const dy = cgy - gy;
            const drawX = sx + GRID_SIZE / 2 + dx * (GRID_SIZE / 2);
            const drawY = sy + GRID_SIZE / 2 + dy * (GRID_SIZE / 2);
            ctx.moveTo(drawX, drawY);
            ctx.lineTo(centerX, centerY);
          }
          ctx.stroke();
        }

        // Label for start/end
        if (type === 'rail_start' || type === 'rail_end') {
          ctx.font = `bold ${GRID_SIZE * 0.3}px system-ui`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#000';
          ctx.fillText(type === 'rail_start' ? 'START' : 'END', centerX, centerY);
        } else {
          ctx.fillStyle = '#333';
          ctx.beginPath();
          ctx.arc(centerX, centerY, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (type === 'spinner') {
        ctx.fillStyle = 'rgba(255,107,53,0.3)';
        ctx.fillRect(sx + 2, sy + 2, GRID_SIZE - 4, GRID_SIZE - 4);
        ctx.font = `${GRID_SIZE * 0.6}px system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🌀', sx + GRID_SIZE / 2, sy + GRID_SIZE / 2);
      } else if (type === 'bouncer') {
        ctx.fillStyle = 'rgba(229,57,53,0.3)';
        ctx.fillRect(sx + 2, sy + 2, GRID_SIZE - 4, GRID_SIZE - 4);
        ctx.font = `${GRID_SIZE * 0.6}px system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🔴', sx + GRID_SIZE / 2, sy + GRID_SIZE / 2);
      }
    }

    // Arc preview
    if (arcPreview.length > 0) {
      ctx.fillStyle = 'rgba(255,215,0,0.4)';
      for (const p of arcPreview) {
        const sx = p.gx * GRID_SIZE - cx;
        const sy = p.gy * GRID_SIZE - cy;
        ctx.fillRect(sx + 2, sy + 2, GRID_SIZE - 4, GRID_SIZE - 4);
      }
    }

    // Arc center marker
    if (arcCenter) {
      const acx = arcCenter.gx * GRID_SIZE + GRID_SIZE / 2 - cx;
      const acy = arcCenter.gy * GRID_SIZE + GRID_SIZE / 2 - cy;
      ctx.strokeStyle = '#00FF88';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(acx, acy, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#00FF88';
      ctx.beginPath();
      ctx.arc(acx, acy, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    // Curve preview
    if (curvePreview.length > 0) {
      ctx.fillStyle = 'rgba(100,200,255,0.4)';
      for (const p of curvePreview) {
        const sx2 = p.gx * GRID_SIZE - cx;
        const sy2 = p.gy * GRID_SIZE - cy;
        ctx.fillRect(sx2 + 2, sy2 + 2, GRID_SIZE - 4, GRID_SIZE - 4);
      }
    }

    // Curve start/end markers
    if (curveStart) {
      const csx = curveStart.gx * GRID_SIZE + GRID_SIZE / 2 - cx;
      const csy = curveStart.gy * GRID_SIZE + GRID_SIZE / 2 - cy;
      ctx.strokeStyle = '#64C8FF';
      ctx.lineWidth = 3;
      ctx.strokeRect(curveStart.gx * GRID_SIZE - cx + 1, curveStart.gy * GRID_SIZE - cy + 1, GRID_SIZE - 2, GRID_SIZE - 2);
      ctx.fillStyle = '#64C8FF';
      ctx.font = 'bold 10px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('A', csx, csy);
    }
    if (curveEnd) {
      const cex = curveEnd.gx * GRID_SIZE + GRID_SIZE / 2 - cx;
      const cey = curveEnd.gy * GRID_SIZE + GRID_SIZE / 2 - cy;
      ctx.strokeStyle = '#FF64C8';
      ctx.lineWidth = 3;
      ctx.strokeRect(curveEnd.gx * GRID_SIZE - cx + 1, curveEnd.gy * GRID_SIZE - cy + 1, GRID_SIZE - 2, GRID_SIZE - 2);
      ctx.fillStyle = '#FF64C8';
      ctx.font = 'bold 10px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('B', cex, cey);
    }
    // Curve control point marker
    if (curveControl && curveStart && curveEnd) {
      const ccx = curveControl.gx * GRID_SIZE + GRID_SIZE / 2 - cx;
      const ccy = curveControl.gy * GRID_SIZE + GRID_SIZE / 2 - cy;
      ctx.strokeStyle = '#FFFF00';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(curveStart.gx * GRID_SIZE + GRID_SIZE / 2 - cx, curveStart.gy * GRID_SIZE + GRID_SIZE / 2 - cy);
      ctx.lineTo(ccx, ccy);
      ctx.lineTo(curveEnd.gx * GRID_SIZE + GRID_SIZE / 2 - cx, curveEnd.gy * GRID_SIZE + GRID_SIZE / 2 - cy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(ccx, ccy, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFF00';
      ctx.fill();
    }

    // Reset transform for HUD overlays
    ctx.setTransform(1, 0, 0, 1, 0, 0);


    // Instructions
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, h - 30, w, 30);
    ctx.fillStyle = '#AAA';
    ctx.font = '12px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Middle-click / Right-click drag to pan • +/- to zoom (${Math.round(zoom * 100)}%) • Click to place tiles`, w / 2, h - 15);
  }, [camera, tiles, tool, arcCenter, arcPreview, zoom, curveStart, curveEnd, curveControl, curvePreview]);

  // Resize & render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || testing) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    let frame: number;
    const loop = () => {
      render();
      frame = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(frame);
    };
  }, [render, testing]);

  const screenToGrid = (clientX: number, clientY: number) => {
    const gx = Math.floor((clientX / zoom + camera.x) / GRID_SIZE);
    const gy = Math.floor((clientY / zoom + camera.y) / GRID_SIZE);
    return { gx, gy };
  };

  const generateArc = (centerGX: number, centerGY: number, targetGX: number, targetGY: number) => {
    const dx = targetGX - centerGX;
    const dy = targetGY - centerGY;
    const radius = Math.sqrt(dx * dx + dy * dy);
    if (radius < 1) return [];

    const points: { gx: number; gy: number }[] = [];
    const circumference = Math.round(2 * Math.PI * radius);
    const steps = Math.max(12, circumference * 2);

    for (let i = 0; i <= steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      const gx = Math.round(centerGX + Math.cos(angle) * radius);
      const gy = Math.round(centerGY + Math.sin(angle) * radius);
      // Avoid duplicates
      if (points.length === 0 || points[points.length - 1].gx !== gx || points[points.length - 1].gy !== gy) {
        points.push({ gx, gy });
      }
    }
    return points;
  };

  const generateBezierCurve = (
    start: { gx: number; gy: number },
    end: { gx: number; gy: number },
    control: { gx: number; gy: number }
  ) => {
    // Sample the bezier at high resolution
    const dist = Math.sqrt((end.gx - start.gx) ** 2 + (end.gy - start.gy) ** 2);
    const steps = Math.max(20, Math.round(dist * 6));
    const rawPoints: { gx: number; gy: number }[] = [];

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      const gx = Math.round(mt * mt * start.gx + 2 * mt * t * control.gx + t * t * end.gx);
      const gy = Math.round(mt * mt * start.gy + 2 * mt * t * control.gy + t * t * end.gy);
      if (rawPoints.length === 0 || rawPoints[rawPoints.length - 1].gx !== gx || rawPoints[rawPoints.length - 1].gy !== gy) {
        rawPoints.push({ gx, gy });
      }
    }

    // Walk through raw points using Bresenham between consecutive samples
    // to ensure a single continuous 1-tile-wide path
    const result: { gx: number; gy: number }[] = [];
    const visited = new Set<string>();

    const addPoint = (gx: number, gy: number) => {
      const key = `${gx},${gy}`;
      if (!visited.has(key)) {
        visited.add(key);
        result.push({ gx, gy });
      }
    };

    for (let i = 0; i < rawPoints.length; i++) {
      if (i === 0) {
        addPoint(rawPoints[0].gx, rawPoints[0].gy);
        continue;
      }
      // Bresenham line from previous to current
      let x0 = rawPoints[i - 1].gx, y0 = rawPoints[i - 1].gy;
      const x1 = rawPoints[i].gx, y1 = rawPoints[i].gy;
      const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx - dy;

      while (true) {
        addPoint(x0, y0);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        // Prefer stepping in the dominant direction only (no diagonals)
        if (e2 > -dy && e2 < dx) {
          // Would be diagonal - pick the dominant axis
          if (dx > dy) {
            err -= dy; x0 += sx;
          } else {
            err += dx; y0 += sy;
          }
        } else if (e2 > -dy) {
          err -= dy; x0 += sx;
        } else {
          err += dx; y0 += sy;
        }
      }
    }

    return result;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || e.button === 2) {
      setIsPanning(true);
      setPanStart({ x: e.clientX / zoom + camera.x, y: e.clientY / zoom + camera.y });
      return;
    }

    if (e.button === 0) {
      const { gx, gy } = screenToGrid(e.clientX, e.clientY);

      if (tool === 'arc') {
        if (!arcCenter) {
          setArcCenter({ gx, gy });
        } else {
          const points = generateArc(arcCenter.gx, arcCenter.gy, gx, gy);
          // Add connections between consecutive arc points
          for (let i = 1; i < points.length; i++) {
            addRailConnection(tileKey(points[i - 1].gx, points[i - 1].gy), tileKey(points[i].gx, points[i].gy));
          }
          if (points.length > 0) lastPlacedRailRef.current = tileKey(points[points.length - 1].gx, points[points.length - 1].gy);
          setTiles(prev => {
            const next = { ...prev };
            for (const p of points) {
              next[tileKey(p.gx, p.gy)] = 'rail';
            }
            return next;
          });
          setArcCenter(null);
          setArcPreview([]);
        }
        return;
      }

      if (tool === 'curve') {
        if (!curveStart) {
          setCurveStart({ gx, gy });
        } else if (!curveEnd) {
          setCurveEnd({ gx, gy });
          // Default control point at midpoint
          const mid = { gx: Math.round((curveStart.gx + gx) / 2), gy: Math.round((curveStart.gy + gy) / 2) };
          setCurveControl(mid);
          setCurvePreview(generateBezierCurve(curveStart, { gx, gy }, mid));
        } else {
          // Start dragging control point
          setIsDraggingCurve(true);
          setCurveControl({ gx, gy });
          setCurvePreview(generateBezierCurve(curveStart, curveEnd, { gx, gy }));
        }
        return;
      }

      setIsDrawing(true);
      placeTile(gx, gy);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setCamera({
        x: panStart.x - e.clientX / zoom,
        y: panStart.y - e.clientY / zoom,
      });
      return;
    }

    if (isDrawing) {
      const { gx, gy } = screenToGrid(e.clientX, e.clientY);
      placeTile(gx, gy);
    }

    // Arc preview
    if (tool === 'arc' && arcCenter) {
      const { gx, gy } = screenToGrid(e.clientX, e.clientY);
      setArcPreview(generateArc(arcCenter.gx, arcCenter.gy, gx, gy));
    }

    // Curve control point dragging
    if (tool === 'curve' && curveStart && curveEnd && isDraggingCurve) {
      const { gx, gy } = screenToGrid(e.clientX, e.clientY);
      setCurveControl({ gx, gy });
      setCurvePreview(generateBezierCurve(curveStart, curveEnd, { gx, gy }));
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    setIsDrawing(false);

    // Commit curve on mouse up if dragging control point
    if (isDraggingCurve && curveStart && curveEnd && curveControl) {
      const points = generateBezierCurve(curveStart, curveEnd, curveControl);
      // Add connections between consecutive curve points
      for (let i = 1; i < points.length; i++) {
        addRailConnection(tileKey(points[i - 1].gx, points[i - 1].gy), tileKey(points[i].gx, points[i].gy));
      }
      if (points.length > 0) lastPlacedRailRef.current = tileKey(points[points.length - 1].gx, points[points.length - 1].gy);
      setTiles(prev => {
        const next = { ...prev };
        for (const p of points) {
          next[tileKey(p.gx, p.gy)] = 'rail';
        }
        return next;
      });
      setCurveStart(null);
      setCurveEnd(null);
      setCurveControl(null);
      setCurvePreview([]);
      setIsDraggingCurve(false);
    }
  };

  const placeTile = (gx: number, gy: number) => {
    const key = tileKey(gx, gy);
    if (tool === 'eraser') {
      removeRailConnections(key);
      if (lastPlacedRailRef.current === key) lastPlacedRailRef.current = null;
      setTiles(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } else if (tool === 'rail' || tool === 'spinner' || tool === 'bouncer') {
      const isRail = tool === 'rail';
      if (isRail) {
        // Connect to last placed rail if adjacent
        const last = lastPlacedRailRef.current;
        if (last && last !== key) {
          const [lx, ly] = parseTileKey(last);
          const dx = Math.abs(gx - lx);
          const dy = Math.abs(gy - ly);
          if (dx <= 1 && dy <= 1 && (dx + dy > 0)) {
            addRailConnection(last, key);
          }
        }
        lastPlacedRailRef.current = key;
      }
      setTiles(prev => ({ ...prev, [key]: tool as TileType }));
    } else if (tool === 'rail_start' || tool === 'rail_end') {
      setTiles(prev => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(next)) {
          if (v === tool) {
            removeRailConnections(k);
            delete next[k];
          }
        }
        next[key] = tool as TileType;
        return next;
      });
      // Connect to last placed rail if adjacent
      const last = lastPlacedRailRef.current;
      if (last && last !== key) {
        const [lx, ly] = parseTileKey(last);
        const dx = Math.abs(gx - lx);
        const dy = Math.abs(gy - ly);
        if (dx <= 1 && dy <= 1 && (dx + dy > 0)) {
          addRailConnection(last, key);
        }
      }
      lastPlacedRailRef.current = key;
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => e.preventDefault();

  // Test the level
  const startTest = () => {
    const { railPoints, obstacles: obsData } = convertLevelToGameData(tiles);
    if (railPoints.length < 3) {
      alert('Place at least 3 rail tiles to test!');
      return;
    }
    setTesting(true);
    gameOverRef.current = false;
  };

  // Test mode rendering
  useEffect(() => {
    if (!testing) return;
    const canvas = testCanvasRef.current;
    if (!canvas) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    // Convert tiles to engine-compatible format (already resampled at RAIL_SPACING)
    const { railPoints, obstacles: obsData } = convertLevelToGameData(tiles);

    // Create a custom engine with pre-built rail
    const engine = new GameEngine(canvas, 'overworld', { motor: 0, health: 0, grip: 0, rocket: 0, shield: 0 }, {
      onGameOver: () => { gameOverRef.current = true; },
    });

    // Override the rail with our resampled one (already in world coordinates)
    engine.rail = railPoints;
    engine.ground = engine.rail.map(p => p.y + 150);
    engine.obstacles = [];

    // Add obstacles - convert grid coords to world coords matching the resampled rail
    for (const obs of obsData) {
      const wx = obs.gx * GRID_SIZE;
      const wy = obs.gy * GRID_SIZE;
      // Find closest rail x to determine the correct world-x in the resampled space
      // Since resampled rail maps linearly from editor x, we can use the same x offset
      const minRailX = railPoints.length > 0 ? railPoints[0].x : 0;
      const maxRailX = railPoints.length > 0 ? railPoints[railPoints.length - 1].x : 0;
      // Scale obstacle x relative to rail range
      const obsWorldX = Math.max(minRailX, Math.min(maxRailX, wx));
      
      if (obs.type === 'spinner') {
        engine.obstacles.push({
          type: 'spinner',
          x: obsWorldX, y: wy,
          radius: 12, angle: 0,
          rotSpeed: -0.5,
          baseY: 0, amplitude: 0, bounceSpeed: 0,
          armLength: 120, hit: false,
        });
      } else {
        engine.obstacles.push({
          type: 'bouncer',
          x: obsWorldX, y: wy,
          radius: 18, angle: 0,
          rotSpeed: 0,
          baseY: wy - 20, amplitude: 80,
          bounceSpeed: 0.7,
          armLength: 0, hit: false,
        });
      }
    }

    // Prevent auto-generation of more rail
    engine.generateRail = () => {};
    engine.spawnObstacles = () => {};
    engine.pos = 0;
    engineRef.current = engine;
    engine.start();

    const handleKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        engine.stop();
        setTesting(false);
      }
      if (e.code === 'Enter' && gameOverRef.current) {
        engine.stop();
        setTesting(false);
      }
    };
    window.addEventListener('keydown', handleKey);

    return () => {
      engine.stop();
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', handleKey);
    };
  }, [testing, tiles]);

  // Save dialog
  const handleSave = () => {
    if (!levelName.trim()) return;
    const existing = loadCustomLevels().find(l => l.name === levelName.trim());
    if (existing && !confirm(`A level named "${levelName.trim()}" already exists. Overwrite it?`)) return;
    const level: EditorLevel = {
      name: levelName.trim(),
      tiles,
      createdAt: Date.now(),
    };
    saveCustomLevel(level);
    lastSavedTilesRef.current = JSON.stringify(tiles);
    setCurrentLevelName(levelName.trim());
    setShowSaveDialog(false);
    setLevelName('');
  };

  const handleQuickSave = () => {
    if (!currentLevelName) {
      setShowSaveDialog(true);
      return;
    }
    const level: EditorLevel = {
      name: currentLevelName,
      tiles,
      createdAt: Date.now(),
    };
    saveCustomLevel(level);
    lastSavedTilesRef.current = JSON.stringify(tiles);
  };

  const handleLoad = (level: EditorLevel) => {
    setTiles(level.tiles);
    lastSavedTilesRef.current = JSON.stringify(level.tiles);
    setCurrentLevelName(level.name);
    setShowLoadDialog(false);
    // Rebuild connections from adjacency for loaded levels
    rebuildConnectionsFromTiles(level.tiles);
    lastPlacedRailRef.current = null;
  };

  const handleDelete = (name: string) => {
    if (!confirm(`Delete level "${name}"? This cannot be undone.`)) return;
    deleteCustomLevel(name);
    setSavedLevels(loadCustomLevels());
  };

  const openLoadDialog = () => {
    if (hasUnsavedChanges() && !confirm('You have unsaved changes. Load a different level?')) return;
    setSavedLevels(loadCustomLevels());
    setShowLoadDialog(true);
  };

  const handleBack = () => {
    if (hasUnsavedChanges() && !confirm('You have unsaved changes. Leave the editor?')) return;
    onBack();
  };

  const clearAll = () => {
    if (Object.keys(tiles).length > 0 && !confirm('Clear all tiles?')) return;
    setTiles({});
    railConnectionsRef.current = {};
    lastPlacedRailRef.current = null;
    setArcCenter(null);
    setArcPreview([]);
  };

  if (testing) {
    return (
      <div className="fixed inset-0">
        <canvas ref={testCanvasRef} className="w-full h-full" />
        <div className="fixed top-4 right-4 z-10">
          <button
            onClick={() => {
              engineRef.current?.stop();
              setTesting(false);
            }}
            className="px-4 py-2 rounded-lg bg-game-accent text-game-bg font-bold hover:brightness-110"
          >
            ✕ Back to Editor
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 overflow-hidden" onContextMenu={handleContextMenu}>
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />

      {/* Top bar */}
      <div className="fixed top-4 left-4 right-4 flex items-start justify-between z-10">
        {/* Left: Tiles menu + Eraser + Arc */}
        <div className="flex gap-2 items-start">
          {/* Tiles dropdown */}
          <div className="relative">
            <button
              onClick={() => { setShowTilesMenu(!showTilesMenu); setShowFileMenu(false); }}
              className="px-3 py-2 rounded-lg font-bold text-sm bg-game-card text-game-title border border-game-card-border hover:border-game-accent"
            >
              {(() => {
                const activeTile = TOOLS.find(t => t.tool === tool && ['rail', 'rail_start', 'rail_end', 'spinner', 'bouncer'].includes(t.tool));
                return activeTile ? `${activeTile.emoji} ${activeTile.label}` : '🧱 Tiles';
              })()} ▾
            </button>
            {showTilesMenu && (
              <div className="absolute top-full left-0 mt-1 bg-game-card border border-game-card-border rounded-lg p-1 min-w-[140px] shadow-lg">
                {TOOLS.filter(t => ['rail', 'rail_start', 'rail_end', 'spinner', 'bouncer'].includes(t.tool)).map(t => (
                  <button
                    key={t.tool}
                    onClick={() => {
                      setTool(t.tool);
                      if (t.tool !== 'arc') { setArcCenter(null); setArcPreview([]); }
                      if (t.tool !== 'curve') { setCurveStart(null); setCurveEnd(null); setCurveControl(null); setCurvePreview([]); setIsDraggingCurve(false); }
                      setShowTilesMenu(false);
                    }}
                    className={`w-full text-left px-3 py-2 rounded font-bold text-sm transition-all ${
                      tool === t.tool
                        ? 'bg-game-accent text-game-bg'
                        : 'text-game-title hover:bg-game-bar-bg'
                    }`}
                  >
                    {t.emoji} {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Standalone tools */}
          {TOOLS.filter(t => ['eraser', 'arc', 'curve'].includes(t.tool)).map(t => (
            <button
              key={t.tool}
              onClick={() => {
                setTool(t.tool);
                if (t.tool !== 'arc') { setArcCenter(null); setArcPreview([]); }
                if (t.tool !== 'curve') { setCurveStart(null); setCurveEnd(null); setCurveControl(null); setCurvePreview([]); setIsDraggingCurve(false); }
                setShowTilesMenu(false);
              }}
              className={`px-3 py-2 rounded-lg font-bold text-sm transition-all ${
                tool === t.tool
                  ? 'bg-game-accent text-game-bg scale-105'
                  : 'bg-game-card text-game-title border border-game-card-border hover:border-game-accent'
              }`}
            >
              {t.emoji} {t.label}
            </button>
          ))}
        </div>

        {/* Right: Action buttons */}
        <div className="flex gap-2 items-start">
          <button
            onClick={startTest}
            className="px-4 py-2 rounded-lg bg-green-600 text-white font-bold text-sm hover:bg-green-500"
          >
            ▶ Test
          </button>
          <button
            onClick={handleQuickSave}
            className="px-4 py-2 rounded-lg bg-blue-700 text-white font-bold text-sm hover:bg-blue-600"
            title={currentLevelName ? `Quick save "${currentLevelName}"` : 'Save as...'}
          >
            ⚡ {currentLevelName ? 'Quick Save' : 'Save'}
          </button>

          {/* File dropdown */}
          <div className="relative">
            <button
              onClick={() => { setShowFileMenu(!showFileMenu); setShowTilesMenu(false); }}
              className="px-3 py-2 rounded-lg font-bold text-sm bg-game-card text-game-title border border-game-card-border hover:border-game-accent"
            >
              📁 File ▾
            </button>
            {showFileMenu && (
              <div className="absolute top-full right-0 mt-1 bg-game-card border border-game-card-border rounded-lg p-1 min-w-[140px] shadow-lg">
                <button
                  onClick={() => { setShowSaveDialog(true); setShowFileMenu(false); }}
                  className="w-full text-left px-3 py-2 rounded font-bold text-sm text-game-title hover:bg-game-bar-bg"
                >
                  💾 Save As
                </button>
                <button
                  onClick={() => { openLoadDialog(); setShowFileMenu(false); }}
                  className="w-full text-left px-3 py-2 rounded font-bold text-sm text-game-title hover:bg-game-bar-bg"
                >
                  📂 Load
                </button>
              </div>
            )}
          </div>

          <button
            onClick={clearAll}
            className="px-4 py-2 rounded-lg bg-red-700 text-white font-bold text-sm hover:bg-red-600"
          >
            🗑️ Clear
          </button>
          <button
            onClick={handleBack}
            className="px-4 py-2 rounded-lg bg-game-card text-game-title border border-game-card-border font-bold text-sm hover:border-game-accent"
          >
            ← Menu
          </button>
        </div>
      </div>

      {/* Zoom buttons */}
      <div className="fixed bottom-12 right-4 flex gap-2 z-10">
        <button
          onClick={() => setZoom(z => Math.max(0.25, z - 0.25))}
          className="w-10 h-10 rounded-lg bg-game-card text-game-title border border-game-card-border font-bold text-lg hover:border-game-accent"
        >
          −
        </button>
        <span className="w-14 h-10 rounded-lg bg-game-card text-game-title border border-game-card-border font-bold text-sm flex items-center justify-center">
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={() => setZoom(z => Math.min(3, z + 0.25))}
          className="w-10 h-10 rounded-lg bg-game-card text-game-title border border-game-card-border font-bold text-lg hover:border-game-accent"
        >
          +
        </button>
      </div>

      {/* Save Dialog */}
      {showSaveDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-20">
          <div className="bg-game-card border-2 border-game-card-border rounded-2xl p-6 w-96 max-h-[70vh] flex flex-col">
            <h3 className="text-game-title text-xl font-bold mb-4">Save Level As</h3>
            <input
              type="text"
              value={levelName}
              onChange={e => setLevelName(e.target.value)}
              placeholder="Enter new level name..."
              className="w-full px-3 py-2 rounded-lg bg-game-bg text-game-title border border-game-card-border mb-4 outline-none focus:border-game-accent"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleSave()}
            />
            {/* Existing levels to overwrite */}
            {(() => {
              const existing = loadCustomLevels();
              if (existing.length === 0) return null;
              return (
                <div className="mb-4">
                  <p className="text-game-subtitle text-xs mb-2">Or overwrite an existing level:</p>
                  <div className="max-h-[30vh] overflow-y-auto space-y-1">
                    {existing.map(level => (
                      <button
                        key={level.name}
                        onClick={() => {
                          if (confirm(`Overwrite level "${level.name}"?`)) {
                            const newLevel: EditorLevel = {
                              name: level.name,
                              tiles,
                              createdAt: Date.now(),
                            };
                            saveCustomLevel(newLevel);
                            lastSavedTilesRef.current = JSON.stringify(tiles);
                            setCurrentLevelName(level.name);
                            setShowSaveDialog(false);
                            setLevelName('');
                          }
                        }}
                        className="w-full flex items-center justify-between p-2 rounded-lg bg-game-bg border border-game-card-border hover:border-game-accent text-left"
                      >
                        <div>
                          <div className="text-game-title font-bold text-sm">{level.name}</div>
                          <div className="text-game-subtitle text-xs">
                            {Object.keys(level.tiles).length} tiles • {new Date(level.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                        <span className="text-game-subtitle text-xs">Overwrite</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                className="flex-1 py-2 rounded-lg bg-game-accent text-game-bg font-bold hover:brightness-110"
              >
                Save New
              </button>
              <button
                onClick={() => setShowSaveDialog(false)}
                className="flex-1 py-2 rounded-lg bg-game-bar-bg text-game-subtitle font-bold hover:brightness-110"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Load Dialog */}
      {showLoadDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-20">
          <div className="bg-game-card border-2 border-game-card-border rounded-2xl p-6 w-96 max-h-[70vh] flex flex-col">
            <h3 className="text-game-title text-xl font-bold mb-4">Load Level</h3>
            {savedLevels.length === 0 ? (
              <p className="text-game-subtitle text-center py-8">No saved levels yet</p>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-2">
                {savedLevels.map(level => (
                  <div key={level.name} className="flex items-center justify-between p-3 rounded-lg bg-game-bg border border-game-card-border">
                    <div>
                      <div className="text-game-title font-bold">{level.name}</div>
                      <div className="text-game-subtitle text-xs">
                        {Object.keys(level.tiles).length} tiles • {new Date(level.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleLoad(level)}
                        className="px-3 py-1 rounded bg-game-accent text-game-bg font-bold text-sm hover:brightness-110"
                      >
                        Load
                      </button>
                      <button
                        onClick={() => handleDelete(level.name)}
                        className="px-3 py-1 rounded bg-red-700 text-white font-bold text-sm hover:bg-red-600"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={() => setShowLoadDialog(false)}
              className="mt-4 w-full py-2 rounded-lg bg-game-bar-bg text-game-subtitle font-bold hover:brightness-110"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
