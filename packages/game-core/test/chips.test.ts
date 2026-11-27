import { describe, expect, it } from "vitest";
import { awardPots, buildPots, compareRanks, formatChips, ordinal } from "../src/chips.ts";

describe("buildPots", () => {
  it("one all-in under two callers: a main pot for three and a side pot for two", () => {
    expect(buildPots({ a: 100, b: 300, c: 300 }, [])).toEqual([
      { amount: 300, eligible: ["a", "b", "c"] },
      { amount: 400, eligible: ["b", "c"] },
    ]);
  });

  it("three different all-in amounts make three pots", () => {
    expect(buildPots({ a: 50, b: 150, c: 300, d: 300 }, [])).toEqual([
      { amount: 200, eligible: ["a", "b", "c", "d"] },
      { amount: 300, eligible: ["b", "c", "d"] },
      { amount: 300, eligible: ["c", "d"] },
    ]);
  });

  it("a folded player's chips stay in the pots they reached, and they can't win them", () => {
    // d put in 250 and folded: 100 in the main pot, 150 in the side pot.
    expect(buildPots({ a: 100, b: 400, c: 400, d: 250 }, ["d"])).toEqual([
      { amount: 400, eligible: ["a", "b", "c"] },
      { amount: 750, eligible: ["b", "c"] },
    ]);
  });

  it("an uncalled bet goes back to the bettor", () => {
    expect(buildPots({ a: 500, b: 200 }, [])).toEqual([
      { amount: 400, eligible: ["a", "b"] },
      { amount: 300, eligible: ["a"], uncalled: true },
    ]);
  });

  it("uncalled is only the unmatched part: a folder's chips above the caller still count", () => {
    // b all-in 100, c folded after 300, a bet 600. 300 of a's is unmatched by anyone.
    expect(buildPots({ a: 600, b: 100, c: 300 }, ["c"])).toEqual([
      { amount: 300, eligible: ["a", "b"] },
      { amount: 400, eligible: ["a"] },
      { amount: 300, eligible: ["a"], uncalled: true },
    ]);
  });

  it("everyone in for the same: one pot", () => {
    expect(buildPots({ a: 40, b: 40, c: 40, d: 20 }, ["d"])).toEqual([{ amount: 140, eligible: ["a", "b", "c"] }]);
  });

  it("skips players who put nothing in", () => {
    expect(buildPots({ a: 20, b: 20, c: 0 }, ["c"])).toEqual([{ amount: 40, eligible: ["a", "b"] }]);
  });
});

describe("awardPots", () => {
  // Hand strengths as tiebreak tuples: higher wins.
  const strong = [1, 14];
  const weak = [0, 9];

  it("ties within a side pot split it, while the main pot goes to the best hand", () => {
    const pots = buildPots({ a: 100, b: 400, c: 400 }, []);
    const { won, results } = awardPots(pots, { a: [2, 5], b: strong, c: strong }, ["a", "b", "c"]);
    expect(results.map((r) => r.winners)).toEqual([["a"], ["b", "c"]]);
    expect(won).toEqual({ a: 300, b: 300, c: 300 });
  });

  it("odd chips go to the first tied winner left of the button", () => {
    // Seat order from the button's left: c, a, b.
    const pots = [{ amount: 301, eligible: ["a", "b", "c"] }];
    const { won } = awardPots(pots, { a: strong, b: weak, c: strong }, ["c", "a", "b"]);
    expect(won).toEqual({ c: 151, a: 150 });
  });

  it("a three-way split with two odd chips gives both to the first winner", () => {
    const pots = [{ amount: 302, eligible: ["a", "b", "c"] }];
    const { won } = awardPots(pots, { a: strong, b: strong, c: strong }, ["b", "c", "a"]);
    expect(won).toEqual({ b: 102, c: 100, a: 100 });
  });

  it("an uncalled bet comes back without needing a hand", () => {
    const pots = buildPots({ a: 500, b: 200 }, []);
    const { won, returned, results } = awardPots(pots, { a: weak, b: strong }, ["a", "b"]);
    expect(won).toEqual({ b: 400 });
    expect(returned).toEqual({ a: 300 });
    expect(results.at(-1)).toMatchObject({ uncalled: true, winners: ["a"], amount: 300 });
  });
});

describe("compareRanks", () => {
  it("compares left to right, and a longer tuple wins a tie on the shared part", () => {
    expect(compareRanks([2, 9], [2, 8])).toBeGreaterThan(0);
    expect(compareRanks([1, 14], [2, 2])).toBeLessThan(0);
    expect(compareRanks([3, 5], [3, 5])).toBe(0);
    expect(compareRanks([3, 5, 2], [3, 5])).toBeGreaterThan(0);
  });
});

describe("formatChips", () => {
  it("puts a comma every three digits", () => {
    expect(formatChips(0)).toBe("0");
    expect(formatChips(999)).toBe("999");
    expect(formatChips(4200)).toBe("4,200");
    expect(formatChips(1234567)).toBe("1,234,567");
  });
});

describe("ordinal", () => {
  it("gives 1st, 2nd, 3rd, and th for the teens", () => {
    expect([1, 2, 3, 4, 10, 11, 12, 13, 21, 22, 23, 101, 111, 112].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "10th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th", "112th",
    ]);
  });
});
