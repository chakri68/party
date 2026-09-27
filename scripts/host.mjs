#!/usr/bin/env node
// Host Party Games from your own machine: build the app, run the worker
// locally (workerd, via `wrangler dev`, no Cloudflare account needed), and
// put a public tunnel in front of it. You get an owner link that can create
// rooms; friends get room links. Everything stops with Ctrl+C.
//
//   npx github:chakri68/party    (anywhere)
//   pnpm host                      (in a checkout)

import { cancel, intro, isCancel, log, note, outro, select, spinner } from "@clack/prompts";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, styleText } from "node:util";

const SOURCE = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO = "chakri68/party";
const WIN = process.platform === "win32";

const TUNNELS = {
  "localhost.run": { label: "localhost.run", hint: "free, uses ssh, nothing to install" },
  cloudflare: { label: "Cloudflare quick tunnel", hint: "free, downloads a small helper on first use" },
};

const HELP = `
Host Party Games on your own machine and share it with friends.

Usage: npx github:${REPO} [options]

Options:
  --tunnel <name>   localhost.run (default) or cloudflare
  --port <number>   local port for the server (default: any free one)
  --dir <path>      where to keep the app (default: ~/.party-games)
  -h, --help        this
`;

const bold = (s) => styleText("bold", s);
const dim = (s) => styleText("dim", s);
const lime = (s) => styleText("green", s);

let children = [];
let stopping = false;

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  shutdown(1);
});

