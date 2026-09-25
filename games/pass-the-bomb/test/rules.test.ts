import { describe, expect, it } from "vitest";
import { normalizeWord, ordinal, parseTyping, shapeProblem } from "../shared/rules.ts";
import { PACKED, WORD_COUNT } from "../server/dictionary.ts";
import { CLUSTERS, MIN_MATCHES, isWord, unpack } from "../server/words.ts";

const WORDS = unpack(PACKED);

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
});

describe("clusters", () => {
  it(`each have at least ${MIN_MATCHES} words to find`, () => {
    const thin = CLUSTERS.map((c) => [c, WORDS.filter((w) => w.includes(c)).length] as const).filter(([, n]) => n < MIN_MATCHES);
    expect(thin).toEqual([]);
  });

  it("are two or three letters, and none twice", () => {
    expect(CLUSTERS.every((c) => /^[a-z]{2,3}$/.test(c))).toBe(true);
    expect(new Set(CLUSTERS).size).toBe(CLUSTERS.length);
  });
});

describe("word shape", () => {
  it("wants letters, three or more, with the cluster in one piece", () => {
    expect(shapeProblem("singer", "ing")).toBeNull();
    expect(shapeProblem("sin ger", "ing")).toMatch(/Letters only/);
    expect(shapeProblem("ing", "ing")).toBeNull(); // the dictionary gets the final say
    expect(shapeProblem("in", "in")).toMatch(/3 letters/);
    expect(shapeProblem("signing", "tr")).toMatch(/TR/);
    expect(shapeProblem("sting", "ign")).toMatch(/IGN/);
  });

  it("compares trimmed and lowercase", () => {
    expect(normalizeWord("  Singer ")).toBe("singer");
  });
});

describe("typing stream", () => {
  it("keeps letters, drops the rest, and turns junk away", () => {
    expect(parseTyping({ turn: 3, text: "Sin-g3r!" })).toEqual({ turn: 3, text: "singr" });
    expect(parseTyping({ turn: 3, text: "x", wrong: true })).toEqual({ turn: 3, text: "x", wrong: true });
    expect(parseTyping({ turn: 3, text: "a".repeat(80) })!.text).toHaveLength(30);
    expect(parseTyping({ turn: "3", text: "a" })).toBeNull();
    expect(parseTyping(["a"])).toBeNull();
    expect(parseTyping(null)).toBeNull();
  });
});

it("ordinals", () => {
  expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
});
