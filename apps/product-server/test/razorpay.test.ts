import { describe, expect, it } from "vitest";
import { hmacHex } from "../src/billing/hmac.ts";
import { handleRazorpay, type RazorpayDeps } from "../src/billing/razorpay.ts";
import { tierFor } from "../src/entitlements.ts";
import type { ProductEnv } from "../src/env.ts";
import { sha256Hex } from "../src/db.ts";
import { fakeD1 } from "./d1.ts";

const T0 = 1_800_000_000_000;
const KEY = "ksecret";
const WH = "whsecret";
const ORIGIN = "https://couchpartygames.com";

type Reply = { status: number; body: any };

async function setup(billing = "1") {
  const db = fakeD1();
  for (const [id, email] of [["u1", "a@x.com"], ["u2", "b@x.com"]] as const) {
    await db.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)").bind(id, email, T0).run();
    await db
      .prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
      .bind(await sha256Hex("tok-" + id), id, T0 + 1e9)
      .run();
  }
  const env = {
    DB: db, BILLING: billing, RAZORPAY_KEY_ID: "rzp_key", RAZORPAY_KEY_SECRET: KEY, RAZORPAY_WEBHOOK_SECRET: WH,
  } as unknown as ProductEnv;
  const replies: Record<string, Reply> = {};
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const deps: RazorpayDeps = {
    now: () => T0,
    api: async (method, path, body) => {
      calls.push({ method, path, body });
      return replies[`${method} ${path}`] ?? { status: 404, body: {} };
    },
  };
  const call = (path: string, init: { user?: string; body?: unknown; raw?: string; sig?: string } = {}) =>
    handleRazorpay(
      new Request(ORIGIN + path, {
        method: "POST",
        headers: {
          ...(init.user ? { cookie: `cp_session=tok-${init.user}` } : {}),
          ...(init.sig ? { "x-razorpay-signature": init.sig } : {}),
        },
        body: init.raw ?? JSON.stringify(init.body ?? {}),
      }),
      env,
      deps,
    ) as Promise<Response>;
  const payment = (o: Record<string, unknown> = {}) => ({
    id: "pay_1", order_id: "order_1", amount: 14900, currency: "INR", status: "captured", ...o,
  });
  const order = (o: Record<string, unknown> = {}) => ({ id: "order_1", notes: { userId: "u1", plan: "month" }, ...o });
  const stock = (pay = payment(), ord = order()) => {
    replies["GET /v1/payments/pay_1"] = { status: 200, body: pay };
    replies["GET /v1/orders/order_1"] = { status: 200, body: ord };
  };
  const confirmBody = async (o: Record<string, unknown> = {}) => ({
    orderId: "order_1", paymentId: "pay_1", signature: await hmacHex(KEY, "order_1|pay_1"), ...o,
  });
  const hook = async (event: string, entity: Record<string, unknown>, key: "payment" | "refund" = "payment", sig?: string) => {
    const raw = JSON.stringify({ entity: "event", event, payload: { [key]: { entity } } });
    return call("/api/billing/razorpay/webhook", { raw, sig: sig ?? (await hmacHex(WH, raw)) });
  };
  const n = async (table: string) =>
    (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
  return { db, env, replies, calls, call, payment, order, stock, confirmBody, hook, n };
}

describe("order", () => {
  const P = "/api/billing/razorpay/order";
  it("401 signed out", async () => {
    const s = await setup();
    expect((await s.call(P, { body: { plan: "month" } })).status).toBe(401);
  });
  it("400 for an unknown plan", async () => {
    const s = await setup();
    expect((await s.call(P, { user: "u1", body: { plan: "week" } })).status).toBe(400);
  });
  it("creates an order for the plan price", async () => {
    const s = await setup();
    s.replies["POST /v1/orders"] = { status: 200, body: { id: "order_9" } };
    const r = await s.call(P, { user: "u1", body: { plan: "month" } });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ orderId: "order_9", keyId: "rzp_key", amount: 14900, currency: "INR", email: "a@x.com" });
    expect(s.calls[0]).toMatchObject({
      method: "POST", path: "/v1/orders",
      body: { amount: 14900, currency: "INR", notes: { userId: "u1", plan: "month" } },
    });
  });
  it("502 when the provider fails", async () => {
    const s = await setup();
    s.replies["POST /v1/orders"] = { status: 500, body: {} };
    const r = await s.call(P, { user: "u1", body: { plan: "month" } });
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ error: "Payments are not working right now. Please try again." });
  });
  it("404 when billing is off", async () => {
    const s = await setup("0");
    expect((await s.call(P, { user: "u1", body: { plan: "month" } })).status).toBe(404);
  });
  it("null outside its prefix", async () => {
    const s = await setup();
    expect(await handleRazorpay(new Request(ORIGIN + "/api/me"), s.env, {} as RazorpayDeps)).toBeNull();
  });
});

