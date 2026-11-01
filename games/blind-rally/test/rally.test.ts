import { describe, expect, it } from "vitest";
import { GHOST_EVERY_MS } from "../server/race.ts";
import { parseSettings } from "../shared/rules-text.ts";
import { DEFAULT_VEHICLE, isVehicleId, VEHICLE_IDS, VEHICLES } from "../shared/vehicles.ts";
import { parseRallySettings, RALLY_DEFAULTS, rallyBriefing, rallyManifest, rallyPreview, rallySettingFields } from "../shared/rally.ts";
import { COUNTDOWN_MS, MAX_TEAMS, RALLY_MAX_CARS, RESET_PENALTY_MS, TEAM_COLORS, type BlindRallyState } from "../shared/types.ts";
import { routeProgress, upcoming } from "../client/rally/progress.ts";
import { vehicleCards } from "../client/rally/vehicle-picker.ts";
import { parseAction } from "../server/parse.ts";
import * as vehicles from "../server/vehicles.ts";
import { act, ctx, driveTo, east, finishRun, game, newGame, newRally, passCheckpoints, racing, rallyGame, rallying, refused, snapAt, SPAWN, TRACK } from "./helpers.ts";

// Rally (rally-spec.md): Blind Rally's race with the blindfold off. Every
// player is a car of one, the controls are on the car's own device, and the
// stage is always shared.

const GO = COUNTDOWN_MS;
const stream = (s: BlindRallyState, from: string, data: unknown, now = GO) => rallyGame.onStream!(s, from, data, ctx(now));
const seats = (s: BlindRallyState) => s.teams.map((t) => [t.id, t.driverId, t.navigatorId]);

describe("one-person teams", () => {
  it("everyone gets a car of their own, in both seats", () => {
    const s = newRally(3);
    expect(s.variant).toBe("rally");
    expect(seats(s)).toEqual([[1, "p0", "p0"], [2, "p1", "p1"], [3, "p2", "p2"]]);
    expect(s.teams.map((t) => t.color)).toEqual(["orange", "sky", "green"]);
  });

  it("past RALLY_MAX_CARS the rest watch, and take the next car that frees up", () => {
    let s = newRally(10);
    expect(s.teams).toHaveLength(RALLY_MAX_CARS);
    expect(s.teams.map((t) => t.driverId)).toEqual(["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7"]);
    s = rallyGame.onPlayerRemoved!(s, "p1", ctx()).state;
    // Car 2 is p8's now, colour and number kept: nobody else's plate moved.
    expect(seats(s)[1]).toEqual([2, "p8", "p8"]);
    expect(s.teams[1]!.color).toBe("sky");
  });

  it("eight players take eight cars, each in its own colour", () => {
    const s = newRally(8);
    expect(s.teams).toHaveLength(8);
    expect(s.teams.map((t) => t.color)).toEqual(TEAM_COLORS.map((c) => c.key));
    expect(new Set(s.teams.map((t) => t.color)).size).toBe(8);
  });

  it("ten players: eight cars and two watchers", () => {
    const s = newRally(10);
    expect(s.teams).toHaveLength(8);
    expect(s.teams.some((t) => t.driverId === "p8" || t.driverId === "p9")).toBe(false);
    expect(rallyGame.getPrivateState(s, "p9").role).toBeNull();
  });

  it("the cap is one car per team colour", () => {
    expect(RALLY_MAX_CARS).toBe(TEAM_COLORS.length);
    expect(MAX_TEAMS).toBe(4);
  });

  it("someone turning up before the start gets a car; after it, they watch", () => {
    let s = newRally(1);
    s = rallyGame.onPlayerJoined!(s, "p7", ctx()).state;
    expect(seats(s)).toEqual([[1, "p0", "p0"], [2, "p7", "p7"]]);
    let r = rallying(2);
    r = rallyGame.onPlayerJoined!(r, "p7", ctx(GO)).state;
    expect(r.teams.some((t) => t.driverId === "p7")).toBe(false);
    expect(rallyGame.getPrivateState(r, "p7").role).toBeNull();
  });

  it("nobody picks, swaps or hands out seats", () => {
    const s = newRally(2);
    refused(s, "p0", { type: "team.join", teamId: 2, role: "driver" }, "own-car");
    refused(s, "p0", { type: "team.leave" }, "own-car");
    refused(s, "p0", { type: "role.pick", role: "navigator" }, "own-car");
    refused(s, "p0", { type: "team.assign", playerId: "p1", teamId: 1 }, "own-car");
  });

  it("one alone can race: a time trial", () => {
    const s = rallying(1);
    expect(s.phase).toBe("countdown");
    expect(s.teams[0]!.run!.status).toBe("running");
  });

  it("the start waits for everyone in a car, not for the watchers", () => {
    let s = newRally(9);
    expect(s.teams.length).toBe(8);
    for (const id of ["p0", "p1", "p2", "p3", "p4", "p5", "p6"]) s = act(s, id, { type: "player.ready", ready: true });
    expect(game.getPublicState(s).startBlocker).toBe("Waiting for 1 player to get ready.");
    s = act(s, "p7", { type: "player.ready", ready: true });
    expect(game.getPublicState(s).startBlocker).toBeNull();
  });

  it("a rematch keeps the cars and colours, and seats a newcomer", () => {
    const first = rallying(2);
    const carry = rallyGame.carryOver!(first);
    const next = rallyGame.createGame([{ id: "p0" }, { id: "p1" }, { id: "p9" }], parseRallySettings({})!, { roundNumber: 2, dealerSeat: 0, carry }, ctx()).state;
    expect(seats(next)).toEqual([[1, "p0", "p0"], [2, "p1", "p1"], [3, "p9", "p9"]]);
    expect(next.variant).toBe("rally");
  });

  it("the ballot is one vote per car, its driver's", () => {
    let s = newRally(3, { trackPick: "ballot" });
    const other = game.getPublicState(s).tracks.find((t) => t.id !== s.trackId)!.id;
    s = act(s, "p1", { type: "track.vote", trackId: other });
    s = act(s, "p2", { type: "track.vote", trackId: other });
    expect(s.trackId).toBe(other);
    expect(game.getPublicState(s).ballot!.votes.map((v) => v.teamId)).toEqual([2, 3]);
  });
});

