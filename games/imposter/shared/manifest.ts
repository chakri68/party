import type { GameManifest } from "@games/game-core";

export const imposterManifest: GameManifest = {
  id: "imposter",
  name: "Imposter",
  description: "All players know a secret, except 1 player. Give clues or ask questions. Find the player who does not know.",
  minPlayers: 3,
  maxPlayers: 12,
  bestMinPlayers: 5,
  bestMaxPlayers: 8,
  icon: "mask",
};
