import type { RoomTier } from "@games/protocol";
import { newId, type Db } from "./db.ts";

export type Tier = RoomTier;

export type EntitlementSource = "razorpay" | "paddle" | "comp" | "grant";

const DAY_MS = 86_400_000;
const ACTIVE = "user_id = ? AND revoked_at IS NULL AND starts_at <= ? AND (ends_at IS NULL OR ends_at > ?)";

export async function tierFor(db: Db, userId: string, now: number): Promise<Tier> {
  const row = await db
    .prepare(`SELECT 1 AS ok FROM entitlements WHERE ${ACTIVE} LIMIT 1`)
    .bind(userId, now, now)
    .first<{ ok: number }>();
  return row ? "pass" : "free";
}

/**
 * Passes stack: the new one starts when the last live one ends. A pass with no
 * end, or nothing live, means it starts now.
 */
export async function grant(
  db: Db,
  userId: string,
  e: { source: EntitlementSource; plan: string; days: number | null; ref: string | null },
  now: number,
): Promise<void> {
  // Rows that start later count too: they are passes already stacked.
  const open = await db
    .prepare(
      "SELECT 1 AS ok FROM entitlements WHERE user_id = ? AND revoked_at IS NULL AND starts_at <= ? AND ends_at IS NULL LIMIT 1",
    )
    .bind(userId, now)
    .first<{ ok: number }>();
  const last = await db
    .prepare("SELECT MAX(ends_at) AS m FROM entitlements WHERE user_id = ? AND revoked_at IS NULL AND ends_at > ?")
    .bind(userId, now)
    .first<{ m: number | null }>();
  // A pass with no end never needs to queue.
  const start = open || last?.m == null || e.days === null ? now : last.m;
  await db
    .prepare("INSERT INTO entitlements (id, user_id, source, plan, starts_at, ends_at, ref) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(newId(), userId, e.source, e.plan, start, e.days === null ? null : start + e.days * DAY_MS, e.ref)
    .run();
}

/**
 * Revoke one pass, then close the gap it leaves: passes queued after now are
 * laid end to end again, each keeping its length.
 */
export async function revokeAndRelay(
  db: Db,
  userId: string,
  source: EntitlementSource,
  ref: string,
  now: number,
): Promise<void> {
  await db
    .prepare("UPDATE entitlements SET revoked_at = ? WHERE user_id = ? AND source = ? AND ref = ? AND revoked_at IS NULL")
    .bind(now, userId, source, ref)
    .run();
  const live = await db
    .prepare(
      `SELECT MAX(ends_at) AS m, MAX(ends_at IS NULL) AS open FROM entitlements
       WHERE user_id = ? AND revoked_at IS NULL AND starts_at <= ? AND (ends_at IS NULL OR ends_at > ?)`,
    )
    .bind(userId, now, now)
    .first<{ m: number | null; open: number | null }>();
  let at = live?.open || live?.m == null ? now : live.m;
  const queued = await db
    .prepare(
      `SELECT id, starts_at, ends_at FROM entitlements
       WHERE user_id = ? AND revoked_at IS NULL AND starts_at > ? AND ends_at IS NOT NULL ORDER BY starts_at`,
    )
    .bind(userId, now)
    .all<{ id: string; starts_at: number; ends_at: number }>();
  for (const r of queued.results) {
    const end = at + (r.ends_at - r.starts_at);
    await db.prepare("UPDATE entitlements SET starts_at = ?, ends_at = ? WHERE id = ?").bind(at, end, r.id).run();
    at = end;
  }
}

/** The active row that lasts longest; a row with no end wins. Its end is where the whole stack ends. */
export async function activePlan(
  db: Db,
  userId: string,
  now: number,
): Promise<{ source: EntitlementSource; startsAt: number; endsAt: number | null } | null> {
  const row = await db
    .prepare(
      `SELECT source, starts_at, ends_at FROM entitlements WHERE ${ACTIVE}
       ORDER BY ends_at IS NULL DESC, ends_at DESC LIMIT 1`,
    )
    .bind(userId, now, now)
    .first<{ source: EntitlementSource; starts_at: number; ends_at: number | null }>();
  if (!row) return null;
  let endsAt = row.ends_at;
  if (endsAt !== null) {
    const last = await db
      .prepare("SELECT MAX(ends_at) AS m FROM entitlements WHERE user_id = ? AND revoked_at IS NULL AND ends_at > ?")
      .bind(userId, now)
      .first<{ m: number | null }>();
    endsAt = last?.m ?? endsAt;
  }
  return { source: row.source, startsAt: row.starts_at, endsAt };
}