describe("Rally settings", () => {
  it("pin the stage to shared, the mode to race and every assist on, whatever arrives", () => {
    const s = parseRallySettings({ stageMode: "solo", mode: "practice", assists: "nightmare", liveMarker: false, timeLimit: 8 })!;
    expect(s).toMatchObject({ stageMode: "shared", mode: "race", assists: "beginner", liveMarker: true, tripMeter: true, paceNotes: true, camera3d: true, timeLimit: 8 });
    expect(parseRallySettings(undefined)).toEqual(RALLY_DEFAULTS);
  });

  it("refuse junk in the four free ones", () => {
    expect(parseRallySettings({ timeLimit: 4 })).toBeNull();
    expect(parseRallySettings({ camera: "drone" })).toBeNull();
    expect(parseRallySettings({ weather: "lava" })).toBeNull();
    expect(parseRallySettings({ trackPick: "chaos" })).toBeNull();
    expect(parseRallySettings([1])).toBeNull();
  });

  it("show only what the host can change", () => {
    expect(rallySettingFields({}, 3).map((f) => f.key)).toEqual(["trackPick", "vehiclePick", "timeLimit", "camera", "weather"]);
    expect(rallySettingFields({}, 10).find((f) => f.key === "timeLimit")!.hint).toBe("8 cars race, 2 watch");
  });

  it("are their own lobby entry, one to twelve", () => {
    expect(rallyManifest).toMatchObject({ id: "rally", name: "Rally", minPlayers: 1, maxPlayers: 12, lateJoin: true });
    expect(rallyGame.manifest).toBe(rallyManifest);
    expect(rallyGame.parseSettings).toBe(parseRallySettings);
  });

  it("brief a driver who can see: keys for both jobs, no pins", () => {
    const b = rallyBriefing({});
    expect(b.lines.map((l) => l.label)).toEqual(["Steer", "Go", "Brake", "Reset car", "Pace notes", "Camera", "Map", "Sound"]);
    expect(JSON.stringify(b)).not.toMatch(/guess pin|\bpins?\b/i);
    expect(rallyBriefing({ camera: "bonnet" }).lines.find((l) => l.label === "Camera")!.text).toBe("Bonnet only in this race.");
    expect(rallyPreview({}).find((r) => r.label === "Stage")!.value).toBe("Shared: 1 road, other cars are ghosts");
  });
});

