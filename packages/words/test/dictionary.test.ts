import { describe, expect, it } from "vitest";
import { WORD_COUNT, allWords, isWord, unpack } from "../src/dictionary.ts";

const WORDS = allWords();

describe("the dictionary", () => {
  it("unpacks to sorted, lowercase, 3+ letter words", () => {
    expect(WORDS).toHaveLength(WORD_COUNT);
    expect(WORDS.every((w) => /^[a-z]{3,}$/.test(w))).toBe(true);
    expect(WORDS.every((w, i) => i === 0 || WORDS[i - 1]! < w)).toBe(true);
    expect(unpack("0abandon7ed7s")).toEqual(["abandon", "abandoned", "abandons"]);
  });

  it("knows words, and not names, possessives or nonsense", () => {
    for (const w of ["singer", "train", "house", "quickly", "zebra"]) expect(isWord(w)).toBe(true);
    for (const w of ["paris", "cat's", "Cat", "xqzt", "", "at"]) expect(isWord(w)).toBe(false);
  });

  it("unpacks once: allWords hands back the same array", () => {
    expect(allWords()).toHaveLength(WORD_COUNT);
    expect(allWords()).toBe(allWords());
  });
});
