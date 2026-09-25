import { seededRandomInt, type GameContext, type GameTransition } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { passTheBombGame as pb } from "../server/game.ts";
import { PACKED } from "../server/dictionary.ts";
import { unpack } from "../server/words.ts";
import {
  BOOM_MS,
  DEFAULT_SETTINGS,
  FUSE_MS,
  type PassTheBombEvent,
  type PassTheBombServerState,
  type PassTheBombSettings,
  type TypingData,
} from "../shared/types.ts";

type T = GameTransition<PassTheBombServerState, PassTheBombEvent>;
type S = PassTheBombServerState;

const ctx = (now = 0, seed = 1): GameContext => ({ now, randomInt: seededRandomInt(seed) });
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));

/** One cluster, so every word below fits every turn. */
function start(n = 3, opts: { dealer?: number; settings?: Partial<PassTheBombSettings>; deck?: string[] } = {}): T {
  return pb.createGame(players(n), { ...DEFAULT_SETTINGS, ...opts.settings }, { roundNumber: 1, dealerSeat: opts.dealer ?? 0 }, ctx(), {
    deck: opts.deck ?? ["ing"],
  });
}

/** Through parseAction, the way the room sends it. */
const play = (s: S, playerId: string, text: string) => pb.handleAction(s, playerId, pb.parseAction({ type: "word", text })!, ctx());

function ok(result: ReturnType<typeof play>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.transition as T;
}

function err(result: ReturnType<typeof play>) {
  if (result.ok) throw new Error("expected a rejection");
  return result.error.code;
}

const types = (t: { events: { event: { type: string } }[] }) => t.events.map((e) => e.event.type);
const lives = (s: S, id: string) => s.players.find((p) => p.id === id)!.lives;
const fuse = (s: S) => pb.onTimer!(s, "fuse", ctx());

describe("createGame", () => {
  it("lights the bomb in the hands of the dealer's left, on a hidden fuse", () => {
    const t = start(4, { dealer: 2 });
    expect(t.state).toMatchObject({ phase: "live", round: 1, holderId: "p3", cluster: "ing" });
    expect(types(t)).toEqual(["round-started"]);
    const timer = t.timers!.find((x) => x.kind === "set")!;
    const [lo, hi] = FUSE_MS.normal;
    expect(timer.kind === "set" && timer.delayMs >= lo && timer.delayMs <= hi).toBe(true);
    // Nothing anyone's sent says how long it is.
    const everyone = JSON.stringify(pb.getPublicState(t.state)) + JSON.stringify(pb.getPrivateState(t.state, "p3"));
    expect(everyone).not.toContain(String(timer.kind === "set" && timer.delayMs));
    expect(pb.getAwaitedPlayerIds(t.state)).toEqual(["p3"]);
  });

  it("draws a different fuse each time, inside the chosen range", () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < 40; seed++) {
      const t = pb.createGame(players(2), { lives: 1, fuse: "short" }, { roundNumber: 1, dealerSeat: 0 }, ctx(0, seed));
      const timer = t.timers!.find((x) => x.kind === "set")!;
      if (timer.kind !== "set") throw new Error();
      expect(timer.delayMs).toBeGreaterThanOrEqual(FUSE_MS.short[0]);
      expect(timer.delayMs).toBeLessThanOrEqual(FUSE_MS.short[1]);
      seen.add(timer.delayMs);
    }
    expect(seen.size).toBeGreaterThan(30);
  });

  it("explains a bad cluster list", () => {
    expect(() => start(2, { deck: ["ING"] })).toThrow(/cluster list/);
  });
});

