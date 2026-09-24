import { secureRandomInt, type AnyGameDefinition } from "@games/game-core";
import { isValidRoomCode, safeEqual } from "@games/protocol";
import { sevensGame } from "@games/sevens/server";
import { getServerByName, routePartykitRequest, Server, type Connection } from "partyserver";
import { generateRoomCode } from "./codes.ts";
import { RoomRuntime, type Conn, type ConnState, type RoomHost } from "./runtime.ts";

/** Server half of the game registry (§43). */
const GAMES: Record<string, AnyGameDefinition> = {
  sevens: sevensGame,
};

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

/** One Durable Object per room, addressed by room code. */
export class Room extends Server<Env> {
  static options = { hibernate: true };

  #runtime: RoomRuntime | null = null;

  private get runtime(): RoomRuntime {
    if (!this.#runtime) {
      const storage = this.ctx.storage;
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
        devTools: this.env.DEV_TOOLS === "1",
        logError: (err) => console.error(`room ${this.name}:`, err),
        isOwnerKey: (key) => isOwnerKey(this.env, key),
        ownerRequired: true,
      };
      this.#runtime = new RoomRuntime(this.name, host, GAMES, "sevens");
    }
    return this.#runtime;
  }

  async onStart() {
    await this.runtime.load();
  }

  /** RPC from the worker's create-room endpoint (§10). */
  async claim(): Promise<boolean> {
    return this.runtime.claim();
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

/** No secret set means nobody is the owner: fail closed, never open. */
function isOwnerKey(env: Env, key: string | null | undefined): boolean {
  return !!env.OWNER_KEY && !!key && safeEqual(key, env.OWNER_KEY);
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      if (!env.OWNER_KEY) return json({ error: "This server has no owner key set yet." }, 503);
      const key = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      if (!isOwnerKey(env, key)) return json({ error: "That owner key didn't work." }, 403);
      const rooms = env.Room as DurableObjectNamespace<Room>;
      // ~1M codes, so a collision is rare and three in a row is someone's bad day.
      for (let attempt = 0; attempt < 8; attempt++) {
        const code = generateRoomCode();
        const stub = await getServerByName(rooms, code);
        if (await stub.claim()) return json({ code });
      }
      return json({ error: "Couldn't find a free room code. Try again." }, 503);
    }

    if (url.pathname.startsWith("/parties/")) {
      // Rooms only come into existence via /api/rooms; the DO rejects unclaimed
      // codes itself, but bad codes needn't wake a DO at all.
      const code = url.pathname.split("/")[3] ?? "";
      if (!isValidRoomCode(code)) {
        return new Response("Not Found", { status: 404 });
      }
      return (await routePartykitRequest(request, env)) ?? new Response("Not Found", { status: 404 });
    }

    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
