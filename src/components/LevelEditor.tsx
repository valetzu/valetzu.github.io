import { useState, useRef, useEffect, useCallback } from 'react';
import {
  GRID_SIZE, EDITOR_HEIGHT, EditorTool, TileType,
  EditorLevel, tileKey, parseTileKey,
  saveCustomLevel, loadCustomLevels, deleteCustomLevel,
  convertLevelToGameData,
  SmoothSegment, sampleCircularArcWorld, sampleBezierWorld, keyToWorld,
  FreeLineSegment, sampleLineWorld,
  generateLevelId,
} from '@/game/editorTypes';
import { musicManager, getAvailableTracks, addToCatalog } from '@/game/musicManager';
import { Point, Obstacle, WORLD_CONFIG } from '@/game/types';
import { GameEngine } from '@/game/engine';
import { OBSTACLE_DEFINITIONS, obstacleDefMap, resolveParams, ObstacleParams, drawReach, ParamFieldMeta } from '@/game/obstacleDefinitions';

interface LevelEditorProps {
  onBack: () => void;
}

const OBSTACLE_TOOLS = OBSTACLE_DEFINITIONS.map(d => ({
  tool: d.tileType as EditorTool,
  label: d.label,
  emoji: d.emoji,
}));

const TOOLS: { tool: EditorTool; label: string; emoji: string }[] = [
  { tool: 'rail_start', label: 'Start', emoji: '🟢' },
  { tool: 'rail_end', label: 'End', emoji: '🏁' },
  { tool: 'rail', label: 'Rail', emoji: '🛤️' },
  ...OBSTACLE_TOOLS,
  { tool: 'eraser', label: 'Eraser', emoji: '🧹' },
  { tool: 'arc', label: 'Arc Tool', emoji: '🔄' },
  { tool: 'curve', label: 'Curve', emoji: '〰️' },
  { tool: 'circular_curve', label: 'Circular Curve', emoji: '🟠' },
  { tool: 'circle', label: 'Circle', emoji: '⭕' },
  { tool: 'line', label: 'Line', emoji: '📏' },
  { tool: 'line2', label: 'Free Line', emoji: '📐' },
];

const TILE_TOOL_TYPES = new Set<EditorTool>(['rail', 'rail_start', 'rail_end', ...OBSTACLE_DEFINITIONS.map(d => d.tileType as EditorTool)]);
const SHAPE_TOOL_TYPES = new Set<EditorTool>(['arc', 'curve', 'circular_curve', 'circle']);

const OBSTACLE_COLORS: Record<string, string> = Object.fromEntries(
  OBSTACLE_DEFINITIONS.map(d => [d.tileType, d.tileColor])
);

const TILE_COLORS: Record<string, string> = {
  empty: 'transparent',
  rail: '#FFD700',
  rail_start: '#00E676',
  rail_end: '#FF4081',
  ...OBSTACLE_COLORS,
};

