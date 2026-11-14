// The seam a host app uses to reshape the web client without forking it.
// `main.ts` calls `startShell({})`; another app imports `@games/web/shell` and
// passes its own options. Nothing here touches `document` until startShell runs.

import { overrideGameNames } from "./games.ts";
import { claimOwnerKeyFromUrl, getOwnerKey } from "./identity.ts";
import { watchKeyboard } from "./keyboard.ts";
import { register, start } from "./router.ts";
import { HomeView } from "./views/home.ts";
import type { PartyOverHook } from "./views/recap.ts";
import { RoomView } from "./views/room.ts";
import "./style.css";

/** The wordmark in the home hero and the room header, and where the header's links. */
export interface ShellBrand {
  /** Lowercase words; the hero breaks the line at each space. */
  wordmark: string;
  homeHref: string;
  /** The room header link's accessible name. */
  label: string;
}

export interface ShellOptions {
  homePath?: string;
  brand?: ShellBrand;
  appTitle?: string;
  canCreate?: () => boolean;
  createRoom?: () => Promise<{ code: string } | { error: string; forgetKey?: boolean }>;
  hostKeyFor?: (code: string) => string | null;
  onLockedGame?: (gameId: string, code: string) => void;
  nameOverrides?: Record<string, string>;
  beforeStart?: (outlet: HTMLElement) => void;
  /**
   * Fills the slot under the party recap, and under "this room is closed"
   * (`recap: null` there). Without it the shell shows a Home button.
   */
  partyOver?: PartyOverHook;
}

type Config = Required<Omit<ShellOptions, "nameOverrides" | "beforeStart" | "partyOver">> & Pick<ShellOptions, "partyOver">;

/** Today's behaviour: the owner key opens the room. */
async function defaultCreateRoom(): Promise<{ code: string } | { error: string; forgetKey?: boolean }> {
  const res = await fetch("/api/rooms", {
    method: "POST",
    headers: { authorization: `Bearer ${getOwnerKey() ?? ""}` },
  });
  const body = (await res.json()) as { code?: string; error?: string };
  if (res.ok && body.code) return { code: body.code };
  // Wrong or rotated key: the caller forgets it so the unlock form comes back.
  return { error: body.error ?? "Couldn't create a room.", forgetKey: res.status === 403 };
}

const defaults: Config = {
  homePath: "/",
  appTitle: "Party Games",
  brand: { wordmark: "party games", homeHref: "/", label: "Party Games home" },
  canCreate: () => !!getOwnerKey(),
  createRoom: defaultCreateRoom,
  hostKeyFor: () => getOwnerKey(),
  onLockedGame: () => {},
};

let config: Config = defaults;

export function shellConfig(): Config {
  return config;
}

export function configure(opts: ShellOptions): void {
  const { nameOverrides: _n, beforeStart: _b, ...rest } = opts;
  const set = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  config = { ...defaults, ...set };
}

export function startShell(opts: ShellOptions): void {
  configure(opts);
  if (opts.nameOverrides) overrideGameNames(opts.nameOverrides);
  register(config.homePath, () => new HomeView());
  register("/room/:code", (params) => new RoomView(params));
  claimOwnerKeyFromUrl();
  watchKeyboard();
  const outlet = document.getElementById("app")!;
  opts.beforeStart?.(outlet);
  start(outlet);
}

export { overrideGameNames };
