import { describe, expect, it } from "vitest";
import { parseAction } from "../server/parse.ts";
import { canMove } from "../server/phases.ts";
import { seatOf } from "../server/teams.ts";
import { blindRallySettingFields, parseSettings } from "../shared/rules-text.ts";
import { COUNTDOWN_MS, RESET_HOLD_MS, RESET_PENALTY_MS, TEAM_COLORS, type BlindRallyPublicState } from "../shared/types.ts";
import { act, ctx, game, newGame, racing, refused, TRACK } from "./helpers.ts";

const pub = (s: ReturnType<typeof newGame>) => game.getPublicState(s) as BlindRallyPublicState;
const roleOf = (s: ReturnType<typeof newGame>, id: string) => {
  const seat = seatOf(s, id);
  return seat ? `${seat.team.id}:${seat.role}` : null;
};

describe("phases", () => {
  it("starts in TEAMS with a car per two players, up to four", () => {
    expect(newGame(2).teams).toHaveLength(1);
    expect(newGame(5).teams).toHaveLength(3);
    expect(newGame(12).teams).toHaveLength(4);
    expect(newGame(2).phase).toBe("teams");
  });

  it("practice is one car, however many turn up", () => {
    expect(newGame(6, { mode: "practice" }).teams).toHaveLength(1);
  });

  it("only moves along the table", () => {
    expect(canMove("teams", "countdown")).toBe(true);
    expect(canMove("teams", "racing")).toBe(false);
    expect(canMove("racing", "teams")).toBe(false);
    expect(canMove("finished", "teams")).toBe(false);
  });

  it("TEAMS → COUNTDOWN on start, → RACING on the go timer, → finished when time's up", () => {
    let s = racing([["p0", "p1"]]);
    expect(s.phase).toBe("countdown");
    expect(s.startsAt).toBe(COUNTDOWN_MS);
    expect(s.endsAt).toBe(COUNTDOWN_MS + 5 * 60_000);
    s = game.onTimer!(s, "go", ctx(COUNTDOWN_MS)).state;
    expect(s.phase).toBe("racing");
    expect(game.getResult(s)).toBeNull();
    s = game.onTimer!(s, "time-up", ctx(s.endsAt!)).state;
    expect(s.phase).toBe("finished");
    expect(s.teams[0]!.run!.status).toBe("dnf");
    expect(game.getResult(s)!.standings.map((r) => r.label)).toEqual(Array(2).fill(`1st · Team 1 · ${TRACK.name}\nDNF, 0/${TRACK.checkpoints.length} checkpoints`));
  });

  it("the start asks for both timers: the go and the time limit", () => {
    let s = newGame(2);
    s = act(s, "p0", { type: "team.join", teamId: 1, role: "driver" });
    s = act(s, "p1", { type: "team.join", teamId: 1, role: "navigator" });
    s = act(s, "p0", { type: "player.ready", ready: true });
    s = act(s, "p1", { type: "player.ready", ready: true });
    const r = game.handleAction(s, "p0", { type: "race.start" }, ctx(1_000));
    expect(r.ok && r.transition.timers).toEqual([
      { kind: "set", timerId: "go", delayMs: COUNTDOWN_MS },
      { kind: "set", timerId: "time-up", delayMs: COUNTDOWN_MS + 5 * 60_000 },
    ]);
  });

  it("a stray timer in the wrong phase does nothing", () => {
    const s = newGame(2);
    expect(game.onTimer!(s, "go", ctx()).state).toBe(s);
    expect(game.onTimer!(s, "time-up", ctx()).state).toBe(s);
  });

  it("the host can call the race early; anyone else can't", () => {
    const s = racing([["p0", "p1"]]);
    refused(s, "p1", { type: "race.end" }, "not-host");
    const done = act(s, "p0", { type: "race.end" });
    expect(done.phase).toBe("finished");
    refused(done, "p0", { type: "race.end" }, "wrong-phase");
  });
});

