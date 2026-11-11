import { GAME_SECTIONS } from "@games/web/games";
import { describe, expect, it } from "vitest";
import { outErrorMessage, planFacts } from "../src/account.ts";
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

describe("planFacts", () => {
  const DAY = 86_400_000;
  const end = Date.UTC(2026, 11, 12, 10);
  const pass = (plan: { startsAt?: number; endsAt: number | null }) => ({ email: "a@b.c", tier: "pass" as const, plan: { source: "comp", ...plan } });

  it("counts days left, names the end date, and how much is left", () => {
    expect(planFacts(pass({ startsAt: end - 30 * DAY, endsAt: end }), end - 10 * DAY)).toEqual({
      tier: "pass",
      headline: "10 days left",
      ends: "Ends 12 Dec 2026",
      left: 10 / 30,
    });
  });

  it("rounds a part day up, and never says 0 days while the pass is on", () => {
    expect(planFacts(pass({ endsAt: end }), end - 2 * 3_600_000)).toMatchObject({ headline: "1 day left", left: null });
    expect(planFacts(pass({ endsAt: end }), end - DAY - 1)).toMatchObject({ headline: "2 days left" });
  });

  it("has no date or bar for a pass with no end", () => {
    expect(planFacts(pass({ endsAt: null }), end)).toEqual({ tier: "pass", headline: "No end date", ends: null, left: null });
  });

  it("free is free", () => {
    expect(planFacts({ email: "a@b.c", tier: "free", plan: null }, end)).toEqual({ tier: "free" });
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
