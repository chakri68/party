import { providerFor } from "./billing/plans.ts";
import { json } from "./http.ts";
import type { ProductEnv } from "./env.ts";

/** Public settings the browser needs. Returns null for any other route. */
export function handleConfig(request: Request, env: ProductEnv): Response | null {
  if (request.method !== "GET" || new URL(request.url).pathname !== "/api/config") return null;
  const set = (v: string | undefined) => !!v && !v.startsWith("<");
  const gid = env.GOOGLE_CLIENT_ID ?? "";
  // wrangler.jsonc ships "<set at setup>" until a real client id is set.
  // Cloudflare sets CF-IPCountry at the edge; the landing page picks ₹ or $ from it.
  const country = request.headers.get("CF-IPCountry");
  // Public ids only. Secrets never go in this block. Null until the provider's
  // ids are real, so the page never shows a buy button that can't work.
  const provider = providerFor(country);
  const ready =
    provider === "razorpay"
      ? set(env.RAZORPAY_KEY_ID)
      : set(env.PADDLE_CLIENT_TOKEN) && set(env.PADDLE_PRICE_MONTH) && set(env.PADDLE_PRICE_YEAR);
  const billing =
    env.BILLING === "1" && ready
      ? {
          provider,
          razorpayKeyId: env.RAZORPAY_KEY_ID,
          paddle: { env: env.PADDLE_ENV, token: env.PADDLE_CLIENT_TOKEN, prices: { month: env.PADDLE_PRICE_MONTH, year: env.PADDLE_PRICE_YEAR } },
        }
      : null;
  return json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY, googleEnabled: set(gid), country, billing });
}
