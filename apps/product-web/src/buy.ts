// The browser half of buying Host Pass. India pays through Razorpay Checkout,
// everyone else through Paddle's overlay. Either way the server checks the
// payment (confirm) before it grants anything; the page only asks.

import { PLANS, isPlanId, plansFor, priceLabel, type PlanId } from "@games/product-server/billing-plans";
import { h } from "@games/ui";
import { loadConfig, me as apiMe, meOrNull, paddleConfirm, razorpayConfirm, razorpayOrder, type Billing, type Confirm, type Me } from "./api.ts";

export type BuyOutcome = "done" | "closed" | "pending" | "failed";
export type SheetMode = "sign-in" | "use-pass" | "buy" | "code-only" | "not-host";

export const PAY_PENDING = "Finishing your payment…";
export const PAY_SLOW = "We got your payment. Your pass will show up in a minute.";
export const PAY_LATE = "Your payment went through, but your pass is late. Email hello@couchpartygames.com and we will fix it fast.";
export const PAY_DONE = "Payment done. All games are open now, for everyone in this room, and up to 16 players can join when the game allows it.";
export const PAY_DOWN = "Payments are not working right now. Please try again.";

const RAZORPAY_JS = "https://checkout.razorpay.com/v1/checkout.js";
const PADDLE_JS = "https://cdn.paddle.com/paddle/v2/paddle.js";
const POLL_MS = 3000;
const POLL_TRIES = 20;

/** `path` with `?buy=<plan>` set, keeping whatever query it already has. */
export function withBuy(path: string, plan: PlanId): string {
  const u = new URL(path, "http://x");
  u.searchParams.set("buy", plan);
  return u.pathname + u.search + u.hash;
}

/**
 * Reads `?buy=<plan>` and takes it out of the address bar right away, so a
 * reload can't start a second purchase. Junk plans are stripped too.
 */
export function takeBuyParam(
  url: URL,
  replace: (path: string) => void = (p) => history.replaceState(history.state, "", p),
): PlanId | null {
  if (!url.searchParams.has("buy")) return null;
  const raw = url.searchParams.get("buy");
  const clean = new URL(url);
  clean.searchParams.delete("buy");
  replace(clean.pathname + clean.search + clean.hash);
  return isPlanId(raw) ? raw : null;
}

/**
 * Money moved but the pass isn't confirmed yet (a 202, or confirm failed on
 * the way back). The webhook will get there; poll /api/me until a purchase
 * row newer than `before` shows up. Counting rows, not tier, so it also
 * works for someone who already had a pass.
 */
export async function waitForPass(
  before: number,
  deps: { me(): Promise<Me>; sleep(ms: number): Promise<void> } = { me: apiMe, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
): Promise<"done" | "pending"> {
  for (let i = 0; i < POLL_TRIES; i++) {
    if (i) await deps.sleep(POLL_MS);
    if (((await deps.me()).purchases?.length ?? 0) > before) return "done";
  }
  return "pending";
}

/** What the upgrade sheet shows. Non-hosts never get buy buttons: they'd pay for a room they can't lift. */
export function sheetMode(m: Me, isHost: boolean, billing: Billing | null): SheetMode {
  if (m.email === null) return "sign-in";
  if (!isHost) return "not-host";
  if (m.tier === "pass") return "use-pass";
  return billing ? "buy" : "code-only";
}

/** One button per plan this provider sells: "30 days · ₹149". */
export function planButtons(billing: Billing, onPick: (p: PlanId) => void): HTMLElement {
  return h(
    "div",
    { class: "plan-btns" },
    plansFor(billing.provider).map((p) =>
      h("button", { type: "button", class: "plan-btn primary", onclick: () => onPick(p) }, `${PLANS[p].length} · ${priceLabel(p, billing.provider)}`),
    ),
  );
}

// --- Provider scripts: injected on first buy, never at page load. ---

const scripts = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  let p = scripts.get(src);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        s.remove();
        reject(new Error(`could not load ${src}`));
      };
      document.head.append(s);
    });
    // A failed load is forgotten, so the next tap tries again.
    p.catch(() => scripts.delete(src));
    scripts.set(src, p);
  }
  return p;
}

type RazorpayResponse = { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };
type RazorpayCtor = new (opts: Record<string, unknown>) => { open(): void };
type PaddleEvent = { name?: string; data?: { transaction_id?: string } };
type PaddleJs = {
  Environment: { set(env: string): void };
  Initialize(opts: { token: string; eventCallback(e: PaddleEvent): void }): void;
  Checkout: { open(opts: Record<string, unknown>): void; close(): void };
};
declare global {
  interface Window {
    Razorpay?: RazorpayCtor;
    Paddle?: PaddleJs;
  }
}

