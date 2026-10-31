import { describe, expect, it } from "vitest";
import { bidText, countMatches, isLegalBid, minQuantity, ordinal, skipBid, smallestRaise } from "../shared/rules.ts";
import { liarsDiceSettingFields } from "../shared/rules-text.ts";
import type { Face } from "../shared/types.ts";

const b = (quantity: number, face: Face) => ({ quantity, face });

describe("the raise ladder, wild ones off", () => {
  const legal = (prev: ReturnType<typeof b> | null, next: ReturnType<typeof b>, total = 20) => isLegalBid(prev, next, false, total);

  it("takes more dice of any face, or the same number of a higher face", () => {
    expect(legal(b(4, 3), b(4, 5))).toBe(true);
    expect(legal(b(4, 3), b(5, 2))).toBe(true);
    expect(legal(b(4, 3), b(4, 3))).toBe(false);
    expect(legal(b(4, 3), b(4, 2))).toBe(false);
    expect(legal(b(4, 3), b(3, 6))).toBe(false);
  });

  it("treats 1 as the lowest face, no half or double", () => {
    expect(legal(b(4, 3), b(4, 1))).toBe(false);
    expect(legal(b(4, 3), b(2, 1))).toBe(false);
    expect(legal(b(4, 1), b(4, 2))).toBe(true);
    expect(legal(b(4, 1), b(5, 1))).toBe(true);
  });

  it("keeps quantities between 1 and the dice on the table", () => {
    expect(legal(null, b(1, 1))).toBe(true);
    expect(legal(null, b(0, 4))).toBe(false);
    expect(legal(b(9, 5), b(10, 2), 10)).toBe(true);
    expect(legal(b(10, 5), b(10, 6), 10)).toBe(true);
    expect(legal(b(10, 6), b(11, 2), 10)).toBe(false);
    expect(smallestRaise(b(10, 6), false, 10)).toBeNull();
  });

  it("steps up by the next face, then one more of the lowest", () => {
    expect(smallestRaise(null, false, 10)).toEqual(b(1, 2));
    expect(smallestRaise(b(3, 4), false, 10)).toEqual(b(3, 5));
    expect(smallestRaise(b(3, 6), false, 10)).toEqual(b(4, 1));
  });
});

describe("the raise ladder, wild ones on", () => {
  const legal = (prev: ReturnType<typeof b> | null, next: ReturnType<typeof b>, total = 20) => isLegalBid(prev, next, true, total);

  it("needs half the quantity, rounded up, to switch to 1s", () => {
    expect(legal(b(7, 4), b(4, 1))).toBe(true);
    expect(legal(b(7, 4), b(3, 1))).toBe(false);
    expect(legal(b(6, 4), b(3, 1))).toBe(true);
    expect(legal(b(1, 6), b(1, 1))).toBe(true);
    expect(minQuantity(b(7, 4), 1, true)).toBe(4);
  });

  it("needs double plus one to switch off 1s", () => {
    expect(legal(b(4, 1), b(9, 4))).toBe(true);
    expect(legal(b(4, 1), b(8, 6))).toBe(false);
    expect(minQuantity(b(4, 1), 2, true)).toBe(9);
  });

  it("never crosses onto or off 1s on a same-quantity face step", () => {
    expect(legal(b(4, 1), b(4, 2))).toBe(false);
    expect(legal(b(4, 6), b(4, 1))).toBe(true); // half of 4 is 2: legal, but by the half rule
    expect(legal(b(4, 1), b(5, 1))).toBe(true);
    expect(legal(b(4, 1), b(4, 1))).toBe(false);
    expect(smallestRaise(b(3, 6), true, 20)).toEqual(b(4, 2));
    expect(smallestRaise(b(3, 1), true, 20)).toEqual(b(4, 1));
  });

  it("respects the table's edge", () => {
    // Nine 4s need nine dice; at eight the only way off 1s is gone, but more 1s still work.
    expect(legal(b(4, 1), b(9, 4), 8)).toBe(false);
    expect(smallestRaise(b(4, 1), true, 8)).toEqual(b(5, 1));
    // At the top of 1s, nothing is left.
    expect(smallestRaise(b(8, 1), true, 8)).toBeNull();
    // At the top of 6s, 1s are still open by the half rule.
    expect(smallestRaise(b(8, 6), true, 8)).toEqual(b(4, 1));
    expect(legal(null, b(1, 1), 1)).toBe(true);
  });
});

describe("counting", () => {
  const table: Face[] = [1, 1, 3, 3, 3, 5, 6, 2];

  it("counts 1s as every face with wild ones on", () => {
    expect(countMatches(table, 3, true)).toBe(5);
    expect(countMatches(table, 4, true)).toBe(2);
  });

  it("counts only 1s for a bid on 1s", () => {
    expect(countMatches(table, 1, true)).toBe(2);
  });

  it("counts faces as they are with wild ones off", () => {
    expect(countMatches(table, 3, false)).toBe(3);
    expect(countMatches(table, 1, false)).toBe(2);
  });
});

describe("skip bids", () => {
  it("opens one of the most common face, ties to the higher", () => {
    expect(skipBid([2, 2, 5, 5, 3], null, false, 10)).toEqual(b(1, 5));
    // With wilds, the 1s back up every face: 6 has the most.
    expect(skipBid([1, 1, 6, 4, 4], null, true, 10)).toEqual(b(1, 4));
    expect(skipBid([1, 1, 6, 4, 2], null, true, 10)).toEqual(b(1, 6));
  });

  it("raises on that face, else the least raise at all", () => {
    expect(skipBid([5, 5, 2], b(3, 4), false, 10)).toEqual(b(3, 5));
    expect(skipBid([2, 2, 3], b(3, 4), false, 10)).toEqual(b(4, 2));
    expect(skipBid([2, 2, 3], b(10, 4), false, 10)).toEqual(b(10, 5));
    expect(skipBid([2, 2, 3], b(10, 6), false, 10)).toBeNull();
  });
});

describe("words and settings", () => {
  it("reads bids and places out loud", () => {
    expect(bidText(1, 3)).toBe("one 3");
    expect(bidText(4, 6)).toBe("four 6s");
    expect(bidText(15, 2)).toBe("15 2s");
    expect([1, 2, 3, 4, 11, 12, 13, 21].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st"]);
  });

  it("shows the dice on the table for the chosen start", () => {
    const fields = liarsDiceSettingFields({ startingDice: 3, wildOnes: false }, 4);
    expect(fields.map((f) => f.key)).toEqual(["wildOnes", "spotOn", "startingDice"]);
    expect(fields[0]!.selected).toBe(1);
    expect(fields[2]).toMatchObject({ selected: 0, hint: "12 dice on the table" });
  });
});
