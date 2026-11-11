#!/usr/bin/env node
// `pnpm deploy`: ship party-games.chakri.me with Blind Rally and Treasure Hunt switched on.
//
//   pnpm deploy              (upload, build, deploy)
//   pnpm deploy -- --dry-run (prints the uploads, builds, `wrangler deploy --dry-run`)
//
// 1. Uploads both Godot exports (Blind Rally, then Treasure Hunt) to R2, each
//    as the godot-build.json beside it names. Goes first so the new worker
//    never names a hash the bucket doesn't have; a hash that's already there
//    is skipped.
// 2. Builds the web app with VITE_BLIND_RALLY=1 and VITE_TREASURE_HUNT=1 so
//    the lobby lists both games.
// 3. Drops dist/blind-rally/godot and dist/treasure-hunt/godot: Vite copied
//    them from public/, and each .wasm is over the 25 MiB asset limit. Both
//    are served from R2 by the worker (run_worker_first) instead.
// 4. `wrangler deploy --var BLIND_RALLY:1 --var TREASURE_HUNT:1`, so rooms
//    can pick either.
//
// Self-hosting (scripts/host.mjs) goes nowhere near this, so it keeps both off.
// The steps live in deploySteps() so a test can read them without running them.

import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WIN = process.platform === "win32";

/** The deploy as data, in order: `{ cmd, args, env? }` runs, `{ rm }` deletes. */
export function deploySteps(dryRun) {
  const dry = dryRun ? ["--dry-run"] : [];
  const dist = (...p) => join(ROOT, "apps", "web", "dist", ...p);
  return [
    { cmd: process.execPath, args: ["games/blind-rally/scripts/export-godot.mjs", "--upload", ...dry] },
    { cmd: process.execPath, args: ["games/treasure-hunt/scripts/export-godot.mjs", "--upload", ...dry] },
    { cmd: "pnpm", args: ["--filter", "@games/web", "build"], env: { VITE_BLIND_RALLY: "1", VITE_TREASURE_HUNT: "1" } },
    { rm: dist("blind-rally", "godot") },
    { rm: dist("treasure-hunt", "godot") },
    {
      cmd: "pnpm",
      args: ["--filter", "@games/server", "exec", "wrangler", "deploy", "--var", "BLIND_RALLY:1", "--var", "TREASURE_HUNT:1", ...dry],
    },
  ];
}

function isMain() {
  return process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}

function run(cmd, args, env = {}) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...env }, shell: WIN });
  if (r.status !== 0) {
    console.error(`\n${cmd} exited ${r.status}; nothing after it ran.`);
    process.exit(r.status ?? 1);
  }
}

if (isMain()) {
  for (const step of deploySteps(process.argv.includes("--dry-run"))) {
    if ("rm" in step) rmSync(step.rm, { recursive: true, force: true });
    else run(step.cmd, step.args, step.env);
  }
}
