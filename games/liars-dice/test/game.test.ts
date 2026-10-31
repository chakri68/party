import { seededRandomInt, type GameContext, type GameEventEnvelope } from "@games/game-core";
import { findLeaks } from "@games/game-core/testing";
import { describe, expect, it } from "vitest";
import { liarsDiceGame as ld } from "../server/game.ts";
import {
  DEFAULT_SETTINGS,
  REVEAL_MS,
  type Bid,
  type Face,
  type LiarsDiceAction,
  type LiarsDiceEvent,
  type LiarsDiceServerState,
  type LiarsDiceSettings,
} from "../shared/types.ts";

const ctx = (seed = 1, now = 0): GameContext => ({ now, randomInt: seededRandomInt(seed) });
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
const ids = (n: number) => players(n).map((p) => p.id);

/** A mid-round state, bypassing the roll. Dice per seat; an empty list is a player who's out. */
function stateWith(
  dice: Face[][],
  opts: { turn?: number; bid?: Omit<Bid, "playerId"> & { by?: number }; settings?: Partial<LiarsDiceSettings>; rigged?: Face[] } = {},
): LiarsDiceServerState {
  const turn = opts.turn ?? 0;
  const n = dice.length;
  let bidder = opts.bid?.by ?? (turn - 1 + n) % n;
  while (opts.bid && opts.bid.by === undefined && !dice[bidder]!.length) bidder = (bidder - 1 + n) % n;
  const bid: Bid | null = opts.bid ? { playerId: `p${bidder}`, quantity: opts.bid.quantity, face: opts.bid.face } : null;
  return {
    phase: "bidding",
    settings: { ...DEFAULT_SETTINGS, ...opts.settings },
    players: dice.map((d, i) => ({ id: `p${i}`, count: d.length, dice: d, removed: false, away: false })),
    round: 1,
    turnIndex: turn,
    bid,
    history: bid ? [bid] : [],
    reveal: null,
    revealEndsAt: 0,
    ready: [],
    outOrder: [],
    winnerId: null,
    rigged: opts.rigged ?? [],
  };
}

function act(state: LiarsDiceServerState, playerId: string, action: LiarsDiceAction, now = 0) {
  return ld.handleAction(state, playerId, action, ctx(1, now));
}

function ok(result: ReturnType<typeof act>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.transition;
}

function err(result: ReturnType<typeof act>) {
  if (result.ok) throw new Error("expected a rejection");
  return result.error.code;
}

const types = (t: { events: GameEventEnvelope<LiarsDiceEvent>[] }) => t.events.map((e) => e.event.type);
const counts = (s: LiarsDiceServerState) => s.players.map((p) => p.count);
const pub = (s: LiarsDiceServerState) => ld.getPublicState(s);

