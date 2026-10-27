import { seededRandomInt, type GameContext, type GameTransition } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { imposterGame as g } from "../server/game.ts";
import { PACK } from "../server/words.ts";
import {
  CLUES_MS,
  DEFAULT_SETTINGS,
  GUESS_MS,
  type ImposterEvent,
  type ImposterServerState,
  type ImposterSettings,
  RESULT_MS,
  REVEAL_MS,
  ROLE_MS,
  VOTE_MS,
} from "../shared/types.ts";

type S = ImposterServerState;
type T = GameTransition<S, ImposterEvent>;

const HOST = "p0";
const ctx = (now = 0, seed = 1): GameContext => ({ now, randomInt: seededRandomInt(seed), hostId: HOST });
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));

function start(n = 4, opts: { settings?: Partial<ImposterSettings>; deck?: string[]; seed?: number } = {}): T {
  return g.createGame(players(n), { ...DEFAULT_SETTINGS, ...opts.settings }, { roundNumber: 1, dealerSeat: 0 }, ctx(0, opts.seed ?? 1), {
    deck: opts.deck ?? ["In the kitchen|kettle"],
  });
}

/** Through parseAction, the way the room sends it; just inside the deadline unless told. */
const act = (s: S, playerId: string, action: unknown, now = s.round.deadline - 1000) =>
  g.handleAction(s, playerId, g.parseAction(action)!, ctx(now));

function ok(result: ReturnType<typeof act>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.transition as T;
}

function err(result: ReturnType<typeof act>): string {
  if (result.ok) throw new Error("expected a rejection");
  return result.error.code;
}

const types = (t: { events: { event: { type: string } }[] }) => t.events.map((e) => e.event.type);
/** The phase's clock going off, on time. */
const ring = (s: S, seed = 1) => g.onTimer!(s, "phase", ctx(s.round.deadline, seed));
const imp = (s: S) => s.round.imposterId;
const innocents = (s: S) => s.players.filter((p) => !p.removed && p.id !== imp(s)).map((p) => p.id);
const ids = (s: S) => s.players.filter((p) => !p.removed).map((p) => p.id);
const score = (s: S, id: string) => s.players.find((p) => p.id === id)!.score;

/** Everyone acks. */
function toClues(s: S): S {
  for (const id of ids(s)) s = ok(act(s, id, { type: "ack" })).state;
  expect(s.round.phase).toBe("clues");
  return s;
}

/** Everyone clues: "hot water" for innocents, "shiny" for the Imposter. */
function toDiscuss(s: S): S {
  s = toClues(s);
  for (const id of ids(s)) s = ok(act(s, id, { type: "clue", text: id === imp(s) ? "shiny" : "hot water" })).state;
  expect(s.round.phase).toBe("discuss");
  return s;
}

function toVote(s: S): S {
  s = ok(act(toDiscuss(s), HOST, { type: "next" })).state;
  expect(s.round.phase).toBe("vote");
  return s;
}

/** Everyone votes for `target`; the target votes for `fallback`. */
function voteAll(s: S, target: string, fallback: string): T {
  let t: T = { state: s, events: [] };
  for (const id of ids(s)) t = ok(act(t.state, id, { type: "vote", playerId: id === target ? fallback : target }));
  return t;
}

