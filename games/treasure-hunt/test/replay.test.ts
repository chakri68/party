import { describe, expect, it } from "vitest";
import { findsUpTo, formatClock, legendTeams, routeUpTo } from "../client/replay.ts";
import type { THPublic, THReplay } from "../shared/types.ts";

const pts: [number, number, number][] = [[0, 0, 0], [10, 100, 50], [20, 200, 0]];

describe("routeUpTo", () => {
  it("returns [] for an empty route", () => {
    expect(routeUpTo([], 10)).toEqual([]);
  });
  it("keeps points up to t and interpolates the next segment", () => {
    expect(routeUpTo(pts, 15)).toEqual([[0, 0], [100, 50], [150, 25]]);
  });
  it("adds no extra point when t lands on a point", () => {
    expect(routeUpTo(pts, 10)).toEqual([[0, 0], [100, 50]]);
  });
  it("returns the whole route at or past the end", () => {
    expect(routeUpTo(pts, 99)).toEqual([[0, 0], [100, 50], [200, 0]]);
  });
  it("returns [] before the first point", () => {
    expect(routeUpTo([[5, 1, 1]], 2)).toEqual([]);
  });
});

describe("findsUpTo", () => {
  const finds = [
    { cacheId: "a", teamId: 0, playerId: "p", t: 30, x: 1, z: 1 },
    { cacheId: "b", teamId: 1, playerId: "q", t: 60, x: 2, z: 2 },
  ];
  it("keeps finds at or before t", () => {
    expect(findsUpTo(finds, 30).map((f) => f.cacheId)).toEqual(["a"]);
    expect(findsUpTo(finds, 60)).toHaveLength(2);
    expect(findsUpTo(finds, 29)).toEqual([]);
  });
});

describe("formatClock", () => {
  it("pads seconds", () => {
    expect(formatClock(725)).toBe("12:05");
    expect(formatClock(5)).toBe("0:05");
    expect(formatClock(0)).toBe("0:00");
  });
});

describe("legendTeams", () => {
  it("lists only the teams with a track", () => {
    const teams = [
      { id: 1, color: "sky", foundCount: 0, poolSize: 3 },
      { id: 2, color: "rose", foundCount: 0, poolSize: 0 },
      { id: 3, color: "lime", foundCount: 1, poolSize: 3 },
    ] as THPublic["teams"];
    const replay: THReplay = {
      durationS: 60,
      tracks: [
        { playerId: "a", teamId: 3, points: [] },
        { playerId: "b", teamId: 1, points: [[1, 0, 0]] },
      ],
      finds: [],
    };
    expect(legendTeams(teams, replay).map((t) => t.id)).toEqual([1, 3]);
  });
});
