import type { GameManifest } from "@games/game-core";

export const cheatManifest: GameManifest = {
  id: "cheat",
  name: "Cheat",
  description: "Put cards face down and say what they are. You can lie. If a player catches your lie, you take the pile.",
  minPlayers: 3,
  maxPlayers: 10,
  bestMinPlayers: 4,
  bestMaxPlayers: 6,
  icon: "cards",
};
