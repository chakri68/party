import { describe, expect, it } from "vitest";
import { notMyProblemGame as nmp } from "../server/game.ts";
import { alive, type State } from "../server/state.ts";
import type { ActionKind, NmpEvent, ProblemKind } from "../shared/index.ts";
import { act, cardOf, ctx, fireTimer, player, start, turnPlayer } from "./helpers.ts";

// p1 plays first (dealer at seat 0). Only p0 and p2 hold a Quick Fix.
const hands: ActionKind[][] = [
  ["hr-complaint", "blame-game", "not-me", "quick-fix", "promotion"],
  ["blame-game", "blame-game", "fake-report", "revenge", "hr-complaint"],
  ["revenge", "not-me", "quick-fix", "blame-game", "hr-complaint"],
  ["revenge", "not-me", "hr-complaint", "blame-game", "promotion"],
];

function withProblem(kind: ProblemKind = "server-down"): State {
  const s = start(4, { hands, pile: [kind, "spy", "spy", "spy"] });
  return act(s, "p1", { type: "draw" }).state;
}

const remove = (s: State, id: string, c = ctx()) => nmp.onPlayerRemoved!(s, id, c);
const away = (s: State, id: string, c = ctx()) => nmp.onPlayerDisconnected!(s, id, c);
const blame = (s: State, from: string, to: string, c = ctx()) =>
  act(s, from, { type: "blame", cardId: cardOf(s, from, "blame-game"), targetId: to }, c).state;
const publicEvents = (t: { events: { visibility: { kind: string }; event: NmpEvent }[] }) =>
  t.events.filter((e) => e.visibility.kind === "public").map((e) => e.event);

/** A finished game, or a timed step whose awaited players are all still in. A new step sets its timer. */
function expectValid(t: { state: State; timers?: { kind: string; timerId: string }[] }, prev?: State) {
  const s = t.state;
  for (const id of nmp.getAwaitedPlayerIds(s)) expect(alive(player(s, id))).toBe(true);
  if (s.step === "finished") return;
  expect(s.deadline).not.toBeNull();
  if (prev && prev.token === s.token) return;
  expect(t.timers ?? []).toContainEqual(expect.objectContaining({ kind: "set", timerId: `step:${s.token}` }));
}

