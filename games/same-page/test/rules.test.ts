import { describe, expect, it } from "vitest";
import { PROMPT_POOL } from "../shared/pool.ts";
import { PROMPTS } from "../shared/prompts.ts";
import {
  biggestFirst,
  groupAnswers,
  groupLabel,
  mergeProblem,
  nearMerges,
  normalizeAnswer,
  sameAnswer,
  scoreRound,
  splitGroup,
  viewGroups,
} from "../shared/rules.ts";
import { samePageSettingFields } from "../shared/rules-text.ts";
import { MAX_ANSWER } from "../shared/types.ts";

const same = (a: string, b: string) => sameAnswer(normalizeAnswer(a), normalizeAnswer(b));
const entries = (answers: Record<string, string>) => Object.entries(answers).map(([id, text]) => ({ id, text }));
const ids = (groups: { members: string[] }[]) => groups.map((g) => g.members);

describe("normalization", () => {
  it("ignores case, outer and inner whitespace, punctuation and accents", () => {
    expect(normalizeAnswer("  PIZZA ")).toBe("pizza");
    expect(normalizeAnswer("ice   cream")).toBe("icecream");
    expect(normalizeAnswer("Ice-Cream!")).toBe("icecream");
    expect(normalizeAnswer("Crème brûlée")).toBe("cremebrulee");
    expect(normalizeAnswer("   ")).toBe("");
  });

  it("drops a leading a / an / the, but only as a whole word", () => {
    expect(normalizeAnswer("The Moon")).toBe("moon");
    expect(normalizeAnswer("a cat")).toBe("cat");
    expect(normalizeAnswer("An  apple")).toBe("apple");
    expect(normalizeAnswer("theatre")).toBe("theatre");
    expect(normalizeAnswer("antelope")).toBe("antelope");
    // Nothing after it: the word itself is the answer.
    expect(normalizeAnswer("A")).toBe("a");
  });

  it("matches plurals with s, es and ies", () => {
    expect(same("cats", "cat")).toBe(true);
    expect(same("cakes", "cake")).toBe(true);
    expect(same("boxes", "box")).toBe(true);
    expect(same("glasses", "glass")).toBe(true);
    expect(same("berries", "berry")).toBe(true);
    expect(same("cookies", "cookie")).toBe(true);
    expect(same("The Dogs", "a dog")).toBe(true);
  });

  it("never cuts below three letters, and leaves -ss words alone", () => {
    expect(same("bus", "bu")).toBe(false);
    expect(same("is", "i")).toBe(false);
    expect(same("chess", "ches")).toBe(false);
  });
});

describe("near-duplicates", () => {
  it("joins one-letter typos on words of 5+ letters", () => {
    expect(same("pepperoni", "peperoni")).toBe(true);
    expect(same("banana", "bananna")).toBe(true);
    expect(same("chocolate", "chocolat")).toBe(true);
  });

  it("keeps short words apart", () => {
    expect(same("cat", "car")).toBe(false);
    expect(same("red", "bed")).toBe(false);
    expect(same("tea", "pea")).toBe(false);
    expect(same("milk", "silk")).toBe(false);
    expect(same("pepperoni", "mushroom")).toBe(false);
  });

  it("blank never matches anything, blank included", () => {
    expect(sameAnswer("", "")).toBe(false);
    expect(sameAnswer("", "cat")).toBe(false);
  });
});

describe("grouping", () => {
  it("groups in seat order, chaining matches, and skips blanks", () => {
    const g = groupAnswers(entries({ a: "Pizza", b: "cat", c: "pizzas", d: "", e: "The pizza", f: "car" }));
    expect(ids(g)).toEqual([["a", "c", "e"], ["b"], ["f"]]);
    expect(g.map((x) => x.id)).toEqual(["g-a", "g-b", "g-f"]);
  });

  it("typo-level matches are machine merges the host can split back out", () => {
    const answers = { a: "pepperoni", b: "horse", c: "peperoni", d: "house", e: "pepperonis" };
    const groups = groupAnswers(entries(answers));
    // Exact (plurals aside) stays one group; a typo apart doesn't.
    expect(ids(groups)).toEqual([["a", "e"], ["b"], ["c"], ["d"]]);
    const merges = nearMerges(groups, answers);
    expect(merges).toEqual([
      { from: "g-c", into: "g-a", auto: true },
      { from: "g-d", into: "g-b", auto: true },
    ]);
    const view = viewGroups(groups, merges, answers);
    expect(view.map((v) => [v.id, v.members.map((m) => m.id), v.merged])).toEqual([
      ["g-a", ["a", "e", "c"], true],
      ["g-b", ["b", "d"], true],
    ]);
    // "horse" isn't "house": the host splits it.
    expect(viewGroups(groups, splitGroup(merges, "g-b"), answers).map((v) => v.members.map((m) => m.id))).toEqual([["a", "e", "c"], ["b"], ["d"]]);
  });

  it("labels a group with its most common spelling, first on a tie", () => {
    expect(groupLabel(["Pizza", "pizzas", "pizza"])).toBe("Pizza");
    expect(groupLabel(["pizzas", "Pizza", "pizza"])).toBe("Pizza");
    expect(groupLabel(["cats", "cat"])).toBe("cats");
  });

  it("merges show their members under the group merged into, and split undoes them", () => {
    const answers = { a: "tv", b: "telly", c: "television", d: "radio" };
    const groups = groupAnswers(entries(answers));
    expect(groups).toHaveLength(4);
    let merges = [{ from: "g-b", into: "g-a" }];
    merges.push({ from: "g-c", into: "g-a" });
    let view = viewGroups(groups, merges, answers);
    expect(view.map((v) => [v.id, v.members.map((m) => m.id), v.merged])).toEqual([
      ["g-a", ["a", "b", "c"], true],
      ["g-d", ["d"], false],
    ]);
    expect(mergeProblem(groups, merges, "g-b", "g-d")).toMatch(/is gone/);
    expect(mergeProblem(groups, merges, "g-a", "g-a")).toMatch(/2 different/);
    expect(mergeProblem(groups, merges, "g-d", "g-a")).toBeNull();
    merges = splitGroup(merges, "g-a");
    view = viewGroups(groups, merges, answers);
    expect(view).toHaveLength(4);
  });

  it("a merged group carries what was merged into it when merged again", () => {
    const answers = { a: "x1", b: "x2", c: "x3" };
    const groups = groupAnswers(entries(answers));
    const merges = [
      { from: "g-b", into: "g-a" },
      { from: "g-a", into: "g-c" },
    ];
    expect(viewGroups(groups, merges, answers).map((v) => v.members.map((m) => m.id))).toEqual([["c", "a", "b"]]);
    // Splitting the outer one brings back the inner merge whole.
    expect(viewGroups(groups, splitGroup(merges, "g-c"), answers).map((v) => v.members.map((m) => m.id))).toEqual([["a", "b"], ["c"]]);
  });

  it("orders biggest first, keeping order on a tie", () => {
    const g = [
      { id: "1", members: [1] },
      { id: "2", members: [1, 2] },
      { id: "3", members: [1] },
      { id: "4", members: [1, 2] },
    ];
    expect(biggestFirst(g).map((x) => x.id)).toEqual(["2", "4", "1", "3"]);
  });
});

