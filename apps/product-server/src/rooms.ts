import { isValidRoomCode } from "@games/protocol";
import { json, type HostPolicy } from "@games/server/policy";
import { getServerByName } from "partyserver";
import { hmacHex, newId, type Db } from "./db.ts";
import { tierFor } from "./entitlements.ts";
import type { ProductEnv } from "./env.ts";
import { clientIp } from "./http.ts";
import { userFromRequest } from "./auth.ts";
import { verifyTurnstile } from "./turnstile.ts";

const WINDOW_MS = 6 * 3_600_000;
const MAX_FREE_PER_IP = 5;
const MAX_FREE_TOTAL = 2000;
const TOO_MANY = "Too many rooms right now. Please try again later.";

/**
 * The IP as stored in `rooms`: keyed, so a leaked table can't be reversed by
 * hashing every IPv4. No key means no room, never an unkeyed hash.
 */
export function ipHash(key: string | undefined, ip: string): Promise<string> {
  if (!key) throw new Error("IP_HASH_KEY is not set (wrangler secret put IP_HASH_KEY)");
  return hmacHex(key, ip);
}

export interface RoomDeps {
  now(): number;
  verifyTurnstile(token: string, ip: string, env: ProductEnv): Promise<boolean>;
}

export const realRoomDeps: RoomDeps = {
  now: () => Date.now(),
  verifyTurnstile: (token, ip, env) => verifyTurnstile(env.TURNSTILE_SECRET, token, ip),
};

export function productPolicy(deps: Pick<RoomDeps, "now"> & { verifyTurnstile: (token: string, ip: string, env: ProductEnv) => Promise<boolean> }): HostPolicy {
  return {
    async canCreate(request, serverEnv) {
      const env = serverEnv as unknown as ProductEnv;
      const now = deps.now();
      const hostKey = newId();

      const user = await userFromRequest(env.DB, request, now);
      if (user && (await tierFor(env.DB, user.id, now)) === "pass") {
        // No Turnstile and no caps for Host Pass, but a runaway script still gets slowed.
        if (!(await env.CREATE_LIMIT.limit({ key: `user:${user.id}` })).success) return { ok: false, response: json({ error: TOO_MANY }, 429) };
        return { ok: true, grant: { tier: "pass", hostKey }, extra: { hostKey } };
      }

      const ip = clientIp(request);
      const token = request.headers.get("x-turnstile-token") ?? "";
      if (!(await deps.verifyTurnstile(token, ip, env))) return { ok: false, response: json({ error: "Please try again." }, 403) };
      if (!(await env.CREATE_LIMIT.limit({ key: ip })).success) return { ok: false, response: json({ error: TOO_MANY }, 429) };

      const since = now - WINDOW_MS;
      const mine = await env.DB.prepare("SELECT COUNT(*) AS n FROM rooms WHERE tier = 'free' AND ip_hash = ? AND created_at > ?")
        .bind(await ipHash(env.IP_HASH_KEY, ip), since)
        .first<{ n: number }>();
      const all = await env.DB.prepare("SELECT COUNT(*) AS n FROM rooms WHERE tier = 'free' AND created_at > ?")
        .bind(since)
        .first<{ n: number }>();
      if ((mine?.n ?? 0) >= MAX_FREE_PER_IP || (all?.n ?? 0) >= MAX_FREE_TOTAL) {
        return { ok: false, response: json({ error: TOO_MANY }, 429) };
      }
      return { ok: true, grant: { tier: "free", hostKey }, extra: { hostKey } };
    },
  };
}

/** The `onRoomCreated` hook: one row per room, for the abuse caps. Only a keyed hash of the IP is kept. */
export function recordRoom(db: Db, ipHashKey: string | undefined, now: () => number = Date.now) {
  return async (code: string, grant: { tier: string }, request: Request): Promise<void> => {
    await db
      .prepare("INSERT INTO rooms (code, tier, ip_hash, created_at) VALUES (?, ?, ?, ?)")
      .bind(code, grant.tier, await ipHash(ipHashKey, clientIp(request)), now())
      .run();
  };
}

export interface UpgradeDeps {
  now(): number;
  getRoom(env: ProductEnv, code: string): Promise<{ upgrade(hostKey: string): Promise<boolean> }>;
}

export const realUpgradeDeps: UpgradeDeps = {
  now: () => Date.now(),
  getRoom: (env, code) => getServerByName(env.Room as unknown as Parameters<typeof getServerByName>[0], code) as never,
};

/** `POST /api/rooms/:code/upgrade`. Null when the request is some other route. */
export async function handleUpgrade(request: Request, env: ProductEnv, deps: UpgradeDeps): Promise<Response | null> {
  const m = /^\/api\/rooms\/([^/]+)\/upgrade$/.exec(new URL(request.url).pathname);
  if (!m || request.method !== "POST") return null;
  const now = deps.now();
  const user = await userFromRequest(env.DB, request, now);
  if (!user) return json({ error: "Sign in first." }, 401);
  if ((await tierFor(env.DB, user.id, now)) !== "pass") return json({ error: "This needs Host Pass." }, 402);
  const code = m[1]!.toUpperCase();
  const body = (await request.json().catch(() => null)) as { hostKey?: unknown } | null;
  if (!isValidRoomCode(code) || typeof body?.hostKey !== "string" || !body.hostKey) return json({ error: "That room code is not valid." }, 400);
  const room = await deps.getRoom(env, code);
  if (!(await room.upgrade(body.hostKey))) return json({ error: "That is not your room." }, 403);
  await env.DB.prepare("UPDATE rooms SET tier = 'pass' WHERE code = ?").bind(code).run();
  return json({ ok: true });
}
