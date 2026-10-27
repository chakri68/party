import { describe, expect, it } from "vitest";
import { deckOf, type RoleId } from "../shared/roles.ts";
import { DEFAULT_SETTINGS, REVEAL_MS, RUNOFF_MS, SKIP, VOTE_MS } from "../shared/types.ts";
import { act, alive, ctx, err, g, HOST, leave, night, ok, players, ring, type S, start, toNight, toVote, types, vote } from "./helpers.ts";

/** p0 villager (host), p1 wolf, p2 watcher, p3 keeper, p4 villager, p5 wolf, p6 villager. */
const SEVEN: RoleId[] = ["villager", "wolf", "watcher", "keeper", "villager", "wolf", "villager"];
const seven = (seed = 1) => start([...SEVEN], {}, seed).state;
/** At night 1, nobody's picked. */
const nightOne = (seed = 1) => toNight(seven(seed));
/** The day after a quiet night (the Wolves don't pick). */
const dayOne = () => ring(nightOne()).state;

describe("the deal", () => {
  it("deals the preset's deck, one card each, shuffled", () => {
    const t = g.createGame(players(8), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx(0, 3));
    const counts: Record<string, number> = {};
    for (const c of Object.values(t.state.cards)) counts[c] = (counts[c] ?? 0) + 1;
    expect(counts).toEqual(deckOf(DEFAULT_SETTINGS, 8));
    expect(t.state.deck).toEqual({ wolf: 2, watcher: 1, villager: 5 });
    // Role order, whatever the deal.
    expect(Object.keys(t.state.deck)).toEqual(["wolf", "watcher", "villager"]);
  });

  it("deals differently on another seed", () => {
    const deal = (seed: number) => JSON.stringify(g.createGame(players(9), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx(0, seed)).state.cards);
    expect(new Set([1, 2, 3, 4, 5].map(deal)).size).toBeGreaterThan(1);
  });

  it("refuses a deck that doesn't fit, and a table out of range", () => {
    const bad = { ...DEFAULT_SETTINGS, preset: "custom", "n:wolf": 1, "n:villager": 2 } as const;
    expect(() => g.createGame(players(5), bad, { roundNumber: 1, dealerSeat: 0 }, ctx())).toThrow("Need exactly 5 role cards");
    expect(() => g.createGame(players(4), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx())).toThrow("needs 5–12");
    expect(() => g.createGame(players(13), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx())).toThrow("needs 5–12");
  });

  it("asks setupProblem the same thing the lobby does", () => {
    expect(g.setupProblem!(DEFAULT_SETTINGS, 6)).toBeNull();
    expect(g.setupProblem!({ ...DEFAULT_SETTINGS, preset: "custom", "n:wolf": 3, "n:villager": 3 }, 6)).toBe("Wolves must be fewer than everyone else");
  });

  it("opens on the reveal with its 30 s clock, round 0", () => {
    const t = start([...SEVEN]);
    expect(t.state).toMatchObject({ phase: "reveal", deadline: REVEAL_MS, phaseMs: REVEAL_MS, round: 0 });
    expect(t.timers).toEqual([{ kind: "set", timerId: "phase", delayMs: REVEAL_MS }]);
  });

  it("refuses a test deck with no wolf or nothing but wolves", () => {
    expect(() => start(["villager", "villager", "villager", "villager", "villager"])).toThrow("test deck");
    expect(() => start(["wolf", "wolf", "wolf", "wolf", "wolf"])).toThrow("test deck");
  });
});

describe("the reveal", () => {
  it("ends when everyone's tapped Got it", () => {
    let s = seven();
    for (const id of alive(s).slice(0, 6)) s = ok(act(s, id, { type: "ack" })).state;
    expect(s.phase).toBe("reveal");
    const t = ok(act(s, "p6", { type: "ack" }));
    expect(t.state).toMatchObject({ phase: "night", round: 1, phaseMs: 30_000 });
    expect(t.events.map((e) => e.event)).toEqual([{ type: "night", round: 1 }]);
  });

  it("or when the clock runs out", () => {
    expect(ring(seven()).state).toMatchObject({ phase: "night", round: 1 });
  });

  it("doesn't wait for the disconnected", () => {
    let s = g.onPlayerDisconnected!(seven(), "p3", ctx(1000)).state;
    for (const id of alive(s).filter((id) => id !== "p3")) s = ok(act(s, id, { type: "ack" })).state;
    expect(s.phase).toBe("night");
  });

  it("names who hasn't looked, and the host can skip them", () => {
    let s = seven();
    for (const id of ["p0", "p1", "p2", "p3", "p4", "p5"]) s = ok(act(s, id, { type: "ack" })).state;
    expect(g.getAwaitedPlayerIds(s)).toEqual(["p6"]);
    s = g.skipTurn!(s, "p6", ctx(1000)).state;
    expect(s.phase).toBe("night");
  });

  it("refuses night moves and votes", () => {
    expect(err(act(seven(), "p1", { type: "pick", target: "p0" }))).toBe("wrong-phase");
    expect(err(act(seven(), "p1", { type: "vote", choice: "p0" }))).toBe("wrong-phase");
  });
});

