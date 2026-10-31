import type { GameManifest } from "@games/game-core";

export const goFishManifest: GameManifest = {
  id: "go-fish",
  name: "Go Fish",
  description: "Ask a player for a card number you have. Get all 4 cards of one number. This is a book. The player with the most books wins.",
  minPlayers: 2,
  maxPlayers: 6,
  icon: "cards",
};