describe("Rally's car on the same device as its controls", () => {
  it("gets the Navigator's screen: the course, starting in chase, every assist, ghosts on", () => {
    const p = rallyGame.getPrivateState(rallying(2), "p1");
    expect(p.role).toBe("navigator");
    if (p.role !== "navigator") return;
    expect(p.teamId).toBe(2);
    expect(p.session).toMatchObject({ camera: "chase", ghosts: true, teamNumber: 2, teamColor: "#56b4e9", teamShape: "square" });
    expect(p.session.assists).toEqual({ liveMarker: true, tripMeter: true, paceNotes: true, camera3d: true });
    // Locked to one camera, that's the one.
    const locked = rallyGame.getPrivateState(rallying(2, { camera: "topdown" }), "p0");
    expect(locked.role === "navigator" && locked.session.camera).toBe("topdown");
  });

  it("streams no input: there's nobody to relay it to", () => {
    expect(stream(rallying(2), "p0", { t: "in", seq: 1, steer: 1, throttle: 1, brake: 0 })).toBeNull();
  });

  it("snapshots are judged the same, and go out only as ghosts to the other cars", () => {
    const s = rallying(3);
    const out = stream(s, "p0", snapAt(SPAWN, { speed: 12 }))!;
    expect(out.relays).toEqual([{ to: ["p1", "p2"], data: { t: "ghost", teamId: 1, color: "#e69f00", tick: 9, position: SPAWN, heading: 1.2, speed: 12, vehicle: "hatch" } }]);
    expect(out.state.teams[0]!.run!.snap!.position).toEqual(SPAWN);
    // The same plausibility: a teleport off the line is refused.
    expect(stream(s, "p0", snapAt(east(200)))).toBeNull();
    // An impact is nobody else's business: no Driver's dash to shake.
    expect(stream(out.state, "p0", { t: "ev", kind: "impact", strength: 2 })).toBeNull();
  });

  it("gates, finish and timing are the server's, as in Blind Rally", () => {
    let s = rallying(2);
    let now: number;
    ({ state: s, now } = passCheckpoints(s, "p0", 1, GO));
    expect(s.teams[0]!.run!.cp).toBe(1);
    refused(s, "p0", { type: "race.event", kind: "finish" }, "checkpoints-missing", ctx(now));
    ({ state: s, now } = finishRun(s, "p0", now));
    expect(s.teams[0]!.run!.status).toBe("finished");
    expect(game.getPublicState(s).teams[0]!.timeMs).toBe(now - GO);
  });

  it("the player resets their own car, and the recovery goes to their own Godot", () => {
    const s = rallying(2);
    const r = rallyGame.handleAction(s, "p1", { type: "race.reset" }, ctx(GO + 10));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.transition.state.teams[1]!.run!.penaltyMs).toBe(RESET_PENALTY_MS);
    expect(r.transition.events.find((e) => e.event.type === "recover")!.visibility).toEqual({ kind: "private", playerId: "p1" });
    refused(s, "p0", { type: "race.reset" }, "wrong-phase", ctx(GO - 1));
  });

  it("no guess pins: the map shows where you are", () => {
    refused(rallying(2), "p0", { type: "map.guess", x: SPAWN[0], z: SPAWN[2] }, "no-pins", ctx(GO));
  });

  it("dropping out pauses the car once, and a return lets the fresh Godot back onto its anchor", () => {
    const s = rallying(2);
    const away = rallyGame.onPlayerDisconnected!(s, "p0", ctx(GO + 100));
    const run = away.state.teams[0]!.run!;
    expect(run.away.sort()).toEqual(["driver", "navigator"]);
    expect(run.pausedSince).toBe(GO + 100);
    // No "park" to a Navigator who's the one that left.
    expect(away.events.map((e) => e.event.type)).not.toContain("park");
    expect(away.timers).toEqual([{ kind: "set", timerId: "grace:1", delayMs: 30_000 }]);
    const back = rallyGame.onPlayerReconnected!(away.state, "p0", ctx(GO + 5_100)).state.teams[0]!.run!;
    expect(back.away).toEqual([]);
    expect(back.pausedMs).toBe(5_000);
    expect(back.movedAt).toBe(GO + 5_100);
  });
});

