import { afterEach, describe, expect, it, vi } from "vitest";
import { games } from "../src/games.ts";
import { homeParts } from "../src/views/home.ts";
import { createLabel, roomsPath, setupFromUrl, shellConfig } from "../src/shell.ts";

const url = (q: string) => new URL(`https://party.test/${q}`);

describe("setupFromUrl", () => {
  it("takes a game that has computers", () => {
    expect(setupFromUrl(url("?game=cheat"))).toEqual({ gameId: "cheat" });
    expect(setupFromUrl(url("?game=cheat&computers=3"))).toEqual({ gameId: "cheat", computers: 3 });
  });

  it("ignores an unknown game", () => {
    expect(setupFromUrl(url("?game=nope&computers=3"))).toBeUndefined();
    expect(setupFromUrl(url(""))).toBeUndefined();
    for (const odd of ["constructor", "__proto__", "toString"]) {
      expect(setupFromUrl(url(`?game=${odd}`))).toBeUndefined();
    }
  });

  it("ignores a game without computers", () => {
    const id = Object.keys(games).find((k) => !games[k]!.manifest.computers);
    expect(id).toBeDefined();
    expect(setupFromUrl(url(`?game=${id}`))).toBeUndefined();
  });

  it("leaves out a bad count", () => {
    for (const bad of ["0", "-2", "1.5", "abc", "", "3x"]) {
      expect(setupFromUrl(url(`?game=cheat&computers=${bad}`))).toEqual({ gameId: "cheat" });
    }
  });
});

describe("createLabel", () => {
  it("names the game when there is a setup", () => {
    expect(createLabel({ gameId: "cheat" })).toBe("Play Cheat with computers");
  });
  it("does not throw for an odd game name", () => {
    expect(createLabel({ gameId: "constructor" })).toBe("Play a game with computers");
  });
  it("is Create room otherwise", () => {
    expect(createLabel(undefined)).toBe("Create room");
  });
});

describe("roomsPath", () => {
  it("is the plain path with no setup or no count", () => {
    expect(roomsPath()).toBe("/api/rooms");
    expect(roomsPath({ gameId: "cheat" })).toBe("/api/rooms?game=cheat");
  });
  it("puts the game and count in the query", () => {
    expect(roomsPath({ gameId: "cheat", computers: 3 })).toBe("/api/rooms?game=cheat&computers=3");
  });
});

describe("the default creator", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts the setup in the query", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: "ABCD" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await shellConfig().createRoom({ gameId: "cheat", computers: 3 });
    expect(res).toEqual({ code: "ABCD" });
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/rooms?game=cheat&computers=3");
  });

  it("posts to the plain path with no setup, or no count", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: "ABCD" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await shellConfig().createRoom();
    await shellConfig().createRoom({ gameId: "cheat" });
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/rooms");
    expect(fetchMock.mock.calls[1]![0]).toBe("/api/rooms?game=cheat");
  });
});

describe("homeParts", () => {
  it("puts the join form before the host card for a guest", () => {
    const parts = homeParts(false, true);
    expect(parts.indexOf("join")).toBeLessThan(parts.indexOf("host"));
    expect(parts).not.toContain("create");
  });
  it("keeps the owner home with Create room and no host card", () => {
    expect(homeParts(true, false)).toEqual(["hero", "identity", "create", "join", "error", "recent"]);
  });
  it("shows no host card on a self-hosted copy", () => {
    expect(homeParts(false, false)).not.toContain("host");
  });
});
