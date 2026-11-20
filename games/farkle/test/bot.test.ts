import { BOT_MAX_RUN } from "@games/game-core";
import { playBots } from "@games/game-core/testing";
import { describe, expect, it } from "vitest";
import { farkleBot } from "../server/bot.ts";
import { farkleGame } from "../server/game.ts";
import { scoreDice } from "../shared/rules.ts";
import { DEFAULT_SETTINGS, type FarklePublicState, type FarkleSettings } from "../shared/types.ts";

/** Never jitters. */
const steady = { randomInt: (max: number) => Math.min(1, max - 1), chance: () => 0 };

function view(opts: {
  roll: number[];
  turnTotal?: number;
  settings?: Partial<FarkleSettings>;
  score?: number;
  onBoard?: boolean;
  farkles?: number;
  others?: number[];
  finalRound?: boolean;
  step?: "rolled" | "bust";
  turn?: string;
}) {
  const pub: FarklePublicState = {
    players: [
      { id: "me", score: opts.score ?? 0, onBoard: opts.onBoard ?? true, farkles: opts.farkles ?? 0, removed: false },
      ...(opts.others ?? [1000]).map((score, i) => ({ id: `o${i}`, score, onBoard: true, farkles: 0, removed: false })),
    ],
    currentPlayerId: opts.turn ?? "me",
    step: opts.step ?? "rolled",
    rollNumber: 1,
    roll: opts.roll,
    kept: [],
    turnTotal: opts.turnTotal ?? 0,
    hot: false,
    bustEndsAt: 0,
    settings: { ...DEFAULT_SETTINGS, ...opts.settings },
    finalRound: opts.finalRound ? { triggerId: "o0", owed: ["me"] } : null,
    lastTurn: null,
    winnerIds: [],
    endReason: null,
  };
  return { playerId: "me", public: pub, private: {} };
}

const keptFaces = (roll: number[], keep: number[]) => keep.map((i) => roll[i]).sort();

