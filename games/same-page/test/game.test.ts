import { seededRandomInt, type GameContext, type GameTransition } from "@games/game-core";
import { findLeaks } from "@games/game-core/testing";
import { describe, expect, it } from "vitest";
import { samePageGame as g } from "../server/game.ts";
import { PROMPT_POOL } from "../shared/pool.ts";
import {
  ALL_IN_MS,
  DEFAULT_SETTINGS,
  REVEAL_MS,
  type SamePageEvent,
  type SamePageServerState,
  type SamePageSettings,
  TIDY_MS,
} from "../shared/types.ts";

type S = SamePageServerState;
type T = GameTransition<S, SamePageEvent>;

const HOST = "p0";
const ctx = (now = 0, seed = 1, hostId: string | null = HOST): GameContext => ({ now, randomInt: seededRandomInt(seed), hostId });
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
const ids = (n: number) => players(n).map((p) => p.id);

/** Twenty prompts easy to spot in JSON. */
const DECK = Array.from({ length: 20 }, (_, i) => `prompt${i}`);

function start(n = 4, opts: { settings?: Partial<SamePageSettings>; deck?: string[] | null; seed?: number; carry?: unknown } = {}): T {
  return g.createGame(
    players(n),
    { ...DEFAULT_SETTINGS, ...opts.settings },
    { roundNumber: 1, dealerSeat: 0, carry: opts.carry },
    ctx(0, opts.seed ?? 1),
    opts.deck === null ? undefined : { deck: opts.deck ?? DECK },
  );
}

/** Half a second into the phase unless told. */
const at = (s: S) => s.deadline - s.phaseMs + 500;
const act = (s: S, playerId: string, action: unknown, now = at(s), host: string | null = HOST) =>
  g.handleAction(s, playerId, g.parseAction(action)!, ctx(now, 1, host));

function ok(result: ReturnType<typeof act>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.transition as T;
}

function err(result: ReturnType<typeof act>): string {
  if (result.ok) throw new Error("expected a rejection");
  return result.error.code;
}

const ring = (s: S, now = s.deadline) => g.onTimer!(s, "phase", ctx(now));
const score = (s: S, id: string) => s.players.find((p) => p.id === id)!.score;
const types = (t: { events: { event: { type: string } }[] }) => t.events.map((e) => e.event.type);

/** Everyone listed answers, then the answer clock runs out. */
function answerAll(s: S, answers: Record<string, string>): T {
  for (const [id, text] of Object.entries(answers)) s = ok(act(s, id, { type: "answer", text })).state;
  return ring(s);
}

