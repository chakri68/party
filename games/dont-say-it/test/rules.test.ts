import { describe, expect, it } from "vitest";
import { CARDS, parseCard } from "../server/cards.ts";
import { dontSayItSettingFields } from "../shared/rules-text.ts";
import { FORBIDDEN_PER_CARD } from "../shared/types.ts";

describe("the deck", () => {
  it("has 150+ cards, no target twice, no id twice", () => {
    expect(CARDS.length).toBeGreaterThanOrEqual(150);
    expect(new Set(CARDS.map((c) => c.target)).size).toBe(CARDS.length);
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(CARDS.length);
  });

  it("gives every card exactly five forbidden words, none twice", () => {
    for (const c of CARDS) {
      expect(c.forbidden, c.target).toHaveLength(FORBIDDEN_PER_CARD);
      expect(new Set(c.forbidden).size, c.target).toBe(FORBIDDEN_PER_CARD);
    }
  });

  it("never forbids the target, or a word that carries it", () => {
    const squash = (s: string) => s.replace(/[^a-z]/g, "");
    for (const c of CARDS) {
      for (const f of c.forbidden) expect(squash(f).includes(squash(c.target)), `${c.target}: ${f}`).toBe(false);
    }
  });

  it("keeps everything lowercase and tidy", () => {
    for (const c of CARDS) {
      for (const w of [c.target, ...c.forbidden]) {
        expect(w, c.target).toBe(w.trim().toLowerCase());
        expect(w, c.target).toMatch(/^[a-z][a-z ]*[a-z]$/);
      }
      expect(c.id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("refuses a malformed line", () => {
    expect(() => parseCard("kettle")).toThrow(/target/);
    expect(() => parseCard("kettle: boil, water")).toThrow(/five/);
    expect(parseCard("alarm clock: a, b, c, d, e")).toEqual({ id: "alarm-clock", target: "alarm clock", forbidden: ["a", "b", "c", "d", "e"] });
  });
});

describe("settings fields", () => {
  it("offer turn length and turns per team, with the current pick selected", () => {
    const [len, turns] = dontSayItSettingFields({ turnSeconds: 90, turnsPerTeam: 2 });
    expect(len!.options.map((o) => o.label)).toEqual(["45 s", "60 s", "90 s"]);
    expect(len!.selected).toBe(2);
    expect(turns!.options.map((o) => o.label)).toEqual(["2", "3", "5"]);
    expect(turns!.selected).toBe(0);
    const d = dontSayItSettingFields(null);
    expect([d[0]!.selected, d[1]!.selected]).toEqual([1, 1]);
  });
});
