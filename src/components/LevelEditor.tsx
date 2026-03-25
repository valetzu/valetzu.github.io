import { useState, useRef, useEffect, useCallback } from "react";
import {
  GRID_SIZE,
  EDITOR_HEIGHT,
  EditorTool,
  ObstacleTileType,
  EditorLevel,
  tileKey,
  parseTileKey,
  saveCustomLevel,
  loadCustomLevels,
  deleteCustomLevel,
  convertLevelToGameDataV3,
  migrateToV3,
  RailSegment,
  sampleCircularArcWorld,
  sampleBezierWorld,
  keyToWorld,
  smoothDrawnRail,
  generateLevelId,
  isObstacleTileType,
  buildIndividualSegmentsFromRailSegments,
  buildContinuousSegments,
  getSnapPoints,
} from "@/game/editorTypes";
import { downloadLevelFile, importLevel } from "@/game/levelIO";
import {
  musicManager,
  getAvailableTracks,
  addToCatalog,
} from "@/game/musicManager";
import {
  Point,
  Obstacle,
  WORLD_CONFIG,
  recordTime,
  getRecords,
  LevelRecord,
  formatTime,
} from "@/game/types";
import { GameEngine } from "@/game/engine";
import {
  OBSTACLE_DEFINITIONS,
  obstacleDefMap,
  resolveParams,
  ObstacleParams,
  drawReach,
  ParamFieldMeta,
} from "@/game/obstacleDefinitions";
import SettingsMenu from "@/components/SettingsMenu";
import { loadSettings, updateSetting } from "@/game/settings";

interface LevelEditorProps {
  onBack: () => void;
}

const OBSTACLE_TOOLS = OBSTACLE_DEFINITIONS.map((d) => ({
  tool: d.tileType as EditorTool,
  label: d.label,
  emoji: d.emoji,
}));

const TOOLS: { tool: EditorTool; label: string; emoji: string }[] = [
  { tool: "rail_start", label: "Start", emoji: "🟢" },
  { tool: "rail_end", label: "End", emoji: "🏁" },
  { tool: "rail", label: "Rail", emoji: "🛤️" },
  { tool: "rail_crossing", label: "Crossing", emoji: "✖️" },
  ...OBSTACLE_TOOLS,
  { tool: "star", label: "Star", emoji: "⭐" },
  { tool: "eraser", label: "Eraser", emoji: "🧹" },
  { tool: "arc", label: "Arc Tool", emoji: "🔄" },
  { tool: "curve", label: "Curve", emoji: "〰️" },
  { tool: "circular_curve", label: "Circular Curve", emoji: "🟠" },
  { tool: "circle", label: "Circle", emoji: "⭕" },
  { tool: "line", label: "Line", emoji: "📏" },
  { tool: "line2", label: "Free Line", emoji: "📐" },
  { tool: "draw_rail", label: "Draw", emoji: "✏️" },
];

const TILE_TOOL_TYPES = new Set<EditorTool>([
  "rail_start",
  "rail_end",
  "rail_crossing",
  ...OBSTACLE_DEFINITIONS.map((d) => d.tileType as EditorTool),
  "star",
]);
const SHAPE_TOOL_TYPES = new Set<EditorTool>([
  "arc",
  "curve",
  "circular_curve",
  "circle",
]);

const OBSTACLE_COLORS: Record<string, string> = Object.fromEntries(
  OBSTACLE_DEFINITIONS.map((d) => [d.tileType, d.tileColor]),
);

/** Snap radius for tile-based adjacency — larger than GRID_SIZE so adjacent tiles always connect. */
const TILE_SNAP_RADIUS = GRID_SIZE * 1.5;

const TILE_COLORS: Record<string, string> = {
  empty: "transparent",
  rail: "#FFD700",
  rail_start: "#00E676",
  rail_end: "#FF4081",
  rail_crossing: "#FFA500",
  ...OBSTACLE_COLORS,
};

/**
 * At a shared snappoint, N segment endpoints overlap. Each pair (one going in,
 * one going out) is one logical connection. Keep ceil(N/2) representatives by
 * pairing up endpoints at the same position and keeping one per pair.
 * Returns { items, partnerOf } where partnerOf maps segmentId → paired segmentId.
 */
function dedupOverlapping<T extends { pt: { x: number; y: number }; segmentId: string }>(
  items: T[],
): { items: T[]; partnerOf: Record<string, string> } {
  const result: T[] = [];
  const pairedSegIds = new Set<string>();
  const partnerOf: Record<string, string> = {};
  for (const item of items) {
    if (pairedSegIds.has(item.segmentId)) continue;
    result.push(item);
    pairedSegIds.add(item.segmentId);
    // Find another unpaired endpoint at the same position and mark it as this one's partner
    const partner = items.find(
      other => !pairedSegIds.has(other.segmentId)
        && Math.hypot(other.pt.x - item.pt.x, other.pt.y - item.pt.y) < 0.5,
    );
    if (partner) {
      pairedSegIds.add(partner.segmentId);
      partnerOf[item.segmentId] = partner.segmentId;
      partnerOf[partner.segmentId] = item.segmentId;
    }
  }
  return { items: result, partnerOf };
}

