import { describe, expect, it } from "vitest";
import { shouldSendSession, worldReadyFor, type BridgeCall } from "../client/godot/bridge.ts";
import { claimError, resync } from "../client/view.ts";
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

  it("applied twice, gives the same world", () => {
    // A stand-in for Godot: reveals and founds keyed by id, one phase.
    const apply = (calls: BridgeCall[], w = { shown: new Map<string, unknown>(), found: new Set<string>(), phase: "" }) => {
      for (const c of calls) {
        if (c.fn === "revealCache") w.shown.set(c.arg.id, c.arg);
        else if (c.fn === "cacheFound") w.found.add(c.arg.id);
        else w.phase = c.arg.phase;
      }
      return w;
    };
    const once = apply(resync(priv, "hunting"));
    const twice = apply(resync(priv, "hunting"), apply(resync(priv, "hunting")));
    expect(twice).toEqual(once);
    expect(resync(priv, "hunting")).toEqual(resync(priv, "hunting"));
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
