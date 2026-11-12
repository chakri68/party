import { newId, type Db } from "../db.ts";
import { grant, revokeAndRelay } from "../entitlements.ts";
import { PLANS, type PlanId, type Provider } from "./plans.ts";

export type PaidInput = {
  provider: Provider;
  ref: string;
  plan: PlanId;
  amount: number;
  currency: "INR" | "USD";
  userId: string | null;
};

/** Webhooks retry, so the (provider, ref) key makes this safe to call twice. */
export async function recordPaid(db: Db, p: PaidInput, now: number): Promise<"granted" | "duplicate" | "no-user"> {
  const seen = await db
    .prepare("SELECT 1 AS ok FROM purchases WHERE provider = ? AND ref = ?")
    .bind(p.provider, p.ref)
    .first<{ ok: number }>();
  if (seen) return "duplicate";

  // The user may be deleted between checkout and webhook. Keep the money trail anyway.
  const user = p.userId
    ? await db.prepare("SELECT id FROM users WHERE id = ?").bind(p.userId).first<{ id: string }>()
    : null;
  const userId = user ? user.id : null;
  await db
    .prepare(
      "INSERT INTO purchases (id, user_id, provider, ref, plan, amount, currency, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'paid', ?)",
    )
    .bind(newId(), userId, p.provider, p.ref, p.plan, p.amount, p.currency, now)
    .run();
  if (!userId) return "no-user";
  await grant(db, userId, { source: p.provider, plan: p.plan, days: PLANS[p.plan].days, ref: p.ref }, now);
  return "granted";
}

export async function refundByRef(
  db: Db,
  provider: Provider,
  ref: string,
  now: number,
): Promise<"refunded" | "already" | "unknown"> {
  const row = await db
    .prepare("SELECT user_id, status FROM purchases WHERE provider = ? AND ref = ?")
    .bind(provider, ref)
    .first<{ user_id: string | null; status: "paid" | "refunded" }>();
  if (!row) return "unknown";
  if (row.status === "refunded") return "already";
  await db
    .prepare("UPDATE purchases SET status = 'refunded', refunded_at = ? WHERE provider = ? AND ref = ?")
    .bind(now, provider, ref)
    .run();
  if (row.user_id) await revokeAndRelay(db, row.user_id, provider, ref, now);
  return "refunded";
}

export async function listPurchases(
  db: Db,
  userId: string,
): Promise<Array<{ plan: PlanId; amount: number; currency: string; status: "paid" | "refunded"; createdAt: number }>> {
  const { results } = await db
    .prepare(
      "SELECT plan, amount, currency, status, created_at FROM purchases WHERE user_id = ? ORDER BY created_at DESC, rowid DESC",
    )
    .bind(userId)
    .all<{ plan: PlanId; amount: number; currency: string; status: "paid" | "refunded"; created_at: number }>();
  return results.map((r) => ({ plan: r.plan, amount: r.amount, currency: r.currency, status: r.status, createdAt: r.created_at }));
}
