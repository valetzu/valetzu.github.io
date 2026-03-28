import { describe, expect, it } from "vitest";
import {
  buildContinuousSegments,
  buildIndividualSegmentsFromRailSegments,
  convertLevelToGameDataV3,
  sampleBezierWorld,
  sampleLoopRailWorld,
  walkContinuousPath,
  type EditorLevel,
  type RailSegment,
} from "./editorTypes";

describe("editor rail conversion", () => {
  it("walks a disconnected multi-piece segment across all of its rails", () => {
    const disconnectedSegments: RailSegment[] = [
      { points: [{ x: 100, y: 100 }, { x: 200, y: 100 }] },
      { points: [{ x: 300, y: 100 }, { x: 400, y: 100 }] },
      { points: [{ x: 200, y: 100 }, { x: 300, y: 100 }] },
    ];

    const individual = buildIndividualSegmentsFromRailSegments(disconnectedSegments);
    const continuous = buildContinuousSegments(individual);

    expect(continuous).toHaveLength(1);

    const walked = walkContinuousPath(individual, continuous[0]);

    expect(walked.points).toEqual([
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 300, y: 100 },
      { x: 400, y: 100 },
    ]);
  });

  it("keeps non-start continuous segments intact in V3 game conversion", () => {
    const level: EditorLevel = {
      name: "test",
      id: "test",
      version: 3,
      createdAt: 0,
      startMarker: { x: 0, y: 0 },
      endMarker: { x: 400, y: 100 },
      segments: [
        { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
        { points: [{ x: 100, y: 0 }, { x: 200, y: 0 }] },
        { points: [{ x: 300, y: 100 }, { x: 400, y: 100 }] },
        { points: [{ x: 400, y: 100 }, { x: 500, y: 100 }] },
      ],
      obstacles: {},
    };

    const { railPoints, allSegments } = convertLevelToGameDataV3(level);

    // Two disconnected continuous segments
    expect(allSegments.length).toBe(2);

    // Main segment (nearest startMarker {0,0}) starts at origin, ends at x=200
    expect(railPoints[0]).toEqual({ x: 0, y: 0 });
    expect(railPoints[railPoints.length - 1]).toEqual({ x: 200, y: 0 });

    // Second segment spans x=300..500
    const seg2 = allSegments[1];
    expect(seg2[0]).toEqual({ x: 300, y: 100 });
    expect(seg2[seg2.length - 1]).toEqual({ x: 500, y: 100 });
  });

  it("samples bezier rails with near-uniform spacing and preserved end tangent", () => {
    const start = { x: 0, y: 0 };
    const end = { x: 100, y: 0 };
    const control = { x: 50, y: 200 };

    const points = sampleBezierWorld(start, end, control);

    expect(points[0]).toEqual(start);
    expect(points[points.length - 1]).toEqual(end);

    let minLen = Infinity;
    let maxLen = 0;
    for (let i = 1; i < points.length; i++) {
      const len = Math.hypot(
        points[i].x - points[i - 1].x,
        points[i].y - points[i - 1].y,
      );
      minLen = Math.min(minLen, len);
      maxLen = Math.max(maxLen, len);
    }

    expect(maxLen / minLen).toBeLessThan(1.05);

    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    const sampledAngle = Math.atan2(last.y - prev.y, last.x - prev.x);
    const tangentAngle = Math.atan2(end.y - control.y, end.x - control.x);
    expect(Math.abs(sampledAngle - tangentAngle)).toBeLessThan(0.02);
  });

  it("samples loop rails with preserved open endpoints and a repeated crossover midpoint", () => {
    const start = { x: 0, y: 0 };
    const end = { x: 200, y: 0 };
    const control = { x: 100, y: 120 };

    const points = sampleLoopRailWorld(start, end, control);

    expect(points[0]).toEqual(start);
    expect(points[points.length - 1]).toEqual(end);

    const midpointHits = points.filter(
      (p) => Math.abs(p.x - 100) < 1e-6 && Math.abs(p.y) < 1e-6,
    );
    expect(midpointHits.length).toBeGreaterThanOrEqual(2);
  });

  it("falls back to a straight line when the requested loop height is negligible", () => {
    const start = { x: 0, y: 0 };
    const end = { x: 120, y: 0 };
    const control = { x: 60, y: 1 };

    const points = sampleLoopRailWorld(start, end, control);

    expect(points[0]).toEqual(start);
    expect(points[points.length - 1]).toEqual(end);
    expect(points.every((p) => Math.abs(p.y) < 1e-6)).toBe(true);
  });
});