describe("farkleBot", () => {
  it("keeps hot dice and rolls on below 1000", () => {
    const roll = [1, 1, 5, 5, 5];
    const move = farkleBot.decide(view({ roll }), steady)!;
    expect(move.keep.length).toBe(5); // 700, all six dice come back
    expect(move.type).toBe("keep-and-roll");
  });

  it("keeps a six-dice straight and banks it", () => {
    const move = farkleBot.decide(view({ roll: [1, 2, 3, 4, 5, 6] }), steady)!;
    expect(move.keep.length).toBe(6);
    expect(move.type).toBe("keep-and-bank"); // 1500
  });

  it("keeps triples and every 1", () => {
    const roll = [2, 2, 2, 1, 3, 1];
    const move = farkleBot.decide(view({ roll }), steady)!;
    expect(keptFaces(roll, move.keep)).toEqual([1, 1, 2, 2, 2]);
  });

  it("keeps one die when only singles show and there are 4 or more dice", () => {
    const roll = [1, 5, 2, 3, 4, 6].slice(0, 5); // 1,5,2,3,4
    const move = farkleBot.decide(view({ roll }), steady)!;
    expect(keptFaces(roll, move.keep)).toEqual([1]);
    expect(move.type).toBe("keep-and-roll");
  });

  it("keeps a 5 over nothing when it is the only scorer", () => {
    const roll = [5, 2, 3, 4, 6, 2];
    const move = farkleBot.decide(view({ roll }), steady)!;
    expect(keptFaces(roll, move.keep)).toEqual([5]);
  });

  it("keeps every single with 3 or fewer dice", () => {
    const roll = [1, 5, 2];
    const move = farkleBot.decide(view({ roll }), steady)!;
    expect(keptFaces(roll, move.keep)).toEqual([1, 5]);
  });

  it("adds 5s when that reaches the bank threshold", () => {
    const roll = [4, 4, 4, 5, 5];
    const move = farkleBot.decide(view({ roll, turnTotal: 0 }), steady)!;
    expect(keptFaces(roll, move.keep)).toEqual([4, 4, 4, 5, 5]);
  });

  it("banks by dice left", () => {
    const type = (roll: number[], turnTotal: number) => farkleBot.decide(view({ roll, turnTotal }), steady)!.type;
    // Triple of 4s from 6 dice leaves 3: bank at 350.
    expect(type([4, 4, 4, 2, 3, 6], 0)).toBe("keep-and-bank");
    expect(type([2, 2, 2, 3, 4, 6], 0)).toBe("keep-and-roll"); // 200
    // Lone 1 from 6 dice leaves 5: bank at 500.
    expect(type([1, 2, 3, 4, 6, 6], 300)).toBe("keep-and-roll"); // 400
    expect(type([1, 2, 3, 4, 6, 6], 400)).toBe("keep-and-bank"); // 500
    // Two dice left: bank at 250.
    expect(type([1, 5, 2], 100)).toBe("keep-and-bank"); // 250 with 1 die left
    expect(type([1, 5], 100)).toBe("keep-and-roll"); // hot dice: needs 1000
  });

  it("never banks under entry when not on board", () => {
    const roll = [1, 2, 3, 4, 6, 6];
    const move = farkleBot.decide(view({ roll, onBoard: false, settings: { entry: 500 }, turnTotal: 300 }), steady)!;
    expect(move.type).toBe("keep-and-roll");
    for (let i = 0; i < 40; i++) {
      const ctx = { randomInt: (max: number) => (i * 37) % max, chance: () => 0 };
      const m = farkleBot.decide(view({ roll: [1, 1, 1, 2, 3, 6], onBoard: false, settings: { entry: 2000 } }), ctx)!;
      expect(m.type).toBe("keep-and-roll");
    }
  });

  it("banks when it can reach the target", () => {
    const move = farkleBot.decide(view({ roll: [1, 2, 3, 4, 6, 6], score: 4900, turnTotal: 0 }), steady)!;
    expect(move.type).toBe("keep-and-bank");
  });

  it("chases the top score in the final round", () => {
    const roll = [1, 2, 3, 4, 6, 6];
    const behind = farkleBot.decide(view({ roll, finalRound: true, score: 3000, turnTotal: 800, others: [4000] }), steady)!;
    expect(behind.type).toBe("keep-and-roll"); // 3000 + 900 < 4000, even though 900 >= 500
    const ahead = farkleBot.decide(view({ roll, finalRound: true, score: 3000, turnTotal: 1000, others: [4000] }), steady)!;
    expect(ahead.type).toBe("keep-and-bank"); // 4100 > 4000
    const tied = farkleBot.decide(view({ roll, finalRound: true, score: 3000, turnTotal: 900, others: [4000] }), steady)!;
    expect(tied.type).toBe("keep-and-roll"); // 4000 does not beat 4000
  });

  it("banks 100 sooner after two busts when the penalty is on", () => {
    const roll = [3, 3, 3, 2, 4, 6]; // 300 with 3 dice left: bank at 350, or 250 when wary
    const type = (farkles: number, threeFarkles: boolean) =>
      farkleBot.decide(view({ roll, farkles, settings: { threeFarkles } }), steady)!.type;
    expect(type(0, true)).toBe("keep-and-roll");
    expect(type(2, true)).toBe("keep-and-bank");
    expect(type(2, false)).toBe("keep-and-roll");
  });

  it("always returns a legal keep for any roll that scores", () => {
    for (let seed = 0; seed < 300; seed++) {
      const roll = Array.from({ length: 1 + (seed % 6) }, (_, i) => 1 + ((seed * 7 + i * 13 + (seed >> 2)) % 6));
      const ctx = { randomInt: (max: number) => (seed * 11 + 3) % max, chance: () => 0 };
      const move = farkleBot.decide(view({ roll, turnTotal: seed % 4 === 0 ? 600 : 0 }), ctx);
      if (!roll.some((f) => scoreDice([f]) > 0 || roll.filter((g) => g === f).length >= 3)) continue;
      if (!move) continue;
      expect(new Set(move.keep).size).toBe(move.keep.length);
      expect(scoreDice(move.keep.map((i) => roll[i]!))).toBeGreaterThan(0);
    }
  });

  it("does nothing when it isn't its turn, or the roll is a bust", () => {
    expect(farkleBot.decide(view({ roll: [1, 1, 5], turn: "o0" }), steady)).toBeNull();
    expect(farkleBot.decide(view({ roll: [2, 3, 4], step: "bust" }), steady)).toBeNull();
  });

  const settings: [string, Partial<FarkleSettings>][] = [
    ["defaults", {}],
    ["no entry, 10000", { entry: 0, target: 10000 }],
    ["entry 350, penalty", { entry: 350, threeFarkles: true }],
    ["entry 500, 10000, penalty", { entry: 500, target: 10000, threeFarkles: true }],
  ];
  it.each([2, 5, 8])("all-bot games finish with %i players", (players) => {
    for (const [name, s] of settings) {
      for (let seed = 1; seed <= 200; seed++) {
        const run = playBots(farkleGame, { players, seed, settings: { ...DEFAULT_SETTINGS, ...s } });
        expect(run.rejected, `${name} seed ${seed}`).toEqual([]);
        expect(run.stuck, `${name} seed ${seed}`).toEqual([]);
        expect(run.outcome, `${name} seed ${seed}`).not.toBeNull();
        expect(run.longestRun, `${name} seed ${seed}`).toBeLessThan(BOT_MAX_RUN);
      }
    }
  }, 60_000);

  it("stays fast", () => {
    let moves = 0;
    const start = performance.now();
    for (let seed = 1; seed <= 100; seed++) moves += playBots(farkleGame, { players: 4, seed }).moves;
    expect((performance.now() - start) / moves).toBeLessThan(2);
  });
});
