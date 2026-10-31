import { seededRandomInt, type GameContext, type GameTransition } from "@games/game-core";
import { findLeaks } from "@games/game-core/testing";
import { describe, expect, it } from "vitest";
import { ohHellGame as oh } from "../server/game.ts";
import { makeDeck, parseCardId } from "../shared/rules.ts";
import {
  DEFAULT_SETTINGS,
  type OhHellAction,
  type OhHellEvent,
  type OhHellServerState,
  type OhHellSettings,
  type Phase,
  type TrickPlay,
} from "../shared/types.ts";

type State = OhHellServerState;

const ctx = (seed = 1, now = 0): GameContext => ({ now, randomInt: seededRandomInt(seed) });
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
const cards = (ids: string[]) => ids.map((id) => parseCardId(id)!);
const ids = (cs: { id: string }[]) => cs.map((c) => c.id);
const eventTypes = (t: { events: { event: { type: string } }[] }) => t.events.map((e) => e.event.type);

/** A mid-round state, bypassing the deal. Seat 0 deals unless told otherwise. */
function stateWith(
  hands: string[][],
  opts: {
    phase?: Phase;
    trump?: string;
    dealer?: number;
    turn?: number;
    leader?: number;
    bids?: (number | null)[];
    tricks?: number[];
    scores?: number[];
    trick?: [number, string][];
    schedule?: number[];
    roundIndex?: number;
    tricksPlayed?: number;
    removed?: number[];
    settings?: Partial<OhHellSettings>;
  } = {},
): State {
  const dealer = opts.dealer ?? 0;
  const n = hands.length;
  const size = Math.max(...hands.map((h) => h.length)) + (opts.trick?.length ? 1 : 0) + (opts.tricksPlayed ?? 0);
  const leader = opts.leader ?? (dealer + 1) % n;
  const trick: TrickPlay[] = (opts.trick ?? []).map(([seat, id]) => ({ playerId: `p${seat}`, card: parseCardId(id)! }));
  return {
    phase: opts.phase ?? "playing",
    settings: { ...DEFAULT_SETTINGS, ...opts.settings },
    players: hands.map((h, i) => ({
      id: `p${i}`,
      hand: cards(h),
      bid: opts.bids ? (opts.bids[i] ?? null) : opts.phase === "bidding" ? null : 0,
      tricks: opts.tricks?.[i] ?? 0,
      score: opts.scores?.[i] ?? 0,
      removed: opts.removed?.includes(i) ?? false,
    })),
    schedule: opts.schedule ?? [size],
    roundIndex: opts.roundIndex ?? 0,
    dealerIndex: dealer,
    trump: parseCardId(opts.trump ?? "clubs-3")!,
    turnIndex: opts.turn ?? leader,
    leaderIndex: leader,
    trick,
    held: null,
    lastTrick: null,
    tricksPlayed: opts.tricksPlayed ?? 0,
    results: null,
    ready: [],
    summaryEndsAt: 0,
    winnerIds: [],
    endReason: null,
  };
}

function act(state: State, playerId: string, action: OhHellAction, c = ctx()) {
  return oh.handleAction(state, playerId, action, c);
}

function ok(result: ReturnType<typeof act>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.transition;
}

function err(result: ReturnType<typeof act>) {
  if (result.ok) throw new Error("expected a rejection");
  return result.error;
}

/** No seat sees a card in another seat's hand: in public state, others' private state, or events. */
function expectNoLeaks(t: GameTransition<State, OhHellEvent>) {
  const ps = t.state.players.map((p) => p.id);
  for (const p of t.state.players) {
    for (const c of p.hand) {
      expect(findLeaks({ def: oh, state: t.state, events: t.events, players: ps, secret: `"${c.id}"`, allowed: [p.id] })).toEqual([]);
    }
  }
}

