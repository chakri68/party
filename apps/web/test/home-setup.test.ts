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
  it("My sounds follows Create for an owner who has sounds", () => {
    const parts = homeParts(true, false, true);
    expect(parts[parts.indexOf("create") + 1]).toBe("my-sounds");
    expect(homeParts(true, false)).not.toContain("my-sounds");
    // A guest has no create, so no sounds.
    expect(homeParts(false, true, true)).not.toContain("my-sounds");
  });
  it("shows no host card on a self-hosted copy", () => {
    expect(homeParts(false, false)).not.toContain("host");
  });
});

describe("host app home options", async () => {
  const { configure } = await import("../src/shell.ts");
  const { createText, heroWords } = await import("../src/views/home.ts");
  afterEach(() => configure({}));

  it("keeps today's words by default", () => {
    configure({});
    expect(createText(undefined)).toBe("Create room");
    expect(createText({ gameId: "cheat" })).toBe("Play Cheat with computers");
    expect(heroWords(shellConfig().home, "Hi")).toEqual({ title: null, tagline: "Hi" });
  });
  it("uses createText only without a setup", () => {
    configure({ createText: "Start a room" });
    expect(createText(undefined)).toBe("Start a room");
    expect(createText({ gameId: "cheat" })).toBe("Play Cheat with computers");
  });
  it("uses the home title and subtitle", () => {
    configure({ home: { title: "Start a room", subtitle: "Type your name." } });
    expect(heroWords(shellConfig().home, "Hi")).toEqual({ title: "Start a room", tagline: "Type your name." });
    configure({ home: { subtitle: "Only this" } });
    expect(heroWords(shellConfig().home, "Hi")).toEqual({ title: null, tagline: "Only this" });
  });
});

describe("source code link", async () => {
  const { configure } = await import("../src/shell.ts");
  const { heroWords, sourceLink } = await import("../src/views/home.ts");

  /** Just enough DOM for h() to build the link. */
  class FakeEl {
    innerHTML = "";
    className = "";
    attrs = new Map<string, string>();
    children: unknown[] = [];
    constructor(readonly tagName: string) {}
    setAttribute(k: string, v: string) {
      this.attrs.set(k, v);
    }
    append(...c: unknown[]) {
      this.children.push(...c);
    }
  }
  const links = (node: unknown): FakeEl[] => {
    if (!(node instanceof FakeEl)) return [];
    return [...(node.tagName === "a" ? [node] : []), ...node.children.flatMap(links)];
  };
  const stubDom = () => {
    vi.stubGlobal("document", { createElement: (tag: string) => new FakeEl(tag) });
    vi.stubGlobal("Node", FakeEl);
  };
  afterEach(() => {
    vi.unstubAllGlobals();
    configure({});
  });

  it("shows one link that opens the source in a new tab", () => {
    stubDom();
    const found = links(sourceLink("https://github.com/chakri68/party"));
    expect(found).toHaveLength(1);
    expect(found[0]!.attrs.get("href")).toBe("https://github.com/chakri68/party");
    expect(found[0]!.attrs.get("target")).toBe("_blank");
    expect(found[0]!.attrs.get("rel")).toBe("noopener noreferrer");
    expect(JSON.stringify(found[0]!.children)).toContain("Source code on GitHub");
  });
  it("shows nothing without the option", () => {
    stubDom();
    expect(links(sourceLink(undefined))).toHaveLength(0);
    expect(sourceLink(undefined)).toBeNull();
    configure({});
    expect(shellConfig().home?.sourceUrl).toBeUndefined();
  });
  it("puts the link last, only when set", () => {
    expect(homeParts(true, false, true, true).at(-1)).toBe("source");
    expect(homeParts(false, true, false, true).at(-1)).toBe("source");
    expect(homeParts(false, true).filter((p) => p === "source")).toHaveLength(0);
    expect(homeParts(true, false, true, true).filter((p) => p === "source")).toHaveLength(1);
  });
  it("keeps the usual title, subtitle and tab title", () => {
    configure({ home: { sourceUrl: "https://github.com/chakri68/party" } });
    expect(heroWords(shellConfig().home, "Hi")).toEqual({ title: null, tagline: "Hi" });
    expect(shellConfig().home?.pageTitle).toBeUndefined();
    expect(shellConfig().appTitle).toBe("Party Games");
  });
});
