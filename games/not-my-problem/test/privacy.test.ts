import { findLeaks } from "@games/game-core/testing";
import { describe, expect, it } from "vitest";
import { notMyProblemGame as nmp } from "../server/game.ts";
import type { State } from "../server/state.ts";
import type { ActionKind } from "../shared/index.ts";
import { act, ctx, player, start, startWith } from "./helpers.ts";

// p1 plays first. Nobody holds an Overtime: overtime-1 and overtime-2 are the pile top.
const hands: ActionKind[][] = [
  ["hr-complaint", "blame-game", "not-me", "quick-fix", "promotion"],
  ["fake-report", "spy", "quick-fix", "intern", "blame-game"],
  ["revenge", "not-me", "quick-fix", "blame-game", "hr-complaint"],
  ["revenge", "not-me", "hr-complaint", "blame-game", "promotion"],
];
const players = ["p0", "p1", "p2", "p3"];
type Transition = { state: State; events: Parameters<typeof findLeaks>[0]["events"] };

const leaks = (t: Transition, secret: string, allowed: string[]) =>
  findLeaks({ def: nmp, state: t.state, events: t.events, players, secret, allowed });
/** A reconnect snapshot: the state as it is, with no events. */
const snapshot = (s: State) => nmp.onPlayerReconnected!(s, "p0", ctx());

describe("hidden information", () => {
  it("the draw pile's top card is seen by nobody", () => {
    const t = startWith(4, { hands, pile: ["overtime", "overtime", "server-down"] });
    expect(leaks(t, "overtime-1", [])).toEqual([]);
    expect(leaks(t, "overtime-2", [])).toEqual([]);
  });

  it("a drawn action card is seen only by the drawer", () => {
    const s = start(4, { hands, pile: ["overtime", "overtime", "server-down"] });
    const t = act(s, "p1", { type: "draw" });
    expect(player(t.state, "p1").hand.map((c) => c.id)).toContain("overtime-1");
    expect(leaks(t, "overtime-1", ["p1"])).toEqual([]);
    expect(leaks(t, "overtime-2", [])).toEqual([]);
    expect(leaks(snapshot(t.state), "overtime-1", ["p1"])).toEqual([]);
  });

  it("a hand card is seen only by its holder", () => {
    const t = startWith(4, { hands, pile: ["overtime"] });
    expect(leaks(t, "promotion-1", ["p0"])).toEqual([]);
    expect(leaks(t, "fake-report-1", ["p1"])).toEqual([]);
    expect(leaks(t, "revenge-1", ["p2"])).toEqual([]);
  });

  it("the Spy card is seen only by the two players involved", () => {
    const s = start(4, { hands, pile: ["overtime"] });
    const before = s.players[0]!.hand.map((c) => c.id);
    const t = act(s, "p1", { type: "play", cardId: "spy-1", targetId: "p0" });
    const taken = player(t.state, "p1").hand.find((c) => before.includes(c.id))!;
    expect(taken).toBeDefined();
    expect(leaks(t, taken.id, ["p0", "p1"])).toEqual([]);
    // The public event says who, not what.
    expect(t.events.filter((e) => e.visibility.kind === "public").map((e) => e.event)).toContainEqual({
      type: "spied", fromId: "p0", toId: "p1",
    });
    expect(leaks(snapshot(t.state), taken.id, ["p1"])).toEqual([]);
  });

  it("the face-down Fake Report card is seen only by its owner until challenged", () => {
    let s = start(4, { hands, pile: ["server-down", "overtime"] });
    s = act(s, "p1", { type: "draw" }).state;
    let t: Transition = act(s, "p1", { type: "fake-report", cardId: "fake-report-1", faceDownId: "intern-1" });
    expect(leaks(t, "intern-1", ["p1"])).toEqual([]);
    expect(leaks(snapshot(t.state), "intern-1", ["p1"])).toEqual([]);
    t = act(t.state, "p0", { type: "pass" });
    expect(leaks(t, "intern-1", ["p1"])).toEqual([]);

    // Challenged: now everyone sees it.
    const c = act(t.state, "p2", { type: "challenge" });
    expect(c.events.some((e) => e.visibility.kind === "public" && JSON.stringify(e.event).includes("intern-1"))).toBe(true);

    // Not challenged: it goes to the hidden discard and nobody ever sees it.
    let u = act(t.state, "p2", { type: "pass" });
    u = act(u.state, "p3", { type: "pass" });
    expect(u.state.hiddenDiscard.map((x) => x.id)).toEqual(["intern-1"]);
    expect(leaks(u, "intern-1", [])).toEqual([]);
    expect(leaks(snapshot(u.state), "intern-1", [])).toEqual([]);
  });

  it("party stats stay out of every view", () => {
    const s = start(4, { hands, pile: ["overtime"] });
    s.stats = { p1: { liesTold: 2, problemsPassed: 1 } };
    for (const secret of ["liesTold", "problemsPassed"]) {
      expect(findLeaks({ def: nmp, state: s, players, secret, allowed: [] })).toEqual([]);
    }
  });
});
