import { seededRandomInt, type GameContext, type GameTransition } from "@games/game-core";
import { findLeaks } from "@games/game-core/testing";
import { describe, expect, it } from "vitest";
import { thornsGame as th } from "../server/game.ts";
import {
  DEFAULT_SETTINGS,
  type Disc,
  type Phase,
  type ThornsAction,
  type ThornsEvent,
  type ThornsServerState,
} from "../shared/types.ts";

const ctx = (seed = 1, now = 0): GameContext => ({ now, randomInt: seededRandomInt(seed) });
/** randomInt that always answers `i` (clamped): pins down which disc a failure costs. */
const pick = (i: number, now = 0): GameContext => ({ now, randomInt: (max) => Math.min(i, max - 1) });
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
const ids = (n: number) => players(n).map((p) => p.id);

/** A mid-round state. `stacks[i]` is p{i}'s mat, bottom first. */
function stateWith(
  stacks: Disc[][],
  opts: {
    phase?: Phase;
    turn?: number;
    start?: number;
    bid?: { amount: number; bidder: number };
    passed?: number[];
    owned?: Record<number, { roses: number; thorn: boolean }>;
    points?: Record<number, number>;
    removed?: number[];
  } = {},
): ThornsServerState {
  return {
    phase: opts.phase ?? "turns",
    settings: { ...DEFAULT_SETTINGS },
    players: stacks.map((stack, i) => ({
      id: `p${i}`,
      roses: opts.owned?.[i]?.roses ?? 3,
      thorn: opts.owned?.[i]?.thorn ?? true,
      stack: [...stack],
      points: opts.points?.[i] ?? 0,
      passed: opts.passed?.includes(i) ?? false,
      ready: false,
      removed: opts.removed?.includes(i) ?? false,
      away: false,
      lostDisc: null,
    })),
    round: 1,
    startIndex: opts.start ?? 0,
    turnIndex: opts.turn ?? 0,
    bid: opts.bid ? { amount: opts.bid.amount, bidderId: `p${opts.bid.bidder}` } : null,
    challenge: null,
    result: null,
    resultEndsAt: 0,
    resultMs: 0,
    winnerId: null,
    endReason: null,
  };
}

function act(state: ThornsServerState, playerId: string, action: ThornsAction, c: GameContext = ctx()) {
  return th.handleAction(state, playerId, action, c);
}

function ok(result: ReturnType<typeof act>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.transition;
}

function err(result: ReturnType<typeof act>) {
  if (result.ok) throw new Error("expected a rejection");
  return result.error.code;
}

/** `bidder` bids `amount` and everyone else passes: straight to the challenge. Returns the last step. */
function win(state: ThornsServerState, bidder: string, amount: number, c: GameContext = ctx()) {
  let t = ok(act(state, bidder, { type: "bid", amount }, c));
  while (t.state.phase === "bidding") t = ok(act(t.state, th.getPublicState(t.state).currentPlayerId!, { type: "pass" }, c));
  return t;
}

const types = (t: { events: { event: { type: string } }[] }) => t.events.map((e) => e.event.type);
const publicEvents = (t: GameTransition<ThornsServerState, ThornsEvent>) => t.events.filter((e) => e.visibility.kind === "public");

describe("setup", () => {
  it("gives everyone three roses and a thorn, and waits on everyone to place", () => {
    const t = th.createGame(players(4), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 2 }, ctx());
    expect(t.state.phase).toBe("placing-first");
    expect(types(t)).toEqual(["round-start"]);
    expect(t.events[0]!.event).toMatchObject({ round: 1, startId: "p2" });
    expect(th.getPrivateState(t.state, "p0")).toMatchObject({ hand: ["rose", "rose", "rose", "thorn"], canPlace: true, canBid: false });
    expect(th.getPublicState(t.state).players.map((p) => p.discs)).toEqual([4, 4, 4, 4]);
    expect(th.getAwaitedPlayerIds(t.state)).toEqual(ids(4));
    expect(() => th.createGame(players(2), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx())).toThrow(/3–6/);
    expect(() => th.createGame(players(7), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx())).toThrow(/3–6/);
  });

  it("parses settings and actions", () => {
    expect(th.parseSettings({ pointsToWin: 3 })).toEqual({ pointsToWin: 3 });
    expect(th.parseSettings({ pointsToWin: 5 })).toBeNull();
    expect(th.parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(th.parseAction({ type: "place", disc: "thorn" })).toEqual({ type: "place", disc: "thorn" });
    expect(th.parseAction({ type: "place", disc: "daisy" })).toBeNull();
    expect(th.parseAction({ type: "bid", amount: 2.5 })).toBeNull();
    expect(th.parseAction({ type: "flip", owner: "p1" })).toEqual({ type: "flip", owner: "p1" });
    expect(th.parseAction({ type: "nope" })).toBeNull();
  });
});

