import type { Result } from "./api.ts";

export interface UpgradeReturnDeps {
  hostKeyFor(code: string): string | null;
  upgradeRoom(code: string, hostKey: string): Promise<Result>;
  replaceUrl(path: string): void;
}

/**
 * Back from sign-in with ?upgrade=1: lift this room, then clean the URL.
 * Returns the room code when that did not work (no Host Pass yet, or this
 * browser is not the host), so the pass sheet can say what to do next.
 */
export async function finishUpgrade(url: URL, deps: UpgradeReturnDeps): Promise<string | null> {
  if (url.searchParams.get("upgrade") !== "1") return null;
  const code = /^\/room\/([^/]+)\/?$/.exec(url.pathname)?.[1]?.toUpperCase() ?? null;
  const clean = new URL(url);
  clean.searchParams.delete("upgrade");
  deps.replaceUrl(clean.pathname + clean.search + clean.hash);
  if (!code) return null;
  const key = deps.hostKeyFor(code);
  const r = key ? await deps.upgradeRoom(code, key) : { ok: false as const, error: "no host key" };
  if (r.ok) return null;
  console.warn("Room upgrade failed:", r.error);
  return code;
}
