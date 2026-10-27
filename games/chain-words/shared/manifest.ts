import type { GameManifest } from "@games/game-core";

export const chainWordsManifest: GameManifest = {
  id: "chain-words",
  name: "Chain Words",
  description: "Each word starts with the last letter of the one before. On the clock.",
  minPlayers: 2,
  maxPlayers: 12,
  icon: "chain",
};
