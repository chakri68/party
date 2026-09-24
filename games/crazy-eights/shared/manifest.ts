import type { GameManifest } from "@games/game-core";

export const crazyEightsManifest: GameManifest = {
  id: "crazy-eights",
  name: "Crazy Eights",
  description: "Match the suit or the rank. Eights are wild. First to empty their hand wins.",
  minPlayers: 2,
  maxPlayers: 10,
  icon: "cards",
};
