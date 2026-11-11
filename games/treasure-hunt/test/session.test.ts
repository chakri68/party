import { describe, expect, it } from "vitest";
import { godotPin, godotPos, godotSeat, godotUnseat, roundKey, shouldSendSession, worldReadyFor, type BridgeCall, type Roster, type Vehicles } from "../client/godot/bridge.ts";
import { ActLog, ClaimLog, GodotFeed, parseHotCold, claimError, pinsFor, resync, rosterFor } from "../client/view.ts";
import type { THPrivate, THPublic } from "../shared/types.ts";

// Review Focus 3: the session can reach Godot twice. The bridge sends it once
// per round (seed and round), and again only when Godot itself came back up
// (an iframe reload: a fresh engine with no world).
describe("shouldSendSession", () => {
  const k = roundKey(12345, 1);
  it("sends the first session", () => {
    expect(shouldSendSession(null, false, k)).toBe(true);
  });

  it("does not send the same round twice", () => {
    expect(shouldSendSession(k, false, roundKey(12345, 1))).toBe(false);
  });

  it("sends a new seed", () => {
    expect(shouldSendSession(k, false, roundKey(777, 1))).toBe(true);
  });

  it("sends the same seed in a new round (Same map again)", () => {
    expect(shouldSendSession(k, false, roundKey(12345, 2))).toBe(true);
  });

  it("sends the same round again after Godot reloads", () => {
    expect(shouldSendSession(k, true, k)).toBe(true);
  });
});

// A world-ready says which seed and round Godot built. One left over from an
// older layout or round (the host started a new round mid-build) must not count.
describe("worldReadyFor", () => {
  it("counts a world-ready for this round", () => {
    expect(worldReadyFor({ kind: "world-ready", ms: 40, chunks: 9, seed: 12345, round: 2 }, 12345, 2)).toBe(true);
  });

  it("ignores a world-ready for another seed", () => {
    expect(worldReadyFor({ kind: "world-ready", ms: 40, chunks: 9, seed: 777, round: 2 }, 12345, 2)).toBe(false);
  });

  it("ignores the same seed's world-ready from the last round", () => {
    expect(worldReadyFor({ kind: "world-ready", ms: 40, chunks: 9, seed: 12345, round: 1 }, 12345, 2)).toBe(false);
  });

  it("reads a world-ready with no round as round 0", () => {
    expect(worldReadyFor({ kind: "world-ready", ms: 40, chunks: 9, seed: 12345 }, 12345, 0)).toBe(true);
  });
});

// Review Focus 4: a reveal can be lost (it reached the old world just before
// a rebuild, or a reloaded iframe). So every update sends the lot again:
// every reveal, every found id and the phase. Godot treats each as idempotent.
describe("resync", () => {
  const priv: THPrivate = {
    teamId: 1,
    pins: [],
    hotcold: { used: false, unlockAt: null, active: null },
    clues: [
      { id: "c1", clues: ["a"], difficulty: 1, found: true, taken: false, photo: null },
      { id: "c2", clues: ["b"], difficulty: 2, found: false, taken: false, photo: null },
      { id: "c3", clues: ["c"], difficulty: 3, found: false, taken: false, photo: null },
    ],
    revealed: [
      { id: "c1", x: 10.5, z: -3, dy: 0 },
      { id: "c2", x: -40, z: 200.1, dy: 0.6 },
    ],
  };

  it("sends every reveal, every found id and the phase", () => {
    expect(resync(priv, "hunting")).toEqual([
      { fn: "revealCache", arg: { id: "c1", x: 10.5, z: -3, dy: 0 } },
      { fn: "revealCache", arg: { id: "c2", x: -40, z: 200.1, dy: 0.6 } },
      { fn: "cacheFound", arg: { id: "c1", mine: true } },
      { fn: "setPhase", arg: { phase: "hunting" } },
    ]);
  });

  it("marks a cache another team took as found too, so its crate goes", () => {
    const took: THPrivate = { ...priv, clues: [...priv.clues, { id: "c4", clues: ["d"], difficulty: 1, found: false, taken: true, photo: null }] };
    expect(resync(took, "hunting").filter((c) => c.fn === "cacheFound")).toEqual([
      { fn: "cacheFound", arg: { id: "c1", mine: true } },
      { fn: "cacheFound", arg: { id: "c4", mine: false } },
    ]);
  });

  it("still sends the phase with no private state", () => {
    expect(resync(null, "countdown")).toEqual([{ fn: "setPhase", arg: { phase: "countdown" } }]);
  });

  it("adds reveals that came over the stream, once per id", () => {
    const streamed = [
      { id: "c2", x: -40, z: 200.1, dy: 0.6 },
      { id: "c3", x: 5, z: 6, dy: 0 },
    ];
    expect(resync(priv, "hunting", streamed).filter((c) => c.fn === "revealCache")).toEqual([
      { fn: "revealCache", arg: { id: "c1", x: 10.5, z: -3, dy: 0 } },
      { fn: "revealCache", arg: { id: "c2", x: -40, z: 200.1, dy: 0.6 } },
      { fn: "revealCache", arg: { id: "c3", x: 5, z: 6, dy: 0 } },
    ]);
  });
});