describe("removal", () => {
  it("of the turn player in the action step ends the turn", () => {
    const s0 = start(4, { hands, pile: ["spy", "spy"] });
    const t = remove(s0, "p1");
    expectValid(t);
    expect(t.state.step).toBe("action");
    expect(turnPlayer(t.state)).toBe("p2");
    expect(player(t.state, "p1")).toMatchObject({ removed: true, hand: [], shield: null, overtime: false });
    expect(t.state.discard.map((c) => c.id)).toEqual(s0.players[1]!.hand.map((c) => c.id));
    expect(publicEvents(t)).toContainEqual({ type: "removed", playerId: "p1" });
  });

  it("drops the leaver's shield and Overtime", () => {
    let s = start(4, { hands: [["intern", "overtime", "quick-fix", "spy", "spy"], ...hands.slice(1)], pile: ["spy", "spy", "spy", "spy", "spy"] }, {}, 3);
    // Dealer at seat 3: p0 plays first.
    s = act(s, "p0", { type: "play", cardId: "intern-1" }).state;
    s = act(s, "p0", { type: "play", cardId: "overtime-1", targetId: "p1" }).state;
    expect(player(s, "p1").overtime).toBe(true);
    const t = remove(s, "p1");
    expect(player(t.state, "p1").overtime).toBe(false);
    const u = remove(t.state, "p0");
    expectValid(u);
    expect(player(u.state, "p0").shield).toBeNull();
    expect(u.state.discard.map((c) => c.id)).toContain("intern-1");
  });

  it("of the Problem owner during an HR window discards the Problem and moves on", () => {
    let s = blame(withProblem(), "p1", "p2");
    s = act(s, "p2", { type: "accept" }).state;
    expect(s.step).toBe("hr");
    const t = remove(s, "p1");
    expectValid(t);
    expect(t.state.problem).toBeNull();
    expect(t.state.moves).toEqual([]);
    expect(t.state.resolvedProblems.map((c) => c.id)).toEqual(["server-down-1"]);
    expect(t.state.discard.map((c) => c.id)).toContain("blame-game-2");
    // p1 was the turn player too.
    expect(t.state.step).toBe("action");
    expect(turnPlayer(t.state)).toBe("p2");
  });

  it("of a Problem owner who is not the turn player lets the turn go on", () => {
    let s = blame(withProblem("server-down"), "p1", "p3");
    s = act(s, "p3", { type: "accept" }).state;
    for (const id of ["p0", "p2", "p3"]) s = act(s, id, { type: "pass" }).state;
    expect(s.problem?.ownerId).toBe("p3");
    const t = remove(s, "p3");
    expectValid(t);
    expect(t.state.problem).toBeNull();
    // p1 drew once, so the turn ends.
    expect(turnPlayer(t.state)).toBe("p2");
  });

  it("of the Blame Game target during the target window: the move fizzles", () => {
    const s = blame(withProblem(), "p1", "p2");
    expect(s.step).toBe("target");
    const t = remove(s, "p2");
    expectValid(t);
    expect(t.state.step).toBe("problem");
    expect(t.state.problem).toMatchObject({ ownerId: "p1", attempts: 1, lastMovedFromId: null });
    expect(t.state.moves).toEqual([]);
    expect(t.state.discard.map((c) => c.id)).toContain("blame-game-2");
    expect(t.timers).toContainEqual({ kind: "set", timerId: `step:${t.state.token}`, delayMs: 15000 });
    expect(nmp.getAwaitedPlayerIds(t.state)).toEqual(["p1"]);
    expect(t.events.some((e) => e.event.type === "moved")).toBe(false);
  });

  it("of the Blame Game target who accepted, during HR: the move fizzles", () => {
    let s = blame(withProblem(), "p1", "p2");
    s = act(s, "p2", { type: "accept" }).state;
    const t = remove(s, "p2");
    expectValid(t);
    expect(t.state.step).toBe("problem");
    expect(t.state.problem?.ownerId).toBe("p1");
    expect(t.state.stats.p1?.problemsPassed).toBeUndefined();
  });

  it("of the Revenge target during HR: the move fizzles and the owner keeps it", () => {
    let s = blame(withProblem(), "p1", "p2");
    s = act(s, "p2", { type: "revenge", cardId: "revenge-2", targetId: "p3" }).state;
    expect(s.step).toBe("hr");
    const t = remove(s, "p3");
    expectValid(t);
    expect(t.state.step).toBe("problem");
    expect(t.state.problem).toMatchObject({ ownerId: "p1", attempts: 2 });
    expect(t.state.discard.map((c) => c.id)).toEqual(expect.arrayContaining(["blame-game-2", "revenge-2"]));
  });

  it("of the Revenge player during HR keeps the window open", () => {
    let s = blame(withProblem(), "p1", "p2");
    s = act(s, "p2", { type: "revenge", cardId: "revenge-2", targetId: "p3" }).state;
    const t = remove(s, "p2");
    expectValid(t, s);
    expect(t.state.step).toBe("hr");
    s = t.state;
    for (const id of ["p0", "p1"]) s = act(s, id, { type: "pass" }).state;
    expect(s.step).toBe("hr");
    s = act(s, "p3", { type: "pass" }).state;
    expect(s.problem?.ownerId).toBe("p3");
  });

  it("of the last HR player who has not passed closes the window", () => {
    let s = blame(withProblem(), "p1", "p2");
    s = act(s, "p2", { type: "accept" }).state;
    s = act(s, "p0", { type: "pass" }).state;
    s = act(s, "p2", { type: "pass" }).state;
    expect(s.step).toBe("hr");
    const t = remove(s, "p3");
    expectValid(t);
    expect(t.state.step).toBe("problem");
    expect(t.state.problem?.ownerId).toBe("p2");
  });

  it("of the last challenger who has not passed closes the window", () => {
    let s = withProblem();
    s = act(s, "p1", { type: "fake-report", cardId: "fake-report-1", faceDownId: "revenge-1" }).state;
    s = act(s, "p0", { type: "pass" }).state;
    s = act(s, "p2", { type: "pass" }).state;
    const t = remove(s, "p3");
    expectValid(t);
    expect(t.state.problem).toBeNull();
    expect(t.state.hiddenDiscard.map((c) => c.id)).toEqual(["revenge-1"]);
  });

  it("of the Fake Report owner keeps the face-down card hidden", () => {
    let s = withProblem();
    s = act(s, "p1", { type: "fake-report", cardId: "fake-report-1", faceDownId: "revenge-1" }).state;
    const t = remove(s, "p1");
    expectValid(t);
    expect(t.state.report).toBeNull();
    expect(t.state.problem).toBeNull();
    expect(t.state.hiddenDiscard.map((c) => c.id)).toEqual(["revenge-1"]);
    expect(t.state.discard.map((c) => c.id)).toContain("fake-report-1");
    expect(JSON.stringify(t.events)).not.toContain("revenge-1");
    expect(JSON.stringify(nmp.getPublicState(t.state))).not.toContain("revenge-1");
  });

  it("of the turn player while someone else holds the Problem ends the turn after it", () => {
    let s = blame(withProblem(), "p1", "p2");
    s = act(s, "p2", { type: "accept" }).state;
    for (const id of ["p0", "p2", "p3"]) s = act(s, id, { type: "pass" }).state;
    let t = remove(s, "p1");
    expectValid(t, s);
    expect(t.state.step).toBe("problem");
    expect(t.state.turnOver).toBe(true);
    t = act(t.state, "p2", { type: "fix", cardId: "quick-fix-2" });
    expect(t.state.step).toBe("action");
    expect(turnPlayer(t.state)).toBe("p2");
  });

  it("leaving one player ends the game with that winner", () => {
    let s = start(3, { hands: hands.slice(0, 3), pile: ["spy", "spy"] });
    s = remove(s, "p2").state;
    const t = remove(s, "p0");
    expect(t.state.step).toBe("finished");
    expect(t.state.winnerIds).toEqual(["p1"]);
    expect(nmp.getResult(t.state)?.winnerIds).toEqual(["p1"]);
    expect(nmp.getAwaitedPlayerIds(t.state)).toEqual([]);
  });

  it("of a fired player keeps their fired place", () => {
    let s = blame(withProblem(), "p1", "p3");
    s = act(s, "p3", { type: "accept" }).state;
    for (const id of ["p0", "p2", "p3"]) s = act(s, id, { type: "pass" }).state;
    s.players[3]!.warnings = 2;
    // p3 holds no Quick Fix: the timeout gives the third warning.
    s = fireTimer(s, ctx(15000)).state;
    expect(player(s, "p3")).toMatchObject({ fired: true, firedOrder: 1 });
    s = remove(s, "p3").state;
    s = remove(s, "p0").state;
    s = remove(s, "p2").state;
    expect(s.step).toBe("finished");
    expect(nmp.getResult(s)!.standings.map((r) => [r.playerId, r.label])).toEqual([
      ["p1", "0 warnings"],
      ["p3", "Fired 1st"],
      ["p0", "left"],
      ["p2", "left"],
    ]);
  });

  it("twice, or after the end, changes nothing", () => {
    const s = remove(start(4, { hands, pile: ["spy"] }), "p3").state;
    const t = remove(s, "p3");
    expect(t.state).toBe(s);
    expect(t.events).toEqual([]);
  });
});

