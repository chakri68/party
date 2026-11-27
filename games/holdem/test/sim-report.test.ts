// The tuning report for the computer player's lines. Skipped in normal runs.
//
//   HOLDEM_SIM=stats VARIANT=omaha PLAYERS=6 HANDS=4000 pnpm vitest run games/holdem/test/sim-report.test.ts
//   HOLDEM_SIM=h2h VARIANT=omaha PLAYERS=6 HANDS=5000 SEED=1 CAND=raise=0.55,bluff=12 pnpm vitest run games/holdem/test/sim-report.test.ts
//   HOLDEM_SIM=equity VARIANT=omaha pnpm vitest run games/holdem/test/sim-report.test.ts
//
// BASE is the baseline: the game's lines in POSTFLOP_LINES (unset), "old" (before the
// tuning), or a list like callLooseness=1.7 laid over the old lines. CAND (and LINES,
// for stats) are laid over the baseline.
// OUT names a JSON file for the numbers.

import { seededRandomInt } from "@games/game-core";
import { describe, it } from "vitest";
import { POSTFLOP_LINES, equity, holdemBotWith, omahaPreflopTier, preflopTier, type PostflopLines } from "../server/bot.ts";
import { makeDeck } from "../shared/rules.ts";
import { HOLE_CARDS, type Variant } from "../shared/types.ts";
import { addStats, emptyStats, headToHead, interval, simulate, summarize } from "./sim.ts";

// This package has no Node types (the game runs in a Worker), so the two Node bits are typed here.
declare const process: { env: Record<string, string | undefined> };
type WriteFile = (path: string, text: string) => void;

const env = process.env;
const variant = (env.VARIANT ?? "holdem") as Variant;
const players = Number(env.PLAYERS ?? 6);
const hands = Number(env.HANDS ?? 2000);
const seed = Number(env.SEED ?? 1);

/** The lines every game played by before the tuning. */
const OLD: PostflopLines = { raiseHeadsUp: 0.5, raise: 0.65, allIn: 0.8, reraiseMargin: 0.15, raiseBelowAllIn: 0.05, callLooseness: 0.9, bluff: 9 };
/** "callLooseness=1.4,bluff=12" → those lines. */
const over = (text = ""): Partial<PostflopLines> =>
  Object.fromEntries(text.split(",").filter(Boolean).map((kv) => [kv.split("=")[0]!, Number(kv.split("=")[1])]));
/** The baseline: the game's lines, the old ones, or lines laid over the old ones. CAND and LINES are laid over it. */
const base = env.BASE === "old" ? OLD : !env.BASE || env.BASE === "current" ? POSTFLOP_LINES[variant] : { ...OLD, ...over(env.BASE) };
const table = (o: Partial<PostflopLines>) => ({ ...POSTFLOP_LINES, [variant]: { ...base, ...o } });

describe.runIf(env.HOLDEM_SIM)("Hold'em bot tuning report", () => {
  it("runs", async () => {
    const fs: string = "node:fs";
    const { writeFileSync } = (await import(fs)) as { writeFileSync: WriteFile };
    const out = (data: unknown) => {
      const text = JSON.stringify(data, null, 1);
      console.log(text);
      if (env.OUT) writeFileSync(env.OUT, text);
    };
    const start = performance.now();
    if (env.HOLDEM_SIM === "stats") {
      const bot = holdemBotWith(table(over(env.LINES)));
      const run = simulate({ variant, bots: Array.from({ length: players }, () => bot), hands, seed });
      const all = run.seats.reduce(addStats, emptyStats());
      out({ variant, players, hands, lines: table(over(env.LINES))[variant], ...summarize(all), movesPerHand: run.movesPerHand, flopShare: run.flopShare, riverShare: run.riverShare, rejected: run.rejected, ms: performance.now() - start });
    } else if (env.HOLDEM_SIM === "h2h") {
      const candidate = holdemBotWith(table(over(env.CAND)));
      const baseline = holdemBotWith({ ...POSTFLOP_LINES, [variant]: base });
      const { samples, rejected } = headToHead({ variant, candidate, baseline, players, hands, seed });
      out({ variant, players, hands, seed, cand: env.CAND, base: env.BASE ?? "current", samples, ...interval(samples), rejected, ms: performance.now() - start });
    } else if (env.HOLDEM_SIM === "equity") {
      // Flop equity of a dealt hand against 1 and 2 random hands: all hands, and the ones the bot plays (tier 4 or better).
      const rng = seededRandomInt(seed);
      const report: Record<string, Record<string, number>> = {};
      for (const opponents of [1, 2]) {
        const all: number[] = [];
        const played: number[] = [];
        for (let i = 0; i < Number(env.DEALS ?? 3000); i++) {
          const deck = makeDeck(variant);
          for (let k = deck.length - 1; k > 0; k--) {
            const j = rng(k + 1);
            [deck[k], deck[j]] = [deck[j]!, deck[k]!];
          }
          const hole = deck.slice(0, HOLE_CARDS[variant]);
          const board = deck.slice(HOLE_CARDS[variant], HOLE_CARDS[variant] + 3);
          const eq = equity(variant, hole, board, Array(opponents).fill(null), 400, rng);
          all.push(eq);
          const tier = variant === "omaha" ? omahaPreflopTier(hole) : preflopTier(hole[0]!, hole[1]!, variant);
          if (tier <= 4) played.push(eq);
        }
        const pcts = (xs: number[]) => {
          xs.sort((a, b) => a - b);
          return Object.fromEntries([25, 50, 70, 80, 90, 95].map((p) => [`p${p}`, Math.round(100 * xs[Math.floor((p / 100) * (xs.length - 1))]!) / 100]));
        };
        report[`all vs ${opponents}`] = pcts(all);
        report[`played vs ${opponents}`] = pcts(played);
      }
      out({ variant, ...report });
    }
  }, 3_600_000);
});
