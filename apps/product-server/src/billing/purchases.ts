import { newId, type Db } from "../db.ts";
import { grant, revokeAndRelay } from "../entitlements.ts";
import { PLANS, type PlanId, type Provider } from "./plans.ts";

export type PaidInput = {
  provider: Provider;
  ref: string;
  plan: PlanId;
  amount: number;
  currency: string;
  userId: string | null;
};

/** Webhooks retry, so the (provider, ref) key makes this safe to call twice. */
export async function recordPaid(db: Db, p: PaidInput, now: number): Promise<"granted" | "duplicate" | "no-user"> {
  // The user may be deleted between checkout and webhook. Keep the money trail anyway.
  const user = p.userId
    ? await db.prepare("SELECT id FROM users WHERE id = ?").bind(p.userId).first<{ id: string }>()
    : null;
  const userId = user ? user.id : null;
  const ins = await db
    .prepare(
      `INSERT INTO purchases (id, user_id, provider, ref, plan, amount, currency, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'paid', ?) ON CONFLICT (provider, ref) DO NOTHING`,
    )
    .bind(newId(), userId, p.provider, p.ref, p.plan, p.amount, p.currency, now)
    .run();
  if (ins.meta.changes === 0) {
    // A first attempt may have died after the insert and before the grant. Grant is
    // idempotent, so redo it for a purchase that is still paid.
    const old = await db
      .prepare("SELECT user_id, plan, status FROM purchases WHERE provider = ? AND ref = ?")
      .bind(p.provider, p.ref)
      .first<{ user_id: string | null; plan: PlanId; status: "paid" | "refunded" }>();
    if (old?.user_id && old.status === "paid") {
      await grant(db, old.user_id, { source: p.provider, plan: old.plan, days: PLANS[old.plan].days, ref: p.ref }, now);
    }
    return "duplicate";
  }
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
  const upd = await db
    .prepare("UPDATE purchases SET status = 'refunded', refunded_at = ? WHERE provider = ? AND ref = ? AND status = 'paid'")
    .bind(now, provider, ref)
    .run();
  if (upd.meta.changes === 0) {
    const row = await db.prepare("SELECT 1 AS ok FROM purchases WHERE provider = ? AND ref = ?").bind(provider, ref).first();
    return row ? "already" : "unknown";
  }
  const row = await db
    .prepare("SELECT user_id FROM purchases WHERE provider = ? AND ref = ?")
    .bind(provider, ref)
    .first<{ user_id: string | null }>();
  if (row?.user_id) await revokeAndRelay(db, row.user_id, provider, ref, now);
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