// The view's wiring, through GodotFeed: what reaches the bridge when Godot
// says ready, the state updates, and the server relays a reveal.
describe("GodotFeed", () => {
  const priv = (revealed: THPrivate["revealed"] = []): THPrivate => ({
    teamId: 1,
    pins: [],
    hotcold: { used: false, unlockAt: null, active: null },
    clues: [{ id: "c1", clues: ["a"], difficulty: 1, found: false, taken: false, photo: null }, { id: "c4", clues: ["b"], difficulty: 2, found: false, taken: false, photo: null }],
    revealed,
  });
  const setup = () => {
    const sent: BridgeCall[][] = [];
    const feed = new GodotFeed((calls) => sent.push(calls));
    return { feed, sent, last: () => sent[sent.length - 1]! };
  };
  const reveals = (calls: BridgeCall[]) => calls.filter((c) => c.fn === "revealCache").map((c) => c.arg);

  it("sends nothing before the first state, then the phase on ready", () => {
    const { feed, sent, last } = setup();
    feed.sync();
    expect(sent).toEqual([]);
    feed.update(priv(), "countdown", 1);
    feed.sync();
    expect(last()).toEqual([{ fn: "setPhase", arg: { phase: "countdown" } }]);
  });

  it("relays a stream reveal at once", () => {
    const { feed, last } = setup();
    feed.update(priv(), "hunting", 1);
    feed.stream("p2", { t: "reveal", id: "c4", x: 12, z: -30, dy: 0.5 });
    expect(last()).toEqual([{ fn: "revealCache", arg: { id: "c4", x: 12, z: -30, dy: 0.5 } }]);
  });

  it("ignores stream data that is not a reveal", () => {
    const { feed, sent } = setup();
    feed.update(priv(), "hunting", 1);
    feed.stream("p2", { t: "pos", x: 1, y: 2, z: 3, foot: true });
    feed.stream("p2", { t: "reveal", id: 4, x: 1, z: 2 });
    expect(sent).toEqual([]);
  });

  // I1: the server relays a reveal once, and a relay brings no state update.
  // Godot reloading after it must still get the crate back.
  it("re-sends a stream reveal when Godot comes up again with no update in between", () => {
    const { feed, last } = setup();
    feed.update(priv(), "hunting", 1);
    feed.sync();
    feed.stream("p2", { t: "reveal", id: "c4", x: 12, z: -30, dy: 0.5 });
    feed.sync(); // ready() from a reloaded iframe
    expect(reveals(last())).toEqual([{ id: "c4", x: 12, z: -30, dy: 0.5 }]);
    expect(last()[last().length - 1]).toEqual({ fn: "setPhase", arg: { phase: "hunting" } });
  });

  it("sends a reveal once when it is in both the stream and the state", () => {
    const { feed, last } = setup();
    feed.update(priv(), "hunting", 1);
    feed.stream("p2", { t: "reveal", id: "c4", x: 12, z: -30, dy: 0.5 });
    feed.update(priv([{ id: "c4", x: 12, z: -30, dy: 0.5 }]), "hunting", 1);
    feed.sync();
    expect(reveals(last())).toEqual([{ id: "c4", x: 12, z: -30, dy: 0.5 }]);
  });

  it("forgets stream reveals on a new map", () => {
    const { feed, last } = setup();
    feed.update(priv(), "hunting", 1);
    feed.stream("p2", { t: "reveal", id: "c4", x: 12, z: -30, dy: 0.5 });
    feed.update(priv(), "teams", 2);
    feed.sync();
    expect(reveals(last())).toEqual([]);
  });

  it("forgets stream reveals on a new round of the same map", () => {
    const { feed, last } = setup();
    feed.update(priv(), "hunting", roundKey(5, 1));
    feed.stream("p2", { t: "reveal", id: "c4", x: 12, z: -30, dy: 0.5 });
    feed.update(priv(), "hunting", roundKey(5, 1));
    feed.sync();
    expect(reveals(last())).toHaveLength(1);
    feed.update(priv(), "teams", roundKey(5, 2));
    feed.sync();
    expect(reveals(last())).toEqual([]);
  });
});

