import { PRODUCT_NAMES } from "@games/product-server/catalog-data";
import { startShell } from "@games/web/shell";
import "@games/web/style.css";
import { createRoom as apiCreateRoom, me, upgradeRoom } from "./api.ts";
import { mountHeader } from "./header.ts";
import { hostKeyFor, saveHostKey } from "./host-keys.ts";
import { openPassSheet } from "./pass-sheet.ts";
import { finishUpgrade } from "./upgrade-return.ts";
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

const notUpgraded = await finishUpgrade(new URL(location.href), {
  hostKeyFor,
  upgradeRoom,
  replaceUrl: (path) => history.replaceState(history.state, "", path),
});
startShell({
  homePath: "/play",
  appTitle: "CouchParty",
  brand: { wordmark: "CouchParty", homeHref: "/", label: "CouchParty home" },
  canCreate: () => true,
  createRoom,
  hostKeyFor,
  onLockedGame: openPassSheet,
  nameOverrides: PRODUCT_NAMES,
  beforeStart: mountHeader,
});
if (notUpgraded) openPassSheet("", notUpgraded);
