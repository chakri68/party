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

describe("checkEntries edge cases", () => {
  const only = (entry: unknown, pack: "free" | "memes" = "free") => checkEntries([entry], { pack });

  it("flags each rule once", () => {
    const long = "a".repeat(33);
    expect(only({ ...good, id: long, file: `${long}.mp3` })).toHaveLength(1);
    expect(only({ ...good, name: "bad\u0007name" })).toHaveLength(1);
    expect(only({ ...good, source: "" })).toHaveLength(1);
    expect(only({ ...good, source: undefined })).toHaveLength(1);
    const noId = only({ ...good, id: undefined });
    expect(noId).toHaveLength(1);
    expect(noId[0]).toMatch(/^entry 1/);
  });

  it("accepts the limits", () => {
    const id32 = "a".repeat(32);
    expect(only({ ...good, ms: 3000 })).toEqual([]);
    expect(only({ ...good, ms: 1 })).toEqual([]);
    expect(only({ ...good, name: "x".repeat(24) })).toEqual([]);
    expect(only({ ...good, id: id32, file: `${id32}.mp3` })).toEqual([]);
  });

  it("names an unknown pack", () => {
    const problems = checkEntries([good], { pack: "meme" as "memes" });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("meme");
  });
});

describe("soundId", () => {
  it("makes a kebab id", () => {
    expect(soundId("Bruh!")).toBe("bruh");
    expect(soundId("Air Horn")).toBe("air-horn");
    expect(soundId("  Wow  wow ")).toBe("wow-wow");
    expect(soundId("!!!")).toBe("");
    expect(soundId("a".repeat(31) + " bcd")).toBe("a".repeat(31));
    expect(soundId("a".repeat(40))).toBe("a".repeat(32));
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

  it("has no other audio clip in the repo", () => {
    const exts = ["mp3", "wav", "m4a", "aac", "ogg", "opus", "flac", "webm"];
    const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...exts.map((e) => `*.${e}`)], {
      cwd: repo,
      encoding: "utf8",
    });
    const listed = new Set(FREE_SOUNDS.map((s) => `packages/sounds/free/${s.file}`));
    for (const path of out.split("\n").filter(Boolean)) {
      if (path.startsWith(".claude/worktrees/")) continue;
      const ok = /^packages\/audio\/src\/sounds\/[^/]+\.mp3$/.test(path) || listed.has(path);
      expect(ok, path).toBe(true);
    }
  });

  it("freeSoundUrl knows only listed files", () => {
    for (const s of FREE_SOUNDS) expect(typeof freeSoundUrl(s.file)).toBe("string");
    expect(freeSoundUrl("nope.mp3")).toBeNull();
  });
});
