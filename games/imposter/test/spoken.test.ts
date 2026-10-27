import { seededRandomInt, type GameContext, type GameTransition } from "@games/game-core";
import { findLeaks } from "@games/game-core/testing";
import { describe, expect, it } from "vitest";
import { imposterGame as g } from "../server/game.ts";
import { PLACES, placeById } from "../shared/places.ts";
import { imposterSettingFields } from "../shared/rules-text.ts";
import {
  DEFAULT_SETTINGS,
  type ImposterEvent,
  type ImposterServerState,
  type ImposterSettings,
  PLACE_GUESS_MS,
  RESULT_MS,
  ROLE_MS,
  VOTE_MS,
} from "../shared/types.ts";

type S = ImposterServerState;
type T = GameTransition<S, ImposterEvent>;

const HOST = "p0";
const SPOKEN: ImposterSettings = { ...DEFAULT_SETTINGS, mode: "spoken" };
const ctx = (now = 0, seed = 1): GameContext => ({ now, randomInt: seededRandomInt(seed), hostId: HOST });
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));

function start(n = 4, opts: { settings?: Partial<ImposterSettings>; deck?: string[]; seed?: number } = {}): T {
  return g.createGame(players(n), { ...SPOKEN, ...opts.settings }, { roundNumber: 1, dealerSeat: 0 }, ctx(0, opts.seed ?? 1), {
    deck: opts.deck ?? ["lighthouse"],
  });
}

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
const ring = (s: S, seed = 1) => g.onTimer!(s, "phase", ctx(s.round.deadline, seed));
const imp = (s: S) => s.round.imposterId;
const innocents = (s: S) => s.players.filter((p) => !p.removed && p.id !== imp(s)).map((p) => p.id);
const ids = (s: S) => s.players.filter((p) => !p.removed).map((p) => p.id);
const score = (s: S, id: string) => s.players.find((p) => p.id === id)!.score;

function toTalk(s: S): S {
  for (const id of ids(s)) s = ok(act(s, id, { type: "ack" })).state;
  expect(s.round.phase).toBe("talk");
  return s;
}

function toVote(s: S): S {
  s = ok(act(toTalk(s), HOST, { type: "next" })).state;
  expect(s.round.phase).toBe("vote");
  return s;
}

function voteAll(s: S, target: string, fallback: string): T {
  let t: T = { state: s, events: [] };
  for (const id of ids(s)) t = ok(act(t.state, id, { type: "vote", playerId: id === target ? fallback : target }));
  return t;
}

function caught(s: S): S {
  s = toVote(s);
  s = ring(voteAll(s, imp(s), innocents(s)[0]!).state).state;
  expect(s.round).toMatchObject({ phase: "guess", phaseMs: PLACE_GUESS_MS, early: false });
  return s;
}

function called(s: S): T {
  s = toTalk(s);
  return ok(act(s, imp(s), { type: "call" }));
}