async function main() {
  const { values: args } = parseArgs({
    options: {
      tunnel: { type: "string" },
      port: { type: "string" },
      dir: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (args.help) return console.log(HELP);

  console.log();
  intro(styleText(["bgGreen", "black"], " party games ") + dim("  host your own"));

  const [major, minor] = process.versions.node.split(".").map(Number);
  // Vite's floor: 20.19+ or 22.12+.
  if (!(major > 22 || (major === 22 && minor >= 12) || (major === 20 && minor >= 19))) {
    throw new Error(`Node.js ${process.versions.node} is too old. Get 22 or newer from https://nodejs.org and run this again.`);
  }

  let tunnel = args.tunnel;
  if (tunnel && !(tunnel in TUNNELS)) throw new Error(`Unknown tunnel "${tunnel}". Pick localhost.run or cloudflare.`);
  if (!tunnel && process.stdin.isTTY) {
    tunnel = await select({
      message: "How should friends reach you?",
      options: Object.entries(TUNNELS).map(([value, t]) => ({ value, ...t })),
    });
    if (isCancel(tunnel)) {
      cancel("Maybe next time.");
      process.exit(0);
    }
  }
  tunnel ??= "localhost.run";
  if (tunnel === "localhost.run" && !has("ssh", ["-V"])) {
    throw new Error("localhost.run needs ssh, which isn't installed. Try --tunnel cloudflare instead.");
  }

  const s = spinner();
  const app = await prepareSource(args.dir);

  s.start("Installing (the first run takes a minute or two)");
  const pnpm = pnpmCommand(app);
  await run(pnpm.cmd, [...pnpm.args, "install", ...(existsSync(join(app, "pnpm-lock.yaml")) ? ["--frozen-lockfile"] : [])], app);
  s.stop("Installed");

  s.start("Building the game");
  await run(pnpm.cmd, [...pnpm.args, "--filter", "@games/web", "build"], app, { VITE_SELF_HOSTED: "1" });
  s.stop("Built");

  s.start("Starting the server");
  const port = args.port ? Number(args.port) : await freePort();
  const ownerKey = randomBytes(18).toString("base64url");
  const server = startServer(app, port, ownerKey, tunnel === "cloudflare");
  await waitForServer(port, server);
  s.stop(`Server running on port ${port}`);

  s.start(tunnel === "cloudflare" ? "Opening a Cloudflare tunnel" : "Opening a localhost.run tunnel");
  let first = true;
  const onUrl = (url) => {
    if (first) {
      s.stop("Tunnel open");
      first = false;
      showLinks(url, ownerKey);
      openBrowser(`${url}/#owner=${ownerKey}`);
    } else {
      log.warn("The tunnel reconnected on a new address. Games in progress carry on, but everyone needs the new link.");
      showLinks(url, ownerKey);
    }
  };
  if (tunnel === "cloudflare") watchCloudflare(server, onUrl);
  else startLocalhostRun(port, onUrl);
}

/**
 * In a checkout, run in place. From npx, the source sits in npm's cache, so
 * mirror it somewhere stable: pnpm wants a real workspace, and keeping
 * node_modules between runs makes the second one quick.
 */
async function prepareSource(dir) {
  if (!SOURCE.split(/[\\/]/).includes("node_modules")) return SOURCE;
  const app = dir ?? join(homedir(), ".party-games");
  mkdirSync(app, { recursive: true });
  const keep = (name) => name === "node_modules" || name === ".wrangler" || name === "dist";
  // Drop anything the new source no longer has, so removed files don't linger.
  const prune = (target) => {
    for (const entry of readdirSync(target, { withFileTypes: true })) {
      if (keep(entry.name)) continue;
      const path = join(target, entry.name);
      const from = join(SOURCE, relative(app, path));
      if (!existsSync(from)) rmSync(path, { recursive: true, force: true });
      else if (entry.isDirectory()) prune(path);
    }
  };
  prune(app);
  cpSync(SOURCE, app, { recursive: true, filter: (src) => !src.slice(SOURCE.length).split(/[\\/]/).some((p) => p === "node_modules") });
  await fetchLockfile(app);
  return app;
}

/**
 * npm leaves pnpm-lock.yaml out of git installs, so fetch it for the exact
 * commit npx resolved (recorded in npx's own lockfile, two levels up).
 * Without it the install still works, just with whatever versions are newest.
 */
async function fetchLockfile(app) {
  try {
    const npxLock = JSON.parse(readFileSync(join(SOURCE, "..", "..", "package-lock.json"), "utf8"));
    const resolved = Object.values(npxLock.packages ?? {}).find((p) => p.resolved?.includes(REPO))?.resolved;
    const sha = resolved?.match(/#([0-9a-f]{40})$/)?.[1];
    if (!sha) return;
    const res = await fetch(`https://raw.githubusercontent.com/${REPO}/${sha}/pnpm-lock.yaml`);
    if (res.ok) writeFileSync(join(app, "pnpm-lock.yaml"), await res.text());
  } catch {
    // Unpinned install it is.
  }
}

/** pnpm if it's installed, else the version the repo pins, through npx. */
function pnpmCommand(app) {
  if (has("pnpm", ["--version"])) return { cmd: "pnpm", args: [] };
  const pinned = JSON.parse(readFileSync(join(app, "package.json"), "utf8")).packageManager ?? "pnpm@10";
  return { cmd: "npx", args: ["-y", pinned] };
}

/**
 * The deploy config minus the custom domain. With a route set, wrangler dev
 * rewrites every request's host to it, and room link previews would point at
 * party-games.chakri.me instead of the tunnel.
 */
function writeConfig(serverDir) {
  const source = readFileSync(join(serverDir, "wrangler.jsonc"), "utf8");
  const config = JSON.parse(source.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1"));
  delete config.$schema;
  delete config.routes;
  const path = join(serverDir, "wrangler.selfhost.json");
  writeFileSync(path, JSON.stringify(config, null, 2));
  return path;
}

function startServer(app, port, ownerKey, cloudflareTunnel) {
  const serverDir = join(app, "apps", "server");
  const logFile = join(serverDir, ".wrangler", "host.log");
  mkdirSync(dirname(logFile), { recursive: true });
  writeFileSync(logFile, "");
  // Node runs wrangler's own entry, which sidesteps .cmd shims on Windows.
  const child = track(
    spawn(
      process.execPath,
      [
        join(serverDir, "node_modules", "wrangler", "bin", "wrangler.js"),
        "dev",
        "--config", writeConfig(serverDir),
        "--ip", "127.0.0.1",
        "--port", String(port),
        "--var", `OWNER_KEY:${ownerKey}`,
        "--persist-to", join(serverDir, ".wrangler", "selfhost-state"),
        "--show-interactive-dev-session=false",
        ...(cloudflareTunnel ? ["--tunnel"] : []),
      ],
      { cwd: serverDir, env: { ...process.env, WRANGLER_SEND_METRICS: "false", FORCE_COLOR: "0" } },
    ),
  );
  child.logFile = logFile;
  child.output = "";
  const collect = (chunk) => {
    const text = chunk.toString();
    child.output += text;
    appendFileSync(logFile, text);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  child.on("exit", (code) => {
    if (stopping) return;
    log.error(`The server stopped (exit ${code}). Last lines:\n${tail(child.output)}\nFull log: ${logFile}`);
    shutdown(1);
  });
  return child;
}

async function waitForServer(port, server) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`The server didn't start:\n${tail(server.output)}`);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/`)).ok) return;
    } catch {
      // Not listening yet.
    }
    await sleep(500);
  }
  throw new Error(`The server took too long to start. Log: ${server.logFile}`);
}

/** wrangler runs the quick tunnel itself; we just spot the address in its output. */
function watchCloudflare(server, onUrl) {
  let seen = null;
  const check = () => {
    const url = server.output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g)?.at(-1);
    if (url && url !== seen) onUrl((seen = url));
  };
  server.stdout.on("data", check);
  server.stderr.on("data", check);
  setTimeout(() => {
    if (!seen) {
      log.error(`No tunnel after 2 minutes. Last lines:\n${tail(server.output)}`);
      shutdown(1);
    }
  }, 120_000);
}

/**
 * `ssh -R` to localhost.run, which answers with a JSON line per event. If the
 * connection drops, reconnect; the address may change, so the links are
 * shown again.
 */
function startLocalhostRun(port, onUrl, attempt = 0) {
  const child = track(
    spawn(
      "ssh",
      [
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "ServerAliveInterval=30",
        "-o", "ExitOnForwardFailure=yes",
        // Anonymous tunnel: don't offer keys, so a passphrase prompt can't stall it.
        "-o", "PubkeyAuthentication=no",
        "-R", `80:127.0.0.1:${port}`,
        "nokey@localhost.run",
        "--", "--output", "json",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
  let url = null;
  let buffered = "";
  let output = "";
  child.stdout.on("data", (chunk) => {
    buffered += chunk;
    const lines = buffered.split("\n");
    buffered = lines.pop();
    for (const line of lines) {
      output += line + "\n";
      if (!line.startsWith("{")) continue;
      try {
        const event = JSON.parse(line);
        if (event.event === "tcpip-forward" && event.address) {
          url = `https://${event.address}`;
          onUrl(url);
        }
      } catch {
        // Not one of ours.
      }
    }
  });
  child.stderr.on("data", (chunk) => (output += chunk));
  child.on("exit", () => {
    if (stopping) return;
    // Connected before: reset the count. Never connected: give up after a few tries.
    const next = url ? 0 : attempt + 1;
    if (next > 3) {
      log.error(`Couldn't reach localhost.run:\n${tail(output)}\nTry again with --tunnel cloudflare.`);
      return shutdown(1);
    }
    if (url) log.warn("Lost the tunnel. Reconnecting…");
    setTimeout(() => startLocalhostRun(port, onUrl, next), 2000);
  });
}

