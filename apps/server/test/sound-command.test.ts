import { describe, expect, it } from "vitest";
import {
  LOUDNESS,
  cutWindow,
  ffmpegArgs,
  parseSoundArgs,
  runSound,
  withEntry,
  withoutEntry,
  type Pack,
  type SoundCommand,
  type SoundIO,
} from "../../../scripts/sound.mjs";

type Call = { cmd: string; args: string[] };

function fake(opts: { probe?: string; ffmpegStatus?: number | null; getStderr?: string; getStdout?: string; getStatus?: number; files?: Record<string, string>; pack?: Pack } = {}) {
  const calls: Call[] = [];
  const writes: { path: string; data: string | Uint8Array }[] = [];
  const removed: string[] = [];
  const files = new Map(Object.entries(opts.files ?? {}));
  let asked = 0;
  const io: SoundIO = {
    root: "/repo",
    run(cmd, args) {
      calls.push({ cmd, args });
      if (cmd === "ffmpeg" && args[0] === "-version") return { status: opts.ffmpegStatus === undefined ? 0 : opts.ffmpegStatus, stdout: "", stderr: "" };
      if (cmd === "ffprobe") return { status: 0, stdout: opts.probe ?? "1.2\n", stderr: "" };
      if (cmd === "wrangler" && args[2] === "get") {
        return { status: opts.getStatus ?? 1, stdout: opts.getStdout ?? "", stderr: opts.getStderr ?? "The specified key does not exist." };
      }
      return { status: 0, stdout: "", stderr: "" };
    },
    readFile: (path) => {
      if (path.endsWith(".mp3")) return new Uint8Array([1, 2, 3, 4]);
      const text = files.get(path);
      if (text === undefined) throw new Error(`no file ${path}`);
      return new TextEncoder().encode(text);
    },
    writeFile: (path, data) => void writes.push({ path, data }),
    remove: (path) => void removed.push(path),
    exists: (path) => files.has(path) || path === "a.wav",
    tempDir: () => "/tmp/s",
    download: async () => {},
    askPack: async () => {
      asked++;
      return opts.pack ?? "free";
    },
    log: () => {},
  };
  return { io, calls, writes, removed, asked: () => asked };
}

const wr = (calls: Call[]) => calls.filter((c) => c.cmd === "wrangler").map((c) => c.args.join(" "));
const add = (over: Partial<Extract<SoundCommand, { cmd: "add" }>> = {}): SoundCommand => ({
  cmd: "add",
  input: "a.wav",
  name: "Rise",
  pack: "free",
  source: "x",
  licence: "CC0",
  local: false,
  ...over,
});
const LIST = "/repo/packages/sounds/sounds.json";

describe("parseSoundArgs", () => {
  it("parses add with every flag", () => {
    expect(
      parseSoundArgs(["add", "a.wav", "--name", "Rise", "--pack", "free", "--start", "0.5", "--end", "2", "--source", "x", "--licence", "CC0", "--local"]),
    ).toEqual({ cmd: "add", input: "a.wav", name: "Rise", pack: "free", start: 0.5, end: 2, source: "x", licence: "CC0", local: true });
  });

  it("gives help with no args or -h", () => {
    expect(parseSoundArgs([])).toEqual({ cmd: "help" });
    expect(parseSoundArgs(["-h"])).toEqual({ cmd: "help" });
  });

  it("refuses bad args", () => {
    expect(() => parseSoundArgs(["add", "--name", "x"])).toThrow("add needs a file or a link.");
    expect(() => parseSoundArgs(["add", "a.wav"])).toThrow("add needs --name.");
    expect(() => parseSoundArgs(["add", "a.wav", "--name", "x", "--pack", "wav"])).toThrow("--pack is free or memes.");
    expect(() => parseSoundArgs(["add", "a.wav", "--name", "x", "--start", "abc"])).toThrow("--start and --end are seconds, like 1.5.");
    expect(() => parseSoundArgs(["remove"])).toThrow("remove needs a sound id.");
  });
});

describe("cutWindow", () => {
  it("caps and checks", () => {
    expect(cutWindow()).toEqual({ start: 0, duration: 2.95 });
    expect(cutWindow(1, 2.5)).toEqual({ start: 1, duration: 1.5 });
    expect(cutWindow(1, 4)).toEqual({ start: 1, duration: 2.95 });
    expect(() => cutWindow(1, 5)).toThrow("That is 4.0 seconds. A sound can be 3 seconds at most.");
    expect(() => cutWindow(2, 2)).toThrow("--end must be after --start.");
  });
});

describe("ffmpegArgs", () => {
  it("makes mono, loudness-evened 64k mp3", () => {
    const args = ffmpegArgs("in.wav", "out.mp3", cutWindow());
    const at = (a: string, b: string) => {
      const i = args.indexOf(a);
      expect(i).toBeGreaterThan(-1);
      expect(args[i + 1]).toBe(b);
      return i;
    };
    const order = [at("-t", "2.95"), at("-ac", "1"), at("-af", LOUDNESS), at("-b:a", "64k")];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(args.at(-1)).toBe("out.mp3");
  });
});

