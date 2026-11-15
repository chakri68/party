import { describe, expect, it } from "vitest";
import { neighbours } from "../shared/hex.ts";
import { EVENTS } from "../shared/events.ts";
import type { Plan } from "../shared/types.ts";
import type { World } from "../shared/types.ts";
import { act, blankWorld, ctx, err, g, GG, nextAll, ok, pickRoles, planAll, ring, round, type S, start, voteAll } from "./helpers.ts";

const skip = (s: S, id: string) => g.skipTurn!(s, id, ctx(s.deadline - 1000));
const remove = (s: S, id: string) => g.onPlayerRemoved!(s, id, ctx(s.deadline - 1000));
const me = (s: S, id: string) => s.world.explorers.find((e) => e.id === id)!;
/** Sets this round's event, as if the deck had drawn it. */
const withEvent = (s: S, id: keyof typeof EVENTS, tiles: string[] = []): S => ({ ...s, event: { id, tiles } });

describe("createGame", () => {
  it("puts everyone on the camp with 3 Hearts and 1 item, in roles", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = start(4, {}, seed).state;
      expect(s.phase).toBe("roles");
      expect(s.world.round).toBe(1);
      for (const e of s.world.explorers) {
        expect(e.tile).toBe(s.board.camp);
        expect(e.hearts).toBe(3);
        expect(e.items).toHaveLength(1);
        expect(e.role).toBeNull();
      }
      expect(s.world.explorers.some((e) => e.items[0] === "torch"), `seed ${seed}`).toBe(true);
      // Only the camp and its neighbours start open.
      const open = s.world.order.filter((t) => s.world.tiles[t]!.open).sort();
      expect(open).toEqual([s.board.camp, ...neighbours(s.board.camp)].sort());
      expect(s.world.spider.tile).toBe(s.board.nest);
      // Rounds 1 and 2 are drawn, both calm.
      expect(EVENTS[s.event!.id].kind).toBe("calm");
      expect(EVENTS[s.next!].kind).toBe("calm");
    }
  });

  it("sets the roles timer", () => {
    const t = start(2);
    expect(t.timers).toEqual([{ kind: "set", timerId: "phase", delayMs: 30_000 }]);
    expect(t.state.deadline).toBe(30_000);
  });
});

describe("roles", () => {
  it("lets you pick twice, and refuses a role that does not exist", () => {
    let s = start(2).state;
    s = ok(act(s, "p0", { type: "pick-role", role: "runner" })).state;
    s = ok(act(s, "p0", { type: "pick-role", role: "guide" })).state;
    expect(me(s, "p0").role).toBe("guide");
    expect(s.phase).toBe("roles");
    expect(g.parseAction({ type: "pick-role", role: "wizard" })).toBeNull();
    expect(g.getAwaitedPlayerIds(s)).toEqual(["p1"]);
  });

  it("gives a random role to anyone who did not pick when time runs out", () => {
    let s = start(3).state;
    s = ok(act(s, "p0", { type: "pick-role", role: "runner" })).state;
    const t = ring(s);
    expect(t.state.phase).toBe("plan");
    expect(me(t.state, "p0").role).toBe("runner");
    for (const e of t.state.world.explorers) expect(e.role).not.toBeNull();
    expect(t.timers).toEqual([{ kind: "set", timerId: "phase", delayMs: 45_000 }]);
  });

  it("opens round 1 with its event tiles and the spider's arrow", () => {
    const s = pickRoles(start(2).state);
    expect(s.world.round).toBe(1);
    expect(s.event).not.toBeNull();
    expect(s.arrow).not.toBeNull();
  });
});

