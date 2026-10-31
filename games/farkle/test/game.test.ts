import { seededRandomInt, type GameContext, type GameTransition } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { farkleGame as fk } from "../server/game.ts";
import { isFarkle, scoreDice } from "../shared/rules.ts";
import { BUST_MS, DEFAULT_SETTINGS, type FarkleAction, type FarkleEvent, type FarkleServerState, type FarkleSettings } from "../shared/types.ts";

/** A context whose dice come up as `faces`, in order, then seeded. */
function rig(...faces: number[]): GameContext {
  const fallback = seededRandomInt(7);
  const queue = [...faces];
  return { now: 0, randomInt: (n) => (queue.length ? queue.shift()! - 1 : fallback(n)) };
}
const ctx = (seed = 1): GameContext => ({ now: 0, randomInt: seededRandomInt(seed) });
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));

/** A mid-game state with `roll` on the table for `turn`, bypassing the opening roll. */
function stateWith(
  roll: number[],
  opts: {
    n?: number;
    turn?: number;
    scores?: number[];
    onBoard?: boolean[];
    farkles?: number[];
    turnTotal?: number;
    settings?: Partial<FarkleSettings>;
    finalRound?: FarkleServerState["finalRound"];
    removed?: number[];
  } = {},
): FarkleServerState {
  const n = opts.n ?? 3;
  return {
    phase: "playing",
    step: "rolled",
    settings: { ...DEFAULT_SETTINGS, ...opts.settings },
    players: Array.from({ length: n }, (_, i) => ({
      id: `p${i}`,
      score: opts.scores?.[i] ?? 0,
      onBoard: opts.onBoard?.[i] ?? (opts.scores?.[i] ?? 0) > 0,
      farkles: opts.farkles?.[i] ?? 0,
      removed: opts.removed?.includes(i) ?? false,
    })),
    turnIndex: opts.turn ?? 0,
    rollNumber: 1,
    roll,
    kept: [],
    turnTotal: opts.turnTotal ?? 0,
    hot: false,
    bustEndsAt: 0,
    finalRound: opts.finalRound ?? null,
    lastTurn: null,
    winnerIds: [],
    endReason: null,
    rigged: [],
  };
}

function act(state: FarkleServerState, playerId: string, action: FarkleAction, c: GameContext = ctx()) {
  return fk.handleAction(state, playerId, action, c);
}
function ok(result: ReturnType<typeof act>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.transition;
}
function err(result: ReturnType<typeof act>) {
  if (result.ok) throw new Error("expected a rejection");
  return result.error.code;
}
const types = (t: { events: { event: { type: string } }[] }) => t.events.map((e) => e.event.type);
const find = <K extends FarkleEvent["type"]>(t: GameTransition<FarkleServerState, FarkleEvent>, type: K) =>
  t.events.map((e) => e.event).find((e): e is Extract<FarkleEvent, { type: K }> => e.type === type);

/** Plays out the bust pause. */
const pause = (s: FarkleServerState, c: GameContext = ctx()) => fk.onTimer!(s, "bust", c);

describe("createGame", () => {
  it("starts with the seat after the last dealer rolling all six", () => {
    const t = fk.createGame(players(4), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 2 }, ctx(), { deck: [1, 2, 3, 4, 6, 6] });
    expect(fk.getPublicState(t.state)).toMatchObject({ currentPlayerId: "p2", step: "rolled", roll: [1, 2, 3, 4, 6, 6], turnTotal: 0 });
    expect(types(t)).toEqual(["rolled"]);
    expect(fk.getAwaitedPlayerIds(t.state)).toEqual(["p2"]);
    expect(() => fk.createGame(players(1), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx())).toThrow(/2–8/);
    expect(() => fk.createGame(players(9), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx())).toThrow(/2–8/);
  });

  it("rolls through ctx.randomInt", () => {
    const t = fk.createGame(players(2), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, rig(5, 5, 5, 2, 3, 4));
    expect(t.state.roll).toEqual([5, 5, 5, 2, 3, 4]);
  });

  it("parses settings and actions strictly", () => {
    expect(fk.parseSettings({ target: 10000, entry: 350, threeFarkles: true })).toEqual({ target: 10000, entry: 350, threeFarkles: true });
    expect(fk.parseSettings({ target: 7000 })).toBeNull();
    expect(fk.parseSettings({ entry: 100 })).toBeNull();
    expect(fk.parseAction({ type: "keep-and-roll", keep: [0, 2] })).toEqual({ type: "keep-and-roll", keep: [0, 2] });
    expect(fk.parseAction({ type: "keep-and-bank", keep: [] })).toBeNull();
    expect(fk.parseAction({ type: "keep-and-bank", keep: [6] })).toBeNull();
    expect(fk.parseAction({ type: "roll" })).toBeNull();
  });
});