describe("createGame", () => {
  it("rolls everyone's dice and tells each player only their own", () => {
    // p0 rolls a pattern nobody else does, so it's findable anywhere it leaks.
    const rigged: Face[] = [6, 2, 6, 2, 6, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4];
    const t = ld.createGame(players(3), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 2 }, ctx(), { deck: rigged });
    expect(t.state.players.map((p) => p.dice)).toEqual([[6, 2, 6, 2, 6], [3, 3, 3, 3, 3], [4, 4, 4, 4, 4]]);
    expect(types(t)).toEqual(["rolled", "you-rolled", "you-rolled", "you-rolled"]);
    expect(t.events[0]!.event).toMatchObject({ round: 1, counts: { p0: 5, p1: 5, p2: 5 }, starterId: "p0", reason: "start" });
    expect(t.events[1]).toEqual({ visibility: { kind: "private", playerId: "p0" }, event: { type: "you-rolled", dice: [2, 2, 6, 6, 6] } });
    expect(ld.getPrivateState(t.state, "p0")).toMatchObject({ dice: [2, 2, 6, 6, 6], canBid: true, canCallLiar: false });
    expect(pub(t.state)).toMatchObject({ phase: "bidding", currentPlayerId: "p0", totalDice: 15, bid: null });
    expect(ld.getAwaitedPlayerIds(t.state)).toEqual(["p0"]);
    expect(findLeaks({ def: ld, state: t.state, events: t.events, players: ids(3), secret: "2,2,6,6,6", allowed: ["p0"] })).toEqual([]);
    expect(findLeaks({ def: ld, state: t.state, events: t.events, players: ids(3), secret: "3,3,3,3,3", allowed: ["p1"] })).toEqual([]);
  });

  it("rolls with the injected RNG, honours starting dice, and checks the head count", () => {
    const t = ld.createGame(players(4), { ...DEFAULT_SETTINGS, startingDice: 3 }, { roundNumber: 1, dealerSeat: 0 }, ctx(7));
    expect(t.state.players.every((p) => p.dice.length === 3 && p.dice.every((d) => d >= 1 && d <= 6))).toBe(true);
    expect(pub(t.state).totalDice).toBe(12);
    expect(() => ld.createGame(players(1), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx())).toThrow(/2–8/);
    expect(() => ld.createGame(players(9), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx())).toThrow(/2–8/);
  });

  it("parses settings and actions strictly", () => {
    expect(ld.parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(ld.parseSettings({ startingDice: 4, spotOn: false })).toEqual({ wildOnes: true, spotOn: false, startingDice: 4 });
    expect(ld.parseSettings({ startingDice: 6 })).toBeNull();
    expect(ld.parseSettings({ wildOnes: "yes" })).toBeNull();
    expect(ld.parseAction({ type: "bid", quantity: 3, face: 4 })).toEqual({ type: "bid", quantity: 3, face: 4 });
    expect(ld.parseAction({ type: "bid", quantity: 3, face: 7 })).toBeNull();
    expect(ld.parseAction({ type: "bid", quantity: 0, face: 2 })).toBeNull();
    expect(ld.parseAction({ type: "bid", quantity: 2.5, face: 2 })).toBeNull();
    expect(ld.parseAction({ type: "ready" })).toEqual({ type: "ready" });
    expect(ld.parseAction({ type: "dudo" })).toBeNull();
  });
});

describe("bidding", () => {
  const dice: Face[][] = [[2, 3, 4], [5, 5, 6], [1, 2, 2]];

  it("takes a raise, moves the turn on, and keeps the history", () => {
    const s = stateWith(dice, { turn: 1, bid: { quantity: 2, face: 3 } });
    const t = ok(act(s, "p1", { type: "bid", quantity: 2, face: 5 }));
    expect(pub(t.state)).toMatchObject({ currentPlayerId: "p2", bid: { playerId: "p1", quantity: 2, face: 5 } });
    expect(t.state.history.map((b) => b.playerId)).toEqual(["p0", "p1"]);
    expect(types(t)).toEqual(["bid"]);
    expect(ld.getPrivateState(t.state, "p2")).toMatchObject({ canBid: true, canCallLiar: true, canSpotOn: true });
    // A bid says nothing about what's under anyone's cup.
    expect(findLeaks({ def: ld, state: t.state, events: t.events, players: ids(3), secret: "[5,5,6]", allowed: ["p1"] })).toEqual([]);
  });

  it("refuses out-of-turn, low, oversized and empty moves", () => {
    const open = stateWith(dice);
    expect(err(act(open, "p1", { type: "bid", quantity: 1, face: 2 }))).toBe("not-your-turn");
    expect(err(act(open, "p0", { type: "liar" }))).toBe("no-bid");
    expect(err(act(open, "p0", { type: "spot-on" }))).toBe("no-bid");
    expect(err(act(open, "p0", { type: "bid", quantity: 10, face: 2 }))).toBe("bad-bid");
    expect(ok(act(open, "p0", { type: "bid", quantity: 9, face: 6 })).state.bid?.quantity).toBe(9);
    expect(err(act(open, "p0", { type: "ready" }))).toBe("not-now");

    const s = stateWith(dice, { turn: 1, bid: { quantity: 3, face: 4 } });
    expect(err(act(s, "p1", { type: "bid", quantity: 3, face: 4 }))).toBe("bad-bid");
    expect(err(act(s, "p1", { type: "bid", quantity: 3, face: 2 }))).toBe("bad-bid");
    expect(ok(act(s, "p1", { type: "bid", quantity: 2, face: 1 })).state.bid).toMatchObject({ quantity: 2, face: 1 });

    const noSpot = stateWith(dice, { turn: 1, bid: { quantity: 3, face: 4 }, settings: { spotOn: false } });
    expect(err(act(noSpot, "p1", { type: "spot-on" }))).toBe("no-spot-on");
    expect(ld.getPrivateState(noSpot, "p1").canSpotOn).toBe(false);
  });

  it("skips over players who are out", () => {
    const s = stateWith([[2, 2], [], [3]], { turn: 0 });
    const t = ok(act(s, "p0", { type: "bid", quantity: 1, face: 2 }));
    expect(pub(t.state).currentPlayerId).toBe("p2");
    expect(err(act(t.state, "p1", { type: "liar" }))).toBe("out");
  });
});

