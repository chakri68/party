import { json } from "./http.ts";
import type { ProductEnv } from "./env.ts";

/** Public settings the browser needs. Returns null for any other route. */
export function handleConfig(request: Request, env: ProductEnv): Response | null {
  if (request.method !== "GET" || new URL(request.url).pathname !== "/api/config") return null;
  const gid = env.GOOGLE_CLIENT_ID ?? "";
  // wrangler.jsonc ships "<set at setup>" until a real client id is set.
  return json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY, googleEnabled: gid !== "" && !gid.startsWith("<") });
}
