import { describe, expect, it } from "vitest";
import { COUNTDOWN_MS, RACE_GRACE_MS, RESET_HOLD_MS, RESET_PENALTY_MS, type BlindRallyState } from "../shared/types.ts";
import { act, ctx, driveTo, east, finishRun, game, passCheckpoints, racing, refused, snapAt, SPAWN, TRACK } from "./helpers.ts";

// Steps 10 and 12: gates, the finish, resets, DNF, results, and drop-outs.
// p0 drives for p1, p2 for p3, p4 for p5. The stage opens at GO.

const GO = COUNTDOWN_MS;
const N = TRACK.checkpoints.length;
const cp = (checkpointId: number) => ({ type: "race.event" as const, kind: "cp" as const, checkpointId });
const finish = { type: "race.event" as const, kind: "finish" as const };
const run = (s: BlindRallyState, team = 1) => s.teams.find((t) => t.id === team)!.run!;
const team = (s: BlindRallyState, id: number) => game.getPublicState(s).teams.find((t) => t.id === id)!;
const one = () => racing([["p0", "p1"]]);
const two = () => racing([["p0", "p1"], ["p2", "p3"]]);
const three = () => racing([["p0", "p1"], ["p2", "p3"], ["p4", "p5"]]);
const types = (events: { event: { type: string } }[]) => events.map((e) => e.event.type);

describe("checkpoints", () => {
  it("count in order, from the Navigator, near the car", () => {
    const { state, now } = driveTo(one(), "p1", TRACK.checkpoints[0]!.position, GO);
    refused(state, "p0", cp(1), "not-navigator", ctx(now));
    const s = act(state, "p1", cp(1), ctx(now));
    expect(run(s).cp).toBe(1);
  });

  it("out of order is refused, and so is the same one twice", () => {
    let { state: s, now } = driveTo(one(), "p1", TRACK.checkpoints[1]!.position, GO);
    refused(s, "p1", cp(2), "out-of-order", ctx(now));
    refused(s, "p1", cp(3), "out-of-order", ctx(now));
    ({ state: s, now } = passCheckpoints(one(), "p1", 1, GO));
    refused(s, "p1", cp(1), "already-passed", ctx(now));
  });

  it("nowhere near the gate, or with no recent snapshot, is refused", () => {
    // On the line, claiming the first gate 285 m away.
    const s = game.onStream!(one(), "p1", snapAt(), ctx(GO))!.state;
    refused(s, "p1", cp(1), "too-far", ctx(GO));
    // At the gate, but the last snapshot is 3 s old.
    const { state: at, now } = driveTo(one(), "p1", TRACK.checkpoints[0]!.position, GO);
    refused(at, "p1", cp(1), "no-position", ctx(now + 3_000));
    // No snapshot at all.
    refused(one(), "p1", cp(1), "no-position", ctx(GO));
  });

  it("not before the start, not after the end", () => {
    const { state, now } = driveTo(one(), "p1", TRACK.checkpoints[0]!.position, GO);
    refused(state, "p1", cp(1), "wrong-phase", ctx(state.endsAt!));
    refused(one(), "p1", cp(1), "wrong-phase", ctx(GO - 1));
    expect(now).toBeLessThan(state.endsAt!);
  });
});

