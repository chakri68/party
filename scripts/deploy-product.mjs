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
// 0. Checks the Worker has the secrets it can't run without (`wrangler secret
//    list`; the billing four only when wrangler.jsonc has BILLING "1"). A missing one stops the deploy before anything ships; on a dry run
//    it only warns. Then, with BILLING "1", checks the public billing vars are
//    live ones (Paddle "production", live_ token, no rzp_test_ key, no <...>
//    placeholders). Same rule: stop for real, warn on a dry run.
// 1. Uploads both Godot exports to the couchparty-godot bucket. First, so the
//    new worker never names a hash the bucket doesn't have; a hash that's
//    already there is skipped.
// 2. Builds product-web with both lobby flags. The Web Analytics token comes
//    from apps/product-web/.env.production; VITE_CF_BEACON in the shell wins.
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
import { readFileSync, realpathSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WIN = process.platform === "win32";
const BUCKET = "couchparty-godot";

/**
 * Secrets the live Worker needs. Without IP_HASH_KEY every room create
 * throws; without the rest sign-in or admin is dead. GOOGLE_CLIENT_SECRET
 * isn't here: Google sign-in is optional and hides itself without a client id.
 */
export const REQUIRED_SECRETS = ["IP_HASH_KEY", "ADMIN_KEY", "TURNSTILE_SECRET", "RESEND_API_KEY"];

/** Needed once BILLING is "1" in wrangler.jsonc: checkout and webhooks can't verify without them. */
export const BILLING_SECRETS = ["RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "PADDLE_API_KEY", "PADDLE_WEBHOOK_SECRET"];

// wrangler.jsonc has comments and trailing commas. Walk it once, skipping string
// bodies, so a "//" inside a URL string survives.
function parseJsonc(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2);
      i = i < 0 ? text.length : i + 1;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/** `REQUIRED_SECRETS`, plus `BILLING_SECRETS` when the config's vars turn billing on. */
export function requiredSecrets(wranglerJsoncText) {
  const on = parseJsonc(wranglerJsoncText).vars?.BILLING === "1";
  return on ? [...REQUIRED_SECRETS, ...BILLING_SECRETS] : [...REQUIRED_SECRETS];
}

/** The public billing vars in wrangler.jsonc. Each one must be a real value before billing goes live. */
export const BILLING_VARS = ["RAZORPAY_KEY_ID", "PADDLE_ENV", "PADDLE_CLIENT_TOKEN", "PADDLE_PRICE_MONTH", "PADDLE_PRICE_YEAR"];

/**
 * Why this config must not go live, one line per problem; empty when it may.
 * Only checked with BILLING "1". A sandbox Paddle env or a test key would take
 * real people to a checkout that never charges, so they never get a pass.
 */
export function billingProblems(wranglerJsoncText) {
  const vars = parseJsonc(wranglerJsoncText).vars ?? {};
  if (vars.BILLING !== "1") return [];
  const problems = [];
  const bad = new Set();
  for (const name of BILLING_VARS) {
    const v = vars[name];
    if (typeof v !== "string" || !v.trim() || /^<.*>$/.test(v.trim())) {
      problems.push(`${name} is not set (it is ${v === undefined ? "missing" : JSON.stringify(v)}).`);
      bad.add(name);
    }
  }
  if (!bad.has("PADDLE_ENV") && vars.PADDLE_ENV !== "production") {
    problems.push(`PADDLE_ENV is ${JSON.stringify(vars.PADDLE_ENV)}. It must be "production".`);
  }
  if (!bad.has("PADDLE_CLIENT_TOKEN") && !vars.PADDLE_CLIENT_TOKEN.startsWith("live_")) {
    problems.push("PADDLE_CLIENT_TOKEN is not a live token. It must start with live_.");
  }
  if (!bad.has("RAZORPAY_KEY_ID") && vars.RAZORPAY_KEY_ID.startsWith("rzp_test_")) {
    problems.push("RAZORPAY_KEY_ID is a test key. Use the live key id (rzp_live_...).");
  }
  return problems;
}

/** Which of `required` aren't in `wrangler secret list --format json` output. */
export function missingSecrets(listOutput, required) {
  const start = listOutput.indexOf("[");
  let names = [];
  try {
    names = JSON.parse(start < 0 ? "[]" : listOutput.slice(start)).map((x) => x.name);
  } catch {
    return [...required];
  }
  return required.filter((n) => !names.includes(n));
}

/**
 * The deploy as data, in order: `{ cmd, args, env? }` runs, `{ rm }` deletes, `{ say }` prints,
 * `{ secrets }` checks the secrets, `{ billing }` holds the billing var problems found.
 */
export function deploySteps(dryRun) {
  const dry = dryRun ? ["--dry-run"] : [];
  const dist = (...p) => join(ROOT, "apps", "product-web", "dist", ...p);
  const wrangler = (...a) => ["--filter", "@games/product-server", "exec", "wrangler", ...a];
  const config = readFileSync(join(ROOT, "apps", "product-server", "wrangler.jsonc"), "utf8");
  return [
    { secrets: requiredSecrets(config), dryRun },
    { billing: billingProblems(config), dryRun },
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

function checkSecrets(required, dryRun) {
  const args = ["--filter", "@games/product-server", "exec", "wrangler", "secret", "list", "--format", "json"];
  console.log(`\n$ pnpm ${args.join(" ")}`);
  const r = spawnSync("pnpm", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], shell: WIN });
  const missing = r.status === 0 ? missingSecrets(r.stdout, required) : [...required];
  if (!missing.length) return console.log("All secrets are set.");
  const msg = r.status === 0
    ? `Missing secrets: ${missing.join(", ")}. Set each with: pnpm --filter @games/product-server exec wrangler secret put <NAME> (docs/couchparty.md).`
    : "Could not list the Worker's secrets (not logged in, or the Worker doesn't exist yet).";
  if (dryRun) return console.warn(`\n[dry run] ${msg}`);
  console.error(`\n${msg}\nNothing was deployed.`);
  process.exit(1);
}

function checkBilling(problems, dryRun) {
  if (!problems.length) return;
  const msg = `BILLING is "1" but wrangler.jsonc is not ready to take real money:\n${problems.map((p) => `  - ${p}`).join("\n")}\nFix the vars (docs/couchparty.md, Billing, going live).`;
  if (dryRun) return console.warn(`\n[dry run] ${msg}`);
  console.error(`\n${msg}\nNothing was deployed.`);
  process.exit(1);
}

if (isMain()) {
  for (const step of deploySteps(process.argv.includes("--dry-run"))) {
    if ("secrets" in step) checkSecrets(step.secrets, step.dryRun);
    else if ("billing" in step) checkBilling(step.billing, step.dryRun);
    else if ("rm" in step) rmSync(step.rm, { recursive: true, force: true });
    else if ("say" in step) console.log(`\n${step.say}`);
    else run(step.cmd, step.args, step.env);
  }
}
