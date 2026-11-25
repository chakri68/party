import { describe, expect, it } from "vitest";
import { notMyProblemGame as nmp } from "../server/game.ts";
import type { State } from "../server/state.ts";
import type { ActionKind, NmpEvent, ProblemKind } from "../shared/index.ts";
import { act, cardOf, ctx, fireTimer, player, start, tryAct, turnPlayer, type LooseAction } from "./helpers.ts";

// p1 plays first (dealer at seat 0). A = p1, B = p2, C = p3, D = p0.
const hands: ActionKind[][] = [
  ["hr-complaint", "blame-game", "not-me", "quick-fix", "promotion"],
  ["blame-game", "blame-game", "blame-game", "revenge", "hr-complaint"],
  ["revenge", "not-me", "quick-fix", "blame-game", "hr-complaint"],
  ["revenge", "not-me", "hr-complaint", "blame-game", "promotion"],
];

/** p1 has drawn this Problem. */
function withProblem(kind: ProblemKind = "data-leak"): State {
  const s = start(4, { hands, pile: [kind, "spy", "spy", "spy"] });
  return act(s, "p1", { type: "draw" }).state;
}

function rejected(state: State, playerId: string, action: LooseAction): string {
  const r = tryAct(state, playerId, action);
  if (r.ok) throw new Error("expected a rejection");
  return r.error.code;
}

const blame = (s: State, from: string, to: string, c = ctx()) =>
  act(s, from, { type: "blame", cardId: cardOf(s, from, "blame-game"), targetId: to }, c);
const hr = (s: State, by: string, c = ctx()) => act(s, by, { type: "hr", cardId: cardOf(s, by, "hr-complaint") }, c);
const playable = (s: State, id: string) => nmp.getPrivateState(s, id).playable;
const kindsPlayable = (s: State, id: string) =>
  playable(s, id).map((p) => player(s, id).hand.find((c) => c.id === p.cardId)!.kind);
const publicEvents = (t: { events: { visibility: { kind: string }; event: NmpEvent }[] }) =>
  t.events.filter((e) => e.visibility.kind === "public").map((e) => e.event);

/** Everyone eligible passes the HR window. */
function allPass(s: State, c = ctx()): State {
  for (const id of ["p0", "p1", "p2", "p3"]) {
    if (s.step !== "hr") break;
    if (nmp.getPrivateState(s, id).canPass) s = act(s, id, { type: "pass" }, c).state;
  }
  return s;
}

describe("the spec example", () => {
  it("A blames B, B sends it on to C, D cancels: B holds it, then fixes it", () => {
    let s = withProblem();
    let t = blame(s, "p1", "p2");
    s = t.state;
    expect(s.step).toBe("target");
    expect(nmp.getAwaitedPlayerIds(s)).toEqual(["p2"]);
    expect(t.timers).toContainEqual({ kind: "set", timerId: `step:${s.token}`, delayMs: 8000 });
    expect(nmp.getPrivateState(s, "p2").canAccept).toBe(true);
    expect(playable(s, "p2")).toContainEqual({ cardId: "revenge-2", targets: ["p0", "p3"] });
    expect(playable(s, "p2")).toContainEqual({ cardId: "not-me-2", targets: null });

    s = act(s, "p2", { type: "revenge", cardId: "revenge-2", targetId: "p3" }).state;
    expect(s.step).toBe("hr");
    expect(nmp.getAwaitedPlayerIds(s)).toEqual([]);
    expect(nmp.getPublicState(s).moves).toEqual([
      { kind: "blame", actorId: "p1", targetId: "p2" },
      { kind: "revenge", actorId: "p2", targetId: "p3" },
    ]);
    expect(nmp.getPrivateState(s, "p2").canPass).toBe(false);
    expect(nmp.getPrivateState(s, "p0")).toMatchObject({ canPass: true, playable: [{ cardId: "hr-complaint-1", targets: null }] });

    t = hr(s, "p0", ctx(1000));
    s = t.state;
    expect(s.problem).toMatchObject({ ownerId: "p2", attempts: 2, lastMovedFromId: "p1" });
    expect(s.step).toBe("problem");
    expect(nmp.getAwaitedPlayerIds(s)).toEqual(["p2"]);
    expect(s.deadline).toBe(16_000);
    expect(t.timers).toContainEqual({ kind: "set", timerId: `step:${s.token}`, delayMs: 15_000 });
    expect(s.discard.map((c) => c.id)).toEqual(expect.arrayContaining(["blame-game-2", "revenge-2", "hr-complaint-1"]));
    expect(publicEvents(t)).toContainEqual({ type: "moved", problemKind: "data-leak", fromId: "p1", toId: "p2" });

    const f = act(s, "p2", { type: "fix", cardId: cardOf(s, "p2", "quick-fix") });
    expect(f.state.problem).toBeNull();
    expect(turnPlayer(f.state)).toBe("p2");
    expect(player(f.state, "p2").warnings).toBe(0);
  });
});