describe("createGame", () => {
  it("opens round 1 with a prompt and the answer clock", () => {
    const { state: s, events, timers } = start();
    expect(s.phase).toBe("answering");
    expect(s.round.number).toBe(1);
    expect(DECK).toContain(s.round.prompt);
    expect(s.deadline).toBe(DEFAULT_SETTINGS.answerSeconds * 1000);
    expect(timers).toEqual([{ kind: "set", timerId: "phase", delayMs: 30_000 }]);
    expect(events.map((e) => e.event)).toEqual([{ type: "round", round: 1, prompt: s.round.prompt }]);
  });

  it("refuses too few or too many players", () => {
    expect(() => start(2)).toThrow();
    expect(() => start(13)).toThrow();
    expect(() => start(12)).not.toThrow();
  });

  it("draws from the real pool without a test deck", () => {
    const s = start(3, { deck: null }).state;
    expect(PROMPT_POOL.some((p) => p.text === s.round.prompt)).toBe(true);
  });

  it("parses settings", () => {
    expect(g.parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(g.parseSettings({ rounds: 8, answerSeconds: 45, lone: true })).toEqual({ rounds: 8, answerSeconds: 45, lone: true });
    expect(g.parseSettings({ rounds: 9 })).toBeNull();
    expect(g.parseSettings({ answerSeconds: 10 })).toBeNull();
    expect(g.parseSettings({ lone: "yes" })).toBeNull();
  });
});

describe("answering", () => {
  it("takes answers, lets them change until the timer ends, and refuses after", () => {
    let s = start().state;
    let t = ok(act(s, "p1", { type: "answer", text: "  pizza " }));
    s = t.state;
    expect(s.round.answers.p1).toBe("pizza");
    expect(types(t)).toEqual(["you-answered", "answered"]);
    t = ok(act(s, "p1", { type: "answer", text: "pasta" }));
    s = t.state;
    expect(s.round.answers.p1).toBe("pasta");
    // Changing an answer doesn't tell the room anything new.
    expect(types(t)).toEqual(["you-answered"]);
    expect(err(act(s, "p1", { type: "answer", text: "late" }, s.deadline))).toBe("time-up");
  });

  it("an empty answer takes yours back out", () => {
    let s = ok(act(start().state, "p1", { type: "answer", text: "pizza" })).state;
    const t = ok(act(s, "p1", { type: "answer", text: "   " }));
    s = t.state;
    expect(s.round.answers.p1).toBeUndefined();
    expect(t.events.at(-1)!.event).toEqual({ type: "answered", playerId: "p1", in: false });
  });

  it("caps answers at 40 characters", () => {
    const s = start().state;
    expect(err(act(s, "p1", { type: "answer", text: "x".repeat(41) }))).toBe("too-long");
    expect(ok(act(s, "p1", { type: "answer", text: "x".repeat(40) })).state.round.answers.p1).toHaveLength(40);
    expect(g.parseAction({ type: "answer", text: 5 })).toBeNull();
  });

  it("everyone in: the clock drops to 5 seconds, once", () => {
    let s = start(3).state;
    s = ok(act(s, "p0", { type: "answer", text: "a" }, 1000)).state;
    s = ok(act(s, "p1", { type: "answer", text: "b" }, 1000)).state;
    const t = ok(act(s, "p2", { type: "answer", text: "c" }, 2000));
    expect(t.state.deadline).toBe(2000 + ALL_IN_MS);
    expect(types(t)).toContain("hurry");
    // Still time to change your mind.
    expect(ok(act(t.state, "p2", { type: "answer", text: "d" }, 3000)).state.round.answers.p2).toBe("d");
  });

  it("an early or stray alarm doesn't end the round", () => {
    const s = start().state;
    const t = ring(s, 1000);
    expect(t.state).toBe(s);
    expect(t.timers).toEqual([{ kind: "set", timerId: "phase", delayMs: s.deadline - 1000 }]);
    expect(g.onTimer!(s, "other", ctx(s.deadline)).state).toBe(s);
  });
});

describe("hidden answers", () => {
  it("only you see your answer until tidying, then everyone does", () => {
    const all = ids(4);
    let s = start().state;
    const t = ok(act(s, "p1", { type: "answer", text: "zebracake" }));
    s = t.state;
    expect(findLeaks({ def: g, state: s, events: t.events, players: all, secret: "zebracake", allowed: ["p1"] })).toEqual([]);
    expect(g.getPrivateState(s, "p1").answer).toBe("zebracake");
    expect(g.getPublicState(s).players.find((p) => p.id === "p1")!.answered).toBe(true);
    expect(g.getPublicState(s).groups).toBeNull();

    s = ok(act(s, "p2", { type: "answer", text: "zebracake" })).state;
    s = ok(act(s, "p3", { type: "answer", text: "other" })).state;
    expect(findLeaks({ def: g, state: s, players: all, secret: "zebracake", allowed: ["p1", "p2"] })).toEqual([]);

    s = ring(s).state;
    expect(s.phase).toBe("tidying");
    expect(JSON.stringify(g.getPublicState(s))).toContain("zebracake");
  });
});

describe("tidying", () => {
  function toTidy(): S {
    const s = answerAll(start(4).state, { p0: "tv", p1: "telly", p2: "television", p3: "radio" }).state;
    expect(s.phase).toBe("tidying");
    expect(s.deadline - s.phaseMs + TIDY_MS).toBe(s.deadline);
    return s;
  }

  it("the host merges and splits; the groups show it to everyone", () => {
    let s = toTidy();
    s = ok(act(s, HOST, { type: "merge", from: "g-p1", into: "g-p0" })).state;
    s = ok(act(s, HOST, { type: "merge", from: "g-p2", into: "g-p0" })).state;
    const groups = g.getPublicState(s).groups!;
    expect(groups.map((x) => [x.id, x.members.length, x.merged])).toEqual([
      ["g-p0", 3, true],
      ["g-p3", 1, false],
    ]);
    s = ok(act(s, HOST, { type: "split", group: "g-p0" })).state;
    expect(g.getPublicState(s).groups).toHaveLength(4);
  });

  it("merge, split and done are host-only", () => {
    let s = toTidy();
    expect(err(act(s, "p1", { type: "merge", from: "g-p1", into: "g-p0" }))).toBe("host-only");
    s = ok(act(s, HOST, { type: "merge", from: "g-p1", into: "g-p0" })).state;
    expect(err(act(s, "p1", { type: "split", group: "g-p0" }))).toBe("host-only");
    expect(err(act(s, "p1", { type: "done" }))).toBe("host-only");
    // No host known at all: nobody can.
    expect(err(act(s, HOST, { type: "done" }, at(s), null))).toBe("host-only");
  });

  it("merge, split and done only work while tidying", () => {
    const s = start(4).state;
    expect(err(act(s, HOST, { type: "merge", from: "g-p1", into: "g-p0" }))).toBe("wrong-phase");
    expect(err(act(s, HOST, { type: "split", group: "g-p0" }))).toBe("wrong-phase");
    expect(err(act(s, HOST, { type: "done" }))).toBe("wrong-phase");
    const r = ok(act(toTidy(), HOST, { type: "done" })).state;
    expect(r.phase).toBe("reveal");
    expect(err(act(r, HOST, { type: "merge", from: "g-p1", into: "g-p0" }))).toBe("wrong-phase");
  });

  it("refuses bad merges and splits", () => {
    const s = toTidy();
    expect(err(act(s, HOST, { type: "merge", from: "g-p0", into: "g-p0" }))).toBe("bad-merge");
    expect(err(act(s, HOST, { type: "merge", from: "g-nope", into: "g-p0" }))).toBe("bad-merge");
    expect(err(act(s, HOST, { type: "split", group: "g-p0" }))).toBe("bad-split");
  });

  it("merges count for scoring", () => {
    let s = toTidy();
    s = ok(act(s, HOST, { type: "merge", from: "g-p1", into: "g-p0" })).state;
    s = ok(act(s, HOST, { type: "done" })).state;
    expect(s.round.result!.winners).toEqual(["g-p0"]);
    expect([score(s, "p0"), score(s, "p1"), score(s, "p2"), score(s, "p3")]).toEqual([1, 1, 0, 0]);
  });

  it("is skipped when there's only one group, or nothing, to tidy", () => {
    let s = answerAll(start(3).state, { p0: "cat", p1: "cats", p2: "The cat" }).state;
    expect(s.phase).toBe("reveal");
    expect([score(s, "p0"), score(s, "p1"), score(s, "p2")]).toEqual([1, 1, 1]);
    s = ring(start(3).state).state;
    expect(s.phase).toBe("reveal");
    expect(s.round.result!.blanks).toEqual(["p0", "p1", "p2"]);
  });

  it("isn't skipped when the one group is a typo merge the host might split", () => {
    let s = answerAll(start(3).state, { p0: "horse", p1: "house", p2: "horses" }).state;
    expect(s.phase).toBe("tidying");
    s = ok(act(s, HOST, { type: "split", group: "g-p0" })).state;
    s = ok(act(s, HOST, { type: "done" })).state;
    expect(s.round.result!.winners).toEqual(["g-p0"]);
    expect([score(s, "p0"), score(s, "p1"), score(s, "p2")]).toEqual([1, 0, 1]);
  });

  it("the timer runs out and the automatic groups stand", () => {
    const s = ring(toTidy()).state;
    expect(s.phase).toBe("reveal");
    expect(s.round.result!.winners).toEqual([]);
  });
});

/** Answers in, tidy-up (if any) left to run out: the reveal. */
const reveal = (s: S, answers: Record<string, string>): S => {
  const next = answerAll(s, answers).state;
  return next.phase === "tidying" ? ring(next).state : next;
};

describe("reveal and scoring", () => {
  it("biggest first, ties for biggest all score, blanks score nothing", () => {
    const s = answerAll(start(6).state, { p0: "red", p1: "blue", p2: "Red", p3: "blues", p4: "green" }).state;
    const t = ring(s);
    const r = t.state.round.result!;
    expect(r.groups.map((x) => x.label)).toEqual(["red", "blue", "green"]);
    expect(r.winners).toEqual(["g-p0", "g-p1"]);
    expect(r.blanks).toEqual(["p5"]);
    expect(t.state.players.map((p) => p.score)).toEqual([1, 1, 1, 1, 0, 0]);
    expect(g.getPublicState(t.state).result!.points).toEqual({ p0: 1, p1: 1, p2: 1, p3: 1, p4: 0, p5: 0 });
  });

  it("lone answer costs a point, never below zero", () => {
    let s = start(3, { settings: { lone: true } }).state;
    s = reveal(s, { p0: "a1", p1: "a1", p2: "zz" });
    expect(s.round.result!.loneId).toBe("p2");
    expect(score(s, "p2")).toBe(0);
    // Round two: p2 scores, then goes lone in round three.
    s = ring(s).state;
    s = reveal(s, { p0: "b1", p1: "b2", p2: "b1" });
    expect(score(s, "p2")).toBe(1);
    s = ring(s).state;
    s = reveal(s, { p0: "c1", p1: "c1", p2: "zz" });
    expect(score(s, "p2")).toBe(0);
    expect(s.round.result!.points.p2).toBe(-1);
  });

  it("everyone ready moves on early; the timer does otherwise", () => {
    let s = answerAll(start(3).state, { p0: "a" }).state;
    expect(s.phase).toBe("reveal");
    expect(s.phaseMs).toBe(REVEAL_MS);
    s = ok(act(s, "p0", { type: "ready" })).state;
    s = ok(act(s, "p1", { type: "ready" })).state;
    expect(s.phase).toBe("reveal");
    s = ok(act(s, "p2", { type: "ready" })).state;
    expect(s.phase).toBe("answering");
    expect(s.round.number).toBe(2);
  });

  it("ends after the last round, most points winning, ties sharing", () => {
    let s = start(3, { settings: { rounds: 8 } }).state;
    for (let i = 0; i < 8; i++) {
      s = answerAll(s, i < 4 ? { p0: "x", p1: "x" } : { p1: "y", p2: "y" }).state;
      s = ring(s).state;
    }
    expect(s.phase).toBe("over");
    const res = g.getResult(s)!;
    expect(res.winnerIds).toEqual(["p1"]);
    expect(res.standings.map((x) => [x.playerId, x.value])).toEqual([
      ["p1", 8],
      ["p0", 4],
      ["p2", 4],
    ]);
    expect(res.standings[0]!.label).toBe("8 points");
    expect(err(act(s, "p0", { type: "ready" }))).toBe("game-finished");
  });

  it("ties share the win", () => {
    let s = start(3, { settings: { rounds: 8 } }).state;
    for (let i = 0; i < 8; i++) s = ring(answerAll(s, { p0: "x", p1: "x" }).state).state;
    expect(g.getResult(s)!.winnerIds).toEqual(["p0", "p1"]);
  });
});

describe("prompts", () => {
  it("never repeats within a match", () => {
    let s = start(3, { settings: { rounds: 16 }, deck: DECK.slice(0, 16) }).state;
    const seen = [s.round.promptId];
    for (let i = 1; i < 16; i++) {
      s = ring(ring(s).state).state;
      seen.push(s.round.promptId);
    }
    expect(new Set(seen).size).toBe(16);
  });

  it("never repeats across a rematch carry while there are fresh ones", () => {
    for (let seed = 1; seed <= 5; seed++) {
      let s = start(3, { settings: { rounds: 8 }, deck: null, seed }).state;
      for (let i = 0; i < 8; i++) s = ring(ring(s).state).state;
      expect(s.phase).toBe("over");
      const carry = g.carryOver!(s);
      expect((carry as { used: string[] }).used).toHaveLength(8);
      let r = start(3, { settings: { rounds: 8 }, deck: null, seed, carry }).state;
      const again = [r.round.promptId];
      for (let i = 1; i < 8; i++) {
        r = ring(ring(r).state).state;
        again.push(r.round.promptId);
      }
      expect(again.filter((id) => s.used.includes(id))).toEqual([]);
    }
  });

  it("a carry that would leave too few fresh prompts starts over from this match", () => {
    const deck = DECK.slice(0, 20);
    let s = start(3, { settings: { rounds: 8 }, deck }).state;
    for (let i = 0; i < 8; i++) s = ring(ring(s).state).state;
    const carry = g.carryOver!(s) as { used: string[] };
    let r = start(3, { settings: { rounds: 8 }, deck, carry }).state;
    for (let i = 0; i < 8; i++) r = ring(ring(r).state).state;
    // 16 used of 20 leaves fewer than a full 16-round game: only the last match's count.
    expect((g.carryOver!(r) as { used: string[] }).used).toEqual(r.used);
    // But the second match itself still avoided the first.
    expect(r.used.filter((id) => carry.used.includes(id))).toEqual([]);
  });
});

describe("disconnects and removal", () => {
  it("a dropped player passes as blank, and nobody waits on them", () => {
    let s = start(3).state;
    expect(g.getAwaitedPlayerIds(s)).toEqual(["p0", "p1", "p2"]);
    s = g.onPlayerDisconnected!(s, "p2", ctx(1000)).state;
    s = ok(act(s, "p0", { type: "answer", text: "x" }, 1000)).state;
    const t = ok(act(s, "p1", { type: "answer", text: "x" }, 1000));
    expect(t.state.deadline).toBe(1000 + ALL_IN_MS);
    s = ring(t.state).state;
    expect(s.round.result!.blanks).toEqual(["p2"]);
  });

  it("back before the timer ends, they can still answer", () => {
    let s = start(3).state;
    s = g.onPlayerDisconnected!(s, "p2", ctx(1000)).state;
    s = g.onPlayerReconnected!(s, "p2", ctx(2000)).state;
    expect(ok(act(s, "p2", { type: "answer", text: "x" }, 3000)).state.round.answers.p2).toBe("x");
  });

  it("the host dropping mid-tidy just lets the timer run", () => {
    let s = answerAll(start(4).state, { p0: "a", p1: "b", p2: "a", p3: "c" }).state;
    expect(g.getAwaitedPlayerIds(s)).toEqual([HOST]);
    s = g.onPlayerDisconnected!(s, HOST, ctx(at(s))).state;
    expect(s.phase).toBe("tidying");
    expect(g.getAwaitedPlayerIds(s)).toEqual([]);
    s = ring(s).state;
    expect(s.phase).toBe("reveal");
    expect(s.round.result!.winners).toEqual(["g-p0"]);
  });

  it("removal while answering takes their answer out of the round", () => {
    let s = start(4).state;
    s = ok(act(s, "p3", { type: "answer", text: "x" })).state;
    s = g.onPlayerRemoved!(s, "p3", ctx(1000)).state;
    expect(s.round.answers.p3).toBeUndefined();
    expect(g.getPublicState(s).players.find((p) => p.id === "p3")!.removed).toBe(true);
  });

  it("removal while tidying rebuilds the groups and drops merges that lost a side", () => {
    let s = answerAll(start(4).state, { p0: "a", p1: "b", p2: "c", p3: "b" }).state;
    s = ok(act(s, HOST, { type: "merge", from: "g-p2", into: "g-p1" })).state;
    s = g.onPlayerRemoved!(s, "p1", ctx(at(s))).state;
    expect(s.round.groups.map((x) => [x.id, x.members])).toEqual([
      ["g-p0", ["p0"]],
      ["g-p2", ["p2"]],
      ["g-p3", ["p3"]],
    ]);
    expect(s.round.merges).toEqual([]);
  });

  it("removal at the reveal drops them from the groups and the scoreboard", () => {
    let s = answerAll(start(4).state, { p0: "a", p1: "a", p2: "a" }).state;
    s = g.onPlayerRemoved!(s, "p1", ctx(at(s))).state;
    const pubState = g.getPublicState(s);
    expect(pubState.result!.groups[0]!.members.map((m) => m.id)).toEqual(["p0", "p2"]);
    expect(pubState.result!.points.p1).toBeUndefined();
    expect(pubState.result!.blanks).toEqual(["p3"]);
  });

  it("under three players left ends it", () => {
    let s = start(3).state;
    const t = g.onPlayerRemoved!(s, "p2", ctx(1000));
    s = t.state;
    expect(s.phase).toBe("over");
    expect(s.endReason).toBe("abandoned");
    expect(types(t)).toContain("game-over");
  });

  it("a skip moves a stalled tidy-up or reveal along, and does nothing while answering", () => {
    let s = start(3).state;
    expect(g.skipTurn!(s, "p1", ctx(1000)).state.phase).toBe("answering");
    s = answerAll(s, { p0: "a", p1: "b" }).state;
    s = g.skipTurn!(s, HOST, ctx(at(s))).state;
    expect(s.phase).toBe("reveal");
    s = g.skipTurn!(s, "p0", ctx(at(s))).state;
    expect(s.round.ready).toEqual(["p0"]);
  });
});