describe("disconnect", () => {
  it("of the target in the target window answers Accept", () => {
    const s = blame(withProblem(), "p1", "p2");
    const t = away(s, "p2");
    expectValid(t);
    expect(player(t.state, "p2").away).toBe(true);
    expect(t.state.step).toBe("hr");
    expect(t.state.moves.map((m) => m.kind)).toEqual(["blame"]);
    expect(nmp.getAwaitedPlayerIds(t.state)).toEqual([]);
  });

  it("of the last HR player who has not passed closes the window", () => {
    let s = blame(withProblem(), "p1", "p2");
    s = act(s, "p2", { type: "accept" }).state;
    s = act(s, "p0", { type: "pass" }).state;
    s = act(s, "p2", { type: "pass" }).state;
    const t = away(s, "p3");
    expectValid(t);
    expect(t.state.problem?.ownerId).toBe("p2");
    expect(t.state.step).toBe("problem");
  });

  it("of the last challenger who has not passed closes the window", () => {
    let s = withProblem();
    s = act(s, "p1", { type: "fake-report", cardId: "fake-report-1", faceDownId: "revenge-1" }).state;
    s = act(s, "p0", { type: "pass" }).state;
    s = act(s, "p3", { type: "pass" }).state;
    const t = away(s, "p2");
    expectValid(t);
    expect(t.state.problem).toBeNull();
  });

  it("of anyone else changes only the away flag, and reconnect clears it", () => {
    const s = withProblem();
    const t = away(s, "p3");
    expect(t.state.step).toBe("problem");
    expect(t.state.token).toBe(s.token);
    expect(t.events).toEqual([]);
    const back = nmp.onPlayerReconnected!(t.state, "p3", ctx());
    expect(player(back.state, "p3").away).toBe(false);
    expect(nmp.getPublicState(back.state).players[3]!.away).toBe(false);
  });

  it("does not stop an away player getting a Problem: the timer answers for them", () => {
    // p2 holds a Quick Fix: the timeout plays it.
    let s = away(withProblem(), "p2").state;
    s = blame(s, "p1", "p2");
    expect(s.step).toBe("hr");
    for (const id of ["p0", "p3"]) s = act(s, id, { type: "pass" }).state;
    expect(s.step).toBe("problem");
    expect(s.problem?.ownerId).toBe("p2");
    expect(nmp.getAwaitedPlayerIds(s)).toEqual(["p2"]);
    expect(s.deadline).toBe(15000);
    const t = fireTimer(s, ctx(15000));
    expect(t.events.map((e) => e.event)).toContainEqual({ type: "fixed", playerId: "p2", by: "quick-fix" });

    // p3 holds none: the timeout gives the warning.
    let u = away(withProblem(), "p3").state;
    u = blame(u, "p1", "p3");
    for (const id of ["p0", "p2"]) u = act(u, id, { type: "pass" }).state;
    expect(u.problem?.ownerId).toBe("p3");
    u = fireTimer(u, ctx(15000)).state;
    expect(player(u, "p3").warnings).toBe(1);
  });
});

