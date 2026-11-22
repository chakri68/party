import type { ClientMessage } from "@games/protocol";
import { SOUND_COOLDOWN_MS } from "@games/protocol";
import { describe, expect, it } from "vitest";
import { COOLDOWN_SLACK_MS, SoundBoard } from "../../src/sounds/board.ts";
import { freeBoard } from "../../src/sounds/packs.ts";

interface Clip {
  url: string;
}

const PACK = {
  pack: "memes",
  sounds: [
    { id: "bruh", name: "Bruh", ms: 1200, url: "/api/packs/memes/bruh.mp3?v=0123456789" },
    { id: "wow", name: "Wow", ms: 900, url: "/api/packs/memes/wow.mp3?v=abcdef0123" },
  ],
};

const flush = () => new Promise((r) => setTimeout(r, 0));

function rig(opts: { ready?: boolean; badBytes?: string[]; badDecode?: string[] } = {}) {
  const state = {
    clock: 1000,
    ready: opts.ready ?? false,
    enabled: true,
    readyFns: [] as (() => void)[],
    sent: [] as ClientMessage[],
    played: [] as Clip[],
    decodes: 0,
    jsonGets: 0,
    byteGets: 0,
  };
  const urlOf = new Map<ArrayBuffer, string>();
  const board = new SoundBoard<Clip>({
    getJson: (url) => {
      state.jsonGets++;
      return Promise.resolve(url === "/p" ? PACK : null);
    },
    getBytes: (url) => {
      state.byteGets++;
      if (opts.badBytes?.includes(url)) return Promise.resolve(null);
      const bytes = new ArrayBuffer(8);
      urlOf.set(bytes, url);
      return Promise.resolve(bytes);
    },
    decode: (bytes) => {
      state.decodes++;
      const url = urlOf.get(bytes)!;
      if (opts.badDecode?.includes(url)) return Promise.reject(new Error("bad file"));
      return Promise.resolve({ url });
    },
    play: (clip) => {
      state.played.push(clip);
      return true;
    },
    ready: () => state.ready,
    onReady: (fn) => {
      state.readyFns.push(fn);
      return () => {
        state.readyFns = state.readyFns.filter((f) => f !== fn);
      };
    },
    enabled: () => state.enabled,
    send: (msg) => state.sent.push(msg),
    now: () => state.clock,
  });
  const fireReady = async () => {
    state.ready = true;
    for (const fn of [...state.readyFns]) fn();
    await flush();
  };
  return { board, state, fireReady };
}

const freeIds = () => freeBoard().map((s) => s.id);
const urlFor = (board: SoundBoard<Clip>, id: string) => board.list().find((s) => s.id === id)!.url;

describe("SoundBoard", () => {
  it("loads free first, then the extra packs, and tells listeners", async () => {
    const { board } = rig();
    let changes = 0;
    board.onChange(() => changes++);
    const loading = board.load(["/p"]);
    expect(board.list().map((s) => s.id)).toEqual(freeIds());
    await loading;
    expect(board.list().map((s) => s.id)).toEqual([...freeIds(), "memes:bruh", "memes:wow"]);
    expect(changes).toBeGreaterThanOrEqual(2);
  });

  it("a second load fetches nothing", async () => {
    const { board, state } = rig();
    await board.load(["/p"]);
    const json = state.jsonGets;
    const bytes = state.byteGets;
    expect(bytes).toBe(board.list().length);
    await board.load(["/p"]);
    expect(state.jsonGets).toBe(json);
    expect(state.byteGets).toBe(bytes);
  });

  it("fetches every file at load and decodes only once there is a context", async () => {
    const { board, state, fireReady } = rig();
    await board.load(["/p"]);
    await flush();
    expect(state.byteGets).toBe(board.list().length);
    expect(state.decodes).toBe(0);
    await fireReady();
    expect(state.decodes).toBe(board.list().length);
    await fireReady();
    expect(state.decodes).toBe(board.list().length);
  });

  it("tap sends and starts the cooldown", async () => {
    const { board, state } = rig();
    await board.load([]);
    expect(board.tap("free:rise")).toBe("sent");
    expect(state.sent).toEqual([{ type: "sound", id: "free:rise" }]);
    expect(board.tap("free:drop")).toBe("cooling");
    expect(state.sent).toHaveLength(1);
  });

  it("the tile waits a little longer than the server", async () => {
    const { board, state } = rig();
    await board.load([]);
    expect(board.coolingMs()).toBe(0);
    board.tap("free:rise");
    expect(board.coolingMs()).toBe(SOUND_COOLDOWN_MS + COOLDOWN_SLACK_MS);
    state.clock += SOUND_COOLDOWN_MS;
    expect(board.coolingMs()).toBe(COOLDOWN_SLACK_MS);
    expect(board.tap("free:rise")).toBe("cooling");
    state.clock += COOLDOWN_SLACK_MS;
    expect(board.coolingMs()).toBe(0);
    expect(board.tap("free:rise")).toBe("sent");
    expect(state.sent).toHaveLength(2);
  });

  it("tap on an unknown id sends nothing", async () => {
    const { board, state } = rig();
    await board.load([]);
    expect(board.tap("memes:bruh")).toBe("unknown");
    expect(board.tap("nope")).toBe("unknown");
    expect(state.sent).toEqual([]);
    expect(board.coolingMs()).toBe(0);
  });

  it("receive plays a decoded clip", async () => {
    const { board, state } = rig({ ready: true });
    await board.load(["/p"]);
    await flush();
    expect(board.receive("memes:bruh")).toBe(true);
    expect(state.played).toEqual([{ url: urlFor(board, "memes:bruh") }]);
  });

  it("receive is silent when Sound board is off, or for an unknown id", async () => {
    const { board, state } = rig({ ready: true });
    await board.load(["/p"]);
    await flush();
    state.enabled = false;
    expect(board.receive("free:rise")).toBe(false);
    state.enabled = true;
    expect(board.receive("memes:nope")).toBe(false);
    expect(board.receive("nope")).toBe(false);
    expect(state.played).toEqual([]);
  });

  it("a sound that comes before decode is skipped, not queued", async () => {
    const { board, state, fireReady } = rig();
    await board.load([]);
    expect(board.receive("free:rise")).toBe(false);
    await fireReady();
    expect(state.played).toHaveLength(0);
    expect(board.receive("free:rise")).toBe(true);
    expect(state.played).toHaveLength(1);
  });

  it("a failed fetch or decode leaves only that sound silent", async () => {
    const free = freeBoard();
    const { board, state } = rig({ ready: true, badBytes: [free[0]!.url], badDecode: [free[1]!.url] });
    await board.load(["/p"]);
    await flush();
    expect(board.receive(free[0]!.id)).toBe(false);
    expect(board.receive(free[1]!.id)).toBe(false);
    expect(board.receive(free[2]!.id)).toBe(true);
    expect(board.receive("memes:wow")).toBe(true);
    expect(state.played).toHaveLength(2);
  });

  it("destroy stops listening for the context", async () => {
    const { board, state, fireReady } = rig();
    await board.load([]);
    expect(state.readyFns).toHaveLength(1);
    board.destroy();
    expect(state.readyFns).toHaveLength(0);
    await fireReady();
    expect(state.decodes).toBe(0);
  });
});
