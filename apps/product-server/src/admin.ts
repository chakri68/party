import { safeEqual } from "@games/protocol";
import { createCode, listCodes, revokeCode } from "./comps.ts";
import { newId, normalizeEmail, type Db } from "./db.ts";
import { grant, relay } from "./entitlements.ts";
import type { ProductEnv } from "./env.ts";
import { json } from "./http.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BAD = () => json({ error: "Bad request." }, 400);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isDays = (v: unknown): v is number | null => v === null || (typeof v === "number" && Number.isInteger(v) && v > 0);

async function body(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const b: unknown = await request.json();
    return isRecord(b) ? b : null;
  } catch {
    return null;
  }
}

function emailOf(b: Record<string, unknown>): string | null {
  if (typeof b.email !== "string") return null;
  const email = normalizeEmail(b.email);
  return EMAIL_RE.test(email) ? email : null;
}

async function upsertUser(db: Db, email: string, now: number): Promise<string> {
  await db
    .prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING")
    .bind(newId(), email, now)
    .run();
  const row = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
  return row!.id;
}

/** Owner-only routes under /api/admin. Null when the path is not one of them. */
export async function handleAdmin(request: Request, env: ProductEnv, now: () => number = Date.now): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/admin/")) return null;

  const key = env.ADMIN_KEY;
  if (!key) return json({ error: "Admin is off." }, 503);
  const given = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!safeEqual(given, key)) return json({ error: "Not allowed." }, 401);

  const route = `${request.method} ${url.pathname}`;
  const db = env.DB;

  if (route === "POST /api/admin/grant") {
    const b = await body(request);
    const email = b && emailOf(b);
    if (!b || !email || !isDays(b.days)) return BAD();
    const userId = await upsertUser(db, email, now());
    await grant(db, userId, { source: "grant", plan: "grant", days: b.days, ref: null }, now());
    return json({ ok: true });
  }

  if (route === "POST /api/admin/revoke-grants") {
    const b = await body(request);
    const email = b && emailOf(b);
    if (!email) return BAD();
    const t = now();
    await db
      .prepare(
        `UPDATE entitlements SET revoked_at = ? WHERE source = 'grant' AND revoked_at IS NULL
         AND user_id = (SELECT id FROM users WHERE email = ?)`,
      )
      .bind(t, email)
      .run();
    const u = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
    if (u) await relay(db, u.id, t);
    return json({ ok: true });
  }

  if (route === "POST /api/admin/codes") {
    const b = await body(request);
    if (!b) return BAD();
    const { maxUses, days, note, prefix } = b;
    if (typeof maxUses !== "number" || !Number.isInteger(maxUses) || maxUses < 1 || !isDays(days)) return BAD();
    if (note !== undefined && note !== null && typeof note !== "string") return BAD();
    if (prefix !== undefined && prefix !== null && (typeof prefix !== "string" || !/^[A-Za-z0-9]{1,8}$/.test(prefix))) return BAD();
    const code = await createCode(db, { maxUses, days, note: note ?? undefined, prefix: prefix ?? undefined }, now());
    return json({ code });
  }

  if (route === "GET /api/admin/codes") return json(await listCodes(db));

  const rev = request.method === "POST" ? /^\/api\/admin\/codes\/([^/]+)\/revoke$/.exec(url.pathname) : null;
  if (rev) {
    const ok = await revokeCode(db, decodeURIComponent(rev[1]!), now());
    return ok ? json({ ok: true }) : json({ error: "No such code." }, 404);
  }

  return json({ error: "Not found." }, 404);
}
