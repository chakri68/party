import { describe, expect, it } from "vitest";
import { rowScrollDelta, rowTarget } from "../src/row.ts";

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

describe("rowTarget", () => {
  const [a, b, c, d] = ["a", "b", "c", "d"];
  const hand = [a, b, c];
  const memo = (explicit: string | null, fallback: string | null, kids = hand) => ({ explicit, fallback, kids });

  it("scrolls to the fallback on the first render", () => {
    expect(rowTarget(undefined, memo(null, a))).toBe(a);
  });
  it("scrolls to a fresh card, then not back to the fallback with the same cards", () => {
    const fresh = memo(d, a, [a, b, c, d]);
    expect(rowTarget(memo(null, a), fresh)).toBe(d);
    expect(rowTarget(fresh, memo(null, a, [a, b, c, d]))).toBeNull();
  });
  it("scrolls to a picked card, and stays put on unpick", () => {
    const picked = memo(c, a);
    expect(rowTarget(memo(null, a), picked)).toBe(c);
    expect(rowTarget(picked, memo(null, a))).toBeNull();
  });
  it("scrolls to a newly picked card while another was picked", () => {
    expect(rowTarget(memo(c, a), memo(b, a))).toBe(b);
  });
  it("scrolls to the fallback when the hand changes", () => {
    expect(rowTarget(memo(null, a), memo(null, b, [b, c]))).toBe(b);
  });
  it("scrolls to the fallback when it changes with no pick (the turn came round)", () => {
    expect(rowTarget(memo(null, a), memo(null, c))).toBe(c);
  });
  it("leaves the row alone when nothing changed", () => {
    expect(rowTarget(memo(null, a), memo(null, a))).toBeNull();
    expect(rowTarget(memo(c, a), memo(c, a))).toBeNull();
  });
});
