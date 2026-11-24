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

function rig(opts: { ready?: boolean; badBytes?: string[]; badDecode?: string[]; throwBytes?: string[]; held?: (() => void)[] } = {}) {
  const state = {
    clock: 1000,
    ready: opts.ready ?? false,
    enabled: true,
    readyFns: [] as (() => void)[],
    sent: [] as ClientMessage[],
    played: [] as Clip[],
    decodes: 0,
    inFlight: 0,
    maxInFlight: 0,
    jsonGets: 0,
    byteGets: 0,
    byteUrls: [] as string[],
    hostBody: null as unknown,
    hostFail: false,
    failUrls: new Set<string>(),
    /** While set, each host list fetch waits here. */
    jsonHeld: null as (() => void)[] | null,
    /** While set, each decode waits here. */
    decodeHeld: null as (() => void)[] | null,
  };
  const urlOf = new Map<ArrayBuffer, string>();
  const board = new SoundBoard<Clip>({
    getJson: (url) => {
      state.jsonGets++;
      if (url !== HOST_URL) return Promise.resolve(url === "/p" ? PACK : null);
      const answer = () => (state.hostFail ? Promise.reject(new Error("offline")) : Promise.resolve(state.hostBody));
      const held = state.jsonHeld;
      if (!held) return answer();
      return new Promise<void>((r) => held.push(r)).then(answer);
    },
    getBytes: (url) => {
      state.byteGets++;
      state.byteUrls.push(url);
      if (opts.throwBytes?.includes(url)) throw new Error("sync");
      if (state.failUrls.has(url)) return Promise.reject(new Error("404"));
      if (opts.badBytes?.includes(url)) return Promise.resolve(null);
      const bytes = new ArrayBuffer(8);
      urlOf.set(bytes, url);
      return Promise.resolve(bytes);
    },
    decode: (bytes) => {
      state.decodes++;
      const url = urlOf.get(bytes)!;
      if (opts.badDecode?.includes(url)) return Promise.reject(new Error("bad file"));
      const held = opts.held ?? state.decodeHeld;
      if (!held) return Promise.resolve({ url });
      state.inFlight++;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      return new Promise<Clip>((resolve) =>
        held.push(() => {
          state.inFlight--;
          resolve({ url });
        }),
      );
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

const HOST_URL = "/api/rooms/K7DX/sounds";
const slot = (id: string, v = "0123456789") => ({ id, name: `Slot ${id}`, ms: 1000, url: `${HOST_URL}/${id}?v=${v}` });
const hostList = (...sounds: ReturnType<typeof slot>[]) => ({ pack: "host", sounds });

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

  it("a getBytes that throws leaves only that sound silent", async () => {
    const free = freeBoard();
    const { board, state } = rig({ ready: true, throwBytes: [free[0]!.url] });
    await expect(board.load(["/p"])).resolves.toBeUndefined();
    await flush();
    expect(state.decodes).toBe(board.list().length - 1);
    expect(board.receive(free[0]!.id)).toBe(false);
    expect(board.receive(free[1]!.id)).toBe(true);
  });

  it("decodes one clip at a time", async () => {
    const held: (() => void)[] = [];
    const { board, state } = rig({ ready: true, held });
    await board.load(["/p"]);
    await flush();
    let done = 0;
    while (held.length) {
      held.shift()!();
      done++;
      await flush();
    }
    expect(done).toBe(board.list().length);
    expect(state.maxInFlight).toBe(1);
    expect(board.receive("memes:wow")).toBe(true);
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

  describe("host sounds", () => {
    it("host sounds come after the others", async () => {
      const { board, state } = rig();
      state.hostBody = hostList(slot("1"), slot("3"));
      await Promise.all([board.load(["/p"]), board.loadHost(HOST_URL)]);
      expect(board.list().map((s) => s.id)).toEqual([...freeIds(), "memes:bruh", "memes:wow", "host:1", "host:3"]);
    });

    it("host sounds stay last when loadHost resolves before the extra packs", async () => {
      const { board, state } = rig();
      state.hostBody = hostList(slot("1"), slot("3"));
      await board.loadHost(HOST_URL);
      expect(board.list().map((s) => s.id)).toEqual(["host:1", "host:3"]);
      await board.load(["/p"]);
      expect(board.list().map((s) => s.id)).toEqual([...freeIds(), "memes:bruh", "memes:wow", "host:1", "host:3"]);
    });

    it("loadHost tells listeners", async () => {
      const { board, state } = rig();
      let changes = 0;
      board.onChange(() => changes++);
      state.hostBody = hostList(slot("1"));
      await board.loadHost(HOST_URL);
      expect(changes).toBe(1);
    });

    it("loadHost again fetches only changed files and drops removed slots", async () => {
      const { board, state } = rig({ ready: true });
      state.hostBody = hostList(slot("1"), slot("3"));
      await board.loadHost(HOST_URL);
      await flush();
      expect(state.byteUrls).toEqual([slot("1").url, slot("3").url]);
      expect(board.receive("host:3")).toBe(true);
      state.byteUrls = [];
      state.played = [];
      state.hostBody = hostList(slot("1", "abcdef0123"));
      await board.loadHost(HOST_URL);
      await flush();
      expect(state.byteUrls).toEqual([slot("1", "abcdef0123").url]);
      expect(board.receive("host:3")).toBe(false);
      expect(board.list().map((s) => s.id)).toEqual(["host:1"]);
      expect(board.receive("host:1")).toBe(true);
      expect(state.played).toEqual([{ url: slot("1", "abcdef0123").url }]);
      expect(board.tap("host:3")).toBe("unknown");
    });

    it("a slot removed while its file waits for a context never plays", async () => {
      const { board, state, fireReady } = rig();
      state.hostBody = hostList(slot("1"), slot("3"));
      await board.loadHost(HOST_URL);
      state.hostBody = hostList(slot("1"));
      await board.loadHost(HOST_URL);
      await fireReady();
      expect(board.receive("host:3")).toBe(false);
      expect(board.receive("host:1")).toBe(true);
    });

    it("a slot removed while it decodes never plays", async () => {
      const { board, state } = rig({ ready: true });
      state.decodeHeld = [];
      state.hostBody = hostList(slot("3"));
      await board.loadHost(HOST_URL);
      state.hostBody = hostList();
      await board.loadHost(HOST_URL);
      for (const r of state.decodeHeld.splice(0)) r();
      await flush();
      expect(board.receive("host:3")).toBe(false);
    });

    it("the old clip plays until the new one is decoded", async () => {
      const { board, state } = rig({ ready: true });
      state.hostBody = hostList(slot("1"));
      await board.loadHost(HOST_URL);
      await flush();
      state.decodeHeld = [];
      state.hostBody = hostList(slot("1", "abcdef0123"));
      await board.loadHost(HOST_URL);
      await flush();
      expect(state.decodeHeld).toHaveLength(1);
      expect(board.receive("host:1")).toBe(true);
      expect(state.played.at(-1)).toEqual({ url: slot("1").url });
      state.decodeHeld.shift()!();
      await flush();
      expect(board.receive("host:1")).toBe(true);
      expect(state.played.at(-1)).toEqual({ url: slot("1", "abcdef0123").url });
    });

    it("a failed host list keeps the old one", async () => {
      const { board, state } = rig({ ready: true });
      state.hostBody = hostList(slot("1"), slot("3"));
      await board.loadHost(HOST_URL);
      await flush();
      state.hostFail = true;
      state.byteUrls = [];
      await expect(board.loadHost(HOST_URL)).resolves.toBeUndefined();
      expect(board.list().map((s) => s.id)).toEqual(["host:1", "host:3"]);
      expect(board.receive("host:1")).toBe(true);
      expect(state.byteUrls).toEqual([]);
    });

    it("no host list (a 404) clears the host sounds", async () => {
      const { board, state } = rig({ ready: true });
      state.hostBody = hostList(slot("1"));
      await board.loadHost(HOST_URL);
      await flush();
      state.hostBody = null;
      await board.loadHost(HOST_URL);
      expect(board.list()).toEqual([]);
      expect(board.receive("host:1")).toBe(false);
    });

    it("a failed file fetch keeps the old clip", async () => {
      const { board, state } = rig({ ready: true });
      state.hostBody = hostList(slot("1"));
      await board.loadHost(HOST_URL);
      await flush();
      const fresh = slot("1", "abcdef0123");
      state.failUrls.add(fresh.url);
      state.hostBody = hostList(fresh);
      await board.loadHost(HOST_URL);
      await flush();
      expect(board.receive("host:1")).toBe(true);
      expect(state.played.at(-1)).toEqual({ url: slot("1").url });
      state.byteUrls = [];
      state.failUrls.clear();
      await board.loadHost(HOST_URL);
      await flush();
      expect(state.byteUrls).toEqual([fresh.url]);
      expect(board.receive("host:1")).toBe(true);
      expect(state.played.at(-1)).toEqual({ url: fresh.url });
    });

    it("a new slot whose file fetch fails is skipped", async () => {
      const { board, state } = rig({ ready: true, throwBytes: [slot("4").url] });
      state.failUrls.add(slot("2").url);
      state.hostBody = hostList(slot("2"), slot("4"));
      await expect(board.loadHost(HOST_URL)).resolves.toBeUndefined();
      await flush();
      expect(board.list().map((s) => s.id)).toEqual(["host:2", "host:4"]);
      expect(board.receive("host:2")).toBe(false);
      expect(board.receive("host:4")).toBe(false);
    });

    it("calls while loading fold into one more", async () => {
      const { board, state } = rig();
      state.jsonHeld = [];
      state.hostBody = hostList(slot("1"));
      const first = board.loadHost(HOST_URL);
      await flush();
      const more = [board.loadHost(HOST_URL), board.loadHost(HOST_URL), board.loadHost(HOST_URL)];
      expect(more[1]).toBe(more[0]);
      expect(more[2]).toBe(more[0]);
      state.jsonHeld.shift()!();
      await first;
      await flush();
      expect(state.jsonGets).toBe(2);
      state.jsonHeld.shift()!();
      await Promise.all(more);
      expect(state.jsonGets).toBe(2);
      state.jsonHeld = null;
      await board.loadHost(HOST_URL);
      expect(state.jsonGets).toBe(3);
    });

    it("tap sends a host id", async () => {
      const { board, state } = rig();
      state.hostBody = hostList(slot("1"));
      await board.loadHost(HOST_URL);
      expect(board.tap("host:1")).toBe("sent");
      expect(state.sent).toEqual([{ type: "sound", id: "host:1" }]);
    });

    it("nothing happens after destroy", async () => {
      const { board, state } = rig({ ready: true });
      board.destroy();
      state.hostBody = hostList(slot("1"));
      await board.loadHost(HOST_URL);
      expect(state.jsonGets).toBe(0);
      expect(board.list()).toEqual([]);
    });
  });
});