describe("a turn", () => {
  it("keeps the scorers, rolls the rest, and groups kept dice by roll", () => {
    const s = stateWith([1, 5, 2, 3, 4, 6]);
    const t = ok(act(s, "p0", { type: "keep-and-roll", keep: [0, 1] }, rig(1, 2, 3, 4)));
    expect(types(t)).toEqual(["kept", "rolled"]);
    expect(t.state.kept).toEqual([{ dice: [1, 5], points: 150 }]);
    expect(t.state.roll).toEqual([1, 2, 3, 4]);
    expect(t.state.turnTotal).toBe(150);

    const t2 = ok(act(t.state, "p0", { type: "keep-and-roll", keep: [0] }, rig(5, 5, 2)));
    expect(t2.state.kept).toEqual([{ dice: [1, 5], points: 150 }, { dice: [1], points: 100 }]);
    expect(t2.state.roll).toEqual([5, 5, 2]);
  });

  it("only dice from the same roll combine", () => {
    // A 5 kept earlier doesn't make a triple with two 5s rolled later.
    const s = { ...stateWith([5, 5, 2, 3]), kept: [{ dice: [5, 1], points: 150 }], turnTotal: 150 };
    const t = ok(act(s, "p0", { type: "keep-and-roll", keep: [0, 1] }, rig(1, 1)));
    expect(t.state.turnTotal).toBe(250);
  });

  it("refuses selections that don't score, aren't in the roll, repeat, or are out of turn", () => {
    const s = stateWith([1, 3, 2, 4, 6, 6]);
    expect(err(act(s, "p0", { type: "keep-and-roll", keep: [0, 1] }))).toBe("non-scoring");
    expect(err(act(s, "p0", { type: "keep-and-roll", keep: [1] }))).toBe("non-scoring");
    expect(err(act(s, "p0", { type: "keep-and-roll", keep: [0, 0] }))).toBe("bad-dice");
    expect(err(act(stateWith([1, 5]), "p0", { type: "keep-and-roll", keep: [3] }))).toBe("bad-dice");
    expect(err(act(s, "p1", { type: "keep-and-roll", keep: [0] }))).toBe("not-your-turn");
    expect(err(act(s, "p0", { type: "keep-and-roll", keep: [] }))).toBe("keep-something");
  });

  it("banks the turn total and passes to the next player, who rolls", () => {
    const s = stateWith([1, 1, 1, 2, 3, 4], { turnTotal: 300, onBoard: [true] });
    const t = ok(act(s, "p0", { type: "keep-and-bank", keep: [0, 1, 2] }, rig(2, 2, 3, 4, 6, 1)));
    expect(types(t)).toEqual(["kept", "banked", "rolled"]);
    expect(find(t, "banked")).toEqual({ type: "banked", playerId: "p0", points: 1300, score: 1300 });
    expect(t.state.players[0]!.score).toBe(1300);
    expect(fk.getPublicState(t.state)).toMatchObject({ currentPlayerId: "p1", turnTotal: 0, kept: [], lastTurn: { playerId: "p0", kind: "banked", points: 1300 } });
  });

  it("hot dice: set all six aside and roll six again", () => {
    const s = stateWith([1, 5], { turnTotal: 400 });
    const t = ok(act(s, "p0", { type: "keep-and-roll", keep: [0, 1] }, rig(2, 3, 4, 6, 6, 1)));
    expect(t.state.roll).toHaveLength(6);
    expect(t.state.hot).toBe(true);
    expect(find(t, "rolled")).toMatchObject({ fresh: false, hot: true });
    expect(t.state.turnTotal).toBe(550);
  });
});

