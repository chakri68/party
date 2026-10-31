import { describe, expect, it } from "vitest";
import { BUDGET, crewSizes, usualMoles } from "../shared/rules.ts";
import { DEFAULT_SETTINGS, REVEAL_MS, TIMERS } from "../shared/types.ts";
import { act, ctx, err, g, leaderId, ok, players, playJob, propose, ring, runJob, type S, size, start, toPropose, types, voteAll } from "./helpers.ts";

const B = TIMERS.beginner;
/** p1 and p3 are the moles. Sizes 2 2 3 3 3. */
const FIVE = "cmcmc";
const five = (seed = 1) => toPropose(start(FIVE, {}, seed).state);

describe("the deal", () => {
  it("deals the usual moles, shuffled, two Sabotage cards each", () => {
    for (const n of [5, 6, 7, 8, 9, 10]) {
      const s = g.createGame(players(n), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx(0, n)).state;
      const moles = Object.keys(s.alignment).filter((id) => s.alignment[id] === "mole");
      expect(moles).toHaveLength(usualMoles(n));
      expect(s.budget).toEqual(Object.fromEntries(moles.map((id) => [id, BUDGET])));
    }
  });

  it("deals differently, and picks a different first leader, on other seeds", () => {
    const deal = (seed: number) => g.createGame(players(8), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx(0, seed)).state;
    expect(new Set([1, 2, 3, 4, 5, 6].map((s) => JSON.stringify(deal(s).alignment))).size).toBeGreaterThan(1);
    expect(new Set([1, 2, 3, 4, 5, 6].map((s) => deal(s).leader)).size).toBeGreaterThan(1);
  });

  it("takes one fewer mole when asked and it fits", () => {
    const s = g.createGame(players(7), { ...DEFAULT_SETTINGS, moles: "fewer" }, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
    expect(Object.values(s.alignment).filter((a) => a === "mole")).toHaveLength(2);
  });

  it("refuses what setupProblem refuses, and tables out of range", () => {
    const m = { roundNumber: 1, dealerSeat: 0 };
    expect(() => g.createGame(players(5), { ...DEFAULT_SETTINGS, moles: "fewer" }, m, ctx())).toThrow("5 players need at least 2 moles");
    expect(() => g.createGame(players(4), DEFAULT_SETTINGS, m, ctx())).toThrow("needs 5–10");
    expect(() => g.createGame(players(11), DEFAULT_SETTINGS, m, ctx())).toThrow("needs 5–10");
    expect(() => g.createGame(players(5), DEFAULT_SETTINGS, m, ctx(), { deck: ["crew", "crew", "crew", "crew", "crew"] })).toThrow("a test deck");
  });

  it("opens on the reveal with its 30 s clock", () => {
    const t = start(FIVE);
    expect(t.state).toMatchObject({ phase: "reveal", deadline: REVEAL_MS, phaseMs: REVEAL_MS, job: 0, heat: 0 });
    expect(t.timers).toEqual([{ kind: "set", timerId: "phase", delayMs: REVEAL_MS }]);
  });
});

describe("the reveal", () => {
  it("ends when everyone's tapped Got it, handing the first leader the clock", () => {
    let s = start(FIVE).state;
    for (const id of ["p0", "p1", "p2", "p3"]) s = ok(act(s, id, { type: "ack" })).state;
    expect(s.phase).toBe("reveal");
    const t = ok(act(s, "p4", { type: "ack" }));
    expect(t.state).toMatchObject({ phase: "propose", phaseMs: B.leaderMs });
    expect(t.events.map((e) => e.event)).toEqual([{ type: "propose", leader: "p0", job: 0 }]);
  });

  it("or when the clock runs out", () => {
    expect(ring(start(FIVE).state).state.phase).toBe("propose");
  });

  it("doesn't wait for the disconnected", () => {
    let s = start(FIVE).state;
    s = g.onPlayerDisconnected!(s, "p2", ctx(1000)).state;
    for (const id of ["p0", "p1", "p3", "p4"]) s = ok(act(s, id, { type: "ack" })).state;
    expect(s.phase).toBe("propose");
  });

  it("names who hasn't looked, and the host can skip them", () => {
    let s = start(FIVE).state;
    for (const id of ["p0", "p1", "p2", "p3"]) s = ok(act(s, id, { type: "ack" })).state;
    expect(g.getAwaitedPlayerIds(s)).toEqual(["p4"]);
    expect(g.skipTurn!(s, "p4", ctx(1000)).state.phase).toBe("propose");
  });

  it("never acks a leaver, and counts only who's still in", () => {
    let s = start("cmcmcmc").state;
    s = ok(act(s, "p6", { type: "ack" })).state;
    s = g.onPlayerRemoved!(s, "p6", ctx(1000)).state;
    expect(g.getPublicState(s).acked).toBe(0);
    s = g.onPlayerRemoved!(s, "p5", ctx(1000)).state;
    expect(g.skipTurn!(s, "p5", ctx(1000)).state.acks).not.toContain("p5");
  });

  it("refuses everything else", () => {
    const s = start(FIVE).state;
    expect(err(act(s, "p0", { type: "propose", crew: ["p0", "p1"] }))).toBe("wrong-phase");
    expect(err(act(s, "p0", { type: "vote", vote: "go" }))).toBe("wrong-phase");
  });
});

describe("the proposal", () => {
  it("only the leader, exactly the job's size, distinct players still in, self allowed", () => {
    const s = five();
    expect(leaderId(s)).toBe("p0");
    expect(size(s)).toBe(2);
    expect(err(act(s, "p1", { type: "propose", crew: ["p0", "p1"] }))).toBe("not-leader");
    expect(err(act(s, "p0", { type: "propose", crew: ["p0"] }))).toBe("bad-crew");
    expect(err(act(s, "p0", { type: "propose", crew: ["p0", "p1", "p2"] }))).toBe("bad-crew");
    expect(err(act(s, "p0", { type: "propose", crew: ["p1", "p1"] }))).toBe("bad-crew");
    expect(err(act(s, "p0", { type: "propose", crew: ["p1", "zz"] }))).toBe("bad-crew");
    const t = ok(act(s, "p0", { type: "propose", crew: ["p0", "p3"] }));
    expect(t.state).toMatchObject({ phase: "vote", crew: ["p0", "p3"], phaseMs: B.voteMs });
    expect(t.events.map((e) => e.event)).toEqual([{ type: "proposed", crew: ["p0", "p3"] }]);
    expect(g.getPublicState(t.state).crew).toEqual(["p0", "p3"]);
  });

  it("names only the leader as awaited", () => {
    expect(g.getAwaitedPlayerIds(five())).toEqual(["p0"]);
  });

  it("a leader who runs out the clock fails the proposal: heat +1, no auto-pick, next seat leads", () => {
    const t = ring(five());
    expect(t.state).toMatchObject({ phase: "propose", heat: 1, crew: [], phaseMs: B.leaderMs });
    expect(leaderId(t.state)).toBe("p1");
    expect(t.state.proposals).toEqual([{ job: 0, leader: "p0", crew: [], votes: {}, missed: [], passed: false, timedOut: true, voided: false }]);
    expect(types(t)).toEqual(["vote-closed", "propose"]);
  });

  it("the host's skip does the same as the clock", () => {
    const s = five();
    const t = g.skipTurn!(s, "p0", ctx(1000));
    expect(t.state).toMatchObject({ heat: 1, phase: "propose" });
    expect(leaderId(t.state)).toBe("p1");
    // Skipping someone who isn't leading does nothing.
    expect(g.skipTurn!(s, "p2", ctx(1000)).state).toBe(s);
  });

  it("an early alarm puts the deadline back; a stray timer id does nothing", () => {
    const s = five();
    const early = g.onTimer!(s, "phase", ctx(s.deadline - 5000));
    expect(early.state).toBe(s);
    expect(early.timers).toEqual([{ kind: "set", timerId: "phase", delayMs: 5000 }]);
    expect(g.onTimer!(s, "other", ctx(s.deadline)).state).toBe(s);
  });

  it("takes the preset's timers", () => {
    const s = toPropose(start(FIVE, { preset: "fast" }).state);
    expect(s.phaseMs).toBe(TIMERS.fast.leaderMs);
    const v = propose(s, ["p0", "p1"]);
    expect(v.phaseMs).toBe(TIMERS.fast.voteMs);
    expect(voteAll(v, "go").state.phaseMs).toBe(TIMERS.fast.cardMs);
  });
});

describe("the vote", () => {
  it("a strict majority of Go passes; votes come out by name; the leader moves on", () => {
    const s = propose(five(), ["p0", "p2"]);
    const t = voteAll(s, "go", { p1: "no-go", p3: "no-go" });
    expect(t.state).toMatchObject({ phase: "job", heat: 0, crew: ["p0", "p2"], phaseMs: B.cardMs });
    expect(leaderId(t.state)).toBe("p1");
    expect(t.state.proposals.at(-1)).toEqual({
      job: 0,
      leader: "p0",
      crew: ["p0", "p2"],
      votes: { p0: "go", p1: "no-go", p2: "go", p3: "no-go", p4: "go" },
      missed: [],
      passed: true,
      timedOut: false,
      voided: false,
    });
    expect(types(t)).toEqual(["vote-closed"]);
  });

  it("a tie fails: heat +1, next leader", () => {
    let s = toPropose(start("cmcmcc").state);
    s = propose(s, ["p0", "p2"]);
    const t = voteAll(s, "go", { p1: "no-go", p3: "no-go", p5: "no-go" });
    expect(t.state).toMatchObject({ phase: "propose", heat: 1 });
    expect(t.state.proposals.at(-1)!.passed).toBe(false);
    expect(leaderId(t.state)).toBe("p1");
  });

  it("missing votes are No-go at the clock, and marked missed", () => {
    let s = propose(five(), ["p0", "p2"]);
    for (const id of ["p0", "p2"]) s = ok(act(s, id, { type: "vote", vote: "go" })).state;
    const t = ring(s);
    expect(t.state).toMatchObject({ phase: "propose", heat: 1 });
    expect(t.state.proposals.at(-1)).toMatchObject({ votes: { p0: "go", p1: "no-go", p2: "go", p3: "no-go", p4: "no-go" }, missed: ["p1", "p3", "p4"] });
  });

  it("you can change your vote until it closes; it closes once everyone connected is in", () => {
    let s = propose(five(), ["p0", "p2"]);
    s = g.onPlayerDisconnected!(s, "p4", ctx(1000)).state;
    s = ok(act(s, "p0", { type: "vote", vote: "no-go" })).state;
    s = ok(act(s, "p0", { type: "vote", vote: "go" })).state;
    for (const id of ["p1", "p2"]) s = ok(act(s, id, { type: "vote", vote: "go" })).state;
    expect(s.phase).toBe("vote");
    const t = ok(act(s, "p3", { type: "vote", vote: "no-go" }));
    // 3 Go of 5: passes, the absent p4 counted as No-go.
    expect(t.state.phase).toBe("job");
    expect(t.state.proposals.at(-1)).toMatchObject({ passed: true, missed: ["p4"] });
  });

  it("shows a count while open, and names nobody", () => {
    let s = propose(five(), ["p0", "p2"]);
    s = ok(act(s, "p3", { type: "vote", vote: "go" })).state;
    const pub = g.getPublicState(s);
    expect(pub).toMatchObject({ voted: 1, voters: 5 });
    expect(JSON.stringify(pub)).not.toContain('"p3":"go"');
    expect(g.getAwaitedPlayerIds(s)).toEqual([]);
    expect(g.getPrivateState(s, "p3")).toMatchObject({ vote: "go", canVote: true });
    expect(g.getPrivateState(s, "p0")).toMatchObject({ vote: null, canVote: true });
  });

  it("refuses junk", () => {
    const s = propose(five(), ["p0", "p2"]);
    expect(g.parseAction({ type: "vote", vote: "maybe" })).toBeNull();
    expect(err(act(s, "p0", { type: "card", card: "clean" }))).toBe("wrong-phase");
  });
});

describe("heat", () => {
  it("three failed proposals lose the job to the moles and cool off", () => {
    let s = five();
    s = ring(s).state; // p0 times out
    s = voteAll(propose(s, ["p1", "p2"]), "no-go").state; // p1
    expect(s.heat).toBe(2);
    const t = voteAll(propose(s, ["p2", "p3"]), "no-go"); // p2
    expect(t.state).toMatchObject({ phase: "propose", heat: 0, job: 1, score: { crew: 0, mole: 1 } });
    expect(t.state.jobs).toEqual([{ job: 0, crew: [], sabotaged: 0, auto: 0, winner: "mole", heat: true }]);
    expect(leaderId(t.state)).toBe("p3");
    expect(types(t)).toEqual(["vote-closed", "job-done", "propose"]);
  });

  it("cools off after a played job too", () => {
    let s = five();
    s = ring(s).state;
    expect(s.heat).toBe(1);
    s = runJob(s, ["p1", "p2"]).state;
    expect(s).toMatchObject({ heat: 0, job: 1 });
  });
});

describe("the job", () => {
  const onJob = (crew = ["p0", "p1"]) => voteAll(propose(five(), crew), "go").state;

  it("anyone on the job may tap either card; nobody off it plays", () => {
    const s = onJob();
    expect(err(act(s, "p2", { type: "card", card: "clean" }))).toBe("not-on-job");
    const t = ok(act(s, "p0", { type: "card", card: "sabotage" }));
    expect(t.state.cards).toEqual({ p0: "sabotage" });
    // Crew get back exactly what a mole would: their tap, no error, no event.
    expect(g.getPrivateState(t.state, "p0")).toMatchObject({ card: "sabotage", onJob: true });
    expect(t.events).toEqual([]);
  });

  it("a crew member's Sabotage plays as Clean", () => {
    let s = onJob(["p0", "p2"]);
    s = ok(act(s, "p0", { type: "card", card: "sabotage" })).state;
    s = ok(act(s, "p2", { type: "card", card: "sabotage" })).state;
    const t = ring(s);
    expect(t.state.jobs.at(-1)).toMatchObject({ sabotaged: 0, auto: 0, winner: "crew" });
  });

  it("runs its full clock however fast the cards come in; cards can change till then", () => {
    let s = onJob();
    const deadline = s.deadline;
    s = ok(act(s, "p0", { type: "card", card: "clean" })).state;
    s = ok(act(s, "p1", { type: "card", card: "sabotage" })).state;
    const t = ok(act(s, "p1", { type: "card", card: "clean" }));
    expect(t.state).toMatchObject({ phase: "job", deadline });
    expect(t.events).toEqual([]);
    expect(ring(t.state).state.jobs.at(-1)).toMatchObject({ sabotaged: 0, winner: "crew" });
    expect(g.getAwaitedPlayerIds(s)).toEqual([]);
  });

  it("one Sabotage fails it; the table gets the count, the mole loses the card", () => {
    const t = playJob(onJob(["p1", "p3"]), { p1: "sabotage", p3: "sabotage" });
    expect(t.state.jobs).toEqual([{ job: 0, crew: ["p1", "p3"], sabotaged: 2, auto: 0, winner: "mole", heat: false }]);
    expect(t.state).toMatchObject({ phase: "propose", job: 1, score: { crew: 0, mole: 1 }, budget: { p1: 1, p3: 1 }, cards: {} });
    expect(t.events.map((e) => e.event)[0]).toEqual({ type: "job-done", job: 0, winner: "mole", sabotaged: 2, heat: false });
  });

  it("a mole with no cards left plays Clean whatever they tap", () => {
    let s = onJob(["p1", "p2"]);
    s = { ...s, budget: { ...s.budget, p1: 0 } };
    s = ok(act(s, "p1", { type: "card", card: "sabotage" })).state;
    expect(g.getPrivateState(s, "p1").budget).toBe(0);
    const t = ring(s);
    expect(t.state.jobs.at(-1)).toMatchObject({ sabotaged: 0, winner: "crew" });
    expect(t.state.budget.p1).toBe(0);
  });

  it("the clock plays Clean for anyone who didn't, and says how many without saying who", () => {
    let s = onJob(["p0", "p1"]);
    s = ok(act(s, "p0", { type: "card", card: "clean" })).state;
    const t = ring(s);
    expect(t.state.jobs.at(-1)).toMatchObject({ sabotaged: 0, auto: 1, winner: "crew" });
    expect(JSON.stringify(t.state.jobs)).not.toContain("p1\":");
  });

  it("shows each crew member their own card, nobody else", () => {
    const s = ok(act(onJob(), "p1", { type: "card", card: "sabotage" })).state;
    expect(g.getPrivateState(s, "p1")).toMatchObject({ onJob: true, card: "sabotage" });
    expect(g.getPrivateState(s, "p0")).toMatchObject({ onJob: true, card: null });
    expect(g.getPrivateState(s, "p2")).toMatchObject({ onJob: false, card: null });
  });
});

describe("winning", () => {
  it("the crew takes three clean jobs", () => {
    let s = five();
    s = runJob(s, ["p0", "p2"]).state; // leader p0
    s = runJob(s, ["p0", "p2"]).state; // p1
    const t = runJob(s, ["p0", "p2", "p4"]); // p2
    expect(t.state).toMatchObject({ phase: "finished", winner: "crew", endReason: "done", score: { crew: 3, mole: 0 } });
    expect(types(t).at(-1)).toBe("game-over");
    const r = g.getResult(t.state)!;
    expect(r.winnerIds.sort()).toEqual(["p0", "p2", "p4"]);
    expect(r.headline).toBe("The crew wins");
    expect(g.getPublicState(t.state).alignments).toEqual({ p0: "crew", p1: "mole", p2: "crew", p3: "mole", p4: "crew" });
  });

  it("the moles take three, by sabotage and by heat", () => {
    let s = five();
    s = runJob(s, ["p1", "p2"], { p1: "sabotage" }).state;
    s = runJob(s, ["p3", "p2"], { p3: "sabotage" }).state;
    for (let i = 0; i < 3; i++) s = ring(s).state;
    expect(s).toMatchObject({ phase: "finished", winner: "mole", score: { crew: 0, mole: 3 } });
    expect(g.getResult(s)!.headline).toBe("The moles win");
    expect(g.getResult(s)!.winnerIds.sort()).toEqual(["p1", "p3"]);
  });

  it("goes the distance at 3–2", () => {
    let s = five();
    s = runJob(s, ["p1", "p2"], { p1: "sabotage" }).state;
    s = runJob(s, ["p0", "p2"]).state;
    s = runJob(s, ["p3", "p2", "p4"], { p3: "sabotage" }).state;
    s = runJob(s, ["p0", "p2", "p4"]).state;
    expect(s).toMatchObject({ phase: "propose", job: 4, score: { crew: 2, mole: 2 } });
    s = runJob(s, ["p0", "p2", "p4"]).state;
    expect(s).toMatchObject({ phase: "finished", winner: "crew" });
    expect(s.jobs.map((j) => j.winner)).toEqual(["mole", "crew", "mole", "crew", "crew"]);
  });

  it("refuses moves once it's over", () => {
    let s = five();
    for (let i = 0; i < 9; i++) s = ring(s).state;
    expect(s.phase).toBe("finished");
    expect(err(act(s, "p0", { type: "ack" }, 0))).toBe("game-finished");
  });
});

describe("leaving", () => {
  const SEVEN = "cmcmcmc"; // moles p1 p3 p5; sizes 3 3 4 4 4
  const seven = () => toPropose(start(SEVEN).state);
  const leave = (s: S, id: string) => g.onPlayerRemoved!(s, id, ctx(s.deadline - 1000));

  it("a crew member leaving mid-vote voids the proposal: no heat, same leader again", () => {
    const s = propose(seven(), ["p0", "p2", "p4"]);
    const t = leave(s, "p2");
    expect(t.state).toMatchObject({ phase: "propose", heat: 0, crew: [], ballot: null, phaseMs: B.leaderMs });
    expect(leaderId(t.state)).toBe("p0");
    expect(t.state.proposals).toEqual([]);
    expect(types(t)).toEqual(["voided", "propose"]);
  });

  it("mid-job too, and Sabotage cards put in go back", () => {
    let s = voteAll(propose(seven(), ["p1", "p2", "p4"]), "go").state;
    s = ok(act(s, "p1", { type: "card", card: "sabotage" })).state;
    const t = leave(s, "p4");
    expect(t.state).toMatchObject({ phase: "propose", heat: 0, job: 0, cards: {}, budget: { p1: 2 } });
    // The lead had moved on at the vote; it comes back to whoever proposed.
    expect(leaderId(t.state)).toBe("p0");
    expect(t.state.jobs).toEqual([]);
    expect(t.state.proposals.at(-1)).toMatchObject({ passed: true, voided: true });
  });

  it("a leader on their own crew leaving hands the re-proposal to the next seat", () => {
    const t = leave(propose(seven(), ["p0", "p2", "p4"]), "p0");
    expect(t.state.phase).toBe("propose");
    expect(leaderId(t.state)).toBe("p1");
  });

  it("a leader off their own crew can leave mid-vote: it stands, and the lead moves on from their seat", () => {
    let s = leave(propose(seven(), ["p2", "p3", "p4"]), "p0").state;
    expect(s.phase).toBe("vote");
    s = voteAll(s, "go").state;
    expect(s.phase).toBe("job");
    expect(leaderId(s)).toBe("p1");
  });

  it("the next leader leaving mid-job passes the lead before it reaches them", () => {
    let s = voteAll(propose(seven(), ["p0", "p2", "p3"]), "go").state;
    expect(leaderId(s)).toBe("p1");
    s = leave(s, "p1").state;
    expect(s.phase).toBe("job");
    s = ring(s).state;
    expect(s.phase).toBe("propose");
    expect(leaderId(s)).toBe("p2");
  });

  it("a leader leaving while choosing passes the lead, no heat", () => {
    const t = leave(seven(), "p0");
    expect(t.state).toMatchObject({ phase: "propose", heat: 0 });
    expect(leaderId(t.state)).toBe("p1");
    expect(t.state.proposals).toEqual([]);
  });

  it("anyone else just drops out of the vote; the majority's of who's left", () => {
    let s = propose(seven(), ["p0", "p2", "p4"]);
    s = leave(s, "p6").state;
    expect(g.getPublicState(s).voters).toBe(6);
    // 3 Go of 6 is a tie: fails.
    const t = voteAll(s, "go", { p1: "no-go", p3: "no-go", p5: "no-go" });
    expect(t.state).toMatchObject({ phase: "propose", heat: 1 });
  });

  it("the rotation skips seats that left; sizes follow the head count", () => {
    let s = seven();
    expect(g.getPublicState(s).sizes).toEqual(crewSizes(7));
    s = leave(s, "p1").state; // not leading
    expect(g.getPublicState(s).sizes).toEqual(crewSizes(6));
    s = ring(s).state; // p0 times out
    expect(leaderId(s)).toBe("p2");
  });

  it("a leaver mid-reveal isn't waited for", () => {
    let s = start(SEVEN).state;
    for (const id of ["p0", "p1", "p2", "p3", "p4", "p5"]) s = ok(act(s, id, { type: "ack" })).state;
    expect(leave(s, "p6").state.phase).toBe("propose");
  });

  it("below five players: interrupted, no winner, everything shown", () => {
    const t = leave(five(), "p4");
    expect(t.state).toMatchObject({ phase: "finished", winner: null, endReason: "too-few" });
    expect(types(t)).toEqual(["game-over"]);
    expect(g.getResult(t.state)).toMatchObject({ winnerIds: [], headline: "Stopped: too few players left" });
    expect(g.getPublicState(t.state).alignments).not.toBeNull();
  });

  it("the last mole gone: interrupted", () => {
    let s = toPropose(start("cmcmcccc").state);
    s = leave(s, "p1").state;
    expect(s.phase).toBe("propose");
    const t = leave(s, "p3");
    expect(t.state).toMatchObject({ phase: "finished", winner: null, endReason: "no-moles" });
    expect(g.getResult(t.state)!.headline).toBe("Stopped: no moles left");
  });

  it("disconnects hold nothing; reconnecting changes nothing", () => {
    const s = seven();
    const away = g.onPlayerDisconnected!(s, "p0", ctx(1000)).state;
    expect(away.phase).toBe("propose");
    expect(g.onPlayerReconnected!(away, "p0", ctx(2000)).state.players[0]!.away).toBe(false);
  });
});

describe("rematch", () => {
  it("carries nothing over and deals afresh", () => {
    expect(g.carryOver).toBeUndefined();
    const first = g.createGame(players(8), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx(0, 11)).state;
    const again = g.createGame(players(8), DEFAULT_SETTINGS, { roundNumber: 2, dealerSeat: 0, carry: { x: 1 } }, ctx(0, 12)).state;
    expect(again).toMatchObject({ phase: "reveal", job: 0, heat: 0, proposals: [], jobs: [], score: { crew: 0, mole: 0 } });
    expect(again.alignment).not.toEqual(first.alignment);
  });

  it("a seat that isn't in the game gets nothing", () => {
    expect(g.getPrivateState(five(), "zz")).toMatchObject({ alignment: null, moles: null, budget: null, canVote: false, onJob: false });
  });
});
