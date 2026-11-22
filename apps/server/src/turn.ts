// TURN credentials from Cloudflare Realtime. Secrets never reach a log.

import type { IceServer } from "@games/protocol";

export const TURN_FETCH_TIMEOUT_MS = 3_000;

const PORT_53 = /:53(\?|$)/;

/** Undefined unless both secrets are set. */
export function turnMinter(
  env: { TURN_KEY_ID?: string; TURN_KEY_TOKEN?: string },
  fetchFn: typeof fetch = fetch,
): ((ttlSeconds: number) => Promise<IceServer[] | null>) | undefined {
  const { TURN_KEY_ID: keyId, TURN_KEY_TOKEN: token } = env;
  if (!keyId || !token) return undefined;
  const url = `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`;
  return async (ttlSeconds) => {
    try {
      const res = await fetchFn(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: ttlSeconds }),
        signal: AbortSignal.timeout(TURN_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { iceServers?: unknown };
      if (!Array.isArray(body?.iceServers)) return null;
      const out: IceServer[] = [];
      for (const s of body.iceServers as IceServer[]) {
        // Browsers time out on port 53, so those URLs only slow the connection down.
        const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => typeof u === "string" && !PORT_53.test(u));
        if (urls.length === 0) continue;
        out.push({ ...s, urls });
      }
      return out;
    } catch {
      return null;
    }
  };
}