describe("Rally results", () => {
  it("rank by time with resets counted, one line per player, no guess line", () => {
    let s = rallying(3);
    let now: number;
    ({ state: s, now } = finishRun(s, "p1", GO));
    s = act(s, "p0", { type: "race.reset" }, ctx(now));
    s = rallyGame.onStream!(s, "p0", snapAt(TRACK.spawn.position), ctx(now + 100))!.state;
    ({ state: s, now } = finishRun(s, "p0", now + 200));
    ({ state: s } = passCheckpoints(s, "p2", 2, GO));
    s = rallyGame.onTimer!(s, "time-up", ctx(s.endsAt!)).state;
    const r = rallyGame.getResult(s)!;
    expect(r.winnerIds).toEqual(["p1"]);
    expect(r.standings.map((x) => x.playerId)).toEqual(["p1", "p0", "p2"]);
    expect(r.standings.map((x) => x.value)).toEqual([1, 2, 3]);
    const [first, second, third] = r.standings.map((x) => x.label);
    expect(first).toMatch(/^1st · Car 2 · .+\n\d:\d\d\.\d \(no resets\)$/);
    expect(second).toMatch(/^2nd · Car 1 · .+\n\d:\d\d\.\d \(1 reset, \+5\u00a0s\)$/);
    expect(third).toMatch(/^3rd · Car 3 · .+\nDNF, 2\/\d checkpoints \(no resets\)$/);
    expect(r.standings.some((x) => /guess/i.test(x.label ?? ""))).toBe(false);
  });

  it("watchers are listed as watching", () => {
    const s = rallyGame.onTimer!(rallying(9), "time-up", ctx(Number.MAX_SAFE_INTEGER)).state;
    const r = rallyGame.getResult(s)!;
    expect(r.standings.filter((x) => x.label === "Watched").map((x) => x.playerId)).toEqual(["p8"]);
  });
});

describe("shared-stage ghost rate", () => {
  it("one ghost per car per GHOST_EVERY_MS, whatever the snapshot rate", () => {
    let s = rallying(2);
    const ghosts = (out: ReturnType<typeof stream>) => out!.relays!.filter((r) => (r.data as { t: string }).t === "ghost").length;
    let out = stream(s, "p0", snapAt(), GO);
    expect(ghosts(out)).toBe(1);
    s = out!.state;
    // A chatty client, 40 a second: most of them still count as snapshots, but don't fan out.
    out = stream(s, "p0", snapAt(east(1)), GO + 25);
    expect(ghosts(out)).toBe(0);
    expect(out!.state.teams[0]!.run!.snap!.position).toEqual(east(1));
    s = out!.state;
    out = stream(s, "p0", snapAt(east(2)), GO + GHOST_EVERY_MS);
    expect(ghosts(out)).toBe(1);
    // Godot's own 10 Hz always gets through.
    let t = GO + GHOST_EVERY_MS;
    s = out!.state;
    for (let i = 1; i <= 5; i++) {
      t += 100;
      out = stream(s, "p0", snapAt(east(2 + i)), t);
      expect(ghosts(out)).toBe(1);
      s = out!.state;
    }
  });

  it("the throttle's clock lives in the stream state, so it never costs a storage write", () => {
    const s = rallying(2);
    const a = stream(s, "p0", snapAt(), GO)!;
    expect(a.persist).toBe(true); // the 1 Hz save, not the ghost
    const b = stream(a.state, "p0", snapAt(east(1)), GO + 100)!;
    expect(b.persist).toBe(false);
    expect(b.state.teams[0]!.run!.ghostAt).toBe(GO + 100);
  });
});

