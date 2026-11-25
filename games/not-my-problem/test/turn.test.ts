import { describe, expect, it } from "vitest";
import { notMyProblemGame as nmp } from "../server/game.ts";
import type { State } from "../server/state.ts";
import { buildDeck, type ActionKind, type NmpEvent } from "../shared/index.ts";
import { act, cardOf, ctx, fireTimer, player, start, startWith, tryAct, turnPlayer, type TestDeck } from "./helpers.ts";

const filler: ActionKind[] = ["not-me", "not-me", "not-me", "not-me", "not-me"];
/** Three seats of filler; p1 (first to play) gets `p1`. */
const deck3 = (p1: ActionKind[], pile: TestDeck["pile"], p2: ActionKind[] = filler): TestDeck => ({
  hands: [filler, p1, p2],
  pile,
});

const publicEvents = (t: { events: { visibility: { kind: string }; event: NmpEvent }[] }) =>
  t.events.filter((e) => e.visibility.kind === "public").map((e) => e.event);

function rejected(state: State, playerId: string, action: Parameters<typeof tryAct>[2]): string {
  const r = tryAct(state, playerId, action);
  if (r.ok) throw new Error("expected a rejection");
  return r.error.code;
}

describe("setup", () => {
  for (let n = 3; n <= 8; n++) {
    it(`deals ${n} players five cards each, with a Quick Fix and no Problem`, () => {
      const s = start(n);
      for (const p of s.players) {
        expect(p.hand.length).toBe(5);
        expect(p.hand.some((c) => c.kind === "quick-fix")).toBe(true);
        expect(p.hand.some((c) => ["server-down", "data-leak", "angry-client"].includes(c.kind))).toBe(false);
      }
      const { actions, problems } = buildDeck(n);
      const all = [...s.players.flatMap((p) => p.hand), ...s.drawPile].map((c) => c.id).sort();
      expect(all).toEqual([...actions, ...problems].map((c) => c.id).sort());
    });
  }

  it("gives every hand a Quick Fix for any shuffle, even when early hands draw extra ones", () => {
    for (let n = 3; n <= 8; n++) {
      for (let seed = 1; seed <= 300; seed++) {
        const s = nmp.createGame(
          Array.from({ length: n }, (_, i) => ({ id: `p${i}` })),
          nmp.defaultSettings,
          { roundNumber: 1, dealerSeat: 0 },
          ctx(0, seed),
        ).state;
        for (const p of s.players) expect(p.hand.some((c) => c.kind === "quick-fix"), `n ${n} seed ${seed}`).toBe(true);
      }
    }
  });

  it("starts at the seat after the dealer, in round 1, with a turn timer", () => {
    const t = startWith(4);
    expect(turnPlayer(t.state)).toBe("p1");
    expect(t.state.round).toBe(1);
    expect(t.state.step).toBe("action");
    expect(t.timers).toContainEqual({ kind: "set", timerId: `step:${t.state.token}`, delayMs: 25_000 });
    expect(nmp.getAwaitedPlayerIds(t.state)).toEqual(["p1"]);
    expect(turnPlayer(start(4, undefined, {}, 3))).toBe("p0");
  });

  it("uses an injected deck as given", () => {
    const s = start(3, deck3(["spy", "intern", "quick-fix", "quick-fix", "promotion"], ["server-down", "spy"]));
    expect(player(s, "p1").hand.map((c) => c.id)).toEqual(["spy-1", "intern-1", "quick-fix-1", "quick-fix-2", "promotion-1"]);
    expect(s.drawPile.map((c) => c.id)).toEqual(["server-down-1", "spy-2"]);
  });
});

