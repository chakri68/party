import type { GameManifest } from "@games/game-core";
import { MAX_PLAYERS, MIN_PLAYERS } from "./rules.ts";

export const heistManifest: GameManifest = {
  id: "heist",
  name: "Heist",
  description: "Five jobs, a crew you don't quite trust, and a mole or three who'd love to see it all go wrong.",
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  icon: "key",
};
