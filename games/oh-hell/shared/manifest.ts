import type { GameManifest } from "@games/game-core";

export const ohHellManifest: GameManifest = {
  id: "oh-hell",
  name: "Oh Hell",
  description: "The number of cards changes each round. Say how many tricks you will win. You score only if your number is exact.",
  minPlayers: 3,
  maxPlayers: 7,
  icon: "cards",
};
