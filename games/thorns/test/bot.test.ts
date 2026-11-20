import { BOT_MAX_RUN } from "@games/game-core";
import { playBots } from "@games/game-core/testing";
import { describe, expect, it } from "vitest";
import { thornsBot } from "../server/bot.ts";
import { thornsGame } from "../server/game.ts";
import {
  DEFAULT_SETTINGS,
  type Disc,
  type Phase,
  type ThornsAction,
  type ThornsPrivateState,
  type ThornsPublicState,
  type ThornsSettings,
} from "../shared/types.ts";

/** Never the slip, never the thorn or the bid-instead-of-place roll. */
const steady = { randomInt: (max: number) => max - 1, chance: () => 0 };
/** Always rolls 0: the slip (a random legal move). */
const zero = { randomInt: () => 0, chance: () => 0 };
/** The slip does not fire; every other roll is 0 (thorn, bid). */
const lucky = { randomInt: (max: number) => (max === 9 ? 8 : 0), chance: () => 0 };

function view(o: {
  phase?: Phase;
  hand?: Disc[];
  stack?: Disc[];
  heights?: Record<string, number>;
  tableTotal?: number;
  bid?: number;
  flags?: Partial<ThornsPrivateState>;
  flips?: { owner: string; disc: Disc }[];
}) {
  const stack = o.stack ?? [];
  const heights = { me: stack.length, a: 2, b: 2, ...o.heights };
  const pub = {
    phase: o.phase ?? "turns",
    players: Object.entries(heights).map(([id, height]) => ({ id, height, discs: 4 })),
    tableTotal: o.tableTotal ?? Object.values(heights).reduce((s, h) => s + h, 0),
    bid: o.bid ? { amount: o.bid, bidderId: "a" } : null,
    minBid: o.bid ? o.bid + 1 : 1,
    challenge: o.flips ? { challengerId: "me", amount: 5, flips: o.flips } : null,
  } as unknown as ThornsPublicState;
  const priv: ThornsPrivateState = {
    hand: o.hand ?? ["rose", "rose", "rose", "thorn"],
    stack,
    canPlace: false,
    canBid: false,
    canPass: false,
    canFlip: [],
    canReady: false,
    lostDisc: null,
    ...o.flags,
  };
  return { playerId: "me", public: pub, private: priv };
}

