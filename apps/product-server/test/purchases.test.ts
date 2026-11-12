import { describe, expect, it } from "vitest";
import { tierFor } from "../src/entitlements.ts";
import { listPurchases, recordPaid, refundByRef } from "../src/billing/purchases.ts";
import { fakeD1 } from "./d1.ts";

const DAY = 86_400_000;
const T0 = 1_800_000_000_000;
const u = "u1";
const p = { provider: "razorpay", ref: "pay_1", plan: "month", amount: 14900, currency: "INR", userId: u } as const;

async function setup() {
  const db = fakeD1();
  await db.prepare("INSERT INTO users (id, email, created_at) VALUES (?, 'a@b.c', ?)").bind(u, T0).run();
  return db;
}
const count = async (db: Awaited<ReturnType<typeof setup>>, sql: string) =>
  (await db.prepare(sql).first<{ n: number }>())!.n;

describe("purchases", () => {
  it("records a payment and grants a pass; a repeat does nothing", async () => {
    const db = await setup();
    expect(await recordPaid(db, p, T0)).toBe("granted");
    expect(await tierFor(db, u, T0)).toBe("pass");
    expect(await recordPaid(db, p, T0)).toBe("duplicate");
    expect(await count(db, "SELECT COUNT(*) AS n FROM entitlements")).toBe(1);
    expect(await count(db, "SELECT COUNT(*) AS n FROM purchases")).toBe(1);
  });

  it("keeps a payment with no user, unlinked", async () => {
    const db = await setup();
    expect(await recordPaid(db, { ...p, ref: "pay_2", userId: null }, T0)).toBe("no-user");
    expect(await recordPaid(db, { ...p, ref: "pay_3", userId: "gone" }, T0)).toBe("no-user");
    expect(await count(db, "SELECT COUNT(*) AS n FROM purchases WHERE user_id IS NULL")).toBe(2);
    expect(await count(db, "SELECT COUNT(*) AS n FROM entitlements")).toBe(0);
    expect(await refundByRef(db, "razorpay", "pay_2", T0)).toBe("refunded");
  });

  it("refunds once and takes the pass away", async () => {
    const db = await setup();
    await recordPaid(db, p, T0);
    expect(await refundByRef(db, "razorpay", "pay_1", T0 + DAY)).toBe("refunded");
    expect(await tierFor(db, u, T0 + DAY)).toBe("free");
    expect(await refundByRef(db, "razorpay", "pay_1", T0 + DAY)).toBe("already");
    expect(await refundByRef(db, "razorpay", "pay_nope", T0)).toBe("unknown");
    expect(await refundByRef(db, "paddle", "pay_1", T0)).toBe("unknown");
    expect((await listPurchases(db, u)).map((x) => x.status)).toEqual(["refunded"]);
  });

  it("lists newest first", async () => {
    const db = await setup();
    await recordPaid(db, p, T0);
    await recordPaid(db, { ...p, ref: "pay_4", plan: "year", amount: 99900 }, T0 + 2 * DAY);
    expect((await listPurchases(db, u)).map((x) => x.plan)).toEqual(["year", "month"]);
  });

  it("deleting the user keeps the purchase, unlinked", async () => {
    const db = await setup();
    await recordPaid(db, p, T0);
    await db.prepare("DELETE FROM users WHERE id = ?").bind(u).run();
    expect((await db.prepare("SELECT user_id FROM purchases").first<{ user_id: string | null }>())!.user_id).toBeNull();
    expect(await count(db, "SELECT COUNT(*) AS n FROM entitlements")).toBe(0);
  });
});