export default function LevelEditor({ onBack }: LevelEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<EditorTool>('none');
  const [tiles, setTiles] = useState<Record<string, TileType>>({});
  // Track explicit connections between rail tiles: key -> Set of connected keys
  const railConnectionsRef = useRef<Record<string, Set<string>>>({});
  const lastPlacedRailRef = useRef<string | null>(null);
  const [skyOnly, setSkyOnly] = useState(true);

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
      // Rebuild connections between neighboring rail tiles (orthogonal + direct diagonals)
      // Only use a subset of neighbor directions to avoid duplicate pairs.
      const neighborOffsets: [number, number][] = [
        [1, 0],   // right
        [0, 1],   // down
        [1, 1],   // down-right diagonal
        [1, -1],  // up-right diagonal
      ];
      for (const [dx, dy] of neighborOffsets) {
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
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [levelComplete, setLevelComplete] = useState<{ time: number } | null>(null);
  const testCanvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const gameOverRef = useRef(false);
  const lastSavedTilesRef = useRef<string>('{}');
  const lastSavedSmoothRef = useRef<string>('[]');
  const lastSavedFreeLinesRef = useRef<string>('[]');
  const [testError, setTestError] = useState<string | null>(null);
  const [currentLevelId, setCurrentLevelId] = useState<string>('');
  const [currentMusicFile, setCurrentMusicFile] = useState<string>('');
  const [showMusicMenu, setShowMusicMenu] = useState(false);

  const [obstacleParams, setObstacleParams] = useState<Record<string, ObstacleParams>>({});
  const [selectedObstacleKey, setSelectedObstacleKey] = useState<string | null>(null);
  // Params carried when "picking up" an obstacle to move it
  const pendingObstacleParamsRef = useRef<ObstacleParams | null>(null);

  const [smoothSegments, setSmoothSegments] = useState<SmoothSegment[]>([]);
  const [freeLines, setFreeLines] = useState<FreeLineSegment[]>([]);
  const [line2Start, setLine2Start] = useState<{ attach: import('@/game/editorTypes').FreeLineAttach; start: { x: number; y: number } } | null>(null);
  const [mouseWorld, setMouseWorld] = useState<{ x: number; y: number } | null>(null);

  const hasUnsavedChanges = () =>
    JSON.stringify(tiles) !== lastSavedTilesRef.current ||
    JSON.stringify(smoothSegments) !== lastSavedSmoothRef.current ||
    JSON.stringify(freeLines) !== lastSavedFreeLinesRef.current;

  const serializeConnections = (): Record<string, string[]> => {
    const conns = railConnectionsRef.current;
    const out: Record<string, string[]> = {};
    for (const [key, set] of Object.entries(conns)) {
      if (set && set.size > 0) {
        out[key] = Array.from(set);
      }
    }
    return out;
  };

  // Arc tool state
  const [arcCenter, setArcCenter] = useState<{ gx: number; gy: number } | null>(null);
  const [arcPreview, setArcPreview] = useState<{ gx: number; gy: number }[]>([]);

  // Curve tool state: click start, click end, then drag control point
  const [curveStart, setCurveStart] = useState<{ gx: number; gy: number } | null>(null);
  const [curveEnd, setCurveEnd] = useState<{ gx: number; gy: number } | null>(null);
  const [curveControl, setCurveControl] = useState<{ gx: number; gy: number } | null>(null);
  const [curvePreview, setCurvePreview] = useState<{ gx: number; gy: number }[]>([]);
  const [isDraggingCurve, setIsDraggingCurve] = useState(false);

  // Line tool state
  const [lineStart, setLineStart] = useState<{ gx: number; gy: number } | null>(null);
  const [linePreview, setLinePreview] = useState<{ gx: number; gy: number }[]>([]);

  const worldHeight = EDITOR_HEIGHT * GRID_SIZE;

  // Clear obstacle selection when switching to a non-select tool
  useEffect(() => {
    if (tool !== 'none') setSelectedObstacleKey(null);
  }, [tool]);

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

        // Draw rail connections using explicit connection map (skip straight line if smooth segment exists)
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 4;
        const centerX = sx + GRID_SIZE / 2;
        const centerY = sy + GRID_SIZE / 2;
        const isSmoothPair = (a: string, b: string) =>
          smoothSegments.some(s => (s.startKey === a && s.endKey === b) || (s.startKey === b && s.endKey === a));

        const myConnections = connections[key];
        if (myConnections) {
          ctx.beginPath();
          for (const connKey of myConnections) {
            if (isSmoothPair(key, connKey)) continue; // smooth segment drawn separately
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
      } else {
        // Generic obstacle tile — driven by the registry
        const def = obstacleDefMap.get(type);
        if (def) {
          ctx.fillStyle = def.tileColor;
          ctx.fillRect(sx + 2, sy + 2, GRID_SIZE - 4, GRID_SIZE - 4);
          ctx.font = `${GRID_SIZE * 0.6}px system-ui`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = 'white';
          ctx.fillText(def.emoji, sx + GRID_SIZE / 2, sy + GRID_SIZE / 2);

          // Selection highlight
          if (key === selectedObstacleKey) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(sx + 1, sy + 1, GRID_SIZE - 2, GRID_SIZE - 2);
            ctx.setLineDash([]);
          }

          // Show reach overlay when this tile is selected OR when cursor hovers it
          const isSelected = key === selectedObstacleKey;
          const isHovered = mouseWorld != null &&
            Math.floor(mouseWorld.x / GRID_SIZE) === gx &&
            Math.floor(mouseWorld.y / GRID_SIZE) === gy;
          if (isSelected || isHovered) {
            const params = resolveParams(type, obstacleParams[key]);
            if (params) {
              const worldX = (gx + 0.5) * GRID_SIZE;
              const worldY = (gy + 0.5) * GRID_SIZE;
              const zones = def.getReach(params as any);
              drawReach(ctx, zones, worldX - cx, worldY - cy);
            }
          }
        }
      }
    }

    // Reach preview when obstacle tool is active and cursor is over the grid
    if (mouseWorld && obstacleDefMap.has(tool)) {
      const hoverGx = Math.floor(mouseWorld.x / GRID_SIZE);
      const hoverGy = Math.floor(mouseWorld.y / GRID_SIZE);
      const key = tileKey(hoverGx, hoverGy);
      const def = obstacleDefMap.get(tool);
      if (def) {
        const params = resolveParams(tool, obstacleParams[key]);
        if (params) {
          const worldX = (hoverGx + 0.5) * GRID_SIZE;
          const worldY = (hoverGy + 0.5) * GRID_SIZE;
          const zones = def.getReach(params as any);
          drawReach(ctx, zones, worldX - cx, worldY - cy);
          // Ghost tile preview
          ctx.globalAlpha = 0.55;
          const sx = hoverGx * GRID_SIZE - cx;
          const sy = hoverGy * GRID_SIZE - cy;
          ctx.fillStyle = def.tileColor;
          ctx.fillRect(sx + 2, sy + 2, GRID_SIZE - 4, GRID_SIZE - 4);
          ctx.font = `${GRID_SIZE * 0.6}px system-ui`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = 'white';
          ctx.fillText(def.emoji, worldX - cx, worldY - cy);
          ctx.globalAlpha = 1.0;
        }
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
    // Curve / circular curve preview: draw smooth arc/bezier (no tiles)
    if (curveStart && curveEnd && curveControl && (tool === 'curve' || tool === 'circular_curve')) {
      const wStart = { x: curveStart.gx * GRID_SIZE, y: curveStart.gy * GRID_SIZE };
      const wEnd = { x: curveEnd.gx * GRID_SIZE, y: curveEnd.gy * GRID_SIZE };
      const wPivot = { x: curveControl.gx * GRID_SIZE, y: curveControl.gy * GRID_SIZE };
      const pts = tool === 'circular_curve'
        ? sampleCircularArcWorld(wStart, wEnd, wPivot)
        : sampleBezierWorld(wStart, wEnd, wPivot);
      ctx.strokeStyle = 'rgba(100,200,255,0.9)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(pts[0].x - cx, pts[0].y - cy);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x - cx, pts[i].y - cy);
      ctx.stroke();
    }

    // Curve / circular curve start/end markers
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
    // Curve / circular curve control point marker
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

    // Smooth segments (circular/bezier) as cable
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 4;
    for (const seg of smoothSegments) {
      const start = keyToWorld(seg.startKey);
      const end = keyToWorld(seg.endKey);
      const pivot = { x: seg.pivotGx * GRID_SIZE, y: seg.pivotGy * GRID_SIZE };
      const pts = seg.type === 'circular'
        ? sampleCircularArcWorld(start, end, pivot)
        : sampleBezierWorld(start, end, pivot);
      ctx.beginPath();
      ctx.moveTo(pts[0].x - cx, pts[0].y - cy);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x - cx, pts[i].y - cy);
      ctx.stroke();
    }

    // Free line extensions (derive current start from attached segment endpoints; ignore freeLines while deriving)
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 4;
    const { allSegments: baseForLines, segmentIdByIndex } = convertLevelToGameData(tiles, railConnectionsRef.current, smoothSegments, undefined);
    const segIdToIdx: Record<string, number> = {};
    segmentIdByIndex.forEach((id, i) => { segIdToIdx[id] = i; });
    const getAttachPoint = (attach: import('@/game/editorTypes').FreeLineAttach) => {
      if ('atWorld' in attach) return attach.atWorld;
      const idx = segIdToIdx[attach.segmentId];
      if (idx == null) return null;
      const seg = baseForLines[idx];
      if (!seg || seg.length < 1) return null;
      const p = attach.endpoint === 'start' ? seg[0] : seg[seg.length - 1];
      return { x: p.x, y: p.y };
    };
    for (const fl of freeLines) {
      let start = getAttachPoint(fl.attach);
      if (!start && fl.attachWorld) start = fl.attachWorld;
      if (!start) continue;
      const pts = sampleLineWorld(start, fl.end);
      ctx.beginPath();
      ctx.moveTo(pts[0].x - cx, pts[0].y - cy);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x - cx, pts[i].y - cy);
      ctx.stroke();
    }

    // Line2 endpoint hints + hover highlight (include freeLine ends so user can start from connection points)
    if (tool === 'line2') {
      const hints: { attach: import('@/game/editorTypes').FreeLineAttach; pt: { x: number; y: number } }[] = baseForLines.flatMap((seg, si) => {
        if (!seg || seg.length < 1) return [];
        const id = segmentIdByIndex[si];
        return [
          { attach: { segmentId: id, endpoint: 'start' as const }, pt: seg[0] },
          { attach: { segmentId: id, endpoint: 'end' as const }, pt: seg[seg.length - 1] },
        ];
      });
      for (const fl of freeLines) {
        hints.push({ attach: { segmentId: fl.attach.segmentId, atWorld: fl.end }, pt: fl.end });
        if (fl.attachWorld) {
          hints.push({ attach: { segmentId: fl.attach.segmentId, atWorld: fl.attachWorld }, pt: fl.attachWorld });
        }
      }

      let hover: { x: number; y: number } | null = null;
      let bestD = Infinity;
      if (mouseWorld) {
        for (const h of hints) {
          const d = Math.hypot(mouseWorld.x - h.pt.x, mouseWorld.y - h.pt.y);
          if (d < bestD) { bestD = d; hover = { x: h.pt.x, y: h.pt.y }; }
        }
        if (bestD > 45) hover = null;
      }

      for (const h of hints) {
        const isHover = !!hover && Math.hypot(hover.x - h.pt.x, hover.y - h.pt.y) < 1;
        ctx.strokeStyle = isHover ? 'rgba(0, 255, 136, 0.9)' : 'rgba(0, 255, 136, 0.35)';
        ctx.lineWidth = isHover ? 3 : 2;
        ctx.beginPath();
        ctx.arc(h.pt.x - cx, h.pt.y - cy, isHover ? 9 : 7, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Line2 preview line (after picking start)
    if (tool === 'line2' && line2Start && mouseWorld) {
      ctx.strokeStyle = 'rgba(0, 204, 102, 0.9)';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(line2Start.start.x - cx, line2Start.start.y - cy);
      ctx.lineTo(mouseWorld.x - cx, mouseWorld.y - cy);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Line preview
    if (linePreview.length > 0) {
      ctx.fillStyle = 'rgba(0,200,100,0.4)';
      for (const p of linePreview) {
        const sx2 = p.gx * GRID_SIZE - cx;
        const sy2 = p.gy * GRID_SIZE - cy;
        ctx.fillRect(sx2 + 2, sy2 + 2, GRID_SIZE - 4, GRID_SIZE - 4);
      }
    }

    // Line start marker
    if (lineStart) {
      const lsx = lineStart.gx * GRID_SIZE + GRID_SIZE / 2 - cx;
      const lsy = lineStart.gy * GRID_SIZE + GRID_SIZE / 2 - cy;
      ctx.strokeStyle = '#00CC66';
      ctx.lineWidth = 3;
      ctx.strokeRect(lineStart.gx * GRID_SIZE - cx + 1, lineStart.gy * GRID_SIZE - cy + 1, GRID_SIZE - 2, GRID_SIZE - 2);
      ctx.fillStyle = '#00CC66';
      ctx.font = 'bold 10px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('A', lsx, lsy);
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
  }, [camera, tiles, smoothSegments, freeLines, tool, arcCenter, arcPreview, zoom, curveStart, curveEnd, curveControl, lineStart, linePreview, line2Start, mouseWorld, obstacleParams, selectedObstacleKey]);

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

  const screenToWorld = (clientX: number, clientY: number) => {
    return { x: clientX / zoom + camera.x, y: clientY / zoom + camera.y };
  };

  // Generate an arc loop around a center by sampling a circle in continuous
  // space and snapping to grid. Used by the Arc tool.
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
      if (points.length === 0 || points[points.length - 1].gx !== gx || points[points.length - 1].gy !== gy) {
        points.push({ gx, gy });
      }
    }
    return points;
  };

  // Generate a discrete circle path around a center using only straight and
  // diagonal steps on the grid.
  const generateCircleRail = (centerGX: number, centerGY: number, edgeGX: number, edgeGY: number) => {
    const dx = edgeGX - centerGX;
    const dy = edgeGY - centerGY;
    const radius = Math.round(Math.sqrt(dx * dx + dy * dy));
    if (radius < 1) return [];

    const perimeter: { gx: number; gy: number }[] = [];
    const added = new Set<string>();
    const add = (gx: number, gy: number) => {
      const key = `${gx},${gy}`;
      if (!added.has(key)) {
        added.add(key);
        perimeter.push({ gx, gy });
      }
    };

    // Midpoint circle algorithm in grid space
    let x = radius;
    let y = 0;
    let err = 1 - x;
    while (x >= y) {
      add(centerGX + x, centerGY + y);
      add(centerGX + y, centerGY + x);
      add(centerGX - y, centerGY + x);
      add(centerGX - x, centerGY + y);
      add(centerGX - x, centerGY - y);
      add(centerGX - y, centerGY - x);
      add(centerGX + y, centerGY - x);
      add(centerGX + x, centerGY - y);
      y++;
      if (err < 0) {
        err += 2 * y + 1;
      } else {
        x--;
        err += 2 * (y - x + 1);
      }
    }

    // Order points around the circle by angle
    perimeter.sort((a, b) => {
      const aa = Math.atan2(a.gy - centerGY, a.gx - centerGX);
      const ba = Math.atan2(b.gy - centerGY, b.gx - centerGX);
      return aa - ba;
    });

    // Connect neighboring perimeter points with line segments so we get
    // a continuous one-tile-wide loop using only grid-adjacent steps.
    const path: { gx: number; gy: number }[] = [];
    const visitedPath = new Set<string>();
    const pushPoint = (gx: number, gy: number) => {
      const key = `${gx},${gy}`;
      if (!visitedPath.has(key)) {
        visitedPath.add(key);
        path.push({ gx, gy });
      }
    };

    for (let i = 0; i < perimeter.length; i++) {
      const a = perimeter[i];
      const b = perimeter[(i + 1) % perimeter.length];
      const seg = generateLine(a, b);
      for (const p of seg) {
        pushPoint(p.gx, p.gy);
      }
    }

    return path;
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

  const generateLine = (
    start: { gx: number; gy: number },
    end: { gx: number; gy: number }
  ) => {
    const points: { gx: number; gy: number }[] = [];
    let x0 = start.gx, y0 = start.gy;
    const x1 = end.gx, y1 = end.gy;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while (true) {
      points.push({ gx: x0, gy: y0 });
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
    return points;
  };

  const generateCircularArc = (
    start: { gx: number; gy: number },
    end: { gx: number; gy: number },
    pivot: { gx: number; gy: number }
  ) => {
    // Fallback to straight line if points are degenerate or nearly collinear.
    if (
      (start.gx === end.gx && start.gy === end.gy) ||
      (start.gx === pivot.gx && start.gy === pivot.gy) ||
      (end.gx === pivot.gx && end.gy === pivot.gy)
    ) {
      return generateLine(start, end);
    }

    const x1 = start.gx, y1 = start.gy;
    const x2 = end.gx, y2 = end.gy;
    const x3 = pivot.gx, y3 = pivot.gy;

    const d = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
    if (Math.abs(d) < 1e-3) {
      return generateLine(start, end);
    }

    const ux =
      ((x1 * x1 + y1 * y1) * (y2 - y3) +
        (x2 * x2 + y2 * y2) * (y3 - y1) +
        (x3 * x3 + y3 * y3) * (y1 - y2)) /
      d;
    const uy =
      ((x1 * x1 + y1 * y1) * (x3 - x2) +
        (x2 * x2 + y2 * y2) * (x1 - x3) +
        (x3 * x3 + y3 * y3) * (x2 - x1)) /
      d;

    const radius = Math.sqrt((x1 - ux) * (x1 - ux) + (y1 - uy) * (y1 - uy));
    if (!isFinite(radius) || radius < 0.5) {
      return generateLine(start, end);
    }

    const a1 = Math.atan2(y1 - uy, x1 - ux);
    const a2 = Math.atan2(y2 - uy, x2 - ux);
    const a3 = Math.atan2(y3 - uy, x3 - ux);

    const norm = (a: number) => {
      let r = a;
      const tau = Math.PI * 2;
      while (r < 0) r += tau;
      while (r >= tau) r -= tau;
      return r;
    };

    const A1 = norm(a1);
    const A2 = norm(a2);
    const A3 = norm(a3);

    const isBetweenCCW = (from: number, to: number, mid: number) => {
      let f = from, t = to, m = mid;
      const tau = Math.PI * 2;
      if (t < f) t += tau;
      if (m < f) m += tau;
      return m >= f && m <= t;
    };

    const ccwContainsPivot = isBetweenCCW(A1, A2, A3);
    let startAngle = A1;
    let endAngle = A2;
    let dir = 1;

    if (!ccwContainsPivot) {
      // Use clockwise direction instead.
      dir = -1;
    }

    if (dir === 1 && endAngle < startAngle) {
      endAngle += Math.PI * 2;
    } else if (dir === -1 && startAngle < endAngle) {
      startAngle += Math.PI * 2;
    }

    const angleSpan = endAngle - startAngle;
    const arcLength = Math.abs(angleSpan) * radius;
    const steps = Math.max(12, Math.round(arcLength * 2));

    const rawPoints: { gx: number; gy: number }[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const angle = startAngle + angleSpan * t;
      const gx = Math.round(ux + Math.cos(angle) * radius);
      const gy = Math.round(uy + Math.sin(angle) * radius);
      if (
        rawPoints.length === 0 ||
        rawPoints[rawPoints.length - 1].gx !== gx ||
        rawPoints[rawPoints.length - 1].gy !== gy
      ) {
        rawPoints.push({ gx, gy });
      }
    }

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
      const seg = generateLine(rawPoints[i - 1], rawPoints[i]);
      for (const p of seg) {
        addPoint(p.gx, p.gy);
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
      const world = screenToWorld(e.clientX, e.clientY);

      // Arc tool: first click sets center, second click uses current radius
      // to generate a circular rail loop (grid-snapped).
      if (tool === 'arc') {
        if (!arcCenter) {
          setArcCenter({ gx, gy });
        } else {
          const points = generateArc(arcCenter.gx, arcCenter.gy, gx, gy);
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

    // Curve tools: click start, click end, then click/drag control point.
    if (tool === 'curve' || tool === 'circular_curve') {
        if (!curveStart) {
          setCurveStart({ gx, gy });
        } else if (!curveEnd) {
          setCurveEnd({ gx, gy });
          const mid = { gx: Math.round((curveStart.gx + gx) / 2), gy: Math.round((curveStart.gy + gy) / 2) };
          setCurveControl(mid);
        setCurvePreview(
          tool === 'curve'
            ? generateBezierCurve(curveStart, { gx, gy }, mid)
            : generateCircularArc(curveStart, { gx, gy }, mid)
        );
        } else {
          setIsDraggingCurve(true);
          setCurveControl({ gx, gy });
        setCurvePreview(
          tool === 'curve'
            ? generateBezierCurve(curveStart, curveEnd, { gx, gy })
            : generateCircularArc(curveStart, curveEnd, { gx, gy })
        );
        }
        return;
      }

      // Circle tool: first click sets center, second click sets radius and
      // creates a circular rail loop using only straight and diagonal steps.
      if (tool === 'circle') {
        if (!arcCenter) {
          setArcCenter({ gx, gy });
        } else {
          const points = generateCircleRail(arcCenter.gx, arcCenter.gy, gx, gy);
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

      if (tool === 'line') {
        if (!lineStart) {
          setLineStart({ gx, gy });
        } else {
          const points = generateLine(lineStart, { gx, gy });
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
          setLineStart(null);
          setLinePreview([]);
        }
        return;
      }

      if (tool === 'line2') {
        // First click: pick nearest snap point. Use BASE segments (no freeLines) so hints are stable and the selected start is always used.
        if (!line2Start) {
          const { allSegments: baseSegments, segmentIdByIndex: baseIds } = convertLevelToGameData(tiles, railConnectionsRef.current, smoothSegments, undefined);
          type Hint = { attach: import('@/game/editorTypes').FreeLineAttach; pt: { x: number; y: number }; dist: number };
          const hints: Hint[] = [];
          for (let si = 0; si < baseSegments.length; si++) {
            const seg = baseSegments[si];
            if (!seg || seg.length < 1) continue;
            const id = baseIds[si];
            hints.push({ attach: { segmentId: id, endpoint: 'start' }, pt: { x: seg[0].x, y: seg[0].y }, dist: Math.hypot(world.x - seg[0].x, world.y - seg[0].y) });
            hints.push({ attach: { segmentId: id, endpoint: 'end' }, pt: { x: seg[seg.length - 1].x, y: seg[seg.length - 1].y }, dist: Math.hypot(world.x - seg[seg.length - 1].x, world.y - seg[seg.length - 1].y) });
          }
          for (const fl of freeLines) {
            hints.push({ attach: { segmentId: fl.attach.segmentId, atWorld: fl.end }, pt: fl.end, dist: Math.hypot(world.x - fl.end.x, world.y - fl.end.y) });
            if (fl.attachWorld) {
              hints.push({ attach: { segmentId: fl.attach.segmentId, atWorld: fl.attachWorld }, pt: fl.attachWorld, dist: Math.hypot(world.x - fl.attachWorld.x, world.y - fl.attachWorld.y) });
            }
          }
          const best = hints.length === 0 ? null : hints.reduce((acc, h) => (h.dist <= acc.dist ? h : acc), hints[0]);
          if (!best || best.dist > 45) return;
          setLine2Start({ attach: best.attach, start: best.pt });
        } else {
          // Second click: free end point anywhere in world space (with snapping to any endpoint)
        const { allSegments, segmentIdByIndex } = convertLevelToGameData(tiles, railConnectionsRef.current, smoothSegments, freeLines);
          let snapEnd: { x: number; y: number } | null = null;
          let snapTarget: { segmentId: string; endpoint: 'start' | 'end' } | null = null;
          let bestD = Infinity;
          for (let si = 0; si < allSegments.length; si++) {
            const seg = allSegments[si];
            if (!seg || seg.length < 1) continue;
            const id = segmentIdByIndex[si];
            const a = seg[0];
            const b = seg[seg.length - 1];
            const da = Math.hypot(world.x - a.x, world.y - a.y);
            const db = Math.hypot(world.x - b.x, world.y - b.y);
            if (da < bestD) {
              bestD = da;
              snapEnd = { x: a.x, y: a.y };
              snapTarget = { segmentId: id, endpoint: 'start' };
            }
            if (db < bestD) {
              bestD = db;
              snapEnd = { x: b.x, y: b.y };
              snapTarget = { segmentId: id, endpoint: 'end' };
            }
          }
          const endPoint = bestD <= 45 && snapEnd ? snapEnd : world;
          setFreeLines(prev => [
            ...prev,
            {
              attach: line2Start.attach,
              attachWorld: line2Start.start,
              end: endPoint,
              target: bestD <= 45 && snapTarget ? snapTarget : undefined,
            },
          ]);
          setLine2Start(null);
        }
        return;
      }

      // None tool: first click selects, second click on selected tile "picks it up"
      if (tool === 'none') {
        const key = tileKey(gx, gy);
        const tileType = tiles[key];
        if (tileType && obstacleDefMap.has(tileType)) {
          if (selectedObstacleKey === key) {
            // Second click: pick up — remove tile, carry its params, switch to that obstacle tool
            pendingObstacleParamsRef.current = obstacleParams[key]
              ? { ...obstacleParams[key] }
              : null;
            removeRailConnections(key);
            setSelectedObstacleKey(null);
            setObstacleParams(prev => { const next = { ...prev }; delete next[key]; return next; });
            setTiles(prev => { const next = { ...prev }; delete next[key]; return next; });
            setTool(tileType as EditorTool);
          } else {
            setSelectedObstacleKey(key);
          }
        } else {
          setSelectedObstacleKey(null);
        }
        return;
      }

      // Eraser: check if click is near a free line or smooth curve segment and delete it
      if (tool === 'eraser') {
        const { allSegments: baseSegs, segmentIdByIndex: baseIds } = convertLevelToGameData(tiles, railConnectionsRef.current, smoothSegments, undefined);
        const segIdToIdx: Record<string, number> = {};
        baseIds.forEach((id, i) => { segIdToIdx[id] = i; });
        const resolveAttach = (attach: import('@/game/editorTypes').FreeLineAttach) => {
          if ('atWorld' in attach) return attach.atWorld;
          const idx = segIdToIdx[attach.segmentId];
          if (idx == null) return null;
          const seg = baseSegs[idx];
          if (!seg || seg.length < 1) return null;
          const p = attach.endpoint === 'start' ? seg[0] : seg[seg.length - 1];
          return { x: p.x, y: p.y };
        };
        const ptSegDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
          const dx = bx - ax, dy = by - ay;
          const lenSq = dx * dx + dy * dy;
          if (lenSq === 0) return Math.hypot(px - ax, py - ay);
          const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
          return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
        };
        const polylineDist = (px: number, py: number, pts: { x: number; y: number }[]) => {
          let min = Infinity;
          for (let i = 1; i < pts.length; i++) min = Math.min(min, ptSegDist(px, py, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y));
          return min;
        };

        const ERASE_THRESHOLD = 15;
        let bestDist = ERASE_THRESHOLD;
        let hitFreeLine = -1;
        let hitSmooth = -1;

        for (let i = 0; i < freeLines.length; i++) {
          const fl = freeLines[i];
          let start = resolveAttach(fl.attach);
          if (!start && fl.attachWorld) start = fl.attachWorld;
          if (!start) continue;
          const d = ptSegDist(world.x, world.y, start.x, start.y, fl.end.x, fl.end.y);
          if (d < bestDist) { bestDist = d; hitFreeLine = i; hitSmooth = -1; }
        }

        for (let i = 0; i < smoothSegments.length; i++) {
          const seg = smoothSegments[i];
          const start = keyToWorld(seg.startKey);
          const end = keyToWorld(seg.endKey);
          const pivot = { x: seg.pivotGx * GRID_SIZE, y: seg.pivotGy * GRID_SIZE };
          const pts = seg.type === 'circular'
            ? sampleCircularArcWorld(start, end, pivot)
            : sampleBezierWorld(start, end, pivot);
          const d = polylineDist(world.x, world.y, pts);
          if (d < bestDist) { bestDist = d; hitSmooth = i; hitFreeLine = -1; }
        }

        if (hitFreeLine >= 0) {
          setFreeLines(prev => prev.filter((_, i) => i !== hitFreeLine));
          return;
        }
        if (hitSmooth >= 0) {
          const seg = smoothSegments[hitSmooth];
          const conns = railConnectionsRef.current;
          conns[seg.startKey]?.delete(seg.endKey);
          conns[seg.endKey]?.delete(seg.startKey);
          setSmoothSegments(prev => prev.filter((_, i) => i !== hitSmooth));
          return;
        }
      }

      setIsDrawing(true);
      placeTile(gx, gy);
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    // Zoom with mouse wheel: scroll up -> zoom in, scroll down -> zoom out
    e.preventDefault();
    const delta = e.deltaY;
    if (delta < 0) {
      // Zoom in
      setZoom(z => Math.min(3, z + 0.25));
    } else if (delta > 0) {
      // Zoom out
      setZoom(z => Math.max(0.25, z - 0.25));
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      const newCam = { x: panStart.x - e.clientX / zoom, y: panStart.y - e.clientY / zoom };
      setCamera(newCam);
      setMouseWorld({ x: e.clientX / zoom + newCam.x, y: e.clientY / zoom + newCam.y });
      return;
    }
    setMouseWorld(screenToWorld(e.clientX, e.clientY));

    if (isDrawing) {
      const { gx, gy } = screenToGrid(e.clientX, e.clientY);
      placeTile(gx, gy);
    }

    // Arc preview
    if (tool === 'arc' && arcCenter) {
      const { gx, gy } = screenToGrid(e.clientX, e.clientY);
      setArcPreview(generateArc(arcCenter.gx, arcCenter.gy, gx, gy));
    }

    // Circle preview
    if (tool === 'circle' && arcCenter) {
      const { gx, gy } = screenToGrid(e.clientX, e.clientY);
      setArcPreview(generateCircleRail(arcCenter.gx, arcCenter.gy, gx, gy));
    }

    // Curve / circular curve control point dragging
    if ((tool === 'curve' || tool === 'circular_curve') && curveStart && curveEnd && isDraggingCurve) {
      const { gx, gy } = screenToGrid(e.clientX, e.clientY);
      setCurveControl({ gx, gy });
      setCurvePreview(
        tool === 'curve'
          ? generateBezierCurve(curveStart, curveEnd, { gx, gy })
          : generateCircularArc(curveStart, curveEnd, { gx, gy })
      );
    }

    // Line preview
    if (tool === 'line' && lineStart) {
      const { gx, gy } = screenToGrid(e.clientX, e.clientY);
      setLinePreview(generateLine(lineStart, { gx, gy }));
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    setIsDrawing(false);

    // Commit curve / circular curve on mouse up: store as smooth segment, only place start/end tiles
    if (isDraggingCurve && curveStart && curveEnd && curveControl) {
      const startKey = tileKey(curveStart.gx, curveStart.gy);
      const endKey = tileKey(curveEnd.gx, curveEnd.gy);
      addRailConnection(startKey, endKey);
      setSmoothSegments(prev => [...prev, {
        type: tool === 'circular_curve' ? 'circular' : 'bezier',
        startKey,
        endKey,
        pivotGx: curveControl.gx,
        pivotGy: curveControl.gy,
      }]);
      setTiles(prev => {
        const next = { ...prev };
        next[startKey] = prev[startKey] === 'rail_start' || prev[startKey] === 'rail_end' ? prev[startKey]! : 'rail';
        next[endKey] = prev[endKey] === 'rail_start' || prev[endKey] === 'rail_end' ? prev[endKey]! : 'rail';
        return next;
      });
      lastPlacedRailRef.current = endKey;
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
      setSelectedObstacleKey(prev => prev === key ? null : prev);
      setTiles(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } else if (tool === 'rail' || obstacleDefMap.has(tool)) {
      // Apply carried params if this is the first placement after a "pick up"
      if (obstacleDefMap.has(tool) && pendingObstacleParamsRef.current) {
        const carried = pendingObstacleParamsRef.current;
        pendingObstacleParamsRef.current = null;
        setObstacleParams(prev => ({ ...prev, [key]: carried }));
      }
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
    const hasStart = Object.values(tiles).some(t => t === 'rail_start');
    const hasEnd = Object.values(tiles).some(t => t === 'rail_end');
    if (!hasStart || !hasEnd) {
      setTestError('Place both a Start (🟢) and End (🏁) tile before testing.');
      setTimeout(() => setTestError(null), 3000);
      return;
    }
    const { railPoints } = convertLevelToGameData(tiles, railConnectionsRef.current, smoothSegments, freeLines);
    if (railPoints.length < 3) {
      setTestError('Place at least 3 rail tiles before testing.');
      setTimeout(() => setTestError(null), 3000);
      return;
    }
    setLevelComplete(null);
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
    const { railPoints, allSegments, obstacles: obsData, endSegmentIndex, endPointIndex } = convertLevelToGameData(tiles, railConnectionsRef.current, smoothSegments, freeLines, obstacleParams);

    // Start level music if configured
    if (currentMusicFile) {
      musicManager.playForLevel(currentMusicFile);
    }

    // Create a custom engine with pre-built rail
    const engine = new GameEngine(canvas, 'overworld', { motor: 0, health: 0, grip: 0, rocket: 0, shield: 0 }, {
      onGameOver: () => { gameOverRef.current = true; },
      onLevelComplete: (time: number) => { setLevelComplete({ time }); },
    });

    // Override the rail with our resampled one (already in world coordinates)
    engine.rail = railPoints;
    engine.allRailSegments = allSegments;
    (engine as any).hasFinitePath = true;
    (engine as any).endSegmentIndex = endSegmentIndex;
    (engine as any).endPointIndex = endPointIndex;
    // Start tile is the beginning of the main rail path
    (engine as any).startTilePos = railPoints.length > 0 ? railPoints[0] : null;
    // End tile, if present on the main path, is at endPointIndex
    (engine as any).endTilePos =
      endPointIndex != null && endPointIndex >= 0 && endPointIndex < railPoints.length
        ? railPoints[endPointIndex]
        : null;
    engine.ground = engine.rail.map(p => p.y + 150);
    engine.noBackground = skyOnly;
    engine.obstacles = [];

    // Add obstacles - convert grid coords to world coords using the registry
    let nextEditorObsId = 1;
    for (const obs of obsData) {
      const obsWorldX = (obs.gx + 0.5) * GRID_SIZE;
      const obsWorldY = (obs.gy + 0.5) * GRID_SIZE;
      const def = obstacleDefMap.get(obs.tileType);
      if (!def) continue;
      const gameObs = def.toGameObstacle(
        `editor_obs_${nextEditorObsId++}`,
        obsWorldX,
        obsWorldY,
        obs.params as any,
      );
      if (gameObs) engine.obstacles.push(gameObs);
    }

    // Prevent auto-generation of more rail; mark as finite path
    engine.generateRail = () => {};
    engine.spawnObstacles = () => {};
    engine.hasFinitePath = true;
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
      musicManager.stop();
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', handleKey);
    };
  }, [testing, tiles, smoothSegments, freeLines]);

  // Save dialog
  const handleSave = () => {
    if (!levelName.trim()) return;
    const existing = loadCustomLevels().find(l => l.name === levelName.trim());
    if (existing && !confirm(`A level named "${levelName.trim()}" already exists. Overwrite it?`)) return;
    const id = (existing?.id) || currentLevelId || generateLevelId();
    const level: EditorLevel = {
      name: levelName.trim(),
      id,
      tiles,
      createdAt: Date.now(),
      connections: serializeConnections(),
      smoothSegments,
      freeLines,
      musicFile: currentMusicFile || undefined,
      obstacleParams: Object.keys(obstacleParams).length > 0 ? obstacleParams : undefined,
    };
    saveCustomLevel(level);
    lastSavedTilesRef.current = JSON.stringify(tiles);
    lastSavedSmoothRef.current = JSON.stringify(smoothSegments);
    lastSavedFreeLinesRef.current = JSON.stringify(freeLines);
    setCurrentLevelId(id);
    setCurrentLevelName(levelName.trim());
    setShowSaveDialog(false);
    setLevelName('');
  };

  const handleQuickSave = () => {
    if (!currentLevelName) {
      setShowSaveDialog(true);
      return;
    }
    const id = currentLevelId || generateLevelId();
    const level: EditorLevel = {
      name: currentLevelName,
      id,
      tiles,
      createdAt: Date.now(),
      connections: serializeConnections(),
      smoothSegments,
      freeLines,
      musicFile: currentMusicFile || undefined,
      obstacleParams: Object.keys(obstacleParams).length > 0 ? obstacleParams : undefined,
    };
    saveCustomLevel(level);
    lastSavedTilesRef.current = JSON.stringify(tiles);
    lastSavedSmoothRef.current = JSON.stringify(smoothSegments);
    lastSavedFreeLinesRef.current = JSON.stringify(freeLines);
    setCurrentLevelId(id);
  };

  const handleLoad = (level: EditorLevel) => {
    setTiles(level.tiles);
    lastSavedTilesRef.current = JSON.stringify(level.tiles);
    setSmoothSegments(level.smoothSegments ?? []);
    lastSavedSmoothRef.current = JSON.stringify(level.smoothSegments ?? []);
    // Migrate legacy freeLines (attachTo/start/end or segmentIndex) to attach/target with segmentId
    const connsForMigration = level.connections
      ? (() => { const r: Record<string, Set<string>> = {}; for (const [k, arr] of Object.entries(level.connections)) r[k] = new Set(arr as string[]); return r; })()
      : (rebuildConnectionsFromTiles(level.tiles), railConnectionsRef.current);
    const { segmentIdByIndex } = convertLevelToGameData(level.tiles, connsForMigration, level.smoothSegments ?? undefined, undefined);
    const loadedFreeLines = (level.freeLines ?? []) as any[];
    const migrated: FreeLineSegment[] = loadedFreeLines.map(fl => {
      if (!fl || !fl.end) return null;
      if (fl.attach && fl.attach.segmentId) return fl as FreeLineSegment;
      if (fl.attach && typeof fl.attach.segmentIndex === 'number') {
        const id = segmentIdByIndex[fl.attach.segmentIndex];
        return { ...fl, attach: { ...fl.attach, segmentId: id }, target: fl.target && typeof fl.target.segmentIndex === 'number' ? { segmentId: segmentIdByIndex[fl.target.segmentIndex], endpoint: fl.target.endpoint } : fl.target };
      }
      if (fl.attachTo) {
        return { attach: { segmentId: segmentIdByIndex[0], endpoint: fl.attachTo === 'start' ? 'start' : 'end' }, end: fl.end, target: fl.target };
      }
      return null;
    }).filter(Boolean) as FreeLineSegment[];
    setFreeLines(migrated);
    lastSavedFreeLinesRef.current = JSON.stringify(migrated);
    setObstacleParams(level.obstacleParams ? { ...level.obstacleParams } : {});
    setCurrentLevelName(level.name);
    setCurrentLevelId(level.id || generateLevelId());
    setCurrentMusicFile(level.musicFile ?? '');
    setShowLoadDialog(false);
    // Restore explicit connections if present; otherwise rebuild from adjacency.
    if (level.connections) {
      const restored: Record<string, Set<string>> = {};
      for (const [key, arr] of Object.entries(level.connections)) {
        restored[key] = new Set(arr);
      }
      railConnectionsRef.current = restored;
    } else {
      rebuildConnectionsFromTiles(level.tiles);
    }
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
    setSmoothSegments([]);
    setFreeLines([]);
    railConnectionsRef.current = {};
    setObstacleParams({});
    lastPlacedRailRef.current = null;
    setLine2Start(null);
    setArcCenter(null);
    setArcPreview([]);
  };

  if (testing) {
    return (
      <div className="fixed inset-0">
        <canvas ref={testCanvasRef} className="w-full h-full" />
        {/* Place the test-mode back button in the bottom-left to avoid overlapping in-canvas HUD (distance/hearts/speed) */}
        <div className="fixed bottom-4 left-4 z-10">
          <button
            onClick={() => {
              engineRef.current?.stop();
              setTesting(false);
              setLevelComplete(null);
            }}
            className="px-4 py-2 rounded-lg bg-game-accent text-game-bg font-bold hover:brightness-110"
          >
            ✕ Back to Editor
          </button>
        </div>
        {levelComplete && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-20">
            <div className="bg-game-card border-2 border-game-accent rounded-2xl p-8 w-96 text-center">
              <h2 className="text-4xl font-bold text-game-accent mb-2">🎉 Congratulations!</h2>
              <p className="text-game-subtitle text-lg mb-6">You reached the finish line!</p>
              <div className="bg-game-bg rounded-xl p-4 mb-6">
                <p className="text-game-subtitle text-sm">Completion Time</p>
                <p className="text-game-title text-3xl font-bold">
                  {Math.floor(levelComplete.time / 60)}:{(Math.floor(levelComplete.time) % 60).toString().padStart(2, '0')}.{Math.floor((levelComplete.time % 1) * 100).toString().padStart(2, '0')}
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    engineRef.current?.stop();
                    setLevelComplete(null);
                    setTesting(false);
                    setTimeout(() => startTest(), 50);
                  }}
                  className="flex-1 py-3 rounded-lg bg-green-600 text-white font-bold text-lg hover:bg-green-500"
                >
                  🔄 Replay
                </button>
                <button
                  onClick={() => {
                    engineRef.current?.stop();
                    setTesting(false);
                    setLevelComplete(null);
                  }}
                  className="flex-1 py-3 rounded-lg bg-game-accent text-game-bg font-bold text-lg hover:brightness-110"
                >
                  ✕ Back to Editor
                </button>
                <button
                  onClick={() => {
                    engineRef.current?.stop();
                    setTesting(false);
                    setLevelComplete(null);
                    onBack();
                  }}
                  className="flex-1 py-3 rounded-lg bg-game-bar-bg text-game-subtitle font-bold text-lg hover:brightness-110"
                >
                  ← Menu
                </button>
              </div>
            </div>
          </div>
        )}
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
        onWheel={handleWheel}
      />

      {/* Test validation alert */}
      {testError && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-lg bg-red-700 text-white text-sm font-bold shadow-lg border border-red-400">
          {testError}
        </div>
      )}

      {/* Top bar */}
      <div className="fixed top-4 left-4 right-4 flex items-start justify-between z-10">
        {/* Left: Tiles menu + Tools + Eraser/Line */}
        <div className="flex gap-2 items-start">
          {/* Tiles dropdown */}
          <div className="relative">
            <button
              onClick={() => {
                if (TILE_TOOL_TYPES.has(tool)) setTool('none');
                setShowTilesMenu(!showTilesMenu);
                setShowToolsMenu(false);
                setShowFileMenu(false);
              }}
              className={`px-3 py-2 rounded-lg font-bold text-sm border transition-all ${
                TILE_TOOL_TYPES.has(tool)
                  ? 'bg-game-accent text-game-bg border-game-accent'
                  : 'bg-game-card text-game-title border-game-card-border hover:border-game-accent'
              }`}
            >
              {(() => {
                const activeTile = TOOLS.find(t => t.tool === tool && TILE_TOOL_TYPES.has(t.tool));
                return activeTile ? `${activeTile.emoji} ${activeTile.label}` : '🧱 Tiles';
              })()} ▾
            </button>
            {showTilesMenu && (
              <div className="absolute top-full left-0 mt-1 bg-game-card border border-game-card-border rounded-lg p-1 min-w-[140px] shadow-lg">
                {TOOLS.filter(t => TILE_TOOL_TYPES.has(t.tool)).map(t => (
                  <button
                    key={t.tool}
                    onClick={() => {
                      setTool(t.tool); lastPlacedRailRef.current = null;
                      setArcCenter(null); setArcPreview([]);
                      setCurveStart(null); setCurveEnd(null); setCurveControl(null); setCurvePreview([]); setIsDraggingCurve(false);
                      setLineStart(null); setLinePreview([]);
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

          {/* Tools dropdown for rail-building helpers */}
          <div className="relative">
            <button
              onClick={() => {
                if (SHAPE_TOOL_TYPES.has(tool)) {
                  setTool('none');
                  setArcCenter(null); setArcPreview([]);
                  setCurveStart(null); setCurveEnd(null); setCurveControl(null); setCurvePreview([]); setIsDraggingCurve(false);
                }
                setShowToolsMenu(!showToolsMenu);
                setShowTilesMenu(false);
                setShowFileMenu(false);
              }}
              className={`px-3 py-2 rounded-lg font-bold text-sm border transition-all ${
                SHAPE_TOOL_TYPES.has(tool)
                  ? 'bg-game-accent text-game-bg border-game-accent'
                  : 'bg-game-card text-game-title border-game-card-border hover:border-game-accent'
              }`}
            >
              {(() => {
                const activeTool = TOOLS.find(t => t.tool === tool && SHAPE_TOOL_TYPES.has(t.tool));
                return activeTool ? `${activeTool.emoji} ${activeTool.label}` : '🛠 Tools';
              })()} ▾
            </button>
            {showToolsMenu && (
              <div className="absolute top-full left-0 mt-1 bg-game-card border border-game-card-border rounded-lg p-1 min-w-[140px] shadow-lg">
                {TOOLS.filter(t => SHAPE_TOOL_TYPES.has(t.tool)).map(t => (
                  <button
                    key={t.tool}
                    onClick={() => {
                      setTool(t.tool); lastPlacedRailRef.current = null;
                      if (t.tool !== 'circle' && t.tool !== 'arc') { setArcCenter(null); setArcPreview([]); }
                      if (t.tool !== 'curve' && t.tool !== 'circular_curve') { setCurveStart(null); setCurveEnd(null); setCurveControl(null); setCurvePreview([]); setIsDraggingCurve(false); }
                      setLineStart(null); setLinePreview([]);
                      setShowToolsMenu(false);
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

          {/* Standalone tools: Eraser, Line, Line2 */}
          {TOOLS.filter(t => ['eraser', 'line', 'line2'].includes(t.tool)).map(t => (
            <button
              key={t.tool}
              onClick={() => {
                if (tool === t.tool) {
                  setTool('none');
                } else {
                  setTool(t.tool as EditorTool);
                }
                lastPlacedRailRef.current = null;
                setArcCenter(null); setArcPreview([]);
                setCurveStart(null); setCurveEnd(null); setCurveControl(null); setCurvePreview([]); setIsDraggingCurve(false);
                setLineStart(null); setLinePreview([]);
                if (t.tool === 'line2') setLine2Start(null);
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

          {/* Hand tool (select/inspect) */}
          <button
            onClick={() => {
              setTool('none');
              lastPlacedRailRef.current = null;
              setArcCenter(null); setArcPreview([]);
              setCurveStart(null); setCurveEnd(null); setCurveControl(null); setCurvePreview([]); setIsDraggingCurve(false);
              setLineStart(null); setLinePreview([]);
              setLine2Start(null);
              setShowTilesMenu(false); setShowToolsMenu(false);
            }}
            className={`px-3 py-2 rounded-lg font-bold text-sm transition-all ${
              tool === 'none'
                ? 'bg-game-accent text-game-bg scale-105'
                : 'bg-game-card text-game-title border border-game-card-border hover:border-game-accent'
            }`}
            title="Hand — select & inspect obstacles"
          >
            ✋ Hand
          </button>
        </div>

        {/* Right: Action buttons */}
        <div className="flex gap-2 items-start">
          {/* Music selector button */}
          <button
            onClick={() => { setShowMusicMenu(true); setShowFileMenu(false); setShowTilesMenu(false); setShowToolsMenu(false); }}
            className={`px-3 py-2 rounded-lg font-bold text-sm transition-all ${
              currentMusicFile
                ? 'bg-game-accent text-game-bg'
                : 'bg-game-card text-game-title border border-game-card-border hover:border-game-accent'
            }`}
            title="Select level music"
          >
            🎵 {currentMusicFile
              ? (getAvailableTracks().find(t => t.file === currentMusicFile)?.label ?? currentMusicFile)
              : 'Music'}
          </button>

          <button
            onClick={() => setSkyOnly(!skyOnly)}
            className={`px-3 py-2 rounded-lg font-bold text-sm transition-all ${
              skyOnly
                ? 'bg-game-accent text-game-bg'
                : 'bg-game-card text-game-title border border-game-card-border hover:border-game-accent'
            }`}
            title={skyOnly ? 'Background: Sky only' : 'Background: Full scenery'}
          >
            {skyOnly ? '☁️ Sky Only' : '🏔️ Scenery'}
          </button>
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

      {/* Music Selection Dialog */}
      {showMusicMenu && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-20" onClick={() => setShowMusicMenu(false)}>
          <div className="bg-game-card border-2 border-game-card-border rounded-2xl p-6 w-96 max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-game-title text-xl font-bold">🎵 Level Music</h3>
              <button onClick={() => setShowMusicMenu(false)} className="text-game-subtitle hover:text-game-title text-lg">✕</button>
            </div>
            <p className="text-game-subtitle text-xs mb-3">
              Place music files in <span className="text-game-title font-mono">public/assets/music/</span> and add them to <span className="text-game-title font-mono">music_catalog.json</span>.
            </p>
            <div className="overflow-y-auto space-y-1 flex-1">
              {/* None option */}
              <button
                onClick={() => { setCurrentMusicFile(''); setShowMusicMenu(false); }}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm font-bold transition-all ${
                  !currentMusicFile
                    ? 'bg-game-accent text-game-bg'
                    : 'bg-game-bg text-game-subtitle hover:text-game-title border border-game-card-border'
                }`}
              >
                — None —
              </button>
              {getAvailableTracks().length === 0 && (
                <p className="text-game-subtitle text-xs text-center py-4">No music files found in public/assets/music/.</p>
              )}
              {getAvailableTracks().map(track => (
                <button
                  key={track.file}
                  onClick={() => { setCurrentMusicFile(track.file); addToCatalog(track.file); setShowMusicMenu(false); }}
                  className={`w-full text-left px-3 py-2.5 rounded-lg transition-all ${
                    currentMusicFile === track.file
                      ? 'bg-game-accent text-game-bg'
                      : 'bg-game-bg border border-game-card-border hover:border-game-accent'
                  }`}
                >
                  <div className={`font-bold text-sm ${currentMusicFile === track.file ? 'text-game-bg' : 'text-game-title'}`}>{track.label}</div>
                  <div className={`text-xs font-mono mt-0.5 ${currentMusicFile === track.file ? 'text-game-bg/70' : 'text-game-subtitle'}`}>{track.file}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

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
                            const id = level.id || currentLevelId || generateLevelId();
                            const newLevel: EditorLevel = {
                              name: level.name,
                              id,
                              tiles,
                              createdAt: Date.now(),
                              connections: serializeConnections(),
                              smoothSegments,
                              freeLines,
                              musicFile: currentMusicFile || undefined,
                            };
                            saveCustomLevel(newLevel);
                            lastSavedTilesRef.current = JSON.stringify(tiles);
                            lastSavedSmoothRef.current = JSON.stringify(smoothSegments);
                            lastSavedFreeLinesRef.current = JSON.stringify(freeLines);
                            setCurrentLevelId(id);
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

      {/* Inspector Panel */}
      {selectedObstacleKey && (() => {
        const tileType = tiles[selectedObstacleKey];
        if (!tileType) return null;
        const def = obstacleDefMap.get(tileType);
        if (!def) return null;
        const params = { ...def.defaultParams, ...(obstacleParams[selectedObstacleKey] ?? {}) } as Record<string, any>;
        const [selGx, selGy] = parseTileKey(selectedObstacleKey);
        return (
          <div className="fixed right-4 top-20 bottom-12 w-64 bg-game-card border border-game-card-border rounded-xl flex flex-col shadow-xl z-10 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-game-card-border bg-game-bar-bg">
              <span className="text-game-title font-bold text-sm">{def.emoji} {def.label}</span>
              <button
                onClick={() => setSelectedObstacleKey(null)}
                className="text-game-subtitle hover:text-game-title text-lg leading-none"
              >✕</button>
            </div>
            <div className="text-game-subtitle text-xs px-3 py-1 border-b border-game-card-border">
              Cell {selGx},{selGy}
            </div>
            {/* Fields */}
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
              {Object.entries(def.paramMeta as Record<string, ParamFieldMeta>).map(([field, meta]) => (
                <div key={field}>
                  <label className="block text-game-subtitle text-xs mb-1">{meta.label}</label>
                  {(!meta.type || meta.type === 'number') ? (
                    <input
                      type="number"
                      value={params[field] ?? ''}
                      min={meta.min}
                      max={meta.max}
                      step={meta.step ?? 1}
                      onChange={e => {
                        const val = parseFloat(e.target.value);
                        if (isNaN(val)) return;
                        const clamped = meta.min != null && meta.max != null
                          ? Math.min(meta.max, Math.max(meta.min, val))
                          : val;
                        setObstacleParams(prev => ({
                          ...prev,
                          [selectedObstacleKey]: {
                            ...(prev[selectedObstacleKey] ?? def.defaultParams),
                            [field]: clamped,
                          } as ObstacleParams,
                        }));
                      }}
                      className="w-full px-2 py-1 rounded bg-game-bg text-game-title border border-game-card-border text-sm outline-none focus:border-game-accent"
                    />
                  ) : meta.type === 'select' ? (
                    <select
                      value={params[field] ?? ''}
                      onChange={e => {
                        setObstacleParams(prev => ({
                          ...prev,
                          [selectedObstacleKey]: {
                            ...(prev[selectedObstacleKey] ?? def.defaultParams),
                            [field]: e.target.value,
                          } as ObstacleParams,
                        }));
                      }}
                      className="w-full px-2 py-1 rounded bg-game-bg text-game-title border border-game-card-border text-sm outline-none focus:border-game-accent"
                    >
                      {(meta.options ?? []).map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : null}
                </div>
              ))}
            </div>
            {/* Reset */}
            <div className="px-3 py-2 border-t border-game-card-border">
              <button
                onClick={() => {
                  setObstacleParams(prev => {
                    const next = { ...prev };
                    delete next[selectedObstacleKey];
                    return next;
                  });
                }}
                className="w-full py-1.5 rounded-lg bg-game-bar-bg text-game-subtitle text-xs font-bold hover:brightness-110"
              >
                Reset to Defaults
              </button>
            </div>
          </div>
        );
      })()}

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