describe("parsing", () => {
  it("settings", () => {
    expect(nmp.parseSettings({ reactionSeconds: 12 })).toEqual({ reactionSeconds: 12 });
    expect(nmp.parseSettings({ reactionSeconds: 7 })).toBeNull();
    expect(nmp.parseSettings("x")).toBeNull();
    expect(nmp.parseSettings(undefined)).toEqual({ reactionSeconds: 8 });
  });
  it("actions", () => {
    expect(nmp.parseAction({ type: "draw", token: 3 })).toEqual({ type: "draw", token: 3 });
    expect(nmp.parseAction({ type: "play", token: 1, cardId: "spy-1", targetId: "p0" })).toEqual({
      type: "play", token: 1, cardId: "spy-1", targetId: "p0",
    });
    expect(nmp.parseAction({ type: "play", token: 1, cardId: "spy-1" })).toEqual({ type: "play", token: 1, cardId: "spy-1" });
    expect(nmp.parseAction({ type: "draw" })).toBeNull();
    expect(nmp.parseAction({ type: "fix", token: 1 })).toBeNull();
    expect(nmp.parseAction({ type: "blame", token: 1, cardId: "b" })).toBeNull();
    expect(nmp.parseAction({ type: "play", token: 1, cardId: "s", targetId: 5 })).toBeNull();
    expect(nmp.parseAction({ type: "fake-report", token: 1, cardId: "f", faceDownId: "x" })).not.toBeNull();
    expect(nmp.parseAction({ type: "nope", token: 1 })).toBeNull();
    expect(nmp.parseAction(null)).toBeNull();
  });
});

describe("proactive cards", () => {
  const s0 = () => start(3, deck3(["intern", "intern", "promotion", "spy", "overtime"], ["spy", "spy", "spy"]));

  it("allows two per turn", () => {
    let s = s0();
    s = act(s, "p1", { type: "play", cardId: cardOf(s, "p1", "spy"), targetId: "p0" }).state;
    s = act(s, "p1", { type: "play", cardId: cardOf(s, "p1", "overtime"), targetId: "p2" }).state;
    expect(rejected(s, "p1", { type: "play", cardId: cardOf(s, "p1", "intern") })).toBe("no-actions");
  });

  it("only on your turn", () => {
    const s = s0();
    expect(rejected(s, "p2", { type: "play", cardId: cardOf(s, "p2", "not-me") })).toBe("not-your-turn");
  });

  it("Promotion needs a warning", () => {
    const s = s0();
    expect(rejected(s, "p1", { type: "play", cardId: cardOf(s, "p1", "promotion") })).toBe("no-warnings");
    s.players[1]!.warnings = 2;
    const t = act(s, "p1", { type: "play", cardId: cardOf(s, "p1", "promotion") });
    expect(player(t.state, "p1").warnings).toBe(1);
  });

  it("one Intern at a time", () => {
    let s = s0();
    s = act(s, "p1", { type: "play", cardId: "intern-1" }).state;
    expect(player(s, "p1").shield?.id).toBe("intern-1");
    expect(rejected(s, "p1", { type: "play", cardId: "intern-2" })).toBe("has-shield");
  });

  it("Overtime needs another player without Overtime", () => {
    const s = s0();
    expect(rejected(s, "p1", { type: "play", cardId: "overtime-1", targetId: "p1" })).toBe("bad-target");
    expect(rejected(s, "p1", { type: "play", cardId: "overtime-1" })).toBe("bad-target");
    s.players[2]!.overtime = true;
    expect(rejected(s, "p1", { type: "play", cardId: "overtime-1", targetId: "p2" })).toBe("bad-target");
  });

  it("Spy takes a random card, shown only to the two players", () => {
    const s = s0();
    s.players[2]!.hand = [];
    expect(rejected(s, "p1", { type: "play", cardId: "spy-1", targetId: "p2" })).toBe("bad-target");
    const t = act(s, "p1", { type: "play", cardId: "spy-1", targetId: "p0" });
    expect(player(t.state, "p0").hand.length).toBe(4);
    expect(player(t.state, "p1").hand.length).toBe(5);
    const taken = player(t.state, "p1").hand.find((c) => c.kind === "not-me")!;
    expect(publicEvents(t)).toContainEqual({ type: "spied", fromId: "p0", toId: "p1" });
    for (const id of ["p0", "p1"]) {
      expect(t.events).toContainEqual({
        visibility: { kind: "private", playerId: id },
        event: { type: "spied", fromId: "p0", toId: "p1", card: taken },
      });
    }
    expect(t.state.discard.map((c) => c.id)).toEqual(["spy-1"]);
  });

  it("lists only legal cards as playable", () => {
    const s = s0();
    const playable = nmp.getPrivateState(s, "p1").playable;
    expect(playable).toEqual([
      { cardId: "intern-1", targets: null },
      { cardId: "intern-2", targets: null },
      { cardId: "spy-1", targets: ["p0", "p2"] },
      { cardId: "overtime-1", targets: ["p0", "p2"] },
    ]);
    expect(nmp.getPrivateState(s, "p0").playable).toEqual([]);
  });

  it("rejects a stale token with no change", () => {
    const s = s0();
    const r = nmp.handleAction(s, "p1", { type: "draw", token: s.token - 1 }, ctx());
    expect(r).toEqual({ ok: false, error: { code: "too-late", message: "Too late." } });
  });
});