describe("calling liar", () => {
  // Table: 2,3,3 | 1,3,5 | 6,6,4. Threes with wilds: 4. Without: 3.
  const dice: Face[][] = [[2, 3, 3], [1, 3, 5], [4, 6, 6]];

  it("costs the bidder a die when the bid falls short, and they start next", () => {
    const s = stateWith(dice, { turn: 2, bid: { quantity: 5, face: 3 } });
    const t = ok(act(s, "p2", { type: "liar" }, 1000));
    expect(t.state.reveal).toMatchObject({ call: "liar", callerId: "p2", count: 4, wild: true, success: true, loserId: "p1", eliminatedId: null });
    expect(counts(t.state)).toEqual([3, 2, 3]);
    expect(pub(t.state)).toMatchObject({ phase: "reveal", currentPlayerId: null, nextStarterId: "p1", revealEndsAt: 1000 + REVEAL_MS, totalDice: 8 });
    expect(t.timers).toEqual([{ kind: "set", timerId: "reveal", delayMs: REVEAL_MS }]);
    expect(ld.getAwaitedPlayerIds(t.state)).toEqual([]);
    // Everything's face up now: the reveal carries every die, publicly.
    expect(pub(t.state).reveal?.dice).toEqual({ p0: [2, 3, 3], p1: [1, 3, 5], p2: [4, 6, 6] });
  });

  it("costs the caller a die when the bid was there", () => {
    const s = stateWith(dice, { turn: 2, bid: { quantity: 4, face: 3 } });
    const t = ok(act(s, "p2", { type: "liar" }));
    expect(t.state.reveal).toMatchObject({ success: false, loserId: "p2" });
    expect(pub(t.state).nextStarterId).toBe("p2");
  });

  it("counts only real 3s without wilds, and only 1s for a bid on 1s", () => {
    const off = stateWith(dice, { turn: 2, bid: { quantity: 4, face: 3 }, settings: { wildOnes: false } });
    expect(ok(act(off, "p2", { type: "liar" })).state.reveal).toMatchObject({ count: 3, wild: false, loserId: "p1" });
    const ones = stateWith(dice, { turn: 2, bid: { quantity: 2, face: 1 } });
    expect(ok(act(ones, "p2", { type: "liar" })).state.reveal).toMatchObject({ count: 1, wild: false, loserId: "p1" });
  });

  it("passes the start to the left when the loser is out", () => {
    // p1 bid with their last die and was wrong: p2 opens next.
    const s = stateWith([[2, 2], [5], [3, 3], [4]], { turn: 2, bid: { quantity: 3, face: 6 } });
    const t = ok(act(s, "p2", { type: "liar" }));
    expect(t.state.reveal).toMatchObject({ loserId: "p1", eliminatedId: "p1" });
    expect(t.state.outOrder).toEqual(["p1"]);
    expect(pub(t.state)).toMatchObject({ nextStarterId: "p2" });
    expect(pub(t.state).players[1]).toMatchObject({ out: true, diceCount: 0 });

    // The caller was out and on the last seat: wraps round to p0.
    const wrap = stateWith([[2, 2], [5, 5], [3]], { turn: 2, bid: { quantity: 1, face: 2 } });
    const w = ok(act(wrap, "p2", { type: "liar" }));
    expect(w.state.reveal).toMatchObject({ loserId: "p2", eliminatedId: "p2" });
    expect(pub(w.state).nextStarterId).toBe("p0");
  });
});

