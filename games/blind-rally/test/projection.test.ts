import { describe, expect, it } from "vitest";
import * as shared from "../shared/index.ts";
import { COUNTDOWN_MS, type BlindRallyState } from "../shared/types.ts";
import { act, ctx, driveTo, finishRun, game, newGame, passCheckpoints, racing, snapAt, SPAWN, TRACK } from "./helpers.ts";

// Spec §8.2: the Driver (and anyone looking at public state) never gets road
// geometry, the map, checkpoints, the car's position or the notes. This walks
// every key and value of those DTOs, in every phase, and fails on anything
// that looks like one of them. Add to DENY when the server learns a new word.

const DENY = [
  /^[xyz]$/i,
  /pos(ition)?/i,
  /coord/i,
  /heading|yaw|rotation|velocity/i,
  /geometry|mesh|terrain|bounds|centre?line/i,
  /checkpoint|^cps?$|waypoint|spawn|recovery|anchor|gate|radius|finishLine/i,
  /notes?$|pace|callout/i,
  /map|landmark|route|path/i,
  /distance|trip|progress|surface/i,
  // The weather follows the race clock from this seed: mist positions over the road.
  /seed|cloud|weather/i,
  // The Navigator's guess pins are their own notes (spec §4.4): results get one distance, nobody gets a pin.
  /pins?$|guess|trail/i,
];

/**
 * Keys the deny-list would catch that are meant to be public: the assist
 * switches in the rules preview, which say *whether* there are pace notes,
 * not what they say (booleans only), and the track cards' landmark count,
 * which says how many, not where (a number only).
 */
const ALLOWED: Record<string, "boolean" | "number"> = { tripMeter: "boolean", paceNotes: "boolean", landmarkCount: "number" };

/** The track's own words: a pace note or a landmark showing up anywhere is a leak, whatever the key. */
const TRACK_WORDS = [...TRACK.paceNotes.map((n) => n.text), ...TRACK.landmarks.map((l) => l.label)].filter((w) => !/^(START|FINISH)$/.test(w));

