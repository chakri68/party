import { describe, expect, it } from "vitest";
import { rowScrollDelta } from "../src/row.ts";

const view = { left: 0, right: 300 };

describe("rowScrollDelta", () => {
  it("leaves a card that already shows", () => {
    expect(rowScrollDelta(view, { left: 100, right: 160 })).toBe(0);
  });
  it("scrolls right just enough for a card past the right edge", () => {
    expect(rowScrollDelta(view, { left: 280, right: 340 })).toBe(48);
  });
  it("scrolls left for a card past the left edge", () => {
    expect(rowScrollDelta(view, { left: -50, right: 10 })).toBe(-58);
  });
  it("shows the start of a card wider than the row", () => {
    expect(rowScrollDelta(view, { left: 40, right: 400 })).toBe(32);
  });
});
