import { GAME_SECTIONS } from "@games/web/games";
import { describe, expect, it } from "vitest";
import { outErrorMessage, planFacts } from "../src/account.ts";
import { FREE_MAX_PLAYERS, PREMIUM_GAME_IDS } from "@games/product-server/catalog-data";
import { games } from "@games/web/games";
import { galleryHtml, galleryModel, listWords, passGameNames, playerCounts } from "../src/gallery.ts";
import { priceTable } from "../src/landing.ts";

describe("galleryModel", () => {
  const model = galleryModel();
  const all = model.flatMap((s) => s.games.map((g) => ({ ...g, section: s.section })));

  it("uses product names and marks Host Pass games", () => {
    expect(all.find((g) => g.name === "Frontier")).toMatchObject({ id: "dominion", section: "Strategy", pass: true });
    expect(all.find((g) => g.name === "Doodle Dash")).toMatchObject({ id: "scribbl", pass: false });
    expect(all.find((g) => g.id === "long-trail")).toMatchObject({ section: "Strategy", pass: true });
    expect(all.find((g) => g.id === "wilds")).toMatchObject({ section: "Strategy", pass: true });
    expect(all.some((g) => g.name === "Dominion" || g.name === "Scribbl")).toBe(false);
  });

  it("keeps GAME_SECTIONS order and skips empty sections", () => {
    const labels = GAME_SECTIONS.map((s) => s.label as string);
    const order = model.map((s) => labels.indexOf(s.section));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(model.every((s) => s.games.length > 0)).toBe(true);
  });

  it("marks games with computer players", () => {
    expect(all.find((g) => g.id === "cheat")).toMatchObject({ computers: true });
    expect(all.some((g) => g.computers)).toBe(true);
    expect(all.some((g) => !g.computers)).toBe(true);
  });

  it("writes player counts as a range", () => {
    expect(all.every((g) => /^\d+( to \d+)? players$/.test(g.players))).toBe(true);
  });

  it("never shows a free game with more players than a free room takes", () => {
    for (const g of all.filter((g) => !g.pass)) {
      const top = Number(g.players.match(/(\d+) players$/)![1]);
      expect(top, g.id).toBeLessThanOrEqual(FREE_MAX_PLAYERS);
    }
  });

  it("has no game that needs more players than a free room takes", () => {
    expect(Object.values(games).every((e) => e.manifest.minPlayers <= FREE_MAX_PLAYERS)).toBe(true);
  });
});

describe("playerCounts", () => {
  it("caps a free game at the free room, and says what Host Pass allows", () => {
    expect(playerCounts(2, 12, false, 8)).toEqual({ players: "2 to 8 players", passPlayers: "Up to 12 with Host Pass" });
    expect(playerCounts(3, 8, false, 8)).toEqual({ players: "3 to 8 players" });
    expect(playerCounts(2, 6, false, 8)).toEqual({ players: "2 to 6 players" });
    expect(playerCounts(8, 8, false, 8)).toEqual({ players: "8 players" });
  });

  it("gives a Host Pass game its own range: it is played in a pass room", () => {
    expect(playerCounts(2, 16, true, 8)).toEqual({ players: "2 to 16 players" });
  });
});

describe("passGameNames", () => {
  it("names every built Host Pass game, in PREMIUM_GAME_IDS order", () => {
    const built = PREMIUM_GAME_IDS.filter((id) => id in games);
    expect(passGameNames()).toEqual(built.map((id) => games[id]!.manifest.name));
    expect(passGameNames()).toEqual(expect.arrayContaining(["Frontier", "Long Trail", "The Wilds"]));
  });

  it("joins names with commas and a last 'and'", () => {
    expect(listWords(["A", "B", "C"])).toBe("A, B and C");
    expect(listWords(["A", "B"])).toBe("A and B");
    expect(listWords(["A"])).toBe("A");
  });
});

describe("galleryHtml", () => {
  const game = { id: "cheat", name: "Cheat", description: "d", players: "3 to 8 players" };
  const html = (g: object) => galleryHtml([{ id: "cards", section: "Cards", games: [{ ...game, pass: false, computers: false, ...g }] }]);

  it("links a game with computers to its setup", () => {
    expect(html({ computers: true })).toContain(`<a class="game-try" href="/play?game=cheat">Play with computers</a>`);
  });
  it("has no link for a game without computers", () => {
    expect(html({})).not.toContain("game-try");
  });
  it("adds the Host Pass count under a capped free game", () => {
    expect(html({ players: "2 to 8 players", passPlayers: "Up to 12 with Host Pass" })).toContain(
      `<p class="game-players">2 to 8 players<span class="game-more"><span aria-hidden="true"> · </span>Up to 12 with Host Pass</span></p>`,
    );
  });
});

describe("priceTable", () => {
  it("shows rupees for India and dollars elsewhere", () => {
    expect(priceTable("IN").map((p) => p.price)).toEqual(["₹49", "₹149", "₹999"]);
    expect(priceTable("US").map((p) => [p.plan, p.price])).toEqual([["Month", "$4.99"], ["Year", "$39"]]);
    expect(priceTable(null).map((p) => [p.plan, p.price])).toEqual([["Month", "$4.99"], ["Year", "$39"]]);
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