describe("Blame Game", () => {
  it("with no reaction and no HR, the Problem moves to the target", () => {
    let s = blame(withProblem(), "p1", "p2").state;
    s = act(s, "p2", { type: "accept" }).state;
    expect(s.step).toBe("hr");
    s = allPass(s);
    expect(s.step).toBe("problem");
    expect(s.problem).toMatchObject({ ownerId: "p2", lastMovedFromId: "p1", attempts: 1 });
    expect(nmp.partyStats!(s)).toEqual({ p1: { problemsPassed: 1 } });
    const all = JSON.stringify([nmp.getPublicState(s), ...["p0", "p1", "p2", "p3"].map((id) => nmp.getPrivateState(s, id))]);
    expect(all).not.toContain("problemsPassed");
  });

  it("the HR window closes early once everyone eligible has passed", () => {
    let s = blame(withProblem(), "p1", "p2").state;
    s = act(s, "p2", { type: "accept" }).state;
    s = act(s, "p0", { type: "pass" }).state;
    s = act(s, "p2", { type: "pass" }).state;
    expect(s.step).toBe("hr");
    expect(nmp.getPublicState(s).players.filter((p) => p.passed).map((p) => p.id)).toEqual(["p0", "p2"]);
    expect(nmp.getPrivateState(s, "p0").canPass).toBe(false);
    expect(rejected(s, "p0", { type: "pass" })).toBe("passed");
    s = act(s, "p3", { type: "pass" }).state;
    expect(s.step).toBe("problem");
    expect(s.problem!.ownerId).toBe("p2");
  });

  it("HR on a plain Blame Game keeps the Problem with the source", () => {
    let s = blame(withProblem(), "p1", "p2").state;
    s = act(s, "p2", { type: "accept" }).state;
    s = hr(s, "p3", ctx(2000)).state;
    expect(s.problem).toMatchObject({ ownerId: "p1", lastMovedFromId: null, attempts: 1 });
    expect(s.step).toBe("problem");
    expect(s.deadline).toBe(17_000);
    expect(nmp.partyStats!(s)).toEqual({});
  });

  it("checks the target, the card and the owner", () => {
    const s = withProblem();
    expect(rejected(s, "p1", { type: "blame", cardId: "blame-game-2", targetId: "p1" })).toBe("bad-target");
    expect(rejected(s, "p1", { type: "blame", cardId: "blame-game-2", targetId: "nobody" })).toBe("bad-target");
    expect(rejected(s, "p1", { type: "blame", cardId: "revenge-1", targetId: "p2" })).toBe("wrong-card");
    expect(rejected(s, "p2", { type: "blame", cardId: "blame-game-5", targetId: "p3" })).toBe("not-your-problem");
    s.players[3]!.fired = true;
    expect(rejected(s, "p1", { type: "blame", cardId: "blame-game-2", targetId: "p3" })).toBe("bad-target");
    expect(playable(s, "p1")).toContainEqual({ cardId: "blame-game-2", targets: ["p0", "p2"] });
  });

  it("the target timer means Accept; the HR timer resolves with no cancel", () => {
    let s = blame(withProblem(), "p1", "p2").state;
    s = fireTimer(s).state;
    expect(s.step).toBe("hr");
    expect(s.moves.length).toBe(1);
    s = fireTimer(s).state;
    expect(s.step).toBe("problem");
    expect(s.problem!.ownerId).toBe("p2");
  });

  it("only the target answers, and the last mover can't play HR", () => {
    let s = blame(withProblem(), "p1", "p2").state;
    expect(rejected(s, "p3", { type: "accept" })).toBe("not-target");
    expect(rejected(s, "p3", { type: "not-me", cardId: "not-me-3" })).toBe("not-target");
    expect(rejected(s, "p0", { type: "hr", cardId: "hr-complaint-1" })).toBe("wrong-time");
    s = act(s, "p2", { type: "accept" }).state;
    expect(rejected(s, "p1", { type: "hr", cardId: "hr-complaint-2" })).toBe("not-eligible");
    expect(playable(s, "p1")).toEqual([]);
    expect(nmp.getPrivateState(s, "p1").canPass).toBe(false);
  });
});

