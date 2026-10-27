import { seededRandomInt, type GameContext, type GameTransition } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { faceOffGame as g } from "../server/game.ts";
import {
  CAP_MS,
  CONFIRM_MS,
  DEFAULT_SETTINGS,
  DUEL_MS,
  type FaceOffEvent,
  type FaceOffServerState,
  type FaceOffSettings,
  REDO_MS,
  SPARK_MAX_MS,
  SPARK_MIN_MS,
} from "../shared/types.ts";

type S = FaceOffServerState;
type T = GameTransition<S, FaceOffEvent>;

const ctx = (now = 0, seed = 1): GameContext => ({ now, randomInt: seededRandomInt(seed), hostId: "p0" });
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));

/** Twenty categories easy to spot in JSON. */
const DECK = Array.from({ length: 20 }, (_, i) => `category${i}`);

function start(n = 3, opts: { settings?: Partial<FaceOffSettings>; deck?: string[]; seed?: number; carry?: unknown } = {}): T {
  return g.createGame(
    players(n),
    { ...DEFAULT_SETTINGS, ...opts.settings },
    { roundNumber: 1, dealerSeat: 0, carry: opts.carry },
    ctx(0, opts.seed ?? 1),
    { deck: opts.deck ?? DECK },
  );
}

/** Through parseAction, the way the room sends it. In a timed phase, half a second in unless told. */
const act = (s: S, playerId: string, action: unknown, now = s.deadline ? s.deadline - s.phaseMs + 500 : 0) =>
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
const ring = (s: S, at = s.deadline, seed = 1) => g.onTimer!(s, "phase", ctx(at, seed));
const card = (s: S, id: string) => s.players.find((p) => p.id === id)!.card;
const score = (s: S, id: string) => s.players.find((p) => p.id === id)!.score;
const voters = (s: S) => s.players.filter((p) => !p.removed && p.id !== s.duel!.a && p.id !== s.duel!.b).map((p) => p.id);

/** Ring the lull: a duel's on. */
function toDuel(s: S, seed = 1): S {
  expect(s.phase).toBe("lull");
  s = ring(s, s.deadline, seed).state;
  expect(s.phase).toBe("duel");
  return s;
}

/** A duel, and `who` (a or b) buzzes. */
function toConfirm(s: S, who: "a" | "b" = "a"): S {
  s = toDuel(s);
  return ok(act(s, s.duel![who], { type: "buzz" })).state;
}

