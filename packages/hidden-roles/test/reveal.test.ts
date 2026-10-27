import { describe, expect, it } from "vitest";
import { nextRevealState } from "../src/reveal.ts";

// The widget is a thin DOM shell over this; it's checked in browser QA of the
// first game that uses it (no DOM test environment here).
describe("nextRevealState", () => {
  it("a tap toggles", () => {
    expect(nextRevealState("hidden", "tap")).toBe("shown");
    expect(nextRevealState("shown", "tap")).toBe("hidden");
  });

  it("backgrounding the tab always hides, so you come back to a face-down card", () => {
    expect(nextRevealState("shown", "background")).toBe("hidden");
    expect(nextRevealState("hidden", "background")).toBe("hidden");
  });
});