describe("createGame", () => {
  it("deals the first round from the dealer's left and turns up trump", () => {
    const deck = makeDeck().map((c) => c.id);
    const t = oh.createGame(players(4), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 2 }, ctx(), { deck });
    expect(t.state.schedule).toEqual([1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1]);
    // One card each: p3, p0, p1, p2, then trump.
    expect(ids(t.state.players[3]!.hand)).toEqual([deck[0]]);
    expect(ids(t.state.players[2]!.hand)).toEqual([deck[3]]);
    expect(t.state.trump.id).toBe(deck[4]);
    expect(t.events[0]!.event).toMatchObject({ type: "dealt", round: 1, handSize: 1, dealerId: "p2", trump: { id: deck[4] } });
    expect(oh.getPublicState(t.state)).toMatchObject({ phase: "bidding", currentPlayerId: "p3", round: 1, handSize: 1, bidsMade: 0 });
    expect(oh.getAwaitedPlayerIds(t.state)).toEqual(["p3"]);
    expectNoLeaks(t);
  });

  it("caps the biggest hand by player count", () => {
    const max = { ...DEFAULT_SETTINGS, biggest: "max" as const, schedule: "down" as const };
    expect(oh.createGame(players(3), max, { roundNumber: 1, dealerSeat: 0 }, ctx()).state.players[0]!.hand).toHaveLength(17);
    expect(oh.createGame(players(7), max, { roundNumber: 1, dealerSeat: 0 }, ctx()).state.players[0]!.hand).toHaveLength(7);
    expect(() => oh.createGame(players(2), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx())).toThrow(/3–7/);
    expect(() => oh.createGame(players(3), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx(), { deck: ["hearts-2"] })).toThrow(/52/);
  });

  it("parses settings and actions", () => {
    expect(oh.parseSettings({ biggest: 10, missing: "difference" })).toEqual({ ...DEFAULT_SETTINGS, biggest: 10, missing: "difference" });
    expect(oh.parseSettings({ biggest: 8 })).toBeNull();
    expect(oh.parseSettings({ dealerRule: "yes" })).toBeNull();
    expect(oh.parseAction({ type: "bid", tricks: 2 })).toEqual({ type: "bid", tricks: 2 });
    expect(oh.parseAction({ type: "bid", tricks: -1 })).toBeNull();
    expect(oh.parseAction({ type: "bid", tricks: 1.5 })).toBeNull();
    expect(oh.parseAction({ type: "play", card: "hearts-A" })).toEqual({ type: "play", card: "hearts-A" });
    expect(oh.parseAction({ type: "ready" })).toEqual({ type: "ready" });
  });
});

describe("bidding", () => {
  const bidding = (size: number, settings: Partial<OhHellSettings> = {}) =>
    stateWith(
      [0, 1, 2, 3].map((s) => makeDeck().slice(s * size, s * size + size).map((c) => c.id)),
      { phase: "bidding", settings },
    );

  it("goes round from the dealer's left, public as it's made, dealer last", () => {
    let s = bidding(3);
    expect(err(act(s, "p2", { type: "bid", tricks: 1 })).code).toBe("not-your-turn");
    expect(err(act(s, "p1", { type: "bid", tricks: 4 })).code).toBe("bad-bid");
    s = ok(act(s, "p1", { type: "bid", tricks: 1 })).state;
    expect(oh.getPublicState(s)).toMatchObject({ bidsMade: 1, bidsTotal: 1, currentPlayerId: "p2", forbiddenBid: null });
    s = ok(act(s, "p2", { type: "bid", tricks: 0 })).state;
    s = ok(act(s, "p3", { type: "bid", tricks: 1 })).state;
    expect(oh.getPublicState(s)).toMatchObject({ bidsMade: 3, bidsTotal: 2, currentPlayerId: "p0", forbiddenBid: 1 });
    expect(oh.getPrivateState(s, "p0").canBid).toBe(true);
    expect(err(act(s, "p0", { type: "bid", tricks: 1 }))).toEqual({
      code: "forbidden-bid",
      message: "You can't bid 1. The total bid would be 3 tricks",
    });
    const t = ok(act(s, "p0", { type: "bid", tricks: 2 }));
    expect(t.events.map((e) => e.event)).toEqual([{ type: "bid", playerId: "p0", tricks: 2 }]);
    // Left of the dealer leads.
    expect(oh.getPublicState(t.state)).toMatchObject({ phase: "playing", currentPlayerId: "p1" });
    expect(oh.getPrivateState(t.state, "p1").legal).toHaveLength(3);
  });

  it("forbids the dealer's bid in the one-card round, both ways", () => {
    let s = bidding(1);
    for (const id of ["p1", "p2", "p3"]) s = ok(act(s, id, { type: "bid", tricks: 0 })).state;
    expect(err(act(s, "p0", { type: "bid", tricks: 1 })).message).toBe("You can't bid 1. The total bid would be 1 trick");
    expect(ok(act(s, "p0", { type: "bid", tricks: 0 })).state.phase).toBe("playing");

    s = bidding(1);
    s = ok(act(s, "p1", { type: "bid", tricks: 1 })).state;
    for (const id of ["p2", "p3"]) s = ok(act(s, id, { type: "bid", tricks: 0 })).state;
    expect(err(act(s, "p0", { type: "bid", tricks: 0 })).code).toBe("forbidden-bid");
  });

  it("with the rule off, the dealer can make it add up", () => {
    let s = bidding(2, { dealerRule: false });
    for (const id of ["p1", "p2", "p3"]) s = ok(act(s, id, { type: "bid", tricks: 0 })).state;
    expect(oh.getPublicState(s).forbiddenBid).toBeNull();
    expect(ok(act(s, "p0", { type: "bid", tricks: 2 })).state.phase).toBe("playing");
  });
});

