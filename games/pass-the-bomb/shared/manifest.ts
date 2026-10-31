import type { GameManifest } from "@games/game-core";

export const passTheBombManifest: GameManifest = {
  id: "pass-the-bomb",
  name: "Pass the Bomb",
  description: "Type a word with the letters on the bomb. Then the bomb goes to the next player. Nobody knows when it will blow up.",
  minPlayers: 2,
  maxPlayers: 12,
  icon: "bomb",
};
