import { describe, expect, it } from "vitest";
import { shouldSendSession } from "../client/godot/bridge.ts";

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
