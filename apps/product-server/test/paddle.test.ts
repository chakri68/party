import { describe, expect, it } from "vitest";
import { hmacHex } from "../src/billing/hmac.ts";
import { handlePaddle, type PaddleDeps, type PaddleTxn } from "../src/billing/paddle.ts";
import { tierFor } from "../src/entitlements.ts";
import type { ProductEnv } from "../src/env.ts";
import { sha256Hex } from "../src/db.ts";
import { fakeD1 } from "./d1.ts";

const T0 = 1_800_000_000_000;
const WH = "pdlsecret";
const ORIGIN = "https://couchpartygames.com";

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
    DB: db, BILLING: billing, PADDLE_API_KEY: "key", PADDLE_WEBHOOK_SECRET: WH,
    PADDLE_PRICE_MONTH: "pri_month", PADDLE_PRICE_YEAR: "pri_year",
  } as unknown as ProductEnv;
  const txns: Record<string, PaddleTxn | "throw"> = {};
  const deps: PaddleDeps = {
    now: () => T0,
    getTransaction: async (id) => {
      const t = txns[id];
      if (t === "throw") throw new Error("down");
      return t ?? null;
    },
  };
  const call = (path: string, init: { user?: string; body?: unknown; raw?: string; sig?: string } = {}) =>
    handlePaddle(
      new Request(ORIGIN + path, {
        method: "POST",
        headers: {
          ...(init.user ? { cookie: `cp_session=tok-${init.user}` } : {}),
          ...(init.sig ? { "paddle-signature": init.sig } : {}),
        },
        body: init.raw ?? JSON.stringify(init.body ?? {}),
      }),
      env,
      deps,
    ) as Promise<Response>;
  const txn = (o: Partial<PaddleTxn> = {}): PaddleTxn => ({
    id: "txn_1", status: "completed", custom_data: { userId: "u1" }, currency_code: "USD",
    items: [{ price: { id: "pri_month" } }], details: { totals: { grand_total: "399" } }, ...o,
  });
  const confirm = (user = "u1", id = "txn_1") =>
    call("/api/billing/paddle/confirm", { user, body: { transactionId: id } });
  const sign = async (raw: string, ts = Math.floor(T0 / 1000)) => `ts=${ts};h1=${await hmacHex(WH, `${ts}:${raw}`)}`;
  const hookRaw = async (raw: string, sig?: string) =>
    call("/api/billing/paddle/webhook", { raw, sig: sig ?? (await sign(raw)) });
  const hook = (event_type: string, data: unknown, sig?: string) =>
    hookRaw(JSON.stringify({ event_type, data }), sig);
  const n = async (table: string) =>
    (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
  return { db, env, txns, call, txn, confirm, sign, hook, hookRaw, n };
}

describe("routing", () => {
  it("null outside its prefix", async () => {
    const s = await setup();
    expect(await handlePaddle(new Request(ORIGIN + "/api/me"), s.env, {} as PaddleDeps)).toBeNull();
  });
  it("404 when billing is off", async () => {
    const s = await setup("0");
    expect((await s.confirm()).status).toBe(404);
  });
});

