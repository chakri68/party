import type { GameManifest } from "@games/game-core";

export const blackjackManifest: GameManifest = {
  id: "blackjack",
  name: "Blackjack",
  description: "Play against the dealer with play chips. Get closer to 21 than the dealer, but do not go over. Everyone plays at the same time.",
  minPlayers: 1,
  maxPlayers: 7,
  bestMinPlayers: 2,
  bestMaxPlayers: 5,
  computers: true,
  pausable: true,
  icon: "cards",
};