describe("the co-driver's dead reckoning", () => {
  const cps = TRACK.checkpoints;

  it("on the line: the first calls, nothing behind", () => {
    expect(routeProgress(TRACK, 0, SPAWN, 0)).toBe(0);
    const next = upcoming(TRACK, 0);
    expect(next.length).toBe(2);
    expect(next[0]!.note.distance).toBeGreaterThan(0);
  });

  it("never runs past the next gate, never back behind the last", () => {
    // At a gate, by the line: that gate's distance.
    expect(routeProgress(TRACK, 0, cps[0]!.position, 10_000)).toBe(cps[0]!.distance);
    // Through gate 1 but sat on it: no less than gate 1.
    expect(routeProgress(TRACK, 1, cps[0]!.position, 0)).toBe(cps[0]!.distance);
    // Far off in a field with a huge trip meter: still capped at the next gate.
    expect(routeProgress(TRACK, 1, [cps[0]!.position[0] + 5_000, 0, cps[0]!.position[2]], 99_999)).toBeLessThanOrEqual(cps[1]!.distance);
  });

  it("takes the tighter of the trip meter and the crow's line", () => {
    const mid = cps[0]!.position;
    // 50 m driven from the line: no further than 50 m along, however close the gate looks.
    expect(routeProgress(TRACK, 0, mid, 50)).toBe(Math.min(50, cps[0]!.distance));
    // After the last gate, the finish is "next".
    expect(routeProgress(TRACK, cps.length, TRACK.finish.position, 99_999)).toBe(TRACK.finish.distance);
    expect(upcoming(TRACK, TRACK.finish.distance)).toEqual([]);
  });

  it("drives with the server's own helpers: a car driven to gate 2 hears about what's after it", () => {
    let s = rallying(1);
    ({ state: s } = driveTo(s, "p0", cps[1]!.position, GO));
    const at = routeProgress(TRACK, 1, s.teams[0]!.run!.snap!.position, 10_000);
    expect(at).toBe(cps[1]!.distance);
    expect(upcoming(TRACK, at).every((n) => n.note.distance > cps[1]!.distance)).toBe(true);
  });
});

describe("vehicle classes: settings", () => {
  it("has five cars, each with every bar from 1 to 5", () => {
    expect([...VEHICLE_IDS]).toEqual(["hatch", "4x4", "rwd", "truck", "tractor"]);
    expect(DEFAULT_VEHICLE).toBe("hatch");
    for (const id of VEHICLE_IDS) {
      expect(isVehicleId(id)).toBe(true);
      const bars = Object.values(VEHICLES[id].bars);
      expect(bars).toHaveLength(4);
      for (const b of bars) expect(b).toBeGreaterThanOrEqual(1), expect(b).toBeLessThanOrEqual(5);
    }
    expect(isVehicleId("bus")).toBe(false);
  });

  it("vehiclePick defaults to free, takes ballot, and refuses anything else", () => {
    expect(parseRallySettings(undefined)!.vehiclePick).toBe("free");
    expect(parseRallySettings({ vehiclePick: "ballot" })!.vehiclePick).toBe("ballot");
    expect(parseRallySettings({ vehiclePick: "x" })).toBeNull();
  });

  it("the lobby shows a Cars field and a Cars row", () => {
    const f = rallySettingFields(undefined, 3).find((x) => x.key === "vehiclePick")!;
    expect(f.label).toBe("Cars");
    expect(f.options.map((o) => o.label)).toEqual(["Each player chooses", "Everyone votes"]);
    const row = (raw: unknown) => rallyPreview(raw).find((r) => r.label === "Cars")!.value;
    expect(row({ vehiclePick: "ballot" })).toBe("Everyone votes. Everyone drives the winner");
    expect(row({ vehiclePick: "free" })).toBe("Each player chooses");
  });

  it("Blind Rally keeps its cars free whatever arrives", () => {
    expect(parseSettings({ vehiclePick: "ballot" })!.vehiclePick).toBe("free");
    expect(parseSettings(undefined)!.vehiclePick).toBe("free");
  });
});

