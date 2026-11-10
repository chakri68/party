import { seededRandomInt, type GameContext, type MatchContext } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { treasureHuntGame as th, type THState } from "../server/game.ts";
import { TEAM_COLORS, teamColor } from "../shared/teams.ts";
import { DEFAULT_SETTINGS, type THAction } from "../shared/types.ts";

const ctx = (extra: Partial<GameContext> = {}): GameContext => ({ now: 1000, randomInt: seededRandomInt(7), hostId: "p0", ...extra });
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
const match = (carry?: unknown): MatchContext => ({ roundNumber: 1, dealerSeat: 0, ...(carry !== undefined && { carry }) });
const make = (n = 2, carry?: unknown) => th.createGame(players(n), DEFAULT_SETTINGS, match(carry), ctx()).state;

function act(state: THState, id: string, action: THAction, c = ctx()) {
  const r = th.handleAction(state, id, action, c);
  if (!r.ok) throw new Error(r.error.code);
  return r.transition;
}
const fail = (state: THState, id: string, action: THAction, c = ctx()) => {
  const r = th.handleAction(state, id, action, c);
  return r.ok ? "ok" : r.error.code;
};
/** Just the public part of each team: the pools are tested in claim and team-timed. */
const teamsOf = (s: THState) => s.teams.map(({ id, color }) => ({ id, color }));
const teamOf = (s: THState, id: string) => s.players.find((p) => p.id === id)!.teamId;
const readyAll = (s: THState) => s.players.reduce((st, p) => act(st, p.id, { type: "ready" }).state, s);

describe("team colours", () => {
  it("copies Blind Rally's eight, in order", () => {
    expect(TEAM_COLORS.map((c) => c.key)).toEqual(["orange", "sky", "green", "purple", "yellow", "blue", "red", "white"]);
    expect(teamColor("green")).toEqual({ key: "green", name: "Green", hex: "#009e73", shape: "triangle" });
  });
});