describe("playing", () => {
  it("rejects off-suit plays when you can follow, and allows anything when you can't", () => {
    const s = stateWith([["hearts-K", "spades-2"], ["hearts-3", "clubs-A"], ["diamonds-4", "spades-9"]], {
      turn: 0,
      trick: [[1, "hearts-9"], [2, "hearts-4"]],
      leader: 1,
    });
    expect(oh.getPrivateState(s, "p0").legal).toEqual(["hearts-K"]);
    expect(err(act(s, "p0", { type: "play", card: "spades-2" }))).toEqual({
      code: "must-follow",
      message: "You must follow suit. Play a Heart.",
    });
    expect(err(act(s, "p0", { type: "play", card: "clubs-A" })).code).toBe("card-not-owned");
    expect(err(act(s, "p1", { type: "play", card: "clubs-A" })).code).toBe("not-your-turn");
    expect(oh.getPrivateState(s, "p1").legal).toEqual([]);

    const void_ = stateWith([["spades-2", "clubs-5"], ["hearts-3", "clubs-A"], ["diamonds-4", "spades-9"]], {
      turn: 0,
      leader: 1,
      trick: [[1, "hearts-9"], [2, "hearts-4"]],
    });
    expect(oh.getPrivateState(void_, "p0").legal).toEqual(["clubs-5", "spades-2"]);
    ok(act(void_, "p0", { type: "play", card: "spades-2" }));
  });

  it("trump beats the led suit; the trick's held, then the winner leads next", () => {
    // Clubs are trump. p1 leads a heart, p2 follows high, p0 trumps it with a two.
    const s = stateWith([["clubs-2", "spades-2"], ["hearts-9", "diamonds-5"], ["hearts-A", "diamonds-6"]], {
      leader: 1,
      bids: [1, 0, 1],
    });
    let t = ok(act(s, "p1", { type: "play", card: "hearts-9" }));
    t = ok(act(t.state, "p2", { type: "play", card: "hearts-A" }));
    t = ok(act(t.state, "p0", { type: "play", card: "clubs-2" }));
    expect(eventTypes(t)).toEqual(["played", "trick-won"]);
    expect(t.events[1]!.event).toMatchObject({ type: "trick-won", winnerId: "p0" });
    expect(t.timers).toEqual([{ kind: "set", timerId: "trick", delayMs: 1500 }]);
    expect(oh.getPublicState(t.state)).toMatchObject({ trickWinnerId: "p0", currentPlayerId: null, trick: { length: 3 } });
    expect(oh.getPublicState(t.state).players[0]!.tricks).toBe(1);
    expect(oh.getAwaitedPlayerIds(t.state)).toEqual([]);
    expect(err(act(t.state, "p0", { type: "play", card: "spades-2" })).code).toBe("trick-held");

    const c = oh.onTimer!(t.state, "trick", ctx());
    expect(eventTypes(c)).toEqual(["trick-collected"]);
    expect(oh.getPublicState(c.state)).toMatchObject({ currentPlayerId: "p0", trick: [], trickNumber: 2, lastTrick: { winnerId: "p0" } });
    // Stale or unknown timers do nothing.
    expect(oh.onTimer!(c.state, "trick", ctx()).state).toBe(c.state);
  });

  it("a trump lead: highest trump takes it, off-suit high cards don't", () => {
    const s = stateWith([["clubs-4", "hearts-2"], ["spades-A", "hearts-3"], ["clubs-J", "hearts-4"]], { leader: 0, turn: 0, trump: "clubs-3" });
    let t = ok(act(s, "p0", { type: "play", card: "clubs-4" }));
    t = ok(act(t.state, "p1", { type: "play", card: "spades-A" }));
    t = ok(act(t.state, "p2", { type: "play", card: "clubs-J" }));
    expect(t.state.held?.winnerId).toBe("p2");
  });
});