describe("vehicle classes: rules", () => {
  const pick = (s: BlindRallyState, who: string, vehicleId: "hatch" | "4x4" | "rwd" | "truck" | "tractor") => act(s, who, { type: "vehicle.pick", vehicleId });
  const vote = (s: BlindRallyState, who: string, vehicleId: "hatch" | "4x4" | "rwd" | "truck" | "tractor" | null) => act(s, who, { type: "vehicle.vote", vehicleId });
  const ballot = (players = 3) => newRally(players, { vehiclePick: "ballot" });
  const ready = (s: BlindRallyState) => {
    for (const p of s.players) s = act(s, p.id, { type: "player.ready", ready: true });
    return s;
  };

  it("new cars start as hatchbacks", () => {
    const s = newRally(3);
    expect(s.teams.map((t) => t.vehicle)).toEqual(["hatch", "hatch", "hatch"]);
    expect(s.vehicleId).toBe("hatch");
  });

  it("free: a pick sets that car's class and un-readies its player; the same class again is nothing", () => {
    let s = act(newRally(2), "p0", { type: "player.ready", ready: true });
    s = act(s, "p1", { type: "player.ready", ready: true });
    const same = pick(s, "p0", "hatch");
    expect(same.players.map((p) => p.ready)).toEqual([true, true]);
    s = pick(s, "p0", "truck");
    expect(s.teams.map((t) => t.vehicle)).toEqual(["truck", "hatch"]);
    expect(s.players.map((p) => p.ready)).toEqual([false, true]);
  });

  it("refuses what the mode, the phase or the seat does not allow", () => {
    refused(ballot(), "p0", { type: "vehicle.pick", vehicleId: "truck" }, "cars-voted");
    refused(newRally(2), "p0", { type: "vehicle.vote", vehicleId: "truck" }, "cars-chosen");
    const started = rallying(2);
    refused(started, "p0", { type: "vehicle.pick", vehicleId: "truck" }, "wrong-phase", ctx(GO));
    refused(started, "p0", { type: "vehicle.vote", vehicleId: "truck" }, "wrong-phase", ctx(GO));
    const watcher = newRally(9);
    refused(watcher, "p8", { type: "vehicle.pick", vehicleId: "truck" }, "not-seated");
    refused(newRally(9, { vehiclePick: "ballot" }), "p8", { type: "vehicle.vote", vehicleId: "truck" }, "not-seated");
    refused(newGame(4), "p0", { type: "vehicle.pick", vehicleId: "truck" }, "rally-only");
    refused(newGame(4), "p0", { type: "vehicle.vote", vehicleId: "truck" }, "rally-only");
    expect(parseAction({ type: "vehicle.pick", vehicleId: "bus" })).toBeNull();
    expect(parseAction({ type: "vehicle.vote", vehicleId: "bus" })).toBeNull();
    expect(parseAction({ type: "vehicle.vote", vehicleId: null })).toEqual({ type: "vehicle.vote", vehicleId: null });
  });

  it("ballot: the leader is the class, and moving it un-readies every car's player", () => {
    let s = vote(ballot(), "p0", "rwd");
    s = vote(s, "p1", "rwd");
    s = ready(s);
    s = vote(s, "p2", "4x4"); // 2-1, rwd still ahead
    expect(s.vehicleId).toBe("rwd");
    expect(s.players.every((p) => p.ready)).toBe(true);
    s = vote(vote(s, "p0", "4x4"), "p1", "4x4"); // 1-2: moves
    expect(s.vehicleId).toBe("4x4");
    expect(s.players.some((p) => p.ready)).toBe(false);
  });

  it("ballot: a tie is reported and settled by the seed, the same way twice; no votes changes nothing", () => {
    const tie = () => vote(vote(ballot(2), "p0", "rwd"), "p1", "4x4");
    const a = tie();
    expect(a.vehicleBallot.tied).toEqual(["4x4", "rwd"]);
    expect(["4x4", "rwd"]).toContain(a.vehicleId);
    expect(tie().vehicleId).toBe(a.vehicleId);
    const none = ballot();
    expect(none.vehicleId).toBe("hatch");
    expect(vote(vote(none, "p0", "truck"), "p0", null).vehicleId).toBe("truck"); // taken back, leader stays: no votes
    expect(vote(none, "p0", null).vehicleBallot).toEqual({ votes: [], tied: [] });
  });

  it("a car that goes takes its vote with it", () => {
    let s = vote(vote(ballot(3), "p0", "truck"), "p1", "rwd");
    s = vote(s, "p2", "rwd");
    expect(s.vehicleId).toBe("rwd");
    s = rallyGame.onPlayerRemoved!(s, "p1", ctx()).state;
    s = rallyGame.onPlayerRemoved!(s, "p2", ctx()).state;
    expect(s.vehicleBallot.votes).toEqual([{ teamId: 1, vehicleId: "truck" }]);
    expect(s.vehicleId).toBe("truck");
  });

  it("the host flipping the pick mid-lobby: ballot to free clears the votes, free to ballot shows the leader", () => {
    const { vehicleOf } = vehicles;
    let s = pick(newRally(3), "p1", "truck");
    const flipped = (x: BlindRallyState, vehiclePick: "free" | "ballot") => ({ ...x, settings: { ...x.settings, vehiclePick } });
    // free -> ballot: everyone drives the room's class, not their own pick.
    let b = flipped(s, "ballot");
    expect(b.teams.map((t) => vehicleOf(b, t))).toEqual(["hatch", "hatch", "hatch"]);
    b = vote(b, "p0", "rwd");
    expect(b.teams.map((t) => vehicleOf(b, t))).toEqual(["rwd", "rwd", "rwd"]);
    // ballot -> free: votes void on the next count, and each car has its own pick again.
    let f = flipped(b, "free");
    f = rallyGame.onPlayerRemoved!(f, "p2", ctx()).state;
    expect(f.vehicleBallot).toEqual({ votes: [], tied: [] });
    expect(f.teams.map((t) => vehicleOf(f, t))).toEqual(["hatch", "truck"]);
    expect(vehicleOf(newGame(2), newGame(2).teams[0]!)).toBe("hatch");
  });

  it("a spare taking a freed car gets a hatchback, not the last driver's pick", () => {
    let s = pick(newRally(9), "p1", "truck");
    s = rallyGame.onPlayerRemoved!(s, "p1", ctx()).state;
    expect(seats(s)[1]).toEqual([2, "p8", "p8"]);
    expect(s.teams[1]!.vehicle).toBe("hatch");
  });

  it("a rematch keeps each car's class and the room's", () => {
    const start = (x: BlindRallyState) => act(ready(x), "p0", { type: "race.start" });
    let s = start(pick(newRally(2), "p0", "rwd"));
    s = finishRun(s, "p0", GO).state;
    const carry = rallyGame.carryOver!(s);
    expect(newRally(2, {}, carry).teams.map((t) => t.vehicle)).toEqual(["rwd", "hatch"]);
    let b = start(vote(vote(ballot(2), "p0", "truck"), "p1", "truck"));
    b = finishRun(b, "p0", GO).state;
    expect(newRally(2, { vehiclePick: "ballot" }, rallyGame.carryOver!(b)).vehicleId).toBe("truck");
    // Junk in the carry is the default, not a crash.
    const junk = newRally(2, {}, { teams: [{ driverId: "p0", navigatorId: "p0", vehicle: "bus" }], vehicleId: "bus" });
    expect([junk.vehicleId, junk.teams[0]!.vehicle]).toEqual(["hatch", "hatch"]);
  });
});