describe("teams phase", () => {
  it("solo game: one team, start → countdown", () => {
    let s = make(1);
    expect(s.phase).toBe("teams");
    expect(teamsOf(s)).toEqual([{ id: 1, color: "orange" }]);
    expect(teamOf(s, "p0")).toBe(1);
    s = act(s, "p0", { type: "ready" }).state;
    // Ready alone never starts the round.
    expect(s.phase).toBe("teams");
    const t = act(s, "p0", { type: "start" }, ctx({ now: 4000 }));
    expect(t.state.phase).toBe("countdown");
    expect(t.state.countdownEndsAt).toBe(4000 + 3000);
    expect(t.events.map((e) => e.event)).toEqual([{ type: "countdown", spectators: [] }]);
    const pub = th.getPublicState(t.state);
    expect(pub.teams).toEqual([{ id: 1, color: "orange", foundCount: 0, poolSize: t.state.teams[0]!.pool.length }]);
    expect(pub.players[0]!.teamId).toBe(1);
  });

  it("every player starts on their own team, in colour order", () => {
    const s = make(3);
    expect(teamsOf(s)).toEqual([
      { id: 1, color: "orange" },
      { id: 2, color: "sky" },
      { id: 3, color: "green" },
    ]);
    expect(s.players.map((p) => p.teamId)).toEqual([1, 2, 3]);
  });

  it("team.join moves a player and deletes an empty team", () => {
    let s = make(3);
    s = act(s, "p1", { type: "team.join", teamId: 1 }).state;
    expect(teamOf(s, "p1")).toBe(1);
    expect(s.teams.map((t) => t.id)).toEqual([1, 3]);
    // Sky is free again: a new team takes it.
    s = act(s, "p2", { type: "team.new" }).state;
    expect(s.teams.find((t) => t.id === teamOf(s, "p2"))!.color).toBe("sky");
    expect(s.teams).toHaveLength(2);
    expect(fail(s, "p0", { type: "team.join", teamId: 42 })).toBe("no-such-team");
    expect(th.getPublicState(s).teams.map((t) => t.id).sort()).toEqual(s.teams.map((t) => t.id).sort());
  });

  it("ninth team is refused", () => {
    let s = make(8);
    expect(s.teams).toHaveLength(8);
    expect(new Set(s.teams.map((t) => t.color)).size).toBe(8);
    const r = th.handleAction(s, "p0", { type: "team.new" }, ctx());
    expect(r).toEqual({ ok: false, error: { code: "too-many-teams", message: "There are already 8 teams." } });
    // Two share a team: there's room for one more.
    s = act(s, "p1", { type: "team.join", teamId: 1 }).state;
    s = act(s, "p1", { type: "team.new" }).state;
    expect(s.teams).toHaveLength(8);
  });

  it("only the host can start or assign", () => {
    let s = readyAll(make(2));
    expect(fail(s, "p1", { type: "start" })).toBe("not-host");
    expect(fail(s, "p1", { type: "team.assign", playerId: "p0", teamId: 2 })).toBe("not-host");
    s = act(s, "p0", { type: "team.assign", playerId: "p1", teamId: 1 }).state;
    expect(teamOf(s, "p1")).toBe(1);
    expect(teamsOf(s)).toEqual([{ id: 1, color: "orange" }]);
    expect(fail(s, "p0", { type: "team.assign", playerId: "zz", teamId: 1 })).toBe("not-in-game");
    expect(act(s, "p0", { type: "start" }).state.phase).toBe("countdown");
  });

  it("team actions only work in the teams phase", () => {
    const s = act(readyAll(make(2)), "p0", { type: "start" }).state;
    expect(fail(s, "p1", { type: "team.join", teamId: 1 })).toBe("wrong-phase");
    expect(fail(s, "p1", { type: "team.new" })).toBe("wrong-phase");
    expect(fail(s, "p0", { type: "team.assign", playerId: "p1", teamId: 1 })).toBe("wrong-phase");
    expect(fail(s, "p0", { type: "start" })).toBe("wrong-phase");
  });

  it("start needs a ready player", () => {
    const r = th.handleAction(make(2), "p0", { type: "start" }, ctx());
    expect(r).toEqual({ ok: false, error: { code: "nobody-ready", message: "Wait until someone has loaded the map." } });
  });

  it("host leaves in teams phase: the new ctx.hostId can start", () => {
    let s = readyAll(make(3));
    const t = th.onPlayerRemoved!(s, "p0", ctx({ hostId: "p1" }));
    s = t.state;
    expect(s.phase).toBe("teams");
    // The old host's team went with them.
    expect(s.teams.map((x) => x.id)).toEqual([2, 3]);
    expect(fail(s, "p2", { type: "start" }, ctx({ hostId: "p1" }))).toBe("not-host");
    expect(act(s, "p1", { type: "start" }, ctx({ hostId: "p1" })).state.phase).toBe("countdown");
  });

  it("carry puts players back on their teams; a newcomer gets a new team", () => {
    let s = make(3);
    s = act(s, "p1", { type: "team.join", teamId: 1 }).state;
    s = act(readyAll(s), "p0", { type: "start" }).state;
    s = th.onTimer!(s, "countdown", ctx({ now: 5000 })).state;
    s = th.onTimer!(s, "round", ctx({ now: 9000 })).state;
    expect(s.phase).toBe("finished");
    expect(th.carryOver!(s)).toEqual({ teams: [
      { color: "orange", members: ["p0", "p1"] },
      { color: "green", members: ["p2"] },
    ] });

    // A carry from elsewhere: kept colours, a player who left, and a newcomer (p3).
    const carry = { teams: [
      { color: "purple", members: ["p0", "p1"] },
      { color: "sky", members: ["p2", "gone"] },
    ] };
    const next = make(4, carry);
    expect(teamsOf(next)).toEqual([
      { id: 1, color: "purple" },
      { id: 2, color: "sky" },
      { id: 3, color: "orange" },
    ]);
    expect(next.players.map((p) => p.teamId)).toEqual([1, 1, 2, 3]);
  });

  it("junk carry is ignored", () => {
    for (const carry of [null, 3, "x", { teams: 3 }, { teams: [{ color: 5, members: "p0" }] }]) {
      const s = th.createGame(players(2), DEFAULT_SETTINGS, match(carry), ctx()).state;
      expect(s.players.map((p) => p.teamId)).toEqual([1, 2]);
    }
  });

  it("not-ready players become spectators on start", () => {
    let s = make(3);
    s = act(s, "p2", { type: "team.join", teamId: 1 }).state;
    s = act(s, "p0", { type: "ready" }).state;
    expect(th.getAwaitedPlayerIds(s)).toEqual(["p1", "p2"]);
    const t = act(s, "p0", { type: "start" });
    s = t.state;
    expect(s.players.map((p) => p.spectator)).toEqual([false, true, true]);
    expect(t.events.map((e) => e.event)).toEqual([{ type: "countdown", spectators: ["p1", "p2"] }]);
    expect(s.teams.find((x) => x.id === 2)!.pool).toEqual([]);
    expect(th.getAwaitedPlayerIds(s)).toEqual([]);
    // p1's team has no hunters: it takes no part (no pool).
    expect(th.getPublicState(s).teams.find((x) => x.id === 2)!.poolSize).toBe(0);
  });

  it("parseAction reads the team actions and rejects junk", () => {
    expect(th.parseAction({ type: "team.join", teamId: 2 })).toEqual({ type: "team.join", teamId: 2 });
    expect(th.parseAction({ type: "team.new", x: 1 })).toEqual({ type: "team.new" });
    expect(th.parseAction({ type: "team.assign", playerId: "p1", teamId: 3 })).toEqual({ type: "team.assign", playerId: "p1", teamId: 3 });
    expect(th.parseAction({ type: "start" })).toEqual({ type: "start" });
    for (const bad of [{ type: "team.join" }, { type: "team.join", teamId: "1" }, { type: "team.join", teamId: 1.5 }, { type: "team.join", teamId: 0 }, { type: "team.assign", teamId: 1 }, { type: "team.assign", playerId: 3, teamId: 1 }])
      expect(th.parseAction(bad)).toBeNull();
  });

  it("settings: mode, minutes and target, with defaults", () => {
    expect(th.defaultSettings).toEqual({ mode: "timed", minutes: 30, time: "day", target: 5 });
    expect(th.parseSettings(undefined)).toEqual({ mode: "timed", minutes: 30, time: "day", target: 5 });
    expect(th.parseSettings({ minutes: 15 })).toEqual({ mode: "timed", minutes: 15, time: "day", target: 5 });
    expect(th.parseSettings({ mode: "race", minutes: 60, target: 10 })).toEqual({ mode: "race", minutes: 60, time: "day", target: 10 });
    for (const bad of [{ mode: "solo" }, { target: 2 }, { target: 11 }, { target: "5" }, { minutes: 20 }]) expect(th.parseSettings(bad)).toBeNull();
  });
});