describe("confirm", () => {
  it("grants on completed, and a repeat changes nothing", async () => {
    const s = await setup();
    s.txns.txn_1 = s.txn();
    for (let i = 0; i < 2; i++) {
      const r = await s.confirm();
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ ok: true, plan: "month" });
    }
    expect(await s.n("entitlements")).toBe(1);
    expect(await s.n("purchases")).toBe(1);
    expect((await s.db.prepare("SELECT amount, currency FROM purchases").first<any>())).toMatchObject({ amount: 399, currency: "USD" });
    expect(await tierFor(s.db, "u1", T0)).toBe("pass");
  });
  it("grants on paid", async () => {
    const s = await setup();
    s.txns.txn_1 = s.txn({ status: "paid" });
    expect((await s.confirm()).status).toBe(200);
    expect(await s.n("purchases")).toBe(1);
  });
  it("401 signed out", async () => {
    const s = await setup();
    s.txns.txn_1 = s.txn();
    expect((await s.call("/api/billing/paddle/confirm", { body: { transactionId: "txn_1" } })).status).toBe(401);
  });
  it("400 for an unknown price", async () => {
    const s = await setup();
    s.txns.txn_1 = s.txn({ items: [{ price: { id: "pri_other" } }] });
    expect((await s.confirm()).status).toBe(400);
    expect(await s.n("purchases")).toBe(0);
  });
  it("400 when custom_data is another user's", async () => {
    const s = await setup();
    s.txns.txn_1 = s.txn({ custom_data: { userId: "u2" } });
    expect((await s.confirm()).status).toBe(400);
    expect(await s.n("purchases")).toBe(0);
  });
  it("400 with two items", async () => {
    const s = await setup();
    s.txns.txn_1 = s.txn({ items: [{ price: { id: "pri_month" } }, { price: { id: "pri_month" } }] });
    expect((await s.confirm()).status).toBe(400);
  });
  it("400 for a non-USD currency", async () => {
    const s = await setup();
    s.txns.txn_1 = s.txn({ currency_code: "EUR" });
    expect((await s.confirm()).status).toBe(400);
    expect(await s.n("purchases")).toBe(0);
  });
  it("400 for an unknown transaction", async () => {
    const s = await setup();
    expect((await s.confirm()).status).toBe(400);
  });
  it("400 for a missing transaction id", async () => {
    const s = await setup();
    expect((await s.call("/api/billing/paddle/confirm", { user: "u1", body: {} })).status).toBe(400);
  });
  it("202 pending for ready and draft, nothing recorded", async () => {
    const s = await setup();
    for (const status of ["ready", "draft"]) {
      s.txns.txn_1 = s.txn({ status });
      const r = await s.confirm();
      expect(r.status).toBe(202);
      expect(await r.json()).toEqual({ pending: true });
    }
    expect(await s.n("purchases")).toBe(0);
    expect(await s.n("entitlements")).toBe(0);
  });
  it("400 for a canceled transaction", async () => {
    const s = await setup();
    s.txns.txn_1 = s.txn({ status: "canceled" });
    expect((await s.confirm()).status).toBe(400);
  });
  it("502 when the provider call throws", async () => {
    const s = await setup();
    s.txns.txn_1 = "throw";
    const r = await s.confirm();
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ error: "Payments are not working right now. Please try again." });
  });
  it("502 when the API key is missing", async () => {
    const s = await setup();
    delete (s.env as any).PADDLE_API_KEY;
    expect((await s.confirm()).status).toBe(502);
  });
});

describe("webhook signature", () => {
  const raw = JSON.stringify({ event_type: "transaction.completed", data: {} });
  it("401 with no header", async () => {
    const s = await setup();
    expect((await s.call("/api/billing/paddle/webhook", { raw })).status).toBe(401);
  });
  it("401 on a wrong h1", async () => {
    const s = await setup();
    expect((await s.hookRaw(raw, `ts=${T0 / 1000};h1=00`)).status).toBe(401);
  });
  it("401 when ts is 10 minutes old", async () => {
    const s = await setup();
    expect((await s.hookRaw(raw, await s.sign(raw, T0 / 1000 - 600))).status).toBe(401);
  });
  it("401 on missing ts, missing h1, or non-numeric ts", async () => {
    const s = await setup();
    const h = await hmacHex(WH, `${T0 / 1000}:${raw}`);
    for (const sig of [`h1=${h}`, `ts=${T0 / 1000}`, `ts=abc;h1=${h}`]) {
      expect((await s.hookRaw(raw, sig)).status).toBe(401);
    }
  });
  it("401 when the secret is not set", async () => {
    const s = await setup();
    delete (s.env as any).PADDLE_WEBHOOK_SECRET;
    expect((await s.hookRaw(raw, await s.sign(raw))).status).toBe(401);
  });
  it("accepts when any of several h1 values verifies", async () => {
    const s = await setup();
    const ts = T0 / 1000;
    const good = await hmacHex(WH, `${ts}:${raw}`);
    expect((await s.hookRaw(raw, `ts=${ts};h1=00;h1=${good}`)).status).toBe(200);
  });
  it("200 for a signed body that is not JSON", async () => {
    const s = await setup();
    expect((await s.hookRaw("not json")).status).toBe(200);
  });
});

