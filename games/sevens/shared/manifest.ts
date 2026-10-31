import type { GameManifest } from "@games/game-core";

export const sevensManifest: GameManifest = {
  id: "sevens",
  name: "Sevens",
  description: "Each suit starts with a 7. Players add cards above and below the 7. The first player with no cards left wins.",
  minPlayers: 2,
  maxPlayers: 16,
  icon: "cards",
};