describe("drawing", () => {
  it("an action card goes to the hand and the turn passes", () => {
    const s = start(3, deck3(filler, ["spy", "spy"]));
    const t = act(s, "p1", { type: "draw" });
    expect(player(t.state, "p1").hand.length).toBe(6);
    expect(turnPlayer(t.state)).toBe("p2");
    expect(publicEvents(t)).toContainEqual({ type: "drew", playerId: "p1", problem: null });
    expect(t.events).toContainEqual({
      visibility: { kind: "private", playerId: "p1" },
      event: { type: "drew-card", card: { id: "spy-1", kind: "spy" } },
    });
    expect(t.state.step).toBe("action");
    expect(t.state.actionsLeft).toBe(2);
  });

  it("a Problem waits on the drawer; a Quick Fix fixes it", () => {
    const s = start(3, deck3(["quick-fix", ...filler.slice(1)], ["server-down", "spy"]));
    const t = act(s, "p1", { type: "draw" });
    expect(t.state.step).toBe("problem");
    expect(nmp.getAwaitedPlayerIds(t.state)).toEqual(["p1"]);
    expect(t.timers).toContainEqual({ kind: "set", timerId: `step:${t.state.token}`, delayMs: 15_000 });
    expect(nmp.getPublicState(t.state).problem).toMatchObject({ kind: "server-down", ownerId: "p1", attemptsLeft: 4 });
    expect(nmp.getPrivateState(t.state, "p1")).toMatchObject({ canAccept: true, canDraw: false });
    expect(nmp.getPrivateState(t.state, "p1").playable).toEqual([{ cardId: "quick-fix-1", targets: null }]);
    const f = act(t.state, "p1", { type: "fix", cardId: "quick-fix-1" });
    expect(f.state.resolvedProblems.map((c) => c.id)).toEqual(["server-down-1"]);
    expect(f.state.discard.map((c) => c.id)).toEqual(["quick-fix-1"]);
    expect(f.state.problem).toBeNull();
    expect(turnPlayer(f.state)).toBe("p2");
    expect(publicEvents(f)).toContainEqual({ type: "fixed", playerId: "p1", by: "quick-fix" });
  });

  it("Accept on a Data Leak with an Intern: 1 warning, shield gone", () => {
    let s = start(3, deck3(["intern", ...filler.slice(1)], ["data-leak", "spy"]));
    s = act(s, "p1", { type: "play", cardId: "intern-1" }).state;
    s = act(s, "p1", { type: "draw" }).state;
    const t = act(s, "p1", { type: "accept" });
    expect(player(t.state, "p1").warnings).toBe(1);
    expect(player(t.state, "p1").shield).toBeNull();
    expect(t.state.discard.map((c) => c.id)).toContain("intern-1");
    expect(publicEvents(t)).toContainEqual({ type: "warned", playerId: "p1", amount: 1, shielded: true });
    expect(turnPlayer(t.state)).toBe("p2");
  });

  it("three warnings fire a player; the last one left wins", () => {
    let s = start(3, deck3(filler, ["server-down", "server-down", "spy"]));
    s.players[1]!.warnings = 2;
    s.players[2]!.warnings = 2;
    s = act(s, "p1", { type: "draw" }).state;
    const t = act(s, "p1", { type: "accept" });
    s = t.state;
    const p1 = player(s, "p1");
    expect(p1).toMatchObject({ fired: true, firedOrder: 1, hand: [] });
    expect(s.discard.filter((c) => c.kind === "not-me").length).toBe(5);
    expect(publicEvents(t)).toContainEqual({ type: "fired", playerId: "p1", order: 1 });
    expect(nmp.getResult(s)).toBeNull();
    expect(turnPlayer(s)).toBe("p2");
    s = act(s, "p2", { type: "draw" }).state;
    const end = act(s, "p2", { type: "accept" });
    expect(end.state.step).toBe("finished");
    expect(end.state.winnerIds).toEqual(["p0"]);
    expect(publicEvents(end)).toContainEqual({ type: "game-over", winnerIds: ["p0"] });
    const result = nmp.getResult(end.state)!;
    expect(result.winnerIds).toEqual(["p0"]);
    expect(result.standings.map((x) => [x.playerId, x.label])).toEqual([
      ["p0", "0 warnings"], ["p2", "Fired 2nd"], ["p1", "Fired 1st"],
    ]);
    expect(nmp.getAwaitedPlayerIds(end.state)).toEqual([]);
  });
});

