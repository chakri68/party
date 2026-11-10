import { describe, expect, it } from "vitest";
import { shouldSendSession, worldReadyFor, type BridgeCall } from "../client/godot/bridge.ts";
import { GodotFeed, claimError, resync } from "../client/view.ts";
import type { THPrivate } from "../shared/types.ts";

// Review Focus 3: the session can reach Godot twice. The bridge sends it once
// per layout seed, and again only when Godot itself came back up (an iframe
// reload: a fresh engine with no world).
describe("shouldSendSession", () => {
  it("sends the first session", () => {
    expect(shouldSendSession(null, false, 12345)).toBe(true);
  });

  it("does not send the same seed twice", () => {
    expect(shouldSendSession(12345, false, 12345)).toBe(false);
  });

  it("sends a new seed", () => {
    expect(shouldSendSession(12345, false, 777)).toBe(true);
  });

  it("sends the same seed again after Godot reloads", () => {
    expect(shouldSendSession(12345, true, 12345)).toBe(true);
  });
});

// A world-ready says which seed Godot built. One left over from an older
// layout (the host started a new round mid-build) must not count.
describe("worldReadyFor", () => {
  it("counts a world-ready for this layout's seed", () => {
    expect(worldReadyFor({ kind: "world-ready", ms: 40, chunks: 9, seed: 12345 }, 12345)).toBe(true);
  });

  it("ignores a world-ready for another seed", () => {
    expect(worldReadyFor({ kind: "world-ready", ms: 40, chunks: 9, seed: 777 }, 12345)).toBe(false);
  });
});

// Review Focus 4: a reveal can be lost (it reached the old world just before
// a rebuild, or a reloaded iframe). So every update sends the lot again:
// every reveal, every found id and the phase. Godot treats each as idempotent.
describe("resync", () => {
  const priv: THPrivate = {
    clues: [
      { id: "c1", clues: ["a"], difficulty: 1, found: true },
      { id: "c2", clues: ["b"], difficulty: 2, found: false },
      { id: "c3", clues: ["c"], difficulty: 3, found: false },
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
      { fn: "cacheFound", arg: { id: "c1" } },
      { fn: "setPhase", arg: { phase: "hunting" } },
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
    clues: [{ id: "c1", clues: ["a"], difficulty: 1, found: false }, { id: "c4", clues: ["b"], difficulty: 2, found: false }],
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
    feed.stream({ t: "reveal", id: "c4", x: 12, z: -30, dy: 0.5 });
    expect(last()).toEqual([{ fn: "revealCache", arg: { id: "c4", x: 12, z: -30, dy: 0.5 } }]);
  });

  it("ignores stream data that is not a reveal", () => {
    const { feed, sent } = setup();
    feed.update(priv(), "hunting", 1);
    feed.stream({ t: "pos", x: 1, y: 2, z: 3, foot: true });
    feed.stream({ t: "reveal", id: 4, x: 1, z: 2 });
    expect(sent).toEqual([]);
  });

  // I1: the server relays a reveal once, and a relay brings no state update.
  // Godot reloading after it must still get the crate back.
  it("re-sends a stream reveal when Godot comes up again with no update in between", () => {
    const { feed, last } = setup();
    feed.update(priv(), "hunting", 1);
    feed.sync();
    feed.stream({ t: "reveal", id: "c4", x: 12, z: -30, dy: 0.5 });
    feed.sync(); // ready() from a reloaded iframe
    expect(reveals(last())).toEqual([{ id: "c4", x: 12, z: -30, dy: 0.5 }]);
    expect(last()[last().length - 1]).toEqual({ fn: "setPhase", arg: { phase: "hunting" } });
  });

  it("sends a reveal once when it is in both the stream and the state", () => {
    const { feed, last } = setup();
    feed.update(priv(), "hunting", 1);
    feed.stream({ t: "reveal", id: "c4", x: 12, z: -30, dy: 0.5 });
    feed.update(priv([{ id: "c4", x: 12, z: -30, dy: 0.5 }]), "hunting", 1);
    feed.sync();
    expect(reveals(last())).toEqual([{ id: "c4", x: 12, z: -30, dy: 0.5 }]);
  });

  it("forgets stream reveals on a new map", () => {
    const { feed, last } = setup();
    feed.update(priv(), "hunting", 1);
    feed.stream({ t: "reveal", id: "c4", x: 12, z: -30, dy: 0.5 });
    feed.update(priv(), "generating", 2);
    feed.sync();
    expect(reveals(last())).toEqual([]);
  });
});

describe("claimError", () => {
  it("has one plain line per claim code", () => {
    expect(claimError("in-vehicle", "x")).toBe("Get out of the buggy first.");
    expect(claimError("too-far", "x")).toBe("Go closer to the cache.");
    expect(claimError("no-position", "x")).toBe("Wait a moment and try again.");
    expect(claimError("moved-too-fast", "x")).toBe("Wait a moment and try again.");
    expect(claimError("already-found", "x")).toBe("You already found this cache.");
    expect(claimError("not-yours", "x")).toBe("This cache is not on your list.");
    expect(claimError("not-hunting", "x")).toBe("The hunt has not started.");
  });

  it("falls back to the server's message for anything else", () => {
    expect(claimError("rate-limited", "Slow down.")).toBe("Slow down.");
    expect(claimError(undefined, "Slow down.")).toBe("Slow down.");
  });
});
