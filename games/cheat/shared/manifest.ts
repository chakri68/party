import type { GameManifest } from "@games/game-core";

export const cheatManifest: GameManifest = {
  id: "cheat",
  name: "Cheat",
  description: "Put cards down face down and say what they are. Lie if you have to. Get caught and the pile's yours.",
  minPlayers: 3,
  maxPlayers: 10,
  icon: "cards",
};
