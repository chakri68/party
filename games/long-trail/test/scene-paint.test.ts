import { describe, expect, it } from "vitest";
import { FIRE_MS, needsPaint, sleepMs, type PaintGate } from "../client/scene/paint-gate.ts";

const idle: PaintGate = { running: false, speed: 0, camp: false, dirty: false, now: 10_000, last: 9_967 };
const gate = (o: Partial<PaintGate>): PaintGate => ({ ...idle, ...o });

describe("paint gate", () => {
  it("draws every frame while a beat runs or the caravan walks", () => {
    expect(needsPaint(gate({ running: true }))).toBe(true);
    expect(needsPaint(gate({ speed: 1 }))).toBe(true);
    expect(sleepMs(gate({ running: true }))).toBe(0);
    expect(sleepMs(gate({ speed: 3 }))).toBe(0);
  });

  it("standing still: draws only when something changed", () => {
    expect(needsPaint(idle)).toBe(false);
    expect(needsPaint(gate({ dirty: true }))).toBe(true);
    expect(needsPaint(gate({ last: 0 }))).toBe(true); // nothing drawn since the loop began
    expect(sleepMs(idle)).toBe(Infinity);
  });

  it("at camp: draws when the fire changes, at most 3 times a second", () => {
    let paints = 0;
    let last = 1;
    for (let now = 1; now <= 3000; now += 16) {
      if (needsPaint(gate({ camp: true, now, last }))) {
        paints++;
        last = now;
      }
    }
    expect(paints).toBeLessThanOrEqual(10);
    expect(paints).toBeGreaterThanOrEqual(8);
    const wait = sleepMs(gate({ camp: true, now: 10_000 }));
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(FIRE_MS + 1);
    // Waking after the wait lands in the fire's next step.
    expect(Math.floor((10_000 + wait) / FIRE_MS)).toBe(Math.floor(10_000 / FIRE_MS) + 1);
  });
});
