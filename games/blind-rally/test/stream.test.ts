import { describe, expect, it } from "vitest";
import { parseControl } from "../shared/wire.ts";
import { COUNTDOWN_MS, type BlindRallyState } from "../shared/types.ts";
import { act, ctx, game, newGame, racing } from "./helpers.ts";

// Two cars: p0 drives for p1, p2 drives for p3. The race opens at COUNTDOWN_MS.
const GO = COUNTDOWN_MS;
const two = () => racing([["p0", "p1"], ["p2", "p3"]]);
const input = (seq: number, extra: object = {}) => ({ t: "in", seq, steer: 0.5, throttle: 1, brake: 0, ...extra });
const stream = (s: BlindRallyState, from: string, data: unknown, now = GO) => game.onStream!(s, from, data, ctx(now));

describe("driver input relay", () => {
  it("goes to that team's Navigator only, unpersisted", () => {
    const out = stream(two(), "p0", input(1))!;
    expect(out.relays).toEqual([{ to: ["p1"], data: { t: "in", seq: 1, steer: 0.5, throttle: 1, brake: 0 } }]);
    expect(out.relay).toBeUndefined();
    expect(out.persist).toBe(false);
    const other = stream(two(), "p2", input(1))!;
    expect(other.relays![0]!.to).toEqual(["p3"]);
  });

  it("only from a Driver", () => {
    expect(stream(two(), "p1", input(1))).toBeNull(); // a Navigator
    expect(stream(two(), "p9", input(1))).toBeNull(); // nobody
  });

  it("not before startsAt, even if the phase already says racing; not after endsAt", () => {
    const s = two();
    expect(stream(s, "p0", input(1), GO - 1)).toBeNull();
    const flipped = game.onTimer!(s, "go", ctx(GO - 5)).state; // an early alarm can't open the stage
    expect(stream(flipped, "p0", input(1), GO - 1)).toBeNull();
    // A late alarm doesn't hold it shut: still "countdown", but the clock says go.
    expect(s.phase).toBe("countdown");
    expect(stream(s, "p0", input(1), GO)).not.toBeNull();
    expect(stream(s, "p0", input(1), s.endsAt!)).toBeNull();
  });

  it("not in TEAMS, not once finished", () => {
    expect(stream(newGame(2), "p0", input(1))).toBeNull();
    const done = act(racing([["p0", "p1"]]), "p0", { type: "race.end" }, ctx(GO + 10));
    expect(stream(done, "p0", input(1), GO + 20)).toBeNull();
  });

  it("drops stale and repeated seqs, counted per team", () => {
    let s = two();
    s = stream(s, "p0", input(5))!.state;
    expect(stream(s, "p0", input(5))).toBeNull();
    expect(stream(s, "p0", input(4))).toBeNull();
    expect(stream(s, "p0", input(6))).not.toBeNull();
    // The other car's counter is its own.
    expect(stream(s, "p2", input(1))).not.toBeNull();
    // And a reloaded Driver page learns where to carry on from.
    expect(game.getPrivateState(s, "p0")).toEqual({ role: "driver", teamId: 1, lastSeq: 5 });
  });

  it("doesn't touch the state it was given", () => {
    const s = two();
    const before = structuredClone(s);
    stream(s, "p0", input(3));
    expect(s).toEqual(before);
  });

  it("clamps values and refuses malformed packets", () => {
    expect(parseControl(input(1, { steer: -7, throttle: 1.5, brake: -1 }))).toEqual({ t: "in", seq: 1, steer: -1, throttle: 1, brake: 0 });
    expect(parseControl(input(1, { steer: 0.123456 }))!.steer).toBe(0.12);
    expect(parseControl(input(0))).toBeNull();
    expect(parseControl(input(1.5))).toBeNull();
    expect(parseControl(input(1, { steer: "left" }))).toBeNull();
    expect(parseControl(input(1, { throttle: Number.NaN }))).toBeNull();
    expect(parseControl({ ...input(1), t: "snap" })).toBeNull();
    // Only the known fields go on to the Navigator.
    const out = stream(two(), "p0", input(1, { position: [1, 2, 3], evil: true }))!;
    expect(Object.keys(out.relays![0]!.data as object).sort()).toEqual(["brake", "seq", "steer", "t", "throttle"]);
  });
});

describe("navigator snapshots and impacts", () => {
  const snap = { t: "snap", tick: 9, position: [12.5, 0.3, -88.1], heading: 1.2, velocity: [3, 0, 4], speed: 23.456, distance: 410, checkpointHint: 2, surface: "gravel" };

  it("reach the Driver as speed only: no position, nothing road-shaped", () => {
    const out = stream(two(), "p1", snap)!;
    expect(out.relays).toEqual([{ to: ["p0"], data: { t: "dash", speed: 23.5 } }]);
    expect(out.persist).toBe(false);
    const hit = stream(two(), "p1", { t: "ev", kind: "impact", strength: 2.37 })!;
    expect(hit.relays).toEqual([{ to: ["p0"], data: { t: "hit", strength: 2.4 } }]);
  });

  it("only from that team's Navigator, only mid-race", () => {
    expect(stream(two(), "p0", snap)).toBeNull(); // the Driver can't fake a dashboard
    expect(stream(two(), "p1", snap, GO - 1)).toBeNull();
    expect(stream(two(), "p3", snap)!.relays![0]!.to).toEqual(["p2"]);
    expect(stream(two(), "p1", { t: "ev", kind: "cp", checkpointId: 1 })).toBeNull(); // a game-action from step 10
  });
});

describe("shared stage ghosts", () => {
  const snap = { t: "snap", tick: 9, position: [12.5, 0.3, -88.1], heading: 1.2, velocity: [3, 0, 4], speed: 23.4, distance: 410, checkpointHint: 2, surface: "gravel" };
  const three = (stageMode: "solo" | "shared") => racing([["p0", "p1"], ["p2", "p3"], ["p4", "p5"]], 6, { stageMode });

  it("go to the other teams' Navigators, and no Driver", () => {
    const out = stream(three("shared"), "p1", snap)!;
    expect(out.persist).toBe(false);
    expect(out.relays).toEqual([
      { to: ["p0"], data: { t: "dash", speed: 23.4 } },
      { to: ["p3", "p5"], data: { t: "ghost", teamId: 1, color: "#e69f00", tick: 9, position: [12.5, 0.3, -88.1], heading: 1.2, speed: 23.4 } },
    ]);
    const drivers = ["p0", "p2", "p4"];
    for (const r of out.relays!) if ((r.data as { t: string }).t === "ghost") expect(r.to.some((id) => drivers.includes(id))).toBe(false);
  });

  it("not on a solo stage", () => {
    const out = stream(three("solo"), "p1", snap)!;
    expect(out.relays!.map((r) => (r.data as { t: string }).t)).toEqual(["dash"]);
  });

  it("not to a car that's out of the race, and not from a snapshot without a position", () => {
    const s = three("shared");
    s.teams[1]!.run!.status = "dnf";
    expect(stream(s, "p1", snap)!.relays![1]!.to).toEqual(["p5"]);
    expect(stream(s, "p1", { t: "snap", speed: 3 })!.relays!.map((r) => (r.data as { t: string }).t)).toEqual(["dash"]);
  });

  it("tell the Navigator's Godot to expect them", () => {
    const nav = game.getPrivateState(three("shared"), "p3");
    expect(nav.role === "navigator" && nav.session.ghosts).toBe(true);
  });
});
