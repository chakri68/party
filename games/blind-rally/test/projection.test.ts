import { describe, expect, it } from "vitest";
import * as shared from "../shared/index.ts";
import { COUNTDOWN_MS, type BlindRallyState } from "../shared/types.ts";
import { act, ctx, game, newGame, racing } from "./helpers.ts";

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
  /checkpoint|^cps?$|waypoint|spawn|recovery|anchor/i,
  /notes?$|pace/i,
  /map|landmark|route|path/i,
  /distance|trip|progress|surface/i,
  // The weather follows the race clock from this seed: mist positions over the road.
  /seed|cloud|weather/i,
];

function leaks(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) {
    // A pair or triple of numbers is a coordinate whatever it's called.
    if (value.length >= 2 && value.length <= 3 && value.every((v) => typeof v === "number")) return [`${path} looks like a coordinate`];
    return value.flatMap((v, i) => leaks(v, `${path}[${i}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [
      ...(DENY.some((re) => re.test(k)) ? [`${path}.${k}`] : []),
      ...leaks(v, `${path}.${k}`),
    ]);
  }
  return [];
}

const GO = COUNTDOWN_MS;
const snap = { t: "snap", tick: 1, position: [1, 2, 3], heading: 0.5, velocity: [1, 0, 1], speed: 12, distance: 99, checkpointHint: 1, surface: "grass" };

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
  s = game.onStream!(s, "p1", snap, ctx(GO))?.state ?? s;
  s = act(s, "p0", { type: "race.reset" }, ctx(GO + 1));
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
    for (const s of [...everyPhase("solo"), ...everyPhase("shared")]) expect(leaks(game.getPublicState(s)), s.phase).toEqual([]);
  });

  it("the room's result is clean", () => {
    const last = everyPhase().at(-1)!;
    expect(leaks(game.getResult(last))).toEqual([]);
  });

  it("Driver and spare DTOs are clean in every phase, solo or shared", () => {
    for (const s of [...everyPhase("solo"), ...everyPhase("shared")]) {
      for (const id of ["p0", "p2", "p4"]) expect(leaks(game.getPrivateState(s, id)), `${s.phase} ${id}`).toEqual([]);
    }
  });

  it("only Drivers and spares get those DTOs: p0 drives, p4 is spare", () => {
    const s = everyPhase()[3]!;
    expect(game.getPrivateState(s, "p0").role).toBe("driver");
    expect(game.getPrivateState(s, "p4").role).toBeNull();
  });

  it("events everyone sees are clean", () => {
    let s = racing([["p0", "p1"]]);
    const r = game.handleAction(s, "p0", { type: "race.reset" }, ctx(GO));
    expect(r.ok).toBe(true);
    if (r.ok) {
      s = r.transition.state;
      expect(leaks(r.transition.events)).toEqual([]);
    }
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

  it("the eagerly bundled shared module carries no track internals", () => {
    expect(leaks(shared.TRACKS)).toEqual([]);
    for (const t of shared.TRACKS) expect(Object.keys(t).sort()).toEqual(["difficulty", "id", "name", "par_seconds"]);
  });
});