describe("timeouts", () => {
  it("Problem timeout plays a Quick Fix if held", () => {
    let s = start(3, deck3(["quick-fix", ...filler.slice(1)], ["server-down", "spy"]));
    s = act(s, "p1", { type: "draw" }).state;
    const t = fireTimer(s);
    expect(t.state.resolvedProblems.length).toBe(1);
    expect(player(t.state, "p1").warnings).toBe(0);
    expect(player(t.state, "p1").hand.some((c) => c.kind === "quick-fix")).toBe(false);
  });

  it("Problem timeout without a Quick Fix takes the warnings", () => {
    let s = start(3, deck3(filler, ["data-leak", "spy"]));
    s = act(s, "p1", { type: "draw" }).state;
    const t = fireTimer(s);
    expect(player(t.state, "p1").warnings).toBe(2);
    expect(t.state.resolvedProblems.map((c) => c.id)).toEqual(["data-leak-1"]);
    expect(turnPlayer(t.state)).toBe("p2");
  });

  it("turn timeout in the action step draws", () => {
    const s = start(3, deck3(filler, ["spy", "spy"]));
    const t = fireTimer(s);
    expect(player(t.state, "p1").hand.length).toBe(6);
    expect(turnPlayer(t.state)).toBe("p2");
  });

  it("a stale timer changes nothing", () => {
    const s = start(3, deck3(filler, ["spy", "spy"]));
    const old = s.token;
    const next = act(s, "p1", { type: "draw" }).state;
    const t = nmp.onTimer!(next, `step:${old}`, ctx());
    expect(t.state).toBe(next);
    expect(t.events).toEqual([]);
  });
});