describe("spot on", () => {
  const dice: Face[][] = [[2, 3, 3], [1, 3, 5], [4, 6, 6]];

  it("gives the caller a die back on an exact count, and they start", () => {
    const s = stateWith([[2, 3], [1, 3, 5], [4, 6, 6]], { turn: 0, bid: { quantity: 3, face: 3 } });
    const t = ok(act(s, "p0", { type: "spot-on" }));
    expect(t.state.reveal).toMatchObject({ call: "spot-on", count: 3, success: true, loserId: null, gainerId: "p0" });
    expect(counts(t.state)).toEqual([3, 3, 3]);
    expect(pub(t.state).nextStarterId).toBe("p0");
  });

  it("never goes above the starting dice", () => {
    const s = stateWith(dice, { turn: 2, bid: { quantity: 4, face: 3 }, settings: { startingDice: 3 } });
    const t = ok(act(s, "p2", { type: "spot-on" }));
    expect(t.state.reveal).toMatchObject({ success: true, gainerId: null, loserId: null });
    expect(counts(t.state)).toEqual([3, 3, 3]);

    const capped = stateWith([[2, 3, 3], [1, 3], [4, 6]], { turn: 1, bid: { quantity: 4, face: 3 }, settings: { startingDice: 3 } });
    const c = ok(act(capped, "p1", { type: "spot-on" }));
    expect(c.state.reveal).toMatchObject({ success: true, gainerId: "p1" });
    expect(counts(c.state)).toEqual([3, 3, 2]);
  });

  it("costs the caller a die on a miss, and they start", () => {
    const s = stateWith(dice, { turn: 2, bid: { quantity: 3, face: 3 } });
    const t = ok(act(s, "p2", { type: "spot-on" }));
    expect(t.state.reveal).toMatchObject({ success: false, loserId: "p2", gainerId: null });
    expect(counts(t.state)).toEqual([3, 3, 2]);
    expect(pub(t.state).nextStarterId).toBe("p2");
  });
});