describe("opening placement", () => {
  it("takes everyone at once, in any order, and starts turns once all are down", () => {
    let s = th.createGame(players(3), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 1 }, ctx()).state;
    const t = ok(act(s, "p2", { type: "place", disc: "thorn" }));
    expect(types(t)).toEqual(["placed", "you-placed"]);
    expect(t.events[1]!.visibility).toEqual({ kind: "private", playerId: "p2" });
    s = t.state;
    expect(err(act(s, "p2", { type: "place", disc: "rose" }))).toBe("already-placed");
    expect(th.getAwaitedPlayerIds(s)).toEqual(["p0", "p1"]);
    s = ok(act(s, "p0", { type: "place", disc: "rose" })).state;
    expect(err(act(s, "p1", { type: "bid", amount: 1 }))).toBe("no-bidding");
    s = ok(act(s, "p1", { type: "place", disc: "rose" })).state;
    expect(s.phase).toBe("turns");
    expect(th.getPublicState(s)).toMatchObject({ currentPlayerId: "p1", tableTotal: 3, minBid: 1 });
  });
});

describe("turns and bidding", () => {
  it("you must bid with an empty hand", () => {
    const s = stateWith([["rose", "rose", "rose", "thorn"], ["rose"], ["rose"]]);
    expect(th.getPrivateState(s, "p0")).toMatchObject({ hand: [], canPlace: false, canBid: true });
    expect(err(act(s, "p0", { type: "place", disc: "rose" }))).toBe("empty-hand");
    expect(err(act(s, "p0", { type: "pass" }))).toBe("no-passing");
    expect(ok(act(s, "p0", { type: "bid", amount: 2 })).state.phase).toBe("bidding");
  });

  it("can't place a disc you don't hold, or out of turn", () => {
    const s = stateWith([["thorn"], ["rose"], ["rose"]]);
    expect(err(act(s, "p0", { type: "place", disc: "thorn" }))).toBe("disc-not-in-hand");
    expect(err(act(s, "p1", { type: "place", disc: "rose" }))).toBe("not-your-turn");
    const t = ok(act(s, "p0", { type: "place", disc: "rose" }));
    expect(th.getPublicState(t.state)).toMatchObject({ currentPlayerId: "p1", tableTotal: 4 });
  });

  it("nobody can place after a bid", () => {
    const s = ok(act(stateWith([["rose"], ["rose"], ["rose"]]), "p0", { type: "bid", amount: 1 })).state;
    expect(s.phase).toBe("bidding");
    expect(err(act(s, "p1", { type: "place", disc: "rose" }))).toBe("no-placing");
    expect(th.getPrivateState(s, "p1")).toMatchObject({ canPlace: false, canBid: true, canPass: true });
  });

  it("raises must go up, and stay within what's on the table", () => {
    const s = ok(act(stateWith([["rose"], ["rose"], ["rose"]]), "p0", { type: "bid", amount: 1 })).state;
    expect(err(act(s, "p1", { type: "bid", amount: 1 }))).toBe("bad-bid");
    expect(err(act(s, "p1", { type: "bid", amount: 4 }))).toBe("bad-bid");
    expect(th.getPublicState(s)).toMatchObject({ minBid: 2, tableTotal: 3, bid: { amount: 1, bidderId: "p0" } });
  });

  it("a bid of exactly the table total ends bidding at once", () => {
    const s = stateWith([["rose"], ["rose"], ["rose", "rose"]]);
    const t = ok(act(s, "p0", { type: "bid", amount: 4 }));
    expect(types(t)[0]).toBe("bid");
    expect(types(t)).toContain("challenge");
    expect(t.state.phase).toBe("flipping");
    expect(t.state.challenge?.challengerId).toBe("p0");
  });

  it("passes are final, and the last bidder standing takes the challenge", () => {
    let s = ok(act(stateWith([["rose"], ["rose"], ["rose"], ["rose"]]), "p0", { type: "bid", amount: 1 })).state;
    s = ok(act(s, "p1", { type: "pass" })).state;
    s = ok(act(s, "p2", { type: "bid", amount: 2 })).state;
    s = ok(act(s, "p3", { type: "pass" })).state;
    // p1 passed: straight back to p0.
    expect(th.getPublicState(s).currentPlayerId).toBe("p0");
    expect(err(act(s, "p1", { type: "bid", amount: 3 }))).toBe("not-your-turn");
    const t = ok(act(s, "p0", { type: "pass" }));
    expect(t.state.phase).toBe("flipping");
    expect(t.state.challenge).toMatchObject({ challengerId: "p2", amount: 2 });
  });
});