describe("vehicle classes: over the wire", () => {
  const pick = (s: BlindRallyState, who: string, vehicleId: "hatch" | "4x4" | "rwd" | "truck" | "tractor") => act(s, who, { type: "vehicle.pick", vehicleId });
  const vote = (s: BlindRallyState, who: string, vehicleId: "hatch" | "4x4" | "rwd" | "truck" | "tractor") => act(s, who, { type: "vehicle.vote", vehicleId });
  const session = (s: BlindRallyState, who: string) => {
    const p = rallyGame.getPrivateState(s, who);
    if (p.role !== "navigator") throw new Error(`${who} is not a navigator`);
    return p.session;
  };
  const started = (s: BlindRallyState) => {
    for (const t of s.teams) if (t.driverId) s = act(s, t.driverId, { type: "player.ready", ready: true });
    return act(s, "p0", { type: "race.start" });
  };

  it("free: a car's pick is its session class and its public class; no ballot", () => {
    const s = pick(newRally(3), "p0", "rwd");
    expect(session(s, "p0").vehicle).toBe("rwd");
    expect(session(s, "p1").vehicle).toBe("hatch");
    const pub = rallyGame.getPublicState(s);
    expect(pub.teams.map((t) => t.vehicle)).toEqual(["rwd", "hatch", "hatch"]);
    expect(pub.vehiclePick).toBe("free");
    expect(pub.vehicleBallot).toBeNull();
  });

  it("ballot: every car's session and public class is the winner, and the votes are public", () => {
    let s = newRally(3, { vehiclePick: "ballot" });
    s = vote(vote(vote(s, "p0", "truck"), "p1", "truck"), "p2", "rwd");
    for (const id of ["p0", "p1", "p2"]) expect(session(s, id).vehicle, id).toBe("truck");
    const pub = rallyGame.getPublicState(s);
    expect(pub.teams.map((t) => t.vehicle)).toEqual(["truck", "truck", "truck"]);
    expect(pub.vehiclePick).toBe("ballot");
    expect(pub.vehicleBallot).toEqual({
      votes: [{ teamId: 1, vehicleId: "truck" }, { teamId: 2, vehicleId: "truck" }, { teamId: 3, vehicleId: "rwd" }],
      tied: [],
    });
  });

  it("Blind Rally reports hatch through the same path, with no ballot", () => {
    const s = racing([["p0", "p1"], ["p2", "p3"]], 4);
    const nav = game.getPrivateState(s, "p1");
    expect(nav.role === "navigator" && nav.session.vehicle).toBe("hatch");
    const pub = game.getPublicState(s);
    expect(pub.teams.every((t) => t.vehicle === "hatch")).toBe(true);
    expect(pub.vehiclePick).toBe("free");
    expect(pub.vehicleBallot).toBeNull();
  });

  it("a ghost carries its sender's class, and only that key more than before", () => {
    const s = started(pick(newRally(3), "p0", "truck"));
    const out = rallyGame.onStream!(s, "p0", snapAt(SPAWN, { speed: 12 }), ctx(GO))!;
    const ghost = out.relays![0]!.data as Record<string, unknown>;
    expect(ghost.vehicle).toBe("truck");
    expect(Object.keys(ghost).sort()).toEqual(["color", "heading", "position", "speed", "t", "teamId", "tick", "vehicle"]);
    const other = rallyGame.onStream!(s, "p1", snapAt(SPAWN, { speed: 12 }), ctx(GO))!;
    expect((other.relays![0]!.data as { vehicle: string }).vehicle).toBe("hatch");
  });

  it("the results name a Rally car's class; Blind Rally's lines are as before", () => {
    let s = started(pick(newRally(2), "p0", "truck"));
    ({ state: s } = finishRun(s, "p0", GO));
    s = rallyGame.onTimer!(s, "time-up", ctx(s.endsAt!)).state;
    const [first, second] = rallyGame.getResult(s)!.standings.map((x) => x.label);
    expect(first!.split("\n")[0]).toBe(`1st · Car 1 · Rally Truck · ${TRACK.name}`);
    expect(second!.split("\n")[0]).toBe(`2nd · Car 2 · Hatchback · ${TRACK.name}`);
    expect(game.getResult(game.onTimer!(racing([["p0", "p1"]], 2), "time-up", ctx(Number.MAX_SAFE_INTEGER)).state)!.standings[0]!.label).toMatch(/^1st · Team 1 · [^·]+\nDNF/);
  });
});