describe("the place pack", () => {
  it("has 35+ places, ids and names unique and tidy", () => {
    expect(PLACES.length).toBeGreaterThanOrEqual(35);
    expect(new Set(PLACES.map((p) => p.id)).size).toBe(PLACES.length);
    expect(new Set(PLACES.map((p) => p.name.toLowerCase())).size).toBe(PLACES.length);
    for (const p of PLACES) {
      expect(p.id, p.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(p.name.length, p.name).toBeLessThanOrEqual(30);
      expect(p.name, p.name).toBe(p.name.trim());
      expect(placeById(p.id)).toBe(p);
    }
  });
});

describe("settings", () => {
  it("default to clues; spoken takes 4, 6 or 8 minutes of talk", () => {
    expect(g.parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(g.parseSettings({ mode: "spoken" })).toEqual({ ...DEFAULT_SETTINGS, mode: "spoken" });
    expect(g.parseSettings({ mode: "spoken", talkMinutes: 8 })).toMatchObject({ mode: "spoken", talkMinutes: 8 });
    expect(g.parseSettings({ mode: "clues" })).toEqual({ ...DEFAULT_SETTINGS, mode: "clues" });
    expect(g.parseSettings({ mode: "mime" })).toBeNull();
    expect(g.parseSettings({ mode: "spoken", talkMinutes: 5 })).toBeNull();
  });

  it("lobby: the mode first, then rounds, then talking time for the mode", () => {
    const clues = imposterSettingFields(null);
    expect(clues.map((f) => f.key)).toEqual(["mode", "rounds", "discussSeconds"]);
    expect(clues[0]!.selected).toBe(0);
    const spoken = imposterSettingFields({ mode: "spoken", talkMinutes: 8 });
    expect(spoken.map((f) => f.key)).toEqual(["mode", "rounds", "talkMinutes"]);
    expect(spoken[2]!.options.map((o) => o.label)).toEqual(["4 min", "6 min", "8 min"]);
    expect(spoken[2]!.selected).toBe(2);
    expect(spoken[0]!.selected).toBe(1);
    expect(imposterSettingFields({ mode: "spoken" })[2]!.selected).toBe(1);
  });
});

describe("the deal", () => {
  it("gives innocents the place, the Imposter nothing, and the table no category", () => {
    const t = start(5);
    const s = t.state;
    expect(types(t)).toEqual(["round-started"]);
    expect(s.round).toMatchObject({ phase: "reveal", placeId: "lighthouse", word: "Lighthouse", category: "" });
    for (const id of innocents(s)) expect(g.getPrivateState(s, id)).toMatchObject({ role: "innocent", word: "Lighthouse" });
    expect(g.getPrivateState(s, imp(s))).toMatchObject({ role: "imposter", word: null });
    expect(g.getPublicState(s)).toMatchObject({ mode: "spoken", category: "", firstAsker: null, clues: null });
  });

  it("uses the real pack by default, and turns away a test deck it doesn't know", () => {
    const s = g.createGame(players(3), SPOKEN, { roundNumber: 1, dealerSeat: 0 }, ctx(0, 9)).state;
    expect(placeById(s.round.placeId)!.name).toBe(s.round.word);
    expect(() => start(3, { deck: ["moon-base"] })).toThrow(/place/);
  });
});

describe("talk", () => {
  it("follows the reveal, runs the host's minutes, names a first asker", () => {
    const s = toTalk(start(4, { settings: { talkMinutes: 4 } }).state);
    expect(s.round.phaseMs).toBe(4 * 60_000);
    const pub = g.getPublicState(s);
    expect(ids(s)).toContain(pub.firstAsker);
    expect(pub.clues).toBeNull();
    expect(g.getAwaitedPlayerIds(s)).toEqual([]);
    expect(start(4).state.round.phaseMs).toBeGreaterThan(0);
    expect(toTalk(start(4).state).round.phaseMs).toBe(6 * 60_000);
  });

  it("the reveal timing out starts the talk too", () => {
    expect(ring(start(3).state).state.round.phase).toBe("talk");
  });

  it("ends in a vote of everyone, on time or when the host says", () => {
    const s = toTalk(start(4).state);
    expect(err(act(s, "p1", { type: "next" }))).toBe("host-only");
    expect(ok(act(s, HOST, { type: "next" })).state.round).toMatchObject({ phase: "vote", candidates: ids(s), phaseMs: VOTE_MS });
    expect(ring(s).state.round).toMatchObject({ phase: "vote", candidates: ids(s) });
  });

  it("an early alarm re-arms", () => {
    const s = toTalk(start(3).state);
    const t = g.onTimer!(s, "phase", ctx(s.round.deadline - 60_000));
    expect(t.state).toBe(s);
  });

  it("takes no typed clues or typed guesses", () => {
    const s = toTalk(start(4).state);
    expect(err(act(s, "p1", { type: "clue", text: "salty" }))).toBe("wrong-mode");
    expect(err(act(s, imp(s), { type: "guess", text: "lighthouse" }))).toBe("wrong-mode");
  });
});

describe("calling it early", () => {
  it("is the Imposter's, opens the guess, keeps who it is quiet", () => {
    const t = called(start(4).state);
    expect(types(t)).toEqual(["early-guess"]);
    const s = t.state;
    expect(s.round).toMatchObject({ phase: "guess", early: true, phaseMs: PLACE_GUESS_MS, accusedId: null });
    expect(g.getPublicState(s)).toMatchObject({ phase: "guess", early: true, imposterId: null, accusedId: null, accusedRole: null });
    expect(g.getPrivateState(s, imp(s)).guessing).toBe(true);
    for (const id of innocents(s)) expect(g.getPrivateState(s, id).guessing).toBe(false);
    // The runtime shows who's awaited; naming the guesser would name the Imposter.
    expect(g.getAwaitedPlayerIds(s)).toEqual([]);
  });

  it("from anyone else is turned away", () => {
    const s = toTalk(start(4).state);
    for (const id of innocents(s)) expect(err(act(s, id, { type: "call" }))).toBe("not-yours");
  });

  it("only in talk, only before the deadline, only in spoken mode", () => {
    const s = start(4).state;
    expect(err(act(s, imp(s), { type: "call" }))).toBe("wrong-phase");
    const v = toVote(start(4).state);
    expect(err(act(v, imp(v), { type: "call" }))).toBe("wrong-phase");
    const tk = toTalk(start(4).state);
    expect(err(act(tk, imp(tk), { type: "call" }, tk.round.deadline))).toBe("time-up");
    const c = g.createGame(players(4), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx(0), { deck: ["A|one"] }).state;
    expect(err(act(c, c.round.imposterId, { type: "call" }))).toBe("wrong-mode");
  });

  it("once a round: the round ends on the guess", () => {
    const c = called(start(4).state).state;
    const s = ok(act(c, imp(c), { type: "guess-place", placeId: "aquarium" })).state;
    expect(s.round.phase).toBe("round-result");
    expect(err(act(s, imp(s), { type: "call" }))).toBe("wrong-phase");
  });

  it("right takes the round for the Imposter", () => {
    const s = called(start(4).state).state;
    const t = ok(act(s, imp(s), { type: "guess-place", placeId: "lighthouse" }));
    expect(types(t)).toEqual(["guessed", "round-over"]);
    expect(t.state.round).toMatchObject({ phase: "round-result", winner: "imposter", guessRight: true, guess: "Lighthouse" });
    expect(score(t.state, imp(s))).toBe(2);
    expect(innocents(s).every((id) => score(t.state, id) === 0)).toBe(true);
    expect(g.getPublicState(t.state)).toMatchObject({ imposterId: imp(s), word: "Lighthouse", guess: "Lighthouse", early: true });
  });

  it("wrong hands it to everyone else", () => {
    const s = called(start(4).state).state;
    const t = ok(act(s, imp(s), { type: "guess-place", placeId: "submarine" }));
    expect(t.state.round).toMatchObject({ winner: "innocents", guessRight: false, guess: "Submarine", guessClose: false });
    expect(innocents(s).map((id) => score(t.state, id))).toEqual([2, 2, 2]);
    expect(score(t.state, imp(s))).toBe(0);
  });

  it("no pick in time is a miss", () => {
    const s = called(start(4).state).state;
    expect(ring(s).state.round).toMatchObject({ phase: "round-result", winner: "innocents", guess: null });
  });
});

describe("the caught guess", () => {
  it("picks from the list, the Imposter's alone", () => {
    const s = caught(start(4).state);
    expect(g.getAwaitedPlayerIds(s)).toEqual([imp(s)]);
    expect(err(act(s, innocents(s)[0]!, { type: "guess-place", placeId: "lighthouse" }))).toBe("not-yours");
    expect(err(act(s, imp(s), { type: "guess-place", placeId: "moon-base" }))).toBe("bad-guess");
    expect(err(act(s, imp(s), { type: "guess", text: "lighthouse" }))).toBe("wrong-mode");
    const t = ok(act(s, imp(s), { type: "guess-place", placeId: "lighthouse" }));
    expect(t.state.round).toMatchObject({ winner: "imposter", guessRight: true });
  });

  it("wrong pays every innocent", () => {
    const s = caught(start(4).state);
    const t = ok(act(s, imp(s), { type: "guess-place", placeId: "circus" }));
    expect(innocents(s).map((id) => score(t.state, id))).toEqual([2, 2, 2]);
  });

  it("guess-place is spoken mode's only", () => {
    const c = g.createGame(players(4), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx(0), { deck: ["A|one"] }).state;
    expect(err(act(c, c.round.imposterId, { type: "guess-place", placeId: "lighthouse" }))).toBe("wrong-mode");
  });
});

describe("the vote, same as clues mode", () => {
  it("a wrong accusation: role shown, Imposter scores", () => {
    const s = toVote(start(4).state);
    const target = innocents(s)[0]!;
    const t = voteAll(s, target, imp(s));
    expect(t.state.round).toMatchObject({ phase: "reveal-role", accusedId: target, phaseMs: ROLE_MS });
    const r = ring(t.state);
    expect(r.state.round).toMatchObject({ phase: "round-result", winner: "imposter", phaseMs: RESULT_MS });
  });

  it("a tie goes to a runoff", () => {
    let s = toVote(start(4).state);
    for (const [v, c] of [["p0", "p2"], ["p1", "p2"], ["p2", "p1"], ["p3", "p1"]] as const) s = ok(act(s, v, { type: "vote", playerId: c })).state;
    expect(s.round).toMatchObject({ phase: "runoff", tied: ["p1", "p2"] });
    s = ok(act(s, "p0", { type: "vote", playerId: "p1" })).state;
    expect(ring(s).state.round.accusedId).toBe("p1");
  });

  it("nobody votes: the Imposter scores", () => {
    const t = ring(toVote(start(4).state));
    expect(types(t)).toEqual(["nobody-accused", "round-over"]);
  });
});

describe("leaving", () => {
  it("the Imposter leaving in talk drops the round and deals a new place", () => {
    const s = toTalk(start(5, { deck: ["lighthouse", "circus"] }).state);
    const gone = imp(s);
    const t = g.onPlayerRemoved!(s, gone, ctx(1000));
    expect(types(t)).toEqual(["round-dropped", "round-started"]);
    expect(t.state.round.phase).toBe("reveal");
    expect(t.state.round.placeId).not.toBe(s.round.placeId);
    expect(imp(t.state)).not.toBe(gone);
    expect(JSON.stringify(t.events)).not.toMatch(/lighthouse|circus/i);
  });

  it("the Imposter leaving mid early guess is a miss", () => {
    const s = called(start(4).state).state;
    const t = g.onPlayerRemoved!(s, imp(s), ctx(1000));
    expect(t.state.round).toMatchObject({ phase: "round-result", winner: "innocents" });
  });

  it("the Imposter leaving once caught is a miss", () => {
    const s = caught(start(4).state);
    expect(g.onPlayerRemoved!(s, imp(s), ctx(1000)).state.round.winner).toBe("innocents");
  });

  it("an innocent leaving in talk doesn't stop it", () => {
    const s = toTalk(start(5).state);
    const who = innocents(s)[0]!;
    const t = g.onPlayerRemoved!(s, who, ctx(1000));
    expect(t.state.round.phase).toBe("talk");
    expect(t.events).toEqual([]);
  });

  it("the first asker leaving hands the line to the next seat still in", () => {
    // A deal where the first asker isn't the Imposter (their leaving drops the round).
    const s = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => toTalk(start(5, { seed }).state)).find((x) => x.round.firstAsker !== imp(x))!;
    const first = g.getPublicState(s).firstAsker!;
    const t = g.onPlayerRemoved!(s, first, ctx(1000));
    const seats = s.players.map((p) => p.id);
    const at = seats.indexOf(first);
    expect(g.getPublicState(t.state).firstAsker).toBe(seats[(at + 1) % seats.length]);
    expect(t.state.round.phase).toBe("talk");
  });

  it("an innocent leaving mid-vote leaves the ballot", () => {
    const s = toVote(start(5).state);
    const who = innocents(s)[0]!;
    const t = g.onPlayerRemoved!(s, who, ctx(1000));
    expect(t.state.round.ballot!.eligible).not.toContain(who);
    expect(t.state.round.candidates).not.toContain(who);
  });

  it("below three in talk ends it with no winner, place out", () => {
    const s = toTalk(start(3).state);
    const t = g.onPlayerRemoved!(s, innocents(s)[0]!, ctx(1000));
    expect(t.state.phase).toBe("finished");
    expect(g.getPublicState(t.state)).toMatchObject({ word: "Lighthouse", imposterId: imp(s) });
  });

  it("disconnects don't hold the reveal, and talk runs on the clock", () => {
    let s = start(4).state;
    s = g.onPlayerDisconnected!(s, "p3", ctx(100)).state;
    for (const id of ["p0", "p1", "p2"]) s = ok(act(s, id, { type: "ack" })).state;
    expect(s.round.phase).toBe("talk");
    expect(g.onPlayerDisconnected!(s, "p2", ctx(200)).state.round.phase).toBe("talk");
  });

  it("the host skipping a caught guesser is a miss", () => {
    const s = caught(start(4).state);
    expect(g.skipTurn!(s, imp(s), ctx(1000)).state.round.winner).toBe("innocents");
  });
});

describe("rounds and rematch", () => {
  function round(s: S): S {
    s = ring(toVote(s)).state;
    expect(s.round.phase).toBe("round-result");
    return ring(s).state;
  }

  it("places don't repeat in a match, or across a rematch", () => {
    const deck = ["lighthouse", "circus", "aquarium", "submarine"];
    let s = start(3, { deck, settings: { rounds: 3 } }).state;
    const seen = [s.round.placeId];
    for (let i = 0; i < 3; i++) {
      s = round(s);
      if (s.phase === "playing") seen.push(s.round.placeId);
    }
    expect(new Set(seen).size).toBe(3);
    expect(s.phase).toBe("finished");
    const next = g.createGame(players(3), SPOKEN, { roundNumber: 1, dealerSeat: 0, carry: g.carryOver!(s) }, ctx(0), { deck });
    expect(seen).not.toContain(next.state.round.placeId);
  });
});

describe("used list", () => {
  it("a word pack reset keeps places played, and a place reset keeps words", () => {
    const clues = g.createGame(players(3), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0, carry: { used: ["place|lighthouse", "A|one"] } }, ctx(0), { deck: ["A|one"] }).state;
    expect(clues.used).toEqual(["place|lighthouse", "A|one"]);
    const spokenS = g.createGame(players(3), SPOKEN, { roundNumber: 1, dealerSeat: 0, carry: { used: ["A|one", "place|lighthouse"] } }, ctx(0), { deck: ["lighthouse"] }).state;
    expect(spokenS.used).toEqual(["A|one", "place|lighthouse"]);
  });
});