export default function LevelEditor({ onBack }: LevelEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<EditorTool>("none");
  const [segments, setSegments] = useState<RailSegment[]>([]);
  const [obstacles, setObstacles] = useState<Record<string, ObstacleTileType>>(
    {},
  );
  const [stars, setStars] = useState<Record<string, "star">>({});
  const [startMarker, setStartMarker] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [endMarker, setEndMarker] = useState<{ x: number; y: number } | null>(
    null,
  );
  const lastPlacedRailRef = useRef<{
    segIdx: number;
    endpoint: "start" | "end";
  } | null>(null);
  const lastPlacedKeyRef = useRef<string | null>(null);
  const [skyOnly, setSkyOnly] = useState(true);
  const [autoconnect, setAutoconnect] = useState(true);

  const SNAP_TOLERANCE = 8; // px — for merging segment endpoints
  const [camera, setCamera] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [isDrawing, setIsDrawing] = useState(false);
  const [levelName, setLevelName] = useState("");
  const [currentLevelName, setCurrentLevelName] = useState("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [savedLevels, setSavedLevels] = useState<EditorLevel[]>([]);
  const [testing, setTesting] = useState(false);
  const [showTilesMenu, setShowTilesMenu] = useState(false);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [snapRadius, setSnapRadius] = useState(() => loadSettings().snapRadius);
  const [levelComplete, setLevelComplete] = useState<{
    time: number;
    records: LevelRecord[];
    isNewBest: boolean;
    starsCollected: number;
  } | null>(null);
  const testCanvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);
  const gameOverRef = useRef(false);
  const lastSavedSegmentsRef = useRef<string>("[]");
  const lastSavedObstaclesRef = useRef<string>("{}");
  const lastSavedMarkersRef = useRef<string>("{}");
  const [testError, setTestError] = useState<string | null>(null);
  const [currentLevelId, setCurrentLevelId] = useState<string>("");
  const [currentMusicFile, setCurrentMusicFile] = useState<string>("");
  const [showMusicMenu, setShowMusicMenu] = useState(false);

  const [obstacleParams, setObstacleParams] = useState<
    Record<string, ObstacleParams>
  >({});
  const [selectedObstacleKey, setSelectedObstacleKey] = useState<string | null>(
    null,
  );
  // Params carried when "picking up" an obstacle to move it
  const pendingObstacleParamsRef = useRef<ObstacleParams | null>(null);
  // Accumulated rotation (degrees) for the next fresh obstacle placement
  const pendingToolRotRef = useRef<number>(0);

  // smoothSegments and freeLines removed — now unified into `segments` state
  const [line2Start, setLine2Start] = useState<{
    start: { x: number; y: number };
  } | null>(null);
  const [line2GridSnap, setLine2GridSnap] = useState(
    () => loadSettings().defaultFreeLineToolBehaviour === "grid_snap",
  );
  const [continuousLine, setContinuousLine] = useState(
    () => loadSettings().continuousLine,
  );
  const [mouseWorld, setMouseWorld] = useState<{ x: number; y: number } | null>(
    null,
  );
  // Draw rail tool state
  const [drawRailPoints, setDrawRailPoints] = useState<
    { x: number; y: number }[] | null
  >(null);
  const [drawRailAttach, setDrawRailAttach] = useState<{
    start: { x: number; y: number };
  } | null>(null);
  const [drawRailPending, setDrawRailPending] = useState<{
    raw: { x: number; y: number }[];
    attach: { start: { x: number; y: number } } | null;
    endSnap: { pt: { x: number; y: number } } | null;
  } | null>(null);
  const [drawRailSmoothness, setDrawRailSmoothness] = useState(0.5);
  // Snap cycling: when multiple snap points overlap, scroll wheel cycles through them
  const snapCycleRef = useRef<{
    worldX: number;
    worldY: number;
    index: number;
  }>({ worldX: -999, worldY: -999, index: 0 });

  const hasUnsavedChanges = () =>
    JSON.stringify(segments) !== lastSavedSegmentsRef.current ||
    JSON.stringify(obstacles) !== lastSavedObstaclesRef.current ||
    JSON.stringify({ startMarker, endMarker }) !== lastSavedMarkersRef.current;

  // Arc tool state
  const [arcCenter, setArcCenter] = useState<{ gx: number; gy: number } | null>(
    null,
  );
  const [arcPreview, setArcPreview] = useState<{ gx: number; gy: number }[]>(
    [],
  );

  // Curve tool state: click start, click end, then drag control point
  const [curveStart, setCurveStart] = useState<{
    gx: number;
    gy: number;
  } | null>(null);
  const [curveEnd, setCurveEnd] = useState<{ gx: number; gy: number } | null>(
    null,
  );
  const [curveControl, setCurveControl] = useState<{
    gx: number;
    gy: number;
  } | null>(null);
  const [curvePreview, setCurvePreview] = useState<
    { gx: number; gy: number }[]
  >([]);
  const [isDraggingCurve, setIsDraggingCurve] = useState(false);

  // Line tool state
  const [lineStart, setLineStart] = useState<{ gx: number; gy: number } | null>(
    null,
  );
  const [linePreview, setLinePreview] = useState<{ gx: number; gy: number }[]>(
    [],
  );

  const worldHeight = EDITOR_HEIGHT * GRID_SIZE;

  // Clear obstacle selection when switching to a non-select tool; reset tool rotation when leaving obstacle tools
  useEffect(() => {
    if (tool !== "none") setSelectedObstacleKey(null);
    if (!obstacleDefMap.has(tool)) pendingToolRotRef.current = 0;
  }, [tool]);

  // R key: quick-rotate obstacle 90° clockwise
  useEffect(() => {
    if (testing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "r" && e.key !== "R") return;
      // Don't fire when typing in an input
      if ((e.target as HTMLElement).tagName === "INPUT") return;

      if (selectedObstacleKey) {
        // Rotate the selected placed obstacle
        setObstacleParams((prev) => {
          const def = obstacleDefMap.get(obstacles[selectedObstacleKey]);
          if (!def) return prev;
          const existing = (prev[selectedObstacleKey] as any) ?? {
            ...def.defaultParams,
          };
          return {
            ...prev,
            [selectedObstacleKey]: {
              ...existing,
              rotation: ((existing.rotation ?? 0) + 90) % 360,
            },
          };
        });
      } else if (obstacleDefMap.has(tool)) {
        if (pendingObstacleParamsRef.current) {
          // Rotate the carried (picked-up) obstacle
          const p = pendingObstacleParamsRef.current as any;
          pendingObstacleParamsRef.current = {
            ...p,
            rotation: ((p.rotation ?? 0) + 90) % 360,
          } as ObstacleParams;
        } else {
          // Accumulate rotation for the next fresh placement
          pendingToolRotRef.current = (pendingToolRotRef.current + 90) % 360;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [testing, tool, selectedObstacleKey, obstacles]);

  // Draw the editor grid
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const w = canvas.width;
    const h = canvas.height;

    // Clear
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#1A1A2E";
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

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
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
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(0, refY);
    ctx.lineTo(vw, refY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Compute individual rail segments for polyline rendering
    const individualSegs = buildIndividualSegmentsFromRailSegments(segments);

    // Obstacle tiles — grid squares
    for (const [key, type] of Object.entries(obstacles)) {
      const [gx, gy] = parseTileKey(key);
      const sx = gx * GRID_SIZE - cx;
      const sy = gy * GRID_SIZE - cy;
      if (
        sx < -GRID_SIZE ||
        sx > vw + GRID_SIZE ||
        sy < -GRID_SIZE ||
        sy > vh + GRID_SIZE
      )
        continue;
      {
        const def = obstacleDefMap.get(type);
        if (def) {
          ctx.fillStyle = def.tileColor;
          ctx.fillRect(sx + 2, sy + 2, GRID_SIZE - 4, GRID_SIZE - 4);
          ctx.font = `${GRID_SIZE * 0.6}px system-ui`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = "white";
          ctx.fillText(def.emoji, sx + GRID_SIZE / 2, sy + GRID_SIZE / 2);

          // Selection highlight
          if (key === selectedObstacleKey) {
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(sx + 1, sy + 1, GRID_SIZE - 2, GRID_SIZE - 2);
            ctx.setLineDash([]);
          }

          // Show reach overlay when this tile is selected OR when cursor hovers it
          const isSelected = key === selectedObstacleKey;
          const isHovered =
            mouseWorld != null &&
            Math.floor(mouseWorld.x / GRID_SIZE) === gx &&
            Math.floor(mouseWorld.y / GRID_SIZE) === gy;
          if (isSelected || isHovered) {
            const params = resolveParams(type, obstacleParams[key]);
            if (params) {
              const worldX = (gx + 0.5) * GRID_SIZE;
              const worldY = (gy + 0.5) * GRID_SIZE;
              const zones = def.getReach(params as any);
              const rotRad = (((params as any).rotation ?? 0) * Math.PI) / 180;
              drawReach(ctx, zones, worldX - cx, worldY - cy, rotRad);
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
        let params =
          pendingObstacleParamsRef.current ??
          resolveParams(tool, obstacleParams[key]);
        // When not carrying a picked-up obstacle, factor in the pending tool rotation
        if (
          params &&
          !pendingObstacleParamsRef.current &&
          pendingToolRotRef.current !== 0
        ) {
          params = {
            ...params,
            rotation:
              ((params as any).rotation ?? 0) + pendingToolRotRef.current,
          } as ObstacleParams;
        }
        if (params) {
          const worldX = (hoverGx + 0.5) * GRID_SIZE;
          const worldY = (hoverGy + 0.5) * GRID_SIZE;
          const zones = def.getReach(params as any);
          const rotRad = (((params as any).rotation ?? 0) * Math.PI) / 180;
          drawReach(ctx, zones, worldX - cx, worldY - cy, rotRad);
          // Ghost tile preview
          ctx.globalAlpha = 0.55;
          const sx = hoverGx * GRID_SIZE - cx;
          const sy = hoverGy * GRID_SIZE - cy;
          ctx.fillStyle = def.tileColor;
          ctx.fillRect(sx + 2, sy + 2, GRID_SIZE - 4, GRID_SIZE - 4);
          ctx.font = `${GRID_SIZE * 0.6}px system-ui`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = "white";
          ctx.fillText(def.emoji, worldX - cx, worldY - cy);
          ctx.globalAlpha = 1.0;
        }
      }
    }

    // Collectible stars — grid squares
    for (const [key] of Object.entries(stars)) {
      const [gx, gy] = parseTileKey(key);
      const sx = gx * GRID_SIZE - cx;
      const sy = gy * GRID_SIZE - cy;
      if (sx < -GRID_SIZE || sx > vw + GRID_SIZE || sy < -GRID_SIZE || sy > vh + GRID_SIZE)
        continue;
      ctx.fillStyle = "rgba(255, 215, 0, 0.3)";
      ctx.fillRect(sx + 2, sy + 2, GRID_SIZE - 4, GRID_SIZE - 4);
      ctx.font = `${GRID_SIZE * 0.6}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("⭐", sx + GRID_SIZE / 2, sy + GRID_SIZE / 2);
    }

    // Arc preview
    if (arcPreview.length > 0) {
      ctx.fillStyle = "rgba(255,215,0,0.4)";
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
      ctx.strokeStyle = "#00FF88";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(acx, acy, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#00FF88";
      ctx.beginPath();
      ctx.arc(acx, acy, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    // Curve / circular curve preview: draw smooth arc/bezier (no tiles)
    if (
      curveStart &&
      curveEnd &&
      curveControl &&
      (tool === "curve" || tool === "circular_curve")
    ) {
      const wStart = {
        x: curveStart.gx * GRID_SIZE,
        y: curveStart.gy * GRID_SIZE,
      };
      const wEnd = { x: curveEnd.gx * GRID_SIZE, y: curveEnd.gy * GRID_SIZE };
      const wPivot = {
        x: curveControl.gx * GRID_SIZE,
        y: curveControl.gy * GRID_SIZE,
      };
      const pts =
        tool === "circular_curve"
          ? sampleCircularArcWorld(wStart, wEnd, wPivot)
          : sampleBezierWorld(wStart, wEnd, wPivot);
      ctx.strokeStyle = "rgba(100,200,255,0.9)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(pts[0].x - cx, pts[0].y - cy);
      for (let i = 1; i < pts.length; i++)
        ctx.lineTo(pts[i].x - cx, pts[i].y - cy);
      ctx.stroke();
    }

    // Curve / circular curve start/end markers
    if (curveStart) {
      const csx = curveStart.gx * GRID_SIZE + GRID_SIZE / 2 - cx;
      const csy = curveStart.gy * GRID_SIZE + GRID_SIZE / 2 - cy;
      ctx.strokeStyle = "#64C8FF";
      ctx.lineWidth = 3;
      ctx.strokeRect(
        curveStart.gx * GRID_SIZE - cx + 1,
        curveStart.gy * GRID_SIZE - cy + 1,
        GRID_SIZE - 2,
        GRID_SIZE - 2,
      );
      ctx.fillStyle = "#64C8FF";
      ctx.font = "bold 10px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("A", csx, csy);
    }
    if (curveEnd) {
      const cex = curveEnd.gx * GRID_SIZE + GRID_SIZE / 2 - cx;
      const cey = curveEnd.gy * GRID_SIZE + GRID_SIZE / 2 - cy;
      ctx.strokeStyle = "#FF64C8";
      ctx.lineWidth = 3;
      ctx.strokeRect(
        curveEnd.gx * GRID_SIZE - cx + 1,
        curveEnd.gy * GRID_SIZE - cy + 1,
        GRID_SIZE - 2,
        GRID_SIZE - 2,
      );
      ctx.fillStyle = "#FF64C8";
      ctx.font = "bold 10px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("B", cex, cey);
    }
    // Curve / circular curve control point marker
    if (curveControl && curveStart && curveEnd) {
      const ccx = curveControl.gx * GRID_SIZE + GRID_SIZE / 2 - cx;
      const ccy = curveControl.gy * GRID_SIZE + GRID_SIZE / 2 - cy;
      ctx.strokeStyle = "#FFFF00";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(
        curveStart.gx * GRID_SIZE + GRID_SIZE / 2 - cx,
        curveStart.gy * GRID_SIZE + GRID_SIZE / 2 - cy,
      );
      ctx.lineTo(ccx, ccy);
      ctx.lineTo(
        curveEnd.gx * GRID_SIZE + GRID_SIZE / 2 - cx,
        curveEnd.gy * GRID_SIZE + GRID_SIZE / 2 - cy,
      );
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(ccx, ccy, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#FFFF00";
      ctx.fill();
    }

    // Autoconnect preview: show dashed line from hovered cell to nearby segment endpoints
    if (
      autoconnect &&
      mouseWorld &&
      (tool === "rail" ||
        tool === "rail_crossing" ||
        tool === "rail_start" ||
        tool === "rail_end")
    ) {
      const hgx = Math.floor(mouseWorld.x / GRID_SIZE);
      const hgy = Math.floor(mouseWorld.y / GRID_SIZE);
      const hWorld = { x: (hgx + 0.5) * GRID_SIZE, y: (hgy + 0.5) * GRID_SIZE };
      const maxDist = snapRadius; // snap radius for autoconnect preview
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "rgba(0, 230, 118, 0.6)";
      ctx.lineWidth = 2;
      const snapPts = getSnapPoints(individualSegs);
      for (const sp of snapPts) {
        const d = Math.hypot(sp.point.x - hWorld.x, sp.point.y - hWorld.y);
        if (d > 0.1 && d < maxDist) {
          ctx.beginPath();
          ctx.moveTo(hWorld.x - cx, hWorld.y - cy);
          ctx.lineTo(sp.point.x - cx, sp.point.y - cy);
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
    }

    // ── Individual rail segments as polylines ──────────────────────────────
    for (const seg of individualSegs) {
      if (seg.points.length < 2) {
        // Single-point segment: draw as a dot
        ctx.fillStyle = "#AAA";
        ctx.beginPath();
        ctx.arc(seg.points[0].x - cx, seg.points[0].y - cy, 4, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.strokeStyle = "#AAA";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(seg.points[0].x - cx, seg.points[0].y - cy);
      for (let i = 1; i < seg.points.length; i++) {
        ctx.lineTo(seg.points[i].x - cx, seg.points[i].y - cy);
      }
      ctx.stroke();
    }

    // Snappoint markers at each segment endpoint
    const snaps = getSnapPoints(individualSegs);
    for (const snap of snaps) {
      ctx.fillStyle = "rgba(0, 230, 118, 0.7)";
      ctx.beginPath();
      ctx.arc(snap.point.x - cx, snap.point.y - cy, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Rail start / end markers
    for (const [marker, color, label] of [
      [startMarker, "#00E676", "S"],
      [endMarker, "#FF4081", "E"],
    ] as [{ x: number; y: number } | null, string, string][]) {
      if (!marker) continue;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(marker.x - cx, marker.y - cy, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#000";
      ctx.font = "bold 10px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, marker.x - cx, marker.y - cy);
    }

    // Snap points for endpoint hints — all segments are unified now, no separate "base" needed
    const baseSnaps = getSnapPoints(individualSegs);

    // Build continuous segments + lookups for hover/eraser
    const continuousSegs = buildContinuousSegments(individualSegs);
    const indivIdToContSeg: Record<string, (typeof continuousSegs)[0]> = {};
    for (const cont of continuousSegs) {
      for (const iid of cont.individualIds) indivIdToContSeg[iid] = cont;
    }
    const indivById: Record<string, (typeof individualSegs)[0]> = {};
    for (const seg of individualSegs) indivById[seg.id] = seg;

    // Point-to-line-segment distance helper
    const ptSegDist = (
      px: number,
      py: number,
      ax: number,
      ay: number,
      bx: number,
      by: number,
    ) => {
      const dx = bx - ax,
        dy = by - ay;
      const lenSq = dx * dx + dy * dy;
      if (lenSq === 0) return Math.hypot(px - ax, py - ay);
      const t = Math.max(
        0,
        Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq),
      );
      return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    };

    // Find nearest individual segment to a world point
    const findNearestIndividual = (mx: number, my: number) => {
      let bestSeg: (typeof individualSegs)[0] | null = null;
      let bestDist = Infinity;
      for (const seg of individualSegs) {
        if (seg.points.length < 2) {
          const d = Math.hypot(mx - seg.points[0].x, my - seg.points[0].y);
          if (d < bestDist) {
            bestDist = d;
            bestSeg = seg;
          }
          continue;
        }
        for (let i = 0; i < seg.points.length - 1; i++) {
          const d = ptSegDist(
            mx,
            my,
            seg.points[i].x,
            seg.points[i].y,
            seg.points[i + 1].x,
            seg.points[i + 1].y,
          );
          if (d < bestDist) {
            bestDist = d;
            bestSeg = seg;
          }
        }
      }
      return bestSeg && bestDist <= 60
        ? { seg: bestSeg, dist: bestDist }
        : null;
    };

    // Segment hover highlight — hand tool, line2, draw_rail, eraser
    const showHoverHighlight =
      tool === "none" ||
      tool === "line2" ||
      (tool === "draw_rail" && !drawRailPoints && !drawRailPending) ||
      tool === "eraser";
    if (showHoverHighlight && mouseWorld) {
      const nearest = findNearestIndividual(mouseWorld.x, mouseWorld.y);
      if (nearest) {
        const cont = indivIdToContSeg[nearest.seg.id];
        if (cont) {
          // Highlight all individual segments in the continuous segment (cyan)
          ctx.strokeStyle = "rgba(0, 200, 255, 0.5)";
          ctx.lineWidth = 6;
          for (const iid of cont.individualIds) {
            const iseg = indivById[iid];
            if (!iseg || iseg.points.length < 2) continue;
            ctx.beginPath();
            ctx.moveTo(iseg.points[0].x - cx, iseg.points[0].y - cy);
            for (let i = 1; i < iseg.points.length; i++)
              ctx.lineTo(iseg.points[i].x - cx, iseg.points[i].y - cy);
            ctx.stroke();
          }
        }
        // Highlight the specific hovered individual segment in a darker blue
        // Skip when near a snappoint in line2/draw_rail — the snappoint pair highlight takes over
        const nearSnap = (tool === "line2" || (tool === "draw_rail" && !drawRailPoints && !drawRailPending))
          && mouseWorld && baseSnaps.some(sp =>
            Math.hypot(mouseWorld.x - sp.point.x, mouseWorld.y - sp.point.y) <= snapRadius);
        if (tool !== "eraser" && !nearSnap && nearest.seg.points.length >= 2) {
          ctx.strokeStyle = "rgba(0, 100, 200, 0.8)";
          ctx.lineWidth = 8;
          ctx.beginPath();
          ctx.moveTo(nearest.seg.points[0].x - cx, nearest.seg.points[0].y - cy);
          for (let i = 1; i < nearest.seg.points.length; i++)
            ctx.lineTo(nearest.seg.points[i].x - cx, nearest.seg.points[i].y - cy);
          ctx.stroke();
        }
        // Eraser: additionally highlight the specific individual segment in red
        if (tool === "eraser" && nearest.seg.points.length >= 2) {
          ctx.strokeStyle = "rgba(255, 80, 80, 0.7)";
          ctx.lineWidth = 8;
          ctx.beginPath();
          ctx.moveTo(
            nearest.seg.points[0].x - cx,
            nearest.seg.points[0].y - cy,
          );
          for (let i = 1; i < nearest.seg.points.length; i++)
            ctx.lineTo(
              nearest.seg.points[i].x - cx,
              nearest.seg.points[i].y - cy,
            );
          ctx.stroke();
        } else if (tool === "eraser" && nearest.seg.points.length === 1) {
          // Single-point segment: red circle
          ctx.fillStyle = "rgba(255, 80, 80, 0.7)";
          ctx.beginPath();
          ctx.arc(
            nearest.seg.points[0].x - cx,
            nearest.seg.points[0].y - cy,
            8,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      }
    }

    // Endpoint hints for line2, draw_rail, and tile-based rail tools
    if (
      tool === "line2" ||
      tool === "rail" ||
      tool === "rail_crossing" ||
      (tool === "draw_rail" && !drawRailPoints && !drawRailPending)
    ) {
      // Build hints from all segment endpoints (preserve segmentId for highlight)
      const hints: { pt: { x: number; y: number }; segmentId: string }[] = baseSnaps.map((sp) => ({
        pt: sp.point,
        segmentId: sp.segmentId,
      }));

      // Find hover target with cycle disambiguation for overlapping points
      let hoverHint: (typeof hints)[0] | null = null;
      let hoverOverlapCount = 0;
      let hoverPartnerOf: Record<string, string> = {};
      if (mouseWorld) {
        const withDist = hints.map((h) => ({
          ...h,
          dist: Math.hypot(mouseWorld.x - h.pt.x, mouseWorld.y - h.pt.y),
        }));
        const inRange = withDist
          .filter((h) => h.dist <= snapRadius)
          .sort((a, b) => a.dist - b.dist);
        if (inRange.length > 0) {
          const best = inRange[0];
          const { items: overlapping, partnerOf } = dedupOverlapping(inRange.filter(
            (h) => Math.hypot(h.pt.x - best.pt.x, h.pt.y - best.pt.y) < 5,
          ));
          hoverPartnerOf = partnerOf;
          hoverOverlapCount = overlapping.length;
          // Update snap cycle position tracking
          const sc = snapCycleRef.current;
          const nearPrev =
            Math.hypot(mouseWorld.x - sc.worldX, mouseWorld.y - sc.worldY) < 30;
          if (!nearPrev) {
            sc.worldX = mouseWorld.x;
            sc.worldY = mouseWorld.y;
            sc.index = 0;
          }
          if (overlapping.length > 1) {
            const idx =
              ((sc.index % overlapping.length) + overlapping.length) %
              overlapping.length;
            hoverHint = overlapping[idx];
          } else {
            hoverHint = best;
          }
        }
      }

      for (const h of hints) {
        const isActive = hoverHint && h === hoverHint;
        const isOverlap =
          hoverHint &&
          !isActive &&
          Math.hypot(h.pt.x - hoverHint.pt.x, h.pt.y - hoverHint.pt.y) < 5;
        ctx.strokeStyle = isActive
          ? "rgba(0, 255, 136, 0.9)"
          : isOverlap
            ? "rgba(255, 200, 0, 0.6)"
            : "rgba(0, 255, 136, 0.35)";
        ctx.lineWidth = isActive ? 3 : 2;
        ctx.beginPath();
        ctx.arc(h.pt.x - cx, h.pt.y - cy, isActive ? 9 : 7, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Show cycle indicator when multiple snap points overlap
      if (hoverHint && hoverOverlapCount > 1) {
        const sc = snapCycleRef.current;
        const idx =
          ((sc.index % hoverOverlapCount) + hoverOverlapCount) %
          hoverOverlapCount;
        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        ctx.font = "bold 12px system-ui";
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        ctx.fillText(
          `${idx + 1}/${hoverOverlapCount} (scroll to switch)`,
          hoverHint.pt.x - cx + 14,
          hoverHint.pt.y - cy - 4,
        );
      }

      // Highlight the individual segments meeting at the currently hovered/cycled snappoint
      if (hoverHint) {
        const segIds = [hoverHint.segmentId];
        const partnerId = hoverPartnerOf[hoverHint.segmentId];
        if (partnerId) segIds.push(partnerId);
        ctx.strokeStyle = "rgba(0, 100, 200, 0.8)";
        ctx.lineWidth = 8;
        for (const sid of segIds) {
          const iseg = indivById[sid];
          if (!iseg || iseg.points.length < 2) continue;
          ctx.beginPath();
          ctx.moveTo(iseg.points[0].x - cx, iseg.points[0].y - cy);
          for (let i = 1; i < iseg.points.length; i++)
            ctx.lineTo(iseg.points[i].x - cx, iseg.points[i].y - cy);
          ctx.stroke();
        }
      }
    }

    // Line2 preview line (after picking start)
    if (tool === "line2" && line2Start && mouseWorld) {
      const previewGridX = Math.floor(mouseWorld.x / GRID_SIZE);
      const previewGridY = Math.floor(mouseWorld.y / GRID_SIZE);
      const previewKey = tileKey(previewGridX, previewGridY);
      const previewCenter = {
        x: (previewGridX + 0.5) * GRID_SIZE,
        y: (previewGridY + 0.5) * GRID_SIZE,
      };
      const previewTileEmpty =
        !obstacles[previewKey] &&
        !isWorldPtOccupied(previewCenter.x, previewCenter.y);
      const previewEnd =
        line2GridSnap && previewTileEmpty ? previewCenter : mouseWorld;

      ctx.strokeStyle = "rgba(0, 204, 102, 0.9)";
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(line2Start.start.x - cx, line2Start.start.y - cy);
      ctx.lineTo(previewEnd.x - cx, previewEnd.y - cy);
      ctx.stroke();
      ctx.setLineDash([]);

      // Tile-length label at midpoint of the free line preview
      const dx = previewEnd.x - line2Start.start.x;
      const dy = previewEnd.y - line2Start.start.y;
      const lineLenPx = Math.sqrt(dx * dx + dy * dy);
      const lineTiles = Math.round(lineLenPx / GRID_SIZE) + 1;
      const midSx = (line2Start.start.x + previewEnd.x) / 2 - cx;
      const midSy = (line2Start.start.y + previewEnd.y) / 2 - cy;
      const lenText = `${lineTiles}`;
      ctx.font = "bold 11px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      const ltw = ctx.measureText(lenText).width;
      ctx.fillRect(midSx - ltw / 2 - 3, midSy - 18, ltw + 6, 14);
      ctx.fillStyle = "#00FF88";
      ctx.fillText(lenText, midSx, midSy - 5);
    }

    // Draw rail: live drawing preview
    if (drawRailPoints && drawRailPoints.length >= 2) {
      ctx.strokeStyle = "rgba(0, 204, 102, 0.9)";
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(drawRailPoints[0].x - cx, drawRailPoints[0].y - cy);
      for (let i = 1; i < drawRailPoints.length; i++) {
        ctx.lineTo(drawRailPoints[i].x - cx, drawRailPoints[i].y - cy);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      // Snap indicator at start
      if (drawRailAttach) {
        ctx.fillStyle = "#0f0";
        ctx.beginPath();
        ctx.arc(
          drawRailAttach.start.x - cx,
          drawRailAttach.start.y - cy,
          5,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }

    // Draw rail: smoothing preview (pending confirmation)
    if (drawRailPending) {
      const smoothed = smoothDrawnRail(drawRailPending.raw, drawRailSmoothness);
      // Raw path in faint gray
      ctx.strokeStyle = "rgba(153, 153, 153, 0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(drawRailPending.raw[0].x - cx, drawRailPending.raw[0].y - cy);
      for (let i = 1; i < drawRailPending.raw.length; i++) {
        ctx.lineTo(
          drawRailPending.raw[i].x - cx,
          drawRailPending.raw[i].y - cy,
        );
      }
      ctx.stroke();
      // Smoothed path in solid green
      if (smoothed.length >= 2) {
        ctx.strokeStyle = "#00aa00";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(smoothed[0].x - cx, smoothed[0].y - cy);
        for (let i = 1; i < smoothed.length; i++) {
          ctx.lineTo(smoothed[i].x - cx, smoothed[i].y - cy);
        }
        ctx.stroke();
      }
      // Snap indicators
      if (drawRailPending.attach) {
        ctx.fillStyle = "#0f0";
        ctx.beginPath();
        ctx.arc(
          drawRailPending.attach.start.x - cx,
          drawRailPending.attach.start.y - cy,
          5,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      if (drawRailPending.endSnap) {
        ctx.fillStyle = "#0f0";
        ctx.beginPath();
        ctx.arc(
          drawRailPending.endSnap.pt.x - cx,
          drawRailPending.endSnap.pt.y - cy,
          5,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }

    // Line preview
    if (linePreview.length > 0) {
      ctx.fillStyle = "rgba(0,200,100,0.4)";
      for (const p of linePreview) {
        const sx2 = p.gx * GRID_SIZE - cx;
        const sy2 = p.gy * GRID_SIZE - cy;
        ctx.fillRect(sx2 + 2, sy2 + 2, GRID_SIZE - 4, GRID_SIZE - 4);
      }
      // Tile count label near the last tile in the preview
      const lastTile = linePreview[linePreview.length - 1];
      const lblX = lastTile.gx * GRID_SIZE + GRID_SIZE / 2 - cx;
      const lblY = lastTile.gy * GRID_SIZE - 6 - cy;
      const countText = `${linePreview.length}`;
      ctx.font = "bold 11px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      const tw = ctx.measureText(countText).width;
      ctx.fillRect(lblX - tw / 2 - 3, lblY - 12, tw + 6, 14);
      ctx.fillStyle = "#00FF88";
      ctx.fillText(countText, lblX, lblY);
    }

    // Line start marker
    if (lineStart) {
      const lsx = lineStart.gx * GRID_SIZE + GRID_SIZE / 2 - cx;
      const lsy = lineStart.gy * GRID_SIZE + GRID_SIZE / 2 - cy;
      ctx.strokeStyle = "#00CC66";
      ctx.lineWidth = 3;
      ctx.strokeRect(
        lineStart.gx * GRID_SIZE - cx + 1,
        lineStart.gy * GRID_SIZE - cy + 1,
        GRID_SIZE - 2,
        GRID_SIZE - 2,
      );
      ctx.fillStyle = "#00CC66";
      ctx.font = "bold 10px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("A", lsx, lsy);
    }

    // Reset transform for HUD overlays
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Instructions
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, h - 30, w, 30);
    ctx.fillStyle = "#AAA";
    ctx.font = "12px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      `Middle-click / Right-click drag to pan • +/- to zoom (${Math.round(zoom * 100)}%) • Click to place tiles`,
      w / 2,
      h - 15,
    );
  }, [
    camera,
    segments,
    obstacles,
    startMarker,
    endMarker,
    tool,
    arcCenter,
    arcPreview,
    zoom,
    curveStart,
    curveEnd,
    curveControl,
    lineStart,
    linePreview,
    line2Start,
    line2GridSnap,
    mouseWorld,
    obstacleParams,
    selectedObstacleKey,
    drawRailPoints,
    drawRailAttach,
    drawRailPending,
    drawRailSmoothness,
  ]);

  // Resize & render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || testing) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    let frame: number;
    const loop = () => {
      render();
      frame = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      window.removeEventListener("resize", resize);
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
  const generateArc = (
    centerGX: number,
    centerGY: number,
    targetGX: number,
    targetGY: number,
  ) => {
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
      if (
        points.length === 0 ||
        points[points.length - 1].gx !== gx ||
        points[points.length - 1].gy !== gy
      ) {
        points.push({ gx, gy });
      }
    }
    return points;
  };

  // Generate a discrete circle path around a center using only straight and
  // diagonal steps on the grid.
  const generateCircleRail = (
    centerGX: number,
    centerGY: number,
    edgeGX: number,
    edgeGY: number,
  ) => {
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
    control: { gx: number; gy: number },
  ) => {
    // Sample the bezier at high resolution
    const dist = Math.sqrt((end.gx - start.gx) ** 2 + (end.gy - start.gy) ** 2);
    const steps = Math.max(20, Math.round(dist * 6));
    const rawPoints: { gx: number; gy: number }[] = [];

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      const gx = Math.round(
        mt * mt * start.gx + 2 * mt * t * control.gx + t * t * end.gx,
      );
      const gy = Math.round(
        mt * mt * start.gy + 2 * mt * t * control.gy + t * t * end.gy,
      );
      if (
        rawPoints.length === 0 ||
        rawPoints[rawPoints.length - 1].gx !== gx ||
        rawPoints[rawPoints.length - 1].gy !== gy
      ) {
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
      let x0 = rawPoints[i - 1].gx,
        y0 = rawPoints[i - 1].gy;
      const x1 = rawPoints[i].gx,
        y1 = rawPoints[i].gy;
      const dx = Math.abs(x1 - x0),
        dy = Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1,
        sy = y0 < y1 ? 1 : -1;
      let err = dx - dy;

      while (true) {
        addPoint(x0, y0);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        // Prefer stepping in the dominant direction only (no diagonals)
        if (e2 > -dy && e2 < dx) {
          // Would be diagonal - pick the dominant axis
          if (dx > dy) {
            err -= dy;
            x0 += sx;
          } else {
            err += dx;
            y0 += sy;
          }
        } else if (e2 > -dy) {
          err -= dy;
          x0 += sx;
        } else {
          err += dx;
          y0 += sy;
        }
      }
    }

    return result;
  };

  const generateLine = (
    start: { gx: number; gy: number },
    end: { gx: number; gy: number },
  ) => {
    const points: { gx: number; gy: number }[] = [];
    let x0 = start.gx,
      y0 = start.gy;
    const x1 = end.gx,
      y1 = end.gy;
    const dx = Math.abs(x1 - x0),
      dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1,
      sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while (true) {
      points.push({ gx: x0, gy: y0 });
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
    }
    return points;
  };

  const generateCircularArc = (
    start: { gx: number; gy: number },
    end: { gx: number; gy: number },
    pivot: { gx: number; gy: number },
  ) => {
    // Fallback to straight line if points are degenerate or nearly collinear.
    if (
      (start.gx === end.gx && start.gy === end.gy) ||
      (start.gx === pivot.gx && start.gy === pivot.gy) ||
      (end.gx === pivot.gx && end.gy === pivot.gy)
    ) {
      return generateLine(start, end);
    }

    const x1 = start.gx,
      y1 = start.gy;
    const x2 = end.gx,
      y2 = end.gy;
    const x3 = pivot.gx,
      y3 = pivot.gy;

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
      let f = from,
        t = to,
        m = mid;
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
      setPanStart({
        x: e.clientX / zoom + camera.x,
        y: e.clientY / zoom + camera.y,
      });
      return;
    }

    if (e.button === 0) {
      const { gx, gy } = screenToGrid(e.clientX, e.clientY);
      const world = screenToWorld(e.clientX, e.clientY);

      // Arc tool: first click sets center, second click uses current radius
      // to generate a circular rail loop (grid-snapped).
      if (tool === "arc") {
        if (!arcCenter) {
          setArcCenter({ gx, gy });
        } else {
          const points = generateArc(arcCenter.gx, arcCenter.gy, gx, gy);
          if (points.length >= 2) {
            const worldPts = filterOccupiedPoints(
              points.map((p) => ({
                x: (p.gx + 0.5) * GRID_SIZE,
                y: (p.gy + 0.5) * GRID_SIZE,
              })),
            );
            if (worldPts.length >= 2)
              setSegments((prev) => [...prev, { points: worldPts }]);
          }
          setArcCenter(null);
          setArcPreview([]);
        }
        return;
      }

      // Curve tools: click start, click end, then click/drag control point.
      if (tool === "curve" || tool === "circular_curve") {
        if (!curveStart) {
          setCurveStart({ gx, gy });
        } else if (!curveEnd) {
          setCurveEnd({ gx, gy });
          const mid = {
            gx: Math.round((curveStart.gx + gx) / 2),
            gy: Math.round((curveStart.gy + gy) / 2),
          };
          setCurveControl(mid);
          setCurvePreview(
            tool === "curve"
              ? generateBezierCurve(curveStart, { gx, gy }, mid)
              : generateCircularArc(curveStart, { gx, gy }, mid),
          );
        } else {
          setIsDraggingCurve(true);
          setCurveControl({ gx, gy });
          setCurvePreview(
            tool === "curve"
              ? generateBezierCurve(curveStart, curveEnd, { gx, gy })
              : generateCircularArc(curveStart, curveEnd, { gx, gy }),
          );
        }
        return;
      }

      // Circle tool: first click sets center, second click sets radius and
      // creates a circular rail loop using only straight and diagonal steps.
      if (tool === "circle") {
        if (!arcCenter) {
          setArcCenter({ gx, gy });
        } else {
          const points = generateCircleRail(arcCenter.gx, arcCenter.gy, gx, gy);
          if (points.length >= 2) {
            const worldPts = filterOccupiedPoints(
              points.map((p) => ({
                x: (p.gx + 0.5) * GRID_SIZE,
                y: (p.gy + 0.5) * GRID_SIZE,
              })),
            );
            if (worldPts.length >= 2)
              setSegments((prev) => [...prev, { points: worldPts }]);
          }
          setArcCenter(null);
          setArcPreview([]);
        }
        return;
      }

      if (tool === "line") {
        if (!lineStart) {
          setLineStart({ gx, gy });
        } else {
          const points = generateLine(lineStart, { gx, gy });
          if (points.length >= 2) {
            const worldPts = points.map((p) => ({
              x: (p.gx + 0.5) * GRID_SIZE,
              y: (p.gy + 0.5) * GRID_SIZE,
            }));
            setSegments((prev) => [...prev, { points: worldPts }]);
          }
          if (continuousLine) {
            setLineStart({ gx, gy });
          } else {
            setLineStart(null);
          }
          setLinePreview([]);
        }
        return;
      }

      if (tool === "line2") {
        const clickedKey = tileKey(gx, gy);
        const clickedTileCenter = {
          x: (gx + 0.5) * GRID_SIZE,
          y: (gy + 0.5) * GRID_SIZE,
        };
        const clickedTileEmpty =
          !obstacles[clickedKey] &&
          !isWorldPtOccupied(clickedTileCenter.x, clickedTileCenter.y);
        const line2ClickWorld =
          line2GridSnap && clickedTileEmpty ? clickedTileCenter : world;

        // First click: pick nearest snap point. Use BASE segments (no freeLines) so hints are stable and the selected start is always used.
        if (!line2Start) {
          // Build snap hints from all segment endpoints
          const allSegsForSnap =
            buildIndividualSegmentsFromRailSegments(segments);
          const allSnapPtsForSnap = getSnapPoints(allSegsForSnap);
          type Hint = { pt: { x: number; y: number }; dist: number; segmentId: string };
          const hints: Hint[] = allSnapPtsForSnap.map((sp) => ({
            pt: sp.point,
            dist: Math.hypot(
              line2ClickWorld.x - sp.point.x,
              line2ClickWorld.y - sp.point.y,
            ),
            segmentId: sp.segmentId,
          }));
          // Find all candidates within snap radius, then use cycle index to disambiguate overlapping ones
          const candidates = hints
            .filter((h) => h.dist <= snapRadius)
            .sort((a, b) => a.dist - b.dist);
          if (candidates.length === 0) {
            // No snap point nearby — start a free-standing line
            setLine2Start({ start: line2ClickWorld });
          } else {
            // Group candidates that are at nearly the same position (within 5px), dedup within same continuous segment
            const best = candidates[0];
            const { items: overlapping } = dedupOverlapping(candidates.filter(
              (c) => Math.hypot(c.pt.x - best.pt.x, c.pt.y - best.pt.y) < 5,
            ));
            let chosen: typeof best;
            if (overlapping.length > 1) {
              const sc = snapCycleRef.current;
              const idx =
                ((sc.index % overlapping.length) + overlapping.length) %
                overlapping.length;
              chosen = overlapping[idx];
            } else {
              chosen = best;
            }
            setLine2Start({ start: chosen.pt });
          }
        } else {
          // Second click: free end point anywhere in world space (with snapping to any endpoint)
          // Build snap candidates from all segments (including freeLines)
          const allSegs = buildIndividualSegmentsFromRailSegments(segments);
          const allSnapPts = getSnapPoints(allSegs);
          type SnapCandidate = { pt: { x: number; y: number }; dist: number; segmentId: string };
          const endCandidates: SnapCandidate[] = allSnapPts.map((sp) => ({
            pt: sp.point,
            dist: Math.hypot(
              line2ClickWorld.x - sp.point.x,
              line2ClickWorld.y - sp.point.y,
            ),
            segmentId: sp.segmentId,
          }));
          const validEnd = endCandidates
            .filter((c) => c.dist <= snapRadius)
            .sort((a, b) => a.dist - b.dist);
          let snapEnd: { x: number; y: number } | null = null;
          if (validEnd.length > 0) {
            const bestEnd = validEnd[0];
            const { items: overlappingEnd } = dedupOverlapping(validEnd.filter(
              (c) =>
                Math.hypot(c.pt.x - bestEnd.pt.x, c.pt.y - bestEnd.pt.y) < 5,
            ));
            let chosenEnd: SnapCandidate;
            if (overlappingEnd.length > 1) {
              const sc = snapCycleRef.current;
              const idx =
                ((sc.index % overlappingEnd.length) + overlappingEnd.length) %
                overlappingEnd.length;
              chosenEnd = overlappingEnd[idx];
            } else {
              chosenEnd = bestEnd;
            }
            snapEnd = chosenEnd.pt;
          }
          const endPoint = snapEnd ? snapEnd : line2ClickWorld;
          const startPt = line2Start.start;
          setSegments((prev) => [...prev, { points: [startPt, endPoint] }]);
          if (continuousLine) {
            setLine2Start({ start: endPoint });
          } else {
            setLine2Start(null);
          }
        }
        return;
      }

      // Draw rail tool: mousedown starts freehand drawing
      if (tool === "draw_rail" && !drawRailPending) {
        // Build snap hints from all segments (including freeLines)
        const drawSegs = buildIndividualSegmentsFromRailSegments(segments);
        const drawSnapPts = getSnapPoints(drawSegs);
        type Hint = { pt: { x: number; y: number }; dist: number; segmentId: string };
        const hints: Hint[] = drawSnapPts.map((sp) => ({
          pt: sp.point,
          dist: Math.hypot(world.x - sp.point.x, world.y - sp.point.y),
          segmentId: sp.segmentId,
        }));
        const candidates = hints
          .filter((h) => h.dist <= snapRadius)
          .sort((a, b) => a.dist - b.dist);
        if (candidates.length > 0) {
          const best = candidates[0];
          const { items: overlapping } = dedupOverlapping(candidates.filter(
            (c) => Math.hypot(c.pt.x - best.pt.x, c.pt.y - best.pt.y) < 5,
          ));
          let chosen =
            overlapping.length > 1
              ? overlapping[
                  ((snapCycleRef.current.index % overlapping.length) +
                    overlapping.length) %
                    overlapping.length
                ]
              : best;
          setDrawRailAttach({ start: chosen.pt });
          setDrawRailPoints([chosen.pt]);
        } else {
          // Unsnapped start
          setDrawRailAttach(null);
          setDrawRailPoints([world]);
        }
        return;
      }

      // None tool: first click selects, second click on selected tile "picks it up"
      if (tool === "none") {
        const key = tileKey(gx, gy);
        const obsType = obstacles[key];
        if (obsType && obstacleDefMap.has(obsType)) {
          if (selectedObstacleKey === key) {
            // Second click: pick up — remove obstacle, carry its params, switch to that obstacle tool
            pendingObstacleParamsRef.current = obstacleParams[key]
              ? { ...obstacleParams[key] }
              : null;
            setSelectedObstacleKey(null);
            setObstacleParams((prev) => {
              const next = { ...prev };
              delete next[key];
              return next;
            });
            setObstacles((prev) => {
              const next = { ...prev };
              delete next[key];
              return next;
            });
            setTool(obsType as EditorTool);
          } else {
            setSelectedObstacleKey(key);
          }
        } else {
          setSelectedObstacleKey(null);
        }
        return;
      }

      // Eraser: find nearest individual rail segment and delete it
      if (tool === "eraser") {
        const eraserSegs = buildIndividualSegmentsFromRailSegments(segments);
        const ptSegDist = (
          px: number,
          py: number,
          ax: number,
          ay: number,
          bx: number,
          by: number,
        ) => {
          const dx = bx - ax,
            dy = by - ay;
          const lenSq = dx * dx + dy * dy;
          if (lenSq === 0) return Math.hypot(px - ax, py - ay);
          const t = Math.max(
            0,
            Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq),
          );
          return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
        };

        const ERASE_THRESHOLD = 15;
        let bestDist = ERASE_THRESHOLD;
        let hitSeg: (typeof eraserSegs)[0] | null = null;

        for (const seg of eraserSegs) {
          if (seg.points.length < 2) {
            const d = Math.hypot(
              world.x - seg.points[0].x,
              world.y - seg.points[0].y,
            );
            if (d < bestDist) {
              bestDist = d;
              hitSeg = seg;
            }
            continue;
          }
          for (let i = 0; i < seg.points.length - 1; i++) {
            const d = ptSegDist(
              world.x,
              world.y,
              seg.points[i].x,
              seg.points[i].y,
              seg.points[i + 1].x,
              seg.points[i + 1].y,
            );
            if (d < bestDist) {
              bestDist = d;
              hitSeg = seg;
            }
          }
        }

        if (hitSeg) {
          // Unified erase: find segment index from hitSeg.id (format: "seg_N")
          const segIdx = parseInt(hitSeg.id.replace("seg_", ""), 10);
          if (!isNaN(segIdx)) {
            setSegments((prev) => prev.filter((_, i) => i !== segIdx));
            lastPlacedRailRef.current = null;
          }
          return;
        }
      }

      // Clicking an existing obstacle of the same type → switch to hand tool and select it
      const clickedKey = tileKey(gx, gy);
      if (obstacles[clickedKey] === (tool as string)) {
        setTool("none");
        if (obstacleDefMap.has(tool)) setSelectedObstacleKey(clickedKey);
        return;
      }

      setIsDrawing(true);
      placeTile(gx, gy);
    }
  };

  // Zoom keeping the canvas center fixed in world space
  const zoomToCenter = (newZoom: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const hw = canvas.width / 2;
    const hh = canvas.height / 2;
    setCamera({
      x: camera.x + hw / zoom - hw / newZoom,
      y: camera.y + hh / zoom - hh / newZoom,
    });
    setZoom(newZoom);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    // When using line2/rail tools, scroll cycles through overlapping snap candidates
    if (
      (tool === "line2" ||
        tool === "rail" ||
        tool === "rail_crossing" ||
        (tool === "draw_rail" && !drawRailPoints && !drawRailPending)) &&
      mouseWorld
    ) {
      const sc = snapCycleRef.current;
      const nearPrev =
        Math.hypot(mouseWorld.x - sc.worldX, mouseWorld.y - sc.worldY) < 30;
      if (nearPrev) {
        sc.index += e.deltaY > 0 ? 1 : -1;
        return; // don't zoom, just cycle
      }
    }
    const delta = e.deltaY;
    if (delta < 0) zoomToCenter(Math.min(3, zoom + 0.25));
    else if (delta > 0) zoomToCenter(Math.max(0.25, zoom - 0.25));
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      const newCam = {
        x: panStart.x - e.clientX / zoom,
        y: panStart.y - e.clientY / zoom,
      };
      setCamera(newCam);
      setMouseWorld({
        x: e.clientX / zoom + newCam.x,
        y: e.clientY / zoom + newCam.y,
      });
      return;
    }
    setMouseWorld(screenToWorld(e.clientX, e.clientY));

    if (isDrawing) {
      const { gx, gy } = screenToGrid(e.clientX, e.clientY);
      placeTile(gx, gy);
    }

    // Arc preview
    if (tool === "arc" && arcCenter) {
      const { gx, gy } = screenToGrid(e.clientX, e.clientY);
      setArcPreview(generateArc(arcCenter.gx, arcCenter.gy, gx, gy));
    }

    // Circle preview
    if (tool === "circle" && arcCenter) {
      const { gx, gy } = screenToGrid(e.clientX, e.clientY);
      setArcPreview(generateCircleRail(arcCenter.gx, arcCenter.gy, gx, gy));
    }

    // Curve / circular curve control point dragging
    if (
      (tool === "curve" || tool === "circular_curve") &&
      curveStart &&
      curveEnd &&
      isDraggingCurve
    ) {
      const { gx, gy } = screenToGrid(e.clientX, e.clientY);
      setCurveControl({ gx, gy });
      setCurvePreview(
        tool === "curve"
          ? generateBezierCurve(curveStart, curveEnd, { gx, gy })
          : generateCircularArc(curveStart, curveEnd, { gx, gy }),
      );
    }

    // Draw rail: append points while dragging (throttled to 8px min distance)
    if (tool === "draw_rail" && drawRailPoints) {
      const world = screenToWorld(e.clientX, e.clientY);
      const last = drawRailPoints[drawRailPoints.length - 1];
      if (Math.hypot(world.x - last.x, world.y - last.y) >= 8) {
        setDrawRailPoints((prev) => (prev ? [...prev, world] : null));
      }
    }

    // Line preview
    if (tool === "line" && lineStart) {
      const { gx, gy } = screenToGrid(e.clientX, e.clientY);
      setLinePreview(generateLine(lineStart, { gx, gy }));
    }
  };

  const handleMouseUp = () => {
    // Place final tile at current mouse position before autoconnect
    // (mousemove may not have fired at the exact release position)
    if (
      isDrawing &&
      mouseWorld &&
      (tool === "rail" || tool === "rail_crossing")
    ) {
      const gx = Math.floor(mouseWorld.x / GRID_SIZE);
      const gy = Math.floor(mouseWorld.y / GRID_SIZE);
      placeTile(gx, gy);
    }

    setIsPanning(false);
    setIsDrawing(false);
    lastPlacedKeyRef.current = null;

    // Autoconnect on mouse release: try to connect the last-placed segment's endpoint to a nearby existing segment
    if (
      autoconnect &&
      lastPlacedRailRef.current &&
      (tool === "rail" || tool === "rail_crossing")
    ) {
      const ref = lastPlacedRailRef.current;
      let keepLastPlacedRail = false;
      setSegments((prev) => {
        const placedSeg = prev[ref.segIdx];
        if (!placedSeg || placedSeg.points.length === 0) return prev;
        const tipPt =
          ref.endpoint === "end"
            ? placedSeg.points[placedSeg.points.length - 1]
            : placedSeg.points[0];
        // Count how many other segments connect to a given point
        const connectionsAt = (
          pt: { x: number; y: number },
          excludeIdx: number,
        ) => {
          let count = 0;
          for (let j = 0; j < prev.length; j++) {
            if (j === excludeIdx || prev[j].points.length === 0) continue;
            const f = prev[j].points[0];
            const l = prev[j].points[prev[j].points.length - 1];
            if (Math.hypot(pt.x - f.x, pt.y - f.y) < TILE_SNAP_RADIUS) count++;
            if (Math.hypot(pt.x - l.x, pt.y - l.y) < TILE_SNAP_RADIUS) count++;
          }
          return count;
        };
        // Find closest snappoint on a *different* segment (skip if already has 2+ connections)
        let bestSnap: {
          segIdx: number;
          endpoint: "start" | "end";
          dist: number;
        } | null = null;
        for (let i = 0; i < prev.length; i++) {
          if (i === ref.segIdx) continue;
          const seg = prev[i];
          if (seg.points.length === 0) continue;
          const first = seg.points[0];
          const last = seg.points[seg.points.length - 1];
          const dFirst = Math.hypot(tipPt.x - first.x, tipPt.y - first.y);
          const dLast = Math.hypot(tipPt.x - last.x, tipPt.y - last.y);
          if (
            dFirst < TILE_SNAP_RADIUS &&
            (!bestSnap || dFirst < bestSnap.dist)
          ) {
            if (connectionsAt(first, i) < 2) {
              bestSnap = { segIdx: i, endpoint: "start", dist: dFirst };
            }
          }
          if (
            dLast < TILE_SNAP_RADIUS &&
            (!bestSnap || dLast < bestSnap.dist)
          ) {
            if (connectionsAt(last, i) < 2) {
              bestSnap = { segIdx: i, endpoint: "end", dist: dLast };
            }
          }
        }
        if (!bestSnap) {
          // No merge target — keep lastPlacedRailRef alive so next click can extend
          keepLastPlacedRail = true;
          return prev;
        }
        // Merge: use distance to determine which end of each segment faces the junction
        const target = prev[bestSnap.segIdx];
        const snapPt =
          bestSnap.endpoint === "end"
            ? target.points[target.points.length - 1]
            : target.points[0];
        // Which end of placed segment is near the snappoint?
        const pFirst = placedSeg.points[0];
        const pLast = placedSeg.points[placedSeg.points.length - 1];
        const firstIsNear =
          Math.hypot(pFirst.x - snapPt.x, pFirst.y - snapPt.y) <=
          Math.hypot(pLast.x - snapPt.x, pLast.y - snapPt.y);
        // Order target so it ends at the snap point
        const targetOrdered =
          bestSnap.endpoint === "end"
            ? target.points
            : [...target.points].reverse();
        // Order placed so the near end comes first (adjacent to the junction)
        const placedOrdered = firstIsNear
          ? placedSeg.points
          : [...placedSeg.points].reverse();
        // Merged: [target_far → snap_point → placed_near → placed_far]
        const mergedPts = [...targetOrdered, ...placedOrdered];
        const merged = { ...target, points: mergedPts };
        // Remove the placed segment, replace the target with merged
        return prev
          .map((s, i) => (i === bestSnap.segIdx ? merged : s))
          .filter((_, i) => i !== ref.segIdx);
      });
      if (!keepLastPlacedRail) {
        lastPlacedRailRef.current = null;
      }
    }

    // Commit curve / circular curve on mouse up: sample to polyline and add as segment
    if (isDraggingCurve && curveStart && curveEnd && curveControl) {
      const wStart = keyToWorld(tileKey(curveStart.gx, curveStart.gy));
      const wEnd = keyToWorld(tileKey(curveEnd.gx, curveEnd.gy));
      const wPivot = keyToWorld(tileKey(curveControl.gx, curveControl.gy));
      const pts =
        tool === "circular_curve"
          ? sampleCircularArcWorld(wStart, wEnd, wPivot)
          : sampleBezierWorld(wStart, wEnd, wPivot);
      if (pts.length >= 2) {
        setSegments((prev) => [...prev, { points: pts }]);
      }
      lastPlacedRailRef.current = null;
      setCurveStart(null);
      setCurveEnd(null);
      setCurveControl(null);
      setCurvePreview([]);
      setIsDraggingCurve(false);
    }

    // Draw rail: finish drawing, transition to smoothness adjustment
    if (tool === "draw_rail" && drawRailPoints && drawRailPoints.length >= 3) {
      // Compute total path length
      let totalLen = 0;
      for (let i = 1; i < drawRailPoints.length; i++) {
        totalLen += Math.hypot(
          drawRailPoints[i].x - drawRailPoints[i - 1].x,
          drawRailPoints[i].y - drawRailPoints[i - 1].y,
        );
      }
      if (totalLen < 30) {
        // Too short — cancel
        setDrawRailPoints(null);
        setDrawRailAttach(null);
        return;
      }
      // Check end snap
      const endWorld = drawRailPoints[drawRailPoints.length - 1];
      // Build snap candidates from all segments (including freeLines)
      const endSegs = buildIndividualSegmentsFromRailSegments(segments);
      const endSnapPts = getSnapPoints(endSegs);
      type SnapCandidate = { pt: { x: number; y: number }; dist: number };
      const endCandidates: SnapCandidate[] = endSnapPts.map((sp) => ({
        pt: sp.point,
        dist: Math.hypot(endWorld.x - sp.point.x, endWorld.y - sp.point.y),
      }));
      const validEnd = endCandidates
        .filter((c) => c.dist <= snapRadius)
        .sort((a, b) => a.dist - b.dist);
      const endSnap = validEnd.length > 0 ? { pt: validEnd[0].pt } : null;
      setDrawRailPending({
        raw: drawRailPoints,
        attach: drawRailAttach,
        endSnap,
      });
      setDrawRailPoints(null);
    } else if (tool === "draw_rail" && drawRailPoints) {
      // Too few points — cancel
      setDrawRailPoints(null);
      setDrawRailAttach(null);
    }
  };

  /** Check if a world point overlaps an existing rail segment point within the same grid cell. */
  /** Check if a world point is near any segment endpoint (snappoint). */
  const isNearSnapPoint = (wx: number, wy: number) => {
    const snapDist = TILE_SNAP_RADIUS;
    return segments.some((seg) => {
      if (seg.points.length === 0) return false;
      const first = seg.points[0];
      const last = seg.points[seg.points.length - 1];
      return (
        Math.hypot(wx - first.x, wy - first.y) < snapDist ||
        Math.hypot(wx - last.x, wy - last.y) < snapDist
      );
    });
  };

  const isWorldPtOccupied = (wx: number, wy: number) => {
    const halfGrid = GRID_SIZE * 0.5;
    return segments.some((seg) =>
      seg.points.some(
        (p) => Math.abs(p.x - wx) < halfGrid && Math.abs(p.y - wy) < halfGrid,
      ),
    );
  };

  /** Filter out world points that overlap existing rail, but keep points near snappoints. */
  const filterOccupiedPoints = (pts: { x: number; y: number }[]) =>
    pts.filter(
      (p) => !isWorldPtOccupied(p.x, p.y) || isNearSnapPoint(p.x, p.y),
    );

  const placeTile = (gx: number, gy: number) => {
    const key = tileKey(gx, gy);
    const worldPt = { x: (gx + 0.5) * GRID_SIZE, y: (gy + 0.5) * GRID_SIZE };

    if (tool === "eraser") {
      // Erase obstacle at grid cell (rail segments are erased via hit-test in mousedown)
      setSelectedObstacleKey((prev) => (prev === key ? null : prev));
      setObstacleParams((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setObstacles((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setStars((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } else if (tool === "star") {
      // Max 3 stars per level
      if (Object.keys(stars).length >= 3 && !stars[key]) return;
      setStars((prev) => ({ ...prev, [key]: "star" }));
    } else if (tool === "rail" || tool === "rail_crossing") {
      // Skip if we already placed on this exact tile during this drag
      if (lastPlacedKeyRef.current === key) return;
      // Prevent placing on a tile that already has rail — unless near a snappoint (to allow connecting)
      if (
        isWorldPtOccupied(worldPt.x, worldPt.y) &&
        !isNearSnapPoint(worldPt.x, worldPt.y)
      )
        return;
      // Rail placement: extend existing segment endpoint or create new segment
      // First try lastPlacedRailRef, then fall back to nearest endpoint search
      let extendIdx = -1;
      let extendEndpoint: "start" | "end" = "end";
      const lastRef = lastPlacedRailRef.current;
      if (lastRef) {
        const seg = segments[lastRef.segIdx];
        if (seg) {
          const endpoint =
            lastRef.endpoint === "end"
              ? seg.points[seg.points.length - 1]
              : seg.points[0];
          const d = Math.hypot(worldPt.x - endpoint.x, worldPt.y - endpoint.y);
          if (d < TILE_SNAP_RADIUS && d > 0.1) {
            extendIdx = lastRef.segIdx;
            extendEndpoint = lastRef.endpoint;
          }
        }
      }
      // Fallback: find nearest segment endpoint within TILE_SNAP_RADIUS
      if (extendIdx < 0) {
        let bestDist = TILE_SNAP_RADIUS;
        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i];
          if (seg.points.length === 0) continue;
          const first = seg.points[0];
          const last = seg.points[seg.points.length - 1];
          const dFirst = Math.hypot(worldPt.x - first.x, worldPt.y - first.y);
          const dLast = Math.hypot(worldPt.x - last.x, worldPt.y - last.y);
          if (dFirst < bestDist && dFirst > 0.1) {
            bestDist = dFirst;
            extendIdx = i;
            extendEndpoint = "start";
          }
          if (dLast < bestDist && dLast > 0.1) {
            bestDist = dLast;
            extendIdx = i;
            extendEndpoint = "end";
          }
        }
      }
      if (extendIdx >= 0) {
        setSegments((prev) =>
          prev.map((s, i) => {
            if (i !== extendIdx) return s;
            const pts =
              extendEndpoint === "end"
                ? [...s.points, worldPt]
                : [worldPt, ...s.points];
            return { ...s, points: pts };
          }),
        );
        lastPlacedRailRef.current = { segIdx: extendIdx, endpoint: extendEndpoint };
        lastPlacedKeyRef.current = key;
        return;
      }
      // No nearby endpoint: create new single-point segment (autoconnect deferred to mouseUp)
      setSegments((prev) => [...prev, { points: [worldPt] }]);
      lastPlacedRailRef.current = { segIdx: segments.length, endpoint: "end" };
      lastPlacedKeyRef.current = key;
    } else if (tool === "rail_start") {
      setStartMarker(worldPt);
    } else if (tool === "rail_end") {
      setEndMarker(worldPt);
    } else if (obstacleDefMap.has(tool)) {
      // Obstacle placement
      const isRelocation = pendingObstacleParamsRef.current !== null;
      if (isRelocation) {
        const carried = pendingObstacleParamsRef.current;
        pendingObstacleParamsRef.current = null;
        setObstacleParams((prev) => ({ ...prev, [key]: carried }));
        setObstacles((prev) => ({ ...prev, [key]: tool as ObstacleTileType }));
        setTool("none");
        setSelectedObstacleKey(key);
        return;
      }
      setObstacles((prev) => ({ ...prev, [key]: tool as ObstacleTileType }));
      // Store pre-set rotation from R key presses for this fresh placement
      if (pendingToolRotRef.current !== 0) {
        const def = obstacleDefMap.get(tool)!;
        const baseRot = (def.defaultParams as any).rotation ?? 0;
        setObstacleParams((prev) => ({
          ...prev,
          [key]: {
            ...def.defaultParams,
            rotation: baseRot + pendingToolRotRef.current,
          },
        }));
      }
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => e.preventDefault();

  // Test the level
  const startTest = () => {
    if (!startMarker || !endMarker) {
      setTestError(
        "Place both a Start (🟢) and End (🏁) marker before testing.",
      );
      setTimeout(() => setTestError(null), 3000);
      return;
    }
    const level: EditorLevel = {
      name: currentLevelName || "Test",
      id: currentLevelId || "test",
      version: 3,
      segments,
      obstacles,
      startMarker,
      endMarker,
      createdAt: Date.now(),
      obstacleParams:
        Object.keys(obstacleParams).length > 0 ? obstacleParams : undefined,
      stars: Object.keys(stars).length > 0 ? stars : undefined,
    };
    const { railPoints } = convertLevelToGameDataV3(level);
    if (railPoints.length < 3) {
      setTestError("Place at least 3 rail segments before testing.");
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
    window.addEventListener("resize", resize);

    // Convert to engine-compatible format (already resampled at RAIL_SPACING)
    const level: EditorLevel = {
      name: currentLevelName || "Test",
      id: currentLevelId || "test",
      version: 3,
      segments,
      obstacles,
      startMarker,
      endMarker,
      createdAt: Date.now(),
      obstacleParams:
        Object.keys(obstacleParams).length > 0 ? obstacleParams : undefined,
      stars: Object.keys(stars).length > 0 ? stars : undefined,
    };
    const {
      railPoints,
      allSegments,
      obstacles: obsData,
      stars: starData,
      endTileWorldPos,
      isLoop,
    } = convertLevelToGameDataV3(level);

    // Start level music if configured
    if (currentMusicFile) {
      musicManager.playForLevel(currentMusicFile);
    }

    // Create a custom engine with pre-built rail
    const engine = new GameEngine(
      canvas,
      "overworld",
      { motor: 0, health: 0, grip: 0, rocket: 0, shield: 0 },
      {
        onGameOver: () => {
          gameOverRef.current = true;
        },
        onLevelComplete: (time: number, starsCollected: number) => {
          const levelId = currentLevelId || "unsaved";
          const result = recordTime(levelId, time, starsCollected);
          setLevelComplete({
            time,
            records: result.records,
            isNewBest: result.isNewBest,
            starsCollected,
          });
        },
      },
    );

    // Override the rail with our resampled one (already in world coordinates)
    engine.rail = railPoints;
    engine.allRailSegments = allSegments;
    (engine as any).hasFinitePath = true;
    (engine as any).isLoop = isLoop;
    // Start tile is the beginning of the main rail path
    (engine as any).startTilePos = railPoints.length > 0 ? railPoints[0] : null;
    // End tile world position for proximity-based trigger
    (engine as any).endTilePos = endTileWorldPos;
    engine.ground = engine.rail.map((p) => p.y + 150);
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

    // Add collectible stars
    engine.collectibleStars = starData.map((s) => ({
      x: s.worldX,
      y: s.worldY,
      collected: false,
    }));
    engine.starsCollected = 0;

    // Prevent auto-generation of more rail; mark as finite path
    engine.generateRail = () => {};
    engine.spawnObstacles = () => {};
    engine.hasFinitePath = true;
    engine.pos = 0;
    engine.initDirection();
    engineRef.current = engine;
    engine.start();

    const handleKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        engine.stop();
        setTesting(false);
      }
      if (e.code === "Enter" && gameOverRef.current) {
        engine.stop();
        setTesting(false);
      }
    };
    window.addEventListener("keydown", handleKey);

    return () => {
      engine.stop();
      musicManager.stop();
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", handleKey);
    };
  }, [testing, segments, obstacles, startMarker, endMarker]);

  // Save dialog
  const handleSave = () => {
    if (!levelName.trim()) return;
    const existing = loadCustomLevels().find(
      (l) => l.name === levelName.trim(),
    );
    if (
      existing &&
      !confirm(
        `A level named "${levelName.trim()}" already exists. Overwrite it?`,
      )
    )
      return;
    const id = existing?.id || currentLevelId || generateLevelId();
    const level: EditorLevel = {
      name: levelName.trim(),
      id,
      version: 3,
      segments,
      obstacles,
      startMarker: startMarker ?? undefined,
      endMarker: endMarker ?? undefined,
      createdAt: Date.now(),
      musicFile: currentMusicFile || undefined,
      obstacleParams:
        Object.keys(obstacleParams).length > 0 ? obstacleParams : undefined,
      stars: Object.keys(stars).length > 0 ? stars : undefined,
    };
    saveCustomLevel(level);
    lastSavedSegmentsRef.current = JSON.stringify(segments);
    lastSavedObstaclesRef.current = JSON.stringify(obstacles);
    lastSavedMarkersRef.current = JSON.stringify({ startMarker, endMarker });
    setCurrentLevelId(id);
    setCurrentLevelName(levelName.trim());
    setShowSaveDialog(false);
    setLevelName("");
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
      version: 3,
      segments,
      obstacles,
      startMarker: startMarker ?? undefined,
      endMarker: endMarker ?? undefined,
      createdAt: Date.now(),
      musicFile: currentMusicFile || undefined,
      obstacleParams:
        Object.keys(obstacleParams).length > 0 ? obstacleParams : undefined,
      stars: Object.keys(stars).length > 0 ? stars : undefined,
    };
    saveCustomLevel(level);
    lastSavedSegmentsRef.current = JSON.stringify(segments);
    lastSavedObstaclesRef.current = JSON.stringify(obstacles);
    lastSavedMarkersRef.current = JSON.stringify({ startMarker, endMarker });
    setCurrentLevelId(id);
  };

  const handleLoad = (level: EditorLevel) => {
    // Migrate legacy formats to V3
    const v3 = level.version === 3 ? level : migrateToV3(level);
    setSegments(v3.segments ?? []);
    setObstacles((v3.obstacles ?? {}) as Record<string, ObstacleTileType>);
    setStartMarker(v3.startMarker ?? null);
    setEndMarker(v3.endMarker ?? null);
    lastSavedSegmentsRef.current = JSON.stringify(v3.segments ?? []);
    lastSavedObstaclesRef.current = JSON.stringify(v3.obstacles ?? {});
    lastSavedMarkersRef.current = JSON.stringify({
      startMarker: v3.startMarker ?? null,
      endMarker: v3.endMarker ?? null,
    });
    setObstacleParams(v3.obstacleParams ? { ...v3.obstacleParams } : {});
    setStars((v3.stars ?? {}) as Record<string, "star">);
    setCurrentLevelName(v3.name);
    setCurrentLevelId(v3.id || generateLevelId());
    setCurrentMusicFile(v3.musicFile ?? "");
    setShowLoadDialog(false);
    lastPlacedRailRef.current = null;
  };

  const handleDelete = (name: string) => {
    if (!confirm(`Delete level "${name}"? This cannot be undone.`)) return;
    deleteCustomLevel(name);
    setSavedLevels(loadCustomLevels());
  };

  const openLoadDialog = () => {
    if (
      hasUnsavedChanges() &&
      !confirm("You have unsaved changes. Load a different level?")
    )
      return;
    setSavedLevels(loadCustomLevels());
    setShowLoadDialog(true);
  };

  const handleExport = () => {
    const id = currentLevelId || generateLevelId();
    const name = currentLevelName || "Untitled";
    const level: EditorLevel = {
      name,
      id,
      version: 3,
      segments,
      obstacles,
      startMarker: startMarker ?? undefined,
      endMarker: endMarker ?? undefined,
      createdAt: Date.now(),
      musicFile: currentMusicFile || undefined,
      obstacleParams:
        Object.keys(obstacleParams).length > 0 ? obstacleParams : undefined,
      stars: Object.keys(stars).length > 0 ? stars : undefined,
    };
    downloadLevelFile(level);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = importLevel(reader.result as string);
      if ("error" in result) {
        alert(`Import failed: ${result.error}`);
        return;
      }
      handleLoad(result);
      saveCustomLevel(result);
    };
    reader.readAsText(file);
    // Reset so the same file can be re-imported
    e.target.value = "";
  };

  const handleBack = () => {
    if (
      hasUnsavedChanges() &&
      !confirm("You have unsaved changes. Leave the editor?")
    )
      return;
    onBack();
  };

  const clearAll = () => {
    if (
      (segments.length > 0 || Object.keys(obstacles).length > 0) &&
      !confirm("Clear all?")
    )
      return;
    setSegments([]);
    setObstacles({});
    setStartMarker(null);
    setEndMarker(null);
    setObstacleParams({});
    lastPlacedRailRef.current = null;
    setLine2Start(null);
    setDrawRailPoints(null);
    setDrawRailAttach(null);
    setDrawRailPending(null);
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
              <h2 className="text-4xl font-bold text-game-accent mb-2">
                {levelComplete.isNewBest
                  ? "🏆 New Best!"
                  : "🎉 Congratulations!"}
              </h2>
              <p className="text-game-subtitle text-lg mb-4">
                You reached the finish line!
              </p>
              <div className="flex justify-center gap-2 mb-3">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className={`text-3xl ${i < levelComplete.starsCollected ? "opacity-100" : "opacity-25"}`}
                  >
                    ⭐
                  </span>
                ))}
              </div>
              <p className="text-game-subtitle text-sm mb-4">
                {levelComplete.starsCollected}/3 Stars
              </p>
              <div className="bg-game-bg rounded-xl p-4 mb-4">
                <p className="text-game-subtitle text-sm">Completion Time</p>
                <p className="text-game-title text-3xl font-bold">
                  {formatTime(levelComplete.time)}
                </p>
                {levelComplete.records.length > 0 &&
                  levelComplete.records[0].time < levelComplete.time && (
                    <p className="text-game-subtitle text-sm mt-1">
                      Best: {formatTime(levelComplete.records[0].time)}
                    </p>
                  )}
              </div>
              {levelComplete.records.length > 1 && (
                <div className="bg-game-bg rounded-xl p-3 mb-4 text-left">
                  <p className="text-game-subtitle text-xs mb-2 text-center font-bold">
                    Top Times
                  </p>
                  {levelComplete.records.map((r, i) => (
                    <div
                      key={i}
                      className={`flex justify-between text-sm py-0.5 ${r.time === levelComplete.time && r.date === Math.max(...levelComplete.records.filter((x) => x.time === levelComplete.time).map((x) => x.date)) ? "text-game-accent font-bold" : "text-game-subtitle"}`}
                    >
                      <span>#{i + 1}</span>
                      <span>{formatTime(r.time)}</span>
                    </div>
                  ))}
                </div>
              )}
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
    <div
      className="fixed inset-0 overflow-hidden"
      onContextMenu={handleContextMenu}
    >
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

      {/* Draw rail smoothness slider */}
      {drawRailPending && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-20 px-4 py-3 rounded-lg bg-game-card border border-game-card-border shadow-lg flex items-center gap-3">
          <span className="text-game-title text-sm font-bold whitespace-nowrap">
            Smoothness
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={drawRailSmoothness}
            onChange={(e) => setDrawRailSmoothness(parseFloat(e.target.value))}
            className="w-40"
          />
          <span className="text-game-subtitle text-xs w-8">
            {Math.round(drawRailSmoothness * 100)}%
          </span>
          <button
            onClick={() => {
              const smoothed = smoothDrawnRail(
                drawRailPending.raw,
                drawRailSmoothness,
              );
              const startPt = drawRailPending.attach
                ? drawRailPending.attach.start
                : drawRailPending.raw[0];
              const endPt = drawRailPending.endSnap
                ? drawRailPending.endSnap.pt
                : smoothed[smoothed.length - 1];
              // Build full polyline: start → smoothed intermediates → end
              const allPts = [
                startPt,
                ...(smoothed.length > 2 ? smoothed.slice(1, -1) : []),
                endPt,
              ];
              const newSeg: RailSegment = {
                points: allPts,
                rawDrawnPoints: drawRailPending.raw,
                smoothness: drawRailSmoothness,
              };
              setSegments((prev) => [...prev, newSeg]);
              setDrawRailPending(null);
              setDrawRailAttach(null);
            }}
            className="px-3 py-1 rounded bg-green-600 text-white font-bold text-sm hover:brightness-110"
          >
            ✓
          </button>
          <button
            onClick={() => {
              setDrawRailPending(null);
              setDrawRailAttach(null);
            }}
            className="px-3 py-1 rounded bg-red-600 text-white font-bold text-sm hover:brightness-110"
          >
            ✕
          </button>
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
                if (TILE_TOOL_TYPES.has(tool)) setTool("none");
                setShowTilesMenu(!showTilesMenu);
                setShowToolsMenu(false);
                setShowFileMenu(false);
              }}
              className={`px-3 py-2 rounded-lg font-bold text-sm border transition-all ${
                TILE_TOOL_TYPES.has(tool)
                  ? "bg-game-accent text-game-bg border-game-accent"
                  : "bg-game-card text-game-title border-game-card-border hover:border-game-accent"
              }`}
            >
              {(() => {
                const activeTile = TOOLS.find(
                  (t) => t.tool === tool && TILE_TOOL_TYPES.has(t.tool),
                );
                return activeTile
                  ? `${activeTile.emoji} ${activeTile.label}`
                  : "🧱 Tiles";
              })()}{" "}
              ▾
            </button>
            {showTilesMenu && (
              <div className="absolute top-full left-0 mt-1 bg-game-card border border-game-card-border rounded-lg p-1 min-w-[140px] shadow-lg">
                {TOOLS.filter((t) => TILE_TOOL_TYPES.has(t.tool)).map((t) => (
                  <button
                    key={t.tool}
                    onClick={() => {
                      setTool(t.tool);
                      lastPlacedRailRef.current = null;
                      setArcCenter(null);
                      setArcPreview([]);
                      setCurveStart(null);
                      setCurveEnd(null);
                      setCurveControl(null);
                      setCurvePreview([]);
                      setIsDraggingCurve(false);
                      setLineStart(null);
                      setLinePreview([]);
                      setShowTilesMenu(false);
                    }}
                    className={`w-full text-left px-3 py-2 rounded font-bold text-sm transition-all ${
                      tool === t.tool
                        ? "bg-game-accent text-game-bg"
                        : "text-game-title hover:bg-game-bar-bg"
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
                  setTool("none");
                  setArcCenter(null);
                  setArcPreview([]);
                  setCurveStart(null);
                  setCurveEnd(null);
                  setCurveControl(null);
                  setCurvePreview([]);
                  setIsDraggingCurve(false);
                }
                setShowToolsMenu(!showToolsMenu);
                setShowTilesMenu(false);
                setShowFileMenu(false);
              }}
              className={`px-3 py-2 rounded-lg font-bold text-sm border transition-all ${
                SHAPE_TOOL_TYPES.has(tool)
                  ? "bg-game-accent text-game-bg border-game-accent"
                  : "bg-game-card text-game-title border-game-card-border hover:border-game-accent"
              }`}
            >
              {(() => {
                const activeTool = TOOLS.find(
                  (t) => t.tool === tool && SHAPE_TOOL_TYPES.has(t.tool),
                );
                return activeTool
                  ? `${activeTool.emoji} ${activeTool.label}`
                  : "🛠 Tools";
              })()}{" "}
              ▾
            </button>
            {showToolsMenu && (
              <div className="absolute top-full left-0 mt-1 bg-game-card border border-game-card-border rounded-lg p-1 min-w-[140px] shadow-lg">
                {TOOLS.filter((t) => SHAPE_TOOL_TYPES.has(t.tool)).map((t) => (
                  <button
                    key={t.tool}
                    onClick={() => {
                      setTool(t.tool);
                      lastPlacedRailRef.current = null;
                      if (t.tool !== "circle" && t.tool !== "arc") {
                        setArcCenter(null);
                        setArcPreview([]);
                      }
                      if (t.tool !== "curve" && t.tool !== "circular_curve") {
                        setCurveStart(null);
                        setCurveEnd(null);
                        setCurveControl(null);
                        setCurvePreview([]);
                        setIsDraggingCurve(false);
                      }
                      setLineStart(null);
                      setLinePreview([]);
                      setShowToolsMenu(false);
                    }}
                    className={`w-full text-left px-3 py-2 rounded font-bold text-sm transition-all ${
                      tool === t.tool
                        ? "bg-game-accent text-game-bg"
                        : "text-game-title hover:bg-game-bar-bg"
                    }`}
                  >
                    {t.emoji} {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Standalone tools: Eraser, Line, Line2 */}
          {TOOLS.filter((t) =>
            ["rail", "eraser", "line", "line2", "draw_rail"].includes(t.tool),
          ).map((t) => {
            const isActive = tool === t.tool;
            const isFreeLine = t.tool === "line2";

            return (
              <div key={t.tool} className="flex flex-col items-start gap-1">
                <button
                  onClick={() => {
                    if (tool === t.tool) {
                      setTool("none");
                    } else {
                      setTool(t.tool as EditorTool);
                    }
                    lastPlacedRailRef.current = null;
                    setArcCenter(null);
                    setArcPreview([]);
                    setCurveStart(null);
                    setCurveEnd(null);
                    setCurveControl(null);
                    setCurvePreview([]);
                    setIsDraggingCurve(false);
                    setLineStart(null);
                    setLinePreview([]);
                    if (t.tool === "line2") setLine2Start(null);
                    setDrawRailPoints(null);
                    setDrawRailAttach(null);
                    setDrawRailPending(null);
                    setShowTilesMenu(false);
                  }}
                  className={`px-3 py-2 rounded-lg font-bold text-sm transition-all ${
                    isActive
                      ? "bg-game-accent text-game-bg scale-105"
                      : "bg-game-card text-game-title border border-game-card-border hover:border-game-accent"
                  }`}
                >
                  {t.emoji} {t.label}
                </button>

                {(isFreeLine || t.tool === "line") && isActive && (
                  <div className="bg-game-card border border-game-card-border rounded-lg p-2 min-w-[180px] shadow-lg flex flex-col gap-1">
                    {isFreeLine && (
                      <button
                        onClick={() => {
                          setLine2GridSnap((enabled) => {
                            const nextEnabled = !enabled;
                            updateSetting(
                              "defaultFreeLineToolBehaviour",
                              nextEnabled ? "grid_snap" : "normal",
                            );
                            return nextEnabled;
                          });
                        }}
                        className={`w-full px-3 py-2 rounded-lg text-sm font-bold transition-all text-left ${
                          line2GridSnap
                            ? "bg-green-700 text-white hover:bg-green-600"
                            : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                        }`}
                        title={
                          line2GridSnap
                            ? "Free Line grid snap: ON — empty clicked tiles snap to tile centers"
                            : "Free Line grid snap: OFF"
                        }
                      >
                        {line2GridSnap ? "🧲 Grid snap: On" : "🧲 Grid snap: Off"}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setContinuousLine((enabled) => {
                          const nextEnabled = !enabled;
                          updateSetting("continuousLine", nextEnabled);
                          return nextEnabled;
                        });
                      }}
                      className={`w-full px-3 py-2 rounded-lg text-sm font-bold transition-all text-left ${
                        continuousLine
                          ? "bg-green-700 text-white hover:bg-green-600"
                          : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                      }`}
                      title={
                        continuousLine
                          ? "Continuous: ON — endpoint becomes next start point"
                          : "Continuous: OFF — each line placed independently"
                      }
                    >
                      {continuousLine ? "🔗 Continuous: On" : "🔗 Continuous: Off"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* Hand tool (select/inspect) */}
          <button
            onClick={() => {
              setTool("none");
              lastPlacedRailRef.current = null;
              setArcCenter(null);
              setArcPreview([]);
              setCurveStart(null);
              setCurveEnd(null);
              setCurveControl(null);
              setCurvePreview([]);
              setIsDraggingCurve(false);
              setLineStart(null);
              setLinePreview([]);
              setLine2Start(null);
              setDrawRailPoints(null);
              setDrawRailAttach(null);
              setDrawRailPending(null);
              setShowTilesMenu(false);
              setShowToolsMenu(false);
            }}
            className={`px-3 py-2 rounded-lg font-bold text-sm transition-all ${
              tool === "none"
                ? "bg-game-accent text-game-bg scale-105"
                : "bg-game-card text-game-title border border-game-card-border hover:border-game-accent"
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
            onClick={() => {
              setShowMusicMenu(true);
              setShowFileMenu(false);
              setShowTilesMenu(false);
              setShowToolsMenu(false);
            }}
            className={`px-3 py-2 rounded-lg font-bold text-sm transition-all ${
              currentMusicFile
                ? "bg-game-accent text-game-bg"
                : "bg-game-card text-game-title border border-game-card-border hover:border-game-accent"
            }`}
            title="Select level music"
          >
            🎵{" "}
            {currentMusicFile
              ? (getAvailableTracks().find((t) => t.file === currentMusicFile)
                  ?.label ?? currentMusicFile)
              : "Music"}
          </button>

          <button
            onClick={() => setSkyOnly(!skyOnly)}
            className={`px-3 py-2 rounded-lg font-bold text-sm transition-all ${
              skyOnly
                ? "bg-game-accent text-game-bg"
                : "bg-game-card text-game-title border border-game-card-border hover:border-game-accent"
            }`}
            title={
              skyOnly ? "Background: Sky only" : "Background: Full scenery"
            }
          >
            {skyOnly ? "☁️ Sky Only" : "🏔️ Scenery"}
          </button>
          <button
            onClick={() => setAutoconnect((a) => !a)}
            className={`px-3 py-2 rounded-lg text-sm font-bold ${
              autoconnect
                ? "bg-green-700 text-white hover:bg-green-600"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
            title={
              autoconnect
                ? "Autoconnect: ON — rail tiles auto-connect to nearby segment endpoints"
                : "Autoconnect: OFF"
            }
          >
            {autoconnect ? "🔗 Auto" : "🔗"}
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
            title={
              currentLevelName
                ? `Quick save "${currentLevelName}"`
                : "Save as..."
            }
          >
            ⚡ {currentLevelName ? "Quick Save" : "Save"}
          </button>

          {/* Settings */}
          <button
            onClick={() => setShowSettings(true)}
            className="px-3 py-2 rounded-lg font-bold text-sm bg-game-card text-game-title border border-game-card-border hover:border-game-accent"
          >
            ⚙
          </button>

          {/* File dropdown */}
          <div className="relative">
            <button
              onClick={() => {
                setShowFileMenu(!showFileMenu);
                setShowTilesMenu(false);
              }}
              className="px-3 py-2 rounded-lg font-bold text-sm bg-game-card text-game-title border border-game-card-border hover:border-game-accent"
            >
              📁 File ▾
            </button>
            {showFileMenu && (
              <div className="absolute top-full right-0 mt-1 bg-game-card border border-game-card-border rounded-lg p-1 min-w-[140px] shadow-lg">
                <button
                  onClick={() => {
                    setShowSaveDialog(true);
                    setShowFileMenu(false);
                  }}
                  className="w-full text-left px-3 py-2 rounded font-bold text-sm text-game-title hover:bg-game-bar-bg"
                >
                  💾 Save As
                </button>
                <button
                  onClick={() => {
                    openLoadDialog();
                    setShowFileMenu(false);
                  }}
                  className="w-full text-left px-3 py-2 rounded font-bold text-sm text-game-title hover:bg-game-bar-bg"
                >
                  📂 Load
                </button>
                <hr className="border-game-card-border my-1" />
                <button
                  onClick={() => {
                    handleExport();
                    setShowFileMenu(false);
                  }}
                  className="w-full text-left px-3 py-2 rounded font-bold text-sm text-game-title hover:bg-game-bar-bg"
                >
                  📤 Export
                </button>
                <button
                  onClick={() => {
                    importFileRef.current?.click();
                    setShowFileMenu(false);
                  }}
                  className="w-full text-left px-3 py-2 rounded font-bold text-sm text-game-title hover:bg-game-bar-bg"
                >
                  📥 Import
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
          onClick={() => zoomToCenter(Math.max(0.25, zoom - 0.25))}
          className="w-10 h-10 rounded-lg bg-game-card text-game-title border border-game-card-border font-bold text-lg hover:border-game-accent"
        >
          −
        </button>
        <span className="w-14 h-10 rounded-lg bg-game-card text-game-title border border-game-card-border font-bold text-sm flex items-center justify-center">
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={() => zoomToCenter(Math.min(3, zoom + 0.25))}
          className="w-10 h-10 rounded-lg bg-game-card text-game-title border border-game-card-border font-bold text-lg hover:border-game-accent"
        >
          +
        </button>
      </div>

      {/* Music Selection Dialog */}
      {showMusicMenu && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-20"
          onClick={() => setShowMusicMenu(false)}
        >
          <div
            className="bg-game-card border-2 border-game-card-border rounded-2xl p-6 w-96 max-h-[70vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-game-title text-xl font-bold">
                🎵 Level Music
              </h3>
              <button
                onClick={() => setShowMusicMenu(false)}
                className="text-game-subtitle hover:text-game-title text-lg"
              >
                ✕
              </button>
            </div>
            <p className="text-game-subtitle text-xs mb-3">
              Place music files in{" "}
              <span className="text-game-title font-mono">
                public/assets/music/
              </span>{" "}
              and add them to{" "}
              <span className="text-game-title font-mono">
                music_catalog.json
              </span>
              .
            </p>
            <div className="overflow-y-auto space-y-1 flex-1">
              {/* None option */}
              <button
                onClick={() => {
                  setCurrentMusicFile("");
                  setShowMusicMenu(false);
                }}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm font-bold transition-all ${
                  !currentMusicFile
                    ? "bg-game-accent text-game-bg"
                    : "bg-game-bg text-game-subtitle hover:text-game-title border border-game-card-border"
                }`}
              >
                — None —
              </button>
              {getAvailableTracks().length === 0 && (
                <p className="text-game-subtitle text-xs text-center py-4">
                  No music files found in public/assets/music/.
                </p>
              )}
              {getAvailableTracks().map((track) => (
                <button
                  key={track.file}
                  onClick={() => {
                    setCurrentMusicFile(track.file);
                    addToCatalog(track.file);
                    setShowMusicMenu(false);
                  }}
                  className={`w-full text-left px-3 py-2.5 rounded-lg transition-all ${
                    currentMusicFile === track.file
                      ? "bg-game-accent text-game-bg"
                      : "bg-game-bg border border-game-card-border hover:border-game-accent"
                  }`}
                >
                  <div
                    className={`font-bold text-sm ${currentMusicFile === track.file ? "text-game-bg" : "text-game-title"}`}
                  >
                    {track.label}
                  </div>
                  <div
                    className={`text-xs font-mono mt-0.5 ${currentMusicFile === track.file ? "text-game-bg/70" : "text-game-subtitle"}`}
                  >
                    {track.file}
                  </div>
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
            <h3 className="text-game-title text-xl font-bold mb-4">
              Save Level As
            </h3>
            <input
              type="text"
              value={levelName}
              onChange={(e) => setLevelName(e.target.value)}
              placeholder="Enter new level name..."
              className="w-full px-3 py-2 rounded-lg bg-game-bg text-game-title border border-game-card-border mb-4 outline-none focus:border-game-accent"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
            {/* Existing levels to overwrite */}
            {(() => {
              const existing = loadCustomLevels();
              if (existing.length === 0) return null;
              return (
                <div className="mb-4">
                  <p className="text-game-subtitle text-xs mb-2">
                    Or overwrite an existing level:
                  </p>
                  <div className="max-h-[30vh] overflow-y-auto space-y-1">
                    {existing.map((level) => (
                      <button
                        key={level.name}
                        onClick={() => {
                          if (confirm(`Overwrite level "${level.name}"?`)) {
                            const id =
                              level.id || currentLevelId || generateLevelId();
                            const newLevel: EditorLevel = {
                              name: level.name,
                              id,
                              version: 3,
                              segments,
                              obstacles,
                              startMarker: startMarker ?? undefined,
                              endMarker: endMarker ?? undefined,
                              createdAt: Date.now(),
                              musicFile: currentMusicFile || undefined,
                              obstacleParams:
                                Object.keys(obstacleParams).length > 0
                                  ? obstacleParams
                                  : undefined,
                              stars:
                                Object.keys(stars).length > 0
                                  ? stars
                                  : undefined,
                            };
                            saveCustomLevel(newLevel);
                            lastSavedSegmentsRef.current =
                              JSON.stringify(segments);
                            lastSavedObstaclesRef.current =
                              JSON.stringify(obstacles);
                            lastSavedMarkersRef.current = JSON.stringify({
                              startMarker,
                              endMarker,
                            });
                            setCurrentLevelId(id);
                            setCurrentLevelName(level.name);
                            setShowSaveDialog(false);
                            setLevelName("");
                          }
                        }}
                        className="w-full flex items-center justify-between p-2 rounded-lg bg-game-bg border border-game-card-border hover:border-game-accent text-left"
                      >
                        <div>
                          <div className="text-game-title font-bold text-sm">
                            {level.name}
                          </div>
                          <div className="text-game-subtitle text-xs">
                            {(level.segments ?? []).length} segments •{" "}
                            {new Date(level.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                        <span className="text-game-subtitle text-xs">
                          Overwrite
                        </span>
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
      {selectedObstacleKey &&
        (() => {
          const obsType = obstacles[selectedObstacleKey];
          if (!obsType) return null;
          const def = obstacleDefMap.get(obsType);
          if (!def) return null;
          const params = {
            ...def.defaultParams,
            ...(obstacleParams[selectedObstacleKey] ?? {}),
          } as Record<string, any>;
          const [selGx, selGy] = parseTileKey(selectedObstacleKey);
          return (
            <div className="fixed right-4 top-20 bottom-12 w-64 bg-game-card border border-game-card-border rounded-xl flex flex-col shadow-xl z-10 overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-game-card-border bg-game-bar-bg">
                <span className="text-game-title font-bold text-sm">
                  {def.emoji} {def.label}
                </span>
                <button
                  onClick={() => setSelectedObstacleKey(null)}
                  className="text-game-subtitle hover:text-game-title text-lg leading-none"
                >
                  ✕
                </button>
              </div>
              <div className="text-game-subtitle text-xs px-3 py-1 border-b border-game-card-border">
                Cell {selGx},{selGy}
              </div>
              {/* Fields */}
              <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
                {Object.entries(
                  def.paramMeta as Record<string, ParamFieldMeta>,
                ).map(([field, meta]) => (
                  <div key={field}>
                    <label className="block text-game-subtitle text-xs mb-1">
                      {meta.label}
                    </label>
                    {!meta.type || meta.type === "number" ? (
                      <input
                        type="number"
                        value={params[field] ?? ""}
                        min={meta.min}
                        max={meta.max}
                        step={meta.step ?? 1}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          if (isNaN(val)) return;
                          const clamped =
                            meta.min != null && meta.max != null
                              ? Math.min(meta.max, Math.max(meta.min, val))
                              : val;
                          setObstacleParams((prev) => ({
                            ...prev,
                            [selectedObstacleKey]: {
                              ...(prev[selectedObstacleKey] ??
                                def.defaultParams),
                              [field]: clamped,
                            } as ObstacleParams,
                          }));
                        }}
                        className="w-full px-2 py-1 rounded bg-game-bg text-game-title border border-game-card-border text-sm outline-none focus:border-game-accent"
                      />
                    ) : meta.type === "select" ? (
                      <select
                        value={params[field] ?? ""}
                        onChange={(e) => {
                          setObstacleParams((prev) => ({
                            ...prev,
                            [selectedObstacleKey]: {
                              ...(prev[selectedObstacleKey] ??
                                def.defaultParams),
                              [field]: e.target.value,
                            } as ObstacleParams,
                          }));
                        }}
                        className="w-full px-2 py-1 rounded bg-game-bg text-game-title border border-game-card-border text-sm outline-none focus:border-game-accent"
                      >
                        {(meta.options ?? []).map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
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
                    setObstacleParams((prev) => {
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
            <h3 className="text-game-title text-xl font-bold mb-4">
              Load Level
            </h3>
            {savedLevels.length === 0 ? (
              <p className="text-game-subtitle text-center py-8">
                No saved levels yet
              </p>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-2">
                {savedLevels.map((level) => (
                  <div
                    key={level.name}
                    className="flex items-center justify-between p-3 rounded-lg bg-game-bg border border-game-card-border"
                  >
                    <div>
                      <div className="text-game-title font-bold">
                        {level.name}
                      </div>
                      <div className="text-game-subtitle text-xs">
                        {(level.segments ?? []).length} segments •{" "}
                        {new Date(level.createdAt).toLocaleDateString()}
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

      {/* Hidden file input for level import */}
      <input
        ref={importFileRef}
        type="file"
        accept=".json,.gondola"
        className="hidden"
        onChange={handleImportFile}
      />
      {showSettings && (
        <SettingsMenu
          initialTab="editor"
          onClose={() => {
            setShowSettings(false);
            const settings = loadSettings();
            setSnapRadius(settings.snapRadius);
            setLine2GridSnap(
              settings.defaultFreeLineToolBehaviour === "grid_snap",
            );
          }}
        />
      )}
    </div>
  );
}