describe("finish", () => {
  it("counts only after every checkpoint", () => {
    let { state: s, now } = passCheckpoints(one(), "p1", N - 1, GO);
    ({ state: s, now } = driveTo(s, "p1", TRACK.finish.position, now));
    refused(s, "p1", finish, "checkpoints-missing", ctx(now));
    expect(run(s).status).toBe("running");
  });

  it("after all of them it does: effective time is elapsed plus penalties", () => {
    let s = act(one(), "p0", { type: "race.reset" }, ctx(GO + 1));
    s = game.onStream!(s, "p1", snapAt(), ctx(GO + 2))!.state;
    let now: number;
    ({ state: s, now } = passCheckpoints(s, "p1", N, GO + 2));
    ({ state: s, now } = driveTo(s, "p1", TRACK.finish.position, now));
    const r = game.handleAction(s, "p1", finish, ctx(now));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.transition.state;
    expect(run(s)).toMatchObject({ status: "finished", finishedAt: now });
    expect(team(s, 1).timeMs).toBe(now - GO + RESET_PENALTY_MS);
    // A one-car race is over the moment that car's home.
    expect(types(r.transition.events)).toEqual(["team-finished", "race-over"]);
    expect(s.phase).toBe("finished");
    expect(game.getResult(s)!.winnerIds.sort()).toEqual(["p0", "p1"]);
  });

  it("one car home doesn't end it while another's still out", () => {
    const { state: s } = finishRun(two(), "p1", GO);
    expect(s.phase).toBe("countdown");
    expect(team(s, 1).status).toBe("finished");
    expect(team(s, 2).status).toBe("running");
  });
});

describe("reset", () => {
  it("+5 s, back to the anchor after the last checkpoint the server counted, held a moment", () => {
    const { state, now } = passCheckpoints(one(), "p1", 2, GO);
    const r = game.handleAction(state, "p0", { type: "race.reset" }, ctx(now));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = r.transition.state;
    expect(run(s)).toMatchObject({ resets: 1, penaltyMs: RESET_PENALTY_MS, movedAt: now, holdUntil: now + RESET_HOLD_MS });
    expect(r.transition.events[1]).toEqual({ visibility: { kind: "private", playerId: "p1" }, event: { type: "recover", teamId: 1, checkpoint: 2, holdMs: RESET_HOLD_MS } });
    const nav = game.getPrivateState(s, "p1");
    expect(nav.role === "navigator" && nav.run).toEqual({ checkpoints: 2, checkpointCount: N, holdUntil: now + RESET_HOLD_MS, pins: { pin: null, trail: [] } });
  });

  it("can't skip a checkpoint: after it, the next one still has to be driven through", () => {
    let { state: s, now } = passCheckpoints(one(), "p1", 2, GO);
    s = act(s, "p0", { type: "race.reset" }, ctx(now));
    // Godot puts the car on anchor 2; the server takes that jump.
    s = game.onStream!(s, "p1", snapAt(TRACK.recovery[2]!.position), ctx(now + 100))!.state;
    // Claiming 4 is out of order; 3 is too far.
    refused(s, "p1", cp(4), "out-of-order", ctx(now + 200));
    refused(s, "p1", cp(3), "too-far", ctx(now + 200));
    ({ state: s } = passCheckpoints(s, "p1", 3, now + 200));
    expect(run(s).cp).toBe(3);
  });

  it("not while the team's paused", () => {
    const s = game.onPlayerDisconnected!(one(), "p1", ctx(GO)).state;
    refused(s, "p0", { type: "race.reset" }, "paused", ctx(GO + 1));
  });

  it("the Navigator's Godot may ask for one when the car's fallen out of the world, and pays the same", () => {
    const { state, now } = passCheckpoints(one(), "p1", 1, GO);
    // Not just because it'd like one, and never for a rival.
    refused(state, "p1", { type: "race.reset" }, "not-driver", ctx(now));
    refused(two(), "p3", { type: "race.reset", reason: "fell" }, "wrong-phase", ctx(COUNTDOWN_MS - 1));
    const r = game.handleAction(state, "p1", { type: "race.reset", reason: "fell" }, ctx(now));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(run(r.transition.state)).toMatchObject({ resets: 1, penaltyMs: RESET_PENALTY_MS, movedAt: now, holdUntil: now + RESET_HOLD_MS });
    expect(r.transition.events[1]).toEqual({ visibility: { kind: "private", playerId: "p1" }, event: { type: "recover", teamId: 1, checkpoint: 1, holdMs: RESET_HOLD_MS } });
    // Godot's car reappears on anchor 1, and that jump is the one the server takes.
    expect(game.onStream!(r.transition.state, "p1", snapAt(TRACK.recovery[1]!.position), ctx(now + 100))).not.toBeNull();
  });
});