describe("scoring and rounds", () => {
  // Last trick of a 1-card round: p1 leads, p2 wins it. Bids: p0 0, p1 1, p2 1.
  const lastTrick = (missing: OhHellSettings["missing"], schedule = [1, 2]) => {
    const s = stateWith([["hearts-2"], ["hearts-5"], ["hearts-K"]], {
      leader: 1,
      bids: [0, 1, 1],
      scores: [5, 5, 5],
      schedule,
      settings: { missing },
    });
    let t = ok(act(s, "p1", { type: "play", card: "hearts-5" }));
    t = ok(act(t.state, "p2", { type: "play", card: "hearts-K" }));
    t = ok(act(t.state, "p0", { type: "play", card: "hearts-2" }));
    return oh.onTimer!(t.state, "trick", ctx(1, 10_000));
  };

  it("exact bids score 10 + bid, a miss scores 0", () => {
    const t = lastTrick("zero");
    expect(eventTypes(t)).toEqual(["trick-collected", "round-scored"]);
    expect(t.state.results).toEqual([
      { playerId: "p0", bid: 0, tricks: 0, points: 10, total: 15 },
      { playerId: "p1", bid: 1, tricks: 0, points: 0, total: 5 },
      { playerId: "p2", bid: 1, tricks: 1, points: 11, total: 16 },
    ]);
    expect(t.timers).toEqual([{ kind: "set", timerId: "summary", delayMs: 5000 }]);
    expect(oh.getPublicState(t.state)).toMatchObject({ phase: "round-summary", summaryEndsAt: 15_000 });
  });

  it("or costs the difference", () => {
    expect(lastTrick("difference").state.results!.map((r) => r.points)).toEqual([10, -1, 11]);
  });

  it("everyone tapping ready ends the summary early; the dealer moves left", () => {
    const t = lastTrick("zero");
    let s = ok(act(t.state, "p0", { type: "ready" })).state;
    expect(err(act(s, "p0", { type: "ready" })).code).toBe("already-ready");
    expect(oh.getPublicState(s).players[0]!.ready).toBe(true);
    s = ok(act(s, "p1", { type: "ready" })).state;
    const last = ok(act(s, "p2", { type: "ready" }));
    expect(eventTypes(last)).toEqual(["ready", "dealt"]);
    expect(last.timers).toContainEqual({ kind: "cancel", timerId: "summary" });
    expect(oh.getPublicState(last.state)).toMatchObject({ phase: "bidding", round: 2, handSize: 2, dealerId: "p1", currentPlayerId: "p2" });
    expect(last.state.players.every((p) => p.hand.length === 2 && p.bid === null && p.tricks === 0)).toBe(true);
  });

  it("the summary timer moves on; after the last round, the highest total wins", () => {
    const next = oh.onTimer!(lastTrick("zero").state, "summary", ctx());
    expect(oh.getPublicState(next.state).round).toBe(2);

    const end = oh.onTimer!(lastTrick("zero", [1]).state, "summary", ctx());
    expect(eventTypes(end)).toEqual(["game-over"]);
    expect(end.state.phase).toBe("over");
    const r = oh.getResult(end.state)!;
    expect(r.winnerIds).toEqual(["p2"]);
    expect(r.standings.map((s) => [s.playerId, s.label])).toEqual([
      ["p2", "16 pts"],
      ["p0", "15 pts"],
      ["p1", "5 pts"],
    ]);
    expect(err(act(end.state, "p0", { type: "ready" })).code).toBe("game-finished");
  });

  it("ties share the win", () => {
    const s = { ...stateWith([["hearts-2"], ["hearts-3"], ["hearts-4"]], { scores: [20, 20, 3] }), phase: "round-summary" as const };
    const r = oh.getResult(oh.onTimer!(s, "summary", ctx()).state)!;
    expect(r.winnerIds).toEqual(["p0", "p1"]);
    expect(r.headline).toBe("A tie at 20 pts");
  });
});

