import { describe, expect, it } from "vitest";
import { notMyProblemGame as nmp } from "../server/game.ts";
import type { State } from "../server/state.ts";
import type { ActionKind, NmpEvent, ProblemKind } from "../shared/index.ts";
import { act, cardOf, ctx, fireTimer, player, start, tryAct, turnPlayer, type LooseAction } from "./helpers.ts";

// p1 plays first (dealer at seat 0). p1 holds fake-report-1, fake-report-2, spy-1, quick-fix-2, intern-1.
const hands: ActionKind[][] = [
  ["hr-complaint", "blame-game", "not-me", "quick-fix", "promotion"],
  ["fake-report", "spy", "quick-fix", "fake-report", "intern"],
  ["revenge", "not-me", "quick-fix", "blame-game", "hr-complaint"],
  ["revenge", "not-me", "hr-complaint", "blame-game", "promotion"],
];
const everyone = ["p0", "p1", "p2", "p3"];

/** p1 has drawn this Problem, after playing an Intern if `shield`. */
function withProblem(kind: ProblemKind = "server-down", shield = false): State {
  let s = start(4, { hands, pile: [kind, "spy", "spy", "spy"] });
  if (shield) s = act(s, "p1", { type: "play", cardId: "intern-1" }).state;
  return act(s, "p1", { type: "draw" }).state;
}

/** p1 plays Fake Report with this card face down. */
const report = (s: State, faceDownId: string, c = ctx()) =>
  act(s, "p1", { type: "fake-report", cardId: "fake-report-1", faceDownId }, c);

function rejected(state: State, playerId: string, action: LooseAction): string {
  const r = tryAct(state, playerId, action);
  if (r.ok) throw new Error("expected a rejection");
  return r.error.code;
}

const publicEvents = (t: { events: { visibility: { kind: string }; event: NmpEvent }[] }) =>
  t.events.filter((e) => e.visibility.kind === "public").map((e) => e.event);

describe("playing a Fake Report", () => {
  it("opens a challenge window and hides the face-down card", () => {
    const s0 = withProblem();
    expect(nmp.getPrivateState(s0, "p1").playable).toContainEqual({ cardId: "fake-report-1", targets: null });
    const t = report(s0, "spy-1");
    const s = t.state;
    expect(s.step).toBe("challenge");
    expect(t.timers).toContainEqual({ kind: "set", timerId: `step:${s.token}`, delayMs: 8000 });
    expect(nmp.getAwaitedPlayerIds(s)).toEqual([]);
    expect(player(s, "p1").hand.map((c) => c.id)).toEqual(["quick-fix-2", "fake-report-2", "intern-1"]);
    expect(publicEvents(t)).toEqual([{ type: "report", playerId: "p1" }]);
    expect(t.events.every((e) => e.visibility.kind === "public")).toBe(true);
    expect(nmp.getPublicState(s).report).toEqual({ ownerId: "p1" });
    expect(JSON.stringify(nmp.getPublicState(s))).not.toContain("spy-1");
    expect(nmp.getPrivateState(s, "p1")).toMatchObject({ myReportCard: { id: "spy-1", kind: "spy" }, canChallenge: false, canPass: false });
    for (const id of ["p0", "p2", "p3"]) {
      const view = nmp.getPrivateState(s, id);
      expect(JSON.stringify(view)).not.toContain("spy-1");
      expect(view).toMatchObject({ myReportCard: null, canChallenge: true, canPass: true });
    }
  });

  it("refuses the same card twice, cards not held, the wrong card and other players", () => {
    const s = withProblem();
    expect(rejected(s, "p1", { type: "fake-report", cardId: "fake-report-1", faceDownId: "fake-report-1" })).toBe("bad-card");
    expect(rejected(s, "p1", { type: "fake-report", cardId: "fake-report-1", faceDownId: "quick-fix-1" })).toBe("card-not-owned");
    expect(rejected(s, "p1", { type: "fake-report", cardId: "spy-1", faceDownId: "quick-fix-2" })).toBe("wrong-card");
    expect(rejected(s, "p2", { type: "fake-report", cardId: "quick-fix-3", faceDownId: "revenge-1" })).toBe("not-your-problem");
    const before = start(4, { hands, pile: ["server-down"] });
    expect(rejected(before, "p1", { type: "fake-report", cardId: "fake-report-1", faceDownId: "spy-1" })).toBe("wrong-time");
  });

  it("the second Fake Report may go face down", () => {
    const s = fireTimer(report(withProblem(), "fake-report-2").state).state;
    expect(s.problem).toBeNull();
    expect(s.hiddenDiscard.map((c) => c.id)).toEqual(["fake-report-2"]);
    expect(nmp.partyStats!(s)).toEqual({ p1: { liesTold: 1, liesUncaught: 1 } });
  });
});