describe("flipping", () => {
  it("flips your own stack first, all of it, top down, by itself", () => {
    const s = stateWith([["rose"], ["rose"], ["rose", "rose", "rose"]], { turn: 2 });
    const t = win(s, "p2", 4);
    expect(t.state.challenge!.flips).toEqual([
      { owner: "p2", disc: "rose" },
      { owner: "p2", disc: "rose" },
      { owner: "p2", disc: "rose" },
    ]);
    expect(t.state.phase).toBe("flipping");
    expect(th.getPrivateState(t.state, "p2").canFlip).toEqual(["p0", "p1"]);
    expect(err(act(t.state, "p2", { type: "flip", owner: "p2" }))).toBe("own-stack");
    expect(err(act(t.state, "p0", { type: "flip", owner: "p1" }))).toBe("not-challenger");
  });

  it("only flips as much of your own stack as the bid needs", () => {
    const s = stateWith([["thorn", "rose", "rose"], ["rose"], ["rose"]]);
    const t = win(s, "p0", 2);
    expect(t.state.challenge!.flips).toHaveLength(2);
    expect(t.state.result).toMatchObject({ outcome: "success" });
    expect(t.state.players[0]!.points).toBe(1);
  });

  it("then takes others' top discs one at a time, and an empty mat is off limits", () => {
    const s = stateWith([["rose"], ["thorn", "rose"], ["rose"]], { turn: 0 });
    let t = win(s, "p0", 4);
    t = ok(act(t.state, "p0", { type: "flip", owner: "p2" }));
    expect(err(act(t.state, "p0", { type: "flip", owner: "p2" }))).toBe("cant-flip");
    t = ok(act(t.state, "p0", { type: "flip", owner: "p1" }));
    expect(t.state.challenge!.flips.at(-1)).toEqual({ owner: "p1", disc: "rose" });
    t = ok(act(t.state, "p0", { type: "flip", owner: "p1" }));
    expect(t.state.challenge!.flips.at(-1)).toEqual({ owner: "p1", disc: "thorn" });
    expect(t.state.result).toMatchObject({ outcome: "failure", thornOwnerId: "p1" });
  });

  it("a success scores, and the second point wins", () => {
    const s = stateWith([["rose"], ["rose"], ["rose"]], { points: { 0: 1 } });
    const t = win(s, "p0", 1);
    expect(t.state.phase).toBe("over");
    expect(types(t)).toEqual(["passed", "challenge", "flipped", "success", "game-over"]);
    expect(th.getResult(t.state)!.winnerIds).toEqual(["p0"]);
    expect(th.getResult(t.state)!.standings[0]).toMatchObject({ playerId: "p0", label: "2 points · 4 discs" });
  });

  it("the result waits ~3 s (more when discs flipped on their own), or for everyone's Ready", () => {
    const s = stateWith([["rose"], ["rose"], ["rose"]]);
    const t = win(s, "p0", 1, ctx(1, 1000));
    expect(t.state.phase).toBe("result");
    expect(t.timers).toEqual([{ kind: "set", timerId: "result", delayMs: 3650 }]);
    expect(th.getPublicState(t.state)).toMatchObject({ resultEndsAt: 4650, result: { nextStartId: "p0" } });
    let r = t.state;
    r = ok(act(r, "p1", { type: "ready" })).state;
    r = ok(act(r, "p2", { type: "ready" })).state;
    expect(r.phase).toBe("result");
    expect(th.getPublicState(r).players.map((p) => p.ready)).toEqual([false, true, true]);
    const last = ok(act(r, "p0", { type: "ready" }));
    expect(last.state.phase).toBe("placing-first");
    expect(last.state.round).toBe(2);
    expect(last.state.players.every((p) => p.stack.length === 0)).toBe(true);

    const timed = th.onTimer!(t.state, "result", ctx());
    expect(timed.state.phase).toBe("placing-first");
    expect(timed.events[0]!.event).toMatchObject({ type: "round-start", startId: "p0" });
  });
});