describe("createGame", () => {
  it("deals everyone a different card and waits 4 to 9 s for the first spark", () => {
    for (let n = 3; n <= 12; n++) {
      const t = start(n, { seed: n });
      const s = t.state;
      expect(s.phase).toBe("lull");
      expect(new Set(s.players.map((p) => p.card)).size).toBe(n);
      expect(s.players.every((p) => p.card >= 0)).toBe(true);
      expect(s.deadline).toBeGreaterThanOrEqual(SPARK_MIN_MS);
      expect(s.deadline).toBeLessThanOrEqual(SPARK_MAX_MS);
      expect(s.endsAt).toBe(CAP_MS);
      expect(t.timers).toContainEqual({ kind: "set", timerId: "cap", delayMs: CAP_MS });
      expect(g.getPublicState(s).players.every((p) => DECK.includes(p.category))).toBe(true);
    }
    expect(() => start(2)).toThrow(/3–12/);
    expect(() => start(13)).toThrow(/3–12/);
    expect(() => start(3, { deck: ["a", "b", "c", "d"] })).toThrow(/at least 5/);
    expect(() => start(3, { deck: ["a", "a", "b", "c", "d"] })).toThrow(/distinct/);
  });

  it("uses the real deck without a test one", () => {
    const s = g.createGame(players(4), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
    expect(g.getPublicState(s).players.every((p) => p.category.length > 0)).toBe(true);
  });

  it("takes its settings and actions, and turns away the rest", () => {
    expect(g.parseSettings({ target: 20 })).toEqual({ target: 20 });
    expect(g.parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(g.parseSettings({ target: 12 })).toBeNull();
    expect(g.parseAction({ type: "buzz" })).toEqual({ type: "buzz" });
    expect(g.parseAction({ type: "vote", choice: "overturn" })).toEqual({ type: "vote", choice: "overturn" });
    expect(g.parseAction({ type: "vote", choice: "maybe" })).toBeNull();
    expect(g.parseAction({ type: "steal" })).toBeNull();
  });
});

describe("the spark", () => {
  it("picks two connected players, and never the same two twice running when there's a choice", () => {
    let s = start(3).state;
    let last = "";
    for (let i = 0; i < 30; i++) {
      s = toDuel(s, i + 1);
      const pair = [s.duel!.a, s.duel!.b].sort().join();
      expect(s.duel!.a).not.toBe(s.duel!.b);
      expect(pair).not.toBe(last);
      last = pair;
      s = ring(s).state; // nobody buzzes
    }
  });

  it("leaves out whoever's dropped, and waits when fewer than two are here", () => {
    let s = start(4).state;
    s = g.onPlayerDisconnected!(s, "p1", ctx()).state;
    for (let i = 0; i < 10; i++) {
      s = toDuel(s, i + 1);
      expect([s.duel!.a, s.duel!.b]).not.toContain("p1");
      s = ring(s).state;
    }
    s = g.onPlayerDisconnected!(s, "p2", ctx()).state;
    s = g.onPlayerDisconnected!(s, "p3", ctx()).state;
    const t = ring(s);
    expect(t.state.phase).toBe("lull");
    expect(types(t)).toEqual([]);
  });

  it("is public: who, and which card each answers", () => {
    const t = ring(start(4).state);
    expect(types(t)).toEqual(["spark"]);
    const p = g.getPublicState(t.state);
    expect(p.phase).toBe("duel");
    expect(p.phaseMs).toBe(DUEL_MS);
    expect(p.duel).toMatchObject({ a: t.state.duel!.a, b: t.state.duel!.b, claimId: null, redone: false });
  });
});

describe("the duel", () => {
  it("the first duelist to buzz claims it; the other is too late; nobody else can", () => {
    let s = toDuel(start(4).state);
    const { a, b } = s.duel!;
    const other = voters(s)[0]!;
    expect(err(act(s, other, { type: "buzz" }))).toBe("not-dueling");
    const t = ok(act(s, b, { type: "buzz" }));
    expect(types(t)).toEqual(["buzzed"]);
    s = t.state;
    expect(s.phase).toBe("confirm");
    expect(s.duel!.claimId).toBe(b);
    expect(s.phaseMs).toBe(CONFIRM_MS);
    expect(err(act(s, a, { type: "buzz" }))).toBe("too-late");
  });

  it("shuts the door at the deadline, alarm or not", () => {
    const s = toDuel(start(3).state);
    expect(err(act(s, s.duel!.a, { type: "buzz" }, s.deadline))).toBe("time-up");
    expect(err(act(start(3).state, "p0", { type: "buzz" }))).toBe("wrong-phase");
  });

  it("no buzz in 8 s: nobody scores and both draw", () => {
    let s = toDuel(start(4).state);
    const { a, b } = s.duel!;
    const [ca, cb] = [card(s, a), card(s, b)];
    const t = ring(s);
    s = t.state;
    expect(types(t)).toEqual(["outcome"]);
    expect(s.phase).toBe("lull");
    expect(s.last).toMatchObject({ kind: "void", winnerId: null, drew: [a, b] });
    expect(card(s, a)).not.toBe(ca);
    expect(card(s, b)).not.toBe(cb);
    expect(s.players.every((p) => p.score === 0)).toBe(true);
    expect(new Set(s.players.map((p) => p.card)).size).toBe(4);
  });

  it("an early or duplicate alarm moves nothing", () => {
    const s = toDuel(start(3).state);
    const t = ring(s, s.deadline - 2000);
    expect(t.state).toBe(s);
    expect(t.timers).toEqual([{ kind: "set", timerId: "phase", delayMs: 2000 }]);
    expect(g.onTimer!(s, "nonsense", ctx(s.deadline)).state).toBe(s);
  });
});

describe("confirm", () => {
  it("only the table votes; a lone voter decides at once", () => {
    let s = toConfirm(start(3).state);
    const { a, b } = s.duel!;
    const [voter] = voters(s);
    expect(err(act(s, a, { type: "vote", choice: "confirm" }))).toBe("not-eligible");
    expect(g.getPrivateState(s, voter!)).toMatchObject({ canVote: true, canBuzz: false });
    expect(g.getPrivateState(s, a)).toMatchObject({ canVote: false, canRedo: true });
    const cb = card(s, b);
    s = ok(act(s, voter!, { type: "vote", choice: "confirm" })).state;
    expect(s.phase).toBe("lull");
    expect(score(s, a)).toBe(1);
    expect(score(s, b)).toBe(0);
    expect(card(s, b)).not.toBe(cb);
    expect(s.last).toMatchObject({ kind: "point", winnerId: a, loserId: b, confirm: 1, overturn: 0, drew: [b] });
  });

  it("an overturn hands the point to the other duelist, who keeps their card", () => {
    let s = toConfirm(start(3).state);
    const { a, b } = s.duel!;
    const [ca, cb] = [card(s, a), card(s, b)];
    s = ok(act(s, voters(s)[0]!, { type: "vote", choice: "overturn" })).state;
    expect(s.last).toMatchObject({ kind: "overturned", winnerId: b, loserId: a, drew: [a] });
    expect(score(s, b)).toBe(1);
    expect(card(s, a)).not.toBe(ca);
    expect(card(s, b)).toBe(cb);
  });

  it("needs more overturns than confirms; a split or silence stands", () => {
    let s = toConfirm(start(5).state);
    const [v1, v2] = voters(s);
    s = ok(act(s, v1!, { type: "vote", choice: "overturn" })).state;
    s = ok(act(s, v2!, { type: "vote", choice: "confirm" })).state;
    expect(s.phase).toBe("confirm");
    let t = ring(s);
    expect(t.state.last).toMatchObject({ kind: "point", confirm: 1, overturn: 1 });

    s = toConfirm(t.state);
    t = ring(s);
    expect(t.state.last).toMatchObject({ kind: "point", confirm: 0, overturn: 0, winnerId: s.duel!.a });

    s = toConfirm(t.state);
    const vs = voters(s);
    s = ok(act(s, vs[0]!, { type: "vote", choice: "overturn" })).state;
    s = ok(act(s, vs[1]!, { type: "vote", choice: "confirm" })).state;
    // A change of mind counts once.
    s = ok(act(s, vs[1]!, { type: "vote", choice: "overturn" })).state;
    expect(s.phase).toBe("confirm");
    s = ok(act(s, vs[2]!, { type: "vote", choice: "confirm" })).state;
    expect(s.phase).toBe("lull");
    expect(s.last).toMatchObject({ kind: "overturned", confirm: 1, overturn: 2 });
  });

  it("a dropped voter stops holding the vote open; nobody eligible means it stands", () => {
    let s = toConfirm(start(4).state);
    const [v1, v2] = voters(s);
    s = ok(act(s, v1!, { type: "vote", choice: "overturn" })).state;
    const t = g.onPlayerDisconnected!(s, v2!, ctx(s.deadline - 1000));
    expect(t.state.phase).toBe("lull");
    expect(t.state.last?.kind).toBe("overturned");

    // Three players, the only voter's gone: the buzz stands on the spot.
    s = toDuel(start(3).state);
    s = g.onPlayerDisconnected!(s, voters(s)[0]!, ctx()).state;
    const a = s.duel!.a;
    s = ok(act(s, a, { type: "buzz" })).state;
    expect(s.phase).toBe("lull");
    expect(s.last).toMatchObject({ kind: "point", winnerId: a });
  });
});

describe("secrets", () => {
  it("nobody sees how anyone voted until the duel's settled", () => {
    let s = toConfirm(start(5).state);
    const [v1, v2, v3] = voters(s);
    const t = ok(act(s, v1!, { type: "vote", choice: "overturn" }));
    expect(t.events).toEqual([]);
    s = t.state;
    expect(JSON.stringify(g.getPublicState(s))).not.toContain("overturn");
    expect(Object.keys(g.getPublicState(s).duel!).sort()).toEqual(["a", "b", "claimId", "redone", "voted", "voters"]);
    expect(g.getPublicState(s).duel).toMatchObject({ voted: 1, voters: 3 });
    expect(g.getPrivateState(s, v1!).myVote).toBe("overturn");
    for (const id of [v2!, v3!, s.duel!.a, s.duel!.b]) {
      expect(g.getPrivateState(s, id).myVote).toBeNull();
      expect(JSON.stringify(g.getPrivateState(s, id))).not.toContain("overturn");
    }
    s = ring(s).state;
    // Settled: the counts, never the names.
    expect(g.getPublicState(s).last).toMatchObject({ confirm: 0, overturn: 1 });
    expect(Object.keys(g.getPublicState(s).last!).sort()).toEqual(["a", "b", "confirm", "drew", "kind", "loserId", "overturn", "winnerId"]);
  });
});

describe("redo", () => {
  it("no score, the same two, sparked again 2 s later, and only once", () => {
    let s = toDuel(start(4).state);
    const { a, b } = s.duel!;
    const cards = s.players.map((p) => p.card);
    expect(err(act(s, voters(s)[0]!, { type: "redo" }))).toBe("not-dueling");
    const t = ok(act(s, b, { type: "redo" }));
    expect(types(t)).toEqual(["redo"]);
    s = t.state;
    expect(s.phase).toBe("lull");
    expect(s.phaseMs).toBe(REDO_MS);
    expect(g.getPublicState(s).queued).toEqual([a, b]);
    expect(s.players.map((p) => p.card)).toEqual(cards);
    s = ring(s).state;
    expect(s.duel).toMatchObject({ a, b, redone: true });
    expect(g.getPrivateState(s, a).canRedo).toBe(false);
    expect(err(act(s, a, { type: "redo" }))).toBe("redone");
  });

  it("works from confirm too, and voids the claim", () => {
    let s = toConfirm(start(4).state);
    const { a, b } = s.duel!;
    s = ok(act(s, voters(s)[0]!, { type: "vote", choice: "confirm" })).state;
    s = ok(act(s, a, { type: "redo" })).state;
    expect(s.phase).toBe("lull");
    expect(s.players.every((p) => p.score === 0)).toBe(true);
    s = ring(s).state;
    expect(s.duel).toMatchObject({ a, b, redone: true, claimId: null });
  });

  it("a redone pair with someone gone gets a fresh pick", () => {
    let s = toDuel(start(4).state);
    const { a } = s.duel!;
    s = ok(act(s, a, { type: "redo" })).state;
    s = g.onPlayerDisconnected!(s, a, ctx()).state;
    s = ring(s).state;
    expect(s.duel!.redone).toBe(false);
    expect([s.duel!.a, s.duel!.b]).not.toContain(a);
  });
});

describe("leaving", () => {
  it("a duelist leaving voids the duel; nobody scores or draws", () => {
    for (const phase of ["duel", "confirm"] as const) {
      let s = phase === "duel" ? toDuel(start(4).state) : toConfirm(start(4).state);
      const { a, b } = s.duel!;
      const cards = s.players.map((p) => p.card);
      const t = g.onPlayerRemoved!(s, b, ctx());
      s = t.state;
      expect(types(t)).toEqual(["outcome"]);
      expect(s.phase).toBe("lull");
      expect(s.last).toMatchObject({ kind: "left", a, b, winnerId: null, drew: [] });
      expect(s.players.map((p) => p.card)).toEqual(cards);
      expect(s.players.every((p) => p.score === 0)).toBe(true);
    }
  });

  it("a voter leaving drops their vote, and the rest can close it", () => {
    let s = toConfirm(start(5).state);
    const [v1, v2, v3] = voters(s);
    s = ok(act(s, v1!, { type: "vote", choice: "overturn" })).state;
    s = ok(act(s, v2!, { type: "vote", choice: "confirm" })).state;
    s = g.onPlayerRemoved!(s, v1!, ctx()).state;
    expect(s.phase).toBe("confirm");
    s = ok(act(s, v3!, { type: "vote", choice: "confirm" })).state;
    expect(s.last).toMatchObject({ kind: "point", confirm: 2, overturn: 0 });
  });

  it("under three players ends the game; the leader still wins", () => {
    let s = toConfirm(start(3).state);
    const a = s.duel!.a;
    s = ok(act(s, voters(s)[0]!, { type: "vote", choice: "confirm" })).state;
    const gone = s.players.find((p) => p.id !== a)!.id;
    const t = g.onPlayerRemoved!(s, gone, ctx());
    expect(t.state.phase).toBe("finished");
    expect(t.state.endReason).toBe("abandoned");
    expect(t.timers).toContainEqual({ kind: "cancel", timerId: "cap" });
    const res = g.getResult(t.state)!;
    expect(res.winnerIds).toEqual([a]);
    expect(res.standings.at(-1)).toMatchObject({ playerId: gone, label: "0 points, left" });
  });

  it("host skip voids a duel and drops a voter", () => {
    let s = toDuel(start(4).state);
    expect(g.getAwaitedPlayerIds(s).sort()).toEqual([s.duel!.a, s.duel!.b].sort());
    expect(g.skipTurn!(s, voters(s)[0]!, ctx()).state).toBe(s);
    let t = g.skipTurn!(s, s.duel!.a, ctx());
    expect(types(t)).toEqual(["skipped", "outcome"]);
    expect(t.state.last?.kind).toBe("void");

    s = toConfirm(t.state);
    const [v1, v2] = voters(s);
    s = ok(act(s, v1!, { type: "vote", choice: "overturn" })).state;
    expect(g.getAwaitedPlayerIds(s)).toEqual([v2]);
    t = g.skipTurn!(s, v2!, ctx());
    expect(t.state.last?.kind).toBe("overturned");
  });
});

describe("the end", () => {
  it("first to the target wins outright", () => {
    let s = start(3, { settings: { target: 10 } }).state;
    let guard = 0;
    while (s.phase !== "finished" && guard++ < 100) {
      s = toConfirm(s);
      // p0 always gets the point: they buzz, or the table hands it over.
      const claim = s.duel!.claimId!;
      const voter = voters(s)[0]!;
      const choice = claim === "p0" || voter === "p0" ? "confirm" : "overturn";
      s = voter === "p0" ? ring(s).state : ok(act(s, voter, { type: "vote", choice })).state;
    }
    expect(s.endReason).toBe("target");
    const res = g.getResult(s)!;
    expect(res.winnerIds).toHaveLength(1);
    expect(s.players.find((p) => p.id === res.winnerIds[0])!.score).toBe(10);
  });

  it("the cap ends a lull on the spot, and a live duel once it's settled", () => {
    let s = start(4).state;
    const early = g.onTimer!(s, "cap", ctx(CAP_MS - 5000));
    expect(early.state).toBe(s);
    expect(early.timers).toEqual([{ kind: "set", timerId: "cap", delayMs: 5000 }]);
    let t = g.onTimer!(s, "cap", ctx(CAP_MS));
    expect(t.state.endReason).toBe("time");
    expect(g.getResult(t.state)!.winnerIds).toEqual([]);

    s = toConfirm(s);
    const a = s.duel!.a;
    s = g.onTimer!(s, "cap", ctx(CAP_MS)).state;
    expect(s.phase).toBe("confirm");
    expect(s.capped).toBe(true);
    t = ring(s);
    expect(types(t)).toEqual(["outcome", "game-over"]);
    expect(g.getResult(t.state)!.winnerIds).toEqual([a]);

    // A redo after the cap doesn't buy another duel.
    s = toDuel(start(4).state);
    s = g.onTimer!(s, "cap", ctx(CAP_MS)).state;
    expect(ok(act(s, s.duel!.a, { type: "redo" })).state.endReason).toBe("time");
  });

  it("ties at the cap share the win", () => {
    let s = start(4).state;
    for (let i = 0; i < 2; i++) {
      s = toConfirm(s);
      s = ring(s).state;
    }
    const top = Math.max(...s.players.map((p) => p.score));
    s = g.onTimer!(s, "cap", ctx(CAP_MS)).state;
    const winners = g.getResult(s)!.winnerIds;
    expect(winners).toEqual(s.players.filter((p) => p.score === top).map((p) => p.id));
    expect(g.handleAction(s, "p0", { type: "buzz" }, ctx()).ok).toBe(false);
  });
});

describe("the deck over time", () => {
  it("reshuffles when it runs out, never doubling a card in hand", () => {
    let s = start(3, { deck: DECK.slice(0, 6) }).state;
    let reshuffled = false;
    for (let i = 0; i < 20; i++) {
      s = toDuel(s, i + 1);
      const t = ring(s);
      reshuffled ||= types(t).includes("reshuffled");
      s = t.state;
      expect(new Set(s.players.map((p) => p.card)).size).toBe(3);
    }
    expect(reshuffled).toBe(true);
    expect(g.getPublicState(s).reshuffled).toBe(true);
  });

  it("a rematch deals the categories the last match didn't use first", () => {
    let s = start(3).state;
    for (let i = 0; i < 3; i++) s = ring(toDuel(s, i + 1)).state;
    const carry = g.carryOver!(s) as { used: string[] };
    expect(carry.used.length).toBe(9);
    const next = start(3, { carry, seed: 5 }).state;
    for (const p of next.players) expect(carry.used).not.toContain(DECK[p.card]);
  });
});

describe("random games", () => {
  it("always finish, never get stuck, and never double a card", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rnd = seededRandomInt(seed * 7919);
      const n = 3 + rnd(10);
      let s = g.createGame(players(n), { target: 10 }, { roundNumber: 1, dealerSeat: 0 }, ctx(0, seed)).state;
      let now = 0;
      for (let step = 0; step < 5000 && s.phase !== "finished"; step++) {
        const live = s.players.filter((p) => !p.removed).map((p) => p.id);
        const who = live[rnd(live.length)]!;
        const roll = rnd(30);
        now = Math.max(now, s.deadline - 1000 + rnd(1500));
        let next: S | null = null;
        if (roll === 0 && rnd(4) === 0) next = g.onPlayerRemoved!(s, who, ctx(now, seed)).state;
        else if (roll === 1) next = g.onPlayerDisconnected!(s, who, ctx(now, seed)).state;
        else if (roll < 4) next = g.onPlayerReconnected!(s, who, ctx(now, seed)).state;
        else if (roll < 10) next = g.onTimer!(s, "phase", ctx(Math.max(now, s.deadline), seed + step)).state;
        else if (roll === 10 && now >= s.endsAt) next = g.onTimer!(s, "cap", ctx(now, seed)).state;
        else if (roll === 11 && g.getAwaitedPlayerIds(s).length) next = g.skipTurn!(s, g.getAwaitedPlayerIds(s)[0]!, ctx(now, seed)).state;
        else {
          const action = [{ type: "buzz" }, { type: "redo" }, { type: "vote", choice: rnd(2) ? "confirm" : "overturn" }][rnd(3)];
          const actor = s.duel && rnd(2) ? (rnd(2) ? s.duel.a : s.duel.b) : who;
          const r = g.handleAction(s, actor, g.parseAction(action)!, ctx(now, seed));
          if (r.ok) next = r.transition.state;
        }
        if (next) s = next;
        if (now > s.endsAt + 60_000 && s.phase !== "finished") s = g.onTimer!(s, "cap", ctx(now, seed)).state;
        const held = s.players.filter((p) => !p.removed).map((p) => p.card);
        expect(new Set(held).size).toBe(held.length);
        if (s.phase === "duel") expect(s.duel!.a).not.toBe(s.duel!.b);
      }
      expect(s.phase, `seed ${seed}`).toBe("finished");
      expect(g.getResult(s)).not.toBeNull();
    }
  });
});
