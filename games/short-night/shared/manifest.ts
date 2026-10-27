import type { GameManifest } from "@games/game-core";
import { MAX_PLAYERS, MIN_PLAYERS } from "./roles.ts";

export const shortNightManifest: GameManifest = {
  id: "short-night",
  name: "Short Night",
  description: "One night, one talk, one vote. Find a wolf before the morning's out.",
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  icon: "moon",
};
