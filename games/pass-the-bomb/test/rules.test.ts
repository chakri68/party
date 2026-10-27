import { describe, expect, it } from "vitest";
import { normalizeWord, ordinal, parseTyping, shapeProblem } from "../shared/rules.ts";
import { allWords } from "@games/words/dictionary";
import { CLUSTERS, MIN_MATCHES } from "../server/words.ts";

const WORDS = allWords();

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
