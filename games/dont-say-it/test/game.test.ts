import { seededRandomInt, type GameContext, type GameTransition } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { CARDS } from "../server/cards.ts";
import { dontSayItGame as g } from "../server/game.ts";
import {
  DEFAULT_SETTINGS,
  DISPUTE_MS,
  type DontSayItEvent,
  type DontSayItServerState,
  type DontSayItSettings,
  other,
  RESULT_MS,
  type TeamId,
} from "../shared/types.ts";

type S = DontSayItServerState;
type T = GameTransition<S, DontSayItEvent>;

const HOST = "p0";
const ctx = (now = 0, seed = 1): GameContext => ({ now, randomInt: seededRandomInt(seed), hostId: HOST });
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));

/** Ten cards whose words are easy to spot in JSON. */
const DECK = Array.from({ length: 10 }, (_, i) => `target${i}: fa${i}, fb${i}, fc${i}, fd${i}, fe${i}`);

function start(n = 4, opts: { settings?: Partial<DontSayItSettings>; deck?: string[]; seed?: number; carry?: unknown } = {}): T {
  return g.createGame(
    players(n),
    { ...DEFAULT_SETTINGS, ...opts.settings },
    { roundNumber: 1, dealerSeat: 0, carry: opts.carry },
    ctx(0, opts.seed ?? 1),
    { deck: opts.deck ?? DECK },
  );
}

/** Through parseAction, the way the room sends it. In a timed phase, a second in unless told. */
const act = (s: S, playerId: string, action: unknown, now = s.deadline ? s.deadline - DISPUTE_MS + 1000 : 0) =>
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
const ring = (s: S, at = s.deadline) => g.onTimer!(s, "phase", ctx(at));
const team = (s: S, t: TeamId) => s.players.filter((p) => !p.removed && p.team === t).sort((a, b) => a.seat - b.seat).map((p) => p.id);
const desc = (s: S) => s.turn!.describerId;
const mates = (s: S) => team(s, s.turn!.team).filter((id) => id !== desc(s));
const rivals = (s: S) => team(s, other(s.turn!.team));
const target = (s: S) => g.getPrivateState(s, desc(s)).card!.target;

/** Host starts, describer taps go: a turn's running. */
function toTurn(s: S): S {
  s = ok(act(s, HOST, { type: "start" })).state;
  expect(s.phase).toBe("ready");
  s = ok(act(s, desc(s), { type: "go" })).state;
  expect(s.phase).toBe("turn");
  return s;
}