describe("the spider's arrow", () => {
  /** A game in the roles phase on this world, with this round's event. Picking roles opens the plan. */
  function arrowGame(world: World, id: keyof typeof EVENTS, prep?: (s: S) => void): S {
    let s = start(2).state;
    s = { ...s, world, event: { id, tiles: [] } };
    prep?.(s);
    return pickRoles(s);
  }
  /** Everyone Guards; the spider's real move in the island turn. */
  const realMove = (s: S) => {
    const t = planAll(s, { p0: GG, p1: GG }).state;
    expect(t.phase).toBe("report");
    return t.lastRound!.steps.find((x) => x.t === "spider");
  };
  const twoExplorers = (extra: Parameters<typeof blankWorld>[1] = {}) => ({
    explorers: [{ id: "p0", tile: "0,0" }, { id: "p1", tile: "-3,0" }],
    ...extra,
  });

  it("goes to the reeds on an Echo round, as the island turn does", () => {
    // p0 is 3 from the spider at 3,0: with no event it would hunt.
    const s = arrowGame(blankWorld({ "3,-3": "reeds" }, twoExplorers()), "echo-reeds");
    expect(s.event!.tiles).toEqual(["3,-3"]);
    expect(s.arrow!.why).toBe("noise");
    expect(s.arrow!.path.at(-1)).toBe("3,-2");
    expect(realMove(s)).toMatchObject({ path: s.arrow!.path, why: "noise" });
  });

  it("hunts on a Rain round, since the fire next to it goes out first", () => {
    const s = arrowGame(blankWorld({ "3,-1": "forest" }, twoExplorers({ tiles: { "3,-1": { fire: 2 } } })), "rain");
    expect(s.arrow!.why).toBe("hunt");
    expect(realMove(s)).toMatchObject({ path: s.arrow!.path, why: "hunt" });
  });

  it("goes to the stone hand's noise when it lands this round", () => {
    const s = arrowGame(blankWorld({}, twoExplorers()), "bird-calls", (x) => { x.pending = { tile: "3,-3", due: 1 }; });
    expect(s.arrow!.why).toBe("noise");
    expect(realMove(s)).toMatchObject({ path: s.arrow!.path, why: "noise" });
  });

  it("does not guess a vote: Warm spring is left out", () => {
    const w = blankWorld({}, twoExplorers());
    const s = arrowGame(w, "warm-spring", (x) => { x.world.explorers[0]!.hearts = 1; });
    expect(s.arrow!.why).toBe("hunt");
  });
});