describe("thornsBot", () => {
  it("places the first disc once: a thorn on a lucky roll, else a rose", () => {
    const v = view({ phase: "placing-first", flags: { canPlace: true } });
    expect(thornsBot.decide(v, lucky)).toEqual({ type: "place", disc: "thorn" });
    expect(thornsBot.decide(v, steady)).toEqual({ type: "place", disc: "rose" });
    const noThorn = view({ phase: "placing-first", hand: ["rose", "rose"], flags: { canPlace: true } });
    expect(thornsBot.decide(noThorn, lucky)).toEqual({ type: "place", disc: "rose" });
    // Once placed, nothing is awaited and no flag is up.
    expect(thornsBot.decide(view({ phase: "placing-first", stack: ["rose"], hand: ["rose", "rose", "thorn"] }), steady)).toBeNull();
  });

  it("never bids past its own thorn, and passes once the bid reaches it", () => {
    // Mat: thorn, rose (top). Safe is 1.
    const stack: Disc[] = ["thorn", "rose"];
    const base = { phase: "bidding" as const, stack, hand: ["rose", "rose"] as Disc[], flags: { canBid: true, canPass: true } };
    expect(thornsBot.decide(view({ ...base, bid: 1 }), steady)).toEqual({ type: "pass" });
    expect(thornsBot.decide(view({ ...base, bid: 5, heights: { a: 6, b: 6 } }), steady)).toEqual({ type: "pass" });
    // Below the thorn, a raise to 1 is fine.
    expect(thornsBot.decide(view({ ...base, bid: 0, heights: { a: 6, b: 6 } }), steady)).toEqual({ type: "bid", amount: 1 });
  });

  it("with its thorn down, places instead of opening a bid it would lose", () => {
    const v = view({ stack: ["rose", "thorn"], hand: ["rose", "rose"], flags: { canPlace: true, canBid: true } });
    expect(thornsBot.decide(v, lucky)).toEqual({ type: "place", disc: "rose" });
  });

  it("is forced to bid the least with its thorn down and no discs in hand", () => {
    const v = view({ stack: ["rose", "thorn"], hand: [], flags: { canBid: true } });
    expect(thornsBot.decide(v, steady)).toEqual({ type: "bid", amount: 1 });
  });

  it("raises by one while the bid is within fair value, else passes", () => {
    const base = { phase: "bidding" as const, stack: ["rose", "rose"] as Disc[], hand: ["rose", "thorn"] as Disc[], flags: { canBid: true, canPass: true } };
    // Fair: 2 own + round(6/2) = 5.
    expect(thornsBot.decide(view({ ...base, bid: 3 }), steady)).toEqual({ type: "bid", amount: 4 });
    expect(thornsBot.decide(view({ ...base, bid: 5 }), steady)).toEqual({ type: "pass" });
  });

  it("does not bid the whole table unless it is fair", () => {
    const base = { phase: "bidding" as const, stack: ["rose"] as Disc[], hand: ["rose", "thorn"] as Disc[], heights: { a: 3, b: 3 }, flags: { canBid: true, canPass: true } };
    // Total 7, minBid 7, fair 1 + 3 = 4.
    expect(thornsBot.decide(view({ ...base, bid: 6 }), steady)).toEqual({ type: "pass" });
  });

  it("flips only allowed mats, the one with the most discs left", () => {
    const v = view({
      phase: "flipping",
      stack: ["rose"],
      heights: { a: 3, b: 2 },
      flags: { canFlip: ["a", "b"] },
      flips: [{ owner: "me", disc: "rose" }, { owner: "a", disc: "rose" }, { owner: "a", disc: "rose" }],
    });
    // a has 1 left, b has 2.
    expect(thornsBot.decide(v, steady)).toEqual({ type: "flip", owner: "b" });
    const only = view({ phase: "flipping", flags: { canFlip: ["b"] } });
    for (const ctx of [steady, zero]) expect(thornsBot.decide(only, ctx)).toEqual({ type: "flip", owner: "b" });
  });

  it("taps ready only when allowed, and does nothing otherwise", () => {
    expect(thornsBot.decide(view({ phase: "result", flags: { canReady: true } }), steady)).toEqual({ type: "ready" });
    expect(thornsBot.decide(view({ phase: "result" }), steady)).toBeNull();
    expect(thornsBot.decide(view({ phase: "bidding", bid: 2 }), steady)).toBeNull();
  });

  it("guard: does not tap ready once it is out of discs, even if canReady were up", () => {
    const v = view({ phase: "result", flags: { canReady: true } });
    const out = { ...v, public: { ...v.public, players: v.public.players.map((p) => (p.id === "me" ? { ...p, out: true } : p)) } };
    expect(thornsBot.decide(out, steady)).toBeNull();
  });

  it("the slip picks a kind of move first, then a small bid", () => {
    /** Rolls in order: 0 is the slip, then the kind, then the value. */
    const rolls = (...seq: number[]) => ({ randomInt: (max: number) => Math.min(max - 1, seq.shift() ?? 0), chance: () => 0 });
    const v = view({ phase: "bidding", stack: ["rose", "rose"], hand: ["rose", "thorn"], tableTotal: 10, flags: { canBid: true, canPass: true } });
    // Kinds here: bid, pass. A bid is min or min + 1, never far above.
    expect(thornsBot.decide(v, rolls(0, 0, 0))).toEqual({ type: "bid", amount: 1 });
    expect(thornsBot.decide(v, rolls(0, 0, 1))).toEqual({ type: "bid", amount: 2 });
    expect(thornsBot.decide(v, rolls(0, 1))).toEqual({ type: "pass" });
    // Min + 1 is kept to the discs on the table.
    const top = view({ phase: "bidding", stack: ["rose", "rose"], tableTotal: 6, bid: 5, flags: { canBid: true, canPass: true } });
    expect(thornsBot.decide(top, rolls(0, 0, 1))).toEqual({ type: "bid", amount: 6 });
    // Kinds when it may place: place, bid. A placed disc comes from the hand.
    const turn = view({ stack: ["rose", "rose"], hand: ["rose", "thorn"], flags: { canPlace: true, canBid: true } });
    expect(thornsBot.decide(turn, rolls(0, 0, 1))).toEqual({ type: "place", disc: "thorn" });
    expect(thornsBot.decide(turn, rolls(0, 1, 0))).toEqual({ type: "bid", amount: 1 });
  });

  it("only returns legal moves, including the slip", () => {
    for (const bid of [0, 1, 4]) {
      const v = view({ phase: "bidding", stack: ["rose", "thorn"], hand: ["rose"], bid, flags: { canBid: true, canPass: true } });
      for (const ctx of [steady, zero]) {
        const m = thornsBot.decide(v, ctx) as ThornsAction;
        expect(m).not.toBeNull();
        if (m.type === "bid") {
          expect(m.amount).toBeGreaterThanOrEqual(v.public.minBid);
          expect(m.amount).toBeLessThanOrEqual(v.public.tableTotal);
        }
        expect(m.type === "place" || m.type === "bid" || m.type === "pass").toBe(true);
        if (m.type === "place") expect(v.private.canPlace).toBe(true);
      }
    }
  });
});

describe("thornsBot all-bot games", () => {
  const extras: [string, Partial<ThornsSettings>][] = [["3 points to win", { pointsToWin: 3 }]];
  const check = (players: number, name: string, s: Partial<ThornsSettings>, seeds: number) => {
    for (let seed = 1; seed <= seeds; seed++) {
      const run = playBots(thornsGame, { players, seed, settings: { ...DEFAULT_SETTINGS, ...s } });
      const at = `${name} seed ${seed}, ${players} players`;
      expect(run.rejected, at).toEqual([]);
      expect(run.stuck, at).toEqual([]);
      expect(run.outcome, at).not.toBeNull();
      expect(run.longestRun, at).toBeLessThan(BOT_MAX_RUN);
    }
  };
  const m = thornsGame.manifest;
  // The table size is capped at 7 (Ruling P2-E); Thorns tops out at 6 anyway.
  const sizes = [...new Set([m.minPlayers, m.bestMinPlayers ?? m.minPlayers, Math.min(m.maxPlayers, 7)])];
  it.each(sizes)("games finish with %i players", (players) => {
    check(players, "defaults", {}, 200);
    for (const [name, s] of extras) check(players, name, s, 50);
  }, 60_000);

  it("stays fast", () => {
    let moves = 0;
    const start = performance.now();
    for (let seed = 1; seed <= 50; seed++) moves += playBots(thornsGame, { players: 4, seed }).moves;
    expect((performance.now() - start) / moves).toBeLessThan(2);
  });
});