describe("words", () => {
  it("a real word with the cluster passes the bomb on, with new letters", () => {
    const s = start(3, { deck: ["ing", "tr"] }).state;
    const holder = s.holderId;
    const word = s.cluster === "ing" ? "singer" : "train";
    const t = ok(play(s, holder, ` ${word.toUpperCase()} `));
    expect(t.events.map((e) => e.event)).toEqual([{ type: "passed", from: holder, to: "p2", word }]);
    expect(t.state).toMatchObject({ holderId: "p2", turn: s.turn + 1, lastWord: { playerId: holder, word } });
    expect(t.state.cluster).not.toBe(s.cluster);
    // The fuse keeps burning.
    expect(t.timers).toEqual([]);
  });

  it("turns away non-words, missing clusters and repeats, and the bomb stays put", () => {
    let s = start(3).state;
    expect(err(play(s, "p1", "singz"))).toBe("not-a-word");
    expect(err(play(s, "p1", "train"))).toBe("bad-word");
    expect(err(play(s, "p1", "sing er"))).toBe("bad-word");
    expect(err(play(s, "p1", "paris"))).toBe("bad-word"); // no ING, and not a word anyway
    s = ok(play(s, "p1", "singer")).state;
    s = ok(play(s, "p2", "ring")).state;
    // Anyone's word counts as used, not just yours.
    expect(err(play(s, "p0", "singer"))).toBe("used");
    expect(s.holderId).toBe("p0");
  });

  it("is only the holder's to play", () => {
    const s = start(3).state;
    expect(err(play(s, "p0", "singer"))).toBe("not-holding");
    expect(pb.getPrivateState(s, "p1").holding).toBe(true);
    expect(pb.getPrivateState(s, "p0").holding).toBe(false);
  });
});

describe("the fuse", () => {
  it("going off costs the holder a life, and they start the next round", () => {
    let s = start(3).state;
    s = ok(play(s, "p1", "singer")).state; // p2 has it
    const t = fuse(s);
    expect(t.events.map((e) => e.event)).toEqual([{ type: "boom", playerId: "p2", lives: 1 }]);
    expect(t.state).toMatchObject({ phase: "boom", blownId: "p2" });
    expect([lives(t.state, "p0"), lives(t.state, "p1"), lives(t.state, "p2")]).toEqual([2, 2, 1]);
    expect(t.timers).toEqual([{ kind: "set", timerId: "fuse", delayMs: BOOM_MS }]);
    expect(err(play(t.state, "p2", "ring"))).toBe("not-live");
    expect(pb.getAwaitedPlayerIds(t.state)).toEqual([]);

    const next = fuse(t.state);
    expect(types(next)).toEqual(["round-started"]);
    expect(next.state).toMatchObject({ phase: "live", round: 2, holderId: "p2", blownId: null });
  });

  it("the last life knocks you out; the next round starts one along", () => {
    let s = start(3, { settings: { lives: 1 } }).state;
    s = fuse(s).state; // p1 out
    expect(s.outOrder).toEqual(["p1"]);
    expect(err(play(s, "p1", "ring"))).toBe("not-in-game");
    s = fuse(s).state;
    expect(s.holderId).toBe("p2");
    // Passing skips the dead.
    s = ok(play(s, "p2", "ring")).state;
    expect(s.holderId).toBe("p0");
    s = ok(play(s, "p0", "sing")).state;
    expect(s.holderId).toBe("p2");
  });

  it("down to one, that one wins; the results list who went when", () => {
    let s = start(4, { settings: { lives: 1 } }).state;
    s = fuse(s).state; // p1
    s = fuse(s).state;
    s = fuse(s).state; // p2
    s = fuse(s).state;
    const t = fuse(s); // p3
    expect(types(t)).toEqual(["boom", "game-over"]);
    expect(t.state.phase).toBe("finished");
    expect(t.timers).toContainEqual({ kind: "cancel", timerId: "fuse" });
    const result = pb.getResult(t.state)!;
    expect(result.winnerIds).toEqual(["p0"]);
    expect(result.loserIds).toBeUndefined();
    expect(result.standings.map((x) => [x.playerId, x.label])).toEqual([
      ["p0", "1 life left"],
      ["p3", "out 3rd"],
      ["p2", "out 2nd"],
      ["p1", "first out"],
    ]);
    expect(err(play(t.state, "p0", "ring"))).toBe("game-finished");
    // A stray timer after the end does nothing.
    expect(fuse(t.state).state).toBe(t.state);
  });
});

