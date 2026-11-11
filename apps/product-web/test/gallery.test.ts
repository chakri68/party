import { GAME_SECTIONS } from "@games/web/games";
import { describe, expect, it } from "vitest";
import { outErrorMessage, planLine } from "../src/account.ts";
import { galleryModel, priceTable } from "../src/landing.ts";

describe("galleryModel", () => {
  const model = galleryModel();
  const all = model.flatMap((s) => s.games.map((g) => ({ ...g, section: s.section })));

  it("uses product names and marks Host Pass games", () => {
    expect(all.find((g) => g.name === "Frontier")).toMatchObject({ id: "dominion", section: "Strategy", pass: true });
    expect(all.find((g) => g.name === "Doodle Dash")).toMatchObject({ id: "scribbl", pass: false });
    expect(all.some((g) => g.name === "Dominion" || g.name === "Scribbl")).toBe(false);
  });

  it("keeps GAME_SECTIONS order and skips empty sections", () => {
    const labels = GAME_SECTIONS.map((s) => s.label as string);
    const order = model.map((s) => labels.indexOf(s.section));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(model.every((s) => s.games.length > 0)).toBe(true);
  });

  it("writes player counts as a range", () => {
    expect(all.every((g) => /^\d+(–\d+)? players$/.test(g.players))).toBe(true);
  });
});

describe("priceTable", () => {
  it("shows rupees for India and dollars elsewhere", () => {
    expect(priceTable("IN").map((p) => p.price)).toEqual(["₹49", "₹149", "₹999"]);
    expect(priceTable("US").map((p) => p.price)).toEqual(["$1.99", "$4.99", "$39"]);
    expect(priceTable(null).map((p) => p.price)).toEqual(["$1.99", "$4.99", "$39"]);
  });
});

describe("planLine", () => {
  it("names the plan and its end date", () => {
    expect(planLine({ email: "a@b.c", tier: "pass", plan: { source: "comp", endsAt: Date.UTC(2026, 11, 12, 10) } })).toBe("Host Pass until 12 Dec 2026");
    expect(planLine({ email: "a@b.c", tier: "pass", plan: { source: "grant", endsAt: null } })).toBe("Host Pass, no end date");
    expect(planLine({ email: "a@b.c", tier: "free", plan: null })).toBe("Free");
  });
});

describe("outErrorMessage", () => {
  it("says what went wrong for a bad link or a failed Google sign-in", () => {
    expect(outErrorMessage("link")).toBe("That link did not work. Ask for a new one.");
    expect(outErrorMessage("google")).toBe("Google sign-in did not work. Please try again.");
  });
  it("says nothing for no error or an unknown one", () => {
    expect(outErrorMessage(null)).toBe("");
    expect(outErrorMessage("toString")).toBe("");
  });
});
