import { MAX_PLAYERS } from "../shared/settings.ts";
import type { LongTrailAction, Plan, Trade, Vote } from "../shared/types.ts";

export const VOTES: readonly Vote[] = ["go", "no-go"];

const isId = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= 100;
const oneOf = <T extends string>(x: unknown, list: readonly T[]): x is T => typeof x === "string" && (list as readonly string[]).includes(x);

export function parsePlan(input: unknown): Plan | null {
  if (typeof input !== "object" || input === null) return null;
  const p = input as Record<string, unknown>;
  if (!oneOf(p.pace, ["slow", "steady", "hard"] as const) || !oneOf(p.rations, ["full", "half", "none"] as const)) return null;
  if (typeof p.rest !== "boolean" || !(p.fork === null || isId(p.fork))) return null;
  const doses = p.doses;
  if (!Array.isArray(doses) || doses.length > MAX_PLAYERS || !doses.every(isId) || new Set(doses).size !== doses.length) return null;
  const trades = p.trades;
  if (!Array.isArray(trades) || trades.length > 20) return null;
  const out: Trade[] = [];
  for (const t of trades) {
    if (typeof t !== "object" || t === null) return null;
    const { item, qty } = t as Record<string, unknown>;
    if (!isId(item) || typeof qty !== "number" || !Number.isInteger(qty) || Math.abs(qty) > 999) return null;
    out.push({ item, qty });
  }
  return { pace: p.pace, rations: p.rations, rest: p.rest, fork: p.fork, doses: [...doses], trades: out };
}

export function parseAction(input: unknown): LongTrailAction | null {
  if (typeof input !== "object" || input === null) return null;
  const a = input as Record<string, unknown>;
  switch (a.type) {
    case "ack":
      return { type: "ack" };
    case "next":
      return { type: "next" };
    case "propose": {
      const plan = parsePlan(a.plan);
      return plan ? { type: "propose", plan } : null;
    }
    case "vote":
      return oneOf(a.vote, VOTES) ? { type: "vote", vote: a.vote } : null;
    case "choose":
      return a.option === 0 || a.option === 1 ? { type: "choose", option: a.option } : null;
    case "arm":
      return typeof a.on === "boolean" ? { type: "arm", on: a.on } : null;
    default:
      return null;
  }
}