describe("vehicle classes: the grid's cards", () => {
  const pick = (s: BlindRallyState, who: string, vehicleId: "hatch" | "4x4" | "rwd" | "truck" | "tractor") => act(s, who, { type: "vehicle.pick", vehicleId });
  const vote = (s: BlindRallyState, who: string, vehicleId: "hatch" | "4x4" | "rwd" | "truck" | "tractor") => act(s, who, { type: "vehicle.vote", vehicleId });
  const cards = (s: BlindRallyState, me: string) => vehicleCards(rallyGame.getPublicState(s), me);

  it("one card per class, in order, with its name, blurb and bars", () => {
    const c = cards(newRally(2), "p0");
    expect(c.map((x) => x.id)).toEqual([...VEHICLE_IDS]);
    expect(c[2]).toMatchObject({ name: "RWD Classic", blurb: VEHICLES.rwd.blurb, bars: VEHICLES.rwd.bars });
  });

  it("free: only my own car's class is selected, and nobody counts votes", () => {
    const s = pick(pick(newRally(3), "p1", "rwd"), "p0", "truck");
    const c = cards(s, "p1");
    expect(c.filter((x) => x.selected).map((x) => x.id)).toEqual(["rwd"]);
    expect(c.every((x) => x.votes === 0 && !x.tied)).toBe(true);
    // A watcher has no car, so nothing is theirs.
    expect(cards(s, "nobody").some((x) => x.selected)).toBe(false);
  });

  it("ballot: a card counts its votes, and mine is selected", () => {
    const s = vote(vote(newRally(3, { vehiclePick: "ballot" }), "p0", "truck"), "p2", "truck");
    const c = cards(s, "p2");
    const truck = c.find((x) => x.id === "truck")!;
    expect(truck.votes).toBe(2);
    expect(truck.selected).toBe(true);
    expect(c.filter((x) => x.selected)).toHaveLength(1);
    // p1 has not voted: nothing is selected for them, even the leader.
    expect(cards(s, "p1").some((x) => x.selected)).toBe(false);
  });

  it("ballot tie: both leaders are tied, the rest are not", () => {
    const s = vote(vote(newRally(2, { vehiclePick: "ballot" }), "p0", "truck"), "p1", "rwd");
    const c = cards(s, "p0");
    expect(c.filter((x) => x.tied).map((x) => x.id).sort()).toEqual(["rwd", "truck"]);
  });
});
