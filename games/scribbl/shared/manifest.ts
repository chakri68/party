import type { GameManifest } from "@games/game-core";

export const scribblManifest: GameManifest = {
  id: "scribbl",
  name: "Scribbl",
  description: "1 player draws a word. The other players try to guess the word. Fast guesses get more points.",
  minPlayers: 2,
  maxPlayers: 12,
  icon: "pencil",
  ownChat: true,
};
