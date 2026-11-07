import { seededRandomInt } from "@games/game-core";
import { overheatGame as oh } from "../server/game.ts";
import { DEFAULT_SETTINGS, type OverheatServerState } from "../shared/types.ts";

export interface SimResult {
  bustRate: number;
  avgEngineCards: number;
  avgFlipsPerRound: number;
}

/**
 * Plays whole games back to back with simple bots until `rounds` rounds have
 * finished. Bots bank once heat is within 4 of their gauge; choices use Skip's
 * random pick. Every figure is per player-round (each non-removed player's
 * outcome in a finished round counts once).
 */
export function simulate(opts: { players: number; rounds: number; seed: number }): SimResult {
  const ctx = { now: 0, randomInt: seededRandomInt(opts.seed) };
  const roster = Array.from({ length: opts.players }, (_, i) => ({ id: `p${i}` }));
  const settings = { ...DEFAULT_SETTINGS, powers: "classic" as const };
  let rounds = 0;
  let playerRounds = 0;
  let busts = 0;
  let cards = 0;
  let flips = 0;

  let games = 0;
  while (rounds < opts.rounds) {
    let t = oh.createGame(roster, settings, { roundNumber: 1, dealerSeat: games++ % opts.players }, ctx);
    let state: OverheatServerState = t.state;
    for (;;) {
      if (state.phase === "finished") break;
      let events = t.events;
      if (state.step === "round-end") {
        t = oh.onTimer!(state, "next-round", ctx);
      } else if (state.step === "choosing") {
        t = oh.skipTurn!(state, state.pending!.chooserId, ctx);
      } else {
        const me = state.players[state.turnIndex]!;
        const bankNow = me.flipped && me.heat >= me.gauge - 4;
        const r = oh.handleAction(state, me.id, { type: bankNow ? "bank" : "flip" }, ctx);
        if (!r.ok) throw new Error(`sim: bot action rejected: ${r.error.code}`);
        t = r.transition;
      }
      events = t.events;
      state = t.state;
      for (const e of events) {
        if (e.event.type === "flip") flips++;
        if (e.event.type !== "round-end") continue;
        rounds++;
        for (const p of state.players) {
          if (p.removed) continue;
          playerRounds++;
          if (p.status === "busted") busts++;
          cards += p.engine.length;
        }
      }
    }
  }
  return {
    bustRate: busts / playerRounds,
    avgEngineCards: cards / playerRounds,
    avgFlipsPerRound: flips / playerRounds,
  };
}
