// The Host Pass plans, shared by the server (what to charge) and the web
// (what to show). Amounts are minor units: paise for INR, cents for USD.

export type PlanId = "day" | "month" | "year";
export type Provider = "razorpay" | "paddle";

export const PLANS: Record<PlanId, { days: number; length: string; inr: number; usd: number | null }> = {
  day: { days: 1, length: "24 hours", inr: 4900, usd: null },
  month: { days: 30, length: "30 days", inr: 14900, usd: 499 },
  year: { days: 365, length: "365 days", inr: 99900, usd: 3900 },
};

export function isPlanId(x: unknown): x is PlanId {
  return x === "day" || x === "month" || x === "year";
}

/** India pays through Razorpay. Everyone else, and unknown, through Paddle. */
export function providerFor(country: string | null): Provider {
  return country === "IN" ? "razorpay" : "paddle";
}

/** No dollar day pass: Paddle's fixed fee would eat a third of it. */
export function plansFor(provider: Provider): PlanId[] {
  return provider === "razorpay" ? ["day", "month", "year"] : ["month", "year"];
}

function major(minor: number): string {
  const units = minor / 100;
  return Number.isInteger(units) ? String(units) : units.toFixed(2);
}

export function priceLabel(plan: PlanId, provider: Provider): string {
  if (provider === "razorpay") return `₹${major(PLANS[plan].inr)}`;
  const usd = PLANS[plan].usd;
  if (usd === null) throw new Error(`no dollar price for ${plan}`);
  return `$${major(usd)}`;
}

/** Paddle price ids live in env, not code, so sandbox and live can differ. */
export function planForPaddlePrice(
  priceId: string,
  env: { PADDLE_PRICE_MONTH?: string; PADDLE_PRICE_YEAR?: string },
): PlanId | null {
  if (!priceId) return null;
  if (priceId === env.PADDLE_PRICE_MONTH) return "month";
  if (priceId === env.PADDLE_PRICE_YEAR) return "year";
  return null;
}
