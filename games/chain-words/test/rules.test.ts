import { describe, expect, it } from "vitest";
import { allWords, isWord } from "@games/words/dictionary";
import { OPENERS } from "../shared/openers.ts";
import { lastLetter, shapeProblem } from "../shared/rules.ts";
import { chainWordsSettingFields } from "../shared/rules-text.ts";
import { wordsOn } from "../server/words.ts";

describe("openers", () => {
  it("are real words, 3+ letters, none twice", () => {
    expect(OPENERS.length).toBeGreaterThanOrEqual(50);
    expect(OPENERS.filter((w) => !/^[a-z]{3,}$/.test(w) || !isWord(w))).toEqual([]);
    expect(new Set(OPENERS).size).toBe(OPENERS.length);
  });

  it("each end on a letter with plenty to follow", () => {
    expect(OPENERS.filter((w) => wordsOn(lastLetter(w), []) < 1000)).toEqual([]);
  });
});

describe("word shape", () => {
  it("wants letters, three or more, starting with the letter", () => {
    expect(shapeProblem("tiger", "t")).toBeNull();
    expect(shapeProblem("ti ger", "t")).toMatch(/letters only/);
    expect(shapeProblem("to", "t")).toMatch(/3 letters/);
    expect(shapeProblem("river", "t")).toMatch(/start with T/);
    expect(shapeProblem("t".repeat(31), "t")).toMatch(/not a word/);
  });
});

describe("wordsOn", () => {
  it("counts dictionary words by first letter, minus used ones", () => {
    const xs = allWords().filter((w) => w[0] === "x");
    expect(wordsOn("x", [])).toBe(xs.length);
    expect(wordsOn("x", ["rocket", xs[0]!])).toBe(xs.length - 1);
    expect(wordsOn("x", xs)).toBe(0);
  });
});

describe("settings fields", () => {
  it("default to 8 s and 3 lives, and the hints follow the choice", () => {
    const [clock, lives] = chainWordsSettingFields(null);
    expect(clock!.options[clock!.selected]!.label).toBe("8 s");
    expect(lives!.options[lives!.selected]!.label).toBe("3");
    expect(chainWordsSettingFields({ lives: 1 })[1]!.hint).toMatch(/One slow turn/);
    expect(chainWordsSettingFields({ turnSeconds: 5 })[0]!.hint).toMatch(/No time/);
  });
});