describe("createGame and the teams phase", () => {
  it("splits into two balanced teams and waits for the host", () => {
    for (let n = 4; n <= 12; n++) {
      const s = start(n, { seed: n }).state;
      expect(s.phase).toBe("teams");
      expect(Math.abs(team(s, 0).length - team(s, 1).length)).toBeLessThanOrEqual(1);
      expect(g.getPublicState(s).teams.map((t) => t.name)).toEqual(["Amber", "Teal"]);
    }
    expect(() => start(3)).toThrow(/4–12/);
    expect(() => start(4, { deck: ["nope"] })).toThrow(/target/);
  });

  it("takes its settings and turns away ones off the menu", () => {
    expect(g.parseSettings({ turnSeconds: 90, turnsPerTeam: 5 })).toEqual({ turnSeconds: 90, turnsPerTeam: 5 });
    expect(g.parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(g.parseSettings({ turnSeconds: 30 })).toBeNull();
    expect(g.parseSettings({ turnsPerTeam: 4 })).toBeNull();
    expect(g.parseAction({ type: "buzz" })).toEqual({ type: "buzz" });
    expect(g.parseAction({ type: "steal" })).toBeNull();
  });

  it("lets anyone switch while the sizes stay within one", () => {
    let s = start(5).state;
    const [big, small] = team(s, 0).length > team(s, 1).length ? [0, 1] as const : [1, 0] as const;
    expect(err(act(s, team(s, small)[0]!, { type: "switch" }))).toBe("uneven");
    const mover = team(s, big)[0]!;
    s = ok(act(s, mover, { type: "switch" })).state;
    expect(team(s, small)).toContain(mover);
    // 2 v 3 now: another off the 2 would make it 1 v 4.
    expect(err(act(s, team(s, big)[0]!, { type: "switch" }))).toBe("uneven");
  });

  it("only the host shuffles and starts; each side needs two", () => {
    let s = start(6).state;
    expect(err(act(s, "p1", { type: "shuffle" }))).toBe("host-only");
    expect(err(act(s, "p1", { type: "start" }))).toBe("host-only");
    const t = ok(act(s, HOST, { type: "shuffle" }));
    expect(types(t)).toEqual(["teams-changed"]);
    s = t.state;
    // Lopsided after leavers: 3 v 1 can't start, until someone crosses.
    const theirs = other(s.players[0]!.team);
    s = g.onPlayerRemoved!(s, team(s, theirs)[0]!, ctx()).state;
    s = g.onPlayerRemoved!(s, team(s, theirs)[0]!, ctx()).state;
    expect(team(s, theirs)).toHaveLength(1);
    expect(err(act(s, HOST, { type: "start" }))).toBe("short-team");
    s = ok(act(s, team(s, other(theirs)).at(-1)!, { type: "switch" })).state;
    expect(ok(act(s, HOST, { type: "start" })).state.phase).toBe("ready");
  });

  it("the first describer is the first of the opening team, and nobody has a card yet", () => {
    let s = start(4).state;
    s = ok(act(s, HOST, { type: "start" })).state;
    expect(desc(s)).toBe(team(s, s.firstTeam)[0]);
    expect(err(act(s, mates(s)[0]!, { type: "go" }))).toBe("not-yours");
    for (const id of ["p0", "p1", "p2", "p3"]) expect(g.getPrivateState(s, id).card).toBeNull();
  });
});

describe("secrets", () => {
  it("the card is the describer's and the other team's, never the guessers' or the public's", () => {
    let s = toTurn(start(8).state);
    const check = (st: S) => {
      const word = g.getPrivateState(st, desc(st)).card!;
      const words = [word.target, ...word.forbidden];
      expect(words).toHaveLength(6);
      const leaks = (json: string) => words.filter((w) => json.includes(`"${w}"`) || json.includes(w));
      expect(leaks(JSON.stringify(g.getPublicState(st)))).toEqual([]);
      for (const id of mates(st)) {
        expect(g.getPrivateState(st, id)).toMatchObject({ role: "guesser", card: null });
        expect(leaks(JSON.stringify(g.getPrivateState(st, id)))).toEqual([]);
      }
      for (const id of rivals(st)) expect(g.getPrivateState(st, id).card).toEqual(word);
    };
    check(s);
    // The resolved card goes public; the new one doesn't.
    const first = target(s);
    const t = ok(act(s, desc(s), { type: "got" }));
    expect(JSON.stringify(t.events)).toContain(first);
    expect(JSON.stringify(t.events)).not.toContain(target(t.state));
    s = t.state;
    check(s);
    expect(g.getPublicState(s).cards).toEqual([{ target: first, outcome: "got" }]);
    s = ok(act(s, rivals(s)[0]!, { type: "buzz" })).state;
    check(s);
    s = ok(act(s, desc(s), { type: "nope" })).state;
    check(s);
  });
});

describe("a turn", () => {
  it("got +1, skip 0, oops −1, each with a new card, and the floor holds at 0", () => {
    let s = toTurn(start(4).state);
    const tm = s.turn!.team;
    const seen = new Set([target(s)]);
    s = ok(act(s, desc(s), { type: "oops" })).state;
    expect(s.scores[tm]).toBe(0);
    expect(s.turn!.net).toBe(0);
    seen.add(target(s));
    s = ok(act(s, desc(s), { type: "got" })).state;
    seen.add(target(s));
    s = ok(act(s, desc(s), { type: "got" })).state;
    seen.add(target(s));
    s = ok(act(s, desc(s), { type: "skip" })).state;
    seen.add(target(s));
    s = ok(act(s, desc(s), { type: "oops" })).state;
    expect(s.scores[tm]).toBe(1);
    expect(s.turn!.net).toBe(1);
    expect(seen.size).toBe(5);
    expect(g.getPublicState(s).cards.map((c) => c.outcome)).toEqual(["oops", "got", "got", "skip", "oops"]);
  });

  it("only the describer marks cards, and only the other team buzzes", () => {
    const s = toTurn(start(4).state);
    expect(err(act(s, mates(s)[0]!, { type: "got" }))).toBe("not-yours");
    expect(err(act(s, rivals(s)[0]!, { type: "skip" }))).toBe("not-yours");
    expect(err(act(s, mates(s)[0]!, { type: "buzz" }))).toBe("own-team");
    expect(err(act(s, desc(s), { type: "buzz" }))).toBe("own-team");
    expect(g.getPrivateState(s, rivals(s)[0]!).canBuzz).toBe(true);
    expect(g.getPrivateState(s, mates(s)[0]!).canBuzz).toBe(false);
  });

  it("time's up at the deadline, even before the alarm; the card in hand is retired", () => {
    const s = toTurn(start(4).state);
    expect(err(act(s, desc(s), { type: "got" }, s.deadline))).toBe("time-up");
    const left = target(s);
    const t = ring(s);
    expect(types(t)).toEqual(["turn-over"]);
    expect(t.state.phase).toBe("turn-result");
    expect(g.getPublicState(t.state).cards).toEqual([{ target: left, outcome: "time" }]);
    expect(t.timers).toEqual([{ kind: "set", timerId: "phase", delayMs: RESULT_MS }]);
  });

  it("an early alarm re-arms instead of firing", () => {
    const s = toTurn(start(4).state);
    const t = ring(s, s.deadline - 5000);
    expect(t.state).toBe(s);
    expect(t.timers).toEqual([{ kind: "set", timerId: "phase", delayMs: 5000 }]);
  });

  it("no card comes back in a match, and a run through the deck says so", () => {
    let s = toTurn(start(4, { deck: DECK.slice(0, 3) }).state);
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      seen.push(target(s));
      s = ok(act(s, desc(s), { type: "skip" })).state;
    }
    expect(new Set(seen).size).toBe(3);
    expect(s.reshuffled).toBe(true);
    // The oldest comes back first, not the one just skipped.
    expect(target(s)).toBe(seen[0]);
  });

  it("after a run through the deck, the oldest half comes back first and the last card comes back last", () => {
    for (let seed = 1; seed <= 10; seed++) {
      let s = toTurn(start(4, { seed }).state);
      const seen: string[] = [];
      for (let i = 0; i < DECK.length; i++) {
        seen.push(target(s));
        s = ok(act(s, desc(s), { type: "skip" })).state;
      }
      expect(s.reshuffled).toBe(true);
      const again: string[] = [];
      for (let i = 0; i < DECK.length; i++) {
        again.push(target(s));
        s = ok(act(s, desc(s), { type: "skip" })).state;
      }
      expect(new Set(again).size).toBe(DECK.length);
      expect(again.at(-1)).toBe(seen.at(-1));
      expect(new Set(again.slice(0, 5))).toEqual(new Set(seen.slice(0, 5)));
    }
  });
});