describe("losing a disc", () => {
  const failing = () => stateWith([["rose"], ["thorn"], ["rose"]]);
  const failOn = (c: GameContext) => {
    let t = win(failing(), "p0", 2, c);
    t = ok(act(t.state, "p0", { type: "flip", owner: "p1" }, c));
    return t;
  };

  it("takes one at random and tells only the loser which", () => {
    const rose = failOn(pick(0));
    const thorn = failOn(pick(3));
    expect(rose.state.players[0]).toMatchObject({ roses: 2, thorn: true, lostDisc: "rose" });
    expect(thorn.state.players[0]).toMatchObject({ roses: 3, thorn: false, lostDisc: "thorn" });
    expect(th.getPrivateState(thorn.state, "p0")).toMatchObject({ lostDisc: "thorn", hand: ["rose", "rose", "rose"] });

    const youLost = thorn.events.find((e) => e.event.type === "you-lost")!;
    expect(youLost.visibility).toEqual({ kind: "private", playerId: "p0" });
    expect(types(thorn)).toEqual(["flipped", "failure", "you-lost"]);

    // Nothing anyone else can see tells the two apart.
    expect(th.getPublicState(rose.state)).toEqual(th.getPublicState(thorn.state));
    expect(publicEvents(rose)).toEqual(publicEvents(thorn));
    for (const id of ["p1", "p2"]) expect(th.getPrivateState(rose.state, id)).toEqual(th.getPrivateState(thorn.state, id));
    expect(findLeaks({ def: th, state: thorn.state, events: thorn.events, players: ids(3), secret: `"lostDisc":"thorn"`, allowed: ["p0"] })).toEqual([]);
    // Into the next round too: their count drops, nothing else.
    const next = th.onTimer!(thorn.state, "result", ctx()).state;
    expect(th.getPublicState(next).players[0]!.discs).toBe(3);
    expect(next.players[0]!.lostDisc).toBeNull();
    const nextRose = th.onTimer!(rose.state, "result", ctx()).state;
    expect(th.getPublicState(next)).toEqual(th.getPublicState(nextRose));
  });

  it("losing your last disc puts you out, and the rest play on", () => {
    const s = stateWith([["rose"], ["thorn"], ["rose"], ["rose"]], { owned: { 0: { roses: 1, thorn: false } } });
    let t = win(s, "p0", 2);
    t = ok(act(t.state, "p0", { type: "flip", owner: "p1" }));
    expect(t.events.find((e) => e.event.type === "failure")!.event).toMatchObject({ discsLeft: 0, eliminated: true });
    expect(th.getPublicState(t.state).players[0]).toMatchObject({ discs: 0, out: true });
    const next = th.onTimer!(t.state, "result", ctx()).state;
    expect(th.getAwaitedPlayerIds(next)).toEqual(["p1", "p2", "p3"]);
    expect(err(act(next, "p0", { type: "place", disc: "rose" }))).toBe("out");
  });

  it("last one with discs wins", () => {
    const s = stateWith([["rose"], ["thorn"], []], { owned: { 0: { roses: 1, thorn: false }, 2: { roses: 0, thorn: false } } });
    let t = win(s, "p0", 2);
    t = ok(act(t.state, "p0", { type: "flip", owner: "p1" }));
    expect(t.state.phase).toBe("over");
    expect(th.getResult(t.state)!.winnerIds).toEqual(["p1"]);
    expect(th.getResult(t.state)!.standings[0]).toMatchObject({ playerId: "p1", label: "last one standing" });
  });
});