describe("no challenge", () => {
  it("a lie nobody calls fixes the Problem and is never shown", () => {
    const s0 = report(withProblem(), "spy-1").state;
    const t = fireTimer(s0);
    const s = t.state;
    expect(s.problem).toBeNull();
    expect(s.report).toBeNull();
    expect(s.hiddenDiscard.map((c) => c.id)).toEqual(["spy-1"]);
    expect(s.discard.map((c) => c.id)).toEqual(["fake-report-1"]);
    expect(s.resolvedProblems.map((c) => c.id)).toEqual(["server-down-1"]);
    expect(player(s, "p1").warnings).toBe(0);
    expect(turnPlayer(s)).toBe("p2");
    expect(publicEvents(t)).toContainEqual({ type: "fixed", playerId: "p1", by: "report" });
    expect(JSON.stringify(t.events)).not.toContain("spy-1");
    expect(JSON.stringify(nmp.getPublicState(s))).not.toContain("spy-1");
    expect(nmp.partyStats!(s)).toEqual({ p1: { liesTold: 1, liesUncaught: 1 } });
  });

  it("a true report nobody calls gives no lie stats", () => {
    const s = fireTimer(report(withProblem(), "quick-fix-2").state).state;
    expect(s.problem).toBeNull();
    expect(s.hiddenDiscard.map((c) => c.id)).toEqual(["quick-fix-2"]);
    expect(nmp.partyStats!(s)).toEqual({});
  });

  it("the window closes early once everyone eligible has passed", () => {
    let s = report(withProblem(), "spy-1").state;
    expect(rejected(s, "p1", { type: "pass" })).toBe("not-eligible");
    s = act(s, "p0", { type: "pass" }).state;
    expect(rejected(s, "p0", { type: "pass" })).toBe("passed");
    expect(rejected(s, "p0", { type: "challenge" })).toBe("passed");
    expect(nmp.getPrivateState(s, "p0")).toMatchObject({ canChallenge: false, canPass: false });
    s = act(s, "p2", { type: "pass" }).state;
    expect(s.step).toBe("challenge");
    s = act(s, "p3", { type: "pass" }).state;
    expect(s.problem).toBeNull();
    expect(s.hiddenDiscard.map((c) => c.id)).toEqual(["spy-1"]);
    expect(turnPlayer(s)).toBe("p2");
  });

  it("with nobody here to challenge, the report goes through at once", () => {
    const s0 = withProblem();
    for (const i of [0, 2, 3]) s0.players[i]!.away = true;
    const s = report(s0, "spy-1").state;
    expect(s.step).toBe("action");
    expect(s.problem).toBeNull();
    expect(turnPlayer(s)).toBe("p2");
    expect(nmp.partyStats!(s)).toEqual({ p1: { liesTold: 1, liesUncaught: 1 } });
  });

  it("away and fired players can't challenge", () => {
    const s0 = withProblem();
    s0.players[0]!.away = true;
    s0.players[3]!.fired = true;
    const s = report(s0, "spy-1").state;
    expect(rejected(s, "p0", { type: "challenge" })).toBe("not-eligible");
    expect(rejected(s, "p3", { type: "challenge" })).toBe("not-in-game");
    expect(rejected(s, "p1", { type: "challenge" })).toBe("not-eligible");
    expect(nmp.getPrivateState(s, "p0").canChallenge).toBe(false);
    // Only p2 may answer, so one pass closes it.
    expect(act(s, "p2", { type: "pass" }).state.problem).toBeNull();
  });
});

