import type { GameManifest } from "@games/game-core";
import { MAX_PLAYERS, MIN_PLAYERS } from "./settings.ts";

export const wildsManifest: GameManifest = {
  id: "wilds",
  name: "The Wilds",
  description: "Work together on a strange island. Find 3 key stones and reach the gate before the sun goes down.",
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  icon: "compass",
};