describe("buzzing", () => {
  it("freezes the clock; Fair costs a point, takes a new card, and the clock resumes", () => {
    let s = toTurn(start(4).state);
    const tm = s.turn!.team;
    s = ok(act(s, desc(s), { type: "got" })).state;
    const card = target(s);
    const at = s.deadline - 40_000;
    const t = ok(act(s, rivals(s)[0]!, { type: "buzz" }, at));
    expect(types(t)).toEqual(["buzzed"]);
    s = t.state;
    expect(s.phase).toBe("buzzed");
    expect(s.turn!.turnLeft).toBe(40_000);
    expect(g.getPublicState(s).turnLeft).toBe(40_000);
    expect(t.timers).toEqual([{ kind: "set", timerId: "phase", delayMs: DISPUTE_MS }]);
    expect(err(act(s, desc(s), { type: "got" }, at + 100))).toBe("wrong-phase");
    expect(err(act(s, rivals(s)[1]!, { type: "buzz" }, at + 100))).toBe("wrong-phase");
    expect(g.getPrivateState(s, desc(s)).deciding).toBe(true);
    const f = ok(act(s, desc(s), { type: "fair" }, at + 5000));
    s = f.state;
    expect(s.phase).toBe("turn");
    expect(s.scores[tm]).toBe(0);
    expect(s.deadline).toBe(at + 5000 + 40_000);
    expect(f.timers).toContainEqual({ kind: "set", timerId: "phase", delayMs: 40_000 });
    expect(target(s)).not.toBe(card);
    expect(g.getPublicState(s).cards.at(-1)).toEqual({ target: card, outcome: "fair" });
  });

  it("Nope goes to the other team's captain: Uphold costs a point, Drop carries on with the same card", () => {
    let s = toTurn(start(6).state);
    const tm = s.turn!.team;
    s = ok(act(s, desc(s), { type: "got" })).state;
    s = ok(act(s, desc(s), { type: "got" })).state;
    const card = target(s);
    const at = s.deadline - 30_000;
    const buzzer = rivals(s).at(-1)!;
    s = ok(act(s, buzzer, { type: "buzz" }, at)).state;
    const t = ok(act(s, desc(s), { type: "nope" }, at + 1000));
    s = t.state;
    const captain = rivals(s)[0]!;
    expect(s.phase).toBe("appeal");
    expect(s.turn!.captainId).toBe(captain);
    expect(g.getPublicState(s).captainId).toBe(captain);
    expect(types(t)).toEqual(["appealed"]);
    expect(err(act(s, buzzer, { type: "uphold" }, at + 2000))).toBe("not-yours");
    expect(err(act(s, desc(s), { type: "drop" }, at + 2000))).toBe("not-yours");
    expect(g.getPrivateState(s, captain).deciding).toBe(true);

    const dropped = ok(act(s, captain, { type: "drop" }, at + 3000)).state;
    expect(dropped.phase).toBe("turn");
    expect(target(dropped)).toBe(card);
    expect(dropped.scores[tm]).toBe(2);
    expect(dropped.deadline).toBe(at + 3000 + 30_000);

    const upheld = ok(act(s, captain, { type: "uphold" }, at + 3000)).state;
    expect(upheld.phase).toBe("turn");
    expect(upheld.scores[tm]).toBe(1);
    expect(target(upheld)).not.toBe(card);
    expect(g.getPublicState(upheld).cards.at(-1)).toEqual({ target: card, outcome: "upheld" });
  });

  it("a silent describer escalates; a silent captain drops it", () => {
    let s = toTurn(start(4).state);
    const card = target(s);
    s = ok(act(s, rivals(s)[0]!, { type: "buzz" }, s.deadline - 20_000)).state;
    s = ring(s).state;
    expect(s.phase).toBe("appeal");
    const t = ring(s);
    expect(types(t)).toEqual(["dropped"]);
    expect(t.state.phase).toBe("turn");
    expect(t.state.deadline).toBe(s.deadline + 20_000);
    expect(target(t.state)).toBe(card);
  });
});