// Bridge v3: the others. The roster goes on every sync, first; a pos relay
// from someone in it goes straight on as remotePos, tagged with who sent it.
describe("GodotFeed, the other players", () => {
  const priv: THPrivate = { teamId: 1, pins: [], clues: [], revealed: [], hotcold: { used: false, unlockAt: null, active: null } };
  const roster: Roster = {
    me: "p1",
    players: [
      { id: "p1", name: "Asha", color: "#e69f00", team: 1, character: "male-a" },
      { id: "p2", name: "Ravi", color: "#56b4e9", team: 2, character: "female-c" },
    ],
  };
  const setup = () => {
    const sent: BridgeCall[][] = [];
    const feed = new GodotFeed((calls) => sent.push(calls));
    feed.update(priv, "hunting", 1, roster);
    return { feed, sent };
  };
  const pos = { t: "pos", x: 1.5, y: 2, z: -3, yaw: 0.25, foot: true, v: null };

  it("pos relay from another player becomes a remotePos call", () => {
    const { feed, sent } = setup();
    feed.stream("p2", pos);
    expect(sent).toEqual([[{ fn: "remotePos", arg: { id: "p2", x: 1.5, y: 2, z: -3, yaw: 0.25, foot: true, v: null } }]]);
  });

  it("keeps the buggy id of a driver", () => {
    const { feed, sent } = setup();
    feed.stream("p2", { ...pos, foot: false, v: "b1" });
    expect(sent[0]![0]).toEqual({ fn: "remotePos", arg: { id: "p2", x: 1.5, y: 2, z: -3, yaw: 0.25, foot: false, v: "b1" } });
  });

  it("drops a pos from me, from someone not in the roster, or that is malformed", () => {
    const { feed, sent } = setup();
    feed.stream("p1", pos);
    feed.stream("p9", pos);
    feed.stream("p2", { ...pos, x: "1" });
    feed.stream("p2", { ...pos, foot: "yes" });
    expect(sent).toEqual([]);
  });

  it("sends the roster first on every sync", () => {
    const { feed, sent } = setup();
    feed.sync();
    feed.sync();
    expect(sent.map((calls) => calls[0])).toEqual([
      { fn: "roster", arg: roster },
      { fn: "roster", arg: roster },
    ]);
    expect(sent[0]![sent[0]!.length - 1]).toEqual({ fn: "setPhase", arg: { phase: "hunting" } });
  });

  // Review Focus 3: a reloaded iframe is a fresh Godot. Its ready() has to
  // bring back everything a running one had: who's who, the buggies, and the
  // reveals the stream brought.
  it("GodotFeed: a second ready() re-sends roster, vehicles and reveals", () => {
    const { feed, sent } = setup();
    const vehicles: Vehicles = { me: "p1", list: [{ id: "t0", x: 1, y: null, z: 2, yaw: 0, driver: "p2", passenger: null }] };
    feed.update(priv, "hunting", 1, roster, vehicles);
    feed.sync(); // the first ready()
    feed.stream("p2", { t: "reveal", id: "c4", x: 12, z: -30, dy: 0.5 });
    sent.length = 0;
    feed.sync(); // ready() again, with no update in between
    const calls = sent[0]!;
    expect(calls.slice(0, 2)).toEqual([
      { fn: "roster", arg: roster },
      { fn: "vehicles", arg: vehicles },
    ]);
    expect(calls).toContainEqual({ fn: "revealCache", arg: { id: "c4", x: 12, z: -30, dy: 0.5 } });
    expect(calls[calls.length - 1]).toEqual({ fn: "setPhase", arg: { phase: "hunting" } });
  });

  // M2: the list only moves on a commit, so a reload mid-drive would put the
  // buggy back where the last action left it. Godot's own last pos is newer.
  it("my driven buggy goes out at my last pos, not the list's", () => {
    const { feed, sent } = setup();
    const list = [
      { id: "t0", x: 1, y: null, z: 2, yaw: 0, driver: "p1", passenger: null },
      { id: "t1", x: 5, y: 3, z: 6, yaw: 1, driver: "p2", passenger: null },
    ];
    feed.update(priv, "hunting", 1, roster, { me: "p1", list });
    feed.sync();
    // No pos from Godot yet: as listed.
    expect(sent[0]![1]).toEqual({ fn: "vehicles", arg: { me: "p1", list } });
    feed.mine({ x: 300, y: 12, z: -40, yaw: 2.5, foot: false, v: "t0" });
    feed.sync();
    expect(sent[1]![1]).toEqual({ fn: "vehicles", arg: { me: "p1", list: [{ ...list[0]!, x: 300, y: 12, z: -40, yaw: 2.5 }, list[1]] } });
    // The stored list is untouched.
    expect(list[0]!.x).toBe(1);
  });
});

