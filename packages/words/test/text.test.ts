import { describe, expect, it } from "vitest";
import { editDistance, isClose, normalizeGuess } from "../src/index.ts";

describe("edit distance", () => {
  it("call one typo close, on words long enough to bear it", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("abc", "abcdef", 1)).toBe(2);
    expect(isClose("aple", "apple")).toBe(true);
    expect(isClose("appel", "apple")).toBe(false); // two edits
    expect(isClose("apple", "apple")).toBe(false); // that's a hit
    expect(isClose("ca", "cat")).toBe(false); // too short to be close
  });
});

describe("guesses", () => {
  it("compare without case, accents, spaces or hyphens", () => {
    expect(normalizeGuess("  Ice-Cream ")).toBe("icecream");
    expect(normalizeGuess("ice cream")).toBe(normalizeGuess("icecream"));
    expect(normalizeGuess("Crème")).toBe("creme");
  });
});
