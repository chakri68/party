import { blindRallyGame } from "@games/blind-rally/server";
import { cheatGame } from "@games/cheat/server";
import { crazyEightsGame } from "@games/crazy-eights/server";
import { dominionGame } from "@games/dominion/server";
import type { AnyGameDefinition } from "@games/game-core";
import { goFishGame } from "@games/go-fish/server";
import { oldMaidGame } from "@games/old-maid/server";
import { passTheBombGame } from "@games/pass-the-bomb/server";
import { presidentGame } from "@games/president/server";
import { scribblGame } from "@games/scribbl/server";
import { sevensGame } from "@games/sevens/server";

/** Server half of the game registry (§43). */
const GAMES: Record<string, AnyGameDefinition> = {
  sevens: sevensGame,
  "crazy-eights": crazyEightsGame,
  "old-maid": oldMaidGame,
  "go-fish": goFishGame,
  president: presidentGame,
  scribbl: scribblGame,
  "pass-the-bomb": passTheBombGame,
  cheat: cheatGame,
  dominion: dominionGame,
};

export interface GameFlags {
  /**
   * Blind Rally needs a Godot export that isn't in git (map D1), so only
   * builds that ship one list it: the deploy sets BLIND_RALLY=1, `pnpm dev`
   * does too, self-hosted copies don't. Without it, `select-game` says
   * "Unknown game." like for any other id.
   */
  blindRally: boolean;
}

export function gamesFor(flags: GameFlags): Record<string, AnyGameDefinition> {
  return flags.blindRally ? { ...GAMES, "blind-rally": blindRallyGame } : GAMES;
}
