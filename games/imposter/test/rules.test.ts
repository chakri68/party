import { describe, expect, it } from "vitest";
import { PACK } from "../server/words.ts";
import { clueProblem, cleanClue, guessMatches, normalizeGuess } from "../shared/rules.ts";
import { imposterSettingFields } from "../shared/rules-text.ts";

describe("pack", () => {
  const words = PACK.flatMap((c) => c.words);

  it("has 150+ words, 12+ a category, none twice", () => {
    expect(words.length).toBeGreaterThanOrEqual(150);
    for (const c of PACK) expect(c.words.length, c.name).toBeGreaterThanOrEqual(12);
    const seen = new Set<string>();
    for (const w of words) {
      expect(seen.has(normalizeGuess(w)), w).toBe(false);
      seen.add(normalizeGuess(w));
    }
    expect(new Set(PACK.map((c) => c.name)).size).toBe(PACK.length);
  });

  it("keeps words tidy: lowercase, short, clueable", () => {
    for (const w of words) {
      expect(w, w).toBe(w.trim().toLowerCase());
      expect(w.length, w).toBeLessThanOrEqual(20);
      expect(normalizeGuess(w).length, w).toBeGreaterThanOrEqual(3);
    }
  });

  it("never names its category in a word", () => {
    const skip = new Set(["the", "and", "around", "things", "getting", "about"]);
    for (const c of PACK) {
      const keys = c.name.toLowerCase().split(/\s+/).filter((k) => k.length > 2 && !skip.has(k));
      for (const w of c.words) {
        for (const k of keys) expect(normalizeGuess(w).includes(normalizeGuess(k).replace(/s$/, "")), `${c.name}: ${w}`).toBe(false);
      }
    }
  });
});

describe("clues", () => {
  it("are one line, 40 at most", () => {
    expect(cleanClue("  big\n  and   grey ")).toBe("big and grey");
    expect(cleanClue("x".repeat(80))).toHaveLength(40);
  });

  it("can't be empty, the word, or carry it", () => {
    expect(clueProblem("", "kettle")).toMatch(/clue/);
    expect(clueProblem("Kettle", "kettle")).toMatch(/word/);
    expect(clueProblem("kettles boil", "kettle")).toMatch(/word/);
    expect(clueProblem("bunk-bed", "bunk bed")).toMatch(/word/);
    expect(clueProblem("whistles", "kettle")).toBeNull();
  });
});

describe("the last guess", () => {
  it("forgives case, spaces, accents and plurals", () => {
    expect(guessMatches(" Rolling-Pin ", "rolling pin").right).toBe(true);
    expect(guessMatches("pinata", "piñata").right).toBe(true);
    expect(guessMatches("curtain", "curtains").right).toBe(true);
    expect(guessMatches("bushes", "bush").right).toBe(true);
  });

  it("doesn't take one letter off; that's only close", () => {
    expect(guessMatches("camp", "lamp")).toEqual({ right: false, close: true });
    expect(guessMatches("teapot", "kettle")).toEqual({ right: false, close: false });
    expect(guessMatches("", "kettle")).toEqual({ right: false, close: false });
  });
});

describe("settings fields", () => {
  it("offer rounds and talking time, with the current pick selected", () => {
    const [, rounds, talk] = imposterSettingFields({ rounds: 7, discussSeconds: 30 });
    expect(rounds!.options.map((o) => o.label)).toEqual(["3", "5", "7"]);
    expect(rounds!.selected).toBe(2);
    expect(talk!.selected).toBe(0);
    expect(imposterSettingFields(null)[2]!.selected).toBe(1);
  });
});
