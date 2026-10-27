import { describe, expect, it } from "vitest";
import { deckOf } from "../shared/roles.ts";
import { DEFAULT_SETTINGS, NOBODY, REVEAL_MS, RUNOFF_MS, VOTE_MS } from "../shared/types.ts";
import { act, ctx, err, g, holder, HOST, ids, ok, players, ring, runNight, type S, start, toNight, toVote, types, vote } from "./helpers.ts";

/** p0 wolf, p1 lamplighter, p2 matchmaker, p3 bellringer, p4 gossip, p5 wolf. */
const SIX = ["wolf", "lamplighter", "matchmaker", "bellringer", "gossip", "wolf"] as const;
const six = (seed = 1) => start([...SIX], {}, seed).state;

describe("the deal", () => {
  it("deals the preset's deck, one card each, shuffled", () => {
    const t = g.createGame(players(7), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx(0, 3));
    const counts: Record<string, number> = {};
    for (const c of Object.values(t.state.cards)) counts[c] = (counts[c] ?? 0) + 1;
    expect(counts).toEqual(deckOf(DEFAULT_SETTINGS, 7));
    expect(t.state.deck).toEqual(counts);
    expect(t.state.steps).toEqual(["wolf", "lamplighter", "matchmaker", "gossip"]);
  });

  it("deals differently on another seed", () => {
    const deal = (seed: number) => JSON.stringify(g.createGame(players(8), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx(0, seed)).state.cards);
    expect(new Set([1, 2, 3, 4, 5].map(deal)).size).toBeGreaterThan(1);
  });

  it("refuses a deck that doesn't fit, and a table out of range", () => {
    const bad = { ...DEFAULT_SETTINGS, preset: "custom", "n:wolf": 1, "n:villager": 2 } as const;
    expect(() => g.createGame(players(5), bad, { roundNumber: 1, dealerSeat: 0 }, ctx())).toThrow("Need exactly 5 role cards");
    expect(() => g.createGame(players(3), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx())).toThrow("needs 4–10");
    expect(() => g.createGame(players(11), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx())).toThrow("needs 4–10");
  });

  it("asks setupProblem the same thing the lobby does", () => {
    expect(g.setupProblem!(DEFAULT_SETTINGS, 6)).toBeNull();
    expect(g.setupProblem!({ ...DEFAULT_SETTINGS, preset: "custom", "n:wolf": 3, "n:villager": 1 }, 4)).toBe("Needs at least two non-wolf cards");
  });

  it("opens on the reveal with its 30 s clock", () => {
    const t = start([...SIX]);
    expect(t.state).toMatchObject({ phase: "reveal", deadline: REVEAL_MS, phaseMs: REVEAL_MS });
    expect(t.timers).toEqual([{ kind: "set", timerId: "phase", delayMs: REVEAL_MS }]);
  });
});

describe("the reveal", () => {
  it("ends when everyone's tapped Got it", () => {
    let s = six();
    for (const id of ids(s).slice(0, 5)) s = ok(act(s, id, { type: "ack" })).state;
    expect(s.phase).toBe("reveal");
    const t = ok(act(s, "p5", { type: "ack" }));
    expect(t.state).toMatchObject({ phase: "night", step: 0 });
    expect(types(t)).toEqual(["night-step"]);
  });

  it("doesn't count an ack from someone who then left", () => {
    let s = ok(act(six(), "p1", { type: "ack" })).state;
    s = ok(act(s, "p2", { type: "ack" })).state;
    expect(g.getPublicState(s).acked).toBe(2);
    s = g.onPlayerRemoved!(s, "p1", ctx(1000)).state;
    expect(s.phase).toBe("reveal");
    expect(g.getPublicState(s).acked).toBe(1);
  });

  it("or when the clock runs out", () => {
    const t = ring(six());
    expect(t.state).toMatchObject({ phase: "night", step: 0, phaseMs: 15_000 });
  });

  it("doesn't wait for the disconnected", () => {
    let s = six();
    s = g.onPlayerDisconnected!(s, "p3", ctx(1000)).state;
    for (const id of ids(s).filter((id) => id !== "p3")) s = ok(act(s, id, { type: "ack" })).state;
    expect(s.phase).toBe("night");
  });

  it("names who hasn't looked, and the host can skip them", () => {
    let s = six();
    for (const id of ["p0", "p1", "p2", "p3", "p4"]) s = ok(act(s, id, { type: "ack" })).state;
    expect(g.getAwaitedPlayerIds(s)).toEqual(["p5"]);
    s = g.skipTurn!(s, "p5", ctx(1000)).state;
    expect(s.phase).toBe("night");
  });

  it("refuses night moves", () => {
    expect(err(act(six(), "p1", { type: "pick", targets: ["p0"] }))).toBe("wrong-phase");
  });
});