describe("the night", () => {
  it("runs its full length whoever's picked, names nobody, then dawn", () => {
    let s = nightOne();
    const before = s.deadline;
    expect(g.getAwaitedPlayerIds(s)).toEqual([]);
    for (const [id, target] of Object.entries({ p1: "p4", p5: "p4", p2: "p1", p3: "p0" })) {
      const t = ok(act(s, id, { type: "pick", target }));
      expect(t.events).toEqual([]);
      expect(t.timers).toEqual([]);
      s = t.state;
    }
    expect(s).toMatchObject({ phase: "night", deadline: before });
    expect(g.getAwaitedPlayerIds(s)).toEqual([]);
  });

  it("takes the host's night and talking time", () => {
    let s = toNight(start([...SEVEN], { nightSeconds: 45, discussMinutes: 5 }).state);
    expect(s.phaseMs).toBe(45_000);
    s = ring(s).state;
    expect(s).toMatchObject({ phase: "day", phaseMs: 5 * 60_000 });
  });

  it("the Wolves' shared pick is taken, and dawn says their team", () => {
    const t = night(nightOne(), { p1: "p4", p5: "p4" });
    expect(t.state.phase).toBe("day");
    expect(t.state.players.find((p) => p.id === "p4")!.dead).toBe(true);
    expect(t.events.map((e) => e.event)).toEqual([{ type: "dawn", died: "p4", team: "village" }]);
    expect(g.getPublicState(t.state).dawns).toEqual([{ night: 1, died: "p4", team: "village" }]);
    expect(g.getPublicState(t.state).players.find((p) => p.id === "p4")).toMatchObject({ dead: true, team: "village" });
  });

  it("the plurality wins; one Wolf picking is enough", () => {
    const t = night(nightOne(), { p5: "p6" });
    expect(t.state.nights[0]).toMatchObject({ target: "p6", died: "p6", wolfVotes: { p5: "p6" } });
  });

  it("a split pack is settled by the seed, the same way every time", () => {
    const run = (seed: number) => night(nightOne(seed), { p1: "p4", p5: "p6" }).state.nights[0]!.target;
    const first = run(1);
    expect(["p4", "p6"]).toContain(first);
    expect(run(1)).toBe(first);
    const many = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(run));
    expect(many.size).toBe(2);
  });

  it("the tie-break hangs on the match seed alone, not the RNG at the close", () => {
    const s = ok(act(ok(act(nightOne(), "p1", { type: "pick", target: "p4" })).state, "p5", { type: "pick", target: "p6" })).state;
    const target = (rng: number) => g.onTimer!(s, "phase", ctx(s.deadline, rng)).state.nights[0]!.target;
    expect(new Set([1, 2, 3, 99, 12345].map(target)).size).toBe(1);
  });

  it("no Wolf picks, nobody's taken", () => {
    const t = night(nightOne(), { p3: "p0", p2: "p1" });
    expect(t.state.nights[0]).toMatchObject({ target: null, died: null });
    expect(t.events.map((e) => e.event)).toEqual([{ type: "dawn", died: null, team: null }]);
  });

  it("the Keeper's shelter saves the target, and dawn doesn't say so", () => {
    const t = night(nightOne(), { p1: "p4", p5: "p4", p3: "p4" });
    expect(t.state.nights[0]).toMatchObject({ target: "p4", sheltered: "p4", died: null });
    expect(alive(t.state)).toContain("p4");
    expect(g.getPublicState(t.state).dawns).toEqual([{ night: 1, died: null, team: null }]);
  });

  it("the Keeper may shelter themselves, but not the same player two nights running", () => {
    let s = night(nightOne(), { p1: "p3", p3: "p3" }).state;
    expect(s.nights[0]!.died).toBeNull();
    s = vote(toVote(s), {}).state; // nobody votes: nobody goes
    s = ring(s).state;
    expect(s).toMatchObject({ phase: "night", round: 2 });
    expect(g.getPrivateState(s, "p3")).toMatchObject({ lastShelter: "p3" });
    // Taken, silently, as no shelter at all: p0 is the Wolves' target and dies.
    const repeat = ok(act(s, "p3", { type: "pick", target: "p3" })).state;
    expect(g.getPrivateState(repeat, "p3").pick).toBe(SKIP);
    const t = night(repeat, { p1: "p0" });
    expect(t.state.nights[1]).toMatchObject({ sheltered: null, died: "p0" });
    expect(t.state.lastShelter).toBeNull();
    ok(act(s, "p3", { type: "pick", target: "p0" }));
  });

  it("a Keeper who missed a night may shelter anyone the next", () => {
    let s = night(nightOne(), { p3: "p0" }).state;
    s = ring(toVote(s)).state; // vote runs out, nobody goes
    s = night(s, {}).state; // night 2: no shelter
    s = ring(toVote(s)).state;
    expect(s).toMatchObject({ phase: "night", round: 3, lastShelter: null });
    ok(act(s, "p3", { type: "pick", target: "p0" }));
  });

  it("the Watcher's reading shows from dawn, true either way", () => {
    let s = nightOne();
    s = ok(act(s, "p2", { type: "pick", target: "p5" })).state;
    expect(g.getPrivateState(s, "p2")).toMatchObject({ pick: "p5", readings: [] });
    s = ring(s).state;
    expect(g.getPrivateState(s, "p2").readings).toEqual([{ night: 1, target: "p5", wolf: true }]);
    s = ring(toVote(s)).state;
    s = night(s, { p2: "p0" }).state;
    expect(g.getPrivateState(s, "p2").readings).toEqual([
      { night: 1, target: "p5", wolf: true },
      { night: 2, target: "p0", wolf: false },
    ]);
  });

  it("the Watcher still learns when taken the same night", () => {
    const s = night(nightOne(), { p1: "p2", p2: "p1" }).state;
    expect(s.nights[0]).toMatchObject({ died: "p2", read: "p1", readWolf: true });
    expect(g.getPrivateState(s, "p2").readings).toEqual([{ night: 1, target: "p1", wolf: true }]);
  });

  it("takes a pick the card can't make as no pick, silently, like Heist's crew Sabotage", () => {
    const s = nightOne();
    // A Wolf on a packmate or themselves abstains; the Watcher on themselves learns nothing.
    for (const [id, target] of [["p1", "p5"], ["p1", "p1"], ["p2", "p2"]] as const) {
      const t = ok(act(s, id, { type: "pick", target }));
      expect(t.events).toEqual([]);
      expect(g.getPrivateState(t.state, id).pick).toBe(SKIP);
      expect(err(act(t.state, id, { type: "pick", target: "p0" }))).toBe("already");
    }
    let t = ok(act(s, "p1", { type: "pick", target: "p5" })).state;
    t = ok(act(t, "p5", { type: "pick", target: "p1" })).state;
    t = ok(act(t, "p2", { type: "pick", target: "p2" })).state;
    const dawn = ring(t).state;
    expect(dawn.nights[0]).toMatchObject({ target: null, died: null, read: null });
    expect(g.getPrivateState(dawn, "p2").readings).toEqual([]);
    expect(err(act(s, "p0", { type: "pick", target: "p1" }))).toBe("no-pick");
    expect(err(act(s, "p1", { type: "pick", target: "nobody-here" }))).toBe("bad-pick");
  });

  it("locks a pick once made", () => {
    const s = ok(act(nightOne(), "p1", { type: "pick", target: "p4" })).state;
    expect(err(act(s, "p1", { type: "pick", target: "p6" }))).toBe("already");
  });

  it("shows the pack each other's picks; nobody else", () => {
    const s = ok(act(nightOne(), "p1", { type: "pick", target: "p4" })).state;
    expect(g.getPrivateState(s, "p5")).toMatchObject({ pack: ["p1", "p5"], packPicks: { p1: "p4" }, pick: null });
    expect(g.getPrivateState(s, "p1")).toMatchObject({ pick: "p4" });
    expect(g.getPrivateState(s, "p0")).toMatchObject({ pack: null, packPicks: null, pick: null });
  });

  it("every living player is picking; the dead aren't and can't", () => {
    let s = night(nightOne(), { p1: "p4" }).state;
    s = ring(toVote(s)).state;
    expect(s.phase).toBe("night");
    for (const id of alive(s)) expect(g.getPrivateState(s, id).picking).toBe(true);
    expect(g.getPrivateState(s, "p4").picking).toBe(false);
    expect(err(act(s, "p1", { type: "pick", target: "p4" }))).toBe("bad-pick");
    expect(err(act(s, "p4", { type: "ack" }))).toBe("dead");
  });

  it("an early alarm puts the deadline back; a stray timer id does nothing", () => {
    const s = nightOne();
    const early = g.onTimer!(s, "phase", ctx(s.deadline - 5000));
    expect(early.state).toBe(s);
    expect(early.timers).toEqual([{ kind: "set", timerId: "phase", delayMs: 5000 }]);
    expect(g.onTimer!(s, "other", ctx(s.deadline)).state).toBe(s);
  });

  it("refuses moves after the deadline", () => {
    const s = nightOne();
    expect(err(act(s, "p1", { type: "pick", target: "p4" }, s.deadline))).toBe("time-up");
  });
});

