import type { GameManifest } from "@games/game-core";

export const dominionManifest: GameManifest = {
  id: "dominion",
  name: "Dominion",
  description: "Explore a hidden map. Grow your cities and take other cities. Players take turns. A game takes a long time.",
  // One person can play: the game adds a computer opponent.
  minPlayers: 1,
  maxPlayers: 8,
  icon: "map",
};
