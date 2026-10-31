import type { GameManifest } from "@games/game-core";

export const samePageManifest: GameManifest = {
  id: "same-page",
  name: "Same Page",
  description: "Everyone answers the same question in secret. You get a point if your answer matches the most players.",
  minPlayers: 3,
  maxPlayers: 12,
  icon: "speech",
};