describe("skipTurn", () => {
  it("of an idle Problem owner plays their Quick Fix", () => {
    let s = blame(withProblem(), "p1", "p2");
    s = act(s, "p2", { type: "accept" }).state;
    for (const id of ["p0", "p2", "p3"]) s = act(s, id, { type: "pass" }).state;
    const t = nmp.skipTurn!(s, "p2", ctx());
    expectValid(t);
    expect(t.events.map((e) => e.event)).toContainEqual({ type: "fixed", playerId: "p2", by: "quick-fix" });
    expect(t.state.discard.map((c) => c.id)).toContain("quick-fix-2");
  });

  it("of an idle Problem owner with no Quick Fix gives the warning", () => {
    const t = nmp.skipTurn!(withProblem(), "p1", ctx());
    expectValid(t);
    expect(player(t.state, "p1").warnings).toBe(1);
  });

  it("in the action step draws", () => {
    const s = start(4, { hands, pile: ["spy", "spy"] });
    const t = nmp.skipTurn!(s, "p1", ctx());
    expectValid(t);
    expect(player(t.state, "p1").hand.map((c) => c.id)).toContain("spy-1");
    expect(turnPlayer(t.state)).toBe("p2");
  });

  it("of the target answers Accept", () => {
    const t = nmp.skipTurn!(blame(withProblem(), "p1", "p2"), "p2", ctx());
    expectValid(t);
    expect(t.state.step).toBe("hr");
  });

  it("of a player the game is not waiting on changes nothing", () => {
    const s = withProblem();
    for (const id of ["p0", "p2", "p9"]) {
      const t = nmp.skipTurn!(s, id, ctx());
      expect(t.state).toBe(s);
      expect(t.events).toEqual([]);
    }
    let h = blame(s, "p1", "p2");
    h = act(h, "p2", { type: "accept" }).state;
    expect(nmp.skipTurn!(h, "p0", ctx()).state).toBe(h);
  });
});

describe("pause", () => {
  it("shifts the deadline by the time paused", () => {
    const s = start(4, { hands, pile: ["spy", "spy"] });
    expect(s.deadline).toBe(25000);
    const p = nmp.pause!(s, true, ctx(5000)).state;
    expect(p.pausedLeftMs).toBe(20000);
    const r = nmp.pause!(p, false, ctx(15000)).state;
    expect(r.deadline).toBe(35000);
    expect(r.pausedLeftMs).toBeNull();
  });

  it("resumes with no time left when paused after the deadline, before the timer fired", () => {
    const s = start(4, { hands, pile: ["spy", "spy"] });
    expect(s.deadline).toBe(25000);
    const p = nmp.pause!(s, true, ctx(26000)).state;
    expect(p.pausedLeftMs).toBe(0);
    const r = nmp.pause!(p, false, ctx(40000)).state;
    expect(r.deadline).toBe(40000);
    expect(r.pausedLeftMs).toBeNull();
  });

  it("keeps the time left of a step that began while paused", () => {
    const s = start(4, { hands, pile: ["spy", "spy"] });
    const p = nmp.pause!(s, true, ctx(5000)).state;
    // The room's clock stands still at the pause.
    const moved = remove(p, "p1", ctx(5000)).state;
    expect(moved.deadline).toBe(30000);
    const r = nmp.pause!(moved, false, ctx(15000)).state;
    expect(r.deadline).toBe(40000);
  });

  it("does nothing twice, or once the game is over", () => {
    const s = start(4, { hands, pile: ["spy", "spy"] });
    const p = nmp.pause!(s, true, ctx(5000)).state;
    expect(nmp.pause!(p, true, ctx(6000)).state).toBe(p);
    expect(nmp.pause!(s, false, ctx(6000)).state).toBe(s);
    let f = start(3, { hands: hands.slice(0, 3), pile: ["spy"] });
    f = remove(remove(f, "p0").state, "p2").state;
    expect(nmp.pause!(f, true, ctx(1)).state).toBe(f);
  });
});