describe("the reveal", () => {
  const revealed = () => {
    const s = stateWith([[2, 3, 3], [1, 3, 5], [4, 6, 6]], { turn: 2, bid: { quantity: 5, face: 3 }, rigged: [6, 6, 6, 2, 2, 5, 5, 5] });
    return ok(act(s, "p2", { type: "liar" })).state;
  };

  it("rolls the next round when the timer runs out", () => {
    const t = ld.onTimer!(revealed(), "reveal", ctx());
    expect(pub(t.state)).toMatchObject({ phase: "bidding", round: 2, currentPlayerId: "p1", bid: null, history: [] });
    expect(t.state.players.map((p) => p.dice)).toEqual([[6, 6, 6], [2, 2], [5, 5, 5]]);
    expect(types(t)).toEqual(["rolled", "you-rolled", "you-rolled", "you-rolled"]);
    expect(t.events[0]!.event).toMatchObject({ reason: "next", starterId: "p1", counts: { p0: 3, p1: 2, p2: 3 } });
    // The last reveal stays up for the record.
    expect(pub(t.state).reveal?.loserId).toBe("p1");
    expect(findLeaks({ def: ld, state: t.state, events: t.events, players: ids(3), secret: "6,6,6", allowed: ["p0"] })).toEqual([]);
  });

  it("rolls early once everyone still in has tapped ready", () => {
    let s = revealed();
    const a = ok(act(s, "p0", { type: "ready" }));
    expect(types(a)).toEqual(["ready"]);
    expect(pub(a.state).players[0]!.ready).toBe(true);
    expect(ld.getPrivateState(a.state, "p0").canReady).toBe(false);
    expect(ok(act(a.state, "p0", { type: "ready" })).events).toEqual([]);
    s = ok(act(a.state, "p1", { type: "ready" })).state;
    expect(s.phase).toBe("reveal");
    const t = ok(act(s, "p2", { type: "ready" }));
    expect(t.state.phase).toBe("bidding");
    expect(t.timers).toContainEqual({ kind: "cancel", timerId: "reveal" });
    expect(err(act(t.state, "p0", { type: "ready" }))).toBe("not-now");
  });

  it("doesn't wait on someone who dropped", () => {
    let s = revealed();
    s = ok(act(s, "p0", { type: "ready" })).state;
    s = ok(act(s, "p1", { type: "ready" })).state;
    expect(ld.onPlayerDisconnected!(s, "p2", ctx()).state.phase).toBe("bidding");
  });

  it("refuses bids while it's up", () => {
    expect(err(act(revealed(), "p1", { type: "bid", quantity: 1, face: 2 }))).toBe("not-now");
  });
});

describe("skip", () => {
  it("opens one of the idle player's most common face", () => {
    const s = stateWith([[4, 4, 6, 6, 2], [3]]);
    const t = ld.skipTurn!(s, "p0", ctx());
    expect(types(t)).toEqual(["turn-skipped", "bid"]);
    expect(t.state.bid).toEqual({ playerId: "p0", quantity: 1, face: 6 });
  });

  it("raises on that face, else makes the least raise, and never calls", () => {
    const s = stateWith([[3], [5, 5, 2]], { turn: 1, bid: { quantity: 2, face: 4 } });
    expect(ld.skipTurn!(s, "p1", ctx()).state.bid).toMatchObject({ quantity: 2, face: 5 });
    const high = stateWith([[3], [2, 2, 1]], { turn: 1, bid: { quantity: 4, face: 6 } });
    expect(ld.skipTurn!(high, "p1", ctx()).state.bid).toMatchObject({ quantity: 2, face: 1 });
  });

  it("calls liar only when no bid could beat the standing one", () => {
    const s = stateWith([[1, 1], [1, 2]], { turn: 1, bid: { quantity: 4, face: 1 } });
    const t = ld.skipTurn!(s, "p1", ctx());
    expect(t.state.reveal).toMatchObject({ call: "liar", callerId: "p1", count: 3, loserId: "p0" });
  });

  it("ignores skips for anyone but the bidder", () => {
    const s = stateWith([[2], [3]]);
    expect(ld.skipTurn!(s, "p1", ctx()).state).toBe(s);
  });
});