describe("teams and roles", () => {
  it("one role per player: sitting elsewhere leaves the old seat", () => {
    let s = newGame(4);
    s = act(s, "p0", { type: "team.join", teamId: 1, role: "driver" });
    s = act(s, "p0", { type: "team.join", teamId: 2, role: "navigator" });
    expect(s.teams[0]!.driverId).toBeNull();
    expect(roleOf(s, "p0")).toBe("2:navigator");
    const seats = s.teams.flatMap((t) => [t.driverId, t.navigatorId]).filter((id) => id === "p0");
    expect(seats).toHaveLength(1);
  });

  it("a taken seat can't be self-picked", () => {
    let s = newGame(3);
    s = act(s, "p0", { type: "team.join", teamId: 1, role: "driver" });
    refused(s, "p1", { type: "team.join", teamId: 1, role: "driver" }, "seat-taken");
    refused(s, "p1", { type: "team.join", teamId: 4, role: "driver" }, "no-such-team");
  });

  it("role.pick swaps with the teammate", () => {
    let s = newGame(2);
    s = act(s, "p0", { type: "team.join", teamId: 1, role: "driver" });
    s = act(s, "p1", { type: "team.join", teamId: 1, role: "navigator" });
    s = act(s, "p0", { type: "role.pick", role: "navigator" });
    expect(roleOf(s, "p0")).toBe("1:navigator");
    expect(roleOf(s, "p1")).toBe("1:driver");
    refused(s, "p0", { type: "role.pick", role: "navigator" }, "already-there");
  });

  it("the Navigator is captain by default", () => {
    let s = newGame(2);
    s = act(s, "p0", { type: "team.join", teamId: 1, role: "driver" });
    expect(pub(s).teams[0]!.captainId).toBe("p0"); // only one in the car
    s = act(s, "p1", { type: "team.join", teamId: 1, role: "navigator" });
    expect(pub(s).teams[0]!.captainId).toBe("p1");
  });

  it("host-only assign, bumping whoever's in the seat", () => {
    let s = newGame(4);
    s = act(s, "p2", { type: "team.join", teamId: 1, role: "driver" });
    refused(s, "p1", { type: "team.assign", playerId: "p3", teamId: 1, role: "driver" }, "not-host");
    s = act(s, "p0", { type: "team.assign", playerId: "p3", teamId: 1, role: "driver" });
    expect(roleOf(s, "p3")).toBe("1:driver");
    expect(roleOf(s, "p2")).toBeNull();
    s = act(s, "p0", { type: "team.assign", playerId: "p3", teamId: null });
    expect(roleOf(s, "p3")).toBeNull();
    // Without a role it takes the free seat, Navigator first.
    s = act(s, "p0", { type: "team.assign", playerId: "p1", teamId: 2 });
    expect(roleOf(s, "p1")).toBe("2:navigator");
  });

  it("whoever the runtime says is host is host: it can move mid-game", () => {
    const s = newGame(3);
    refused(s, "p0", { type: "team.assign", playerId: "p1", teamId: 1 }, "not-host", ctx(0, "p2"));
    expect(game.handleAction(s, "p2", { type: "team.assign", playerId: "p1", teamId: 1 }, ctx(0, "p2")).ok).toBe(true);
    // A ctx without a host (a bare test) has no host at all.
    refused(s, "p0", { type: "team.assign", playerId: "p1", teamId: 1 }, "not-host", ctx(0, null));
  });

  it("ready needs a seat, and any change to your car un-readies it", () => {
    let s = newGame(3);
    refused(s, "p2", { type: "player.ready", ready: true }, "not-seated");
    s = act(s, "p0", { type: "team.join", teamId: 1, role: "driver" });
    s = act(s, "p1", { type: "team.join", teamId: 1, role: "navigator" });
    s = act(s, "p0", { type: "player.ready", ready: true });
    s = act(s, "p1", { type: "player.ready", ready: true });
    s = act(s, "p0", { type: "role.pick", role: "navigator" });
    expect(s.players.filter((p) => p.ready)).toEqual([]);
  });

  it("the host can only start when every full car is ready and no car is half full", () => {
    let s = newGame(4);
    expect(pub(s).startBlocker).toMatch(/Driver and a Navigator/);
    refused(s, "p0", { type: "race.start" }, "cannot-start");
    s = act(s, "p0", { type: "team.join", teamId: 1, role: "driver" });
    s = act(s, "p1", { type: "team.join", teamId: 1, role: "navigator" });
    s = act(s, "p2", { type: "team.join", teamId: 2, role: "driver" });
    expect(pub(s).startBlocker).toBe("Team 2 needs a Navigator.");
    s = act(s, "p0", { type: "team.assign", playerId: "p2", teamId: null });
    expect(pub(s).startBlocker).toBe("Waiting for 2 players to get ready.");
    s = act(s, "p0", { type: "player.ready", ready: true });
    s = act(s, "p1", { type: "player.ready", ready: true });
    expect(pub(s).startBlocker).toBeNull();
    refused(s, "p1", { type: "race.start" }, "not-host");
    s = act(s, "p0", { type: "race.start" });
    // Spares watch; empty cars don't race.
    expect(s.teams.map((t) => t.run?.status ?? null)).toEqual(["running", null]);
  });

  it("the one-pair practice mode", () => {
    let s = newGame(3, { mode: "practice" });
    refused(s, "p2", { type: "team.join", teamId: 2, role: "driver" }, "no-such-team");
    s = act(s, "p1", { type: "team.join", teamId: 1, role: "driver" });
    s = act(s, "p2", { type: "team.join", teamId: 1, role: "navigator" });
    s = act(s, "p1", { type: "player.ready", ready: true });
    s = act(s, "p2", { type: "player.ready", ready: true });
    s = act(s, "p0", { type: "race.start" }); // the host can be a spare
    expect(s.phase).toBe("countdown");
    expect(pub(s).mode).toBe("practice");
  });

  it("seats can't change once the race is on", () => {
    const s = racing([["p0", "p1"]], 3);
    refused(s, "p2", { type: "team.join", teamId: 1, role: "driver" }, "wrong-phase");
    refused(s, "p0", { type: "role.pick", role: "navigator" }, "wrong-phase");
    refused(s, "p0", { type: "team.assign", playerId: "p2", teamId: 1 }, "wrong-phase");
    refused(s, "p0", { type: "player.ready", ready: false }, "wrong-phase");
    refused(s, "p0", { type: "team.leave" }, "wrong-phase");
    refused(s, "p0", { type: "race.start" }, "wrong-phase");
  });

  it("strangers are refused", () => {
    refused(newGame(2), "zz", { type: "team.join", teamId: 1, role: "driver" }, "not-in-game");
  });

  it("late joiners get a seat to pick before the race and watch during it", () => {
    let s = newGame(2);
    s = game.onPlayerJoined!(s, "p2", ctx()).state;
    s = game.onPlayerJoined!(s, "p3", ctx()).state;
    expect(s.teams).toHaveLength(2);
    const r = racing([["p0", "p1"]]);
    const later = game.onPlayerJoined!(r, "p9", ctx()).state;
    expect(later.players.map((p) => p.id)).toContain("p9");
    expect(seatOf(later, "p9")).toBeNull();
    expect(later.teams).toHaveLength(r.teams.length);
  });

  it("a player removed before the race leaves their seat", () => {
    let s = newGame(2);
    s = act(s, "p0", { type: "team.join", teamId: 1, role: "driver" });
    s = game.onPlayerRemoved!(s, "p0", ctx()).state;
    expect(s.teams[0]!.driverId).toBeNull();
    expect(s.players.map((p) => p.id)).toEqual(["p1"]);
  });
});

