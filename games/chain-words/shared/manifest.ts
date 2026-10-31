import type { GameManifest } from "@games/game-core";

export const chainWordsManifest: GameManifest = {
  id: "chain-words",
  name: "Chain Words",
  description: "Players take turns to type a word. Each word starts with the last letter of the word before. Be quick.",
  minPlayers: 2,
  maxPlayers: 12,
  icon: "chain",
};