describe("the night", () => {
  it("runs one step per acting role in the deck, each its full length, then day", () => {
    let s = toNight(six());
    expect(s.steps).toEqual(["wolf", "lamplighter", "matchmaker", "bellringer", "gossip"]);
    const seen: string[] = [];
    while (s.phase === "night") {
      seen.push(s.steps[s.step]!);
      expect(s.phaseMs).toBe(15_000);
      expect(g.getAwaitedPlayerIds(s)).toEqual([]);
      s = ring(s).state;
    }
    expect(seen).toEqual(s.steps);
    expect(s).toMatchObject({ phase: "day", phaseMs: 4 * 60_000 });
  });

  it("takes the host's step length and talking time", () => {
    let s = toNight(start([...SIX], { stepSeconds: 10, discussMinutes: 6 }).state);
    expect(s.phaseMs).toBe(10_000);
    s = runNight(s);
    expect(s.phaseMs).toBe(6 * 60_000);
  });

  it("never ends a step early, even once its picker has picked", () => {
    let s = ring(toNight(six())).state; // the Lamplighter's step
    const before = s.deadline;
    const t = ok(act(s, "p1", { type: "pick", targets: ["p0"] }));
    expect(t.state).toMatchObject({ phase: "night", step: 1, deadline: before });
    expect(t.events).toEqual([]);
    expect(t.timers).toEqual([]);
  });

  it("an early alarm puts the deadline back; a stray timer id does nothing", () => {
    const s = toNight(six());
    const early = g.onTimer!(s, "phase", ctx(s.deadline - 5000));
    expect(early.state).toBe(s);
    expect(early.timers).toEqual([{ kind: "set", timerId: "phase", delayMs: 5000 }]);
    expect(g.onTimer!(s, "other", ctx(s.deadline)).state).toBe(s);
  });

  it("shows nobody a result before their step", () => {
    const s = toNight(six());
    expect(g.getPrivateState(s, "p4").result).toBeNull(); // Gossip, drawn already
    expect(s.results.p4).toBeDefined();
    expect(g.getPrivateState(six(), "p0").result).toBeNull(); // Wolf, during the reveal
  });

  describe("Wolf", () => {
    it("Wolves see each other in step 1", () => {
      const s = toNight(six());
      expect(g.getPrivateState(s, "p0").result).toEqual({ kind: "wolves", pack: ["p0", "p5"], villager: null });
      expect(g.getPrivateState(s, "p5").result).toEqual({ kind: "wolves", pack: ["p0", "p5"], villager: null });
    });

    it("a lone Wolf learns a Villager", () => {
      const s = toNight(start(["villager", "wolf", "lamplighter", "villager", "gossip"]).state);
      const r = g.getPrivateState(s, "p1").result;
      expect(r).toMatchObject({ kind: "wolves", pack: ["p1"] });
      expect(["p0", "p3"]).toContain((r as { villager: string }).villager);
    });

    it("a lone Wolf with no Villagers dealt is told so", () => {
      const s = toNight(start(["gossip", "wolf", "lamplighter", "matchmaker"]).state);
      expect(g.getPrivateState(s, "p1").result).toEqual({ kind: "wolves", pack: ["p1"], villager: null });
    });

    it("has no pick to make", () => {
      const s = toNight(six());
      expect(g.getPrivateState(s, "p0").picking).toBeNull();
      expect(err(act(s, "p0", { type: "pick", targets: ["p1"] }))).toBe("wrong-phase");
    });
  });

  describe("Lamplighter", () => {
    const lamp = (target: string, cards = ["wolf", "lamplighter", "villager", "stray", "villager"] as const) => {
      const s = ring(toNight(start([...cards]).state)).state;
      expect(g.getPrivateState(s, "p1").picking).toEqual({ count: 1, choices: ["p0", "p2", "p3", "p4"] });
      const t = ok(act(s, "p1", { type: "pick", targets: [target] }));
      return g.getPrivateState(t.state, "p1");
    };

    it("sees a Wolf as wolf, a Villager as village, the Stray as wolf", () => {
      expect(lamp("p0").result).toEqual({ kind: "lamp", target: "p0", reads: "wolves" });
      expect(lamp("p2").result).toEqual({ kind: "lamp", target: "p2", reads: "village" });
      expect(lamp("p3").result).toEqual({ kind: "lamp", target: "p3", reads: "wolves" });
    });

    it("has nothing left to pick once it has", () => {
      expect(lamp("p0").picking).toBeNull();
    });
  });

  describe("Matchmaker", () => {
    const match = (a: string, b: string) => {
      let s = toNight(start(["wolf", "villager", "matchmaker", "stray", "villager", "wolf"]).state);
      s = ring(s).state;
      expect(s.steps[s.step]).toBe("matchmaker");
      return g.getPrivateState(ok(act(s, "p2", { type: "pick", targets: [a, b] })).state, "p2").result;
    };

    it("same side, different sides, and the Stray on the wolves' side", () => {
      expect(match("p0", "p5")).toEqual({ kind: "match", targets: ["p0", "p5"], same: true });
      expect(match("p0", "p1")).toEqual({ kind: "match", targets: ["p0", "p1"], same: false });
      expect(match("p1", "p4")).toEqual({ kind: "match", targets: ["p1", "p4"], same: true });
      expect(match("p3", "p0")).toEqual({ kind: "match", targets: ["p3", "p0"], same: true });
    });

    it("wants exactly two other, different players", () => {
      const s = ring(toNight(start(["wolf", "villager", "matchmaker", "villager", "villager"]).state)).state;
      expect(g.getPrivateState(s, "p2").picking?.count).toBe(2);
      expect(err(act(s, "p2", { type: "pick", targets: ["p0"] }))).toBe("bad-pick");
      expect(err(act(s, "p2", { type: "pick", targets: ["p0", "p0"] }))).toBe("bad-pick");
      expect(err(act(s, "p2", { type: "pick", targets: ["p0", "p2"] }))).toBe("bad-pick");
      expect(err(act(s, "p2", { type: "pick", targets: ["p0", "zz"] }))).toBe("bad-pick");
    });
  });

  describe("Bellringer", () => {
    it("counts wolves among its two seat neighbours, round the table", () => {
      const at = (cards: string[]) => {
        const s = runNight(toNight(start(cards as never).state));
        return s.results[holder(s, "bellringer")];
      };
      expect(at(["bellringer", "wolf", "villager", "villager", "wolf"])).toEqual({ kind: "bell", neighbours: ["p4", "p1"], count: 2 });
      expect(at(["villager", "bellringer", "stray", "wolf", "villager"])).toEqual({ kind: "bell", neighbours: ["p0", "p2"], count: 1 });
      expect(at(["villager", "bellringer", "villager", "wolf", "villager"])).toEqual({ kind: "bell", neighbours: ["p0", "p2"], count: 0 });
    });
  });

  describe("Gossip", () => {
    it("names two others, at least one a wolf (or the Stray), on every seed", () => {
      for (let seed = 1; seed <= 40; seed++) {
        const s = start(["villager", "gossip", "villager", "wolf", "villager", "stray", "villager"], {}, seed).state;
        const r = s.results.p1!;
        expect(r.kind).toBe("gossip");
        const pair = (r as { pair: [string, string] }).pair;
        expect(new Set(pair).size).toBe(2);
        expect(pair).not.toContain("p1");
        expect(pair.some((id) => s.cards[id] === "wolf" || s.cards[id] === "stray")).toBe(true);
      }
    });

    it("hears it in its own step", () => {
      let s = toNight(six());
      while (s.steps[s.step] !== "gossip") {
        expect(g.getPrivateState(s, "p4").result).toBeNull();
        s = ring(s).state;
      }
      expect(g.getPrivateState(s, "p4").result).toEqual(s.results.p4);
    });
  });

  describe("Wanderer", () => {
    it("still says something true when its deck has no third role (a test deck; setupProblem forbids it)", () => {
      let s = toNight(start(["wolf", "wanderer", "wolf", "wolf"]).state);
      while (s.steps[s.step] !== "wanderer") s = ring(s).state;
      for (let seed = 1; seed <= 10; seed++) {
        const r = ok(act(s, "p1", { type: "pick", targets: ["p0"] }, s.deadline - 1000, seed)).state.results.p1;
        expect(r).toMatchObject({ kind: "wander", target: "p0" });
        const not = (r as { notRole: string }).notRole;
        expect(not).toBeDefined();
        expect(["wolf", "wanderer"]).not.toContain(not);
      }
    });

    it("always has something to say, even in the smallest deck", () => {
      for (const target of ["p0", "p2", "p3"]) {
        let s = toNight(start(["wolf", "wanderer", "villager", "villager"]).state);
        while (s.steps[s.step] !== "wanderer") s = ring(s).state;
        const r = ok(act(s, "p1", { type: "pick", targets: [target] })).state.results.p1;
        expect(r).toMatchObject({ kind: "wander", notRole: s.cards[target] === "wolf" ? "villager" : "wolf" });
      }
    });

    it("learns a role from this deck the target doesn't hold, never its own", () => {
      const cards = ["wolf", "wanderer", "stray", "villager", "lamplighter"] as const;
      const seen = new Set<string>();
      for (let seed = 1; seed <= 30; seed++) {
        let s = toNight(start([...cards]).state);
        while (s.steps[s.step] !== "wanderer") s = ring(s).state;
        for (const target of ["p0", "p2"]) {
          const r = ok(act(s, "p1", { type: "pick", targets: [target] }, s.deadline - 1000, seed)).state.results.p1;
          expect(r).toMatchObject({ kind: "wander", target });
          const not = (r as { notRole: string }).notRole;
          expect(not).not.toBe(s.cards[target]);
          expect(not).not.toBe("wanderer");
          expect(Object.keys(s.deck)).toContain(not);
          seen.add(`${target}:${not}`);
        }
      }
      // It sees cards, not teams: the Stray can come back "not a Wolf".
      expect(seen.has("p2:wolf")).toBe(true);
    });
  });

  it("a picker who lets the step run out gets nothing, and nobody's picked for them", () => {
    let s = ring(toNight(six())).state;
    expect(s.steps[s.step]).toBe("lamplighter");
    s = ring(s).state;
    expect(s.results.p1).toEqual({ kind: "missed" });
    expect(s.targets.p1).toBeUndefined();
    expect(g.getPrivateState(s, "p1").result).toEqual({ kind: "missed" });
  });

  it("refuses picks out of turn, twice, or after the step", () => {
    let s = ring(toNight(six())).state; // Lamplighter's
    expect(err(act(s, "p2", { type: "pick", targets: ["p0", "p1"] }))).toBe("wrong-phase"); // Matchmaker, too soon
    expect(err(act(s, "p1", { type: "pick", targets: ["p1"] }))).toBe("bad-pick");
    expect(err(act(s, "p1", { type: "pick", targets: ["p0"] }, s.deadline))).toBe("time-up");
    s = ok(act(s, "p1", { type: "pick", targets: ["p0"] })).state;
    expect(err(act(s, "p1", { type: "pick", targets: ["p2"] }))).toBe("already");
    s = ring(s).state;
    expect(err(act(s, "p1", { type: "pick", targets: ["p2"] }))).toBe("wrong-phase");
  });

  it("can't be skipped or voted through", () => {
    const s = toNight(six());
    expect(g.skipTurn!(s, "p0", ctx(1000)).state).toBe(s);
    expect(err(act(s, HOST, { type: "next" }))).toBe("wrong-phase");
    expect(err(act(s, "p1", { type: "vote", choice: "p0" }))).toBe("wrong-phase");
  });
});

