import { FREE_SOUNDS } from "@games/sounds";
import { describe, expect, it } from "vitest";
import { configure, shellConfig } from "../../src/shell.ts";
import { MAX_PACK_SOUNDS, freeBoard, loadExtraPacks, parsePackList } from "../../src/sounds/packs.ts";

const bruh = { id: "bruh", name: "Bruh", ms: 1200, url: "/api/packs/memes/bruh.mp3?v=0123456789" };
const list = (sounds: unknown[], pack = "memes") => ({ pack, sounds });

describe("sound packs", () => {
  it("freeBoard lists every free sound", () => {
    const board = freeBoard();
    expect(board).toHaveLength(FREE_SOUNDS.length);
    expect(board.map((s) => s.id)).toEqual(FREE_SOUNDS.map((s) => `free:${s.id}`));
    for (const s of board) {
      expect(s.id.startsWith("free:")).toBe(true);
      expect(typeof s.url).toBe("string");
    }
  });

  it("parsePackList keeps good entries with pack ids", () => {
    expect(parsePackList(list([bruh]))).toEqual([{ ...bruh, id: "memes:bruh" }]);
  });

  it("parsePackList drops entries that are not safe", () => {
    const bad = [
      { ...bruh, id: "a", url: "https://x.test/a.mp3" },
      { ...bruh, id: "b", url: "//x.test/a.mp3" },
      { ...bruh, id: "Bad" },
      { ...bruh, id: "c", ms: 0 },
      { ...bruh, id: "d", ms: 3001 },
      { ...bruh, id: "e", name: "x".repeat(25) },
      { ...bruh, id: "f", name: "   " },
      { ...bruh, id: "g", ms: 1.5 },
    ];
    expect(parsePackList(list([...bad, bruh, { ...bruh, name: "Again" }]))).toEqual([{ ...bruh, id: "memes:bruh" }]);
    expect(parsePackList(list([bruh], "free"))).toEqual([]);
    expect(parsePackList(list([bruh], "host"))).toEqual([]);
    expect(parsePackList(list([bruh], "Memes"))).toEqual([]);
    expect(parsePackList(null)).toEqual([]);
    expect(parsePackList("text")).toEqual([]);
    expect(parsePackList({ pack: "memes" })).toEqual([]);
    expect(parsePackList({ error: "Not found" })).toEqual([]);
  });

  it("parsePackList keeps at most MAX_PACK_SOUNDS", () => {
    const many = Array.from({ length: MAX_PACK_SOUNDS + 5 }, (_, i) => ({ ...bruh, id: `s${i}` }));
    const got = parsePackList(list(many));
    expect(got).toHaveLength(MAX_PACK_SOUNDS);
    expect(got[0]!.id).toBe("memes:s0");
  });

  it("loadExtraPacks keeps the order and skips a pack that fails", async () => {
    const bodies: Record<string, unknown> = {
      "/a": list([{ ...bruh, id: "one" }], "alpha"),
      "/b": list([{ ...bruh, id: "two" }], "beta"),
      "/none": null,
    };
    const getJson = (url: string) => (url === "/bad" ? Promise.reject(new Error("offline")) : Promise.resolve(bodies[url] ?? null));
    const got = await loadExtraPacks(["/b", "/bad", "/none", "/a"], getJson);
    expect(got.map((s) => s.id)).toEqual(["beta:two", "alpha:one"]);
  });

  it("the shell has no extra packs by default", () => {
    configure({});
    expect(shellConfig().extraPacks).toEqual([]);
  });

  it("only the stock main.ts sets extra packs", () => {
    const files = import.meta.glob<string>("../../src/**/*.ts", { query: "?raw", import: "default", eager: true });
    const setters = Object.keys(files).filter((k) => /extraPacks:\s*\[\s*["'`]/.test(files[k]!));
    expect(setters).toEqual(["../../src/main.ts"]);
  });
});
