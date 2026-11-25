import { describe, expect, it } from "vitest";
import { simulate } from "./sim.ts";

const SIM_GAMES = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.NMP_SIM_GAMES;
const GAMES = Number(SIM_GAMES ?? 100);

describe("balance", () => {
  it("stays in loose bounds for 3 to 8 players", { timeout: 600_000 }, () => {
    const table: Record<number, { firedPerGame: string; singleWinnerRate: string; turnsPerPlayer: string; unfinished: number }> = {};
    for (let players = 3; players <= 8; players++) {
      const r = simulate({ players, games: GAMES, seed: players });
      table[players] = {
        firedPerGame: r.firedPerGame.toFixed(2),
        singleWinnerRate: r.singleWinnerRate.toFixed(2),
        turnsPerPlayer: r.turnsPerPlayer.toFixed(2),
        unfinished: r.unfinished,
      };
    }
    // Only for a tuning run, so the normal suite stays quiet.
    if (SIM_GAMES) console.table(table);
    for (const [players, r] of Object.entries(table)) {
      const n = Number(players);
      expect(r.unfinished, `${n}p unfinished games`).toBe(0);
      expect(Number(r.turnsPerPlayer), `${n}p turns per player`).toBeGreaterThan(3);
      expect(Number(r.turnsPerPlayer), `${n}p turns per player`).toBeLessThan(12);
      if (n >= 4) expect(Number(r.firedPerGame), `${n}p fired per game`).toBeGreaterThan(0.3);
    }
  });
});