describe("leaving and presence", () => {
  it("walking out with the bomb passes it on, fuse still burning", () => {
    const s = start(3).state;
    const t = pb.onPlayerRemoved!(s, "p1", ctx());
    expect(t.events.map((e) => e.event)).toEqual([{ type: "left", playerId: "p1", to: "p2" }]);
    expect(t.state.holderId).toBe("p2");
    expect(t.timers).toEqual([]);
  });

  it("leaving down to one ends it, and the one left wins", () => {
    const t = pb.onPlayerRemoved!(start(2).state, "p0", ctx());
    expect(t.state.phase).toBe("finished");
    const result = pb.getResult(t.state)!;
    expect(result.winnerIds).toEqual(["p1"]);
    expect(result.standings.at(-1)).toMatchObject({ playerId: "p0", label: "left" });
  });

  it("someone who's out and then leaves keeps their place", () => {
    let s = start(3, { settings: { lives: 1 } }).state;
    s = fuse(s).state; // p1 out
    s = pb.onPlayerRemoved!(s, "p1", ctx()).state;
    expect(s.phase).toBe("boom");
    s = fuse(s).state;
    expect(s.holderId).toBe("p2");
  });

  it("the bomb goes past someone who's dropped, unless there's nobody else", () => {
    let s = start(4).state;
    s = pb.onPlayerDisconnected!(s, "p2", ctx()).state;
    s = ok(play(s, "p1", "singer")).state;
    expect(s.holderId).toBe("p3");
    s = pb.onPlayerDisconnected!(s, "p0", ctx()).state;
    s = pb.onPlayerDisconnected!(s, "p1", ctx()).state;
    s = ok(play(s, "p3", "ring")).state;
    expect(s.holderId).toBe("p0");
    s = pb.onPlayerReconnected!(s, "p2", ctx()).state;
    expect(s.players.find((p) => p.id === "p2")!.away).toBe(false);
  });

  it("a holder who drops keeps it; the host can skip them on", () => {
    let s = start(3).state;
    s = pb.onPlayerDisconnected!(s, "p1", ctx()).state;
    expect(s.holderId).toBe("p1");
    const t = pb.skipTurn!(s, "p1", ctx());
    expect(t.events.map((e) => e.event)).toEqual([{ type: "skipped", from: "p1", to: "p2" }]);
    expect(t.state.turn).toBe(s.turn + 1);
    // Skipping someone who isn't holding it is a no-op.
    expect(pb.skipTurn!(t.state, "p0", ctx()).events).toEqual([]);
  });
});

describe("the typing stream", () => {
  it("takes the holder's typing for this turn only", () => {
    const s = start(3).state;
    expect(pb.onStream!(s, "p0", { turn: s.turn, text: "sin" })).toBeNull(); // not holding
    expect(pb.onStream!(s, "p1", { turn: s.turn + 1, text: "sin" })).toBeNull(); // stale
    const out = pb.onStream!(s, "p1", { turn: s.turn, text: "Sin" })!;
    expect(out.relay).toEqual({ turn: s.turn, text: "sin" });
    expect(pb.getStreamSnapshot!(out.state)).toEqual({ turn: s.turn, text: "sin" } satisfies TypingData);
    expect(s.typing).toBe("");
    // A pass clears it.
    const passed = ok(play(out.state, "p1", "singer")).state;
    expect(pb.getStreamSnapshot!(passed)).toEqual({ turn: passed.turn, text: "" });
  });
});

describe("random games", () => {
  const WORDS = unpack(PACKED);

  it("always end, with one winner and everyone else out in order", () => {
    for (let seed = 0; seed < 60; seed++) {
      const rng = seededRandomInt(seed * 7 + 3);
      const n = 2 + rng(11);
      let s = pb.createGame(players(n), { lives: 1 + rng(3), fuse: "normal" }, { roundNumber: 1, dealerSeat: rng(n) }, ctx(0, seed)).state;
      let steps = 0;
      while (s.phase !== "finished") {
        if (++steps > 5000) throw new Error(`seed ${seed}: no end in sight`);
        const roll = rng(10);
        if (s.phase === "live" && roll < 6) {
          const word = WORDS.find((w) => w.includes(s.cluster) && !s.used.includes(w))!;
          s = ok(play(s, s.holderId, word)).state;
        } else if (s.phase === "live" && roll === 6) {
          s = pb.skipTurn!(s, s.holderId, ctx()).state;
        } else if (roll === 7 && rng(20) === 0) {
          const id = `p${rng(n)}`;
          s = pb.onPlayerRemoved!(s, id, ctx()).state;
        } else {
          s = fuse(s).state;
        }
        if (s.phase === "live") {
          const holder = s.players.find((p) => p.id === s.holderId)!;
          expect(holder.lives > 0 && !holder.removed).toBe(true);
        }
      }
      const result = pb.getResult(s)!;
      expect(result.winnerIds).toHaveLength(1);
      expect(result.standings).toHaveLength(n);
      expect(new Set([...s.outOrder, ...result.winnerIds]).size).toBe(s.outOrder.length + 1);
    }
  });
});