describe("plan", () => {
  it("rejects a bad card with planProblem's message", () => {
    let s = pickRoles(start(2).state);
    me(s, "p0").items = ["torch"];
    const r = act(s, "p0", { type: "set-plan", plan: [{ kind: "item", item: "lure", at: s.board.camp }, { kind: "guard" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toEqual({ code: "bad-plan", message: "You do not have that item." });
    expect(err(act(s, "p0", { type: "set-plan", plan: [{ kind: "help", who: "p0" }, { kind: "guard" }] }))).toBe("bad-plan");
    s = ok(act(s, "p0", { type: "set-plan", plan: GG })).state;
    expect(s.plans.p0).toEqual(GG);
  });

  it("locks the plan after Ready, until Edit", () => {
    let s = pickRoles(start(3).state);
    s = ok(act(s, "p0", { type: "ready" })).state;
    expect(err(act(s, "p0", { type: "set-plan", plan: GG }))).toBe("ready-locked");
    s = ok(act(s, "p0", { type: "unready" })).state;
    s = ok(act(s, "p0", { type: "set-plan", plan: GG })).state;
    expect(g.getPrivateState(s, "p0")).toMatchObject({ plan: GG, ready: false });
  });

  it("closes when every explorer who is up is Ready, and down players are not waited for", () => {
    let s = pickRoles(start(3).state);
    const down = me(s, "p2");
    down.down = true; down.hearts = 0;
    expect(err(act(s, "p2", { type: "set-plan", plan: GG }))).toBe("down");
    expect(err(act(s, "p2", { type: "ready" }))).toBe("down");
    s = ok(act(s, "p0", { type: "ready" })).state; // no plan: Guard, Guard
    expect(g.getAwaitedPlayerIds(s)).toEqual(["p1"]);
    s = ok(act(s, "p1", { type: "ready" })).state;
    expect(["choice", "report"]).toContain(s.phase);
  });

  it("skip in the plan is Guard, Guard and Ready", () => {
    let s = pickRoles(start(3).state);
    s = ok(act(s, "p0", { type: "set-plan", plan: [{ kind: "look" }, { kind: "look" }] })).state;
    const t = skip(s, "p0");
    s = t.state;
    expect(s.plans.p0).toEqual(GG);
    expect(s.ready).toContain("p0");
    expect(s.phase).toBe("plan");
    // The room counts a skip with no events as "can't skip".
    expect(t.events).toEqual([{ visibility: { kind: "public" }, event: { type: "skipped", playerId: "p0" } }]);
  });

  it("skip in the roles gives a random role, and says so", () => {
    const t = skip(start(3).state, "p1");
    expect(t.state.world.explorers.find((e) => e.id === "p1")!.role).not.toBeNull();
    expect(t.state.phase).toBe("roles");
    expect(t.events).toContainEqual({ visibility: { kind: "public" }, event: { type: "skipped", playerId: "p1" } });
  });
});

describe("choice", () => {
  /** Round 1 with this event, everyone Guards, the plan closes into the choice. */
  function toChoice(id: keyof typeof EVENTS, tiles: string[] = [], n = 2, prep?: (s: S) => void): S {
    let s = pickRoles(start(n).state);
    s = withEvent(s, id, tiles);
    prep?.(s);
    s = planAll(s, Object.fromEntries(s.world.explorers.filter((e) => !e.down).map((e) => [e.id, GG]))).state;
    expect(s.phase).toBe("choice");
    return s;
  }
  const brokenBridge = (s: S): string => {
    const t = s.world.order.find((x) => x !== s.board.camp && !s.world.tiles[x]!.ruin && s.world.tiles[x]!.terrain !== "gate")!;
    s.world.tiles[t]!.terrain = "broken";
    s.world.tiles[t]!.open = true; // the stone hand marks only open bridges
    return t;
  };

  it("a bargain tied 1-1 is Refuse, and the Refuse counts as a No-go", () => {
    let bridge = "";
    let s = toChoice("stone-hand", [], 2, (x) => { bridge = brokenBridge(x); x.event!.tiles = [bridge]; });
    s = ok(act(s, "p0", { type: "vote", option: 0 })).state;
    s = ok(act(s, "p1", { type: "vote", option: 1 })).state;
    expect(s.phase).toBe("report");
    expect(s.pending).toBeNull();
    expect(s.world.tiles[bridge]!.terrain).toBe("broken");
    expect(s.lastRound!.votes).toEqual([1, 1]);
    expect(g.partyStats!(s)).toEqual({ p1: { noGoVotes: 1 } });
  });

  it("a bargain with more Accept than Refuse is accepted", () => {
    let bridge = "";
    let s = toChoice("stone-hand", [], 3, (x) => { bridge = brokenBridge(x); x.event!.tiles = [bridge]; });
    s = voteAll(s, 0, { p2: 1 }).state;
    expect(s.world.tiles[bridge]!.terrain).toBe("bridge");
    expect(s.pending).toEqual({ tile: bridge, due: 1 + 2 });
  });

  it("no votes on a bargain is Refuse", () => {
    let bridge = "";
    const s = toChoice("stone-hand", [], 2, (x) => { bridge = brokenBridge(x); x.event!.tiles = [bridge]; });
    const t = ring(s);
    expect(t.state.phase).toBe("report");
    expect(t.state.pending).toBeNull();
  });

  it("another event tied 1-1 goes to the first option", () => {
    let s = toChoice("clear-sky", [], 2, (x) => { x.event!.tiles = [x.board.gate, x.board.ruins.cave]; });
    expect(err(act(s, "p0", { type: "vote", option: 2 }))).toBe("bad-choice");
    s = ok(act(s, "p0", { type: "vote", option: 1 })).state;
    s = ok(act(s, "p1", { type: "vote", option: 0 })).state;
    expect(s.lastRound!.steps).toContainEqual({ t: "event", id: "clear-sky", option: 0, nothing: false });
    expect(s.world.tiles[s.board.gate]!.open).toBe(true);
  });

  it("down players vote too", () => {
    const s = toChoice("clear-sky", [], 2, (x) => { x.event!.tiles = [x.board.gate]; const e = me(x, "p1"); e.down = true; e.hearts = 0; });
    expect(s.ballot!.eligible).toEqual(["p0", "p1"]);
    expect(g.getAwaitedPlayerIds(s)).toEqual(["p0", "p1"]);
  });

  it("skip in the choice drops the vote", () => {
    let s = toChoice("clear-sky", [], 3, (x) => { x.event!.tiles = [x.board.gate]; });
    s = ok(act(s, "p0", { type: "vote", option: 1 })).state;
    const t = skip(s, "p1");
    expect(t.events.length).toBeGreaterThan(0);
    s = t.state;
    expect(s.ballot!.eligible).toEqual(["p0", "p2"]);
    s = ok(act(s, "p2", { type: "vote", option: 1 })).state;
    expect(s.phase).toBe("report");
  });

  it("removing a player during the choice drops their vote", () => {
    let s = toChoice("clear-sky", [], 3, (x) => { x.event!.tiles = [x.board.gate, x.board.ruins.cave]; });
    s = ok(act(s, "p0", { type: "vote", option: 1 })).state;
    s = remove(s, "p0").state;
    expect(s.ballot!.eligible).toEqual(["p1", "p2"]);
    expect(s.ballot!.votes).toEqual({});
    s = ok(act(s, "p1", { type: "vote", option: 0 })).state;
    s = ok(act(s, "p2", { type: "vote", option: 0 })).state;
    expect(s.lastRound!.votes).toEqual([2, 0]);
  });
});

describe("report and rounds", () => {
  it("moves to the next round after everyone taps Next", () => {
    let s = pickRoles(start(2).state);
    const second = s.next;
    s = round(s);
    expect(s.phase).toBe("plan");
    expect(s.world.round).toBe(2);
    expect(s.world.sun).toBe(1);
    expect(s.event!.id).toBe(second);
    expect(s.plans).toEqual({});
    expect(s.ready).toEqual([]);
    expect(s.lastRound!.round).toBe(1);
  });

  it("skip in the report counts as Next", () => {
    let s = pickRoles(start(2).state);
    s = withEvent(s, "rain");
    s = planAll(s, { p0: GG, p1: GG }).state;
    expect(s.phase).toBe("report");
    expect(g.getAwaitedPlayerIds(s)).toEqual([]);
    const t = skip(s, "p0");
    expect(t.events.length).toBeGreaterThan(0);
    s = t.state;
    expect(s.nexts).toEqual(["p0"]);
    s = ok(act(s, "p1", { type: "next" })).state;
    expect(s.phase).toBe("plan");
  });

  it("names players with tokens in the report lines", () => {
    let s = pickRoles(start(2).state);
    s = withEvent(s, "rain");
    s = planAll(s, { p0: GG, p1: GG }).state;
    expect(s.lastRound!.lines).toContain("Rain: nothing happened.");
  });
});

describe("removal", () => {
  it("drops a removed player's plan mid-plan, and the round closes on the rest", () => {
    let s = pickRoles(start(3).state);
    s = ok(act(s, "p0", { type: "set-plan", plan: [{ kind: "look" }, { kind: "look" }] })).state;
    s = ok(act(s, "p1", { type: "ready" })).state;
    s = remove(s, "p0").state;
    expect(s.plans.p0).toBeUndefined();
    expect(me(s, "p0").left).toBe(true);
    expect(me(s, "p0").items).toEqual([]);
    expect(s.phase).toBe("plan");
    expect(g.getAwaitedPlayerIds(s)).toEqual(["p2"]);
    s = remove(s, "p2").state;
    expect(["choice", "report"]).toContain(s.phase);
    expect(s.beatSteps.concat(s.lastRound?.steps ?? []).some((x) => "who" in x && x.who === "p0")).toBe(false);
  });

  it("removing the last player ends the game early", () => {
    let s = pickRoles(start(2).state);
    s = remove(s, "p0").state;
    expect(s.phase).toBe("plan");
    const t = remove(s, "p1");
    expect(t.state.phase).toBe("over");
    expect(t.timers).toEqual([{ kind: "cancel", timerId: "phase" }]);
    expect(g.getResult(t.state)).toEqual({ winnerIds: [], standings: [], headline: "The game ended early." });
  });
});

describe("a whole game", () => {
  it("a scripted 2-player win reaches over with both as winners", () => {
    let s = pickRoles(start(2, {}, 7).state);
    s = round(s);
    // Fast forward: all 3 key stones found, and both on the gate.
    s.world.stones = ["shrine", "tower", "cave"];
    for (const e of s.world.explorers) e.tile = s.board.gate;
    s.world.tiles[s.board.gate]!.open = true;
    s = withEvent(s, "rain");
    const plans: Record<string, Plan> = { p0: [{ kind: "act", at: s.board.gate }, { kind: "guard" }], p1: GG };
    s = planAll(s, plans).state;
    expect(s.phase).toBe("report");
    expect(s.world.gateOpen).toBe(true);
    expect(s.end).toBe("win");
    expect(s.lastRound!.lines[0]).toBe("{{p0}} opened the gate.");
    expect(g.getResult(s)).toBeNull();
    const t = nextAll(s);
    expect(t.state.phase).toBe("over");
    const r = g.getResult(t.state)!;
    expect(r.winnerIds).toEqual(["p0", "p1"]);
    expect(r.headline).toBe(`You escaped with ${10 - 2} rounds left.`);
    expect(r.standings.map((x) => x.playerId)).toEqual(["p0", "p1"]);
  });

  it("says just in time, and 1 round left, counting the sun Force moved on", () => {
    const won = (round: number, sun = round - 1) => {
      let s = pickRoles(start(2).state);
      s.world.round = round;
      s.world.sun = sun;
      s.world.stones = ["shrine", "tower", "cave"];
      for (const e of s.world.explorers) e.tile = s.board.gate;
      s = withEvent(s, "rain");
      s = planAll(s, { p0: [{ kind: "act", at: s.board.gate }, { kind: "guard" }], p1: GG }).state;
      return g.getResult(nextAll(s).state)!.headline;
    };
    expect(won(10)).toBe("You escaped just in time.");
    expect(won(9)).toBe("You escaped with 1 round left.");
    expect(won(5)).toBe("You escaped with 5 rounds left.");
    expect(won(5, 6)).toBe("You escaped with 3 rounds left."); // two Forces
    expect(won(9, 10)).toBe("You escaped just in time."); // Force pushed the sun to the limit
  });

  it("labels the standings with Hearts", () => {
    let s = pickRoles(start(3).state);
    me(s, "p1").hearts = 1;
    const d = me(s, "p2"); d.down = true; d.hearts = 0;
    s.end = "sun"; s.phase = "over";
    expect(g.getResult(s)!.standings).toEqual([
      { playerId: "p0", value: 3, label: "3 Hearts" },
      { playerId: "p1", value: 1, label: "1 Heart" },
      { playerId: "p2", value: 0, label: "Down" },
    ]);
    expect(g.getResult(s)!.winnerIds).toEqual([]);
    expect(g.getResult(s)!.headline).toBe(`The sun went down. ${s.world.stones.length} of 3 key stones found.`);
    s.end = "down";
    expect(g.getResult(s)!.headline).toBe(`Everyone was down. ${s.world.stones.length} of 3 key stones found.`);
  });

  it.each([8, 10, 12] as const)("ringing the timer with nobody acting ends the game (sun %i)", (sunLimit) => {
    for (const seed of [1, 2, 3]) {
      let s = start(3, { sunLimit }, seed).state;
      let rings = 0;
      while (s.phase !== "over" && rings < sunLimit * 4 + 2) {
        s = ring(s, seed + rings).state;
        rings++;
      }
      expect(s.phase, `seed ${seed}`).toBe("over");
      expect(g.getResult(s)!.winnerIds).toEqual([]);
    }
  });

  it("partyStats counts rescues, fires lit and No-go votes", () => {
    let s = pickRoles(start(2).state);
    const w = s.world;
    // p0 holds a Torch next to a forest tile; p1 is down next to p0.
    const camp = s.board.camp;
    const forest = neighbours(camp)[0]!;
    w.tiles[forest]!.terrain = "forest";
    w.tiles[forest]!.fire = 0;
    me(s, "p0").items = ["torch"];
    const d = me(s, "p1"); d.down = true; d.hearts = 0;
    s = withEvent(s, "rain");
    s = planAll(s, { p0: [{ kind: "help", who: "p1" }, { kind: "item", item: "torch", at: forest }] }).state;
    expect(s.phase).toBe("report");
    expect(g.partyStats!(s)).toEqual({ p0: { rescues: 1, firesLit: 1 } });
    s = nextAll(s).state;
    // A bargain next: p1 says Refuse.
    const bridge = s.world.order.find((x) => !s.world.tiles[x]!.ruin && s.world.tiles[x]!.terrain === "grass" && x !== camp)!;
    s.world.tiles[bridge]!.terrain = "broken";
    s = withEvent(s, "stone-hand", [bridge]);
    s = planAll(s, { p0: GG, p1: GG }).state;
    s = voteAll(s, 0, { p1: 1 }).state;
    expect(g.partyStats!(s)).toEqual({ p0: { rescues: 1, firesLit: 1 }, p1: { noGoVotes: 1 } });
  });
});

describe("guards", () => {
  it("refuses actions in the wrong phase, after time, and from someone not in the game", () => {
    const s = pickRoles(start(2).state);
    expect(err(act(s, "p0", { type: "vote", option: 0 }))).toBe("wrong-phase");
    expect(err(act(s, "p0", { type: "next" }))).toBe("wrong-phase");
    expect(err(act(s, "p0", { type: "pick-role", role: "runner" }))).toBe("wrong-phase");
    expect(err(act(s, "p0", { type: "ready" }, s.deadline))).toBe("time-up");
    expect(err(act(s, "p9", { type: "ready" }))).toBe("not-in-game");
  });

  it("ignores an early or stray alarm", () => {
    const s = pickRoles(start(2).state);
    expect(g.onTimer!(s, "phase", ctx(s.deadline - 5000)).state).toBe(s);
    expect(g.onTimer!(s, "other", ctx(s.deadline)).state).toBe(s);
  });
});

describe("parseAction", () => {
  it.each([
    [{ type: "pick-role", role: "runner" }, true],
    [{ type: "ready" }, true],
    [{ type: "unready" }, true],
    [{ type: "next" }, true],
    [{ type: "vote", option: 1 }, true],
    [{ type: "set-plan", plan: [{ kind: "move", to: "0,0" }, { kind: "act", at: "1,0", approach: "force", way: "bold" }] }, true],
    [{ type: "set-plan", plan: [{ kind: "item", item: "medkit", who: "p1" }, { kind: "help", who: "p1" }] }, true],
    [{ type: "set-plan", plan: [{ kind: "item", item: "torch", at: "1,0" }, { kind: "look" }] }, true],
    [{ type: "ready", extra: 1 }, false],
    [{ type: "vote", option: 1.5 }, false],
    [{ type: "vote", option: -1 }, false],
    [{ type: "vote", option: "0" }, false],
    [{ type: "set-plan", plan: [{ kind: "guard" }] }, false],
    [{ type: "set-plan", plan: [{ kind: "guard" }, { kind: "guard" }, { kind: "guard" }] }, false],
    [{ type: "set-plan", plan: [{ kind: "guard", at: "0,0" }, { kind: "guard" }] }, false],
    [{ type: "set-plan", plan: [{ kind: "move" }, { kind: "guard" }] }, false],
    [{ type: "set-plan", plan: [{ kind: "act", at: "0,0", approach: 2 }, { kind: "guard" }] }, false],
    [{ type: "set-plan", plan: [{ kind: "act", at: "0,0", way: "fast" }, { kind: "guard" }] }, false],
    [{ type: "set-plan", plan: [{ kind: "item", item: "rope", at: "0,0" }, { kind: "guard" }] }, false],
    [{ type: "set-plan", plan: [{ kind: "fly" }, { kind: "guard" }] }, false],
    [{ type: "set-plan", plan: { 0: { kind: "guard" }, 1: { kind: "guard" } } }, false],
    [{ type: "dance" }, false],
    [null, false],
    ["ready", false],
  ])("%j → %s", (input, good) => {
    expect(g.parseAction(input) !== null).toBe(good);
  });

  it("keeps a card's own fields and nothing else", () => {
    expect(g.parseAction({ type: "set-plan", plan: [{ kind: "act", at: "1,0" }, { kind: "guard" }] })).toEqual({
      type: "set-plan", plan: [{ kind: "act", at: "1,0" }, { kind: "guard" }],
    });
  });
});
