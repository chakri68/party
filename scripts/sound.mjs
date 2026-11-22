#!/usr/bin/env node
// `pnpm sound`: add, list or remove a sound board clip.
//
//   pnpm sound add <file or link> --name "Air horn" [--pack free|memes]
//                  [--start 1.5] [--end 3] [--source ...] [--licence ...] [--local]
//   pnpm sound list [--pack free|memes]
//   pnpm sound remove <id> [--pack free|memes]
//
// free  goes into packages/sounds/free and sounds.json (in git, CC0 only).
// memes goes only to the R2 bucket (never into git). --local targets
// `wrangler dev`'s simulated bucket instead of the real one.
// Needs ffmpeg and ffprobe on PATH.
// The work lives in runSound(), which takes a SoundIO, so a test can fake it.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { MAX_SOUND_MS, checkEntries, soundId } from "../packages/sounds/check.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export const MAX_CUT_S = 2.95;
export const LOUDNESS = "loudnorm=I=-16:TP=-1.5:LRA=11";
export const MEMES_BUCKET = "party-games-memes";
export const MEMES_PREFIX = "memes/";

const SECONDS = "--start and --end are seconds, like 1.5.";
const AT_MOST = "A sound can be 3 seconds at most.";
const HELP = `Sound board clips.

  pnpm sound add <file or link> --name "Air horn" [--pack free|memes]
                 [--start 1.5] [--end 3] [--source ...] [--licence ...] [--local]
  pnpm sound list [--pack free|memes] [--local]
  pnpm sound remove <id> [--pack free|memes] [--local]

--pack free   goes into the repo (CC0 only, needs --licence).
--pack memes  goes only to the R2 bucket. --local uses wrangler dev's bucket.`;

function seconds(text) {
  if (text === undefined) return undefined;
  const n = Number(text);
  if (text.trim() === "" || !Number.isFinite(n) || n < 0) throw new Error(SECONDS);
  return n;
}

/** Turns the command line into a SoundCommand. Throws a plain message on bad input. */
export function parseSoundArgs(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      name: { type: "string" },
      pack: { type: "string" },
      start: { type: "string" },
      end: { type: "string" },
      source: { type: "string" },
      licence: { type: "string" },
      license: { type: "string" },
      local: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [cmd, arg] = positionals;
  if (values.help || cmd === undefined || cmd === "help") return { cmd: "help" };
  if (values.pack !== undefined && values.pack !== "free" && values.pack !== "memes") throw new Error("--pack is free or memes.");
  const pack = values.pack;
  const local = values.local;
  if (cmd === "add") {
    if (arg === undefined) throw new Error("add needs a file or a link.");
    if (values.name === undefined) throw new Error("add needs --name.");
    const out = { cmd: "add", input: arg, name: values.name, pack, start: seconds(values.start), end: seconds(values.end), source: values.source, licence: values.licence ?? values.license, local };
    for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
    return out;
  }
  if (cmd === "list") return pack === undefined ? { cmd: "list", local } : { cmd: "list", pack, local };
  if (cmd === "remove") {
    if (arg === undefined) throw new Error("remove needs a sound id.");
    return pack === undefined ? { cmd: "remove", id: arg, local } : { cmd: "remove", id: arg, pack, local };
  }
  throw new Error("Use add, list or remove.");
}

/** Where the clip starts and how long it runs. Never longer than MAX_CUT_S. */
export function cutWindow(start, end) {
  const from = start ?? 0;
  if (end === undefined) return { start: from, duration: MAX_CUT_S };
  if (end <= from) throw new Error("--end must be after --start.");
  if (end - from > 3) throw new Error(`That is ${(end - from).toFixed(1)} seconds. ${AT_MOST}`);
  return { start: from, duration: Math.min(end - from, MAX_CUT_S) };
}

export function ffmpegArgs(input, output, cut) {
  return [
    "-hide_banner", "-loglevel", "error", "-y",
    "-ss", String(cut.start), "-t", String(cut.duration), "-i", input,
    "-ac", "1", "-ar", "44100", "-af", LOUDNESS,
    "-c:a", "libmp3lame", "-b:a", "64k", output,
  ];
}

