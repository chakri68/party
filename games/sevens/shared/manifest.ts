import type { GameManifest } from "@games/game-core";

export const sevensManifest: GameManifest = {
  id: "sevens",
  name: "Sevens",
  description: "Build each suit out from the seven. First to empty their hand wins.",
  minPlayers: 2,
  maxPlayers: 16,
  icon: "cards",
};
