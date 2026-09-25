import { describe, expect, it } from "vitest";
import {
  cleanChat,
  drawerPoints,
  editDistance,
  guessPoints,
  hintCount,
  isClose,
  normalizeGuess,
  parseDrawOp,
} from "../shared/rules.ts";
import { WORDS } from "../shared/words.ts";

describe("guesses", () => {
  it("compare without case, accents, spaces or hyphens", () => {
    expect(normalizeGuess("  Ice-Cream ")).toBe("icecream");
    expect(normalizeGuess("ice cream")).toBe(normalizeGuess("icecream"));
    expect(normalizeGuess("Crème")).toBe("creme");
  });

  it("clean chat down to one short line", () => {
    expect(cleanChat("  hi\n\tthere\u0000 ")).toBe("hi there");
    expect(cleanChat("x".repeat(200))).toHaveLength(60);
    expect(cleanChat(" \n ")).toBe("");
  });

  it("call one typo close, on words long enough to bear it", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("abc", "abcdef", 1)).toBe(2);
    expect(isClose("aple", "apple")).toBe(true);
    expect(isClose("appel", "apple")).toBe(false); // two edits
    expect(isClose("apple", "apple")).toBe(false); // that's a hit
    expect(isClose("ca", "cat")).toBe(false); // too short to be close
  });
});

describe("scoring and hints", () => {
  it("pays 300 for an instant guess, 50 at the buzzer, in steps of 5", () => {
    expect(guessPoints(80_000, 80_000)).toBe(300);
    expect(guessPoints(0, 80_000)).toBe(50);
    expect(guessPoints(-5, 80_000)).toBe(50);
    expect(guessPoints(33_333, 80_000) % 5).toBe(0);
  });

  it("splits the drawer's 200 across everyone who could guess", () => {
    expect(drawerPoints(1)).toBe(200);
    expect(drawerPoints(3)).toBe(65);
    expect(drawerPoints(0)).toBe(0);
  });

  it("hands out letters only on longer words, and never most of one", () => {
    expect(hintCount("cat")).toBe(0);
    expect(hintCount("apple")).toBe(1);
    expect(hintCount("hot dog")).toBe(2);
  });
});

describe("draw ops", () => {
  it("accepts well-formed ops and clamps stray points to the page", () => {
    expect(parseDrawOp({ turn: 1, op: "start", id: 0, color: 3, size: 1, points: [-5, 10, 900.4, 700] })).toEqual({
      turn: 1, op: "start", id: 0, color: 3, size: 1, points: [0, 10, 800, 600],
    });
    expect(parseDrawOp({ turn: 1, op: "undo", junk: true })).toEqual({ turn: 1, op: "undo" });
  });

  it("refuses anything else", () => {
    const bad = [
      null, [], "x",
      { turn: 1, op: "start", id: 0, color: 99, size: 1, points: [1, 1] },
      { turn: 1, op: "start", id: 0, color: 1, size: 1, points: [1] },
      { turn: 1, op: "add", id: 0, points: [1, "2"] },
      { turn: 1, op: "add", id: 0, points: Array(602).fill(1) },
      { turn: 1.5, op: "clear" },
      { turn: 1, op: "fill" },
    ];
    for (const b of bad) expect(parseDrawOp(b)).toBeNull();
  });
});

describe("the word list", () => {
  it("has no repeats and nothing too long for a debug deck", () => {
    expect(new Set(WORDS).size).toBe(WORDS.length);
    for (const w of WORDS) {
      expect(w).toBe(w.toLowerCase());
      expect(w.length).toBeLessThanOrEqual(16);
    }
  });
});
