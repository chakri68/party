import type { GameManifest } from "@games/game-core";

export const presidentManifest: GameManifest = {
  id: "president",
  name: "President",
  description: "Play higher cards on the pile, or pass. The first player with no cards is President. The last player is the Asshole. Next round, the Asshole gives their 2 best cards to the President.",
  minPlayers: 3,
  maxPlayers: 8,
  icon: "cards",
};