describe("team colours", () => {
  it("every car gets its own colour, shape and number when it forms", () => {
    const s = newGame(8);
    expect(s.teams.map((t) => t.color)).toEqual(["orange", "sky", "green", "purple"]);
    const keys = new Set(pub(s).teams.map((t) => t.color));
    expect(keys.size).toBe(4);
    expect(new Set(TEAM_COLORS.map((c) => c.shape)).size).toBe(TEAM_COLORS.length);
  });

  it("a car that appears later takes a colour nobody has", () => {
    let s = newGame(2);
    s = game.onPlayerJoined!(s, "p2", ctx()).state;
    s = game.onPlayerJoined!(s, "p3", ctx()).state;
    expect(s.teams.map((t) => t.color)).toEqual(["orange", "sky"]);
  });

  it("colours carry over to the rematch with the teams", () => {
    // Swap the colours round so "same as before" can't just mean "the default order".
    let s = racing([["p0", "p1"], ["p2", "p3"]]);
    s.teams[0]!.color = "purple";
    s.teams[1]!.color = "orange";
    s = act(s, "p0", { type: "race.end" });
    const next = newGame(4, {}, game.carryOver!(s));
    expect(next.teams.map((t) => t.color)).toEqual(["purple", "orange"]);
  });

  it("junk or duplicate colours in a carry get a free one instead", () => {
    const next = newGame(4, {}, { teams: [{ color: "sky" }, { color: "sky" }, { color: "beige" }] });
    expect(new Set(next.teams.map((t) => t.color)).size).toBe(next.teams.length);
    expect(next.teams[0]!.color).toBe("sky");
  });

  it("the Navigator's session names the team for Godot to paint", () => {
    const nav = game.getPrivateState(racing([["p0", "p1"]]), "p1");
    expect(nav.role === "navigator" && nav.session).toMatchObject({ teamNumber: 1, teamColor: "#e69f00", teamShape: "circle", ghosts: false });
  });
});

