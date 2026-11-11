import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hotColdView, hotColdOpensText, clockLabel, clueItems, clueListKey, photoView, countdownText, formatLeft, scoreText } from "../client/hud.ts";
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
    hotcold: { used: false, unlockAt: null, active: null },
    clues: [
      { id: "c1", clues: ["Under the red lighthouse."], difficulty: 1, found: false, taken: false, photo: null },
      { id: "c2", clues: ["Between the old camp and the grey plane, nearer the old camp.", "About 100 m from the red lighthouse, at 90°."], difficulty: 2, found: true, taken: false, photo: null },
    ],
    revealed: [],
  };

  it("gives one line per cache in pool order, with its found flag", () => {
    expect(clueItems(priv)).toEqual([
      { text: "Under the red lighthouse.", found: false, taken: false, photo: null },
      { text: "Between the old camp and the grey plane, nearer the old camp. About 100 m from the red lighthouse, at 90°.", found: true, taken: false, photo: null },
    ]);
  });

  it("gives nothing without a private state", () => {
    expect(clueItems(null)).toEqual([]);
  });
});

describe("photo clues", () => {
  const cam = { x: 1, z: 2, yaw: 0, pitch: 0, fov: 30, target: "lighthouse" };
  const withPhoto: THPrivate = {
    teamId: 1,
    pins: [],
    hotcold: { used: false, unlockAt: null, active: null },
    clues: [{ id: "p1", clues: ["A photo."], difficulty: 2, found: false, taken: false, photo: cam }],
    revealed: [],
  };

  it("gives photo {} while the image is not there", () => {
    expect(clueItems(withPhoto)[0]!.photo).toEqual({});
    expect(clueItems(withPhoto, () => undefined)[0]!.photo).toEqual({});
  });

  it("gives photo null for a clue with no camera", () => {
    expect(clueItems({ ...withPhoto, clues: [{ ...withPhoto.clues[0]!, photo: null }] })[0]!.photo).toBeNull();
  });

  it("asks the store by id and camera, and passes the src through", () => {
    const items = clueItems(withPhoto, (id, c) => (id === "p1" && c === cam ? "data:image/jpeg;base64,AAA" : undefined));
    expect(items[0]!.photo).toEqual({ src: "data:image/jpeg;base64,AAA" });
  });

  it("says the photo is loading", () => {
    expect(photoView({})).toEqual({ wait: "The photo is loading." });
  });

  it("renders the image with its alt", () => {
    expect(photoView({ src: "data:x" })).toEqual({ src: "data:x", alt: "Photo clue" });
  });

  it("adds nothing extra without a camera", () => {
    expect(photoView(null)).toBeNull();
  });

  // Review: the render-skip key ran JSON.stringify over every data URL, every tick.
  it("the list key holds the pose and the image's length, not the image", () => {
    const big = "data:image/jpeg;base64," + "A".repeat(40_000);
    const key = (src?: string, p = withPhoto) => clueListKey(p, clueItems(p, () => src));
    expect(key(big).length).toBeLessThan(200);
    expect(key(big)).toContain(String(big.length));
    expect(key(big)).not.toBe(key(undefined));
    expect(key(big)).toBe(key(big));
    const moved: THPrivate = { ...withPhoto, clues: [{ ...withPhoto.clues[0]!, photo: { ...cam, fov: 31 } }] };
    expect(key(big, moved)).not.toBe(key(big));
    const found: THPrivate = { ...withPhoto, clues: [{ ...withPhoto.clues[0]!, found: true }] };
    expect(key(big, found)).not.toBe(key(big));
  });

  it("the loading line isn't struck through with a found or taken clue", () => {
    const css = readFileSync(join(import.meta.dirname, "../client/styles.css"), "utf8");
    const rule = /\.th-clue-wait \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain("text-decoration: none");
    // A block child still gets its parent's line-through; an inline-block doesn't.
    expect(rule).toContain("display: inline-block");
  });
});

describe("clock", () => {
  it("shows 17:40 for a dusk game in countdown", () => {
    expect(clockLabel(1060)).toBe("17:40");
  });

  it("shows nothing with no clock", () => {
    expect(clockLabel(null)).toBe("");
  });
});

describe("hotColdView", () => {
  const withHot = (hotcold: THPrivate["hotcold"]): THPrivate => ({ teamId: 1, pins: [], clues: [], revealed: [], hotcold });
  const NOW = 100_000;

  it("has no meter without an active signal", () => {
    expect(hotColdView(withHot({ used: false, unlockAt: null, active: null }), NOW, null).meter).toBeNull();
    expect(hotColdView(null, NOW, 2).meter).toBeNull();
  });

  it("uses active.level when nothing was streamed, and the stream when there is", () => {
    const p = withHot({ used: true, unlockAt: 0, active: { id: "c1", until: NOW + 5000, level: 1 } });
    expect(hotColdView(p, NOW, null)).toMatchObject({ meter: 1, leftMs: 5000 });
    expect(hotColdView(p, NOW, 3).meter).toBe(3);
    expect(hotColdView(withHot({ used: true, unlockAt: 0, active: { id: "c1", until: NOW + 1, level: null } }), NOW, null).meter).toBeNull();
  });

  it("canUse is false when used, locked or not hunting", () => {
    const open = withHot({ used: false, unlockAt: NOW - 1, active: null });
    expect(hotColdView(open, NOW, null).canUse).toBe(true);
    expect(hotColdView(open, NOW, null, false).canUse).toBe(false);
    // A spectator watches the board but can't use it.
    expect(hotColdView(open, NOW, null, true, true).canUse).toBe(false);
    expect(hotColdView(withHot({ used: false, unlockAt: NOW + 65_000, active: null }), NOW, null, true, true).opensInMs).toBeNull();
    expect(hotColdView(withHot({ used: true, unlockAt: NOW - 1, active: null }), NOW, null).canUse).toBe(false);
    expect(hotColdView(withHot({ used: false, unlockAt: NOW + 1, active: null }), NOW, null).canUse).toBe(false);
    expect(hotColdView(withHot({ used: false, unlockAt: null, active: null }), NOW, null).canUse).toBe(false);
  });

  it("opensInMs counts down to unlockAt while locked", () => {
    expect(hotColdView(withHot({ used: false, unlockAt: NOW + 65_000, active: null }), NOW, null).opensInMs).toBe(65_000);
    expect(hotColdView(withHot({ used: false, unlockAt: NOW, active: null }), NOW, null).opensInMs).toBeNull();
    expect(hotColdOpensText(65_000)).toBe("Hot or cold opens in 1:05.");
  });
});
