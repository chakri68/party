import { describe, expect, it } from "vitest";
import { IMAGE_HEIGHT, IMAGE_PAD, IMAGE_SITE_ROOM, layoutAwards, layoutBody, limitLines, wrapLines } from "../src/views/recap-image.ts";

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
      expect(b.who.length).toBeLessThanOrEqual(3);
      expect(b.line.length).toBeGreaterThanOrEqual(1);
    }
  });
  it("keeps full size when there is room", () => {
    expect(layoutAwards(awards.slice(0, 1), 920, 800, m).scale).toBe(1);
  });
  it("keeps three long unbroken names whole", () => {
    const w = "W".repeat(20);
    const three = [{ title: "Champion of the night", who: `${w}, ${w} and ${w}`, line: "Won the most games" }];
    // 23 px a letter at full size: one name is 460 px, two with ", " are 966 px, past the 920 px line.
    const { blocks, scale } = layoutAwards(three, 920, 800, m);
    expect(scale).toBe(1);
    expect(blocks[0]!.who).toHaveLength(3);
    expect(blocks[0]!.who.join(" ")).toBe(`${w}, ${w} and ${w}`);
  });
  it("shrinks rather than cut a name when that still fits", () => {
    const w = "W".repeat(20);
    const four = [{ title: "Champion of the night", who: `${w}, ${w}, ${w} and ${w}`, line: "Won" }];
    const { blocks, scale } = layoutAwards(four, 920, 800, m);
    expect(scale).toBeLessThan(1);
    expect(blocks[0]!.who.join(" ")).not.toContain("…");
  });
  it("never draws a title without names, even when tight", () => {
    const { blocks } = layoutAwards(awards, 920, 100, m);
    for (const b of blocks) expect(b.who.length).toBeGreaterThan(0);
  });
});

describe("layoutBody", () => {
  const m = (s: string, size: number) => s.length * size * 0.5;
  const award = (i: number, who = "Sam and Mei") => ({ title: `Award number ${i}`, who, line: "Told the most lies tonight." });
  const main = Array.from({ length: 5 }, (_, i) => award(i));
  const table = Array.from({ length: 3 }, (_, i) => award(i + 5));
  const moment = "Loudest moment: 5 people talking at once, in Overheat.";
  // The app name, the heading and a two-line meta line sit above the body.
  const top = IMAGE_PAD + 66 + 111 + 2 * 43 + 56;
  const room = IMAGE_HEIGHT - IMAGE_SITE_ROOM - top;

  it("fits 5 awards, 3 table awards and the moment inside the picture", () => {
    const out = layoutBody({ awards: main, table, moment }, 920, room, m);
    expect(out.awards).toHaveLength(5);
    expect(out.table).toHaveLength(3);
    expect(out.moment.length).toBeGreaterThan(0);
    expect(top + out.height).toBeLessThanOrEqual(IMAGE_HEIGHT - IMAGE_SITE_ROOM);
  });

  it("shrinks before it drops the moment", () => {
    const roomy = layoutBody({ awards: main, table, moment }, 920, 5000, m);
    expect(roomy.scale).toBe(1);
    const out = layoutBody({ awards: main, table, moment }, 920, room, m);
    expect(out.scale).toBeLessThan(1);
    expect(out.moment.length).toBeGreaterThan(0);
  });

  it("drops the moment first when it can't fit", () => {
    const full = layoutBody({ awards: main, table, moment }, 920, 5000, m);
    const without = layoutBody({ awards: main, table, moment: null }, 920, 5000, m);
    // Room for every award at the smallest size, but not for the moment as well.
    const small = layoutBody({ awards: main, table, moment: null }, 920, 1, m);
    const out = layoutBody({ awards: main, table, moment }, 920, small.height + 1, m);
    expect(full.height).toBeGreaterThan(without.height);
    expect(out.moment).toEqual([]);
    expect(out.awards).toHaveLength(5);
    expect(out.table).toHaveLength(3);
    expect(out.height).toBeLessThanOrEqual(small.height + 1);
  });

  it("counts the table heading only when there are table awards", () => {
    const one = [table[0]!];
    const mainOnly = layoutBody({ awards: main, table: [], moment: null }, 920, 5000, m).height;
    const asMain = layoutBody({ awards: [...main, ...one], table: [], moment: null }, 920, 5000, m).height;
    const asTable = layoutBody({ awards: main, table: one, moment: null }, 920, 5000, m).height;
    expect(asMain).toBeGreaterThan(mainOnly);
    expect(asTable).toBeGreaterThan(asMain);
  });
});