describe("Not Me", () => {
  it("leaves the Problem with the source, with a fresh timer", () => {
    let s = blame(withProblem(), "p1", "p2").state;
    s = act(s, "p2", { type: "not-me", cardId: "not-me-2" }).state;
    expect(s.step).toBe("hr");
    s = allPass(s, ctx(5000));
    expect(s.problem).toMatchObject({ ownerId: "p1", lastMovedFromId: null, attempts: 1 });
    expect(s.step).toBe("problem");
    expect(s.deadline).toBe(20_000);
    expect(nmp.getAwaitedPlayerIds(s)).toEqual(["p1"]);
    expect(s.discard.map((c) => c.id)).toEqual(expect.arrayContaining(["blame-game-2", "not-me-2"]));
  });

  it("HR on a Not Me sends the Problem to the target", () => {
    let s = blame(withProblem(), "p1", "p2").state;
    s = act(s, "p2", { type: "not-me", cardId: "not-me-2" }).state;
    expect(rejected(s, "p2", { type: "hr", cardId: "hr-complaint-3" })).toBe("not-eligible");
    s = hr(s, "p1").state;
    expect(s.problem).toMatchObject({ ownerId: "p2", lastMovedFromId: "p1" });
    expect(nmp.partyStats!(s)).toEqual({ p1: { problemsPassed: 1 } });
  });

  it("Revenge that stands sends it to the third player", () => {
    let s = blame(withProblem(), "p1", "p2").state;
    s = act(s, "p2", { type: "revenge", cardId: "revenge-2", targetId: "p3" }).state;
    s = fireTimer(s).state;
    expect(s.problem).toMatchObject({ ownerId: "p3", lastMovedFromId: "p2", attempts: 2 });
    expect(nmp.partyStats!(s)).toEqual({ p2: { problemsPassed: 1 } });
  });
});

describe("limits", () => {
  it("after 4 attempts Blame Game and Revenge are gone", () => {
    let s = withProblem();
    for (const [from, to] of [["p1", "p2"], ["p2", "p3"], ["p3", "p0"]] as const) {
      s = blame(s, from, to).state;
      s = act(s, to, { type: "accept" }).state;
      s = fireTimer(s).state;
      expect(s.problem!.ownerId).toBe(to);
    }
    s = blame(s, "p0", "p1").state;
    expect(s.problem!.attempts).toBe(4);
    expect(nmp.getPublicState(s).problem!.attemptsLeft).toBe(0);
    expect(kindsPlayable(s, "p1")).not.toContain("revenge");
    expect(rejected(s, "p1", { type: "revenge", cardId: "revenge-1", targetId: "p3" })).toBe("no-transfers");
    s = act(s, "p1", { type: "accept" }).state;
    s = fireTimer(s).state;
    expect(s.problem!.ownerId).toBe("p1");
    expect(rejected(s, "p1", { type: "blame", cardId: cardOf(s, "p1", "blame-game"), targetId: "p2" })).toBe("no-transfers");
    expect(kindsPlayable(s, "p1")).not.toContain("blame-game");
  });

  it("Angry Client can't go back to the player it last moved away from", () => {
    let s = withProblem("angry-client");
    s = blame(s, "p1", "p2").state;
    s = act(s, "p2", { type: "accept" }).state;
    s = fireTimer(s).state;
    expect(s.problem).toMatchObject({ ownerId: "p2", lastMovedFromId: "p1" });
    expect(rejected(s, "p2", { type: "blame", cardId: "blame-game-5", targetId: "p1" })).toBe("bad-target");
    expect(playable(s, "p2")).toContainEqual({ cardId: "blame-game-5", targets: ["p0", "p3"] });
    s = blame(s, "p2", "p3").state;
    expect(rejected(s, "p3", { type: "revenge", cardId: "revenge-3", targetId: "p1" })).toBe("bad-target");
    expect(rejected(s, "p3", { type: "revenge", cardId: "revenge-3", targetId: "p2" })).toBe("bad-target");
    expect(playable(s, "p3")).toContainEqual({ cardId: "revenge-3", targets: ["p0"] });
    s = act(s, "p3", { type: "revenge", cardId: "revenge-3", targetId: "p0" }).state;
    expect(s.step).toBe("hr");
  });
});