describe("webhook events", () => {
  it("transaction.completed grants; twice is one grant", async () => {
    const s = await setup();
    for (let i = 0; i < 2; i++) expect((await s.hook("transaction.completed", s.txn())).status).toBe(200);
    expect(await s.n("entitlements")).toBe(1);
    expect(await s.n("purchases")).toBe(1);
  });
  it("confirm then webhook is still one grant", async () => {
    const s = await setup();
    s.txns.txn_1 = s.txn();
    await s.confirm();
    await s.hook("transaction.completed", s.txn());
    expect(await s.n("entitlements")).toBe(1);
    expect(await s.n("purchases")).toBe(1);
  });
  it("keeps a payment for a deleted user, unlinked", async () => {
    const s = await setup();
    expect((await s.hook("transaction.completed", s.txn({ custom_data: { userId: "gone" } }))).status).toBe(200);
    expect(await s.n("purchases WHERE user_id IS NULL")).toBe(1);
    expect(await s.n("entitlements")).toBe(0);
  });
  it("200 and nothing recorded without a userId", async () => {
    const s = await setup();
    expect((await s.hook("transaction.completed", s.txn({ custom_data: null }))).status).toBe(200);
    expect(await s.n("purchases")).toBe(0);
  });
  it("200 and nothing recorded for an unknown price or currency", async () => {
    const s = await setup();
    await s.hook("transaction.completed", s.txn({ items: [{ price: { id: "pri_other" } }] }));
    await s.hook("transaction.completed", s.txn({ currency_code: "EUR" }));
    expect(await s.n("purchases")).toBe(0);
  });

  const adj = (o: Record<string, unknown> = {}) => ({
    id: "adj_1", transaction_id: "txn_1", status: "approved", action: "refund", ...o,
  });
  const granted = async () => {
    const s = await setup();
    await s.hook("transaction.completed", s.txn());
    expect(await tierFor(s.db, "u1", T0)).toBe("pass");
    return s;
  };
  it("adjustment.updated approved refund revokes", async () => {
    const s = await granted();
    expect((await s.hook("adjustment.updated", adj())).status).toBe(200);
    expect(await tierFor(s.db, "u1", T0)).toBe("free");
  });
  it("adjustment.created approved chargeback revokes", async () => {
    const s = await granted();
    expect((await s.hook("adjustment.created", adj({ action: "chargeback" }))).status).toBe(200);
    expect(await tierFor(s.db, "u1", T0)).toBe("free");
  });
  it("pending_approval refund changes nothing", async () => {
    const s = await granted();
    await s.hook("adjustment.created", adj({ status: "pending_approval" }));
    expect(await tierFor(s.db, "u1", T0)).toBe("pass");
  });
  it("credit action changes nothing", async () => {
    const s = await granted();
    await s.hook("adjustment.updated", adj({ action: "credit" }));
    expect(await tierFor(s.db, "u1", T0)).toBe("pass");
  });
  it("refund for an unknown transaction is 200", async () => {
    const s = await setup();
    expect((await s.hook("adjustment.updated", adj({ transaction_id: "txn_x" }))).status).toBe(200);
  });
  it("ignores other events", async () => {
    const s = await setup();
    expect((await s.hook("subscription.created", {})).status).toBe(200);
    expect(await s.n("purchases")).toBe(0);
  });
});
