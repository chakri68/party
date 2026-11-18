import { describe, expect, it } from "vitest";
import { beatAt, SITUATION_LOOP_MS, startAt, totalMs } from "../client/scene/director.ts";
import type { Beat } from "../client/scene/model.ts";

const travel = (ms = 3000): Beat => ({ kind: "travel", ms, health: {}, camels: 0 });
const event = (ms = 4000): Beat => ({ kind: "event", ms, health: {}, camels: 0 });
const settle = (ms = 2000): Beat => ({ kind: "settle", ms, health: {}, camels: 0 });
const situation = (): Beat => ({ kind: "situation", ms: Infinity, health: {}, camels: 0 });

describe("the director", () => {
  it("walks through the beats", () => {
    const b = [travel(3000), event(4000), settle(2000)];
    expect(beatAt(b, 0)).toEqual({ index: 0, t: 0 });
    expect(beatAt(b, 4500)).toEqual({ index: 1, t: 0.375 });
    expect(beatAt(b, 8999)?.index).toBe(2);
  });

  it("a beat boundary belongs to the next beat, at t = 0", () => {
    const b = [travel(3000), event(4000), settle(2000)];
    expect(beatAt(b, 3000)).toEqual({ index: 1, t: 0 });
    expect(beatAt(b, 7000)).toEqual({ index: 2, t: 0 });
  });

  it("a negative elapsed counts as 0", () => {
    const b = [travel(3000), event(4000)];
    expect(beatAt(b, -500)).toEqual({ index: 0, t: 0 });
  });

  it("long past the end stays on the last frame", () => {
    // Review Focus 2: a tab hidden through a whole day shows the end state, no catch-up.
    const b = [travel(3000), event(4000), settle(2000)];
    expect(beatAt(b, 600_000)).toEqual({ index: 2, t: 1 });
  });

  it("a situation loops", () => {
    const b = [travel(3000), situation()];
    expect(beatAt(b, 3000 + 1200)).toEqual({ index: 1, t: 0.5 });
    expect(beatAt(b, 3000 + SITUATION_LOOP_MS * 7 + 600)).toEqual({ index: 1, t: 0.25 });
    expect(beatAt(b, 3000 + SITUATION_LOOP_MS)).toEqual({ index: 1, t: 0 });
  });

  it("a snapshot starts at the end", () => {
    // Review Focus 1: a reload mid-report shows the end state at once.
    const b = [travel(3000), event(4000), settle(2000)];
    expect(startAt(b, { snapshot: true })).toBe(9000);
    expect(startAt(b, { snapshot: false })).toBe(0);
  });

  it("a snapshot on a choice day starts at the situation, after travel", () => {
    const b = [travel(3000), situation()];
    expect(startAt(b, { snapshot: true })).toBe(3000);
    expect(startAt(b, { snapshot: false })).toBe(0);
  });

  it("totalMs sums the beats, or is Infinity with a situation", () => {
    expect(totalMs([travel(3000), event(4000), settle(2000)])).toBe(9000);
    expect(totalMs([travel(3000), situation()])).toBe(Infinity);
  });

  it("no beats", () => {
    expect(beatAt([], 10)).toBe(null);
    expect(startAt([], { snapshot: true })).toBe(0);
    expect(totalMs([])).toBe(0);
  });
});
