import { describe, expect, it } from "vitest";
import { GHOST_EVERY_MS } from "../server/race.ts";
import { parseRallySettings, RALLY_DEFAULTS, rallyBriefing, rallyManifest, rallyPreview, rallySettingFields } from "../shared/rally.ts";
import { COUNTDOWN_MS, MAX_TEAMS, RESET_PENALTY_MS, type BlindRallyState } from "../shared/types.ts";
import { routeProgress, upcoming } from "../client/rally/progress.ts";
import { act, ctx, driveTo, east, finishRun, game, newRally, passCheckpoints, rallyGame, rallying, refused, snapAt, SPAWN, TRACK } from "./helpers.ts";

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

  it("past MAX_TEAMS the rest watch, and take the next car that frees up", () => {
    let s = newRally(6);
    expect(s.teams).toHaveLength(MAX_TEAMS);
    expect(s.teams.map((t) => t.driverId)).toEqual(["p0", "p1", "p2", "p3"]);
    s = rallyGame.onPlayerRemoved!(s, "p1", ctx()).state;
    // Car 2 is p4's now, colour and number kept: nobody else's plate moved.
    expect(seats(s)[1]).toEqual([2, "p4", "p4"]);
    expect(s.teams[1]!.color).toBe("sky");
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
    let s = newRally(5);
    expect(s.teams.length).toBe(4);
    for (const id of ["p0", "p1", "p2"]) s = act(s, id, { type: "player.ready", ready: true });
    expect(game.getPublicState(s).startBlocker).toBe("Waiting for 1 player to get ready.");
    s = act(s, "p3", { type: "player.ready", ready: true });
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
    expect(rallySettingFields({}, 3).map((f) => f.key)).toEqual(["trackPick", "timeLimit", "camera", "weather"]);
    expect(rallySettingFields({}, 6).find((f) => f.key === "timeLimit")!.hint).toBe("4 cars race, 2 watch");
  });

  it("are their own lobby entry, one to eight", () => {
    expect(rallyManifest).toMatchObject({ id: "rally", name: "Rally", minPlayers: 1, maxPlayers: 8, lateJoin: true });
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
    expect(out.relays).toEqual([{ to: ["p1", "p2"], data: { t: "ghost", teamId: 1, color: "#e69f00", tick: 9, position: SPAWN, heading: 1.2, speed: 12 } }]);
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
    const s = rallyGame.onTimer!(rallying(5), "time-up", ctx(Number.MAX_SAFE_INTEGER)).state;
    const r = rallyGame.getResult(s)!;
    expect(r.standings.filter((x) => x.label === "Watched").map((x) => x.playerId)).toEqual(["p4"]);
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
