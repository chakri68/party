import { blindRallyGame, rallyGame } from "@games/blind-rally/server";
import { bluffDefinitionsGame, fakeWordGame } from "@games/bluff/server";
import { chainWordsGame } from "@games/chain-words/server";
import { cheatGame } from "@games/cheat/server";
import { crazyEightsGame } from "@games/crazy-eights/server";
import { dominionGame } from "@games/dominion/server";
import { dontSayItGame } from "@games/dont-say-it/server";
import { faceOffGame } from "@games/face-off/server";
import type { AnyGameDefinition } from "@games/game-core";
import { heistGame } from "@games/heist/server";
import { imposterGame } from "@games/imposter/server";
import { goFishGame } from "@games/go-fish/server";
import { nightfallGame } from "@games/nightfall/server";
import { oldMaidGame } from "@games/old-maid/server";
import { passTheBombGame } from "@games/pass-the-bomb/server";
import { presidentGame } from "@games/president/server";
import { scribblGame } from "@games/scribbl/server";
import { sevensGame } from "@games/sevens/server";
import { shortNightGame } from "@games/short-night/server";

/** Server half of the game registry (§43). */
const GAMES: Record<string, AnyGameDefinition> = {
  sevens: sevensGame,
  "crazy-eights": crazyEightsGame,
  "old-maid": oldMaidGame,
  "go-fish": goFishGame,
  president: presidentGame,
  scribbl: scribblGame,
  "pass-the-bomb": passTheBombGame,
  "chain-words": chainWordsGame,
  imposter: imposterGame,
  "fake-word": fakeWordGame,
  "bluff-definitions": bluffDefinitionsGame,
  "dont-say-it": dontSayItGame,
  "face-off": faceOffGame,
  cheat: cheatGame,
  dominion: dominionGame,
  "short-night": shortNightGame,
  heist: heistGame,
  nightfall: nightfallGame,
};

export interface GameFlags {
  /**
   * Blind Rally needs a Godot export that isn't in git (map D1), so only
   * builds that ship one list it: the deploy sets BLIND_RALLY=1, `pnpm dev`
   * does too, self-hosted copies don't. Without it, `select-game` says
   * "Unknown game." like for any other id. Rally runs on the same export,
   * so the one flag lists both.
   */
  blindRally: boolean;
}

export function gamesFor(flags: GameFlags): Record<string, AnyGameDefinition> {
  return flags.blindRally ? { ...GAMES, "blind-rally": blindRallyGame, rally: rallyGame } : GAMES;
}