describe("farkles", () => {
  it("a dead roll loses the turn total, shows for a beat, then passes on", () => {
    const s = stateWith([1, 2, 3, 4, 6, 6], { turnTotal: 600 });
    const t = ok(act(s, "p0", { type: "keep-and-roll", keep: [0] }, rig(2, 3, 4, 6, 6)));
    expect(isFarkle(t.state.roll)).toBe(true);
    expect(types(t)).toEqual(["kept", "rolled", "farkle"]);
    expect(find(t, "farkle")).toMatchObject({ playerId: "p0", lost: 700, penalty: 0, score: 0 });
    expect(t.timers).toContainEqual({ kind: "set", timerId: "bust", delayMs: BUST_MS });
    expect(fk.getAwaitedPlayerIds(t.state)).toEqual([]);
    expect(err(act(t.state, "p0", { type: "keep-and-bank", keep: [0] }))).toBe("bust");

    // Stale timers do nothing.
    expect(fk.onTimer!(s, "bust", ctx()).state).toBe(s);
    const t2 = pause(t.state, rig(5, 2, 2, 3, 3, 4));
    expect(fk.getPublicState(t2.state)).toMatchObject({ currentPlayerId: "p1", step: "rolled", turnTotal: 0, roll: [5, 2, 2, 3, 3, 4] });
    expect(t2.state.players[0]!.score).toBe(0);
  });

  it("an opening roll can bust too", () => {
    const t = fk.createGame(players(2), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx(), { deck: [2, 3, 4, 6, 2, 3] });
    expect(t.state.step).toBe("bust");
    expect(find(t, "farkle")).toMatchObject({ lost: 0 });
  });

  it("three farkles in a row cost 500 when the setting's on, never below 0", () => {
    const bust = rig(2, 3, 4, 6, 2);
    const on = stateWith([1, 2, 3, 4, 6, 6], { scores: [800], farkles: [2], settings: { threeFarkles: true } });
    const t = ok(act(on, "p0", { type: "keep-and-roll", keep: [0] }, bust));
    expect(find(t, "farkle")).toMatchObject({ penalty: 500, score: 300 });
    expect(t.state.players[0]!.farkles).toBe(0);

    const poor = stateWith([1, 2, 3, 4, 6, 6], { scores: [200], farkles: [2], settings: { threeFarkles: true } });
    const t2 = ok(act(poor, "p0", { type: "keep-and-roll", keep: [0] }, rig(2, 3, 4, 6, 2)));
    expect(find(t2, "farkle")).toMatchObject({ penalty: 200, score: 0 });

    const off = stateWith([1, 2, 3, 4, 6, 6], { scores: [800], farkles: [2] });
    const t3 = ok(act(off, "p0", { type: "keep-and-roll", keep: [0] }, rig(2, 3, 4, 6, 2)));
    expect(find(t3, "farkle")).toMatchObject({ penalty: 0, score: 800 });
  });

  it("a bank resets the farkle count", () => {
    const s = stateWith([1, 1, 1, 2, 3, 4], { scores: [800], farkles: [2], settings: { threeFarkles: true } });
    const t = ok(act(s, "p0", { type: "keep-and-bank", keep: [0, 1, 2] }, rig(1, 2, 3, 4, 6, 6)));
    expect(t.state.players[0]!.farkles).toBe(0);
  });
});

describe("entry threshold", () => {
  it("refuses a first bank below it, and allows it once you're on the board", () => {
    const s = stateWith([1, 5, 2, 3, 4, 6], { turnTotal: 200 });
    expect(err(act(s, "p0", { type: "keep-and-bank", keep: [0, 1] }))).toBe("below-entry"); // 350 < 500
    expect(ok(act({ ...s, turnTotal: 350 }, "p0", { type: "keep-and-bank", keep: [0, 1] })).state.players[0]!.score).toBe(500);
    expect(ok(act(stateWith([5, 2, 3], { scores: [600] }), "p0", { type: "keep-and-bank", keep: [0] })).state.players[0]!.score).toBe(650);
    const low = stateWith([5, 2, 3], { settings: { entry: 0 } });
    expect(ok(act(low, "p0", { type: "keep-and-bank", keep: [0] })).state.players[0]).toMatchObject({ score: 50, onBoard: true });
  });
});

