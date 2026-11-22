import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkEntries, soundId } from "../check.mjs";
import { FREE_SOUNDS } from "../src/list.ts";
import { freeSoundUrl } from "../src/index.ts";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(pkg, "..", "..");

const good = { id: "rise", name: "Rise", file: "rise.mp3", ms: 1200, source: "made for this project", licence: "CC0" };
const goodMeme = { id: "rise", name: "Rise", file: "rise.mp3", ms: 1200, source: "made for this project", v: "0123456789abcdef".slice(0, 10) };

describe("checkEntries", () => {
  it("accepts good entries", () => {
    expect(checkEntries([good], { pack: "free" })).toEqual([]);
    expect(checkEntries([goodMeme], { pack: "memes" })).toEqual([]);
  });

  it("names each problem", () => {
    const one = (entries: unknown[], opts: Parameters<typeof checkEntries>[1], id: string) => {
      const problems = checkEntries(entries, opts);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(id);
    };
    one([good, good], { pack: "free" }, "rise");
    one([{ ...good, id: "Bad Id", file: "Bad Id.mp3" }], { pack: "free" }, "Bad Id");
    one([{ ...good, file: "other.mp3" }], { pack: "free" }, "rise");
    one([{ ...good, ms: 3001 }], { pack: "free" }, "rise");
    one([{ ...good, ms: 0 }], { pack: "free" }, "rise");
    one([{ ...good, ms: 1.5 }], { pack: "free" }, "rise");
    one([{ ...good, licence: undefined }], { pack: "free" }, "rise");
    one([{ ...goodMeme, v: "xyz" }], { pack: "memes" }, "rise");
    one([{ ...good, name: "x".repeat(25) }], { pack: "free" }, "rise");
    one([good], { pack: "free", fileExists: () => false }, "rise");
  });
});

describe("soundId", () => {
  it("makes a kebab id", () => {
    expect(soundId("Bruh!")).toBe("bruh");
    expect(soundId("Air Horn")).toBe("air-horn");
    expect(soundId("  Wow  wow ")).toBe("wow-wow");
    expect(soundId("!!!")).toBe("");
    const long = soundId("abcd efgh ".repeat(4));
    expect(long.length).toBeLessThanOrEqual(32);
    expect(long.endsWith("-")).toBe(false);
    expect(long.length).toBeGreaterThan(0);
  });
});

describe("the free pack", () => {
  const freeDir = join(pkg, "free");
  const files = existsSync(freeDir) ? readdirSync(freeDir).filter((f) => f.endsWith(".mp3")) : [];

  it("sounds.json is valid", () => {
    expect(checkEntries([...FREE_SOUNDS], { pack: "free", fileExists: (f) => existsSync(join(freeDir, f)) })).toEqual([]);
  });

  it("every free file is listed and small", () => {
    expect(new Set(files)).toEqual(new Set(FREE_SOUNDS.map((s) => s.file)));
    for (const f of files) expect(statSync(join(freeDir, f)).size).toBeLessThanOrEqual(40 * 1024);
  });

  it("has no other .mp3 in the repo", () => {
    const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.mp3"], {
      cwd: repo,
      encoding: "utf8",
    });
    const listed = new Set(FREE_SOUNDS.map((s) => `packages/sounds/free/${s.file}`));
    for (const path of out.split("\n").filter(Boolean)) {
      if (path.startsWith(".claude/")) continue;
      const ok = /^packages\/audio\/src\/sounds\/[^/]+\.mp3$/.test(path) || listed.has(path);
      expect(ok, path).toBe(true);
    }
  });

  it("freeSoundUrl knows only listed files", () => {
    for (const s of FREE_SOUNDS) expect(typeof freeSoundUrl(s.file)).toBe("string");
    expect(freeSoundUrl("nope.mp3")).toBeNull();
  });
});
