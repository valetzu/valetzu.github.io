import { describe, expect, it } from "vitest";
import {
  buildContinuousSegments,
  buildIndividualSegmentsFromRailSegments,
  convertLevelToGameDataV3,
  sampleBezierWorld,
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

    expect(railPoints).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
    ]);
    expect(allSegments).toEqual([
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 200, y: 0 },
      ],
      [
        { x: 300, y: 100 },
        { x: 400, y: 100 },
        { x: 500, y: 100 },
      ],
    ]);
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
});
