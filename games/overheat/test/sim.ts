import { seededRandomInt } from "@games/game-core";
import { overheatBot } from "../server/bot.ts";
import { overheatGame as oh } from "../server/game.ts";
import { DEFAULT_SETTINGS, type OverheatServerState, type PowerSetting } from "../shared/types.ts";

export interface SimResult {
  bustRate: number;
  avgEngineCards: number;
  avgFlipsPerRound: number;
  avgRoundsPerGame: number;
}

/**
 * Plays whole games back to back until `rounds` rounds have finished (the last
 * game is played out). Off and Classic use simple bots: bank once heat is
 * within 4 of the gauge; choices use Skip's random pick. Cutthroat drives the
 * real computer player (`overheatBot`) from the views. Every figure but
 * rounds per game is per player-round (each non-removed player's outcome in a
 * finished round counts once).
 */
export function simulate(opts: { players: number; rounds: number; seed: number; powers?: PowerSetting }): SimResult {
  const ctx = { now: 0, randomInt: seededRandomInt(opts.seed) };
  const botCtx = { randomInt: ctx.randomInt, chance: () => 0 };
  const roster = Array.from({ length: opts.players }, (_, i) => ({ id: `p${i}` }));
  const powers = opts.powers ?? "classic";
  const settings = { ...DEFAULT_SETTINGS, powers };
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
      if (state.step === "round-end") {
        t = oh.onTimer!(state, "next-round", ctx);
      } else if (powers === "cutthroat") {
        const id = oh.getAwaitedPlayerIds(state)[0]!;
        const move = overheatBot.decide({ playerId: id, public: oh.getPublicState(state), private: oh.getPrivateState(state, id) }, botCtx);
        if (!move) throw new Error(`sim: bot ${id} had no move`);
        const r = oh.handleAction(state, id, move, ctx);
        if (!r.ok) throw new Error(`sim: bot action rejected: ${r.error.code}`);
        t = r.transition;
      } else if (state.step === "choosing") {
        t = oh.skipTurn!(state, state.pending!.chooserId, ctx);
      } else {
        const me = state.players[state.turnIndex]!;
        const bankNow = me.flipped && me.heat >= me.gauge - 4;
        const r = oh.handleAction(state, me.id, { type: bankNow ? "bank" : "flip" }, ctx);
        if (!r.ok) throw new Error(`sim: bot action rejected: ${r.error.code}`);
        t = r.transition;
      }
      state = t.state;
      for (const e of t.events) {
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
    avgRoundsPerGame: rounds / games,
  };
}
