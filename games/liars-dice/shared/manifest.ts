import type { GameManifest } from "@games/game-core";

export const liarsDiceManifest: GameManifest = {
  id: "liars-dice",
  name: "Liar's Dice",
  description: "Each player rolls dice in secret. Guess how many dice on the table show a number. Make a bigger guess, or call Liar.",
  minPlayers: 2,
  maxPlayers: 8,
  bestMinPlayers: 3,
  bestMaxPlayers: 6,
  icon: "dice",
};
