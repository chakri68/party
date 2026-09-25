import type { GameManifest } from "@games/game-core";

export const scribblManifest: GameManifest = {
  id: "scribbl",
  name: "Scribbl",
  description: "One of you draws a word, everyone else races to guess it. Faster guesses score more.",
  minPlayers: 2,
  maxPlayers: 12,
  icon: "pencil",
};