describe("the day", () => {
  it("the host calls the vote early; nobody else can", () => {
    const s = runNight(toNight(six()));
    expect(err(act(s, "p1", { type: "next" }))).toBe("host-only");
    const t = ok(act(s, HOST, { type: "next" }));
    expect(t.state).toMatchObject({ phase: "vote", phaseMs: VOTE_MS });
    expect(types(t)).toEqual(["vote-open"]);
  });

  it("or the clock does", () => {
    const t = ring(runNight(toNight(six())));
    expect(t.state.phase).toBe("vote");
  });
});

describe("the vote", () => {
  it("offers every other player still in, and nobody", () => {
    const s = toVote(six());
    expect(g.getPrivateState(s, "p2").choices).toEqual(["p0", "p1", "p3", "p4", "p5", NOBODY]);
    expect(err(act(s, "p2", { type: "vote", choice: "p2" }))).toBe("self-vote");
    expect(err(act(s, "p2", { type: "vote", choice: "zz" }))).toBe("bad-choice");
  });

  it("a Wolf voted out: the village wins", () => {
    const t = vote(toVote(six()), { p0: "p5", p1: "p5", p2: "p5", p3: "p5", p4: "p0", p5: "p1" });
    expect(t.state).toMatchObject({ phase: "finished", out: "p5", winner: "village", endReason: "done" });
    expect(types(t)).toContain("game-over");
    expect(t.timers).toContainEqual({ kind: "cancel", timerId: "phase" });
  });

  it("a villager voted out: the wolves win", () => {
    const t = vote(toVote(six()), { p0: "p1", p1: "p2", p2: "p1", p3: "p1", p4: "p1", p5: "p1" });
    expect(t.state).toMatchObject({ out: "p1", winner: "wolves" });
  });

  it("the Stray voted out is a villager voted out", () => {
    let s = start(["wolf", "stray", "villager", "villager", "lamplighter"]).state;
    s = toVote(s);
    expect(vote(s, { p0: "p1", p1: "p0", p2: "p1", p3: "p1", p4: "p1" }).state).toMatchObject({ out: "p1", winner: "wolves" });
  });

  it("nobody, with more votes than every player: nobody goes and the wolves win", () => {
    const t = vote(toVote(six()), { p0: NOBODY, p1: NOBODY, p2: NOBODY, p3: "p0", p4: "p0", p5: "p1" });
    expect(t.state).toMatchObject({ phase: "finished", out: null, winner: "wolves" });
  });

  it("nobody level with the top player isn't enough: the player goes", () => {
    const t = vote(toVote(six()), { p0: NOBODY, p1: NOBODY, p2: "p0", p3: "p0", p4: "p1", p5: "p1" });
    // p0 and p1 tie at 2 with nobody: the named tie goes to a runoff.
    expect(t.state).toMatchObject({ phase: "runoff", tied: ["p0", "p1"] });
    const u = vote(toVote(six()), { p0: NOBODY, p1: NOBODY, p2: "p0", p3: "p0", p4: "p0", p5: "p1" });
    expect(u.state).toMatchObject({ phase: "finished", out: "p0", winner: "village" });
  });

  it("no votes at all: nobody goes", () => {
    const t = ring(toVote(six()));
    expect(t.state).toMatchObject({ phase: "finished", out: null, winner: "wolves" });
  });

  it("closes early once everyone connected has voted, and a re-vote just replaces", () => {
    let s = toVote(six());
    s = g.onPlayerDisconnected!(s, "p4", ctx(s.deadline - 5000)).state;
    s = vote(s, { p0: "p1", p1: "p0", p2: "p0", p3: "p0" }).state;
    s = ok(act(s, "p2", { type: "vote", choice: "p5" })).state;
    expect(s.phase).toBe("vote");
    expect(s.ballot!.votes.p2).toBe("p5");
    s = ok(act(s, "p5", { type: "vote", choice: "p1" })).state;
    expect(s).toMatchObject({ phase: "runoff", tied: ["p0", "p1"] });
  });

  it("names nobody as awaited, and can't be skipped", () => {
    const s = toVote(six());
    expect(g.getAwaitedPlayerIds(s)).toEqual([]);
    expect(g.skipTurn!(s, "p1", ctx(1000)).state).toBe(s);
  });

  describe("runoff", () => {
    const tie = () => vote(toVote(six()), { p0: "p1", p1: "p0", p2: "p0", p3: "p1", p4: NOBODY, p5: "p2" }).state;

    it("opens among the tied, 10 s, nobody not on offer, nor yourself", () => {
      const s = tie();
      expect(s).toMatchObject({ phase: "runoff", tied: ["p0", "p1"], phaseMs: RUNOFF_MS });
      expect(g.getPrivateState(s, "p3").choices).toEqual(["p0", "p1"]);
      expect(g.getPrivateState(s, "p0").choices).toEqual(["p1"]);
      expect(err(act(s, "p3", { type: "vote", choice: NOBODY }))).toBe("bad-choice");
      expect(err(act(s, "p3", { type: "vote", choice: "p2" }))).toBe("bad-choice");
    });

    it("a clear runoff puts its leader out", () => {
      const t = vote(tie(), { p0: "p1", p1: "p0", p2: "p0", p3: "p0", p4: "p0", p5: "p1" });
      expect(t.state).toMatchObject({ phase: "finished", out: "p0", winner: "village" });
    });

    it("still tied: nobody goes", () => {
      const t = vote(tie(), { p0: "p1", p1: "p0", p2: "p0", p3: "p1", p4: "p0", p5: "p1" });
      expect(t.state).toMatchObject({ phase: "finished", out: null, winner: "wolves" });
    });

    it("nobody voted in it: nobody goes", () => {
      expect(ring(tie()).state).toMatchObject({ phase: "finished", out: null, winner: "wolves" });
    });
  });
});

