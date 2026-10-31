import { describe, expect, it } from "vitest";
import { bestSelection, deadDice, diceToRoll, isFarkle, scoreDice } from "../shared/rules.ts";
import { farkleSettingFields } from "../shared/rules-text.ts";

describe("scoring table", () => {
  it.each([
    [[1], 100],
    [[5], 50],
    [[1, 5], 150],
    [[1, 1, 1], 1000],
    [[2, 2, 2], 200],
    [[3, 3, 3], 300],
    [[4, 4, 4], 400],
    [[5, 5, 5], 500],
    [[6, 6, 6], 600],
    [[3, 3, 3, 3], 1000],
    [[6, 6, 6, 6, 6], 2000],
    [[4, 4, 4, 4, 4, 4], 3000],
    [[1, 2, 3, 4, 5, 6], 1500],
    [[2, 2, 3, 3, 6, 6], 1500],
    [[2, 2, 2, 2, 6, 6], 1500], // four of a kind plus a pair counts as three pairs
    [[2, 2, 2, 6, 6, 6], 2500],
    [[2, 2, 2, 1, 5], 350],
  ])("%j scores %i", (faces, points) => {
    expect(scoreDice(faces)).toBe(points);
  });

  it("takes the best split where readings overlap", () => {
    // Four of a kind + 2×50 = 1,100, or three pairs = 1,500.
    expect(scoreDice([1, 1, 1, 1, 5, 5])).toBe(1500);
    // Three 1s and a 1 beat four of a kind.
    expect(scoreDice([1, 1, 1, 1])).toBe(1100);
    // Five 1s as five of a kind beat 1,000 + 100 + 100.
    expect(scoreDice([1, 1, 1, 1, 1])).toBe(2000);
    // Six 1s: six of a kind beats two triples (2,000 if they were 1s) and three pairs.
    expect(scoreDice([1, 1, 1, 1, 1, 1])).toBe(3000);
    // Three 5s and three 1s as two triples.
    expect(scoreDice([5, 5, 5, 1, 1, 1])).toBe(2500);
    // A straight in any order.
    expect(scoreDice([6, 4, 2, 5, 3, 1])).toBe(1500);
  });

  it("refuses a selection with any die that doesn't score", () => {
    expect(scoreDice([1, 3])).toBe(0);
    expect(scoreDice([2, 2])).toBe(0);
    expect(scoreDice([5, 5, 6])).toBe(0);
    expect(scoreDice([1, 2, 3, 4, 5])).toBe(0); // only six make a straight
    expect(scoreDice([])).toBe(0);
  });

  it("names the dice that don't score", () => {
    expect(deadDice([1, 3])).toEqual([1]);
    expect(deadDice([5, 2, 2, 1])).toEqual([1, 2]);
    expect(deadDice([1, 5])).toEqual([]);
    expect(deadDice([4])).toEqual([0]);
  });
});

describe("rolls", () => {
  it("spots a farkle: nothing in the roll scores", () => {
    expect(isFarkle([2, 3, 4, 6, 2, 3])).toBe(true);
    expect(isFarkle([2, 3])).toBe(true);
    expect(isFarkle([2, 2, 3, 3, 4, 4])).toBe(false); // three pairs
    expect(isFarkle([2, 3, 4, 6, 2, 1])).toBe(false);
    expect(isFarkle([4, 4, 4])).toBe(false);
  });

  it("finds the best selection, preferring fewer dice on a tie", () => {
    expect(bestSelection([1, 1, 1, 1, 5, 5])).toEqual({ indices: [0, 1, 2, 3, 4, 5], points: 1500 });
    expect(bestSelection([2, 3, 5, 4, 6, 2])).toEqual({ indices: [2], points: 50 });
    expect(bestSelection([2, 3, 4, 6, 2, 3]).points).toBe(0);
  });

  it("rolls all six again after hot dice", () => {
    expect(diceToRoll(6, 2)).toBe(4);
    expect(diceToRoll(3, 3)).toBe(6);
  });
});

describe("settings fields", () => {
  it("shows the current choices", () => {
    const f = farkleSettingFields({ target: 10000, entry: 0, threeFarkles: true }, 4);
    expect(f.map((x) => [x.key, x.selected])).toEqual([
      ["target", 1],
      ["entry", 0],
      ["threeFarkles", 1],
    ]);
    expect(farkleSettingFields(null, 2).map((x) => x.selected)).toEqual([0, 2, 0]);
  });
});