describe("skip and removal", () => {
  it("a skipped bidder bids 0, or 1 when 0 is the dealer's forbidden bid", () => {
    const s = stateWith([["hearts-2"], ["hearts-3"], ["hearts-4"]], { phase: "bidding" });
    const t = oh.skipTurn!(s, "p1", ctx());
    expect(eventTypes(t)).toEqual(["turn-skipped", "bid"]);
    expect(t.state.players[1]!.bid).toBe(0);
    expect(oh.skipTurn!(s, "p2", ctx()).events).toEqual([]);

    const dealer = stateWith([["hearts-2"], ["hearts-3"], ["hearts-4"]], { phase: "bidding", bids: [null, 1, 0], turn: 0 });
    expect(oh.skipTurn!(dealer, "p0", ctx()).state.players[0]!.bid).toBe(1);
  });

  it("a skipped player plays their lowest legal card, keeping trump back", () => {
    // Void in hearts: can play anything; lowest non-trump is the spade 5, not the club 2.
    const s = stateWith([["clubs-2", "spades-5", "diamonds-9"], ["hearts-3", "hearts-6", "hearts-7"], ["hearts-4", "hearts-8", "hearts-9"]], {
      turn: 0,
      leader: 1,
      trick: [[1, "hearts-J"], [2, "hearts-Q"]],
    });
    expect(oh.skipTurn!(s, "p0", ctx()).state.trick.at(-1)!.card.id).toBe("spades-5");
    // Following suit: the lowest of it.
    const f = stateWith([["hearts-9", "hearts-5", "spades-2"], ["hearts-3"], ["hearts-4"]], { turn: 0, leader: 1, trick: [[1, "hearts-J"], [2, "hearts-Q"]] });
    expect(oh.skipTurn!(f, "p0", ctx()).state.trick.at(-1)!.card.id).toBe("hearts-5");
    // Only trump: lowest trump.
    const tr = stateWith([["clubs-9", "clubs-5"], ["clubs-3"], ["clubs-4"]], { turn: 0, leader: 0 });
    expect(oh.skipTurn!(tr, "p0", ctx()).state.trick[0]!.card.id).toBe("clubs-5");
  });

  it("removal mid-round redeals at the same hand size, keeps scores, and follows the new schedule", () => {
    // 4 players, biggest "max" = 12; round 3 (3 cards), mid-trick.
    const schedule = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
    const s = stateWith(
      [["hearts-2", "hearts-3"], ["spades-2", "spades-3"], ["clubs-2", "clubs-3"], ["diamonds-2", "diamonds-3"]],
      { schedule, roundIndex: 2, dealer: 1, leader: 2, turn: 3, trick: [[2, "clubs-4"]], tricksPlayed: 0, scores: [12, 0, 11, 3], bids: [1, 0, 1, 1], settings: { biggest: "max" } },
    );
    const t = oh.onPlayerRemoved!(s, "p1", ctx(9));
    expect(eventTypes(t)).toEqual(["player-removed", "dealt"]);
    expect(t.events[1]!.event).toMatchObject({ type: "dealt", round: 3, handSize: 3, redeal: true, dealerId: "p2" });
    expect(t.timers).toContainEqual({ kind: "cancel", timerId: "trick" });
    // 3 left: biggest 17, still on the way up.
    expect(t.state.schedule.slice(0, 3)).toEqual([1, 2, 3]);
    expect(Math.max(...t.state.schedule)).toBe(17);
    expect(t.state.schedule).toHaveLength(33);
    expect(t.state.players.map((p) => p.score)).toEqual([12, 0, 11, 3]);
    expect(t.state.players.map((p) => p.hand.length)).toEqual([3, 0, 3, 3]);
    expect(t.state.players.every((p) => p.bid === null && p.tricks === 0)).toBe(true);
    expect(oh.getPublicState(t.state)).toMatchObject({ phase: "bidding", currentPlayerId: "p3", trick: [], dealerId: "p2" });
    const held = new Set(t.state.players.flatMap((p) => ids(p.hand)));
    expect(held.size).toBe(9);
    expect(held.has(t.state.trump.id)).toBe(false);
    expectNoLeaks(t);
  });

  it("removal during the summary only reschedules what's to come", () => {
    const s = { ...stateWith([["hearts-2"], ["hearts-3"], ["hearts-4"], ["hearts-5"]], { schedule: [1, 2, 3], scores: [1, 2, 3, 4] }), phase: "round-summary" as const, ready: ["p0", "p2", "p3"] };
    const t = oh.onPlayerRemoved!(s, "p1", ctx());
    // Everyone left was ready: on to round 2.
    expect(eventTypes(t)).toEqual(["player-removed", "dealt"]);
    expect(t.state.players.map((p) => p.hand.length)).toEqual([2, 0, 2, 2]);
  });

  it("fewer than three left ends it, ranked by score", () => {
    const s = stateWith([["hearts-2"], ["hearts-3"], ["hearts-4"]], { scores: [4, 30, 9] });
    const t = oh.onPlayerRemoved!(s, "p1", ctx());
    expect(eventTypes(t)).toEqual(["player-removed", "game-over"]);
    expect(t.state).toMatchObject({ phase: "over", endReason: "abandoned", winnerIds: ["p2"] });
    expect(oh.getResult(t.state)!.standings.map((x) => [x.playerId, x.label])).toEqual([
      ["p2", "9 pts"],
      ["p0", "4 pts"],
      ["p1", "left · 30 pts"],
    ]);
  });
});

