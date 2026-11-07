import { describe, expect, it } from "vitest";
import { simulate } from "./sim.ts";

const ROUNDS = Number((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.OVERHEAT_SIM_ROUNDS ?? 300);

describe("balance", () => {
  it("stays in sane bounds for 2 to 8 players", { timeout: 600_000 }, () => {
    const table: Record<number, { bustRate: string; avgEngineCards: string; avgFlipsPerRound: string }> = {};
    for (let players = 2; players <= 8; players++) {
      const r = simulate({ players, rounds: ROUNDS, seed: players });
      table[players] = {
        bustRate: r.bustRate.toFixed(3),
        avgEngineCards: r.avgEngineCards.toFixed(2),
        avgFlipsPerRound: r.avgFlipsPerRound.toFixed(2),
      };
    }
    console.table(table);
    for (const [players, r] of Object.entries(table)) {
      expect(Number(r.bustRate), `${players}p bust rate`).toBeGreaterThan(0.02);
      expect(Number(r.bustRate), `${players}p bust rate`).toBeLessThan(0.6);
      expect(Number(r.avgEngineCards), `${players}p engine cards`).toBeGreaterThan(2);
      expect(Number(r.avgEngineCards), `${players}p engine cards`).toBeLessThan(10);
    }
  });
});