export function withEntry(list, entry) {
  if (list.some((e) => e.id === entry.id)) throw new Error(`There is already a sound called ${entry.id}.`);
  return [...list, entry];
}

export function withoutEntry(list, id) {
  if (!list.some((e) => e.id === id)) throw new Error(`There is no sound called ${id}.`);
  return list.filter((e) => e.id !== id);
}

const isUrl = (s) => /^https?:\/\//i.test(s);
const text = (bytes) => new TextDecoder().decode(bytes);
const json = (sounds) => JSON.stringify({ sounds }, null, 2) + "\n";

/** The list of one pack, from the repo (free) or from R2 (memes). */
function loadList(pack, io, cmd) {
  if (pack === "free") {
    const path = join(io.root, "packages", "sounds", "sounds.json");
    return io.exists(path) ? JSON.parse(text(io.readFile(path))).sounds : [];
  }
  const r = wrangler(io, cmd, ["r2", "object", "get", `${MEMES_BUCKET}/${MEMES_PREFIX}index.json`, "--pipe"]);
  if (r.status === 0) {
    try {
      return JSON.parse(r.stdout).sounds;
    } catch {
      throw new Error("The memes list in R2 is not valid JSON.");
    }
  }
  if (/specified key does not exist/i.test(r.stderr)) return [];
  throw new Error(`Could not read the memes list. ${r.stderr.trim()}`);
}

function wrangler(io, cmd, args) {
  return io.run("wrangler", [...args, cmd.local ? "--local" : "--remote"]);
}

function wranglerOrThrow(io, cmd, args) {
  const r = wrangler(io, cmd, args);
  if (r.status !== 0) throw new Error(`wrangler failed. ${r.stderr.trim()}`);
}

function putMemesList(io, cmd, sounds) {
  const file = join(io.tempDir(), "index.json");
  io.writeFile(file, json(sounds));
  wranglerOrThrow(io, cmd, ["r2", "object", "put", `${MEMES_BUCKET}/${MEMES_PREFIX}index.json`, "--file", file, "--content-type", "application/json"]);
}

async function add(cmd, io) {
  const pack = cmd.pack ?? (await io.askPack());
  const url = isUrl(cmd.input);
  const source = cmd.source ?? (url ? cmd.input : undefined);
  if (!source) throw new Error("A sound needs --source.");
  if (pack === "free" && !cmd.licence) throw new Error("A free sound needs --licence.");
  const id = soundId(cmd.name);
  if (id === "") throw new Error("Pick a name with letters or numbers.");
  if (io.run("ffmpeg", ["-version"]).status !== 0) {
    throw new Error("ffmpeg is not installed. Install it (it gives ffmpeg and ffprobe) and try again.");
  }
  const cut = cutWindow(cmd.start, cmd.end);
  const list = loadList(pack, io, cmd);
  withEntry(list, { id });
  const tmp = io.tempDir();
  let input = cmd.input;
  if (url) {
    input = join(tmp, "download");
    await io.download(cmd.input, input);
  } else if (!io.exists(input)) {
    throw new Error(`There is no file ${input}.`);
  }
  const out = join(tmp, `${id}.mp3`);
  const made = io.run("ffmpeg", ffmpegArgs(input, out, cut));
  if (made.status !== 0) throw new Error(`ffmpeg could not read that sound. ${made.stderr.trim()}`);
  const probe = io.run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]);
  const length = Number(probe.stdout.trim());
  if (probe.status !== 0 || !Number.isFinite(length) || length <= 0) throw new Error("Could not read the length of the sound.");
  const ms = Math.round(length * 1000);
  if (ms > MAX_SOUND_MS) throw new Error(`The sound is ${length.toFixed(1)} seconds. ${AT_MOST}`);
  const bytes = io.readFile(out);
  const entry = { id, name: cmd.name.trim(), file: `${id}.mp3`, ms, source };
  if (pack === "free") entry.licence = cmd.licence;
  else entry.v = createHash("sha256").update(bytes).digest("hex").slice(0, 10);
  const problems = checkEntries([entry], { pack });
  if (problems.length > 0) throw new Error(problems.join("\n"));
  const next = withEntry(list, entry);
  if (pack === "free") {
    io.writeFile(join(io.root, "packages", "sounds", "free", entry.file), bytes);
    io.writeFile(join(io.root, "packages", "sounds", "sounds.json"), json(next));
  } else {
    wranglerOrThrow(io, cmd, ["r2", "object", "put", `${MEMES_BUCKET}/${MEMES_PREFIX}${entry.file}`, "--file", out, "--content-type", "audio/mpeg"]);
    putMemesList(io, cmd, next);
  }
  io.log(`Added ${pack}:${id} (${(ms / 1000).toFixed(1)} seconds).`);
}

