import { providerFor } from "./billing/plans.ts";
import { json } from "./http.ts";
import type { ProductEnv } from "./env.ts";

/** Public settings the browser needs. Returns null for any other route. */
export function handleConfig(request: Request, env: ProductEnv): Response | null {
  if (request.method !== "GET" || new URL(request.url).pathname !== "/api/config") return null;
  const gid = env.GOOGLE_CLIENT_ID ?? "";
  // wrangler.jsonc ships "<set at setup>" until a real client id is set.
  // Cloudflare sets CF-IPCountry at the edge; the landing page picks ₹ or $ from it.
  const country = request.headers.get("CF-IPCountry");
  // Public ids only. Secrets never go in this block.
  const billing =
    env.BILLING === "1"
      ? {
          provider: providerFor(country),
          razorpayKeyId: env.RAZORPAY_KEY_ID,
          paddle: { env: env.PADDLE_ENV, token: env.PADDLE_CLIENT_TOKEN, prices: { month: env.PADDLE_PRICE_MONTH, year: env.PADDLE_PRICE_YEAR } },
        }
      : null;
  return json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY, googleEnabled: gid !== "" && !gid.startsWith("<"), country, billing });
}