describe("whole games", () => {
  it("deals right, follows the rules, never leaks a hand, and ends", () => {
    for (let seed = 1; seed <= 24; seed++) {
      const n = 3 + (seed % 5);
      const rng = seededRandomInt(seed * 13);
      const settings: OhHellSettings = {
        schedule: (["up-down", "down", "up"] as const)[seed % 3]!,
        biggest: ([7, 10, "max"] as const)[seed % 3]!,
        dealerRule: seed % 2 === 0,
        missing: seed % 4 < 2 ? "zero" : "difference",
      };
      let t = oh.createGame(players(n), settings, { roundNumber: 1, dealerSeat: seed }, ctx(seed));
      let removals = seed % 4 === 0 ? 1 : 0;
      for (let steps = 0; t.state.phase !== "over"; steps++) {
        expect(steps).toBeLessThan(5000);
        const s = t.state;
        const c = ctx(seed * 1000 + steps, steps * 100);
        const pub = oh.getPublicState(s);
        const seatedCount = s.players.filter((p) => !p.removed).length;
        if (removals && rng(60) === 0) {
          removals--;
          const left = s.players.filter((p) => !p.removed);
          t = oh.onPlayerRemoved!(s, left[rng(left.length)]!.id, c);
        } else if (s.phase === "bidding") {
          const id = pub.currentPlayerId!;
          if (rng(5) === 0) t = oh.skipTurn!(s, id, c);
          else {
            const options = Array.from({ length: pub.handSize + 1 }, (_, i) => i).filter((b) => b !== pub.forbiddenBid);
            t = ok(act(s, id, { type: "bid", tricks: options[rng(options.length)]! }, c));
          }
        } else if (s.phase === "playing" && s.held) {
          t = oh.onTimer!(s, "trick", c);
        } else if (s.phase === "playing") {
          const id = pub.currentPlayerId!;
          const legal = oh.getPrivateState(s, id).legal;
          t = ok(act(s, id, { type: "play", card: legal[rng(legal.length)]! }, c));
        } else if (rng(2)) {
          t = oh.onTimer!(s, "summary", c);
        } else {
          for (const p of s.players.filter((p) => !p.removed)) t = ok(act(t.state, p.id, { type: "ready" }, c));
        }
        const st = t.state;
        if (st.phase === "bidding" && st.players.every((p) => p.bid === null)) {
          // Fresh deal: right size, all distinct, trump not in anyone's hand.
          const size = st.schedule[st.roundIndex]!;
          const held = st.players.filter((p) => !p.removed).flatMap((p) => ids(p.hand));
          expect(held.length).toBe(size * st.players.filter((p) => !p.removed).length);
          expect(new Set([...held, st.trump.id]).size).toBe(held.length + 1);
          expect(size * seatedCount).toBeLessThanOrEqual(51);
        }
        if (st.phase === "round-summary" && s.phase === "playing") {
          const size = st.schedule[st.roundIndex]!;
          expect(st.results!.reduce((sum, r) => sum + r.tricks, 0)).toBe(size);
        }
        if (steps % 7 === 0) expectNoLeaks(t);
      }
      const r = oh.getResult(t.state)!;
      expect(r.standings).toHaveLength(n);
      expect(r.winnerIds.length).toBeGreaterThan(0);
    }
  });
});
