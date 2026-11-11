#!/usr/bin/env node
// `pnpm deploy:product`: ship couchpartygames.com (apps/product-server + apps/product-web).
//
//   pnpm deploy:product              (upload, build, migrate, deploy)
//   pnpm deploy:product -- --dry-run (prints the uploads, skips the D1 migration, runs
//                                     `wrangler deploy --dry-run`; the web build and the
//                                     dist cleanup still happen for real)
//
// Setup (D1, R2, secrets, DNS) is by hand, once: docs/couchparty.md.
//
// 1. Uploads both Godot exports to the couchparty-godot bucket. First, so the
//    new worker never names a hash the bucket doesn't have; a hash that's
//    already there is skipped.
// 2. Builds product-web with both lobby flags. Set VITE_CF_BEACON in the shell
//    to bake in the Web Analytics token; it passes through.
// 3. Drops dist/*/godot: Vite copied them from public/, and each .wasm is over
//    the 25 MiB asset limit. The worker serves them from R2 instead.
// 4. Applies D1 migrations, before the worker that needs them goes live.
// 5. `wrangler deploy`. The flags live in wrangler.jsonc, and DEV_TOOLS stays
//    "0" there: with it on, a missing Resend key logs magic links instead of
//    failing, so nothing here ever sets it.
//
// The personal site (party-games.chakri.me, `pnpm deploy`) is a separate worker
// and goes nowhere near this. The steps live in deploySteps() so a test can
// read them without running them.

import { spawnSync } from "node:child_process";
import { realpathSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WIN = process.platform === "win32";
const BUCKET = "couchparty-godot";

/** The deploy as data, in order: `{ cmd, args, env? }` runs, `{ rm }` deletes, `{ say }` prints. */
export function deploySteps(dryRun) {
  const dry = dryRun ? ["--dry-run"] : [];
  const dist = (...p) => join(ROOT, "apps", "product-web", "dist", ...p);
  const wrangler = (...a) => ["--filter", "@games/product-server", "exec", "wrangler", ...a];
  return [
    { cmd: process.execPath, args: ["games/blind-rally/scripts/export-godot.mjs", "--upload", "--bucket", BUCKET, ...dry] },
    { cmd: process.execPath, args: ["games/treasure-hunt/scripts/export-godot.mjs", "--upload", "--bucket", BUCKET, ...dry] },
    { cmd: "pnpm", args: ["--filter", "@games/product-web", "build"], env: { VITE_BLIND_RALLY: "1", VITE_TREASURE_HUNT: "1" } },
    { rm: dist("blind-rally", "godot") },
    { rm: dist("treasure-hunt", "godot") },
    // `migrations apply` has no dry-run mode, so a dry run skips it rather than touch the live DB.
    dryRun
      ? { say: "[dry run] skipping: wrangler d1 migrations apply couchparty --remote" }
      : { cmd: "pnpm", args: wrangler("d1", "migrations", "apply", "couchparty", "--remote") },
    { cmd: "pnpm", args: wrangler("deploy", ...dry) },
  ];
}

// realpath on both sides: run through a symlinked path, argv[1] isn't the real
// file, and a plain compare would skip the deploy and exit 0 in silence.
function isMain() {
  return process.argv[1] !== undefined && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]));
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
    else if ("say" in step) console.log(`\n${step.say}`);
    else run(step.cmd, step.args, step.env);
  }
}