function showLinks(url, ownerKey) {
  note(
    [
      `${bold("Your host link")} ${dim("(keep this one to yourself)")}`,
      lime(`${url}/#owner=${ownerKey}`),
      "",
      `1. Open it ${dim("(it should have opened already)")} and hit ${bold("Create room")}.`,
      `2. Share the room link from inside the room. Friends just open it.`,
      "",
      dim(`No link handy? Friends can open ${url} and type the room code.`),
    ].join("\n"),
    "You're live",
  );
  log.message(dim("Leave this window open while you play. Ctrl+C stops everything."));
}

function openBrowser(url) {
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [url]] : WIN ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    // No browser here (a server, say). The link is on screen.
  }
}

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  if (code === 0) outro("Stopped. Thanks for hosting!");
  // Give children a beat to exit cleanly before we go.
  setTimeout(() => process.exit(code), 300);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

function track(child) {
  children.push(child);
  child.on("exit", () => (children = children.filter((c) => c !== child)));
  return child;
}

function run(cmd, args, cwd, env = {}) {
  return new Promise((resolve, reject) => {
    let output = "";
    const child = track(spawn(cmd, args, { cwd, shell: WIN, env: { ...process.env, ...env } }));
    child.stdout.on("data", (c) => (output += c));
    child.stderr.on("data", (c) => (output += c));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`\`${cmd} ${args.join(" ")}\` failed:\n${tail(output, 20)}`)),
    );
  });
}

function has(cmd, args) {
  return spawnSync(cmd, args, { stdio: "ignore", shell: WIN }).status === 0;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer().listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

function tail(text, lines = 12) {
  return text.trim().split("\n").filter((l) => !l.startsWith("Progress:")).slice(-lines).join("\n");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