describe("secrets", () => {
  /** Every seat but the innocents must not see the place; every seat but the Imposter must not see the role. */
  function sealed(t: { state: S; events?: T["events"] }) {
    const s = t.state;
    const all = ids(s);
    const place = placeById(s.round.placeId)!;
    for (const secret of [place.name, place.id]) {
      expect(findLeaks({ def: g, state: s, events: t.events, players: all, secret, allowed: innocents(s) }), `${s.round.phase}: ${secret}`).toEqual([]);
    }
    expect(findLeaks({ def: g, state: s, events: t.events, players: all, secret: '"role":"imposter"', allowed: [imp(s)] })).toEqual([]);
    expect(findLeaks({ def: g, state: s, events: t.events, players: all, secret: `"imposterId":"${imp(s)}"`, allowed: [] })).toEqual([]);
  }

  it("the place and the role stay put through reveal, talk, vote, runoff, reveal-role and the caught guess", () => {
    const first = start(4, { deck: ["museum-lab"] });
    sealed(first);
    let s = first.state;
    for (const id of ids(s)) {
      const t = ok(act(s, id, { type: "ack" }));
      sealed(t);
      s = t.state;
    }
    expect(s.round.phase).toBe("talk");
    const v = ok(act(s, HOST, { type: "next" }));
    sealed(v);
    s = v.state;
    // Tie, into a runoff.
    const [a, b, c] = innocents(s) as [string, string, string];
    for (const [voter, choice] of [[imp(s), a], [a, b], [b, a], [c, b]] as const) {
      const t = ok(act(s, voter, { type: "vote", playerId: choice }));
      sealed(t);
      s = t.state;
    }
    expect(s.round.phase).toBe("runoff");
    // The Imposter isn't a runoff candidate, so this run ends on a wrong accusation.
    const r = ok(act(s, imp(s), { type: "vote", playerId: a }));
    sealed(r);
    const rr = ring(r.state);
    sealed(rr);
    expect(rr.state.round.phase).toBe("reveal-role");
    // Caught instead: the role's out (allowed), the place still isn't.
    const caughtState = caught(start(4, { deck: ["museum-lab"] }).state);
    for (const secret of ["Museum restoration lab", "museum-lab"]) {
      expect(findLeaks({ def: g, state: caughtState, players: ids(caughtState), secret, allowed: innocents(caughtState) })).toEqual([]);
    }
  });

  it("the early guess gives away neither the place nor who's guessing", () => {
    let s = start(5, { deck: ["film-set"] }).state;
    s = toTalk(s);
    const t = ok(act(s, imp(s), { type: "call" }));
    sealed(t);
    // The miss reveals it all at the result, as it should.
    const done = ok(act(t.state, imp(s), { type: "guess-place", placeId: "circus" }));
    expect(g.getPublicState(done.state)).toMatchObject({ word: "Film set", imposterId: imp(s) });
  });

  it("a non-Imposter's rejected call says nothing about who is", () => {
    const s = toTalk(start(4).state);
    const r = act(s, innocents(s)[0]!, { type: "call" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(JSON.stringify(r.error)).not.toContain(imp(s));
  });
});

describe("random spoken games", () => {
  it("always finish, with sane scores", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rnd = seededRandomInt(seed * 7919);
      const n = 3 + rnd(10);
      let s = g.createGame(players(n), { ...SPOKEN, rounds: 3 }, { roundNumber: 1, dealerSeat: 0 }, ctx(0, seed)).state;
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
            : phase === "talk" ? (rnd(4) ? { type: "next" } : { type: "call" })
            : phase === "vote" || phase === "runoff" ? { type: "vote", playerId: live[rnd(live.length)] }
            : phase === "guess" ? { type: "guess-place", placeId: rnd(2) ? s.round.placeId : PLACES[rnd(PLACES.length)]!.id }
            : { type: "next" };
          const actor = phase === "guess" || action.type === "call" ? imp(s) : action.type === "next" ? live[0]! : who;
          const r = g.handleAction(s, actor, g.parseAction(action)!, { ...ctx(now, seed), hostId: live[0] });
          if (r.ok) next = r.transition.state;
        }
        if (next) s = next;
      }
      expect(s.phase, `seed ${seed}`).toBe("finished");
      expect(s.players.every((p) => p.score % 2 === 0)).toBe(true);
    }
  });
});
