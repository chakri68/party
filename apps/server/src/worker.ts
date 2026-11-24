import { secureRandomInt } from "@games/game-core";
import { isValidRoomCode } from "@games/protocol";
import { getServerByName, routePartykitRequest, Server, type Connection } from "partyserver";
import { generateRoomCode } from "./codes.ts";
import { serveGodot } from "./godot.ts";
import { gamesFor } from "./games.ts";
import { serveMySounds } from "./host-sounds.ts";
import { servePacks, soundPacksFor } from "./packs.ts";
import { isOwnerKey, json, type HostPolicy, type ServerEnv } from "./policy.ts";
import { turnMinter } from "./turn.ts";
import { RoomRuntime, type Conn, type ConnState, type RoomGrant, type RoomHost, type RoomSetup, type TierLimits } from "./runtime.ts";
import type { AnyGameDefinition } from "@games/game-core";

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18)); // 144 bits
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_");
}

function wrap(conn: Connection<ConnState>): Conn {
  return {
    id: conn.id,
    get state() {
      return conn.state;
    },
    setState: (s) => void conn.setState(s),
    send: (msg) => {
      try {
        conn.send(JSON.stringify(msg));
      } catch {
        // Socket already closing; its onClose will tidy up.
      }
    },
    close: (code, reason) => {
      try {
        conn.close(code, reason);
      } catch {
        // Already closed.
      }
    },
  };
}

// Server<Env> is the only global-Env use: partyserver constrains on Cloudflare.Env. Everything else reads ServerEnv.
/** One Durable Object per room, addressed by room code. */
export class RoomBase extends Server<Env> {
  static options = { hibernate: true };

  /** The games this deploy offers. Override to change the set. */
  protected games(): Record<string, AnyGameDefinition> {
    const env = this.env as ServerEnv;
    return gamesFor({ blindRally: env.BLIND_RALLY === "1", treasureHunt: env.TREASURE_HUNT === "1" });
  }

  /** Seat cap and premium games for free rooms. None by default: every room is unrestricted. */
  protected tierLimits(): TierLimits | undefined {
    return undefined;
  }

  /** Chat/name filter. None by default. */
  protected filterText(): ((s: string) => string) | undefined {
    return undefined;
  }

  #runtime: RoomRuntime | null = null;

  private get runtime(): RoomRuntime {
    if (!this.#runtime) {
      const storage = this.ctx.storage;
      const turnCredentials = turnMinter(this.env as ServerEnv);
      const host: RoomHost = {
        storage: {
          get: (key) => storage.get(key),
          put: (key, value) => storage.put(key, value),
          deleteAll: () => storage.deleteAll(),
          setAlarm: (at) => storage.setAlarm(at),
          deleteAlarm: () => storage.deleteAlarm(),
        },
        connections: () => [...this.getConnections<ConnState>()].map(wrap),
        now: () => Date.now(),
        randomInt: secureRandomInt,
        randomToken,
        devTools: (this.env as ServerEnv).DEV_TOOLS === "1",
        logError: (err) => console.error(`room ${this.name}:`, err),
        isOwnerKey: (key) => isOwnerKey(this.env as ServerEnv, key),
        ownerRequired: true,
        tierLimits: this.tierLimits(),
        filterText: this.filterText(),
        soundPacks: soundPacksFor(this.env as ServerEnv),
        ...(turnCredentials && { turnCredentials }),
      };
      this.#runtime = new RoomRuntime(this.name, host, this.games(), "sevens");
    }
    return this.#runtime;
  }

  async onStart() {
    await this.runtime.load();
  }

  /** RPC from the worker's create-room endpoint (§10). */
  async claim(grant?: RoomGrant, setup?: RoomSetup): Promise<boolean> {
    return this.runtime.claim(grant, setup);
  }

  /** RPC: lift a free room to pass. Only the room's host key may. Without a sounds bucket, the library is dropped. */
  async upgrade(hostKey: string, library?: string | null): Promise<boolean> {
    if (!this.runtime.hostKeyMatches(hostKey)) return false;
    const soundsBound = !!(this.env as ServerEnv).SOUNDS;
    await this.runtime.upgrade(soundsBound ? library : null);
    return true;
  }

  /** RPC: the room's sound library id, or null. getServerByName awaits onStart, so the room is loaded. */
  async library(): Promise<string | null> {
    return this.runtime.library();
  }

  onConnect(conn: Connection<ConnState>) {
    return this.runtime.onConnect(wrap(conn));
  }

  onMessage(conn: Connection<ConnState>, message: string | ArrayBuffer | ArrayBufferView) {
    if (typeof message !== "string") return;
    return this.runtime.onMessage(wrap(conn), message);
  }

  onClose(conn: Connection<ConnState>) {
    return this.runtime.onClose(wrap(conn));
  }

  onAlarm() {
    return this.runtime.onAlarm();
  }
}

