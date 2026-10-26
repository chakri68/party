#!/usr/bin/env node
// `pnpm deploy`: ship party-games.chakri.me with Blind Rally switched on.
//
//   pnpm deploy              (upload, build, deploy)
//   pnpm deploy -- --dry-run (prints the uploads, builds, `wrangler deploy --dry-run`)
//
// 1. Uploads the Godot export godot-build.json names to R2 (map D2). Goes first
//    so the new worker never names a hash the bucket doesn't have; a hash
//    that's already there is skipped.
// 2. Builds the web app with VITE_BLIND_RALLY=1 so the lobby lists the game.
// 3. Drops dist/blind-rally/godot: Vite copied it from public/, the .wasm is
//    over the 25 MiB asset limit, and the worker serves that path from R2
//    anyway (run_worker_first).
// 4. `wrangler deploy --var BLIND_RALLY:1`, so rooms can pick it.
//
// Self-hosting (scripts/host.mjs) goes nowhere near this, so it keeps both off.

import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const dryRun = process.argv.includes("--dry-run");
const WIN = process.platform === "win32";

function run(cmd, args, env = {}) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...env }, shell: WIN });
  if (r.status !== 0) {
    console.error(`\n${cmd} exited ${r.status}; nothing after it ran.`);
    process.exit(r.status ?? 1);
  }
}

run(process.execPath, ["games/blind-rally/scripts/export-godot.mjs", "--upload", ...(dryRun ? ["--dry-run"] : [])]);
run("pnpm", ["--filter", "@games/web", "build"], { VITE_BLIND_RALLY: "1" });
rmSync(join(ROOT, "apps", "web", "dist", "blind-rally", "godot"), { recursive: true, force: true });
run("pnpm", ["--filter", "@games/server", "exec", "wrangler", "deploy", "--var", "BLIND_RALLY:1", ...(dryRun ? ["--dry-run"] : [])]);