describe("turns", () => {
  /** Plays a turn out: `got` points, then the clock, then the summary. */
  function play(s: S, got: number): S {
    if (s.phase === "teams") s = ok(act(s, HOST, { type: "start" })).state;
    s = ok(act(s, desc(s), { type: "go" })).state;
    for (let i = 0; i < got; i++) s = ok(act(s, desc(s), { type: "got" })).state;
    s = ring(s).state;
    expect(s.phase).toBe("turn-result");
    return ring(s).state;
  }

  it("alternate teams and rotate describers; most points wins", () => {
    let s = start(6, { settings: { turnsPerTeam: 2 }, deck: CARDS.map((c) => `${c.target}: ${c.forbidden.join(", ")}`) }).state;
    const first = s.firstTeam;
    const describers: string[] = [];
    const teams: TeamId[] = [];
    s = ok(act(s, HOST, { type: "start" })).state;
    for (let i = 0; i < 4; i++) {
      describers.push(desc(s));
      teams.push(s.turn!.team);
      s = play(s, s.turn!.team === first ? 2 : 1);
    }
    expect(teams).toEqual([first, other(first), first, other(first)]);
    expect(describers[0]).toBe(team(s, first)[0]);
    expect(describers[2]).toBe(team(s, first)[1]);
    expect(describers[1]).toBe(team(s, other(first))[0]);
    expect(describers[3]).toBe(team(s, other(first))[1]);
    expect(s.phase).toBe("finished");
    expect(g.getResult(s)!.winnerIds.sort()).toEqual(team(s, first).sort());
    expect(g.getResult(s)!.standings[0]!.label).toMatch(/4 points/);
    expect(g.getResult(s)!.headline).toBe(`${first === 0 ? "Amber" : "Teal"} win, 4 to 2`);
  });

  it("the host can skip the summary; nobody else can", () => {
    let s = toTurn(start(4).state);
    s = ring(s).state;
    expect(err(act(s, "p1", { type: "next" }))).toBe("host-only");
    s = ok(act(s, HOST, { type: "next" })).state;
    expect(s.phase).toBe("ready");
    expect(s.turnIndex).toBe(2);
  });

  it("a tie gets one sudden-death turn each; still tied, both teams win", () => {
    let s = start(4, { settings: { turnsPerTeam: 2 } }).state;
    for (let i = 0; i < 4; i++) s = play(s, 1);
    expect(s.suddenDeath).toBe(true);
    expect(s.phase).toBe("ready");
    expect(s.turn!.team).toBe(s.firstTeam);
    expect(g.getPublicState(s).totalTurns).toBe(6);
    s = play(s, 0);
    s = play(s, 0);
    expect(s.phase).toBe("finished");
    expect(g.getResult(s)!.winnerIds.sort()).toEqual(["p0", "p1", "p2", "p3"]);
    expect(g.getResult(s)!.headline).toBe("The scores are equal, 2 each. Both teams win");
  });

  it("sudden death settles it if someone scores", () => {
    let s = start(4, { settings: { turnsPerTeam: 2 } }).state;
    for (let i = 0; i < 4; i++) s = play(s, 0);
    s = play(s, 0);
    s = play(s, 1);
    expect(s.phase).toBe("finished");
    expect(g.getResult(s)!.winnerIds.sort()).toEqual(team(s, other(s.firstTeam)).sort());
  });
});

