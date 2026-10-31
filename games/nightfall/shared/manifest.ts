import type { GameManifest } from "@games/game-core";
import { MAX_PLAYERS, MIN_PLAYERS } from "./roles.ts";

export const nightfallManifest: GameManifest = {
  id: "nightfall",
  name: "Nightfall",
  description: "Some players are secret Wolves. Each night, the Wolves attack 1 player. Each day, everyone votes 1 player out. Find the Wolves before they win.",
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  icon: "moon",
};