/** What createFetch needs from a room stub; tests fake it. */
export interface RoomStub {
  claim(grant?: RoomGrant, setup?: RoomSetup): Promise<boolean>;
  /** The room's sound library id. Optional, so fakes that only claim still fit. */
  library?(): Promise<string | null>;
}

export interface WorkerOptions {
  policy: HostPolicy;
  brand: string;
  /** Path of the SPA shell the room preview page rewrites. Defaults to "/". */
  shellPath?: string;
  onRoomCreated?(code: string, grant: RoomGrant, request: Request): Promise<void>;
  /** Defaults to `getServerByName(env.Room, code)`. */
  getRoom?(env: ServerEnv, code: string): Promise<RoomStub>;
}

/** The bit of ExecutionContext createFetch uses. */
export interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

/** `?game=<id>&computers=<n>`. Only the shape is checked here; the room checks the rest. */
export function parseRoomSetup(url: URL): RoomSetup | undefined {
  const gameId = url.searchParams.get("game");
  if (!gameId) return undefined;
  // Same rule as the client (setupFromUrl): digits only, a safe whole number, above 0.
  const raw = url.searchParams.get("computers") ?? "";
  const n = /^\d+$/.test(raw) ? Number(raw) : 0;
  return { gameId, computers: Number.isSafeInteger(n) && n > 0 ? n : undefined };
}

export function createFetch(opts: WorkerOptions): (request: Request, env: ServerEnv, ctx?: WaitUntil) => Promise<Response> {
  const getRoom =
    opts.getRoom ?? ((env: ServerEnv, code: string) => getServerByName(env.Room as DurableObjectNamespace<RoomBase>, code));
  return async (request, env, ctx) => {
    const url = new URL(request.url);

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      const decision = await opts.policy.canCreate(request, env);
      if (!decision.ok) return decision.response;
      const setup = parseRoomSetup(url);
      // ~1M codes, so a collision is rare and three in a row is someone's bad day.
      for (let attempt = 0; attempt < 8; attempt++) {
        const code = generateRoomCode();
        const stub = await getRoom(env, code);
        if (await stub.claim(decision.grant, setup)) {
          // The room is claimed and playable: the record (a database write, far
          // away on a slow route) needn't hold up the host. Awaited without a ctx.
          const record = opts.onRoomCreated?.(code, decision.grant, request);
          if (record && ctx) ctx.waitUntil(record.catch((err) => console.error(`room ${code}: record failed:`, err)));
          else await record;
          return json({ code, ...decision.extra });
        }
      }
      return json({ error: "We could not find a free room code. Please try again." }, 503);
    }

    if (url.pathname.startsWith("/parties/")) {
      // Rooms only come into existence via /api/rooms; the DO rejects unclaimed
      // codes itself, but bad codes needn't wake a DO at all.
      const code = url.pathname.split("/")[3] ?? "";
      if (!isValidRoomCode(code)) {
        return new Response("Not Found", { status: 404 });
      }
      return (await routePartykitRequest(request, env as Env)) ?? new Response("Not Found", { status: 404 });
    }

    const packs = await servePacks(request, env);
    if (packs) return packs;

    const mySounds = await serveMySounds(request, env, opts.policy);
    if (mySounds) return mySounds;

    const godot = await serveGodot(request, env);
    if (godot) return godot;

    const room = /^\/room\/([^/]+)\/?$/.exec(url.pathname);
    if (room) return roomPage(request, env, room[1]!.toUpperCase(), opts.brand, opts.shellPath ?? "/");

    return new Response("Not Found", { status: 404 });
  };
}

/** Always https: previews shouldn't point at plain http, whatever the hop in front says. */
function canonical(request: Request, path: string): string {
  const url = new URL(path, request.url);
  url.protocol = "https:";
  return url.href;
}

/**
 * The SPA shell, with link-preview tags naming the room. Chat apps don't run
 * JS, so this is the only way "Join room K7DX" shows up in a group chat.
 */
async function roomPage(request: Request, env: ServerEnv, code: string, brand: string, shellPath: string): Promise<Response> {
  const shell = await env.ASSETS.fetch(new Request(new URL(shellPath, request.url), request));
  if (!isValidRoomCode(code)) return shell;
  const title = `Join room ${code} · ${brand}`;
  const description = "Tap to join the game. You only need a name.";
  const set = (value: string): HTMLRewriterElementContentHandlers => ({
    element: (el) => void el.setAttribute("content", value),
  });
  return new HTMLRewriter()
    .on("title", { element: (el) => void el.setInnerContent(title) })
    .on('meta[property="og:title"], meta[name="twitter:title"]', set(title))
    .on('meta[name="description"], meta[property="og:description"], meta[name="twitter:description"]', set(description))
    .on('meta[property="og:url"]', set(canonical(request, `/room/${code}`)))
    // Rooms are private and short-lived: preview yes, index no.
    .on("head", { element: (el) => void el.append('<meta name="robots" content="noindex" />', { html: true }) })
    .transform(shell);
}