describe("rosterFor", () => {
  const game = {
    teams: [
      { id: 1, color: "orange", foundCount: 0, poolSize: 3 },
      { id: 2, color: "sky", foundCount: 0, poolSize: 3 },
    ],
    players: [
      { id: "p1", ready: true, spectator: false, removed: false, teamId: 1, character: "male-a" },
      { id: "p2", ready: true, spectator: false, removed: false, teamId: 2, character: "female-c" },
      { id: "p3", ready: false, spectator: true, removed: false, teamId: 2 },
      { id: "p4", ready: true, spectator: false, removed: true, teamId: 1 },
      { id: "p5", ready: true, spectator: false, removed: false, teamId: null },
    ],
  } as unknown as THPublic;
  const seats = [
    { id: "p1", name: "Asha" },
    { id: "p2", name: "Ravi" },
  ];

  it("lists every hunter, me included, with a seat name, the team colour and the character", () => {
    expect(rosterFor(game, seats, "p1")).toEqual({
      me: "p1",
      players: [
        { id: "p1", name: "Asha", color: "#e69f00", team: 1, character: "male-a" },
        { id: "p2", name: "Ravi", color: "#56b4e9", team: 2, character: "female-c" },
      ],
    });
  });
});

describe("godotPos", () => {
  it("takes x, y, z, yaw, foot and v", () => {
    expect(godotPos({ x: 1, y: 2, z: 3, yaw: -1.5, foot: false, v: null })).toEqual({ x: 1, y: 2, z: 3, yaw: -1.5, foot: false, v: null });
    expect(godotPos({ x: 1, y: 2, z: 3, yaw: 0, foot: false, v: "b1" })).toEqual({ x: 1, y: 2, z: 3, yaw: 0, foot: false, v: "b1" });
  });

  it("drops a pos with a bad yaw or v", () => {
    expect(godotPos({ x: 1, y: 2, z: 3, yaw: Number.NaN, foot: true, v: null })).toBeNull();
    expect(godotPos({ x: 1, y: 2, z: 3, yaw: 0, foot: true, v: 7 })).toBeNull();
    expect(godotPos(null)).toBeNull();
  });
});