describe("leaving", () => {
  it("a leaver shows as left, card unsaid, and the reveal goes on without them", () => {
    let s = six();
    s = g.onPlayerRemoved!(s, "p2", ctx(1000)).state;
    const pub = g.getPublicState(s);
    expect(pub.players.find((p) => p.id === "p2")).toEqual({ id: "p2", left: true });
    expect(pub.cards).toBeNull();
    for (const id of ids(s)) s = ok(act(s, id, { type: "ack" })).state;
    expect(s.phase).toBe("night");
    expect(err(act(s, "p2", { type: "ack" }))).toBe("not-in-game");
  });

  it("a leaver's step still runs its full length", () => {
    let s = toNight(six());
    s = g.onPlayerRemoved!(s, "p2", ctx(1000)).state; // the Matchmaker
    const steps: number[] = [];
    while (s.phase === "night") {
      steps.push(s.phaseMs);
      s = ring(s).state;
    }
    expect(steps).toEqual([15_000, 15_000, 15_000, 15_000, 15_000]);
    expect(s.results.p2).toEqual({ kind: "missed" });
  });

  it("one of two Wolves leaving: the game goes on", () => {
    const s = g.onPlayerRemoved!(toNight(six()), "p0", ctx(1000)).state;
    expect(s.phase).toBe("night");
  });

  for (const phase of ["reveal", "night", "day", "vote", "runoff"] as const) {
    it(`the last Wolf leaving in the ${phase}: interrupted, no winner`, () => {
      const at: Record<typeof phase, () => S> = {
        reveal: () => six(),
        night: () => toNight(six()),
        day: () => runNight(toNight(six())),
        vote: () => toVote(six()),
        runoff: () => vote(toVote(six()), { p0: "p1", p1: "p2", p2: "p1", p3: "p2", p4: NOBODY, p5: "p3" }).state,
      };
      let s = at[phase]();
      expect(s.phase).toBe(phase);
      s = g.onPlayerRemoved!(s, "p0", ctx(s.deadline - 1000)).state;
      const t = g.onPlayerRemoved!(s, "p5", ctx(s.deadline - 1000));
      expect(t.state).toMatchObject({ phase: "finished", endReason: "last-wolf-left", winner: null });
      expect(types(t)).toEqual(["game-over"]);
      const result = g.getResult(t.state)!;
      expect(result.winnerIds).toEqual([]);
      expect(result.headline).toBe("Interrupted: the last Wolf left");
    });
  }

  it("down to two players: interrupted", () => {
    let s = start(["wolf", "villager", "villager", "lamplighter"]).state;
    s = g.onPlayerRemoved!(s, "p1", ctx(1000)).state;
    expect(s.phase).toBe("reveal");
    const t = g.onPlayerRemoved!(s, "p2", ctx(1000));
    expect(t.state).toMatchObject({ phase: "finished", endReason: "too-few" });
    expect(g.getResult(t.state)!.headline).toBe("Interrupted: too few players left");
  });

  it("mid-vote: their ballot drops, votes for them go back", () => {
    let s = toVote(six());
    s = vote(s, { p1: "p2", p3: "p2", p4: "p0" }).state;
    s = g.onPlayerRemoved!(s, "p2", ctx(s.deadline - 1000)).state;
    expect(s.ballot!.eligible).not.toContain("p2");
    expect(s.ballot!.votes).toEqual({ p4: "p0" });
    expect(g.getPrivateState(s, "p1").choices).not.toContain("p2");
    expect(err(act(s, "p1", { type: "vote", choice: "p2" }))).toBe("bad-choice");
  });

  it("the last one waited on leaving closes the vote", () => {
    let s = toVote(six());
    s = vote(s, { p0: "p5", p1: "p5", p2: "p5", p3: "p5", p5: "p1" }).state;
    const t = g.onPlayerRemoved!(s, "p4", ctx(s.deadline - 1000));
    expect(t.state).toMatchObject({ phase: "finished", out: "p5", winner: "village" });
  });

  it("a runoff down to one candidate, by a leave: interrupted, no winner", () => {
    let s = vote(toVote(start(["wolf", "villager", "villager", "lamplighter", "matchmaker", "wolf"]).state), {
      p0: "p1", p1: "p2", p2: "p1", p3: "p2", p4: NOBODY, p5: "p3",
    }).state;
    expect(s).toMatchObject({ phase: "runoff", tied: ["p1", "p2"] });
    const t = g.onPlayerRemoved!(s, "p1", ctx(s.deadline - 1000));
    expect(t.state).toMatchObject({ phase: "finished", endReason: "runoff-left", winner: null, out: null });
    expect(types(t)).toEqual(["game-over"]);
    const r = g.getResult(t.state)!;
    expect(r.winnerIds).toEqual([]);
    expect(r.headline).toBe("Interrupted: a runoff candidate left");
  });

  it("a three-way runoff that loses one goes on between the other two", () => {
    let s = vote(toVote(six()), { p0: "p1", p1: "p2", p2: "p3", p3: "p1", p4: "p2", p5: "p3" }).state;
    expect(s).toMatchObject({ phase: "runoff", tied: ["p1", "p2", "p3"] });
    s = g.onPlayerRemoved!(s, "p3", ctx(s.deadline - 1000)).state;
    expect(s).toMatchObject({ phase: "runoff", tied: ["p1", "p2"] });
  });

  it("after the end, nothing", () => {
    const s = ring(toVote(six())).state;
    expect(g.onPlayerRemoved!(s, "p1", ctx(0)).state).toBe(s);
    expect(g.onTimer!(s, "phase", ctx(1e9)).state).toBe(s);
    expect(err(act(s, "p1", { type: "ack" }, 0))).toBe("game-finished");
  });

  it("a reconnect clears the away flag", () => {
    let s = g.onPlayerDisconnected!(six(), "p1", ctx(1000)).state;
    expect(s.players[1]!.away).toBe(true);
    s = g.onPlayerReconnected!(s, "p1", ctx(2000)).state;
    expect(s.players[1]!.away).toBe(false);
  });
});