describe("DNF and results", () => {
  it("whoever's out there at endsAt is DNF", () => {
    let { state: s } = passCheckpoints(two(), "p1", 3, GO);
    const out = game.onTimer!(s, "time-up", ctx(s.endsAt!));
    s = out.state;
    expect(s.phase).toBe("finished");
    expect([team(s, 1).status, team(s, 2).status]).toEqual(["dnf", "dnf"]);
    expect(types(out.events)).toEqual(["race-over"]);
  });

  it("finishers by effective time, then DNFs by checkpoints passed", () => {
    let s = three();
    let now: number;
    // Team 2 home first; team 1 home later with a reset; team 3 stuck after 2 gates.
    ({ state: s, now } = finishRun(s, "p3", GO));
    s = act(s, "p0", { type: "race.reset" }, ctx(GO + 1));
    s = game.onStream!(s, "p1", snapAt(), ctx(GO + 2))!.state;
    ({ state: s, now } = finishRun(s, "p1", GO + 2));
    ({ state: s } = passCheckpoints(s, "p5", 2, GO));
    s = game.onTimer!(s, "time-up", ctx(s.endsAt!)).state;
    const r = game.getResult(s)!;
    expect(r.winnerIds.sort()).toEqual(["p2", "p3"]);
    const labels = [...new Set(r.standings.map((x) => x.label))];
    expect(labels[0]).toMatch(new RegExp(`^1st · Team 2 · ${TRACK.name}\n\\d:\\d\\d\\.\\d$`));
    expect(labels[1]).toMatch(new RegExp(`^2nd · Team 1 · ${TRACK.name}\n\\d:\\d\\d\\.\\d \\(\\+5\u00a0s reset\\)$`));
    expect(labels[2]).toBe(`3rd · Team 3 · ${TRACK.name}\nDNF, 2/${N} checkpoints`);
    expect(r.standings.map((x) => x.value)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(now).toBeLessThan(s.endsAt!);
  });

  it("more checkpoints beats fewer among DNFs, and equal progress is a tie", () => {
    let s = three();
    ({ state: s } = passCheckpoints(s, "p1", 1, GO));
    ({ state: s } = passCheckpoints(s, "p3", 3, GO));
    ({ state: s } = passCheckpoints(s, "p5", 1, GO));
    s = game.onTimer!(s, "time-up", ctx(s.endsAt!)).state;
    const labels = [...new Set(game.getResult(s)!.standings.map((x) => x.label))];
    expect(labels).toEqual([
      `1st · Team 2 · ${TRACK.name}\nDNF, 3/${N} checkpoints`,
      `=2nd · Team 1 · ${TRACK.name}\nDNF, 1/${N} checkpoints`,
      `=2nd · Team 3 · ${TRACK.name}\nDNF, 1/${N} checkpoints`,
    ]);
    // Nobody finished, so nobody won.
    expect(game.getResult(s)!.winnerIds).toEqual([]);
  });

  it("equal times are a tie, at the board's precision (tenths), with both teams winning", () => {
    let s = two();
    // Same route, same clock: both over the line at the same moment, give or take 50 ms.
    let a: number;
    let b: number;
    ({ state: s, now: a } = finishRun(s, "p1", GO));
    ({ state: s, now: b } = passCheckpoints(s, "p3", N, GO));
    ({ state: s, now: b } = driveTo(s, "p3", TRACK.finish.position, b));
    expect(b).toBe(a);
    s = act(s, "p3", finish, ctx(b + 50));
    const r = game.getResult(s)!;
    const labels = [...new Set(r.standings.map((x) => x.label))];
    expect(labels.map((l) => l!.split(" · ")[0])).toEqual(["=1st", "=1st"]);
    expect(r.winnerIds.sort()).toEqual(["p0", "p1", "p2", "p3"]);
  });

  it("the race ends itself when the last car finishes or goes out", () => {
    let s = two();
    ({ state: s } = finishRun(s, "p1", GO));
    s = game.onPlayerDisconnected!(s, "p2", ctx(GO + 100_000)).state;
    const out = game.onTimer!(s, "grace:2", ctx(GO + 100_000 + RACE_GRACE_MS));
    expect(types(out.events)).toEqual(["team-out", "race-over"]);
    expect(out.state.phase).toBe("finished");
    expect(out.state.endedAt).toBe(GO + 100_000 + RACE_GRACE_MS);
  });
});

describe("drop-outs (spec §8.3)", () => {
  it("Driver gone: the team pauses, the Navigator is told to park, a 30 s grace starts", () => {
    const out = game.onPlayerDisconnected!(one(), "p0", ctx(GO + 1_000));
    expect(out.events).toEqual([{ visibility: { kind: "private", playerId: "p1" }, event: { type: "park", teamId: 1 } }]);
    expect(out.timers).toEqual([{ kind: "set", timerId: "grace:1", delayMs: RACE_GRACE_MS }]);
    expect(team(out.state, 1)).toMatchObject({ away: ["driver"], pausedSince: GO + 1_000, graceEndsAt: GO + 1_000 + RACE_GRACE_MS });
  });

  it("while paused, nothing the team sends counts", () => {
    let s = game.onStream!(one(), "p1", snapAt(), ctx(GO))!.state;
    const d = game.onPlayerDisconnected!(s, "p0", ctx(GO + 100)).state;
    expect(game.onStream!(d, "p1", snapAt(east(1)), ctx(GO + 200))).toBeNull();
    const n = game.onPlayerDisconnected!(s, "p1", ctx(GO + 100)).state;
    expect(game.onStream!(n, "p0", { t: "in", seq: 1, steer: 0, throttle: 1, brake: 0 }, ctx(GO + 200))).toBeNull();
    // Navigator gone: progress frozen, even if a stale socket still claims a gate.
    ({ state: s } = driveTo(s, "p1", TRACK.checkpoints[0]!.position, GO));
    const frozen = game.onPlayerDisconnected!(s, "p0", ctx(GO + 20_000)).state;
    refused(frozen, "p1", cp(1), "paused", ctx(GO + 20_000));
  });

  it("back within grace: resumes, the timer's cancelled, and the clock skipped the gap", () => {
    let s = game.onPlayerDisconnected!(one(), "p1", ctx(GO + 10_000)).state;
    const back = game.onPlayerReconnected!(s, "p1", ctx(GO + 22_000));
    expect(back.timers).toEqual([{ kind: "cancel", timerId: "grace:1" }]);
    s = back.state;
    expect(team(s, 1)).toMatchObject({ away: [], pausedMs: 12_000, pausedSince: null, graceEndsAt: null, status: "running" });
    // The timer firing anyway (a race with the cancel) does nothing now.
    expect(game.onTimer!(s, "grace:1", ctx(GO + 40_000)).state).toBe(s);
    // And the pause comes off their time.
    let now: number;
    ({ state: s, now } = finishRun(s, "p1", GO + 22_000));
    expect(team(s, 1).timeMs).toBe(now - GO - 12_000);
    expect(game.getResult(s)!.standings[0]!.label).toMatch(/\(12\.0\u00a0s paused\)$/);
  });

  it("a Navigator's fresh Godot may put the car back on the last accepted checkpoint's anchor", () => {
    let { state: s, now } = passCheckpoints(one(), "p1", 2, GO);
    s = game.onPlayerDisconnected!(s, "p1", ctx(now)).state;
    s = game.onPlayerReconnected!(s, "p1", ctx(now + 5_000)).state;
    expect(game.onStream!(s, "p1", snapAt(TRACK.recovery[2]!.position), ctx(now + 6_000))).not.toBeNull();
    // A Driver's return doesn't open that door.
    let t = passCheckpoints(one(), "p1", 2, GO);
    s = game.onPlayerDisconnected!(t.state, "p0", ctx(t.now)).state;
    s = game.onPlayerReconnected!(s, "p0", ctx(t.now + 5_000)).state;
    s = game.onStream!(s, "p1", snapAt(east(60, run(s).snap!.position)), ctx(t.now + 6_000))!.state;
    s = game.onStream!(s, "p1", snapAt(east(60, run(s).snap!.position)), ctx(t.now + 7_000))!.state;
    s = game.onStream!(s, "p1", snapAt(east(60, run(s).snap!.position)), ctx(t.now + 8_000))!.state;
    expect(game.onStream!(s, "p1", snapAt(TRACK.recovery[2]!.position), ctx(t.now + 8_100))).toBeNull();
  });

  it("grace runs out: DNF, and the pause still shows in the results", () => {
    let s = two();
    s = game.onPlayerDisconnected!(s, "p2", ctx(GO + 5_000)).state;
    const out = game.onTimer!(s, "grace:2", ctx(GO + 5_000 + RACE_GRACE_MS));
    s = out.state;
    expect(team(s, 2)).toMatchObject({ status: "dnf", pausedMs: RACE_GRACE_MS, pausedSince: null });
    expect(types(out.events)).toEqual(["team-out"]);
    expect(s.phase).toBe("countdown"); // team 1's still out there
    // Coming back after that changes nothing.
    expect(game.onPlayerReconnected!(s, "p2", ctx(GO + 40_000)).state).toBe(s);
    s = game.onTimer!(s, "time-up", ctx(s.endsAt!)).state;
    expect(game.getResult(s)!.standings.find((x) => x.playerId === "p2")!.label).toMatch(/30\.0\u00a0s paused/);
  });

  it("both gone: one grace from the first drop, not two; resumes only when both are back", () => {
    let s = game.onPlayerDisconnected!(one(), "p0", ctx(GO + 1_000)).state;
    const second = game.onPlayerDisconnected!(s, "p1", ctx(GO + 5_000));
    expect(second.timers).toEqual([]);
    s = second.state;
    expect(team(s, 1)).toMatchObject({ away: ["driver", "navigator"], graceEndsAt: GO + 1_000 + RACE_GRACE_MS });
    s = game.onPlayerReconnected!(s, "p0", ctx(GO + 8_000)).state;
    expect(team(s, 1)).toMatchObject({ away: ["navigator"], pausedSince: GO + 1_000 });
    s = game.onTimer!(s, "grace:1", ctx(GO + 1_000 + RACE_GRACE_MS)).state;
    expect(team(s, 1).status).toBe("dnf");
  });

  it("a drop in the countdown only stops the clock from the green light", () => {
    let s = game.onPlayerDisconnected!(one(), "p0", ctx(GO - 2_000)).state;
    s = game.onPlayerReconnected!(s, "p0", ctx(GO + 3_000)).state;
    expect(team(s, 1).pausedMs).toBe(3_000);
  });

  it("the team clock the client shows matches the server's, mid-pause too", async () => {
    const { teamClock } = await import("../client/role.ts");
    const s = game.onPlayerDisconnected!(one(), "p1", ctx(GO + 10_000)).state;
    const pub = game.getPublicState(s);
    // Frozen at 10 s while they're gone.
    expect(teamClock(pub, pub.teams[0], GO + 25_000)).toBe(10_000);
  });

  it("someone removed from the room mid-race puts their car out", () => {
    const out = game.onPlayerRemoved!(two(), "p3", ctx(GO + 1_000));
    expect(team(out.state, 2).status).toBe("dnf");
    expect(types(out.events)).toEqual(["team-out"]);
  });

  it("outside a race a drop is the room's business, not the game's", () => {
    const s = racing([["p0", "p1"]]);
    const done = act(s, "p0", { type: "race.end" }, ctx(GO + 1));
    expect(game.onPlayerDisconnected!(done, "p1", ctx(GO + 2)).state).toBe(done);
    // Spares don't pause anybody.
    const spare = racing([["p0", "p1"]], 3);
    expect(game.onPlayerDisconnected!(spare, "p2", ctx(GO)).state).toBe(spare);
    expect(SPAWN).toEqual(TRACK.spawn.position);
  });
});