// Bridge v3, the buggies: what Godot asks for is checked before it becomes an act.
describe("godotSeat and godotUnseat", () => {
  it("takes a vehicle id and a seat", () => {
    expect(godotSeat({ vehicleId: "t0", seat: "driver" })).toEqual({ vehicleId: "t0", seat: "driver" });
    expect(godotSeat({ vehicleId: "l2", seat: "passenger", extra: 1 })).toEqual({ vehicleId: "l2", seat: "passenger" });
  });

  it("drops a bad seat ask", () => {
    expect(godotSeat({ vehicleId: "t0", seat: "roof" })).toBeNull();
    expect(godotSeat({ vehicleId: "", seat: "driver" })).toBeNull();
    expect(godotSeat({ vehicleId: "123456789", seat: "driver" })).toBeNull();
    expect(godotSeat({ vehicleId: 3, seat: "driver" })).toBeNull();
    expect(godotSeat(null)).toBeNull();
  });

  it("takes a finite pose, and drops anything else", () => {
    expect(godotUnseat({ x: 1, y: 2, z: -3, yaw: 0.5 })).toEqual({ x: 1, y: 2, z: -3, yaw: 0.5 });
    expect(godotUnseat({ x: 1, y: 2, z: -3 })).toBeNull();
    expect(godotUnseat({ x: 1, y: Number.POSITIVE_INFINITY, z: -3, yaw: 0 })).toBeNull();
    expect(godotUnseat("x")).toBeNull();
  });
});

describe("ActLog", () => {
  it("knows its own acts, once each", () => {
    const log = new ActLog();
    log.add("a1");
    expect(log.rejected("a1")).toBe(true);
    expect(log.rejected("a1")).toBe(false);
    expect(log.rejected("nope")).toBe(false);
  });

  it("keeps only the latest few, since an accepted act never hears back", () => {
    const log = new ActLog(3);
    for (const id of ["a1", "a2", "a3", "a4"]) log.add(id);
    expect(log.rejected("a1")).toBe(false);
    expect(log.rejected("a4")).toBe(true);
  });
});

describe("claimError", () => {
  it("has one plain line per claim code", () => {
    expect(claimError("in-vehicle", "x")).toBe("Get out of the buggy first.");
    expect(claimError("too-far", "x")).toBe("Go closer to the cache.");
    expect(claimError("no-position", "x")).toBe("Wait a moment and try again.");
    expect(claimError("moved-too-fast", "x")).toBe("Wait a moment and try again.");
    expect(claimError("already-found", "x")).toBe("Your team already found this cache.");
    expect(claimError("not-yours", "x")).toBe("This cache is not on your team's list.");
    expect(claimError("taken", "x")).toBe("Another team found this cache first.");
    expect(claimError("not-hunting", "x")).toBe("The hunt has not started.");
  });

  it("falls back to the server's message for anything else", () => {
    expect(claimError("rate-limited", "Slow down.")).toBe("Slow down.");
    expect(claimError(undefined, "Slow down.")).toBe("Slow down.");
  });
});

// N4: a claim's action id is kept only while it is out. The server sends no
// ack for an accepted act, so "resolved without a rejection" means the
// cache now shows as found in private state.
describe("ClaimLog", () => {
  const priv = (found: string[]): THPrivate => ({
    teamId: 1,
    pins: [],
    hotcold: { used: false, unlockAt: null, active: null },
    clues: ["c1", "c4"].map((id) => ({ id, clues: ["a"], difficulty: 1, found: found.includes(id), taken: false, photo: null })),
    revealed: [],
  });

  it("keeps a claim until its rejection, which it reports once", () => {
    const log = new ClaimLog();
    log.add("a1", "c1");
    expect(log.size).toBe(1);
    expect(log.rejected("a1")).toBe(true);
    expect(log.rejected("a1")).toBe(false);
    expect(log.rejected("other")).toBe(false);
    expect(log.size).toBe(0);
  });

  it("drops a claim once its cache shows as found", () => {
    const log = new ClaimLog();
    log.add("a1", "c1");
    log.add("a2", "c4");
    log.update(priv([]), 1);
    expect(log.size).toBe(2);
    log.update(priv(["c1"]), 1);
    expect(log.size).toBe(1);
    expect(log.rejected("a1")).toBe(false);
    expect(log.rejected("a2")).toBe(true);
  });

  it("drops only the first of two claims on one cache: the second's rejection still counts", () => {
    const log = new ClaimLog();
    log.add("a1", "c1");
    log.add("a2", "c1");
    log.update(priv(["c1"]), 1);
    log.update(priv(["c1"]), 1);
    expect(log.size).toBe(1);
    expect(log.rejected("a2")).toBe(true);
  });

  it("starts over on a new map", () => {
    const log = new ClaimLog();
    log.update(priv(["c1"]), 1);
    log.add("a1", "c4");
    log.update(priv([]), 2);
    expect(log.size).toBe(0);
    // c1 is not found on map 2: a claim on it stays out.
    log.add("a2", "c1");
    log.update(priv([]), 2);
    expect(log.size).toBe(1);
  });

  it("starts over on a new round of the same map: round 1's finds are not round 2's", () => {
    const log = new ClaimLog();
    log.update(priv(["c1"]), roundKey(5, 1));
    log.update(priv([]), roundKey(5, 2));
    log.add("a1", "c1");
    log.update(priv(["c1"]), roundKey(5, 2));
    expect(log.size).toBe(0);
    expect(log.rejected("a1")).toBe(false);
  });
});

