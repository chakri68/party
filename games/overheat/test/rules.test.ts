import { describe, expect, it } from "vitest";
import { bankScore, buildDeck, cardFromCode, colourBonus, enginePoints } from "../shared/rules.ts";
import { overheatSettingFields } from "../shared/rules-text.ts";
import { POWERS, POWER_COPIES, type EngineCard } from "../shared/types.ts";

const e = (code: string, mult: 1 | 2 = 1): EngineCard => ({ card: cardFromCode(code, 0) as EngineCard["card"], mult });
const many = (...codes: string[]) => codes.map((c) => e(c));

describe("deck", () => {
  it("classic has 72 numbers and 16 powers", () => {
    const deck = buildDeck("classic");
    expect(deck).toHaveLength(88);
    expect(deck.filter((c) => c.kind === "number")).toHaveLength(72);
    expect(deck.filter((c) => c.kind === "power")).toHaveLength(16);
    expect(new Set(deck.map((c) => c.id)).size).toBe(88);
    expect(deck.map((c) => c.id)).toEqual(deck.map((_, i) => i));
    const seen = new Map<string, number>();
    for (const c of deck) if (c.kind === "number") seen.set(`${c.colour}${c.value}`, (seen.get(`${c.colour}${c.value}`) ?? 0) + 1);
    expect(seen.size).toBe(36);
    expect([...seen.values()].every((n) => n === 2)).toBe(true);
    for (const p of POWERS) expect(deck.filter((c) => c.kind === "power" && c.power === p)).toHaveLength(POWER_COPIES[p]);
  });
  it("off has numbers only", () => {
    const deck = buildDeck("off");
    expect(deck).toHaveLength(72);
    expect(deck.some((c) => c.kind === "power")).toBe(false);
  });
});

describe("cardFromCode", () => {
  it("parses numbers and powers", () => {
    expect(cardFromCode("A7", 3)).toEqual({ kind: "number", id: 3, colour: "amber", value: 7 });
    expect(cardFromCode("heatwave", 0)?.kind).toBe("power");
  });
  it.each(["X7", "R0", "R10", "nope"])("%s is null", (code) => {
    expect(cardFromCode(code, 0)).toBeNull();
  });
});

describe("scoring", () => {
  it("enginePoints applies mult", () => {
    expect(enginePoints([e("R5"), e("B3", 2)])).toBe(11);
  });
  it.each([
    [["R1", "R2", "R3"], 5],
    [["R1", "R2", "R3", "B1", "B2", "B3"], 10],
    [["R1", "A1", "B1", "G1"], 5],
    [["R1", "R2", "R3", "A1", "B1", "G1"], 10],
    [["R1", "R2"], 0],
  ])("colourBonus %j = %i", (codes, bonus) => {
    expect(colourBonus(many(...codes))).toBe(bonus);
  });
  it("bankScore adds the redline bonus", () => {
    expect(bankScore([e("R9")], true)).toBe(19);
    expect(bankScore([e("R9")], false)).toBe(9);
  });
});

describe("settings fields", () => {
  it("selects the saved options", () => {
    const f = overheatSettingFields({ target: 200, powers: "off" }, 4);
    expect(f.find((x) => x.key === "target")?.selected).toBe(2);
    expect(f.find((x) => x.key === "powers")?.selected).toBe(0);
  });
});
