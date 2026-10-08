// Balance gate for special factions: hard computers, one special against one
// classic, many seeds. Half the matches are generated for each side's start
// so neither gets home cooking. Run: node scripts/balance.ts wildwood [seeds]
//
// Prints the special's win rate per classic faction. The gate is 35–65%.
// Try numbers without editing content: TUNE='{"UNITS.bramble.cost":5}'.

import { seededRandomInt, type GameContext } from "@games/game-core";
import { dominionGame as game } from "../server/game.ts";
import * as content from "../shared/content.ts";
import { CLASSIC_FACTIONS, FACTIONS, UNITS, unitFor } from "../shared/content.ts";
import { DEFAULT_SETTINGS, type DominionState, type FactionKind } from "../shared/types.ts";

const special = (process.argv[2] ?? "wildwood") as FactionKind;
const seeds = Number(process.argv[3] ?? 40);
if (!FACTIONS[special]) throw new Error(`no faction called ${special}`);

// Content tables are plain objects, so a tuning run can poke them in place.
for (const [path, value] of Object.entries(JSON.parse(process.env.TUNE ?? "{}") as Record<string, unknown>)) {
  const keys = path.split(".");
  let at = content as unknown as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) at = (at[k] ??= {}) as Record<string, unknown>;
  at[keys.at(-1)!] = value;
}

function match(seed: number, a: FactionKind, b: FactionKind, world: FactionKind): string[] {
  const randomInt = seededRandomInt(seed);
  const ctx = (): GameContext => ({ now: 0, randomInt });
  let s: DominionState = game.createGame(
    [{ id: "p0" }],
    { ...DEFAULT_SETTINGS, factions: world, bots: 1, botLevel: "hard", turnClock: 0, roundLimit: 30 },
    { roundNumber: 1, dealerSeat: 0 },
    ctx(),
  ).state;
  // Seat 0 is a person on paper; hand it to the computer too.
  s.factions[0]!.bot = { level: "hard", name: "Seat" };
  // Alternate who moves first.
  const kinds = seed % 2 ? [b, a] : [a, b];
  s.factions.forEach((f, k) => {
    f.kind = kinds[k]!;
    f.techs = [FACTIONS[kinds[k]!].startTech];
    f.credits = FACTIONS[kinds[k]!].openingCredits ?? 5;
    // The starting unit follows the faction (Tidefolk start with a shell guard).
    for (const u of Object.values(s.units)) {
      if (u.owner !== f.id) continue;
      u.type = unitFor(kinds[k]!, "infantry");
      u.hp = u.maxHp = UNITS[u.type].hp;
    }
  });
  for (let n = 0; n < 20000 && s.phase === "playing"; n++) s = game.onTimer!(s, "bot", ctx()).state;
  return (s.outcome?.winnerIds ?? []).map((id) => s.factions.find((f) => f.id === id)!.kind);
}

const rows: string[] = [];
for (const classic of CLASSIC_FACTIONS) {
  let wins = 0;
  for (let seed = 0; seed < seeds; seed++) {
    // Half the worlds are shaped for the special's start, half for the classic's.
    const world = seed % 4 < 2 ? special : classic;
    const won = match(seed * 7919 + 1, special, classic, world);
    wins += won.length === 2 || won.length === 0 ? 0.5 : won[0] === special ? 1 : 0;
  }
  const rate = wins / seeds;
  const verdict = rate < 0.35 ? "too weak" : rate > 0.65 ? "too strong" : "ok";
  rows.push(`${classic.padEnd(9)} ${(rate * 100).toFixed(0).padStart(3)}%  ${verdict}`);
  console.log(rows.at(-1));
}