describe("pins", () => {
  const pin = { id: "n1", by: "p1", x: 10.5, z: -3 };
  const other = { id: "n2", by: "p2", x: 1, z: 2 };

  it("emitPin becomes a pin action", () => {
    expect(godotPin({ x: 12.3, z: -4.5 })).toEqual({ x: 12.3, z: -4.5 });
    expect(godotPin({ x: 1, z: 2, extra: 1 })).toEqual({ x: 1, z: 2 });
  });

  it("emitPin takes finite numbers only", () => {
    expect(godotPin({ x: "1", z: 2 })).toBeNull();
    expect(godotPin({ x: 1 })).toBeNull();
    expect(godotPin({ x: Infinity, z: 2 })).toBeNull();
    expect(godotPin({ x: NaN, z: 2 })).toBeNull();
    expect(godotPin(null)).toBeNull();
  });

  it("pinsFor: my team's colour on each, mine only where I dropped it", () => {
    const game = { teams: [{ id: 1, color: "sky" }], players: [{ id: "p1", teamId: 1 }] } as unknown as THPublic;
    const priv = { teamId: 1, pins: [pin, other], clues: [], revealed: [], hotcold: { used: false, unlockAt: null, active: null } } as THPrivate;
    expect(pinsFor(game, priv, "p1")).toEqual({
      list: [
        { id: "n1", x: 10.5, z: -3, color: "#56b4e9", mine: true },
        { id: "n2", x: 1, z: 2, color: "#56b4e9", mine: false },
      ],
    });
  });

  it("pinsFor: no pins when I have no team or no private state", () => {
    const game = { teams: [{ id: 1, color: "sky" }], players: [{ id: "p1", teamId: null }] } as unknown as THPublic;
    expect(pinsFor(game, null, "p1")).toEqual({ list: [] });
    expect(pinsFor(game, { teamId: null, pins: [pin], clues: [], revealed: [], hotcold: { used: false, unlockAt: null, active: null } } as THPrivate, "p1")).toEqual({ list: [] });
  });

  it("GodotFeed: pins go on every sync, after the buggies", () => {
    const sent: BridgeCall[][] = [];
    const feed = new GodotFeed((calls) => sent.push(calls));
    const roster: Roster = { me: "p1", players: [] };
    const vehicles: Vehicles = { me: "p1", list: [] };
    const pins = { list: [{ id: "n1", x: 1, z: 2, color: "#56b4e9", mine: true }] };
    feed.update({ teamId: 1, pins: [pin], clues: [], revealed: [], hotcold: { used: false, unlockAt: null, active: null } }, "hunting", 1, roster, vehicles, pins);
    feed.sync();
    feed.sync();
    for (const calls of sent) {
      expect(calls.slice(0, 3)).toEqual([
        { fn: "roster", arg: roster },
        { fn: "vehicles", arg: vehicles },
        { fn: "pins", arg: pins },
      ]);
    }
  });
});

