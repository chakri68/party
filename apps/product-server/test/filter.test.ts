import { describe, expect, it } from "vitest";
import { maskProfanity } from "../src/filter.ts";

describe("maskProfanity", () => {
  it("masks listed words in any case, keeping length", () => {
    expect(maskProfanity("what the fuck")).toBe("what the ****");
    expect(maskProfanity("FuCk you")).toBe("**** you");
    expect(maskProfanity("bhosdike")).toBe("********");
    const s = "Madarchod, ok?";
    expect(maskProfanity(s)).toHaveLength(s.length);
  });
  it("leaves words that merely contain a listed word", () => {
    for (const s of ["class", "Scunthorpe", "assassin", "Hello there", "bass", "cocktail", "shitake"]) {
      expect(maskProfanity(s)).toBe(s);
    }
  });
});