describe("confirm", () => {
  const P = "/api/billing/razorpay/confirm";
  it("grants once, and a repeat changes nothing", async () => {
    const s = await setup();
    s.stock();
    for (let i = 0; i < 2; i++) {
      const r = await s.call(P, { user: "u1", body: await s.confirmBody() });
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ ok: true, plan: "month" });
    }
    expect(await s.n("entitlements")).toBe(1);
    expect(await s.n("purchases")).toBe(1);
    expect((await s.db.prepare("SELECT amount FROM purchases").first<{ amount: number }>())!.amount).toBe(14900);
    expect(await tierFor(s.db, "u1", T0)).toBe("pass");
  });
  it("401 signed out", async () => {
    const s = await setup();
    expect((await s.call(P, { body: await s.confirmBody() })).status).toBe(401);
  });
  it("400 on a bad signature", async () => {
    const s = await setup();
    s.stock();
    expect((await s.call(P, { user: "u1", body: await s.confirmBody({ signature: "00" }) })).status).toBe(400);
    expect(await s.n("purchases")).toBe(0);
  });
  it("400 for a payment on another order", async () => {
    const s = await setup();
    s.stock(s.payment({ order_id: "order_2" }));
    expect((await s.call(P, { user: "u1", body: await s.confirmBody() })).status).toBe(400);
    expect(await s.n("purchases")).toBe(0);
  });
  it("400 when the order belongs to another user", async () => {
    const s = await setup();
    s.stock(s.payment(), s.order({ notes: { userId: "u2", plan: "month" } }));
    expect((await s.call(P, { user: "u1", body: await s.confirmBody() })).status).toBe(400);
    expect(await s.n("purchases")).toBe(0);
  });
  it("400 when the amount is not the plan price", async () => {
    const s = await setup();
    s.stock(s.payment({ amount: 4900 }));
    expect((await s.call(P, { user: "u1", body: await s.confirmBody() })).status).toBe(400);
    expect(await s.n("purchases")).toBe(0);
  });
  it("202 pending while authorized, nothing recorded", async () => {
    const s = await setup();
    s.stock(s.payment({ status: "authorized" }));
    const r = await s.call(P, { user: "u1", body: await s.confirmBody() });
    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({ pending: true });
    expect(await s.n("purchases")).toBe(0);
    expect(await s.n("entitlements")).toBe(0);
  });
  it("400 for a failed payment", async () => {
    const s = await setup();
    s.stock(s.payment({ status: "failed" }));
    expect((await s.call(P, { user: "u1", body: await s.confirmBody() })).status).toBe(400);
  });
});

describe("webhook", () => {
  it("401 on a bad signature", async () => {
    const s = await setup();
    s.stock();
    expect((await s.hook("payment.captured", s.payment(), "payment", "00")).status).toBe(401);
    expect(await s.n("purchases")).toBe(0);
  });
  it("401 when the secret is not set", async () => {
    const s = await setup();
    delete (s.env as any).RAZORPAY_WEBHOOK_SECRET;
    expect((await s.hook("payment.captured", s.payment())).status).toBe(401);
  });
  it("grants on payment.captured; the same event twice is one grant", async () => {
    const s = await setup();
    s.stock();
    for (let i = 0; i < 2; i++) expect((await s.hook("payment.captured", s.payment())).status).toBe(200);
    expect(await s.n("entitlements")).toBe(1);
    expect(await s.n("purchases")).toBe(1);
  });
  it("confirm then webhook is still one grant", async () => {
    const s = await setup();
    s.stock();
    await s.call("/api/billing/razorpay/confirm", { user: "u1", body: await s.confirmBody() });
    expect((await s.hook("payment.captured", s.payment())).status).toBe(200);
    expect(await s.n("entitlements")).toBe(1);
    expect(await s.n("purchases")).toBe(1);
  });
  it("keeps a payment for a deleted user, unlinked", async () => {
    const s = await setup();
    s.stock(s.payment(), s.order({ notes: { userId: "gone", plan: "month" } }));
    expect((await s.hook("payment.captured", s.payment())).status).toBe(200);
    expect(await s.n("purchases WHERE user_id IS NULL")).toBe(1);
    expect(await s.n("entitlements")).toBe(0);
  });
  it("200 and nothing written on an amount mismatch", async () => {
    const s = await setup();
    s.stock(s.payment({ amount: 4900 }));
    expect((await s.hook("payment.captured", s.payment({ amount: 4900 }))).status).toBe(200);
    expect(await s.n("purchases")).toBe(0);
  });
  it("500 when the provider GET fails with 5xx, so Razorpay retries", async () => {
    const s = await setup();
    s.replies["GET /v1/orders/order_1"] = { status: 503, body: {} };
    expect((await s.hook("payment.captured", s.payment())).status).toBe(500);
  });
  it("refund.processed takes the pass away", async () => {
    const s = await setup();
    s.stock();
    await s.hook("payment.captured", s.payment());
    expect(await tierFor(s.db, "u1", T0)).toBe("pass");
    expect((await s.hook("refund.processed", { id: "rfnd_1", payment_id: "pay_1" }, "refund")).status).toBe(200);
    expect(await tierFor(s.db, "u1", T0)).toBe("free");
  });
  it("refund for an unknown payment is 200", async () => {
    const s = await setup();
    expect((await s.hook("refund.processed", { id: "rfnd_1", payment_id: "pay_x" }, "refund")).status).toBe(200);
  });
  it("ignores other events", async () => {
    const s = await setup();
    expect((await s.hook("order.paid", s.payment())).status).toBe(200);
    expect(await s.n("purchases")).toBe(0);
    expect(s.calls).toHaveLength(0);
  });
});
