import type { PlanId, Provider } from "@games/product-server/billing-plans";

export type Plan = { source: string; startsAt?: number; endsAt: number | null };
export type Purchase = { plan: string; amount: number; currency: string; status: string; createdAt: number };
/** Signed out, only email (null) and tier come back. */
export type Me = { id?: string; email: string | null; tier: "free" | "pass"; plan?: Plan | null; purchases?: Purchase[] };
/** Public ids for checkout. Null on /api/config when billing is off or not set up. */
export type Billing = {
  provider: Provider;
  razorpayKeyId: string;
  paddle: { env: string; token: string; prices: { month: string; year: string } };
};
export type Config = { turnstileSiteKey: string; googleEnabled: boolean; country: string | null; billing: Billing | null };
export type Result = { ok: true } | { ok: false; error: string };

const FAIL = "Something went wrong. Please try again.";

async function post(path: string, body?: unknown, headers: Record<string, string> = {}, method = "POST"): Promise<Response> {
  return fetch(path, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function result(res: Response): Promise<Result> {
  if (res.ok) return { ok: true };
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return { ok: false, error: body?.error ?? FAIL };
}

export async function me(): Promise<Me> {
  try {
    const res = await fetch("/api/me");
    if (res.ok) return (await res.json()) as Me;
  } catch {}
  return { email: null, tier: "free" };
}

/** Like me(), but null when the call fails, so the account page can tell "signed out" from "could not load". */
export async function meOrNull(): Promise<Me | null> {
  try {
    const res = await fetch("/api/me");
    if (res.ok) return (await res.json()) as Me;
  } catch {}
  return null;
}

let config: Promise<Config> | null = null;
export function loadConfig(): Promise<Config> {
  config ??= fetch("/api/config").then((r) => r.json() as Promise<Config>);
  config.catch(() => (config = null));
  return config;
}

export async function createRoom(turnstileToken: string | null): Promise<{ code: string; hostKey: string } | { error: string }> {
  try {
    const res = await post("/api/rooms", undefined, turnstileToken ? { "x-turnstile-token": turnstileToken } : {});
    const body = (await res.json()) as { code?: string; hostKey?: string; error?: string };
    if (res.ok && body.code && body.hostKey) return { code: body.code, hostKey: body.hostKey };
    return { error: body.error ?? "Could not create a room." };
  } catch {
    return { error: FAIL };
  }
}

export async function upgradeRoom(code: string, hostKey: string): Promise<Result> {
  try {
    return await result(await post(`/api/rooms/${encodeURIComponent(code)}/upgrade`, { hostKey }));
  } catch {
    return { ok: false, error: FAIL };
  }
}

export async function redeem(code: string): Promise<Result> {
  try {
    return await result(await post("/api/account/redeem", { code }));
  } catch {
    return { ok: false, error: FAIL };
  }
}

export async function logout(): Promise<void> {
  await post("/api/auth/logout").catch(() => {});
}

export async function deleteAccount(): Promise<Result> {
  try {
    return await result(await post("/api/account", undefined, {}, "DELETE"));
  } catch {
    return { ok: false, error: FAIL };
  }
}

/** Spends a sign-in link's token. The server sets the session cookie and says where to go next. */
export async function spendLink(token: string): Promise<{ next: string } | { error: string }> {
  try {
    const res = await post("/api/auth/verify", { token });
    const body = (await res.json().catch(() => null)) as { next?: string; error?: string } | null;
    if (res.ok && typeof body?.next === "string") return { next: body.next };
    return { error: body?.error ?? FAIL };
  } catch {
    return { error: FAIL };
  }
}

export async function startEmailSignIn(email: string, next: string, turnstileToken: string): Promise<Result> {
  try {
    return await result(await post("/api/auth/email", { email, next, turnstileToken }));
  } catch {
    return { ok: false, error: FAIL };
  }
}

export type Order = { orderId: string; keyId: string; amount: number; currency: string; email: string };
/** What a confirm call says: paid, not settled yet, or an error. */
export type Confirm = { ok: true; plan: PlanId } | { pending: true } | { error: string };

export async function razorpayOrder(plan: PlanId): Promise<Order | { error: string }> {
  try {
    const res = await post("/api/billing/razorpay/order", { plan });
    const body = (await res.json().catch(() => null)) as (Order & { error?: string }) | null;
    if (res.ok && body?.orderId) return body;
    return { error: body?.error ?? FAIL };
  } catch {
    return { error: FAIL };
  }
}

async function confirm(path: string, payload: unknown): Promise<Confirm> {
  try {
    const res = await post(path, payload);
    const body = (await res.json().catch(() => null)) as { ok?: boolean; plan?: PlanId; pending?: boolean; error?: string } | null;
    if (res.status === 200 && body?.ok && body.plan) return { ok: true, plan: body.plan };
    if (res.status === 202 || body?.pending) return { pending: true };
    return { error: body?.error ?? FAIL };
  } catch {
    return { error: FAIL };
  }
}

export function razorpayConfirm(p: { orderId: string; paymentId: string; signature: string }): Promise<Confirm> {
  return confirm("/api/billing/razorpay/confirm", p);
}

export function paddleConfirm(transactionId: string): Promise<Confirm> {
  return confirm("/api/billing/paddle/confirm", { transactionId });
}
