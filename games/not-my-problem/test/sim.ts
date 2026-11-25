import type { AnyGameDefinition, GameEventEnvelope } from "@games/game-core";
import { playBots } from "@games/game-core/testing";
import { notMyProblemGame as nmp } from "../server/game.ts";
import type { NmpEvent } from "../shared/types.ts";

export interface SimResult {
  games: number;
  /** Games that hit the move cap or stopped on a refused or stuck move. */
  unfinished: number;
  firedPerGame: number;
  /** Share of games with exactly one winner (no tie at the top). */
  singleWinnerRate: number;
  /** Turns played in a game, over the players it started with. */
  turnsPerPlayer: number;
}

/** The game with its turn events counted. Everything else is the real definition. */
function counting(onTurn: () => void): AnyGameDefinition {
  const count = <T extends { events: GameEventEnvelope<NmpEvent>[] }>(t: T): T => {
    for (const e of t.events) if (e.event.type === "turn") onTurn();
    return t;
  };
  return {
    ...nmp,
    createGame: (...args: Parameters<typeof nmp.createGame>) => count(nmp.createGame(...args)),
    handleAction(...args: Parameters<typeof nmp.handleAction>) {
      const r = nmp.handleAction(...args);
      if (r.ok) count(r.transition);
      return r;
    },
    onTimer: (...args: Parameters<NonNullable<typeof nmp.onTimer>>) => count(nmp.onTimer!(...args)),
  } as AnyGameDefinition;
}

/** All-bot games, read through `playBots` and `getResult`. Seeds are `seed * 100_000 + game`. */
export function simulate(opts: { players: number; games: number; seed: number; reactionSeconds?: number }): SimResult {
  let turns = 0;
  const def = counting(() => turns++);
  const settings = { ...nmp.defaultSettings, ...(opts.reactionSeconds && { reactionSeconds: opts.reactionSeconds }) };
  let unfinished = 0;
  let fired = 0;
  let single = 0;
  let turnsPerPlayer = 0;
  for (let g = 0; g < opts.games; g++) {
    turns = 0;
    const run = playBots(def, { players: opts.players, seed: opts.seed * 100_000 + g, settings });
    const outcome = run.outcome;
    if (!outcome || run.rejected.length || run.stuck.length) {
      unfinished++;
      continue;
    }
    fired += outcome.standings.filter((s) => s.label?.startsWith("Fired")).length;
    if (outcome.winnerIds.length === 1) single++;
    turnsPerPlayer += turns / opts.players;
  }
  const finished = Math.max(1, opts.games - unfinished);
  return {
    games: opts.games,
    unfinished,
    firedPerGame: fired / finished,
    singleWinnerRate: single / finished,
    turnsPerPlayer: turnsPerPlayer / finished,
  };
}