function leaks(value: unknown, path = "$"): string[] {
  if (typeof value === "string") return TRACK_WORDS.filter((w) => value.includes(w)).map((w) => `${path} says "${w}"`);
  if (Array.isArray(value)) {
    // A pair or triple of numbers is a coordinate whatever it's called.
    if (value.length >= 2 && value.length <= 3 && value.every((v) => typeof v === "number")) return [`${path} looks like a coordinate`];
    return value.flatMap((v, i) => leaks(v, `${path}[${i}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [
      ...(DENY.some((re) => re.test(k)) && !(ALLOWED[k] !== undefined && typeof v === ALLOWED[k]) ? [`${path}.${k}`] : []),
      ...leaks(v, `${path}.${k}`),
    ]);
  }
  return [];
}

const GO = COUNTDOWN_MS;
const snap = snapAt();

/** Events a Driver or a spare would get: public ones, and private ones addressed to them. */
const seenBy = (events: { visibility: { kind: string; playerId?: string }; event: unknown }[], ids: string[]) =>
  events.filter((e) => e.visibility.kind === "public" || ids.includes(e.visibility.playerId!)).map((e) => e.event);

/** The track ballot in TEAMS: a vote cast, a Driver and a spare looking on. */
function ballotStates(stageMode: "solo" | "shared"): BlindRallyState[] {
  let b = newGame(5, { stageMode, trackPick: "ballot" });
  b = act(b, "p1", { type: "team.join", teamId: 1, role: "navigator" });
  b = act(b, "p0", { type: "team.join", teamId: 1, role: "driver" });
  b = act(b, "p3", { type: "team.join", teamId: 2, role: "navigator" });
  const voted = act(b, "p1", { type: "track.vote", trackId: TRACK.id });
  return [b, voted];
}

/** One game, walked through every phase, with input, snapshots and a reset along the way. */
function everyPhase(stageMode: "solo" | "shared" = "solo"): BlindRallyState[] {
  const states: BlindRallyState[] = [];
  let s = newGame(5, { stageMode });
  states.push(s);
  s = act(s, "p0", { type: "team.join", teamId: 1, role: "driver" });
  s = act(s, "p1", { type: "team.join", teamId: 1, role: "navigator" });
  s = act(s, "p0", { type: "player.ready", ready: true });
  states.push(s);
  s = racing([["p0", "p1"], ["p2", "p3"]], 5, { stageMode });
  states.push(s);
  s = game.onTimer!(s, "go", ctx(GO)).state;
  s = game.onStream!(s, "p0", { t: "in", seq: 3, steer: 1, throttle: 1, brake: 0 }, ctx(GO))!.state;
  s = game.onStream!(s, "p1", snap, ctx(GO))!.state;
  s = act(s, "p0", { type: "race.reset" }, ctx(GO + 1));
  // Both Navigators pin a guess, and one clears it again.
  s = act(s, "p1", { type: "map.guess", x: SPAWN[0] + 3, z: SPAWN[2] }, ctx(GO + 2));
  s = act(s, "p3", { type: "map.guess", x: SPAWN[0], z: SPAWN[2] + 3 }, ctx(GO + 2));
  s = act(s, "p3", { type: "map.guess", clear: true }, ctx(GO + 900));
  states.push(s);
  // Team 1 through two gates, team 2's Driver drops out and back.
  let now: number;
  ({ state: s, now } = passCheckpoints(s, "p1", 2, GO + 2_000));
  states.push(s);
  s = game.onPlayerDisconnected!(s, "p2", ctx(now)).state;
  states.push(s);
  s = game.onPlayerReconnected!(s, "p2", ctx(now + 5_000)).state;
  // Team 1 home; team 2 still out there.
  ({ state: s, now } = finishRun(s, "p1", now + 5_000));
  states.push(s);
  s = game.onTimer!(s, "time-up", ctx(s.endsAt!)).state;
  states.push(s);
  return states;
}

describe("projection deny-list", () => {
  it("catches what it's meant to (the walker itself works)", () => {
    expect(leaks({ a: { position: 1 } })).toEqual(["$.a.position"]);
    expect(leaks({ a: [[1, 2]] })).toEqual(["$.a[0] looks like a coordinate"]);
    // The Navigator's DTO is supposed to have the sky in it.
    const nav = game.getPrivateState(racing([["p0", "p1"]]), "p1");
    expect(leaks(nav).length).toBeGreaterThan(0);
  });

  it("public state is clean in every phase", () => {
    for (const s of [...everyPhase("solo"), ...everyPhase("shared"), ...ballotStates("solo"), ...ballotStates("shared")]) {
      expect(leaks(game.getPublicState(s)), s.phase).toEqual([]);
    }
  });

  it("the room's result is clean", () => {
    const last = everyPhase().at(-1)!;
    expect(leaks(game.getResult(last))).toEqual([]);
  });

  it("a pin is answered with nothing but the next update: no event for anyone", () => {
    const r = game.handleAction(racing([["p0", "p1"]]), "p1", { type: "map.guess", x: SPAWN[0], z: SPAWN[2] }, ctx(GO));
    expect(r.ok && r.transition.events).toEqual([]);
  });

  it("Driver and spare DTOs are clean in every phase, solo or shared", () => {
    for (const s of [...everyPhase("solo"), ...everyPhase("shared"), ...ballotStates("solo"), ...ballotStates("shared")]) {
      for (const id of ["p0", "p2", "p4"]) expect(leaks(game.getPrivateState(s, id)), `${s.phase} ${id}`).toEqual([]);
    }
    // And the Navigator's does get what it's for, so the walker's not just blind.
    const nav = game.getPrivateState(everyPhase()[4]!, "p1");
    expect(nav.role === "navigator" && nav.run.checkpoints).toBe(2);
    // Pins too: the Navigator's DTO carries them, and the walker sees them.
    expect(nav.role === "navigator" && nav.run.pins.pin).toEqual([SPAWN[0] + 3, SPAWN[2]]);
    expect(leaks(nav).some((l) => l.includes(".pins"))).toBe(true);
  });

  it("only Drivers and spares get those DTOs: p0 drives, p4 is spare", () => {
    const s = everyPhase()[3]!;
    expect(game.getPrivateState(s, "p0").role).toBe("driver");
    expect(game.getPrivateState(s, "p4").role).toBeNull();
  });

  it("events a Driver or spare can see are clean: resets, gates, drop-outs, finishes, the end", () => {
    const viewers = ["p0", "p2", "p4"];
    let s = racing([["p0", "p1"], ["p2", "p3"]], 5);
    const r = game.handleAction(s, "p0", { type: "race.reset" }, ctx(GO));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.transition.state;
    expect(leaks(seenBy(r.transition.events, viewers))).toEqual([]);
    // The recover event names a checkpoint: it's the Navigator's alone.
    expect(r.transition.events.find((e) => e.event.type === "recover")!.visibility).toEqual({ kind: "private", playerId: "p1" });
    const dc = game.onPlayerDisconnected!(s, "p0", ctx(GO + 10));
    expect(leaks(seenBy(dc.events, viewers))).toEqual([]);
    s = game.onPlayerReconnected!(dc.state, "p0", ctx(GO + 20)).state;
    let now: number;
    ({ state: s, now } = passCheckpoints(s, "p1", 1, GO + 2_000));
    const at = driveTo(s, "p1", TRACK.checkpoints[1]!.position, now);
    const cp = game.handleAction(at.state, "p1", { type: "race.event", kind: "cp", checkpointId: 2 }, ctx(at.now));
    expect(cp.ok && leaks(seenBy(cp.transition.events, viewers))).toEqual([]);
    const fin = finishRun(s, "p1", now);
    const out = game.onPlayerDisconnected!(fin.state, "p3", ctx(fin.now));
    const grace = game.onTimer!(out.state, "grace:2", ctx(fin.now + 30_000));
    expect(leaks(seenBy(grace.events, viewers))).toEqual([]);
    expect(grace.events.map((e) => e.event.type)).toEqual(["team-out", "race-over"]);
    expect(leaks(game.onTimer!(s, "time-up", ctx(s.endsAt!)).events)).toEqual([]);
  });

  it("what the server relays to a Driver is clean, on a shared stage too", () => {
    const s = game.onTimer!(racing([["p0", "p1"], ["p2", "p3"]], 4, { stageMode: "shared" }), "go", ctx(GO)).state;
    const drivers = ["p0", "p2"];
    let ghosts = 0;
    for (const [from, data] of [["p1", snap], ["p3", snap], ["p1", { t: "ev", kind: "impact", strength: 1, position: [1, 2, 3] }]] as const) {
      const out = game.onStream!(s, from, data, ctx(GO))!;
      for (const r of out.relays!) {
        if (r.to.some((id) => drivers.includes(id))) expect(leaks(r.data)).toEqual([]);
        else ghosts++; // the Navigators' ghosts, which are meant to have positions
      }
    }
    expect(ghosts).toBe(2);
  });

  it("the track cards are names and numbers: an allow-list, no geometry", () => {
    const tracks = game.getPublicState(newGame(2)).tracks;
    expect(tracks.length).toBeGreaterThan(0);
    for (const t of tracks) expect(Object.keys(t).sort()).toEqual(["difficulty", "id", "landmarkCount", "length", "name", "par_seconds"]);
    expect(leaks(tracks)).toEqual([]);
    // A Navigator gets the course itself, but only once seated, and only the one being raced: no outline per card.
    expect(leaks(game.getPublicState(newGame(2, { trackPick: "ballot" })))).toEqual([]);
  });

  it("the eagerly bundled shared module carries no track internals", () => {
    // No track list at all: the cards come from the server, in the public state.
    expect(shared).not.toHaveProperty("TRACKS");
    // The track-data contract and its loaders stay out of it: they're for server/ and navigator/.
    for (const name of ["parseTrackFile", "trackProblems", "trackFileProblems", "recoveryFor", "trackData"]) expect(shared).not.toHaveProperty(name);
    // No pace note or landmark in it either (its settings constants are fine: they're not the road).
    const text = JSON.stringify(shared);
    for (const w of TRACK_WORDS) expect(text).not.toContain(w);
  });

  it("the rules preview says which assists are on, never what's in them", () => {
    for (const assists of ["beginner", "classic", "nightmare"] as const) expect(leaks(shared.rulesPreview({ assists }))).toEqual([]);
    for (const s of everyPhase()) expect(leaks(game.getPublicState(s))).toEqual([]);
  });
});