describe("the day", () => {
  it("runs to its clock, then the vote", () => {
    const s = dayOne();
    expect(s.phaseMs).toBe(2 * 60_000);
    const t = ring(s);
    expect(t.state).toMatchObject({ phase: "vote", phaseMs: VOTE_MS });
    expect(types(t)).toEqual(["vote-open"]);
  });

  it("only the host can call the vote early, and only by day", () => {
    const s = dayOne();
    expect(err(act(s, "p1", { type: "next" }))).toBe("host-only");
    expect(err(act(nightOne(), HOST, { type: "next" }))).toBe("wrong-phase");
    expect(toVote(s).phase).toBe("vote");
  });

  it("a dead host can still call it", () => {
    const s = night(nightOne(), { p1: "p0" }).state;
    expect(s.players[0]!.dead).toBe(true);
    expect(toVote(s).phase).toBe("vote");
  });
});

describe("the vote", () => {
  it("most votes goes out, their team is announced, then the next night", () => {
    const s = toVote(dayOne());
    const t = vote(s, { p0: "p1", p2: "p1", p3: "p1", p4: "p6", p1: "p4", p5: "p4", p6: SKIP });
    expect(t.state).toMatchObject({ phase: "night", round: 2 });
    expect(t.state.players[1]!.dead).toBe(true);
    expect(types(t)).toEqual(["verdict", "night"]);
    expect(t.events[0]!.event).toEqual({ type: "verdict", out: "p1", team: "wolves" });
    expect(t.state.days[0]).toMatchObject({ day: 1, out: "p1", team: "wolves", tied: [], runoffVotes: null });
    expect(g.getPublicState(t.state).days[0]!.votes).toMatchObject({ p0: "p1", p6: SKIP });
  });

  it("closes early once every connected voter's in, not before", () => {
    let s = toVote(dayOne());
    s = g.onPlayerDisconnected!(s, "p6", ctx(s.deadline - 1000)).state;
    const t = vote(s, { p0: "p1", p1: "p2", p2: "p1", p3: "p1", p4: "p1" });
    expect(t.state.phase).toBe("vote");
    expect(vote(t.state, { p5: "p2" }).state.phase).toBe("night");
  });

  it("skips and no votes put nobody out", () => {
    let t = vote(toVote(dayOne()), Object.fromEntries(alive(dayOne()).map((id) => [id, SKIP])));
    expect(t.state.days[0]!.out).toBeNull();
    expect(t.events[0]!.event).toEqual({ type: "verdict", out: null, team: null });
    t = ring(toVote(dayOne()));
    expect(t.state.days[0]!.out).toBeNull();
    expect(t.state.phase).toBe("night");
  });

  it("refuses self votes, dead voters and dead candidates", () => {
    let s = night(nightOne(), { p1: "p4" }).state;
    s = toVote(s);
    expect(err(act(s, "p0", { type: "vote", choice: "p0" }))).toBe("self-vote");
    expect(err(act(s, "p4", { type: "vote", choice: "p0" }))).toBe("dead");
    expect(err(act(s, "p0", { type: "vote", choice: "p4" }))).toBe("bad-choice");
    expect(g.getPrivateState(s, "p4").choices).toEqual([]);
    expect(g.getPrivateState(s, "p0").choices).toEqual(["p1", "p2", "p3", "p5", "p6", SKIP]);
  });

  it("votes can change until the close; public sees only counts", () => {
    let s = toVote(dayOne());
    s = vote(s, { p0: "p1" }).state;
    s = vote(s, { p0: "p2" }).state;
    expect(g.getPrivateState(s, "p0").vote).toBe("p2");
    expect(g.getPublicState(s)).toMatchObject({ voted: 1, voters: 7, days: [] });
    expect(g.getAwaitedPlayerIds(s)).toEqual([]);
  });

  it("a tie goes to a 20 s runoff between the tied", () => {
    const t = vote(toVote(dayOne()), { p0: "p1", p2: "p1", p3: "p1", p1: "p4", p5: "p4", p6: "p4", p4: SKIP });
    expect(t.state).toMatchObject({ phase: "runoff", tied: ["p1", "p4"], phaseMs: RUNOFF_MS });
    expect(t.events.map((e) => e.event)).toEqual([{ type: "vote-open", runoff: true }]);
    expect(g.getPublicState(t.state).tied).toEqual(["p1", "p4"]);
    expect(g.getPrivateState(t.state, "p1").choices).toEqual(["p4", SKIP]);
    expect(g.getPrivateState(t.state, "p0").choices).toEqual(["p1", "p4", SKIP]);
    expect(err(act(t.state, "p0", { type: "vote", choice: "p2" }))).toBe("bad-choice");
  });

  it("the runoff's leader goes; both ballots are logged", () => {
    let s = vote(toVote(dayOne()), { p0: "p1", p2: "p1", p3: "p1", p1: "p4", p5: "p4", p6: "p4", p4: SKIP }).state;
    const t = vote(s, { p0: "p1", p2: "p1", p3: "p1", p1: "p4", p5: "p4", p6: SKIP, p4: "p1" });
    s = t.state;
    expect(s.days[0]).toMatchObject({ out: "p1", tied: ["p1", "p4"], runoffVotes: { p0: "p1", p6: SKIP } });
    expect(s.phase).toBe("night");
  });

  it("a runoff still tied, or empty, puts nobody out", () => {
    const tie = { p0: "p1", p2: "p1", p3: "p1", p1: "p4", p5: "p4", p6: "p4", p4: SKIP };
    let s = vote(toVote(dayOne()), tie).state;
    s = vote(s, tie).state;
    expect(s.days[0]!.out).toBeNull();
    s = vote(toVote(dayOne()), tie).state;
    s = ring(s).state;
    expect(s.days[0]!.out).toBeNull();
    expect(s.phase).toBe("night");
  });
});

