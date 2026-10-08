import { DEVELOP, REWARDS, TECHS, UNITS } from "../shared/content.ts";
import type { DevelopKind, DominionAction, RewardChoice, TechId, UnitType } from "../shared/types.ts";

const MAX_TILE = 32 * 32;
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 16;
const isTile = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < MAX_TILE;
const isTurn = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const oneOf = <T extends string>(keys: Record<T, unknown>, v: unknown): v is T =>
  typeof v === "string" && Object.hasOwn(keys, v);

/** Untrusted input → a well-formed action or null. Legality is the rules' job. */
export function parseAction(input: unknown): DominionAction | null {
  if (typeof input !== "object" || input === null) return null;
  const a = input as Record<string, unknown>;
  if (a.type === "surrender") return { type: "surrender" };
  if (a.type === "answer-peace") {
    return isId(a.from) && typeof a.accept === "boolean" ? { type: "answer-peace", from: a.from, accept: a.accept } : null;
  }
  if (!isTurn(a.turn)) return null;
  const turn = a.turn;
  switch (a.type) {
    case "move":
      return isId(a.unit) && isTile(a.to) ? { type: "move", turn, unit: a.unit, to: a.to } : null;
    case "attack":
      return isId(a.unit) && isTile(a.target) ? { type: "attack", turn, unit: a.unit, target: a.target } : null;
    case "capture":
    case "heal":
    case "promote":
    case "disband":
    case "mend":
    case "sabotage":
      return isId(a.unit) ? { type: a.type, turn, unit: a.unit } : null;
    case "offer-peace":
      return isId(a.to) ? { type: "offer-peace", turn, to: a.to } : null;
    case "break-peace":
    case "embassy":
      return isId(a.with) ? { type: a.type, turn, with: a.with } : null;
    case "upgrade":
      return isId(a.unit) && (a.vessel === "scout" || a.vessel === "rammer" || a.vessel === "bomber")
        ? { type: "upgrade", turn, unit: a.unit, vessel: a.vessel }
        : null;
    case "convert":
      return isId(a.unit) && isTile(a.target) ? { type: "convert", turn, unit: a.unit, target: a.target } : null;
    case "evolve":
      return isId(a.unit) && oneOf<UnitType>(UNITS, a.into) ? { type: "evolve", turn, unit: a.unit, into: a.into } : null;
    case "burn":
      return isId(a.unit) ? { type: "burn", turn, unit: a.unit } : null;
    case "freeze":
      return isId(a.unit) && isTile(a.target) ? { type: "freeze", turn, unit: a.unit, target: a.target } : null;
    case "monument":
      return isTile(a.tile) ? { type: "monument", turn, tile: a.tile } : null;
    case "train":
      return isId(a.city) && oneOf<UnitType>(UNITS, a.unitType) ? { type: "train", turn, city: a.city, unitType: a.unitType } : null;
    case "research":
      return oneOf<TechId>(TECHS, a.tech) ? { type: "research", turn, tech: a.tech } : null;
    case "develop": {
      const kinds: Record<DevelopKind, unknown> = { harvest: 1, demolish: 1, tend: 1, spread: 1, absorb: 1, ...DEVELOP };
      return isTile(a.tile) && oneOf<DevelopKind>(kinds, a.kind) ? { type: "develop", turn, tile: a.tile, kind: a.kind } : null;
    }
    case "reward":
      return isId(a.city) && oneOf<RewardChoice>(REWARDS, a.choice) ? { type: "reward", turn, city: a.city, choice: a.choice } : null;
    case "end-turn":
      return { type: "end-turn", turn };
    default:
      return null;
  }
}