describe("who starts next", () => {
  it("after a success: the challenger", () => {
    const t = win(stateWith([["rose"], ["rose"], ["rose"]], { turn: 1, start: 0 }), "p1", 1);
    expect(t.state.result!.nextStartId).toBe("p1");
  });

  it("after a failure on someone else's thorn: its owner", () => {
    let t = win(stateWith([["rose"], ["rose"], ["thorn"]]), "p0", 2);
    t = ok(act(t.state, "p0", { type: "flip", owner: "p2" }));
    expect(t.state.result!.nextStartId).toBe("p2");
    expect(th.onTimer!(t.state, "result", ctx()).state.startIndex).toBe(2);
  });

  it("after a failure on your own thorn: you", () => {
    const t = win(stateWith([["rose"], ["thorn"], ["rose"]], { turn: 1 }), "p1", 1);
    expect(t.state.result).toMatchObject({ outcome: "failure", thornOwnerId: "p1", nextStartId: "p1" });
  });

  it("after a failure on your own thorn that knocks you out: the next player along", () => {
    const s = stateWith([["rose"], ["thorn"], ["rose"], ["rose"]], { turn: 1, owned: { 1: { roses: 0, thorn: true } } });
    const t = win(s, "p1", 1);
    expect(t.state.result).toMatchObject({ outcome: "failure", eliminated: true, nextStartId: "p2" });
  });
});

describe("hidden information", () => {
  it("stacks show height only; nobody else's view changes with what's in them", () => {
    const a = stateWith([["rose", "thorn"], ["rose"], ["rose"]], { turn: 1 });
    const b = stateWith([["thorn", "rose"], ["rose"], ["rose"]], { turn: 1 });
    const c = stateWith([["rose", "rose"], ["rose"], ["rose"]], { turn: 1 });
    expect(th.getPublicState(a)).toEqual(th.getPublicState(b));
    expect(th.getPublicState(a)).toEqual(th.getPublicState(c));
    for (const id of ["p1", "p2"]) {
      expect(th.getPrivateState(a, id)).toEqual(th.getPrivateState(c, id));
    }
    expect(th.getPublicState(a).players[0]).toMatchObject({ discs: 4, height: 2 });
    expect(findLeaks({ def: th, state: a, players: ids(3), secret: "thorn", allowed: ids(3) })).toEqual([]);
  });

  it("placing tells everyone a disc went down, and only you which", () => {
    const s = stateWith([["rose"], ["rose"], ["rose"]]);
    const t = ok(act(s, "p0", { type: "place", disc: "thorn" }));
    expect(findLeaks({ def: th, state: t.state, events: t.events, players: ids(3), secret: "thorn", allowed: ids(3) })).toEqual([]);
    expect(th.getPrivateState(t.state, "p0").stack).toEqual(["rose", "thorn"]);
    const rose = ok(act(s, "p0", { type: "place", disc: "rose" }));
    expect(publicEvents(t)).toEqual(publicEvents(rose));
    expect(th.getPublicState(t.state)).toEqual(th.getPublicState(rose.state));
  });

  it("flips are public as they happen", () => {
    let t = win(stateWith([["rose"], ["rose", "thorn"], ["rose"]]), "p0", 2);
    t = ok(act(t.state, "p0", { type: "flip", owner: "p1" }));
    expect(t.events[0]).toEqual({ visibility: { kind: "public" }, event: { type: "flipped", challengerId: "p0", owner: "p1", disc: "thorn", count: 2 } });
    expect(th.getPublicState(t.state).challenge!.flips).toEqual([
      { owner: "p0", disc: "rose" },
      { owner: "p1", disc: "thorn" },
    ]);
  });
});

