import { describe, expect, it } from "vitest";
import { shouldSendSession, worldReadyFor } from "../client/godot/bridge.ts";

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
