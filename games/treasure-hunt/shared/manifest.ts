import type { GameManifest } from "@games/game-core";

export const treasureHuntManifest: GameManifest = {
  id: "treasure-hunt",
  name: "Treasure Hunt",
  description: "Explore a new map every round. Read the clues and find the hidden caches. Walk, or drive a buggy.",
  minPlayers: 1,
  maxPlayers: 8,
  icon: "map",
};