describe("skip", () => {
  it("opening placement: a rose if there's one", () => {
    const s = th.createGame(players(3), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
    const t = th.skipTurn!(s, "p1", ctx());
    expect(types(t)).toEqual(["turn-skipped", "placed", "you-placed"]);
    expect(t.state.players[1]!.stack).toEqual(["rose"]);
    expect(th.skipTurn!(t.state, "p1", ctx()).state).toBe(t.state);
  });

  it("place-or-bid: a rose, else whatever's left, else the lowest bid", () => {
    const s = stateWith([["rose"], ["rose"], ["rose"]]);
    expect(th.skipTurn!(s, "p0", ctx()).state.players[0]!.stack).toEqual(["rose", "rose"]);
    // Only the thorn left: it goes down face down. A bid would tell the table what's in hand.
    const thornOnly = stateWith([["rose", "rose", "rose"], ["rose"], ["rose"]]);
    const placed = th.skipTurn!(thornOnly, "p0", ctx());
    expect(placed.state.players[0]!.stack).toEqual(["rose", "rose", "rose", "thorn"]);
    expect(placed.state.bid).toBeNull();
    const empty = stateWith([["rose", "rose", "rose", "thorn"], ["rose"], ["rose"]]);
    expect(th.skipTurn!(empty, "p0", ctx()).state.bid).toEqual({ amount: 1, bidderId: "p0" });
    // Not their turn: nothing happens.
    expect(th.skipTurn!(s, "p1", ctx()).state).toBe(s);
  });

  it("bidding: a pass, so a skipped bidder never wins the bid", () => {
    const s = ok(act(stateWith([["rose"], ["rose"], ["rose"]]), "p0", { type: "bid", amount: 1 })).state;
    const t = th.skipTurn!(s, "p1", ctx());
    expect(t.state.players[1]!.passed).toBe(true);
    expect(th.getPublicState(t.state).currentPlayerId).toBe("p2");
  });

  it("flipping: the tallest stack left, first clockwise on a tie", () => {
    let s = win(stateWith([["rose"], ["rose"], ["rose", "rose"], ["rose", "rose"]]), "p0", 3).state;
    s = th.skipTurn!(s, "p0", ctx()).state;
    expect(s.challenge!.flips.at(-1)!.owner).toBe("p2");
    s = th.skipTurn!(s, "p0", ctx()).state;
    expect(s.challenge!.flips.at(-1)!.owner).toBe("p3");
    expect(s.phase).toBe("result");
  });
});

describe("removal and disconnects", () => {
  it("mid-round: the round is void, discs go back, and the next one along starts", () => {
    const s = stateWith([["rose"], ["thorn", "rose"], ["rose"], ["rose"]], { turn: 2 });
    const t = th.onPlayerRemoved!(s, "p1", ctx());
    expect(types(t)).toEqual(["player-removed", "round-void", "round-start"]);
    expect(t.state.phase).toBe("placing-first");
    expect(t.state.startIndex).toBe(2);
    expect(t.state.players.every((p) => p.stack.length === 0)).toBe(true);
    expect(th.getPublicState(t.state).players[1]).toMatchObject({ removed: true, height: 0 });
    expect(th.getAwaitedPlayerIds(t.state)).toEqual(["p0", "p2", "p3"]);
  });

  it("mid-challenge: the challenge is void too, and nobody loses a disc", () => {
    let s = win(stateWith([["rose"], ["rose"], ["rose"], ["thorn"]]), "p0", 3).state;
    s = th.onPlayerRemoved!(s, "p2", ctx()).state;
    expect(s.phase).toBe("placing-first");
    expect(s.challenge).toBeNull();
    expect(s.players[0]).toMatchObject({ roses: 3, thorn: true, points: 0 });
    expect(s.startIndex).toBe(3);
  });

  it("during the result: the next round starts without them", () => {
    let t = win(stateWith([["rose"], ["rose"], ["thorn"], ["rose"]]), "p0", 2);
    t = ok(act(t.state, "p0", { type: "flip", owner: "p2" }));
    const r = th.onPlayerRemoved!(t.state, "p2", ctx()).state;
    expect(r.result!.nextStartId).toBe("p3");
    expect(th.onTimer!(r, "result", ctx()).state.startIndex).toBe(3);
  });

  it("fewer than two left: the remaining one wins", () => {
    const s = stateWith([["rose"], ["rose"], ["rose"]]);
    const t = th.onPlayerRemoved!(th.onPlayerRemoved!(s, "p1", ctx()).state, "p2", ctx());
    expect(t.state.phase).toBe("over");
    expect(th.getResult(t.state)).toMatchObject({ winnerIds: ["p0"] });
    expect(th.getResult(t.state)!.standings.at(-1)!.label).toBe("left");
  });

  it("the result doesn't wait on someone who dropped", () => {
    const t = win(stateWith([["rose"], ["rose"], ["rose"]]), "p0", 1);
    let s = th.onPlayerDisconnected!(t.state, "p2", ctx()).state;
    s = ok(act(s, "p0", { type: "ready" })).state;
    s = ok(act(s, "p1", { type: "ready" })).state;
    expect(s.phase).toBe("placing-first");
  });
});
