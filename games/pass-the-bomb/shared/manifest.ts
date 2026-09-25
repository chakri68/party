import type { GameManifest } from "@games/game-core";

export const passTheBombManifest: GameManifest = {
  id: "pass-the-bomb",
  name: "Pass the Bomb",
  description: "Type a word with the letters on the bomb to pass it on. Nobody knows how long the fuse is.",
  minPlayers: 2,
  maxPlayers: 12,
  icon: "bomb",
};
