import { userFromRequest } from "../auth.ts";
import type { ProductEnv } from "../env.ts";
import { json } from "../http.ts";
import { verifyHmacHex } from "./hmac.ts";
import { planForPaddlePrice, type PlanId } from "./plans.ts";
import { recordPaid, refundByRef } from "./purchases.ts";

const PREFIX = "/api/billing/paddle/";
const DOWN = "Payments are not working right now. Please try again.";
const WINDOW_SECONDS = 300;

export type PaddleTxn = {
  id: string;
  status: string;
  custom_data: { userId?: string } | null;
  currency_code: string;
  items: Array<{ price: { id: string } }>;
  details: { totals: { grand_total: string } };
};

export interface PaddleDeps {
  now(): number;
  /** Null when Paddle has no such transaction. Throws on network errors and other non-2xx. */
  getTransaction(id: string): Promise<PaddleTxn | null>;
}

export function realPaddleDeps(env: ProductEnv): PaddleDeps {
  const base = env.PADDLE_ENV === "sandbox" ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";
  return {
    now: () => Date.now(),
    getTransaction: async (id) => {
      const res = await fetch(`${base}/transactions/${encodeURIComponent(id)}`, {
        headers: { authorization: `Bearer ${env.PADDLE_API_KEY ?? ""}` },
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`paddle ${res.status}`);
      return ((await res.json()) as { data: PaddleTxn }).data;
    },
  };
}

const down = () => json({ error: DOWN }, 502);
const bad = (error: string) => json({ error }, 400);

/** One item, at one of our prices, in dollars. Returns the plan, or null. */
function planIfValid(t: PaddleTxn, env: ProductEnv): PlanId | null {
  if (t?.items?.length !== 1) return null;
  // Our prices are USD only. The total itself includes tax, so it is not checked; the price id is the guard.
  if (t.currency_code !== "USD") return null;
  return planForPaddlePrice(String(t.items[0]?.price?.id ?? ""), env);
}

const isPaid = (status: unknown) => status === "paid" || status === "completed";

const record = (env: ProductEnv, deps: PaddleDeps, t: PaddleTxn, plan: PlanId, userId: string) =>
  recordPaid(
    env.DB,
    { provider: "paddle", ref: t.id, plan, amount: Number(t.details.totals.grand_total), currency: "USD", userId },
    deps.now(),
  );

export async function handlePaddle(request: Request, env: ProductEnv, deps: PaddleDeps): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith(PREFIX)) return null;
  if (env.BILLING !== "1") return json({ error: "Not found" }, 404);
  const route = path.slice(PREFIX.length);
  if (request.method !== "POST" || !["confirm", "webhook"].includes(route)) return json({ error: "Not found" }, 404);
  if (route === "webhook") return webhook(request, env, deps);

  const user = await userFromRequest(env.DB, request, deps.now());
  if (!user) return json({ error: "Sign in first." }, 401);
  if (!env.PADDLE_API_KEY) return down();
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const id = body.transactionId;
  if (typeof id !== "string" || !id) return bad("Bad request.");

  // Don't trust the browser: ask Paddle what was paid.
  let txn: PaddleTxn | null;
  try {
    txn = await deps.getTransaction(id);
  } catch {
    return down();
  }
  if (!txn) return bad("Payment could not be checked.");
  const plan = planIfValid(txn, env);
  if (!plan || txn.custom_data?.userId !== user.id) return bad("Payment could not be checked.");
  // Not paid yet. The webhook grants when it completes.
  if (txn.status === "ready" || txn.status === "draft") return json({ pending: true }, 202);
  if (!isPaid(txn.status)) return bad("Payment did not go through.");
  await record(env, deps, txn, plan, user.id);
  return json({ ok: true, plan });
}

/** `Paddle-Signature: ts=<unix>;h1=<hex>`. Several h1 values appear during a secret rotation. */
function parseSignature(header: string): { ts: number; h1: string[] } | null {
  const h1: string[] = [];
  let ts: string | null = null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "ts") ts = v;
    else if (k === "h1") h1.push(v);
  }
  if (ts === null || !/^\d+$/.test(ts) || h1.length === 0) return null;
  return { ts: Number(ts), h1 };
}

async function signatureOk(request: Request, env: ProductEnv, deps: PaddleDeps, raw: string): Promise<boolean> {
  const header = request.headers.get("paddle-signature");
  if (!env.PADDLE_WEBHOOK_SECRET || !header) return false;
  const sig = parseSignature(header);
  if (!sig || Math.abs(deps.now() / 1000 - sig.ts) > WINDOW_SECONDS) return false;
  for (const h of sig.h1) {
    if (await verifyHmacHex(env.PADDLE_WEBHOOK_SECRET, `${sig.ts}:${raw}`, h)) return true;
  }
  return false;
}

async function webhook(request: Request, env: ProductEnv, deps: PaddleDeps): Promise<Response> {
  const raw = await request.text();
  if (!(await signatureOk(request, env, deps, raw))) return json({ error: "Bad signature" }, 401);
  let evt: any;
  try {
    evt = JSON.parse(raw);
  } catch {
    return json({ ok: true });
  }
  const event = String(evt?.event_type);
  const data = evt?.data;
  const ok = json({ ok: true });

  if (event === "transaction.completed") {
    const plan = data && isPaid(data.status) ? planIfValid(data, env) : null;
    // custom_data comes from the browser, so it may name any account. That's fine:
    // the payment really happened, and the payer chose whose account it credits.
    const userId = data?.custom_data?.userId;
    if (!plan || typeof data.id !== "string") {
      console.warn("paddle webhook: check failed", event, data?.id);
      return ok;
    }
    if (typeof userId !== "string" || !userId) {
      console.warn("paddle webhook: no userId", event, data.id);
      return ok;
    }
    await record(env, deps, data, plan, userId);
    return ok;
  }

  if (event === "adjustment.created" || event === "adjustment.updated") {
    if (data?.status !== "approved" || !["refund", "chargeback"].includes(data?.action)) return ok;
    if (typeof data.transaction_id !== "string") return ok;
    const r = await refundByRef(env.DB, "paddle", data.transaction_id, deps.now());
    if (r === "unknown") console.warn("paddle webhook: refund for unknown transaction", event, data.transaction_id);
    return ok;
  }

  console.warn("paddle webhook: ignored", event);
  return ok;
}
