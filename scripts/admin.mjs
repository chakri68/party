#!/usr/bin/env node
// `pnpm admin`: hand out free Host Pass from the terminal.
//
//   pnpm admin grant <email> [--days N | --forever]
//   pnpm admin revoke-grants <email>
//   pnpm admin code new [--uses N] [--days N | --forever] [--note text] [--prefix FAM]
//   pnpm admin code list
//   pnpm admin code revoke <code>
//
// --url <base> (default https://couchpartygames.com), --local (http://127.0.0.1:8788).
// The key comes from COUCHPARTY_ADMIN_KEY. parseArgs is pure so a test can read it.

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROD = "https://couchpartygames.com";
const LOCAL = "http://127.0.0.1:8788";

export const USAGE = `Usage:
  pnpm admin grant <email> [--days N | --forever]
  pnpm admin revoke-grants <email>
  pnpm admin code new [--uses N] [--days N | --forever] [--note text] [--prefix FAM]
  pnpm admin code list
  pnpm admin code revoke <code>
Options: --url <base>, --local, --help. Key: COUCHPARTY_ADMIN_KEY.`;

const VALUE_FLAGS = new Set(["--url", "--days", "--uses", "--note", "--prefix"]);

function positiveInt(name, v) {
  if (!/^\d+$/.test(v ?? "") || Number(v) < 1) throw new Error(`--${name} needs a whole number above 0.`);
  return Number(v);
}

/** Returns `{ help: true }` or `{ url, request: { method, path, body? } }`. Throws on bad input. */
export function parseArgs(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE_FLAGS.has(a)) {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value.`);
      flags[a.slice(2)] = argv[++i];
    } else if (a === "--forever" || a === "--local" || a === "--help" || a === "-h") {
      flags[a === "-h" ? "help" : a.slice(2)] = true;
    } else if (a.startsWith("--")) {
      throw new Error(`Unknown option ${a}.`);
    } else pos.push(a);
  }
  if (flags.help || pos.length === 0) return { help: true };

  const url = (flags.url ?? (flags.local ? LOCAL : PROD)).replace(/\/+$/, "");
  if (flags.forever && flags.days !== undefined) throw new Error("Use --days or --forever, not both.");
  const days = () => (flags.forever ? null : flags.days === undefined ? 30 : positiveInt("days", flags.days));
  const need = (i, what) => {
    if (!pos[i]) throw new Error(`Missing ${what}.`);
    return pos[i];
  };

  const [cmd, sub] = pos;
  if (cmd === "grant") {
    return { url, request: { method: "POST", path: "/api/admin/grant", body: { email: need(1, "email"), days: days() } } };
  }
  if (cmd === "revoke-grants") {
    return { url, request: { method: "POST", path: "/api/admin/revoke-grants", body: { email: need(1, "email") } } };
  }
  if (cmd === "code" && sub === "new") {
    const body = { maxUses: flags.uses === undefined ? 1 : positiveInt("uses", flags.uses), days: days() };
    if (flags.note !== undefined) body.note = flags.note;
    if (flags.prefix !== undefined) body.prefix = flags.prefix;
    return { url, request: { method: "POST", path: "/api/admin/codes", body } };
  }
  if (cmd === "code" && sub === "list") return { url, request: { method: "GET", path: "/api/admin/codes" } };
  if (cmd === "code" && sub === "revoke") {
    return { url, request: { method: "POST", path: `/api/admin/codes/${encodeURIComponent(need(2, "code"))}/revoke` } };
  }
  throw new Error(`Unknown command: ${pos.join(" ")}.`);
}

function isMain() {
  return process.argv[1] !== undefined && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]));
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (e) {
    fail(`${e.message}\n\n${USAGE}`);
  }
  if (parsed.help) return console.log(USAGE);
  const key = process.env.COUCHPARTY_ADMIN_KEY;
  if (!key) fail("Set COUCHPARTY_ADMIN_KEY first.");

  const { url, request } = parsed;
  let res;
  try {
    res = await fetch(url + request.path, {
      method: request.method,
      headers: { authorization: `Bearer ${key}`, ...(request.body ? { "content-type": "application/json" } : {}) },
      body: request.body ? JSON.stringify(request.body) : undefined,
    });
  } catch (e) {
    fail(`Could not reach ${url}: ${e.message}`);
  }
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) fail(`${res.status} ${data?.error ?? text}`);

  if (Array.isArray(data)) {
    if (data.length === 0) console.log("No codes.");
    for (const c of data) {
      const span = c.days === null ? "forever" : `${c.days}d`;
      console.log(`${c.code}  ${c.uses}/${c.maxUses} used  ${span}${c.revoked ? "  revoked" : ""}${c.note ? `  ${c.note}` : ""}`);
    }
  } else if (data?.code) console.log(data.code);
  else console.log("ok");
}

if (isMain()) await main();
