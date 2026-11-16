import { describe, expect, it } from "vitest";
import { playGame } from "./bots.ts";

// Simple bots (bots.ts) play whole seeded games through wildsGame at sun limit 10, and the table
// has to land in the spec's balance bands (§10). The table prints with
// `pnpm vitest run games/wilds/test/balance.test.ts --reporter=verbose`.
//
// The default run: 200 games each for 2, 4 and 6 players, under 20 s. WD_BALANCE_FULL=1 runs
// 2,000 games for every player count from 2 to 6, for tuning.
//
// A 200-game sample can't pin a rate to 0.01, so the default run widens each band by 2 standard
// errors of its own sample: 2*sqrt(p(1-p)/n) for a rate, 2*SD/sqrt(wins) for the average rounds
// of a win. Without that, a tune near a band edge fails on luck. The full run checks the exact
// bands, with no slack.

const FULL = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.WD_BALANCE_FULL === "1";
const GAMES = FULL ? 2000 : 200;
const COUNTS = FULL ? [2, 3, 4, 5, 6] : [2, 4, 6];

interface Row {
  players: number; games: number; win: number; winRounds: number; fire: number; down: number;
  // The slack each band gets: 0 in the full run, 2 standard errors in the default run.
  winTol: number; roundsTol: number; fireTol: number; downTol: number;
}

function run(players: number, games: number): Row {
  let wins = 0;
  let winRounds = 0;
  let winRoundsSq = 0;
  let fire = 0;
  let down = 0;
  for (let i = 0; i < games; i++) {
    const r = playGame(players, players * 100_000 + i, { sunLimit: 10 });
    if (r.win) { wins++; winRounds += r.rounds; winRoundsSq += r.rounds * r.rounds; }
    if (r.fire) fire++;
    if (r.down) down++;
  }
  const round = (x: number) => Math.round(x * 1000) / 1000;
  const rate = (k: number) => k / games;
  const rateTol = (k: number) => (FULL ? 0 : 2 * Math.sqrt((rate(k) * (1 - rate(k))) / games));
  const mean = wins ? winRounds / wins : 0;
  const sd = wins > 1 ? Math.sqrt(Math.max(0, (winRoundsSq - wins * mean * mean) / (wins - 1))) : 0;
  return {
    players, games,
    win: round(rate(wins)),
    winRounds: round(mean),
    fire: round(rate(fire)),
    down: round(rate(down)),
    winTol: round(rateTol(wins)),
    roundsTol: round(FULL || !wins ? 0 : (2 * sd) / Math.sqrt(wins)),
    fireTol: round(rateTol(fire)),
    downTol: round(rateTol(down)),
  };
}

describe("balance", () => {
  it("lands every player count in the spec's bands at sun 10", () => {
    const rows = COUNTS.map((n) => run(n, GAMES));
    console.table(rows);
    for (const r of rows) {
      const name = `${r.players} players`;
      expect(r.win, `${name} win rate`).toBeGreaterThanOrEqual(0.4 - r.winTol);
      expect(r.win, `${name} win rate`).toBeLessThanOrEqual(0.6 + r.winTol);
      expect(r.winRounds, `${name} average rounds for a win`).toBeGreaterThanOrEqual(8 - r.roundsTol);
      expect(r.winRounds, `${name} average rounds for a win`).toBeLessThanOrEqual(10 + r.roundsTol);
      expect(r.fire, `${name} games with a fire`).toBeGreaterThan(0.5 - r.fireTol);
      expect(r.down, `${name} games with a player down`).toBeGreaterThanOrEqual(0.3 - r.downTol);
      expect(r.down, `${name} games with a player down`).toBeLessThanOrEqual(0.6 + r.downTol);
    }
  }, FULL ? 600_000 : 60_000);
});