describe("hot or cold relay", () => {
  it("parses a level 0 to 3 with an id, and nothing else", () => {
    expect(parseHotCold({ t: "hotcold", id: "c1", level: 2 })).toEqual({ id: "c1", level: 2 });
    expect(parseHotCold({ t: "hotcold", id: "c1", level: 0 })).toEqual({ id: "c1", level: 0 });
    expect(parseHotCold({ t: "hotcold", id: "c1", level: 4 })).toBeNull();
    expect(parseHotCold({ t: "hotcold", id: "c1", level: "2" })).toBeNull();
    expect(parseHotCold({ t: "hotcold", level: 2 })).toBeNull();
    expect(parseHotCold({ t: "reveal", id: "c1", level: 2 })).toBeNull();
  });

  const NOW = 50_000;
  const priv = (active: THPrivate["hotcold"]["active"]): THPrivate => ({
    teamId: 1,
    pins: [],
    hotcold: { used: active !== null, unlockAt: 0, active },
    clues: [{ id: "c1", clues: ["a"], difficulty: 1, found: false, taken: false, photo: null }],
    revealed: [],
  });
  const hotCalls = (sent: BridgeCall[][]) => sent.flat().filter((c) => c.fn === "hotCold").map((c) => c.arg);

  it("sends the level when it changes, and -1 when the signal ends", () => {
    const sent: BridgeCall[][] = [];
    const feed = new GodotFeed((c) => sent.push(c), () => NOW);
    feed.update(priv({ id: "c1", until: NOW + 9000, level: null }), "hunting", 1);
    feed.sync();
    expect(hotCalls(sent)).toEqual([]);
    feed.stream("p0", { t: "hotcold", id: "c1", level: 2 });
    expect(hotCalls(sent)).toEqual([{ level: 2 }]);
    feed.sync();
    expect(hotCalls(sent)).toEqual([{ level: 2 }]);
    feed.update(priv(null), "hunting", 1);
    feed.sync();
    expect(hotCalls(sent)).toEqual([{ level: 2 }, { level: -1 }]);
    feed.sync();
    expect(hotCalls(sent)).toHaveLength(2);
  });

  it("a relay for another cache does not drive the meter", () => {
    const sent: BridgeCall[][] = [];
    const feed = new GodotFeed((c) => sent.push(c), () => NOW);
    feed.update(priv({ id: "c1", until: NOW + 9000, level: 1 }), "hunting", 1);
    feed.stream("p0", { t: "hotcold", id: "zz", level: 3 });
    expect(hotCalls(sent)).toEqual([]);
    feed.sync();
    expect(hotCalls(sent)).toEqual([{ level: 1 }]);
  });

  it("a relay before its signal is known waits for the state, then counts", () => {
    const sent: BridgeCall[][] = [];
    const feed = new GodotFeed((c) => sent.push(c), () => NOW);
    feed.update(priv(null), "hunting", 1);
    feed.stream("p0", { t: "hotcold", id: "c1", level: 2 });
    expect(hotCalls(sent)).toEqual([]);
    feed.update(priv({ id: "c1", until: NOW + 9000, level: null }), "hunting", 1);
    feed.sync();
    expect(hotCalls(sent)).toEqual([{ level: 2 }]);
  });

  it("an ended signal drops its level: a later signal on the same id starts unknown", () => {
    const sent: BridgeCall[][] = [];
    const feed = new GodotFeed((c) => sent.push(c), () => NOW);
    feed.update(priv({ id: "c1", until: NOW + 9000, level: null }), "hunting", 1);
    feed.stream("p0", { t: "hotcold", id: "c1", level: 3 });
    feed.update(priv(null), "hunting", 1);
    expect(feed.hotLevel()).toBeNull();
    feed.update(priv({ id: "c1", until: NOW + 9000, level: null }), "hunting", 1);
    expect(feed.hotLevel()).toBeNull();
  });

  it("a new round of the same map drops the level", () => {
    const sent: BridgeCall[][] = [];
    const feed = new GodotFeed((c) => sent.push(c), () => NOW);
    feed.update(priv({ id: "c1", until: NOW + 9000, level: null }), "hunting", roundKey(5, 1));
    feed.stream("p0", { t: "hotcold", id: "c1", level: 3 });
    expect(feed.hotLevel()).toBe(3);
    feed.update(priv({ id: "c1", until: NOW + 9000, level: 1 }), "hunting", roundKey(5, 2));
    expect(feed.hotLevel()).toBeNull();
  });
});
