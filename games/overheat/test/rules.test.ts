import { describe, expect, it } from "vitest";
import { bankScore, buildDeck, cardFromCode, colourBonus, enginePoints } from "../shared/rules.ts";
import { cutthroatRules, overheatSettingFields } from "../shared/rules-text.ts";
import { overheatGame } from "../server/game.ts";
import { POWER_LINES, POWER_NAMES } from "../shared/rules.ts";
import { act, find, ok, stateWith } from "./helpers.ts";
import { BOUNTY, CLASSIC_POWERS, CUTTHROAT_COPIES, HAND_MAX, POWERS, POWER_COPIES, type EngineCard, type PowerKind } from "../shared/types.ts";

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

describe("cutthroat", () => {
  const copies = { vent: 4, turbo: 3, shove: 3, wrench: 2, fuse: 2, heatwave: 2, steal: 3, dump: 2, audit: 2, block: 3 };
  it("builds 98 cards with 26 powers", () => {
    const deck = buildDeck("cutthroat");
    expect(deck).toHaveLength(98);
    expect(deck.filter((c) => c.kind === "power")).toHaveLength(26);
    expect(deck.map((c) => c.id)).toEqual(deck.map((_, i) => i));
    for (const [p, n] of Object.entries(copies)) expect(deck.filter((c) => c.kind === "power" && c.power === p)).toHaveLength(n);
    expect(CUTTHROAT_COPIES).toEqual(copies);
  });
  it("classic keeps its old deck", () => {
    const deck = buildDeck("classic");
    expect(deck).toHaveLength(88);
    expect(deck.some((c) => c.kind === "power" && ["steal", "dump", "audit", "block"].includes(c.power))).toBe(false);
    expect(deck.slice(72).map((c) => c.kind === "power" && c.power)).toEqual(
      ["vent", "turbo", "shove", "wrench", "fuse", "heatwave"].flatMap((p) => Array(POWER_COPIES[p as PowerKind]).fill(p)),
    );
  });
  it("constants and names", () => {
    expect(HAND_MAX).toBe(3);
    expect(BOUNTY).toBe(5);
    expect(CLASSIC_POWERS).toEqual(POWERS.slice(0, 6));
    expect([POWER_NAMES.steal, POWER_NAMES.dump, POWER_NAMES.audit, POWER_NAMES.block]).toEqual(["Steal", "Dump", "Audit", "Block"]);
  });
  it("cardFromCode makes the new powers", () => {
    for (const p of ["steal", "dump", "audit", "block"]) expect(cardFromCode(p, 1)).toEqual({ kind: "power", id: 1, power: p });
  });
  it("parseSettings accepts cutthroat and rejects junk", () => {
    expect(overheatGame.parseSettings!({ powers: "cutthroat" })).toEqual({ target: 150, powers: "cutthroat" });
    expect(overheatGame.parseSettings!({ powers: "foo" })).toBeNull();
  });
  it("setting field has three options and follows the setting", () => {
    const f = (raw: unknown) => overheatSettingFields(raw, 3).find((x) => x.key === "powers")!;
    expect(f({ powers: "cutthroat" }).options.map((o) => o.label)).toEqual(["Off", "Classic", "Cutthroat"]);
    expect(f({ powers: "off" }).selected).toBe(0);
    expect(f({ powers: "classic" }).selected).toBe(1);
    expect(f({ powers: "cutthroat" }).selected).toBe(2);
    expect(f({ powers: "cutthroat" }).hint).toBe("26 power cards. Keep them and play them on others.");
  });
  it("power lines are plain", () => {
    const banned = /\b(nuke|screw|stab|backstab|piece of cake|hit the road|dodge|rip|trick|sneak|rob|nick|swipe|cheat)\b/i;
    for (const p of POWERS) {
      const line = POWER_LINES[p];
      expect(line.length).toBeGreaterThan(5);
      expect(line).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(line).not.toMatch(banned);
    }
    expect(cutthroatRules.length).toBeGreaterThan(3);
  });
  it("a flipped block still fizzles for now", () => {
    const s = stateWith({ n: 3, deck: ["block", "R1"], settings: { powers: "cutthroat" } });
    const r = ok(act(s, "p0", { type: "flip" }));
    expect(find(r, "fizzle")).toMatchObject({ playerId: "p0" });
    expect(r.state.discard.some((c) => c.kind === "power" && c.power === "block")).toBe(true);
  });
});
