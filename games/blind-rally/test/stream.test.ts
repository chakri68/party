import { describe, expect, it } from "vitest";
import { parseControl } from "../shared/wire.ts";
import { COUNTDOWN_MS, RESET_HOLD_MS, type BlindRallyState } from "../shared/types.ts";
import { act, ctx, east, game, newGame, passCheckpoints, racing, SPAWN, snapAt, TRACK } from "./helpers.ts";

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
  const snap = snapAt();

  it("reach the Driver as speed only: no position, nothing road-shaped", () => {
    const out = stream(two(), "p1", snap)!;
    expect(out.relays).toEqual([{ to: ["p0"], data: { t: "dash", speed: 23.5 } }]);
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
  const snap = snapAt(SPAWN, { speed: 23.4 });
  const three = (stageMode: "solo" | "shared") => racing([["p0", "p1"], ["p2", "p3"], ["p4", "p5"]], 6, { stageMode });

  it("go to the other teams' Navigators, and no Driver", () => {
    const out = stream(three("shared"), "p1", snap)!;
    expect(out.relays).toEqual([
      { to: ["p0"], data: { t: "dash", speed: 23.4 } },
      { to: ["p3", "p5"], data: { t: "ghost", teamId: 1, color: "#e69f00", tick: 9, position: SPAWN, heading: 1.2, speed: 23.4 } },
    ]);
    const drivers = ["p0", "p2", "p4"];
    for (const r of out.relays!) if ((r.data as { t: string }).t === "ghost") expect(r.to.some((id) => drivers.includes(id))).toBe(false);
  });

  it("not on a solo stage", () => {
    const out = stream(three("solo"), "p1", snap)!;
    expect(out.relays!.map((r) => (r.data as { t: string }).t)).toEqual(["dash"]);
  });

  it("not to a car that's out of the race", () => {
    const s = three("shared");
    s.teams[1]!.run!.status = "dnf";
    expect(stream(s, "p1", snap)!.relays![1]!.to).toEqual(["p5"]);
  });

  it("tell the Navigator's Godot to expect them", () => {
    const nav = game.getPrivateState(three("shared"), "p3");
    expect(nav.role === "navigator" && nav.session.ghosts).toBe(true);
  });
});

describe("snapshot plausibility (step 8)", () => {
  const one = () => racing([["p0", "p1"]]);
  const nav = (s: BlindRallyState, data: unknown, now: number) => stream(s, "p1", data, now);
  /** A run whose last accepted snapshot is on the line at GO. */
  const started = () => nav(one(), snapAt(), GO)!.state;

  it("keeps the last accepted snapshot, by server time", () => {
    const s = nav(started(), snapAt(east(20), { speed: 20, distance: 21 }), GO + 1_000)!.state;
    expect(s.teams[0]!.run!.snap).toEqual({ at: GO + 1_000, tick: 9, position: east(20), speed: 20, distance: 21 });
  });

  it("the first one of a run has to be on the line", () => {
    expect(nav(one(), snapAt(east(40)), GO)).toBeNull();
    expect(nav(one(), snapAt(east(10)), GO)).not.toBeNull();
  });

  it("max speed × Δt, Δt measured on the server's clock with slack", () => {
    const s = started();
    // 1 s later: 45 m/s × (1 + 0.5 s) + 5 m = 72.5 m is the most it can have gone.
    expect(nav(s, snapAt(east(70)), GO + 1_000)).not.toBeNull();
    expect(nav(s, snapAt(east(75)), GO + 1_000)).toBeNull();
    // The same 75 m two seconds on is fine: the server's clock decides, not Godot's tick.
    expect(nav(s, snapAt(east(75), { tick: 10 }), GO + 2_000)).not.toBeNull();
    // A long silence doesn't buy a long jump: Δt caps at 3 s.
    expect(nav(s, snapAt(east(170)), GO + 60_000)).toBeNull();
  });

  it("refuses a teleport, and keeps refusing until the car's back where it was", () => {
    let s = started();
    expect(nav(s, snapAt(TRACK.checkpoints[2]!.position), GO + 100)).toBeNull();
    // The refused one changed nothing: the next is still measured from the line.
    s = nav(s, snapAt(east(5)), GO + 200)!.state;
    expect(s.teams[0]!.run!.snap!.position).toEqual(east(5));
  });

  it("refuses an impossible speed, and anything off the map", () => {
    const s = started();
    expect(nav(s, snapAt(east(1), { speed: 46 }), GO + 100)).toBeNull();
    expect(nav(s, snapAt(east(1), { speed: -46 }), GO + 100)).toBeNull();
    expect(nav(s, snapAt(east(1), { speed: 44 }), GO + 100)).not.toBeNull();
    expect(nav(s, snapAt([TRACK.bounds.x - 60, 0, SPAWN[2]]), GO + 3_000)).toBeNull();
    // Malformed: no position, no heading, not numbers.
    expect(nav(s, { t: "snap", speed: 3 }, GO + 100)).toBeNull();
    expect(nav(s, snapAt(SPAWN, { heading: "north" }), GO + 100)).toBeNull();
  });

  it("a jump to the recovery anchor only right after a server-authorised reset", () => {
    let s = started();
    ({ state: s } = passCheckpoints(s, "p1", 2, GO));
    const now = GO + 120_000;
    const anchor = TRACK.recovery[2]!.position;
    // Wander off, 180 m from the anchor: further than even a 3 s gap allows.
    for (const at of [now - 2_000, now - 1_000, now]) s = nav(s, snapAt(east(60, s.teams[0]!.run!.snap!.position)), at)!.state;
    expect(nav(s, snapAt(anchor), now + 100)).toBeNull(); // no reset, no jump
    s = act(s, "p0", { type: "race.reset" }, ctx(now + 200));
    const back = nav(s, snapAt(anchor), now + 300)!;
    expect(back.state.teams[0]!.run!.snap!.position).toEqual(anchor);
    // One jump per reset: the window closes once it's used.
    expect(back.state.teams[0]!.run!.movedAt).toBeNull();
    // Only to the anchor of the checkpoints the server counted, never further on.
    expect(nav(s, snapAt(TRACK.recovery[4]!.position), now + 300)).toBeNull();
    // And not long after: the window shuts after 10 s.
    expect(nav(s, snapAt(anchor), now + 200 + 10_001)).toBeNull();
  });

  it("goes to storage at most once a second", () => {
    let s = one();
    const writes: boolean[] = [];
    for (let i = 0; i < 25; i++) {
      const out = nav(s, snapAt(east(i)), GO + i * 100)!;
      writes.push(out.persist !== false);
      s = out.state;
    }
    // 2.5 s of snapshots at 10 Hz: written at 0, 1 and 2 s.
    expect(writes.flatMap((w, i) => (w ? [i] : []))).toEqual([0, 10, 20]);
  });

  it("the Driver still only ever hears the speed", () => {
    const out = nav(started(), snapAt(east(10), { speed: 12.34 }), GO + 500)!;
    expect(out.relays).toEqual([{ to: ["p0"], data: { t: "dash", speed: 12.3 } }]);
  });

  it("Driver input is dropped while the car's held after a reset", () => {
    const s = act(started(), "p0", { type: "race.reset" }, ctx(GO + 1_000));
    expect(stream(s, "p0", input(1), GO + 1_000 + RESET_HOLD_MS - 1)).toBeNull();
    expect(stream(s, "p0", input(1), GO + 1_000 + RESET_HOLD_MS)).not.toBeNull();
  });
});
