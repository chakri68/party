// The seam a host app uses to reshape the web client without forking it.
// `main.ts` calls `startShell({})`; another app imports `@games/web/shell` and
// passes its own options. Nothing here touches `document` until startShell runs.

import { games, overrideGameNames } from "./games.ts";
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

/** A room that starts on a game with computers seated. Same shape as the server's. */
export interface RoomSetup {
  gameId: string;
  computers?: number;
}

export type CreateRoomResult = { code: string } | { error: string; forgetKey?: boolean };

/** The setup a link asks for: only for a game that has computers. A bad count is left out. */
export function setupFromUrl(url: URL): RoomSetup | undefined {
  const gameId = url.searchParams.get("game") ?? "";
  if (!Object.hasOwn(games, gameId) || !games[gameId]?.manifest.computers) return undefined;
  const raw = url.searchParams.get("computers") ?? "";
  const n = /^\d+$/.test(raw) ? Number(raw) : 0;
  return Number.isSafeInteger(n) && n > 0 ? { gameId, computers: n } : { gameId };
}

/** The create button's text. */
export function createLabel(setup: RoomSetup | undefined): string {
  return setup ? `Play ${(Object.hasOwn(games, setup.gameId) && games[setup.gameId]?.manifest.name) || "a game"} with computers` : "Create room";
}

/** The home page's own words, for a host app. Each part is optional. */
export interface ShellHome {
  /** Replaces the logo and wordmark in the home hero with this heading. */
  title?: string;
  /** Replaces the line under the hero heading. */
  subtitle?: string;
  /** The browser tab title on the home page. */
  pageTitle?: string;
}

export interface ShellOptions {
  homePath?: string;
  brand?: ShellBrand;
  appTitle?: string;
  /** The home Create button's text. Without it, `createLabel` picks it from the room setup. */
  createText?: string;
  /** The home page's heading, subtitle and tab title. Without it, the logo and the usual lines show. */
  home?: ShellHome;
  canCreate?: () => boolean;
  createRoom?: (setup?: RoomSetup) => Promise<CreateRoomResult>;
  hostKeyFor?: (code: string) => string | null;
  onLockedGame?: (gameId: string, code: string) => void;
  nameOverrides?: Record<string, string>;
  beforeStart?: (outlet: HTMLElement) => void;
  /**
   * Fills the slot under the party recap, and under "this room is closed"
   * (`recap: null` there). Without it the shell shows a Home button.
   */
  partyOver?: PartyOverHook;
  /** URLs of extra sound pack lists, after the free pack. The stock app sets the memes pack. A host app leaves it out. */
  extraPacks?: string[];
}

type Config = Required<Omit<ShellOptions, "nameOverrides" | "beforeStart" | "partyOver" | "createText" | "home">> &
  Pick<ShellOptions, "partyOver" | "createText" | "home">;

/** The create-room path, with the setup in the query when there is one. */
export function roomsPath(setup?: RoomSetup): string {
  const query = new URLSearchParams();
  if (setup) {
    query.set("game", setup.gameId);
    if (setup.computers) query.set("computers", String(setup.computers));
  }
  return `/api/rooms${query.size ? `?${query}` : ""}`;
}

/** Today's behaviour: the owner key opens the room. */
async function defaultCreateRoom(setup?: RoomSetup): Promise<CreateRoomResult> {
  const res = await fetch(roomsPath(setup), {
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
  extraPacks: [],
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
