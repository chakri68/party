import type { AnyGameDefinition } from "@games/game-core";
import { gamesFor, type GameFlags } from "@games/server/games";
import { FREE_MAX_PLAYERS, PREMIUM_GAME_IDS, PRODUCT_NAMES } from "./catalog-data.ts";

// Same shape as the server runtime's TierLimits (structural; the shared package doesn't export the type).
export interface TierLimits {
  premiumGameIds: string[];
  freeMaxPlayers: number;
}

export const PRODUCT_LIMITS: TierLimits = { premiumGameIds: PREMIUM_GAME_IDS, freeMaxPlayers: FREE_MAX_PLAYERS };

/** The shared games with product names. Renamed ones are copies; the shared definitions stay as they are. */
export function productGames(flags: GameFlags): Record<string, AnyGameDefinition> {
  const games = gamesFor(flags);
  for (const [id, name] of Object.entries(PRODUCT_NAMES)) {
    const def = games[id];
    if (def) games[id] = { ...def, manifest: { ...def.manifest, name } };
  }
  return games;
}
