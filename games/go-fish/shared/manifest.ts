import type { GameManifest } from "@games/game-core";

export const goFishManifest: GameManifest = {
  id: "go-fish",
  name: "Go Fish",
  description: "Ask someone for a rank you hold. Collect all four to make a book. Most books wins.",
  minPlayers: 2,
  maxPlayers: 6,
  icon: "cards",
};