describe("winning", () => {
  /** p0 villager, p1 wolf, p2 villager, p3 villager, p4 villager. */
  const FIVE: RoleId[] = ["villager", "wolf", "villager", "villager", "villager"];

  it("the village wins once the last Wolf is voted out", () => {
    const s = toVote(ring(toNight(start([...FIVE]).state)).state);
    const t = vote(s, { p0: "p1", p2: "p1", p3: "p1", p4: "p1", p1: "p0" });
    expect(t.state).toMatchObject({ phase: "finished", winner: "village", endReason: "done" });
    expect(types(t)).toEqual(["verdict", "game-over"]);
    expect(t.timers).toContainEqual({ kind: "cancel", timerId: "phase" });
    expect(g.getResult(t.state)).toMatchObject({ headline: "Village wins", winnerIds: ["p0", "p2", "p3", "p4"] });
  });

  it("the Wolves win at parity after a dawn", () => {
    // 1 wolf v 4: vote out a villager (3 left), take one at night (2 left), still 1 v 2.
    let s = toNight(start([...FIVE]).state);
    s = night(s, { p1: "p0" }).state; // 1 v 3
    s = vote(toVote(s), { p2: "p3", p3: "p4", p4: "p3", p1: "p3" }).state; // 1 v 2
    expect(s.phase).toBe("night");
    const t = night(s, { p1: "p2" }); // 1 v 1
    expect(t.state).toMatchObject({ phase: "finished", winner: "wolves" });
    expect(types(t)).toEqual(["dawn", "game-over"]);
    expect(g.getResult(t.state)).toMatchObject({ headline: "Wolves win", winnerIds: ["p1"] });
  });

  it("the Wolves win at parity after an execution", () => {
    let s = toNight(start([...FIVE]).state);
    s = night(s, { p1: "p0" }).state; // 1 v 3
    const t = vote(toVote(s), { p2: "p3", p3: "p2", p4: "p3", p1: "p3" }); // 1 v 2 ... not yet
    expect(t.state.phase).toBe("night");
    s = night(t.state, {}).state; // nobody taken
    const end = vote(toVote(s), { p2: "p4", p4: "p2", p1: "p4" }); // 1 v 1
    expect(end.state).toMatchObject({ phase: "finished", winner: "wolves" });
    expect(types(end)).toEqual(["verdict", "game-over"]);
  });

  it("nothing happens once it's decided", () => {
    const s = vote(toVote(ring(toNight(start([...FIVE]).state)).state), { p0: "p1", p2: "p1", p3: "p1", p4: "p1", p1: "p0" }).state;
    expect(err(act(s, "p0", { type: "vote", choice: "p2" }, 1))).toBe("game-finished");
    expect(g.onTimer!(s, "phase", ctx(10 ** 9)).state).toBe(s);
    expect(g.onPlayerRemoved!(s, "p0", ctx(1)).state).toBe(s);
  });

  it("standings list cards, the dead and the winners first", () => {
    let s = night(nightOne(), { p1: "p4" }).state;
    s = vote(toVote(s), { p0: "p1", p2: "p1", p3: "p1", p5: "p0", p6: "p1", p1: "p0" }).state;
    s = night(s, {}).state;
    s = vote(toVote(s), { p0: "p5", p2: "p5", p3: "p5", p6: "p5", p5: "p0" }).state;
    expect(s).toMatchObject({ phase: "finished", winner: "village" });
    const r = g.getResult(s)!;
    expect(r.winnerIds).toEqual(["p0", "p2", "p3", "p4", "p6"]);
    expect(r.standings.find((x) => x.playerId === "p4")!.label).toBe("Villager, out, won");
    expect(r.standings.find((x) => x.playerId === "p1")!.label).toBe("Wolf, out, lost");
    expect(r.standings.at(-1)!.value).toBe(0);
  });

  it("a 12-player game on the clock alone ends with a winner", () => {
    const t = g.createGame(players(12), { ...DEFAULT_SETTINGS, preset: "full" }, { roundNumber: 1, dealerSeat: 0 }, ctx(0, 9));
    let s = t.state;
    // The Wolves take the first living non-Wolf in seat order; the village never votes.
    for (let i = 0; i < 100 && s.phase !== "finished"; i++) {
      if (s.phase === "night") {
        const prey = alive(s).find((id) => s.cards[id] !== "wolf")!;
        for (const w of alive(s).filter((id) => s.cards[id] === "wolf")) s = ok(act(s, w, { type: "pick", target: prey })).state;
      }
      s = ring(s).state;
    }
    expect(s).toMatchObject({ phase: "finished", winner: "wolves", endReason: "done" });
    expect(s.nights.length).toBeGreaterThan(1);
  });
});

