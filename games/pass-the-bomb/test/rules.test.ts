import { seededRandomInt } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { displayCluster, effectiveCluster, modesOf, normalizeWord, ordinal, parseTyping, shapeProblem } from "../shared/rules.ts";
import { allWords, isWord } from "@games/words/dictionary";
import { CLUSTERS, MIN_MATCHES } from "../server/words.ts";
import { CATEGORY_WORDS, inCategory, MIN_CATEGORY_WORDS } from "../server/categories.ts";
import { dealPrompt, fits, promptsFor } from "../server/prompts.ts";
import { modesProblem, VIABLE, viabilityKey } from "../shared/viable.ts";
import { passTheBombSettingFields } from "../shared/rules-text.ts";
import { CATEGORIES, DEFAULT_SETTINGS, MIN_ANSWERS, NO_MODES, type BombModes } from "../shared/types.ts";

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

/** All sixteen, reverse included. */
const COMBOS: BombModes[] = Array.from({ length: 16 }, (_, i) => ({
  ending: !!(i & 1),
  reverse: !!(i & 2),
  length: !!(i & 4),
  category: !!(i & 8),
}));
const label = (m: BombModes) => Object.entries(m).filter(([, v]) => v).map(([k]) => k).join("+") || "none";

describe("categories", () => {
  it(`have ${MIN_CATEGORY_WORDS}+ dictionary words each, none twice`, () => {
    for (const c of CATEGORIES) {
      const words = CATEGORY_WORDS[c];
      expect(words.length, c).toBeGreaterThanOrEqual(MIN_CATEGORY_WORDS);
      expect(new Set(words).size, c).toBe(words.length);
      expect(words.filter((w) => !isWord(w)), c).toEqual([]);
      expect(words.every((w) => /^[a-z]{3,}$/.test(w)), c).toBe(true);
    }
    expect(inCategory("animals", "platypus")).toBe(true);
    expect(inCategory("food", "platypus")).toBe(false);
  });
});

describe("modes", () => {
  it("reverse flips what the bomb shows, nothing else touches it", () => {
    expect(effectiveCluster("gni", { ...NO_MODES, reverse: true })).toBe("ing");
    expect(displayCluster("ing", { ...NO_MODES, reverse: true })).toBe("gni");
    expect(effectiveCluster("ing", { ending: true, reverse: false, length: true, category: true })).toBe("ing");
    for (const m of COMBOS) expect(effectiveCluster(displayCluster("tar", m), m)).toBe("tar");
  });

  it("modesOf takes the four booleans and nothing else", () => {
    expect(modesOf({ ending: true, reverse: "yes" } as never)).toEqual({ ...NO_MODES, ending: true });
    expect(modesOf(null)).toEqual(NO_MODES);
  });

  it("shapeProblem: ending wants the end, length wants 5 to 10", () => {
    const end = { ...NO_MODES, ending: true };
    expect(shapeProblem("running", "ing", end)).toBeNull();
    expect(shapeProblem("singer", "ing", end)).toMatch(/end in ING/);
    const len = { ...NO_MODES, length: true };
    expect(shapeProblem("sing", "ing", len)).toMatch(/5 to 10/);
    expect(shapeProblem("singing", "ing", len)).toBeNull();
    expect(shapeProblem("overthinking", "ing", len)).toMatch(/5 to 10/);
    // Said as shown, so the error doesn't do the reversing for you.
    expect(shapeProblem("train", "ing", { ...NO_MODES, reverse: true })).toMatch(/GNI backwards/);
    expect(shapeProblem("train", "ing", { ...NO_MODES, reverse: true })).not.toMatch(/ING/);
    // Off, it's the shipped rule.
    expect(shapeProblem("singer", "ing")).toBe(shapeProblem("singer", "ing", NO_MODES));
  });
});

