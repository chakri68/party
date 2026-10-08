import type { GameManifest } from "@games/game-core";

export const dominionManifest: GameManifest = {
  id: "dominion",
  name: "Dominion",
  description: "Explore a hidden world, grow cities, research, and conquer your rivals. Turn-based, takes a while.",
  // One person can play: the game adds a computer opponent.
  minPlayers: 1,
  maxPlayers: 8,
  icon: "map",
};