describe("leaving", () => {
  const isAbandoned = (s: S, id: string) => s.players.find((p) => p.id === id)!.abandoned;

  it("during the reveal: left now, abandoned when night falls", () => {
    let s = leave(seven(), "p6").state;
    expect(s.players[6]).toMatchObject({ left: true, abandoned: false });
    expect(g.getPublicState(s).players[6]).toMatchObject({ left: true, abandoned: false, dead: false, team: null });
    s = toNight(s);
    expect(isAbandoned(s, "p6")).toBe(true);
    expect(err(act(s, "p6", { type: "pick", target: "p0" }))).toBe("not-in-game");
  });

  it("the only Wolf leaving in the reveal interrupts at nightfall", () => {
    const FIVE: RoleId[] = ["villager", "wolf", "villager", "villager", "villager"];
    let s = leave(start(FIVE).state, "p1").state;
    expect(s.phase).toBe("reveal");
    const t = ring(s);
    expect(t.state).toMatchObject({ phase: "finished", winner: null, endReason: "abandoned" });
    expect(g.getResult(t.state)).toMatchObject({ headline: "Interrupted: a side left the game", winnerIds: [] });
    expect(g.getPublicState(t.state).cards).not.toBeNull();
  });

  it("at night: a Wolf's pick goes with them, and picks for a leaver are dropped", () => {
    let s = nightOne();
    s = ok(act(s, "p1", { type: "pick", target: "p4" })).state;
    s = ok(act(s, "p5", { type: "pick", target: "p6" })).state;
    s = leave(s, "p1").state;
    expect(s.pack!.votes).toEqual({ p5: "p6" });
    s = leave(s, "p6").state;
    expect(s.pack!.votes).toEqual({});
    expect(g.getPrivateState(s, "p5").pick).toBeNull();
    const t = ring(s);
    expect(t.state.nights[0]).toMatchObject({ target: null, died: null });
    expect(isAbandoned(t.state, "p1")).toBe(true);
    expect(isAbandoned(t.state, "p6")).toBe(true);
    // 1 v 4, play on.
    expect(t.state.phase).toBe("day");
  });

  it("by day: abandoned when the vote opens, and not on the ballot", () => {
    let s = leave(dayOne(), "p6").state;
    expect(isAbandoned(s, "p6")).toBe(false);
    s = toVote(s);
    expect(isAbandoned(s, "p6")).toBe(true);
    expect(s.ballot!.eligible).not.toContain("p6");
    expect(g.getPrivateState(s, "p0").choices).not.toContain("p6");
  });

  it("mid-vote: votes for and by them are dropped, abandoned at the close", () => {
    let s = toVote(dayOne());
    s = vote(s, { p0: "p6", p2: "p6", p6: "p1" }).state;
    s = leave(s, "p6").state;
    expect(s.ballot!.votes).toEqual({});
    expect(s.ballot!.eligible).not.toContain("p6");
    const t = vote(s, { p0: "p1", p2: "p1", p3: "p1", p4: "p1", p1: "p0", p5: "p0" });
    expect(t.state.days[0]!.out).toBe("p1");
    expect(isAbandoned(t.state, "p6")).toBe(true);
  });

  it("a runoff left with one candidate closes with nobody out", () => {
    let s = vote(toVote(dayOne()), { p0: "p1", p2: "p1", p3: "p1", p1: "p4", p5: "p4", p6: "p4", p4: SKIP }).state;
    expect(s.phase).toBe("runoff");
    const t = leave(s, "p4");
    expect(t.state.days[0]).toMatchObject({ out: null, tied: ["p1"] });
    expect(t.state).toMatchObject({ phase: "night", round: 2 });
    expect(isAbandoned(t.state, "p4")).toBe(true);
  });

  it("a three-way runoff that loses one goes on between two", () => {
    let s = toVote(dayOne());
    s = vote(s, { p0: "p1", p1: "p0", p2: "p4", p3: "p1", p4: "p0", p5: "p4", p6: SKIP }).state;
    expect(s.tied).toEqual(["p0", "p1", "p4"]);
    s = leave(s, "p4").state;
    expect(s).toMatchObject({ phase: "runoff", tied: ["p0", "p1"] });
  });

  it("the last Wolf leaving by day interrupts the game; it doesn't hand the village a win", () => {
    const FIVE: RoleId[] = ["villager", "wolf", "villager", "villager", "villager"];
    let s = ring(toNight(start(FIVE).state)).state;
    s = leave(s, "p1").state;
    expect(s.phase).toBe("day");
    const t = ok(act(s, HOST, { type: "next" }));
    expect(t.state).toMatchObject({ phase: "finished", winner: null, endReason: "abandoned" });
    expect(types(t)).toEqual(["game-over"]);
  });

  it("the last Wolf leaving mid-vote interrupts at the close", () => {
    const FIVE: RoleId[] = ["villager", "wolf", "villager", "villager", "villager"];
    let s = toVote(ring(toNight(start(FIVE).state)).state);
    s = vote(s, { p0: "p1", p2: "p1" }).state;
    const t = ring(leave(s, "p1").state);
    expect(t.state).toMatchObject({ phase: "finished", endReason: "abandoned", winner: null });
    expect(t.state.days).toEqual([]);
  });

  it("one Wolf leaving and the other voted out interrupts; it isn't a village win", () => {
    let s = toVote(dayOne());
    s = leave(s, "p5").state;
    const t = vote(s, { p0: "p1", p2: "p1", p3: "p1", p4: "p1", p6: "p1", p1: "p0" });
    expect(t.state.days[0]!.out).toBe("p1");
    expect(t.state).toMatchObject({ phase: "finished", winner: null, endReason: "abandoned" });
    expect(g.getResult(t.state)!.winnerIds).toEqual([]);
  });

  it("every non-Wolf leaving interrupts too", () => {
    let s = dayOne();
    for (const id of ["p0", "p2", "p3", "p4", "p6"]) s = leave(s, id).state;
    expect(ring(s).state).toMatchObject({ phase: "finished", endReason: "abandoned" });
  });

  it("a leave that brings the Wolves to parity interrupts the game at the next boundary", () => {
    // 1 wolf v 4. Night: take one (1 v 3). Two villagers leave by day: 1 v 1 without them.
    const FIVE: RoleId[] = ["villager", "wolf", "villager", "villager", "villager"];
    let s = night(toNight(start(FIVE).state), { p1: "p0" }).state;
    s = leave(leave(s, "p2").state, "p3").state;
    const t = ok(act(s, HOST, { type: "next" }));
    expect(t.state).toMatchObject({ phase: "finished", winner: null, endReason: "abandoned" });
    expect(g.getResult(t.state)!.winnerIds).toEqual([]);
  });

  it("an execution and a leave in the same vote, parity only without the leaver: interrupted", () => {
    const FIVE: RoleId[] = ["villager", "wolf", "villager", "villager", "villager"];
    let s = toVote(night(toNight(start(FIVE).state), { p1: "p0" }).state); // 1 v 3
    s = leave(s, "p2").state;
    const t = vote(s, { p1: "p3", p4: "p3", p3: "p4" });
    expect(t.state.days[0]!.out).toBe("p3");
    // With p2: 1 v 2, undecided. Without: 1 v 1.
    expect(t.state).toMatchObject({ phase: "finished", winner: null, endReason: "abandoned" });
  });

  it("a night kill and a leave the same night, parity only with the leave: interrupted", () => {
    const FIVE: RoleId[] = ["villager", "wolf", "villager", "villager", "villager"];
    let s = night(toNight(start(FIVE).state), { p1: "p0" }).state; // 1 v 3
    s = ring(toVote(s)).state; // nobody goes
    s = ok(act(s, "p1", { type: "pick", target: "p3" })).state;
    s = leave(s, "p2").state;
    const t = ring(s);
    expect(t.state.nights[1]).toMatchObject({ died: "p3" });
    expect(t.state).toMatchObject({ phase: "finished", winner: null, endReason: "abandoned" });
  });

  it("a night kill alone reaching parity is the Wolves' win, even if someone also left", () => {
    let s = night(nightOne(), { p1: "p4" }).state; // 2 v 4
    s = vote(toVote(s), { p0: "p6", p1: "p6", p2: "p6", p3: "p6", p5: "p6", p6: "p0" }).state; // 2 v 3
    expect(s).toMatchObject({ phase: "night", round: 2 });
    s = ok(act(s, "p1", { type: "pick", target: "p0" })).state;
    s = leave(s, "p5").state; // a Wolf walks out
    const t = ring(s);
    expect(t.state.nights[1]!.died).toBe("p0");
    // Counting p5 as still in: 2 v 2. A real win.
    expect(t.state).toMatchObject({ phase: "finished", winner: "wolves", endReason: "done" });
    expect(g.getResult(t.state)!.winnerIds).toEqual(["p1"]);
  });

  it("any pick aimed at a leaver is dropped, so its picker can pick again", () => {
    let s = nightOne();
    s = ok(act(s, "p3", { type: "pick", target: "p6" })).state;
    s = ok(act(s, "p2", { type: "pick", target: "p6" })).state;
    s = leave(s, "p6").state;
    expect(s.picks).toEqual({});
    expect(g.getPrivateState(s, "p3").pick).toBeNull();
    ok(act(s, "p3", { type: "pick", target: "p0" }));
  });

  it("the dead leaving changes nothing", () => {
    let s = night(nightOne(), { p1: "p4" }).state;
    s = leave(s, "p4").state;
    expect(s.players[4]).toMatchObject({ dead: true, left: true, abandoned: false });
    s = toVote(s);
    expect(s.players[4]!.abandoned).toBe(false);
    expect(s.phase).toBe("vote");
  });

  it("leaving twice, or after the end, is a no-op", () => {
    const s = leave(seven(), "p6").state;
    expect(leave(s, "p6").state).toBe(s);
  });

  it("disconnects hold nothing, and reconnecting picks up where they were", () => {
    let s = nightOne();
    s = g.onPlayerDisconnected!(s, "p1", ctx(1000)).state;
    expect(s.players[1]!.away).toBe(true);
    s = g.onPlayerReconnected!(s, "p1", ctx(2000)).state;
    expect(s.players[1]!.away).toBe(false);
    expect(g.getPrivateState(s, "p1")).toMatchObject({ role: "wolf", picking: true });
  });
});

describe("rematch", () => {
  it("deals fresh and carries nothing", () => {
    expect(g.carryOver).toBeUndefined();
    const a = g.createGame(players(9), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx(0, 1)).state;
    const b = g.createGame(players(9), DEFAULT_SETTINGS, { roundNumber: 2, dealerSeat: 0, carry: { cards: a.cards } }, ctx(0, 2)).state;
    expect(b).toMatchObject({ phase: "reveal", round: 0, nights: [], days: [], readings: [], lastShelter: null });
    expect(JSON.stringify(b.cards)).not.toBe(JSON.stringify(a.cards));
  });
});
