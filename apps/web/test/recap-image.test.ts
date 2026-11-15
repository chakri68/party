import { describe, expect, it } from "vitest";
import { wrapLines } from "../src/views/recap-image.ts";

const measure = (s: string) => s.length * 10;

describe("wrapLines", () => {
  it("keeps short text on one line", () => {
    expect(wrapLines("Sam and Mei", 200, measure)).toEqual(["Sam and Mei"]);
  });
  it("wraps at word breaks and never goes over the width", () => {
    const lines = wrapLines("Sam, Mei, Arjun and Priya and Dev", 120, measure);
    expect(lines).toEqual(["Sam, Mei,", "Arjun and", "Priya and", "Dev"]);
    for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(120);
  });
  it("cuts a word that is wider than a line", () => {
    const lines = wrapLines("abcdefghijklmnop ok", 50, measure);
    expect(lines.join("").replace(/ /g, "")).toBe("abcdefghijklmnopok");
    for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(50);
  });
  it("returns nothing for empty text", () => {
    expect(wrapLines("  ", 100, measure)).toEqual([]);
  });
});