describe("withEntry and withoutEntry", () => {
  it("refuse and do not change the list", () => {
    const list = [{ id: "a" }, { id: "b" }];
    expect(() => withEntry(list, { id: "a" })).toThrow("There is already a sound called a.");
    expect(() => withoutEntry(list, "z")).toThrow("There is no sound called z.");
    expect(withEntry(list, { id: "c" })).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect(withoutEntry(list, "a")).toEqual([{ id: "b" }]);
    expect(list).toEqual([{ id: "a" }, { id: "b" }]);
  });
});

describe("runSound add, free", () => {
  it("writes the file and the list, and never calls wrangler", async () => {
    const f = fake({ files: { [LIST]: '{ "sounds": [] }' } });
    await runSound(add(), f.io);
    expect(f.writes.map((w) => w.path)).toEqual(["/repo/packages/sounds/free/rise.mp3", LIST]);
    const json = JSON.parse(String(f.writes[1]!.data));
    expect(json.sounds).toEqual([{ id: "rise", name: "Rise", file: "rise.mp3", ms: 1200, source: "x", licence: "CC0" }]);
    expect(String(f.writes[1]!.data).endsWith("}\n")).toBe(true);
    expect(f.calls.some((c) => c.cmd === "wrangler")).toBe(false);
  });

  it("needs a licence", async () => {
    const f = fake({ files: { [LIST]: '{ "sounds": [] }' } });
    await expect(runSound(add({ licence: undefined }), f.io)).rejects.toThrow("A free sound needs --licence.");
    expect(f.calls).toEqual([]);
  });

  it("refuses a result over 3 seconds", async () => {
    const f = fake({ probe: "3.2\n", files: { [LIST]: '{ "sounds": [] }' } });
    await expect(runSound(add(), f.io)).rejects.toThrow("The sound is 3.2 seconds. A sound can be 3 seconds at most.");
    expect(f.writes).toEqual([]);
  });

  it("says when ffmpeg is missing", async () => {
    const f = fake({ ffmpegStatus: null, files: { [LIST]: '{ "sounds": [] }' } });
    await expect(runSound(add(), f.io)).rejects.toThrow(
      "ffmpeg is not installed. Install it (it gives ffmpeg and ffprobe) and try again.",
    );
  });

  it("asks for the pack when --pack is missing", async () => {
    const f = fake({ pack: "free", files: { [LIST]: '{ "sounds": [] }' } });
    await runSound(add({ pack: undefined }), f.io);
    expect(f.asked()).toBe(1);
    expect(f.writes[0]!.path).toBe("/repo/packages/sounds/free/rise.mp3");
  });
});

describe("runSound memes", () => {
  const meme = () => add({ pack: "memes", name: "Bruh", licence: undefined });

  it("uploads and writes nothing in the repo", async () => {
    const f = fake();
    await runSound(meme(), f.io);
    const w = wr(f.calls);
    expect(w).toHaveLength(3);
    expect(w[0]).toBe("r2 object get party-games-memes/memes/index.json --pipe --remote");
    expect(w[1]).toBe("r2 object put party-games-memes/memes/bruh.mp3 --file /tmp/s/bruh.mp3 --content-type audio/mpeg --remote");
    expect(w[2]).toBe("r2 object put party-games-memes/memes/index.json --file /tmp/s/index.json --content-type application/json --remote");
    for (const x of f.writes) expect(x.path.startsWith("/repo")).toBe(false);
    const index = JSON.parse(String(f.writes.find((x) => x.path === "/tmp/s/index.json")!.data));
    expect(index.sounds).toHaveLength(1);
    expect(index.sounds[0].v).toMatch(/^[0-9a-f]{10}$/);
    expect(index.sounds[0].id).toBe("bruh");
  });

  it("uses --local with --local", async () => {
    const f = fake();
    await runSound({ ...meme(), local: true } as SoundCommand, f.io);
    const w = wr(f.calls);
    expect(w.some((x) => x.includes("--remote"))).toBe(false);
    expect(w.every((x) => x.endsWith("--local"))).toBe(true);
  });

  it("stops on a wrangler error that is not 'missing'", async () => {
    const f = fake({ getStderr: "Authentication error" });
    await expect(runSound(meme(), f.io)).rejects.toThrow();
    expect(wr(f.calls).some((x) => x.includes(" put "))).toBe(false);
  });

  it("removes by writing the index first, then deleting the file", async () => {
    const idx = JSON.stringify({ sounds: [{ id: "bruh", name: "Bruh", file: "bruh.mp3", ms: 1200, source: "x", v: "0123456789" }] });
    const f = fake({ getStatus: 0, getStdout: idx });
    await runSound({ cmd: "remove", id: "bruh", pack: "memes", local: false }, f.io);
    const w = wr(f.calls);
    expect(w[0]).toContain("get");
    expect(w[1]).toBe("r2 object put party-games-memes/memes/index.json --file /tmp/s/index.json --content-type application/json --remote");
    expect(w[2]).toBe("r2 object delete party-games-memes/memes/bruh.mp3 --remote");
    expect(JSON.parse(String(f.writes[0]!.data)).sounds).toEqual([]);
  });
});