describe("timing", () => {
  it("a second HR Complaint after the first is too late, and keeps its card", () => {
    let s = blame(withProblem(), "p1", "p2").state;
    s = act(s, "p2", { type: "accept" }).state;
    const token = s.token;
    const after = hr(s, "p0").state;
    const r = nmp.handleAction(after, "p3", { type: "hr", token, cardId: "hr-complaint-4" }, ctx());
    expect(r).toEqual({ ok: false, error: { code: "too-late", message: "Too late." } });
    const late = nmp.handleAction(after, "p2", { type: "pass", token }, ctx());
    expect(late.ok === false && late.error.code).toBe("too-late");
    expect(player(after, "p3").hand.map((c) => c.id)).toContain("hr-complaint-4");
  });

  it("a target who is away accepts at once", () => {
    let s = withProblem();
    s.players[2]!.away = true;
    s = blame(s, "p1", "p2").state;
    expect(s.step).toBe("hr");
    expect(s.moves.map((m) => m.kind)).toEqual(["blame"]);
    s = allPass(s);
    expect(s.problem!.ownerId).toBe("p2");
  });

  it("with nobody to play HR, the move resolves with no HR window", () => {
    let s = withProblem();
    for (const i of [0, 2, 3]) s.players[i]!.away = true;
    const t = blame(s, "p1", "p2");
    s = t.state;
    expect(s.step).toBe("problem");
    expect(s.problem!.ownerId).toBe("p2");
    expect(publicEvents(t)).toContainEqual({ type: "moved", problemKind: "data-leak", fromId: "p1", toId: "p2" });
  });

  it("transfers are refused outside their step", () => {
    const s = start(4, { hands, pile: ["data-leak", "spy"] });
    expect(rejected(s, "p1", { type: "blame", cardId: "blame-game-2", targetId: "p2" })).toBe("wrong-time");
    expect(rejected(s, "p1", { type: "pass" })).toBe("wrong-time");
    expect(rejected(s, "p1", { type: "fix", cardId: "blame-game-2" })).toBe("wrong-time");
    expect(rejected(s, "p1", { type: "accept" })).toBe("wrong-time");
  });
});

describe("feed line and parsing", () => {
  it("a new turn does not replace the last outcome", () => {
    let s = withProblem("server-down");
    s = act(s, "p1", { type: "accept" }).state;
    expect(turnPlayer(s)).toBe("p2");
    expect(nmp.getPublicState(s).lastEvent).toEqual({ type: "warned", playerId: "p1", amount: 1, shielded: false });
  });

  it("ids up to 64 characters", () => {
    const id = "x".repeat(64);
    expect(nmp.parseAction({ type: "fix", token: 1, cardId: id })).toEqual({ type: "fix", token: 1, cardId: id });
    expect(nmp.parseAction({ type: "fix", token: 1, cardId: `${id}x` })).toBeNull();
  });
});