describe("leaving and dropping", () => {
  it("the describer leaving mid-turn ends it, no penalty", () => {
    let s = toTurn(start(6).state);
    s = ok(act(s, desc(s), { type: "got" })).state;
    const tm = s.turn!.team;
    const t = g.onPlayerRemoved!(s, desc(s), ctx(s.deadline - 10_000));
    expect(types(t)).toEqual(["turn-over"]);
    expect(t.state.phase).toBe("turn-result");
    expect(t.state.scores[tm]).toBe(1);
    expect(g.getPublicState(t.state).cards.at(-1)!.outcome).toBe("ended");
  });

  it("the describer leaving mid-dispute ends the turn too", () => {
    let s = toTurn(start(6).state);
    s = ok(act(s, rivals(s)[0]!, { type: "buzz" })).state;
    s = ok(act(s, desc(s), { type: "nope" })).state;
    const t = g.onPlayerRemoved!(s, desc(s), ctx(s.deadline - 1000));
    expect(t.state.phase).toBe("turn-result");
    expect(t.state.turn!.captainId).toBeNull();
  });

  it("before the clock, a teammate takes the turn", () => {
    let s = start(6).state;
    s = ok(act(s, HOST, { type: "start" })).state;
    const gone = desc(s);
    const t = g.onPlayerRemoved!(s, gone, ctx());
    expect(t.state.phase).toBe("ready");
    expect(desc(t.state)).not.toBe(gone);
    expect(t.state.turn!.team).toBe(s.turn!.team);
  });

  it("a captain who leaves or drops hands the call to the next; nobody left, it's dropped", () => {
    let s = toTurn(start(8).state);
    s = ok(act(s, rivals(s)[0]!, { type: "buzz" })).state;
    s = ok(act(s, desc(s), { type: "nope" })).state;
    const [c1, c2, c3, c4] = rivals(s);
    s = g.onPlayerDisconnected!(s, c1!, ctx(s.deadline - 1000)).state;
    expect(s.turn!.captainId).toBe(c2);
    s = g.onPlayerRemoved!(s, c2!, ctx(s.deadline - 1000)).state;
    expect(s.turn!.captainId).toBe(c3);
    s = g.onPlayerDisconnected!(s, c4!, ctx(s.deadline - 1000)).state;
    const t = g.onPlayerDisconnected!(s, c3!, ctx(s.deadline - 1000));
    expect(types(t)).toEqual(["dropped"]);
    expect(t.state.phase).toBe("turn");
  });

  it("a dropped describer: a teammate takes over before the clock; mid-buzz it goes to the captain", () => {
    let s = start(6).state;
    s = ok(act(s, HOST, { type: "start" })).state;
    const gone = desc(s);
    s = g.onPlayerDisconnected!(s, gone, ctx()).state;
    expect(desc(s)).not.toBe(gone);
    s = ok(act(s, desc(s), { type: "go" })).state;
    s = ok(act(s, rivals(s)[0]!, { type: "buzz" })).state;
    s = g.onPlayerDisconnected!(s, desc(s), ctx(s.deadline - 1000)).state;
    expect(s.phase).toBe("appeal");
  });

  it("a buzz against a describer who's away goes straight to the captain", () => {
    let s = toTurn(start(4).state);
    s = g.onPlayerDisconnected!(s, desc(s), ctx(s.deadline - 30_000)).state;
    expect(s.phase).toBe("turn");
    s = ok(act(s, rivals(s)[0]!, { type: "buzz" })).state;
    expect(s.phase).toBe("appeal");
  });

  it("a team below two ends the game: the leader's players win, or nobody if level", () => {
    let s = toTurn(start(4).state);
    const tm = s.turn!.team;
    s = ok(act(s, desc(s), { type: "got" })).state;
    const lead = team(s, tm);
    const t = g.onPlayerRemoved!(s, rivals(s)[0]!, ctx(s.deadline - 1000));
    expect(types(t)).toEqual(["game-over"]);
    expect(t.state.endReason).toBe("abandoned");
    expect(g.getResult(t.state)!.winnerIds.sort()).toEqual(lead.sort());
    expect(g.getResult(t.state)!.headline).toMatch(/^(Amber|Teal) win, 1 to 0\. (Amber|Teal) didn't have enough players$/);
    expect(t.timers).toContainEqual({ kind: "cancel", timerId: "phase" });

    const level = g.onPlayerRemoved!(toTurn(start(4).state), "p1", ctx(1000)).state;
    expect(level.phase).toBe("finished");
    expect(g.getResult(level)!.winnerIds).toEqual([]);
  });

  it("in the teams phase, three left is the end", () => {
    const s = g.onPlayerRemoved!(start(4).state, "p3", ctx()).state;
    expect(s.phase).toBe("finished");
    expect(g.getResult(s)!.winnerIds).toEqual([]);
  });

  it("the host can skip whoever's awaited, and it never sticks", () => {
    let s = start(6).state;
    s = ok(act(s, HOST, { type: "start" })).state;
    const first = desc(s);
    expect(g.getAwaitedPlayerIds(s)).toEqual([first]);
    expect(g.skipTurn!(s, "nobody", ctx()).state).toBe(s);
    s = g.skipTurn!(s, first, ctx()).state;
    expect(desc(s)).not.toBe(first);
    s = ok(act(s, desc(s), { type: "go" })).state;
    s = ok(act(s, rivals(s)[0]!, { type: "buzz" })).state;
    s = g.skipTurn!(s, desc(s), ctx(s.deadline - 1000)).state;
    expect(s.phase).toBe("appeal");
    s = g.skipTurn!(s, s.turn!.captainId!, ctx(s.deadline - 1000)).state;
    expect(s.phase).toBe("turn");
    s = g.skipTurn!(s, desc(s), ctx(s.deadline - 1000)).state;
    expect(s.phase).toBe("turn-result");
    expect(g.getAwaitedPlayerIds(s)).toEqual([]);
  });

  it("dropped players can come back", () => {
    let s = toTurn(start(4).state);
    s = g.onPlayerDisconnected!(s, "p2", ctx(1000)).state;
    expect(s.players[2]!.away).toBe(true);
    s = g.onPlayerReconnected!(s, "p2", ctx(1000)).state;
    expect(s.players[2]!.away).toBe(false);
  });
});

describe("rematch", () => {
  it("keeps the teams and deals cards the last match didn't use first", () => {
    let s = toTurn(start(6, { deck: DECK }).state);
    for (let i = 0; i < 3; i++) s = ok(act(s, desc(s), { type: "got" })).state;
    s = g.onPlayerRemoved!(s, team(s, 0)[0]!, ctx(s.deadline - 1000)).state;
    s = g.onPlayerRemoved!(s, team(s, 0)[0]!, ctx(s.deadline - 1000)).state;
    expect(s.phase).toBe("finished");
    const carry = g.carryOver!(s) as { teams: [string[], string[]]; used: string[] };
    expect(carry.used).toHaveLength(4);
    expect(carry.teams[1]).toEqual(team(s, 1));
    const next = start(6, { deck: DECK, carry, seed: 5 }).state;
    for (const id of carry.teams[1]) expect(next.players.find((p) => p.id === id)!.team).toBe(1);
    const first = next.order.slice(0, 6).map((i) => `target${i}`);
    for (const id of carry.used) expect(first).not.toContain(id);
  });
});

describe("random games", () => {
  it("always finish, with scores that never go below zero", () => {
    const all = ["switch", "shuffle", "start", "go", "got", "skip", "oops", "buzz", "fair", "nope", "uphold", "drop", "next"];
    for (let seed = 1; seed <= 40; seed++) {
      const rnd = seededRandomInt(seed * 7919);
      const n = 4 + rnd(9);
      let s = g.createGame(players(n), { turnSeconds: 45, turnsPerTeam: 2 }, { roundNumber: 1, dealerSeat: 0 }, ctx(0, seed)).state;
      let now = 0;
      for (let step = 0; step < 3000 && s.phase !== "finished"; step++) {
        const live = s.players.filter((p) => !p.removed).map((p) => p.id);
        const who = live[rnd(live.length)]!;
        const roll = rnd(30);
        if (s.deadline) now = Math.max(now, s.deadline - 3000 + rnd(2500));
        let next: S | null = null;
        if (roll === 0 && live.length > 4) next = g.onPlayerRemoved!(s, who, ctx(now)).state;
        else if (roll === 1) next = g.onPlayerDisconnected!(s, who, ctx(now)).state;
        else if (roll === 2) next = g.onPlayerReconnected!(s, who, ctx(now)).state;
        else if (roll < 6 && s.deadline) next = g.onTimer!(s, "phase", ctx(s.deadline)).state;
        else if (roll < 8 && g.getAwaitedPlayerIds(s).length) next = g.skipTurn!(s, g.getAwaitedPlayerIds(s)[0]!, ctx(now)).state;
        else {
          const actor = rnd(3) === 0 ? who : (g.getAwaitedPlayerIds(s)[0] ?? (rnd(2) ? HOST : who));
          const r = g.handleAction(s, actor, g.parseAction({ type: all[rnd(all.length)] })!, { ...ctx(now, seed), hostId: live.includes(HOST) ? HOST : live[0] });
          if (r.ok) next = r.transition.state;
        }
        if (next) s = next;
        expect(s.scores.every((x) => x >= 0)).toBe(true);
        if (s.phase === "turn") expect(g.getPrivateState(s, desc(s)).card).not.toBeNull();
      }
      expect(s.phase, `seed ${seed}`).toBe("finished");
      const res = g.getResult(s)!;
      if (s.endReason === "done") expect(res.winnerIds.length).toBeGreaterThan(0);
    }
  });
});
