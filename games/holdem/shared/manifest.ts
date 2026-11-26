import type { GameManifest } from "@games/game-core";

export const holdemManifest: GameManifest = {
  id: "holdem",
  name: "Hold'em",
  description: "Poker with play chips: Texas Hold'em, Omaha or Short Deck. The blinds go up over time. The last player with chips wins.",
  minPlayers: 2,
  maxPlayers: 9,
  bestMinPlayers: 4,
  bestMaxPlayers: 7,
  computers: true,
  icon: "chips",
};
