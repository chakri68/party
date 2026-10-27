import type { GameManifest } from "@games/game-core";
import { MAX_PLAYERS, MIN_PLAYERS } from "./roles.ts";

export const nightfallManifest: GameManifest = {
  id: "nightfall",
  name: "Nightfall",
  description: "Wolves in the village. Every night someone's taken, every day someone's voted out, until one side's gone.",
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  icon: "moon",
};