describe("removal", () => {
  it("voids a round in progress: dice leave, everyone re-rolls, the next player opens", () => {
    const s = stateWith([[2, 2], [3, 3, 3], [4], [5, 5]], { turn: 0, bid: { quantity: 3, face: 2 }, rigged: [6, 6, 1, 1, 1, 4, 4] });
    const t = ld.onPlayerRemoved!(s, "p1", ctx());
    expect(types(t)).toEqual(["player-removed", "rolled", "you-rolled", "you-rolled", "you-rolled"]);
    expect(t.events[0]!.event).toEqual({ type: "player-removed", playerId: "p1", voided: true });
    expect(t.events[1]!.event).toMatchObject({ reason: "void", starterId: "p2", counts: { p0: 2, p2: 1, p3: 2 } });
    expect(t.state.players.map((p) => p.dice)).toEqual([[6, 6], [], [1], [1, 1]]);
    expect(pub(t.state)).toMatchObject({ bid: null, history: [], currentPlayerId: "p2", totalDice: 5 });
    expect(pub(t.state).players[1]).toMatchObject({ removed: true, out: false, diceCount: 0 });
    expect(err(act(t.state, "p1", { type: "liar" }))).toBe("not-in-game");
    expect(findLeaks({ def: ld, state: t.state, events: t.events, players: ids(4), secret: "[1,1]", allowed: ["p3"] })).toEqual([]);
  });

  it("leaves a reveal standing, and moves the next start on if it was theirs", () => {
    const s = stateWith([[2, 3, 3], [1, 3, 5], [4, 6, 6]], { turn: 2, bid: { quantity: 5, face: 3 } });
    const revealed = ok(act(s, "p2", { type: "liar" })).state;
    expect(pub(revealed).nextStarterId).toBe("p1");
    const t = ld.onPlayerRemoved!(revealed, "p1", ctx());
    expect(types(t)).toEqual(["player-removed"]);
    expect(t.events[0]!.event).toMatchObject({ voided: false });
    expect(t.state.reveal).toEqual(revealed.reveal);
    expect(pub(t.state)).toMatchObject({ phase: "reveal", nextStarterId: "p2", round: 1 });
  });

  it("finishes the game when one player is left", () => {
    const s = stateWith([[2, 2], [3]], { bid: { quantity: 1, face: 2 }, turn: 1 });
    const t = ld.onPlayerRemoved!(s, "p0", ctx());
    expect(types(t)).toEqual(["player-removed", "game-over"]);
    expect(ld.getResult(t.state)).toMatchObject({
      winnerIds: ["p1"],
      standings: [
        { playerId: "p1", label: "1 die left" },
        { playerId: "p0", label: "left" },
      ],
    });
  });
});

describe("the end", () => {
  it("ends when one player has dice, with the latest out ranked highest", () => {
    const s = stateWith([[2], [3], [4, 4]], { turn: 1, bid: { quantity: 1, face: 6, by: 0 } });
    // p1 calls p0's one 6: there's none, so p0 goes out first.
    let t = ok(act(s, "p1", { type: "liar" }));
    expect(t.state.outOrder).toEqual(["p0"]);
    expect(ld.getResult(t.state)).toBeNull();
    t = ld.onTimer!(t.state, "reveal", ctx());
    // Next round: p1 (left of p0) opens; p2 calls it; p1 loses their last die.
    const next = { ...t.state, players: t.state.players.map((p) => (p.id === "p1" ? { ...p, dice: [3] as Face[] } : p.id === "p2" ? { ...p, dice: [4, 4] as Face[] } : p)) };
    expect(pub(next).currentPlayerId).toBe("p1");
    const bid = ok(act(next, "p1", { type: "bid", quantity: 2, face: 3 }));
    const end = ok(act(bid.state, "p2", { type: "liar" }));
    expect(types(end)).toEqual(["called", "game-over"]);
    expect(end.timers).toEqual([{ kind: "cancel", timerId: "reveal" }]);
    expect(pub(end.state)).toMatchObject({ phase: "over", winnerId: "p2", outOrder: ["p0", "p1"] });
    expect(ld.getResult(end.state)).toEqual({
      winnerIds: ["p2"],
      standings: [
        { playerId: "p2", value: 2, label: "2 dice left" },
        { playerId: "p1", value: 0, label: "out 2nd" },
        { playerId: "p0", value: 0, label: "out 1st" },
      ],
    });
    expect(err(act(end.state, "p2", { type: "ready" }))).toBe("game-finished");
  });
});
