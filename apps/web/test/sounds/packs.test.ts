import { FREE_SOUNDS } from "@games/sounds";
import { describe, expect, it } from "vitest";
import { configure, shellConfig } from "../../src/shell.ts";
import { MAX_PACK_SOUNDS, freeBoard, hostSoundsUrl, loadExtraPacks, parseHostList, parsePackList } from "../../src/sounds/packs.ts";

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
      { ...bruh, id: "h", url: "/\\x.test/a.mp3" },
      { ...bruh, id: "i", url: "/\t/x.test/a.mp3" },
      { ...bruh, id: "j", url: "/\n/x.test/a.mp3" },
      { ...bruh, id: "k", url: "/a b.mp3" },
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
    const throws = (url: string) => {
      if (url === "/bad") throw new Error("sync");
      return Promise.resolve(bodies[url] ?? null);
    };
    expect((await loadExtraPacks(["/bad", "/a"], throws)).map((s) => s.id)).toEqual(["alpha:one"]);
  });

  it("hostSoundsUrl names the room's list", () => {
    expect(hostSoundsUrl("K7DX")).toBe("/api/rooms/K7DX/sounds");
  });

  it("parseHostList keeps host slots", () => {
    const L = hostSoundsUrl("K7DX");
    const three = { id: "3", name: "  Horn  ", ms: 1500, url: `${L}/3?v=0123456789` };
    expect(parseHostList({ pack: "host", sounds: [three] }, L)).toEqual([
      { id: "host:3", name: "Horn", ms: 1500, url: `${L}/3?v=0123456789` },
    ]);
  });

  it("parseHostList drops what is not safe", () => {
    const L = "/api/rooms/K7DX/sounds";
    const good = (id: string) => ({ id, name: `Slot ${id}`, ms: 1000, url: `${L}/${id}?v=0123456789` });
    const one = good("1");
    expect(parseHostList({ pack: "memes", sounds: [one] }, L)).toEqual([]);
    const bad = [
      good("7"),
      { ...good("2"), url: "/api/rooms/ZZZZ/sounds/2?v=0123456789" },
      { ...good("2"), url: "https://x.test/a" },
      { ...good("2"), url: "//x.test/a" },
      { ...good("2"), url: `${L}` },
      { ...good("2"), url: `${L}/2 x` },
      { ...good("2"), ms: 3001 },
      { ...good("2"), ms: 0 },
      { ...good("2"), name: "x".repeat(25) },
      { ...good("2"), name: "  " },
      { ...good("2"), id: 2 },
      null,
    ];
    expect(parseHostList({ pack: "host", sounds: [...bad, one, { ...one, name: "Again" }] }, L)).toEqual([
      { ...one, id: "host:1" },
    ]);
    const eight = ["1", "2", "3", "4", "5", "6", "1", "2"].map((id, i) => ({ ...good(id), name: `N${i}` }));
    expect(parseHostList({ pack: "host", sounds: eight }, L).map((s) => s.id)).toEqual(
      ["1", "2", "3", "4", "5", "6"].map((id) => `host:${id}`),
    );
    expect(parseHostList(null, L)).toEqual([]);
    expect(parseHostList({ pack: "host" }, L)).toEqual([]);
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
