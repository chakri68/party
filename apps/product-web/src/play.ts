import { PRODUCT_NAMES } from "@games/product-server/catalog-data";
import { startShell } from "@games/web/shell";
import "@games/web/style.css";
import { createRoom as apiCreateRoom, me, upgradeRoom } from "./api.ts";
import { mountHeader } from "./header.ts";
import { hostKeyFor, saveHostKey } from "./host-keys.ts";
import { openPassSheet } from "./pass-sheet.ts";
import "./product.css";
import { getTurnstileToken } from "./turnstile.ts";

async function createRoom(): Promise<{ code: string } | { error: string; forgetKey?: boolean }> {
  let token: string | null = null;
  if ((await me()).tier === "free") {
    try {
      token = await getTurnstileToken();
    } catch {
      return { error: "Could not check you are human. Please try again." };
    }
  }
  const r = await apiCreateRoom(token);
  if ("error" in r) return r;
  saveHostKey(r.code, r.hostKey);
  return { code: r.code };
}

/** Back from sign-in with ?upgrade=1: lift this room, then clean the URL. */
async function finishUpgrade(): Promise<void> {
  const url = new URL(location.href);
  if (url.searchParams.get("upgrade") !== "1") return;
  const code = /^\/room\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  const key = code ? hostKeyFor(code) : null;
  if (code && key) await upgradeRoom(code, key).catch(() => {});
  url.searchParams.delete("upgrade");
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
}

await finishUpgrade();
startShell({
  homePath: "/play",
  appTitle: "CouchParty",
  canCreate: () => true,
  createRoom,
  hostKeyFor,
  onLockedGame: openPassSheet,
  nameOverrides: PRODUCT_NAMES,
  beforeStart: mountHeader,
});
