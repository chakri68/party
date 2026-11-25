import type { GameManifest } from "@games/game-core";

export const notMyProblemManifest: GameManifest = {
  id: "not-my-problem",
  name: "Not My Problem!",
  description: "Problems keep coming. Fix them, or pass them to a friend. Three warnings and you are fired.",
  minPlayers: 3,
  maxPlayers: 8,
  bestMinPlayers: 4,
  bestMaxPlayers: 6,
  icon: "cards",
};
