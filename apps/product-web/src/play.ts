import { PRODUCT_NAMES } from "@games/product-server/catalog-data";
import { roomsPath, startShell } from "@games/web/shell";
import "@games/web/style.css";
import { createRoom as apiCreateRoom, me, upgradeRoom } from "./api.ts";
import { takeBuyParam } from "./buy.ts";
import { mountFooter, mountHeader, PLAY_CREATE_TEXT, PLAY_HOME, watchStartPage } from "./header.ts";
import { fadeIn } from "./motion.ts";
import { hostKeyFor, saveHostKey } from "./host-keys.ts";
import { partyOver } from "./party-over.ts";
import { openPassSheet } from "./pass-sheet.ts";
import { finishUpgrade } from "./upgrade-return.ts";
import "./product.css";
import { getTurnstileToken, warmTurnstile } from "./turnstile.ts";
import { roomCreator } from "./create-room.ts";

const whenIdle = (f: () => void) => ("requestIdleCallback" in window ? requestIdleCallback(() => f(), { timeout: 3000 }) : setTimeout(f, 1500));

// One account check on load: the header shows it, and the first new room uses it.
const account = me();
const createRoom = roomCreator(account, {
  me,
  token: getTurnstileToken,
  create: (token, setup) => apiCreateRoom(token, roomsPath(setup)),
  save: saveHostKey,
});
// A free host needs Turnstile to make a room: have its script ready before the tap.
// Not on a room link: someone joining never makes a room.
if (location.pathname === "/play") {
  void account.then((m) => {
    if (m.tier === "free") whenIdle(warmTurnstile);
  });
}

// Back from sign-in with ?buy=<plan>: take it out of the address first, so
// a reload can't start a second checkout. The sheet starts it once, below.
const buyPlan = takeBuyParam(new URL(location.href));
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
  partyOver,
  nameOverrides: PRODUCT_NAMES,
  createText: PLAY_CREATE_TEXT,
  home: PLAY_HOME,
  // My sounds goes by the session cookie, which a same-origin fetch sends by itself.
  soundsAuth: () => ({}),
  beforeStart: (outlet) => {
    // The shell's views append into #app, so the HTML's loader goes by hand.
    outlet.querySelector(".cp-loader")?.remove();
    mountHeader(outlet, account);
    watchStartPage(outlet);
    mountFooter(outlet);
    // The shell draws its first screen after the page has already faded in
    // empty; fade the content up too so it doesn't just appear.
    fadeIn(outlet);
  },
});
// Only when the room is still free: a host who already had a pass is done.
if (notUpgraded) openPassSheet("", notUpgraded, buyPlan ? { buy: buyPlan } : {});
