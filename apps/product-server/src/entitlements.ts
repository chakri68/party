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

export async function grant(
  db: Db,
  userId: string,
  e: { source: EntitlementSource; plan: string; days: number | null; ref: string | null },
  now: number,
): Promise<void> {
  await db
    .prepare("INSERT INTO entitlements (id, user_id, source, plan, starts_at, ends_at, ref) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(newId(), userId, e.source, e.plan, now, e.days === null ? null : now + e.days * DAY_MS, e.ref)
    .run();
}

/** The active row that lasts longest; a row with no end wins. */
export async function activePlan(
  db: Db,
  userId: string,
  now: number,
): Promise<{ source: EntitlementSource; endsAt: number | null } | null> {
  const row = await db
    .prepare(
      `SELECT source, ends_at FROM entitlements WHERE ${ACTIVE}
       ORDER BY ends_at IS NULL DESC, ends_at DESC LIMIT 1`,
    )
    .bind(userId, now, now)
    .first<{ source: EntitlementSource; ends_at: number | null }>();
  return row ? { source: row.source, endsAt: row.ends_at } : null;
}
