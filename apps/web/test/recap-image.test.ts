import { describe, expect, it } from "vitest";
import { layoutAwards, limitLines, wrapLines } from "../src/views/recap-image.ts";

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

describe("limitLines", () => {
  it("ends the last kept line with an ellipsis", () => {
    const out = limitLines(["aaaa bbbb", "cccc dddd", "eeee"], 2, 100, measure);
    expect(out).toHaveLength(2);
    expect(out[1]!.endsWith("…")).toBe(true);
    expect(measure(out[1]!)).toBeLessThanOrEqual(100);
  });
  it("leaves short text alone", () => {
    expect(limitLines(["a"], 2, 100, measure)).toEqual(["a"]);
  });
});

describe("layoutAwards", () => {
  const awards = Array.from({ length: 5 }, (_, i) => ({
    title: `Award number ${i}`,
    who: "Sam, Mei, Arjun, Priya, Devansh, Kavya, Rohan and Ananya Subramaniam",
    line: "Told the most lies tonight and was caught by almost everyone at the table",
  }));
  const m = (s: string, size: number) => s.length * size * 0.5;
  it("fits every award with a title, names and a line", () => {
    const { blocks, scale } = layoutAwards(awards, 920, 800, m);
    expect(blocks).toHaveLength(5);
    expect(scale).toBeLessThan(1);
    for (const b of blocks) {
      expect(b.title.length).toBe(1);
      expect(b.who.length).toBeGreaterThanOrEqual(1);
      expect(b.who.length).toBeLessThanOrEqual(2);
      expect(b.line.length).toBeGreaterThanOrEqual(1);
    }
  });
  it("keeps full size when there is room", () => {
    expect(layoutAwards(awards.slice(0, 1), 920, 800, m).scale).toBe(1);
  });
  it("never draws a title without names, even when tight", () => {
    const { blocks } = layoutAwards(awards, 920, 100, m);
    for (const b of blocks) expect(b.who.length).toBeGreaterThan(0);
  });
});
