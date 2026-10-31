import type { GameManifest } from "@games/game-core";
import { MAX_PLAYERS, MIN_PLAYERS } from "./rules.ts";

export const heistManifest: GameManifest = {
  id: "heist",
  name: "Heist",
  description: "The crew plans 5 jobs. Some players are secret moles. The moles want the jobs to fail.",
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  icon: "key",
};
