import { describe, expect, it } from "vitest";
import { editDistance, isClose } from "../src/index.ts";

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