describe("results", () => {
  it("headline the winning team; winners first, each with their card", () => {
    const s = vote(toVote(six()), { p0: "p5", p1: "p5", p2: "p5", p3: "p5", p4: "p5", p5: "p1" }).state;
    const r = g.getResult(s)!;
    expect(r.headline).toBe("Village wins");
    expect(r.winnerIds).toEqual(["p1", "p2", "p3", "p4"]);
    expect(r.standings.map((x) => x.label)).toEqual([
      "Lamplighter, won", "Matchmaker, won", "Bellringer, won", "Gossip, won", "Wolf, lost", "Wolf, lost",
    ]);
  });

  it("the wolves' win goes to the Wolves still in", () => {
    let s = toVote(start(["wolf", "villager", "villager", "lamplighter", "matchmaker", "wolf"]).state);
    s = g.onPlayerRemoved!(s, "p5", ctx(s.deadline - 1000)).state;
    s = ring(s).state;
    const r = g.getResult(s)!;
    expect(r.headline).toBe("Wolves win");
    expect(r.winnerIds).toEqual(["p0"]);
    expect(r.standings.at(-1)!.label).toBe("Wolf, left");
  });

  it("is null until it's over", () => {
    expect(g.getResult(toVote(six()))).toBeNull();
  });

  it("the reveal tells the whole night in order, and both ballots", () => {
    let s = toNight(six());
    s = runNight(s, { p1: ["p0"], p2: ["p3", "p4"] });
    s = ok(act(s, HOST, { type: "next" })).state;
    s = vote(s, { p0: "p1", p1: "p0", p2: "p0", p3: "p1", p4: NOBODY, p5: "p2" }).state;
    s = vote(s, { p0: "p1", p1: "p0", p2: "p0", p3: "p0", p4: "p0", p5: "p1" }).state;
    const pub = g.getPublicState(s);
    expect(pub.cards).toEqual({ p0: "wolf", p1: "lamplighter", p2: "matchmaker", p3: "bellringer", p4: "gossip", p5: "wolf" });
    expect(pub.night!.map((e) => [e.role, e.holders, e.targets, e.result?.kind])).toEqual([
      ["wolf", ["p0", "p5"], [], "wolves"],
      ["lamplighter", ["p1"], ["p0"], "lamp"],
      ["matchmaker", ["p2"], ["p3", "p4"], "match"],
      ["bellringer", ["p3"], [], "bell"],
      ["gossip", ["p4"], [], "gossip"],
    ]);
    expect(pub.votes).toEqual({ p0: "p1", p1: "p0", p2: "p0", p3: "p1", p4: NOBODY, p5: "p2" });
    expect(pub.runoffVotes).toEqual({ p0: "p1", p1: "p0", p2: "p0", p3: "p0", p4: "p0", p5: "p1" });
    expect(pub).toMatchObject({ out: "p0", winner: "village", tied: ["p0", "p1"] });
  });
});

describe("rematch", () => {
  it("carries nothing over and deals afresh", () => {
    expect(g.carryOver).toBeUndefined();
    const first = g.createGame(players(6), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx(0, 11)).state;
    const again = g.createGame(players(6), DEFAULT_SETTINGS, { roundNumber: 2, dealerSeat: 0, carry: { cards: first.cards } }, ctx(0, 12)).state;
    expect(again.phase).toBe("reveal");
    expect(again.results).not.toEqual(first.results);
  });
});

