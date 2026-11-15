import type { GameManifest } from "@games/game-core";
import { MAX_PLAYERS, MIN_PLAYERS } from "./settings.ts";

export const longTrailManifest: GameManifest = {
  id: "long-trail",
  name: "Long Trail",
  description: "One caravan, a long trail and not enough food. Plan each day together, and keep your own goal secret.",
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  icon: "map",
};