describe("scoring", () => {
  const grp = (id: string, ...m: string[]) => ({ id, members: m.map((x) => ({ id: x })) });
  const zero = { a: 0, b: 0, c: 0, d: 0, e: 0 };

  it("the biggest group scores 1 each, nobody else", () => {
    const s = scoreRound([grp("x", "a", "b", "c"), grp("y", "d", "e")], false, zero);
    expect(s.winners).toEqual(["x"]);
    expect(s.points).toEqual({ a: 1, b: 1, c: 1, d: 0, e: 0 });
  });

  it("groups tied for biggest all score", () => {
    const s = scoreRound([grp("x", "a", "b"), grp("y", "c", "d"), grp("z", "e")], false, zero);
    expect(s.winners).toEqual(["x", "y"]);
    expect(s.points).toEqual({ a: 1, b: 1, c: 1, d: 1, e: 0 });
  });

  it("a group of one never scores, even when it's the biggest; blanks score nothing", () => {
    const s = scoreRound([grp("x", "a"), grp("y", "b")], false, zero);
    expect(s.winners).toEqual([]);
    expect(Object.values(s.points).every((n) => n === 0)).toBe(true);
    // c, d and e answered nothing: they're in no group.
    expect(scoreRound([], false, zero).points).toEqual(zero);
  });

  it("lone answer: exactly one loner loses a point", () => {
    const s = scoreRound([grp("x", "a", "b"), grp("y", "c")], true, { a: 0, b: 0, c: 2 });
    expect(s.loneId).toBe("c");
    expect(s.points).toEqual({ a: 1, b: 1, c: -1 });
  });

  it("lone answer never takes a score below zero", () => {
    const s = scoreRound([grp("x", "a", "b"), grp("y", "c")], true, { a: 0, b: 0, c: 0 });
    expect(s.loneId).toBe("c");
    expect(s.points.c).toBe(0);
  });

  it("lone answer: two loners, or none, cost nothing; off costs nothing", () => {
    expect(scoreRound([grp("x", "a", "b"), grp("y", "c"), grp("z", "d")], true, { a: 0, b: 0, c: 3, d: 3 }).loneId).toBeNull();
    expect(scoreRound([grp("x", "a", "b"), grp("y", "c", "d")], true, { a: 1, b: 1, c: 1, d: 1 }).loneId).toBeNull();
    expect(scoreRound([grp("x", "a", "b"), grp("y", "c")], false, { a: 0, b: 0, c: 3 }).points.c).toBe(0);
  });
});

describe("prompts", () => {
  it("has 150+ of our own, plus Face-Off's as Name …, no id twice", () => {
    expect(PROMPTS.length).toBeGreaterThanOrEqual(150);
    expect(new Set(PROMPTS).size).toBe(PROMPTS.length);
    expect(new Set(PROMPT_POOL.map((p) => p.id)).size).toBe(PROMPT_POOL.length);
    expect(PROMPT_POOL.some((p) => p.text === "Name a breakfast food")).toBe(true);
  });

  it("keeps every prompt tidy and phone-sized", () => {
    for (const p of PROMPT_POOL) {
      expect(p.text).toBe(p.text.trim());
      expect(p.text[0]).toBe(p.text[0]!.toUpperCase());
      expect(p.text.length).toBeLessThanOrEqual(60);
      expect(p.text).not.toMatch(/[.?!]$/);
    }
  });
});

describe("settings fields", () => {
  it("rounds, answer time and lone answer, current picks selected", () => {
    const f = samePageSettingFields({ rounds: 16, answerSeconds: 20, lone: true }, 5);
    expect(f.map((x) => x.key)).toEqual(["rounds", "answerSeconds", "lone"]);
    expect(f.map((x) => x.selected)).toEqual([2, 0, 1]);
    expect(f[0]!.options.map((o) => o.patch)).toEqual([{ rounds: 8 }, { rounds: 12 }, { rounds: 16 }]);
  });

  it("defaults to 12 rounds, 30 seconds, lone off", () => {
    expect(samePageSettingFields(null, 3).map((x) => x.selected)).toEqual([1, 1, 0]);
  });

  it("caps answers at a phone-friendly length", () => {
    expect(MAX_ANSWER).toBe(40);
  });
});
