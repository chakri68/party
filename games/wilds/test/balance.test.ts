import { describe, expect, it } from "vitest";
import { playGame } from "./bots.ts";

// Simple bots (bots.ts) play whole seeded games through wildsGame at sun limit 10, and the table
// has to land in the spec's balance bands (§10). The table prints with
// `pnpm vitest run games/wilds/test/balance.test.ts --reporter=verbose`.
//
// The default run: 200 games each for 2, 4 and 6 players, under 20 s. WD_BALANCE_FULL=1 runs
// 2,000 games for every player count from 2 to 6, for tuning.

const FULL = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.WD_BALANCE_FULL === "1";
const GAMES = FULL ? 2000 : 200;
const COUNTS = FULL ? [2, 3, 4, 5, 6] : [2, 4, 6];

interface Row { players: number; games: number; win: number; winRounds: number; fire: number; down: number }

function run(players: number, games: number): Row {
  let wins = 0;
  let winRounds = 0;
  let fire = 0;
  let down = 0;
  for (let i = 0; i < games; i++) {
    const r = playGame(players, players * 100_000 + i, { sunLimit: 10 });
    if (r.win) { wins++; winRounds += r.rounds; }
    if (r.fire) fire++;
    if (r.down) down++;
  }
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return {
    players, games,
    win: round(wins / games),
    winRounds: round(wins ? winRounds / wins : 0),
    fire: round(fire / games),
    down: round(down / games),
  };
}

describe("balance", () => {
  it("lands every player count in the spec's bands at sun 10", () => {
    const rows = COUNTS.map((n) => run(n, GAMES));
    console.table(rows);
    for (const r of rows) {
      const name = `${r.players} players`;
      expect(r.win, `${name} win rate`).toBeGreaterThanOrEqual(0.4);
      expect(r.win, `${name} win rate`).toBeLessThanOrEqual(0.6);
      expect(r.winRounds, `${name} average rounds for a win`).toBeGreaterThanOrEqual(8);
      expect(r.winRounds, `${name} average rounds for a win`).toBeLessThanOrEqual(10);
      expect(r.fire, `${name} games with a fire`).toBeGreaterThan(0.5);
      expect(r.down, `${name} games with a player down`).toBeGreaterThanOrEqual(0.3);
      expect(r.down, `${name} games with a player down`).toBeLessThanOrEqual(0.6);
    }
  }, FULL ? 600_000 : 60_000);
});