describe("final round", () => {
  it("gives everyone else exactly one more turn, then the highest score wins", () => {
    const s = stateWith([1, 1, 1, 2, 3, 4], { turn: 1, scores: [3000, 4500, 4000], turnTotal: 0 });
    let t = ok(act(s, "p1", { type: "keep-and-bank", keep: [0, 1, 2] }, rig(5, 2, 3, 4, 6, 6)));
    expect(types(t)).toEqual(["kept", "banked", "final-round", "rolled"]);
    expect(t.state.finalRound).toEqual({ triggerId: "p1", owed: ["p2", "p0"] });
    expect(fk.getPublicState(t.state).currentPlayerId).toBe("p2");

    // p2 banks 50: 4,050. p0 next.
    t = ok(act(t.state, "p2", { type: "keep-and-bank", keep: [0] }, rig(1, 1, 1, 1, 1, 1)));
    expect(fk.getPublicState(t.state).currentPlayerId).toBe("p0");
    expect(t.state.finalRound!.owed).toEqual(["p0"]);
    // p0 rolled six 1s: 3,000 → 6,000, past p1's 5,500.
    t = ok(act(t.state, "p0", { type: "keep-and-bank", keep: [0, 1, 2, 3, 4, 5] }));
    expect(t.state.phase).toBe("finished");
    expect(find(t, "game-over")).toEqual({ type: "game-over", winnerIds: ["p0"], reason: "target" });
    expect(fk.getResult(t.state)!.standings.map((x) => [x.playerId, x.label])).toEqual([
      ["p0", "6,000 pts"],
      ["p1", "5,500 pts"],
      ["p2", "4,050 pts"],
    ]);
    expect(err(act(t.state, "p1", { type: "keep-and-roll", keep: [0] }))).toBe("game-finished");
  });

  it("a bust in the final round still uses up the turn; ties share the win", () => {
    const s = stateWith([5, 2, 3], { n: 2, turn: 0, scores: [4950, 5000] });
    let t = ok(act(s, "p0", { type: "keep-and-bank", keep: [0] }, rig(2, 3, 4, 6, 2, 3)));
    expect(t.state.finalRound).toEqual({ triggerId: "p0", owed: ["p1"] });
    expect(t.state.step).toBe("bust");
    t = pause(t.state);
    expect(t.state.phase).toBe("finished");
    expect(t.state.winnerIds).toEqual(["p0", "p1"]);
  });

  it("still runs when the player who triggered it is removed", () => {
    const s = stateWith([1, 2, 3], { turn: 2, scores: [100, 5200, 900], finalRound: { triggerId: "p1", owed: ["p2", "p0"] } });
    const r = fk.onPlayerRemoved!(s, "p1", ctx());
    expect(r.state.finalRound).toEqual({ triggerId: "p1", owed: ["p2", "p0"] });
    expect(r.state.phase).toBe("playing");
    let t = ok(act(r.state, "p2", { type: "keep-and-bank", keep: [0] }, rig(5, 2, 3, 4, 6, 6)));
    expect(fk.getPublicState(t.state).currentPlayerId).toBe("p0");
    t = ok(act(t.state, "p0", { type: "keep-and-bank", keep: [0] }));
    expect(t.state.phase).toBe("finished");
    // p1 left, so the best of who's still here wins.
    expect(t.state.winnerIds).toEqual(["p2"]);
    expect(fk.getResult(t.state)!.standings.at(-1)).toEqual({ playerId: "p1", value: 5200, label: "left" });
  });

  it("stops waiting on an owed player who's removed", () => {
    const s = stateWith([1, 2, 3], { n: 4, turn: 2, scores: [0, 5200, 900, 0], finalRound: { triggerId: "p1", owed: ["p2", "p3", "p0"] } });
    const r = fk.onPlayerRemoved!(s, "p3", ctx());
    expect(r.state.finalRound!.owed).toEqual(["p2", "p0"]);
    const t = ok(act(r.state, "p2", { type: "keep-and-bank", keep: [0] }, rig(5, 2, 3, 4, 6, 6)));
    expect(fk.getPublicState(t.state).currentPlayerId).toBe("p0");
  });
});