describe("Overtime", () => {
  it("the target draws two on their next turn", () => {
    let s = start(3, deck3(["overtime", ...filler.slice(1)], ["spy", "spy", "spy", "spy"]));
    s = act(s, "p1", { type: "play", cardId: "overtime-1", targetId: "p2" }).state;
    expect(nmp.getPublicState(s).players[2]!.overtime).toBe(true);
    s = act(s, "p1", { type: "draw" }).state;
    const t = act(s, "p2", { type: "draw" });
    expect(player(t.state, "p2").hand.length).toBe(7);
    expect(player(t.state, "p2").overtime).toBe(false);
    expect(publicEvents(t).filter((e) => e.type === "drew").length).toBe(2);
    expect(turnPlayer(t.state)).toBe("p0");
    expect(t.state.drawPile.length).toBe(1);
  });

  it("fired on the first Overtime draw: no second draw, next seat plays", () => {
    let s = start(3, deck3(["overtime", ...filler.slice(1)], ["spy", "server-down", "spy", "spy"]));
    s.players[2]!.warnings = 2;
    s = act(s, "p1", { type: "play", cardId: "overtime-1", targetId: "p2" }).state;
    s = act(s, "p1", { type: "draw" }).state;
    s = act(s, "p2", { type: "draw" }).state;
    expect(s.step).toBe("problem");
    const t = act(s, "p2", { type: "accept" });
    expect(player(t.state, "p2").fired).toBe(true);
    expect(t.state.step).toBe("action");
    expect(turnPlayer(t.state)).toBe("p0");
    expect(t.state.drawPile.map((c) => c.id)).toEqual(["spy-2", "spy-3"]);
    expect(publicEvents(t).some((e) => e.type === "drew")).toBe(false);
  });

  it("with one card left: one draw, then the game ends", () => {
    let s = start(3, deck3(["overtime", ...filler.slice(1)], ["spy", "spy"]));
    s.players[0]!.warnings = 1;
    s = act(s, "p1", { type: "play", cardId: "overtime-1", targetId: "p2" }).state;
    s = act(s, "p1", { type: "draw" }).state;
    const t = act(s, "p2", { type: "draw" });
    expect(publicEvents(t).filter((e) => e.type === "drew").length).toBe(1);
    expect(t.state.step).toBe("finished");
    // p1: 0 warnings, 5 cards; p2: 0 warnings, 6 cards; p0: 1 warning.
    expect(t.state.winnerIds).toEqual(["p2"]);
    expect(nmp.getResult(t.state)!.standings.map((x) => x.playerId)).toEqual(["p2", "p1", "p0"]);
  });
});

describe("ending", () => {
  it("deck-out ranks by fewest warnings, then most cards", () => {
    let s = start(4, { hands: [filler, filler, filler, filler], pile: ["spy"] });
    const hand = (id: string, n: number) => (player(s, id).hand = player(s, id).hand.slice(0, n));
    s.players[0]!.warnings = 0;
    hand("p0", 2);
    s.players[1]!.warnings = 0;
    hand("p1", 3);
    s.players[2]!.warnings = 1;
    hand("p2", 1);
    Object.assign(s.players[3]!, { fired: true, firedOrder: 1, hand: [], warnings: 3 });
    s.firedCount = 1;
    s = act(s, "p1", { type: "draw" }).state;
    expect(s.step).toBe("finished");
    expect(s.winnerIds).toEqual(["p1"]);
    const r = nmp.getResult(s)!;
    expect(r.winnerIds).toEqual(["p1"]);
    expect(r.standings).toEqual([
      { playerId: "p1", value: 0, label: "0 warnings" },
      { playerId: "p0", value: 0, label: "0 warnings" },
      { playerId: "p2", value: 1, label: "1 warning" },
      { playerId: "p3", value: 3, label: "Fired 1st" },
    ]);
  });

  it("players tied on warnings and cards share the win", () => {
    let s = start(3, deck3(filler, ["spy"]));
    player(s, "p1").hand = player(s, "p1").hand.slice(0, 4);
    s = act(s, "p1", { type: "draw" }).state;
    expect(s.winnerIds).toEqual(["p0", "p1", "p2"]);
  });

  it("rounds go up when the turn comes back to the first seat", () => {
    let s = start(3, deck3(filler, ["spy", "spy", "spy", "spy"]));
    s = act(s, "p1", { type: "draw" }).state;
    s = act(s, "p2", { type: "draw" }).state;
    expect(s.round).toBe(1);
    s = act(s, "p0", { type: "draw" }).state;
    expect(s.round).toBe(2);
    expect(nmp.getPublicState(s).round).toBe(2);
  });
});