async function remove(cmd, io) {
  const pack = cmd.pack ?? (await io.askPack());
  const next = withoutEntry(loadList(pack, io, cmd), cmd.id);
  if (pack === "free") {
    io.writeFile(join(io.root, "packages", "sounds", "sounds.json"), json(next));
    io.remove(join(io.root, "packages", "sounds", "free", `${cmd.id}.mp3`));
  } else {
    putMemesList(io, cmd, next);
    wranglerOrThrow(io, cmd, ["r2", "object", "delete", `${MEMES_BUCKET}/${MEMES_PREFIX}${cmd.id}.mp3`]);
  }
  io.log(`Removed ${pack}:${cmd.id}.`);
}

function list(cmd, io) {
  const packs = cmd.pack ? [cmd.pack] : ["free", "memes"];
  for (const pack of packs) {
    for (const s of loadList(pack, io, cmd)) io.log(`${pack}  ${s.id}  ${s.name}  ${(s.ms / 1000).toFixed(1)}s`);
  }
}

export async function runSound(cmd, io) {
  if (cmd.cmd === "help") io.log(HELP);
  else if (cmd.cmd === "add") await add(cmd, io);
  else if (cmd.cmd === "remove") await remove(cmd, io);
  else list(cmd, io);
}

function realIO() {
  const serverDir = join(ROOT, "apps", "server");
  const wranglerJs = join(serverDir, "node_modules", "wrangler", "bin", "wrangler.js");
  return {
    root: ROOT,
    run(cmd, args, opts = {}) {
      const real = cmd === "wrangler";
      const r = real
        ? spawnSync(process.execPath, [wranglerJs, ...args], { cwd: serverDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
        : spawnSync(cmd, args, { cwd: opts.cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? (r.error ? String(r.error.message) : "") };
    },
    readFile: (path) => readFileSync(path),
    writeFile(path, data) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, data);
    },
    remove: (path) => rmSync(path, { force: true }),
    exists: (path) => existsSync(path),
    tempDir: () => mkdtempSync(join(tmpdir(), "sound-")),
    async download(url, to) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Could not download that link (${res.status}).`);
      writeFileSync(to, new Uint8Array(await res.arrayBuffer()));
    },
    async askPack() {
      if (!process.stdin.isTTY) throw new Error("Say --pack free or --pack memes.");
      const { select, isCancel } = await import("@clack/prompts");
      const answer = await select({
        message: "Which pack?",
        options: [
          { value: "free", label: "free: both sites, CC0 only" },
          { value: "memes", label: "memes: party-games only, kept in R2" },
        ],
      });
      if (isCancel(answer)) throw new Error("Stopped.");
      return answer;
    },
    log: (line) => console.log(line),
  };
}

function isMain() {
  return process.argv[1] !== undefined && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]));
}

if (isMain()) {
  try {
    const io = realIO();
    // One temp dir for the whole run.
    const dir = io.tempDir();
    io.tempDir = () => dir;
    try {
      await runSound(parseSoundArgs(process.argv.slice(2)), io);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
