import type { GameManifest } from "@games/game-core";

export const liarsDiceManifest: GameManifest = {
  id: "liars-dice",
  name: "Liar's Dice",
  description: "Everyone rolls in secret, then bids on what's under all the cups. Raise, or call the last bidder a liar.",
  minPlayers: 2,
  maxPlayers: 8,
  icon: "dice",
};