describe("challenges", () => {
  it("a caught lie on Server Down gives the bluffer 2 warnings", () => {
    const s0 = report(withProblem("server-down"), "spy-1").state;
    const t = act(s0, "p2", { type: "challenge" });
    const s = t.state;
    expect(publicEvents(t)).toContainEqual({ type: "challenged", challengerId: "p2", ownerId: "p1", card: { id: "spy-1", kind: "spy" }, lied: true });
    expect(player(s, "p1").warnings).toBe(2);
    expect(player(s, "p2").warnings).toBe(0);
    expect(s.problem).toBeNull();
    expect(s.report).toBeNull();
    expect(s.resolvedProblems.map((c) => c.id)).toEqual(["server-down-1"]);
    expect(s.discard.map((c) => c.id)).toEqual(expect.arrayContaining(["fake-report-1", "spy-1"]));
    expect(s.hiddenDiscard).toEqual([]);
    expect(turnPlayer(s)).toBe("p2");
    expect(nmp.partyStats!(s)).toEqual({ p1: { liesTold: 1 }, p2: { rightCalls: 1 } });
  });

  it("a caught lie on Data Leak with a shield gives 3 minus 1", () => {
    const s0 = report(withProblem("data-leak", true), "spy-1").state;
    expect(player(s0, "p1").shield?.id).toBe("intern-1");
    const t = act(s0, "p0", { type: "challenge" });
    expect(player(t.state, "p1").warnings).toBe(2);
    expect(player(t.state, "p1").shield).toBeNull();
    expect(publicEvents(t)).toContainEqual({ type: "warned", playerId: "p1", amount: 2, shielded: true });
    expect(nmp.partyStats!(t.state)).toEqual({ p1: { liesTold: 1 }, p0: { rightCalls: 1 } });
  });

  it("a caught lie that fires the bluffer ends their Problem", () => {
    const s0 = withProblem("data-leak");
    s0.players[1]!.warnings = 1;
    const s = act(report(s0, "spy-1").state, "p3", { type: "challenge" }).state;
    expect(player(s, "p1")).toMatchObject({ fired: true, warnings: 3, hand: [] });
    expect(s.problem).toBeNull();
    expect(turnPlayer(s)).toBe("p2");
  });

  it("a wrong challenge gives the challenger 1 warning and fixes the Problem", () => {
    const s0 = report(withProblem("data-leak"), "quick-fix-2").state;
    const t = act(s0, "p2", { type: "challenge" });
    const s = t.state;
    expect(publicEvents(t)).toContainEqual({ type: "challenged", challengerId: "p2", ownerId: "p1", card: { id: "quick-fix-2", kind: "quick-fix" }, lied: false });
    expect(publicEvents(t)).toContainEqual({ type: "fixed", playerId: "p1", by: "report" });
    expect(player(s, "p2").warnings).toBe(1);
    expect(player(s, "p1").warnings).toBe(0);
    expect(s.problem).toBeNull();
    expect(s.resolvedProblems.map((c) => c.id)).toEqual(["data-leak-1"]);
    expect(s.discard.map((c) => c.id)).toEqual(expect.arrayContaining(["fake-report-1", "quick-fix-2"]));
    expect(turnPlayer(s)).toBe("p2");
    expect(nmp.partyStats!(s)).toEqual({ p2: { wrongCalls: 1 } });
  });

  it("a wrong challenger with a shield loses the shield only", () => {
    const s0 = report(withProblem(), "quick-fix-2").state;
    s0.players[2]!.shield = { id: "intern-9", kind: "intern" };
    const s = act(s0, "p2", { type: "challenge" }).state;
    expect(player(s, "p2")).toMatchObject({ warnings: 0, shield: null });
  });

  it("a wrong challenger fired by it: the Problem is still fixed and play goes on", () => {
    const s0 = report(withProblem(), "quick-fix-2").state;
    s0.players[3]!.warnings = 2;
    const s = act(s0, "p3", { type: "challenge" }).state;
    expect(player(s, "p3").fired).toBe(true);
    expect(s.problem).toBeNull();
    expect(s.resolvedProblems.map((c) => c.id)).toEqual(["server-down-1"]);
    expect(s.step).toBe("action");
    expect(turnPlayer(s)).toBe("p2");
  });

  it("a wrong challenge that leaves one survivor ends the game", () => {
    const s0 = withProblem();
    s0.players[0]!.fired = true;
    s0.players[3]!.fired = true;
    s0.players[2]!.warnings = 2;
    const s = act(report(s0, "quick-fix-2").state, "p2", { type: "challenge" }).state;
    expect(s.step).toBe("finished");
    expect(s.winnerIds).toEqual(["p1"]);
  });

  it("a second challenge after the first is too late and reveals nothing new", () => {
    const s0 = report(withProblem(), "spy-1").state;
    const token = s0.token;
    const after = act(s0, "p2", { type: "challenge" }).state;
    const r = nmp.handleAction(after, "p3", { type: "challenge", token }, ctx());
    expect(r).toEqual({ ok: false, error: { code: "too-late", message: "Too late." } });
    const p = nmp.handleAction(after, "p0", { type: "pass", token }, ctx());
    expect(p.ok === false && p.error.code).toBe("too-late");
    expect(player(after, "p3").warnings).toBe(0);
  });

  it("a stale timer after a challenge does nothing", () => {
    const s0 = report(withProblem(), "spy-1").state;
    const after = act(s0, "p2", { type: "challenge" }).state;
    const t = nmp.onTimer!(after, `step:${s0.token}`, ctx());
    expect(t.state).toBe(after);
    expect(t.events).toEqual([]);
  });

  it("challenge and pass are refused outside the window", () => {
    const s = withProblem();
    expect(rejected(s, "p2", { type: "challenge" })).toBe("wrong-time");
    const w = report(s, "spy-1").state;
    expect(rejected(w, "p1", { type: "accept" })).toBe("wrong-time");
    expect(rejected(w, "p1", { type: "fix", cardId: "quick-fix-2" })).toBe("wrong-time");
  });
});

describe("party stats", () => {
  it("never appear in the public or private states", () => {
    // p1 lies and is caught; then p2 passes a Problem on (problemsPassed).
    let s = act(report(withProblem(), "spy-1").state, "p2", { type: "challenge" }).state;
    expect(nmp.partyStats!(s)).toEqual({ p1: { liesTold: 1 }, p2: { rightCalls: 1 } });
    s.stats.p2!.problemsPassed = 1;
    const views = [nmp.getPublicState(s), ...everyone.map((id) => nmp.getPrivateState(s, id))];
    for (const v of views) {
      const json = JSON.stringify(v);
      expect(json).not.toContain("liesTold");
      expect(json).not.toContain("problemsPassed");
      expect(json).not.toContain("rightCalls");
    }
    // Still hidden during an open window.
    s = report(withProblem(), "spy-1").state;
    s.stats = { p1: { liesTold: 4, problemsPassed: 2 } };
    for (const v of [nmp.getPublicState(s), ...everyone.map((id) => nmp.getPrivateState(s, id))]) {
      expect(JSON.stringify(v)).not.toMatch(/liesTold|problemsPassed/);
    }
    expect(cardOf(s, "p1", "quick-fix")).toBe("quick-fix-2");
  });
});
