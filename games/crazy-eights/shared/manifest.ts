import type { GameManifest } from "@games/game-core";

export const crazyEightsManifest: GameManifest = {
  id: "crazy-eights",
  name: "Crazy Eights",
  description: "Play a card with the same suit or number. You can play an 8 at any time. The first player with no cards wins.",
  minPlayers: 2,
  maxPlayers: 10,
  icon: "cards",
};
