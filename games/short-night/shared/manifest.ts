import type { GameManifest } from "@games/game-core";
import { MAX_PLAYERS, MIN_PLAYERS } from "./roles.ts";

export const shortNightManifest: GameManifest = {
  id: "short-night",
  name: "Short Night",
  description: "Some players are secret Wolves. There is 1 night, then 1 talk, then 1 vote. Vote out a Wolf to win.",
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  icon: "moon",
};