describe("reset", () => {
  it("only the Driver, only while the car can move, +5 s each", () => {
    const s = racing([["p0", "p1"]]);
    refused(s, "p0", { type: "race.reset" }, "wrong-phase", ctx(COUNTDOWN_MS - 1));
    refused(s, "p1", { type: "race.reset" }, "not-driver", ctx(COUNTDOWN_MS));
    let t = act(s, "p0", { type: "race.reset" }, ctx(COUNTDOWN_MS));
    t = act(t, "p0", { type: "race.reset" }, ctx(COUNTDOWN_MS + 10));
    expect(t.teams[0]!.run).toMatchObject({ resets: 2, penaltyMs: 2 * RESET_PENALTY_MS });
    const r = game.handleAction(t, "p0", { type: "race.reset" }, ctx(COUNTDOWN_MS + 20));
    expect(r.ok && r.transition.events).toEqual([
      { visibility: { kind: "public" }, event: { type: "reset", teamId: 1, penaltyMs: 3 * RESET_PENALTY_MS } },
      // Where to, only for the Navigator: it names a checkpoint.
      { visibility: { kind: "private", playerId: "p1" }, event: { type: "recover", teamId: 1, checkpoint: 0, holdMs: RESET_HOLD_MS } },
    ]);
  });
});

describe("rematch carry-over", () => {
  it("teams survive into the next game, unready, minus anyone who left", () => {
    let s = racing([["p0", "p1"], ["p2", "p3"]]);
    s = act(s, "p0", { type: "race.end" });
    const carry = game.carryOver!(s);
    // p3 left the room in between; p4 is new.
    const ids = ["p0", "p1", "p2", "p4"].map((id) => ({ id }));
    const next = game.createGame(ids, parseSettings({})!, { roundNumber: 2, dealerSeat: 0, carry }, ctx()).state;
    expect(next.phase).toBe("teams");
    expect(next.teams.map((t) => [t.driverId, t.navigatorId])).toEqual([["p0", "p1"], ["p2", null]]);
    expect(next.players.every((p) => !p.ready)).toBe(true);
    // The swap the results screen can't do happens here, in one tap.
    const swapped = act(next, "p0", { type: "role.pick", role: "navigator" });
    expect(roleOf(swapped, "p0")).toBe("1:navigator");
  });

  it("junk carry is ignored", () => {
    expect(newGame(2, {}, { teams: "nope" }).teams).toHaveLength(1);
    expect(newGame(2, {}, { teams: [{ driverId: 5, navigatorId: "zz" }] }).teams[0]).toMatchObject({ driverId: null, navigatorId: null });
  });
});

describe("parsing", () => {
  it("actions", () => {
    expect(parseAction({ type: "team.join", teamId: 2, role: "driver" })).toEqual({ type: "team.join", teamId: 2, role: "driver" });
    expect(parseAction({ type: "team.join", teamId: 9, role: "driver" })).toBeNull();
    expect(parseAction({ type: "team.join", teamId: 1, role: "pilot" })).toBeNull();
    expect(parseAction({ type: "team.assign", playerId: "p1", teamId: null })).toEqual({ type: "team.assign", playerId: "p1", teamId: null });
    expect(parseAction({ type: "player.ready", ready: "yes" })).toBeNull();
    expect(parseAction({ type: "race.start", extra: 1 })).toEqual({ type: "race.start" });
    expect(parseAction({ type: "teleport" })).toBeNull();
    expect(parseAction({ type: "race.event", kind: "cp", checkpointId: 2, extra: 1 })).toEqual({ type: "race.event", kind: "cp", checkpointId: 2 });
    expect(parseAction({ type: "race.event", kind: "cp", checkpointId: 0 })).toBeNull();
    expect(parseAction({ type: "race.event", kind: "cp", checkpointId: "2" })).toBeNull();
    expect(parseAction({ type: "race.event", kind: "finish", checkpointId: 9 })).toEqual({ type: "race.event", kind: "finish" });
    expect(parseAction({ type: "race.event", kind: "impact" })).toBeNull();
    expect(parseAction({ type: "race.reset", reason: "fell" })).toEqual({ type: "race.reset", reason: "fell" });
    expect(parseAction({ type: "race.reset", reason: "bored" })).toEqual({ type: "race.reset" });
    expect(parseAction(null)).toBeNull();
  });

  it("settings", () => {
    expect(parseSettings(undefined)).toEqual({
      mode: "race", timeLimit: 5, camera: "free", weather: "patchy", stageMode: "solo", trackPick: "host",
      assists: "classic", liveMarker: false, tripMeter: true, paceNotes: true, camera3d: true,
    });
    expect(parseSettings({ stageMode: "shared" })!.stageMode).toBe("shared");
    expect(parseSettings({ stageMode: "mixed" })).toBeNull();
    expect(parseSettings({ timeLimit: 4 })).toBeNull();
    expect(parseSettings({ camera: "drone" })).toBeNull();
    expect(blindRallySettingFields({ mode: "practice" }, 4)[0]!.hint).toBe("1 team, no other cars");
  });
});