describe("skip and removal", () => {
  it("skip keeps the best selection and banks it", () => {
    const s = stateWith([1, 1, 1, 5, 2, 3], { scores: [600] });
    const t = fk.skipTurn!(s, "p0", rig(2, 2, 3, 4, 6, 1));
    expect(types(t)).toEqual(["turn-skipped", "kept", "banked", "rolled"]);
    expect(t.state.players[0]!.score).toBe(600 + 1050);
    expect(fk.skipTurn!(s, "p1", ctx()).events).toEqual([]);
  });

  it("…or keeps it and rolls when that's not enough to get on the board", () => {
    const s = stateWith([5, 2, 3, 4, 6, 6]);
    const t = fk.skipTurn!(s, "p0", rig(1, 2, 3, 4, 6));
    expect(types(t)).toEqual(["turn-skipped", "kept", "rolled"]);
    expect(t.state.turnTotal).toBe(50);
    expect(fk.getPublicState(t.state).currentPlayerId).toBe("p0");
  });

  it("does nothing during a bust", () => {
    const s = { ...stateWith([2, 3, 4, 6, 2, 3]), step: "bust" as const };
    expect(fk.skipTurn!(s, "p0", ctx()).state).toBe(s);
  });

  it("a removed player on turn: the turn ends with nothing banked", () => {
    const s = stateWith([1, 2, 3], { turnTotal: 900, scores: [100, 0, 0] });
    const t = fk.onPlayerRemoved!(s, "p0", rig(5, 2, 3, 4, 6, 6));
    expect(types(t)).toEqual(["player-removed", "rolled"]);
    expect(t.state.players[0]!.score).toBe(100);
    expect(fk.getPublicState(t.state).currentPlayerId).toBe("p1");
    // Out of the rotation from now on: p1, p2, then p1 again.
    const free = { ...t.state, settings: { ...t.state.settings, entry: 0 } };
    const t2 = ok(act(free, "p1", { type: "keep-and-bank", keep: [0] }, rig(5, 2, 3, 4, 6, 6)));
    expect(fk.getPublicState(t2.state).currentPlayerId).toBe("p2");
    const t3 = ok(act(t2.state, "p2", { type: "keep-and-bank", keep: [0] }, rig(5, 2, 3, 4, 6, 6)));
    expect(fk.getPublicState(t3.state).currentPlayerId).toBe("p1");
  });

  it("removal during a bust cancels its timer and moves on", () => {
    const s = { ...stateWith([2, 3, 4, 6, 2, 3]), step: "bust" as const };
    const t = fk.onPlayerRemoved!(s, "p0", rig(5, 2, 3, 4, 6, 6));
    expect(t.timers).toContainEqual({ kind: "cancel", timerId: "bust" });
    expect(fk.getPublicState(t.state)).toMatchObject({ currentPlayerId: "p1", step: "rolled" });
  });

  it("ends with the last one standing", () => {
    const s = stateWith([1], { n: 2, scores: [0, 300] });
    const t = fk.onPlayerRemoved!(s, "p1", ctx());
    expect(t.state.phase).toBe("finished");
    expect(find(t, "game-over")).toEqual({ type: "game-over", winnerIds: ["p0"], reason: "abandoned" });
  });
});

describe("a whole game", () => {
  it("plays to the end with random dice and sane totals", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const c = ctx(seed);
      let s = fk.createGame(players(4), { ...DEFAULT_SETTINGS, entry: 0 }, { roundNumber: 1, dealerSeat: 0 }, c).state;
      for (let step = 0; step < 5000 && s.phase === "playing"; step++) {
        if (s.step === "bust") {
          s = fk.onTimer!(s, "bust", c).state;
          continue;
        }
        const pub = fk.getPublicState(s);
        const me = pub.currentPlayerId!;
        const before = s.players.reduce((a, p) => a + p.score, 0);
        const t = fk.skipTurn!(s, me, c);
        const kept = find(t, "kept")!;
        expect(kept.points).toBe(scoreDice(kept.dice));
        expect(t.state.players.reduce((a, p) => a + p.score, 0)).toBeGreaterThanOrEqual(before);
        s = t.state;
      }
      expect(s.phase).toBe("finished");
      expect(fk.getResult(s)!.winnerIds.length).toBeGreaterThan(0);
      expect(Math.max(...s.players.map((p) => p.score))).toBeGreaterThanOrEqual(5000);
    }
  });
});

describe("live picks", () => {
  it("relays the roller's picks for the current roll, and nothing else", () => {
    const s = stateWith([1, 5, 2, 3, 4, 6]);
    expect(fk.onStream!(s, "p0", { roll: 1, picked: [0, 1] })).toEqual({ state: s, relay: { roll: 1, picked: [0, 1] }, persist: false });
    expect(fk.onStream!(s, "p1", { roll: 1, picked: [0] })).toBeNull();
    expect(fk.onStream!(s, "p0", { roll: 0, picked: [0] })).toBeNull();
    expect(fk.onStream!(s, "p0", { roll: 1, picked: [9] })).toBeNull();
    expect(fk.onStream!(s, "p0", { roll: 1, picked: [0, 0] })).toBeNull();
  });
});
