import type { Db } from "./db.ts";

const DAY_MS = 86_400_000;

/**
 * Hourly cron. Sign-in links and room records go a day after they stop being
 * useful (the room caps only look back 6 hours); sessions go once expired.
 * The privacy page promises this, so keep the two in step.
 */
export async function prune(db: Db, now: number): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM login_tokens WHERE expires_at < ?").bind(now - DAY_MS),
    db.prepare("DELETE FROM rooms WHERE created_at < ?").bind(now - DAY_MS),
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
  ]);
}