describe("prompts", () => {
  it("every combination has prompts, each with enough answers that really fit", () => {
    for (const m of COMBOS) {
      const pool = promptsFor(m);
      expect(pool.length, label(m)).toBeGreaterThan(0);
      const bad: string[] = [];
      for (const p of pool) {
        if (p.answers.length < MIN_ANSWERS || (p.category === null) !== !m.category) bad.push(`${p.category}:${p.cluster}`);
        // The dictionary pools run to tens of thousands: every 37th will do there.
        const step = p.category ? 1 : 37;
        for (let i = 0; i < p.answers.length; i += step) {
          const w = p.answers[i]!;
          const known = p.category ? inCategory(p.category, w) : isWord(w);
          if (shapeProblem(w, p.cluster, m) !== null || !known) bad.push(`${p.category}:${p.cluster}:${w}`);
        }
      }
      expect(bad, label(m)).toEqual([]);
      expect(modesProblem(m), label(m)).toBeNull();
    }
  });

  it("the lobby's table matches a fresh count", () => {
    const fresh: Record<string, { prompts: number; answers: number }> = {};
    for (const m of COMBOS.filter((c) => !c.reverse)) {
      const pool = promptsFor(m);
      fresh[viabilityKey(m)] = { prompts: pool.length, answers: new Set(pool.flatMap((p) => p.answers)).size };
    }
    expect(fresh).toEqual(VIABLE);
  });

  it("an empty combination is refused with a reason", () => {
    expect(modesProblem(NO_MODES, { "000": { prompts: 0, answers: 0 } })).toMatch(/Too few/);
    expect(modesProblem(NO_MODES, {})).toMatch(/Too few/);
  });

  it("fits is the shape rule without the word checks", () => {
    expect(fits("running", "ing", { ending: true, length: false })).toBe(true);
    expect(fits("sing", "ing", { ending: true, length: true })).toBe(false);
  });

  it("dealing skips the current prompt, then the dry ones, and only then takes what's left", () => {
    const pool = [
      { cluster: "aa", category: null, answers: Array.from({ length: 9 }, (_, i) => `a${i}`) },
      { cluster: "bb", category: null, answers: Array.from({ length: 9 }, (_, i) => `b${i}`) },
      { cluster: "cc", category: null, answers: Array.from({ length: 9 }, (_, i) => `c${i}`) },
    ];
    const first = () => 0;
    expect(dealPrompt(pool, [], { cluster: "aa", category: null }, first).cluster).toBe("bb");
    // bb down to 7 unused: not dealt while something else has 8.
    expect(dealPrompt(pool, ["b0", "b1"], { cluster: "aa", category: null }, first).cluster).toBe("cc");
    // Everything dry: the one with most left.
    const used = [...pool[0]!.answers.slice(0, 5), ...pool[1]!.answers.slice(0, 3), ...pool[2]!.answers.slice(0, 7)];
    expect(dealPrompt(pool, used, { cluster: "zz", category: null }, first).cluster).toBe("bb");
    // Played out entirely: anything but the current one.
    const all = pool.flatMap((p) => p.answers);
    expect(dealPrompt(pool, all, { cluster: "aa", category: null }, first).cluster).toBe("bb");
  });

  it("category mode picks a category first, then a cluster in it", () => {
    const pool = promptsFor({ ...NO_MODES, category: true });
    const seen = new Set<string>();
    const rng = seededRandomInt(5);
    for (let i = 0; i < 300; i++) seen.add(dealPrompt(pool, [], { cluster: "", category: null }, rng).category!);
    expect([...seen].sort()).toEqual([...CATEGORIES].sort());
  });
});

describe("settings fields", () => {
  it("lives, fuse, four modes and unknown words, defaults selected", () => {
    const fields = passTheBombSettingFields(DEFAULT_SETTINGS);
    expect(fields.map((f) => f.key)).toEqual(["lives", "fuse", "ending", "reverse", "length", "category", "unknown"]);
    expect(fields.find((f) => f.key === "unknown")!.options[fields.find((f) => f.key === "unknown")!.selected]!.label).toBe("Room votes");
    expect(fields.find((f) => f.key === "ending")!.selected).toBe(0);
    expect(fields.every((f) => f.options.every((o) => !o.label.includes("too few")))).toBe(true);
  });

  it("warns when a combination is thin", () => {
    const fields = passTheBombSettingFields({ ...DEFAULT_SETTINGS, ending: true, length: true, category: true });
    expect(fields.find((f) => f.key === "category")!.hint).toMatch(/Thin/);
    expect(fields.find((f) => f.key === "reverse")!.hint).toMatch(/ING/);
  });
});
