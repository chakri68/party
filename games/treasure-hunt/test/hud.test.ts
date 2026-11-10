import { describe, expect, it } from "vitest";
import { clueItems, countdownText, formatLeft, scoreText } from "../client/hud.ts";
import type { THPrivate } from "../shared/types.ts";

describe("formatLeft", () => {
  it("shows zero as 0:00", () => {
    expect(formatLeft(0)).toBe("0:00");
  });

  it("shows 61 s as 1:01", () => {
    expect(formatLeft(61_000)).toBe("1:01");
  });

  it("clamps a negative time to 0:00", () => {
    expect(formatLeft(-5_000)).toBe("0:00");
  });

  it("rounds a part second up, so 0:00 only shows at the end", () => {
    expect(formatLeft(59_001)).toBe("1:00");
    expect(formatLeft(400)).toBe("0:01");
  });

  it("shows a full hour as minutes", () => {
    expect(formatLeft(60 * 60_000)).toBe("60:00");
  });
});

describe("scoreText", () => {
  it("reads 3 of 6 found", () => {
    expect(scoreText(3, 6)).toBe("3 of 6 found");
  });
});

describe("countdownText", () => {
  it("counts 3, 2, 1 down to the end", () => {
    expect(countdownText(3000)).toBe("3");
    expect(countdownText(2001)).toBe("3");
    expect(countdownText(2000)).toBe("2");
    expect(countdownText(1)).toBe("1");
  });

  it("is empty once the countdown is over", () => {
    expect(countdownText(0)).toBe("");
    expect(countdownText(-200)).toBe("");
  });
});

describe("clueItems", () => {
  const priv: THPrivate = {
    teamId: 1,
    pins: [],
    clues: [
      { id: "c1", clues: ["Under the red lighthouse."], difficulty: 1, found: false, taken: false },
      { id: "c2", clues: ["Between the old camp and the grey plane, nearer the old camp.", "About 100 m from the red lighthouse, at 90°."], difficulty: 2, found: true, taken: false },
    ],
    revealed: [],
  };

  it("gives one line per cache in pool order, with its found flag", () => {
    expect(clueItems(priv)).toEqual([
      { text: "Under the red lighthouse.", found: false, taken: false },
      { text: "Between the old camp and the grey plane, nearer the old camp. About 100 m from the red lighthouse, at 90°.", found: true, taken: false },
    ]);
  });

  it("gives nothing without a private state", () => {
    expect(clueItems(null)).toEqual([]);
  });
});
