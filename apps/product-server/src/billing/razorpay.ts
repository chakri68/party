import { userFromRequest } from "../auth.ts";
import { newId } from "../db.ts";
import type { ProductEnv } from "../env.ts";
import { json } from "../http.ts";
import { verifyHmacHex } from "./hmac.ts";
import { isPlanId, PLANS, type PlanId } from "./plans.ts";
import { recordPaid, refundByRef } from "./purchases.ts";

const PREFIX = "/api/billing/razorpay/";
const API = "https://api.razorpay.com";
const DOWN = "Payments are not working right now. Please try again.";

export interface RazorpayDeps {
  now(): number;
  api(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: any }>;
}

export function realRazorpayDeps(env: ProductEnv): RazorpayDeps {
  return {
    now: () => Date.now(),
    api: async (method, path, body) => {
      const auth = btoa(`${env.RAZORPAY_KEY_ID ?? ""}:${env.RAZORPAY_KEY_SECRET ?? ""}`);
      try {
        const res = await fetch(API + path, {
          method,
          headers: { authorization: `Basic ${auth}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { status: res.status, body: await res.json().catch(() => null) };
      } catch {
        // Network failure reads as the provider being down.
        return { status: 502, body: null };
      }
    },
  };
}

const down = () => json({ error: DOWN }, 502);
/** 200 is an answer and 404 is a final "no". Anything else (401, 429, 5xx) is us or them failing. */
const failed = (status: number) => status !== 200 && status !== 404;
const bad = (error: string) => json({ error }, 400);

/** The payment is for this order, at the plan's price, in rupees. Returns the plan, or null. */
function planIfValid(payment: any, order: any, orderId: string): PlanId | null {
  const plan = order?.notes?.plan;
  if (!isPlanId(plan)) return null;
  if (payment?.order_id !== orderId) return null;
  if (payment.amount !== PLANS[plan].inr || payment.currency !== "INR") return null;
  return plan;
}

export async function handleRazorpay(request: Request, env: ProductEnv, deps: RazorpayDeps): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith(PREFIX)) return null;
  if (env.BILLING !== "1") return json({ error: "Not found" }, 404);
  const route = path.slice(PREFIX.length);
  if (request.method !== "POST" || !["order", "confirm", "webhook"].includes(route)) return json({ error: "Not found" }, 404);
  if (route === "webhook") return webhook(request, env, deps);

  const user = await userFromRequest(env.DB, request, deps.now());
  if (!user) return json({ error: "Sign in first." }, 401);
  if (!env.RAZORPAY_KEY_SECRET || !env.RAZORPAY_KEY_ID) return down();
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;

  if (route === "order") {
    const plan = body.plan;
    if (!isPlanId(plan)) return bad("Pick a plan.");
    const amount = PLANS[plan].inr;
    const r = await deps.api("POST", "/v1/orders", {
      amount, currency: "INR", receipt: newId(), notes: { userId: user.id, plan },
    });
    if (r.status < 200 || r.status >= 300 || typeof r.body?.id !== "string") return down();
    return json({ orderId: r.body.id, keyId: env.RAZORPAY_KEY_ID, amount, currency: "INR", email: user.email });
  }

  // confirm
  const { orderId, paymentId, signature } = body;
  if (typeof orderId !== "string" || typeof paymentId !== "string" || typeof signature !== "string") return bad("Bad request.");
  if (!(await verifyHmacHex(env.RAZORPAY_KEY_SECRET, `${orderId}|${paymentId}`, signature))) return bad("Payment could not be checked.");
  // Don't trust the browser: ask Razorpay what was paid.
  const pay = await deps.api("GET", `/v1/payments/${encodeURIComponent(paymentId)}`);
  if (failed(pay.status)) return down();
  const ord = await deps.api("GET", `/v1/orders/${encodeURIComponent(orderId)}`);
  if (failed(ord.status)) return down();
  if (pay.status !== 200 || ord.status !== 200) return bad("Payment could not be checked.");
  const plan = planIfValid(pay.body, ord.body, orderId);
  if (!plan || ord.body.notes.userId !== user.id) return bad("Payment could not be checked.");
  // Authorized is not money yet. The webhook grants when it is captured.
  if (pay.body.status === "authorized") return json({ pending: true }, 202);
  if (pay.body.status !== "captured") return bad("Payment did not go through.");
  await recordPaid(
    env.DB,
    { provider: "razorpay", ref: paymentId, plan, amount: pay.body.amount, currency: "INR", userId: user.id },
    deps.now(),
  );
  return json({ ok: true, plan });
}

async function webhook(request: Request, env: ProductEnv, deps: RazorpayDeps): Promise<Response> {
  const raw = await request.text();
  const sig = request.headers.get("x-razorpay-signature");
  if (!env.RAZORPAY_WEBHOOK_SECRET || !sig || !(await verifyHmacHex(env.RAZORPAY_WEBHOOK_SECRET, raw, sig))) {
    return json({ error: "Bad signature" }, 401);
  }
  let evt: any;
  try {
    evt = JSON.parse(raw);
  } catch {
    return json({ ok: true });
  }
  const event = String(evt?.event);
  const ok = json({ ok: true });

  if (event === "refund.processed") {
    const paymentId = evt.payload?.refund?.entity?.payment_id;
    if (typeof paymentId !== "string") return ok;
    const r = await refundByRef(env.DB, "razorpay", paymentId, deps.now());
    if (r === "unknown") console.warn("razorpay webhook: refund for unknown payment", event, paymentId);
    return ok;
  }

  if (event === "payment.captured") {
    const pay = evt.payload?.payment?.entity;
    const paymentId = pay?.id;
    const orderId = pay?.order_id;
    if (typeof paymentId !== "string" || typeof orderId !== "string") {
      console.warn("razorpay webhook: no payment ids", event);
      return ok;
    }
    const ord = await deps.api("GET", `/v1/orders/${encodeURIComponent(orderId)}`);
    // The money is taken. Only a 404 order or a failed check below is final;
    // a 401, 429 or 5xx gets a 500 so Razorpay retries instead of us dropping it.
    if (failed(ord.status)) {
      console.warn("razorpay webhook: order fetch failed, will retry", event, paymentId, orderId, ord.status);
      return json({ error: DOWN }, 500);
    }
    const plan = ord.status === 200 ? planIfValid(pay, ord.body, orderId) : null;
    const userId = ord.body?.notes?.userId;
    if (!plan || typeof userId !== "string") {
      console.warn("razorpay webhook: check failed", event, paymentId, orderId);
      return ok;
    }
    await recordPaid(env.DB, { provider: "razorpay", ref: paymentId, plan, amount: pay.amount, currency: "INR", userId }, deps.now());
    return ok;
  }

  console.warn("razorpay webhook: ignored", event);
  return ok;
}