describe("createGame", () => {
  it("deals one Imposter; everyone else gets the word", () => {
    const t = start(5);
    const s = t.state;
    expect(types(t)).toEqual(["round-started"]);
    expect(s.round).toMatchObject({ phase: "reveal", category: "In the kitchen", word: "kettle", deadline: REVEAL_MS });
    expect(t.timers).toEqual([{ kind: "set", timerId: "phase", delayMs: REVEAL_MS }]);
    const privs = ids(s).map((id) => g.getPrivateState(s, id));
    expect(privs.filter((p) => p.role === "imposter")).toHaveLength(1);
    for (const id of innocents(s)) expect(g.getPrivateState(s, id)).toMatchObject({ role: "innocent", word: "kettle" });
    expect(g.getPrivateState(s, imp(s))).toMatchObject({ role: "imposter", word: null });
    expect(g.getPublicState(s).category).toBe("In the kitchen");
    expect(new Set(s.round.order)).toEqual(new Set(ids(s)));
  });

  it("uses the real pack by default", () => {
    const s = g.createGame(players(3), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx(0, 9)).state;
    expect(PACK.find((c) => c.name === s.round.category)!.words).toContain(s.round.word);
  });

  it("takes its settings, turns away ones off the menu, and needs 3+", () => {
    expect(g.parseSettings({ rounds: 7, discussSeconds: 90 })).toEqual({ rounds: 7, discussSeconds: 90 });
    expect(g.parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(g.parseSettings({ rounds: 4 })).toBeNull();
    expect(g.parseSettings({ discussSeconds: 45 })).toBeNull();
    expect(() => start(2)).toThrow(/3–12/);
    expect(() => start(3, { deck: ["kettle"] })).toThrow(/category\|word/);
  });
});

describe("secrets", () => {
  it("keep the word out of public state and the Imposter's view until the round's over", () => {
    let s = start(4, { deck: ["In the kitchen|colander"] }).state;
    const leak = (st: S) => {
      expect(JSON.stringify(g.getPublicState(st))).not.toContain("colander");
      expect(JSON.stringify(g.getPrivateState(st, imp(st)))).not.toContain("colander");
      expect(JSON.stringify(g.getPublicState(st))).not.toMatch(/imposter"/);
      expect(g.getPublicState(st).imposterId).toBeNull();
    };
    leak(s);
    leak(toClues(s));
    leak(toDiscuss(s));
    s = toVote(s);
    leak(s);
    // Catch them: the role's out, the word still isn't.
    const t = voteAll(s, imp(s), innocents(s)[0]!);
    expect(types(t)).toContain("accused");
    expect(JSON.stringify(t.events)).not.toContain("colander");
    s = ring(t.state).state;
    expect(s.round.phase).toBe("guess");
    expect(JSON.stringify(g.getPublicState(s))).not.toContain("colander");
    expect(JSON.stringify(g.getPrivateState(s, imp(s)))).not.toContain("colander");
    s = ok(act(s, imp(s), { type: "guess", text: "sieve" })).state;
    expect(g.getPublicState(s)).toMatchObject({ word: "colander", imposterId: imp(s), guess: "sieve", winner: "innocents" });
  });

  it("don't show anyone else's role or clue in private state", () => {
    let s = toClues(start(4).state);
    const [a, b] = innocents(s);
    s = ok(act(s, a!, { type: "clue", text: "whistles" })).state;
    expect(JSON.stringify(g.getPrivateState(s, b!))).not.toContain("whistles");
    expect(JSON.stringify(g.getPrivateState(s, imp(s)))).not.toContain("whistles");
    expect(g.getPublicState(s).clues).toBeNull();
    expect(g.getPublicState(s).players.find((p) => p.id === a)!.done).toBe(true);
  });
});

describe("reveal", () => {
  it("moves on once everyone's acked", () => {
    const s = start(3).state;
    let t = ok(act(s, "p0", { type: "ack" }));
    t = ok(act(t.state, "p0", { type: "ack" }));
    expect(t.state.round.phase).toBe("reveal");
    expect(g.getAwaitedPlayerIds(t.state)).toEqual(["p1", "p2"]);
    t = ok(act(t.state, "p1", { type: "ack" }));
    t = ok(act(t.state, "p2", { type: "ack" }));
    expect(t.state.round).toMatchObject({ phase: "clues", phaseMs: CLUES_MS });
  });

  it("the clock acks for anyone slow", () => {
    const t = ring(start(3).state);
    expect(t.state.round.phase).toBe("clues");
  });

  it("an early alarm re-arms instead of firing", () => {
    const s = start(3).state;
    const t = g.onTimer!(s, "phase", ctx(1000));
    expect(t.state).toBe(s);
    expect(t.timers).toEqual([{ kind: "set", timerId: "phase", delayMs: REVEAL_MS - 1000 }]);
  });
});

describe("clues", () => {
  it("one each, cleaned and capped at 40", () => {
    let s = toClues(start(4).state);
    const a = innocents(s)[0]!;
    s = ok(act(s, a, { type: "clue", text: `  ${"x".repeat(60)}\n` })).state;
    expect(s.round.clues[a]).toBe("x".repeat(40));
    expect(err(act(s, a, { type: "clue", text: "again" }))).toBe("already");
    expect(err(act(s, innocents(s)[1]!, { type: "clue", text: "   " }))).toBe("bad-clue");
  });

  it("turn the word away from innocents, never from the Imposter", () => {
    const s = toClues(start(4).state);
    expect(err(act(s, innocents(s)[0]!, { type: "clue", text: "a Kettle!" }))).toBe("bad-clue");
    const t = ok(act(s, imp(s), { type: "clue", text: "kettle" }));
    expect(t.state.round.clues[imp(s)]).toBe("kettle");
  });

  it("stay hidden until all are in, then go up in the shuffled order", () => {
    let s = toClues(start(4).state);
    for (const id of ids(s)) {
      expect(g.getPublicState(s).clues).toBeNull();
      s = ok(act(s, id, { type: "clue", text: `clue ${id}` })).state;
    }
    const pub = g.getPublicState(s);
    expect(pub.phase).toBe("discuss");
    expect(pub.clues!.map((c) => c.playerId)).toEqual(s.round.order);
    expect(pub.clues!.find((c) => c.playerId === "p2")!.text).toBe("clue p2");
  });

  it("time up: missing clues are blanks", () => {
    let s = toClues(start(4).state);
    s = ok(act(s, "p1", { type: "clue", text: "hm" })).state;
    const t = ring(s);
    expect(types(t)).toEqual(["clues-in"]);
    expect(t.state.round.phase).toBe("discuss");
    expect(t.state.round.phaseMs).toBe(60_000);
    expect(g.getPublicState(t.state).clues!.find((c) => c.playerId === "p0")!.text).toBeNull();
  });
});

describe("deadlines", () => {
  it("close the door at the deadline, even before the alarm", () => {
    const s = toClues(start(4).state);
    expect(err(act(s, "p1", { type: "clue", text: "late" }, s.round.deadline))).toBe("time-up");
    expect(err(act(s, "p1", { type: "clue", text: "late" }, s.round.deadline + 300))).toBe("time-up");
    const v = toVote(start(4).state);
    expect(err(act(v, "p1", { type: "vote", playerId: "p2" }, v.round.deadline))).toBe("time-up");
  });
});

describe("discussion", () => {
  it("runs the host's length; the host can cut it short, nobody else", () => {
    const s = toDiscuss(start(4, { settings: { discussSeconds: 30 } }).state);
    expect(s.round.phaseMs).toBe(30_000);
    expect(err(act(s, "p1", { type: "next" }))).toBe("host-only");
    const t = ok(act(s, HOST, { type: "next" }));
    expect(t.state.round).toMatchObject({ phase: "vote", phaseMs: VOTE_MS, candidates: ids(s) });
    expect(ring(s).state.round.phase).toBe("vote");
  });
});

describe("voting", () => {
  it("no self-votes, nobody outside the list, re-votes overwrite", () => {
    const s = toVote(start(4).state);
    expect(err(act(s, "p1", { type: "vote", playerId: "p1" }))).toBe("self-vote");
    expect(err(act(s, "p1", { type: "vote", playerId: "p9" }))).toBe("bad-choice");
    let t = ok(act(s, "p1", { type: "vote", playerId: "p2" }));
    t = ok(act(t.state, "p1", { type: "vote", playerId: "p3" }));
    expect(t.state.round.ballot!.votes.p1).toBe("p3");
    expect(g.getPrivateState(t.state, "p1")).toMatchObject({ vote: "p3", choices: ["p0", "p2", "p3"] });
    expect(g.getPublicState(t.state).votes).toBeNull();
  });

  it("everyone in closes it early; the most votes is accused and their role shown", () => {
    const s = toVote(start(4).state);
    const target = innocents(s)[0]!;
    const t = voteAll(s, target, imp(s));
    expect(types(t)).toContain("accused");
    expect(t.state.round).toMatchObject({ phase: "reveal-role", accusedId: target, phaseMs: ROLE_MS });
    const pub = g.getPublicState(t.state);
    expect(pub).toMatchObject({ accusedId: target, accusedRole: "innocent", imposterId: null, word: null });
    expect(pub.counts![target]).toBe(3);
    // Wrong one: straight to the result, the Imposter scores.
    const r = ring(t.state);
    expect(r.state.round).toMatchObject({ phase: "round-result", winner: "imposter", phaseMs: RESULT_MS });
    expect(score(r.state, imp(s))).toBe(2);
    expect(innocents(s).every((id) => score(r.state, id) === 0)).toBe(true);
  });

  it("a tie runs a runoff between the leaders only", () => {
    let s = toVote(start(4).state);
    // p0,p1 → p2; p2,p3 → p1.
    for (const [v, c] of [["p0", "p2"], ["p1", "p2"], ["p2", "p1"], ["p3", "p1"]] as const) s = ok(act(s, v, { type: "vote", playerId: c })).state;
    expect(s.round).toMatchObject({ phase: "runoff", tied: ["p1", "p2"], candidates: ["p1", "p2"] });
    expect(g.getPrivateState(s, "p1").choices).toEqual(["p2"]);
    expect(g.getPrivateState(s, "p0").choices).toEqual(["p1", "p2"]);
    expect(err(act(s, "p0", { type: "vote", playerId: "p3" }))).toBe("bad-choice");
    s = ok(act(s, "p0", { type: "vote", playerId: "p1" })).state;
    const t = ring(s);
    expect(t.state.round.accusedId).toBe("p1");
  });

  it("a second tie is settled by the hash, the same way every time", () => {
    const tieTwice = (seed: number) => {
      let s = toVote(start(4, { seed }).state);
      for (const [v, c] of [["p0", "p2"], ["p1", "p2"], ["p2", "p1"], ["p3", "p1"]] as const) s = ok(act(s, v, { type: "vote", playerId: c })).state;
      for (const [v, c] of [["p0", "p2"], ["p1", "p2"], ["p2", "p1"], ["p3", "p1"]] as const) s = ok(act(s, v, { type: "vote", playerId: c })).state;
      return s.round;
    };
    const r = tieTwice(3);
    expect(r.phase).toBe("reveal-role");
    expect(["p1", "p2"]).toContain(r.accusedId);
    expect(tieTwice(3).accusedId).toBe(r.accusedId);
  });

  it("a runoff nobody votes in still accuses one of the tied", () => {
    let s = toVote(start(4).state);
    for (const [v, c] of [["p0", "p2"], ["p1", "p2"], ["p2", "p1"], ["p3", "p1"]] as const) s = ok(act(s, v, { type: "vote", playerId: c })).state;
    expect(["p1", "p2"]).toContain(ring(s).state.round.accusedId);
  });

  it("nobody votes: nobody's accused, and the Imposter scores", () => {
    const s = toVote(start(4).state);
    const t = ring(s);
    expect(types(t)).toEqual(["nobody-accused", "round-over"]);
    expect(t.state.round.winner).toBe("imposter");
    expect(score(t.state, imp(s))).toBe(2);
  });
});

describe("the last guess", () => {
  function caught(): S {
    const s = toVote(start(4).state);
    const t = ring(voteAll(s, imp(s), innocents(s)[0]!).state);
    expect(t.state.round).toMatchObject({ phase: "guess", phaseMs: GUESS_MS });
    return t.state;
  }

  it("is the Imposter's alone", () => {
    const s = caught();
    expect(g.getAwaitedPlayerIds(s)).toEqual([imp(s)]);
    expect(g.getPrivateState(s, imp(s)).guessing).toBe(true);
    expect(err(act(s, innocents(s)[0]!, { type: "guess", text: "kettle" }))).toBe("not-yours");
  });

  it("right steals the round", () => {
    const s = caught();
    const t = ok(act(s, imp(s), { type: "guess", text: "Kettles" }));
    expect(t.state.round).toMatchObject({ phase: "round-result", winner: "imposter", guessRight: true });
    expect(score(t.state, imp(s))).toBe(2);
  });

  it("wrong pays every innocent", () => {
    const s = caught();
    const t = ok(act(s, imp(s), { type: "guess", text: "teapot" }));
    expect(t.state.round.winner).toBe("innocents");
    expect(innocents(s).map((id) => score(t.state, id))).toEqual([2, 2, 2]);
    expect(score(t.state, imp(s))).toBe(0);
  });

  it("no guess in time is a miss", () => {
    const s = caught();
    const t = ring(s);
    expect(t.state.round).toMatchObject({ winner: "innocents", guess: null });
  });
});

describe("rounds", () => {
  /** A whole round where the Imposter's never caught. */
  function round(s: S, seed = 1): S {
    s = toVote(s);
    s = ring(s, seed).state; // nobody votes
    expect(s.round.phase).toBe("round-result");
    return ring(s, seed).state;
  }

  it("deals a new Imposter from those who've had it least, with a different word", () => {
    let s = start(3, { deck: ["A|one", "B|two", "C|three"] }).state;
    const seen = [imp(s)];
    const words = [s.round.word];
    s = round(s);
    seen.push(imp(s));
    words.push(s.round.word);
    s = round(s);
    seen.push(imp(s));
    words.push(s.round.word);
    expect(new Set(seen).size).toBe(3);
    expect(new Set(words).size).toBe(3);
    expect(s.roundNumber).toBe(3);
  });

  it("the host can skip the result wait", () => {
    const s = ring(toVote(start(3).state)).state;
    expect(s.round.phase).toBe("round-result");
    const t = ok(act(s, HOST, { type: "next" }));
    expect(t.state.roundNumber).toBe(2);
    expect(t.state.round.phase).toBe("reveal");
  });

  it("carry the words played into a rematch", () => {
    const deck = ["A|one", "B|two", "C|three", "D|four"];
    let s = start(3, { deck, settings: { rounds: 3 } }).state;
    const words = [s.round.word];
    for (let i = 0; i < 3; i++) {
      s = round(s);
      if (s.phase === "playing") words.push(s.round.word);
    }
    expect(s.phase).toBe("finished");
    const carry = g.carryOver!(s);
    const next = g.createGame(players(3), { ...DEFAULT_SETTINGS }, { roundNumber: 1, dealerSeat: 0, carry }, ctx(0), { deck });
    // Three of four played: the rematch opens on the one that wasn't.
    const left = ["one", "two", "three", "four"].filter((w) => !words.includes(w));
    expect(left).toHaveLength(1);
    expect(next.state.round.word).toBe(left[0]);
    // Junk in the carry is ignored, not trusted.
    for (const junk of [null, 7, { used: "one" }, { used: [1, 2] }]) {
      expect(() => g.createGame(players(3), { ...DEFAULT_SETTINGS }, { roundNumber: 1, dealerSeat: 0, carry: junk }, ctx(0), { deck })).not.toThrow();
    }
  });

  it("finishes after the last round's result; ties share", () => {
    let s = start(3, { settings: { rounds: 3 } }).state;
    for (let i = 0; i < 3; i++) s = round(s);
    expect(s.phase).toBe("finished");
    const res = g.getResult(s)!;
    // Each of the three was the Imposter once and got away: 2 each.
    expect(res.winnerIds.sort()).toEqual(["p0", "p1", "p2"]);
    expect(res.standings.map((x) => x.label)).toEqual(["2 points", "2 points", "2 points"]);
    expect(g.getPublicState(s).phase).toBe("finished");
    expect(g.getResult(start(3).state)).toBeNull();
  });
});

describe("leaving and dropping", () => {
  it("the Imposter leaving drops the round, shows nothing, deals again under the same number", () => {
    let s = toDiscuss(start(5, { deck: ["A|one", "B|two"] }).state);
    const gone = imp(s);
    const t = g.onPlayerRemoved!(s, gone, ctx(5000));
    expect(types(t)).toEqual(["round-dropped", "round-started"]);
    s = t.state;
    expect(imp(s)).not.toBe(gone);
    expect(s.roundNumber).toBe(1);
    expect(s.round.phase).toBe("reveal");
    expect(s.players.every((p) => p.score === 0)).toBe(true);
    expect(JSON.stringify(t.events)).not.toMatch(/one|two/);
    expect(g.getPublicState(s).clues).toBeNull();
  });

  it("the Imposter leaving once caught is a missed guess", () => {
    let s = toVote(start(4).state);
    s = ring(voteAll(s, imp(s), innocents(s)[0]!).state).state;
    const t = g.onPlayerRemoved!(s, imp(s), ctx(1000));
    expect(t.state.round.winner).toBe("innocents");
  });

  it("an innocent leaving mid-vote loses their vote, and votes for them go back", () => {
    let s = toVote(start(5).state);
    const [a, b] = innocents(s) as [string, string];
    s = ok(act(s, a, { type: "vote", playerId: b })).state;
    s = ok(act(s, b, { type: "vote", playerId: a })).state;
    s = g.onPlayerRemoved!(s, b, ctx(1000)).state;
    expect(s.round.ballot!.eligible).not.toContain(b);
    expect(s.round.ballot!.votes[a]).toBeUndefined();
    expect(s.round.candidates).not.toContain(b);
    expect(g.getAwaitedPlayerIds(s)).toContain(a);
  });

  it("a runoff down to one candidate accuses them", () => {
    let s = toVote(start(4).state);
    const [a, b, c] = innocents(s) as [string, string, string];
    for (const [v, x] of [[imp(s), a], [a, b], [b, a], [c, b]] as const) s = ok(act(s, v, { type: "vote", playerId: x })).state;
    expect(s.round).toMatchObject({ phase: "runoff", candidates: [a, b].sort() });
    const t = g.onPlayerRemoved!(s, b, ctx(1000));
    expect(t.state.round).toMatchObject({ phase: "reveal-role", accusedId: a });
  });

  it("a leaver can be the one everyone was waiting for", () => {
    let s = toClues(start(4).state);
    const b = innocents(s)[1]!;
    for (const id of ids(s)) if (id !== b) s = ok(act(s, id, { type: "clue", text: id === imp(s) ? "x" : "steam" })).state;
    expect(s.round.phase).toBe("clues");
    s = g.onPlayerRemoved!(s, b, ctx(1000)).state;
    expect(s.round.phase).toBe("discuss");
  });

  it("below three, the game ends with no winner", () => {
    const s = toClues(start(3).state);
    const t = g.onPlayerRemoved!(s, innocents(s)[0]!, ctx(1000));
    expect(t.state.phase).toBe("finished");
    expect(types(t)).toEqual(["game-over"]);
    expect(g.getResult(t.state)!.winnerIds).toEqual([]);
  });

  it("ending mid-round lets the secret out, and nothing else of the round", () => {
    const s = toClues(start(3).state);
    const t = g.onPlayerRemoved!(s, innocents(s)[0]!, ctx(1000));
    expect(g.getPublicState(t.state)).toMatchObject({ phase: "finished", imposterId: imp(s), word: "kettle", winner: null, guess: null });
    expect(g.getPrivateState(t.state, imp(s)).word).toBe("kettle");
  });

  it("dropped players don't hold a phase up, and can come back", () => {
    let s = start(4).state;
    s = g.onPlayerDisconnected!(s, "p3", ctx(100)).state;
    for (const id of ["p0", "p1", "p2"]) s = ok(act(s, id, { type: "ack" })).state;
    expect(s.round.phase).toBe("clues");
    s = g.onPlayerReconnected!(s, "p3", ctx(200)).state;
    expect(s.players.find((p) => p.id === "p3")!.away).toBe(false);
    // The last one here dropping finishes the phase too.
    for (const id of ["p0", "p1", "p2"]) s = ok(act(s, id, { type: "clue", text: id === imp(s) ? "x" : "steam" })).state;
    if (imp(s) === "p3") return;
    const t = g.onPlayerDisconnected!(s, "p3", ctx(300));
    expect(t.state.round.phase).toBe("discuss");
  });

  it("the host can skip whoever's awaited", () => {
    let s = toClues(start(4).state);
    const slow = innocents(s)[2]!;
    for (const id of ids(s)) if (id !== slow) s = ok(act(s, id, { type: "clue", text: id === imp(s) ? "x" : "steam" })).state;
    expect(g.skipTurn!(s, innocents(s)[0]!, ctx(1000)).events).toEqual([]);
    const t = g.skipTurn!(s, slow, ctx(1000));
    expect(types(t)).toEqual(["skipped", "clues-in"]);
    expect(g.getPublicState(t.state).clues!.find((c) => c.playerId === slow)!.text).toBeNull();
    // A skipped voter drops off the ballot.
    let v = toVote(start(4).state);
    for (const id of ids(v)) if (id !== slow) v = ok(act(v, id, { type: "vote", playerId: id === imp(v) ? innocents(v)[0]! : imp(v) })).state;
    const w = g.skipTurn!(v, slow, ctx(1000));
    expect(w.state.round.accusedId).toBe(imp(v));
  });
});

describe("random games", () => {
  it("always finish, with sane scores", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rnd = seededRandomInt(seed * 7919);
      const n = 3 + rnd(10);
      let s = g.createGame(players(n), { rounds: 3, discussSeconds: 30 }, { roundNumber: 1, dealerSeat: 0 }, ctx(0, seed)).state;
      let now = 0;
      for (let step = 0; step < 500 && s.phase !== "finished"; step++) {
        const live = ids(s);
        const who = live[rnd(live.length)]!;
        const roll = rnd(20);
        now = Math.max(now, s.round.deadline - 2000 + rnd(1500));
        let next: S | null = null;
        if (roll === 0 && live.length > 3) next = g.onPlayerRemoved!(s, who, ctx(now)).state;
        else if (roll < 3) next = g.onTimer!(s, "phase", ctx(s.round.deadline)).state;
        else {
          const phase = s.round.phase;
          const action =
            phase === "reveal" ? { type: "ack" }
            : phase === "clues" ? { type: "clue", text: `c${rnd(99)}` }
            : voting(phase) ? { type: "vote", playerId: live[rnd(live.length)] }
            : phase === "guess" ? { type: "guess", text: rnd(2) ? s.round.word : "nope" }
            : { type: "next" };
          const r = g.handleAction(s, phase === "guess" ? imp(s) : action.type === "next" ? HOST : who, g.parseAction(action)!, { ...ctx(now, seed), hostId: live[0] });
          if (r.ok) next = r.transition.state;
        }
        if (next) s = next;
        // Until the reveal, an Imposter who's gone means a fresh round.
        if (s.phase === "playing" && ["reveal", "clues", "discuss", "vote", "runoff"].includes(s.round.phase)) {
          expect(ids(s)).toContain(s.round.imposterId);
        }
      }
      expect(s.phase, `seed ${seed}`).toBe("finished");
      const res = g.getResult(s)!;
      if (s.endReason === "done") expect(res.winnerIds.length).toBeGreaterThan(0);
      expect(s.players.every((p) => p.score % 2 === 0)).toBe(true);
    }
  });
});

function voting(phase: string) {
  return phase === "vote" || phase === "runoff";
}
