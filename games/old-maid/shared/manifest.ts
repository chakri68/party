import type { GameManifest } from "@games/game-core";

export const oldMaidManifest: GameManifest = {
  id: "old-maid",
  name: "Old Maid",
  description: "Put down pairs of cards. Take cards from your neighbour without looking. The last player with a card loses.",
  minPlayers: 2,
  maxPlayers: 10,
  icon: "cards",
};
