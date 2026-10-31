import type { GameManifest } from "@games/game-core";

export const holdemManifest: GameManifest = {
  id: "holdem",
  name: "Hold'em",
  description: "Texas Hold'em poker with play chips. You can bet any amount. The blinds go up over time. The last player with chips wins.",
  minPlayers: 2,
  maxPlayers: 9,
  icon: "chips",
};
