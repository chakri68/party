import { describe, expect, it } from "vitest";
import {
  ACTION_TEXT,
  PROBLEM_CYCLE,
  PROBLEM_TEXT,
  buildDeck,
  copiesFor,
  notMyProblemRules,
  notMyProblemSettingFields,
  problemCount,
  penaltyOf,
  HAND_SIZE,
  type ActionKind,
  type ProblemKind,
} from "../shared/index.ts";

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

describe("deck", () => {
  it("copiesFor(4) matches the spec", () => {
    const c = copiesFor(4);
    expect(c).toEqual({
      "quick-fix": 6, "blame-game": 6, "not-me": 4, revenge: 3, intern: 2,
      "hr-complaint": 3, overtime: 2, promotion: 2, spy: 2, "fake-report": 2,
    });
    expect(sum(c)).toBe(32);
  });

  for (let n = 3; n <= 8; n++) {
    it(`builds a sound deck for ${n} players`, () => {
      const { actions, problems } = buildDeck(n);
      expect(problems.length).toBe(3 * n);
      expect(problemCount(n)).toBe(3 * n);
      expect(actions.length).toBe(sum(copiesFor(n)));
      const ids = [...actions, ...problems].map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
      const pile = actions.length + problems.length - HAND_SIZE * n;
      expect(pile).toBeGreaterThanOrEqual(5 * n);
      expect(pile).toBeLessThanOrEqual(7 * n);
    });
  }

  it("numbers ids from 1 per kind", () => {
    const { actions } = buildDeck(4);
    expect(actions.filter((c) => c.kind === "spy").map((c) => c.id)).toEqual(["spy-1", "spy-2"]);
  });

  it("problems follow the cycle in order", () => {
    const { problems } = buildDeck(4);
    expect(problems.map((p) => p.kind)).toEqual(Array.from({ length: 12 }, (_, i) => PROBLEM_CYCLE[i % 6]));
    const count = (k: ProblemKind) => problems.filter((p) => p.kind === k).length;
    expect([count("server-down"), count("data-leak"), count("angry-client")]).toEqual([6, 2, 4]);
  });

  it("penalties", () => {
    expect(penaltyOf("data-leak")).toBe(2);
    expect(penaltyOf("server-down")).toBe(1);
    expect(penaltyOf("angry-client")).toBe(1);
  });
});

describe("copy", () => {
  const lines = [
    ...Object.values(ACTION_TEXT as Record<ActionKind, { name: string; line: string }>),
    ...Object.values(PROBLEM_TEXT),
  ].flatMap((t) => [t.name, t.line]).concat(notMyProblemRules);
  it("has no emoji and never says strike", () => {
    for (const l of lines) {
      expect(l).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(l.toLowerCase()).not.toContain("strike");
    }
  });
  it("setting fields default to 8 seconds and show deck size", () => {
    const f = notMyProblemSettingFields({}, 4)[0]!;
    expect(f.selected).toBe(1);
    expect(f.hint).toBe("12 Problems in 24 cards");
  });
  it("an unknown time selects the default, 8 seconds", () => {
    expect(notMyProblemSettingFields({ reactionSeconds: 7 }, 4)[0]!.selected).toBe(1);
  });
});