export type BuyOpts = {
  /** Where to land after sign-in, if they turn out to be signed out. */
  returnTo: string;
  /** Called with the text to show when the outcome is "failed". */
  onError?: (msg: string) => void;
  /** Called when the payment went through and we start waiting for the pass. */
  onWait?: () => void;
};

/**
 * Runs one purchase. "failed" only ever means nothing was charged. Once the
 * checkout says it took the money, any later trouble goes to waitForPass.
 */
export async function buy(plan: PlanId, opts: BuyOpts): Promise<BuyOutcome> {
  const fail = (msg = PAY_DOWN): BuyOutcome => (opts.onError?.(msg), "failed");
  const [m, billing] = await Promise.all([meOrNull(), loadConfig().then((c) => c.billing, () => null)]);
  if (!m) return fail();
  if (m.email === null) {
    location.assign("/account?next=" + encodeURIComponent(withBuy(opts.returnTo, plan)));
    return new Promise<never>(() => {});
  }
  if (!billing || !plansFor(billing.provider).includes(plan)) return fail();
  const before = m.purchases?.length ?? 0;
  const settle = async (c: Promise<Confirm>): Promise<BuyOutcome> => {
    if ("ok" in (await c)) return "done";
    opts.onWait?.();
    return waitForPass(before);
  };
  return billing.provider === "razorpay" ? viaRazorpay(plan, settle, fail) : viaPaddle(plan, m, billing, settle, fail);
}

type Settle = (c: Promise<Confirm>) => Promise<BuyOutcome>;
type Fail = (msg?: string) => BuyOutcome;

async function viaRazorpay(plan: PlanId, settle: Settle, fail: Fail): Promise<BuyOutcome> {
  const order = await razorpayOrder(plan);
  if ("error" in order) return fail(order.error);
  try {
    await loadScript(RAZORPAY_JS);
  } catch {
    return fail();
  }
  const Razorpay = window.Razorpay;
  if (!Razorpay) return fail();
  return new Promise<BuyOutcome>((resolve) => {
    const opts = {
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amount,
      currency: order.currency,
      name: "CouchParty",
      description: `Host Pass, ${PLANS[plan].length}`,
      prefill: { email: order.email },
      theme: { color: "#c6f432" },
      handler: (r: RazorpayResponse) =>
        resolve(settle(razorpayConfirm({ orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature }))),
      modal: { ondismiss: () => resolve("closed") },
    };
    try {
      new Razorpay(opts).open();
    } catch {
      resolve(fail());
    }
  });
}

// Paddle takes one eventCallback, at Initialize. It hands each event to
// whichever checkout is open now.
let paddleReady = false;
let paddleListener: ((e: PaddleEvent) => void) | null = null;

async function viaPaddle(plan: PlanId, m: Me, billing: Billing, settle: Settle, fail: Fail): Promise<BuyOutcome> {
  if (plan === "day") return fail();
  try {
    await loadScript(PADDLE_JS);
  } catch {
    return fail();
  }
  const Paddle = window.Paddle;
  if (!Paddle) return fail();
  if (!paddleReady) {
    // If the script loaded but won't start, nothing was charged yet.
    try {
      if (billing.paddle.env === "sandbox") Paddle.Environment.set("sandbox");
      Paddle.Initialize({ token: billing.paddle.token, eventCallback: (e) => paddleListener?.(e) });
    } catch {
      return fail();
    }
    paddleReady = true;
  }
  return new Promise<BuyOutcome>((resolve) => {
    paddleListener = (e) => {
      if (e.name === "checkout.completed" && e.data?.transaction_id) {
        paddleListener = null;
        const txn = e.data.transaction_id;
        // Our sheet says what happens next; the overlay's own success page would cover it.
        Paddle.Checkout.close();
        resolve(settle(paddleConfirm(txn)));
      } else if (e.name === "checkout.closed") {
        paddleListener = null;
        resolve("closed");
      }
    };
    try {
      Paddle.Checkout.open({
        items: [{ priceId: billing.paddle.prices[plan], quantity: 1 }],
        customer: { email: m.email },
        customData: { userId: m.id },
        settings: { displayMode: "overlay", theme: "light" },
      });
    } catch {
      paddleListener = null;
      resolve(fail());
    }
  });
}
