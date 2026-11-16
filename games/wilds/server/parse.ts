import type { Card, ItemId, Plan, Role, Way, WildsAction } from "../shared/types.ts";

export const ROLES: readonly Role[] = ["runner", "fixer", "protector", "guide"];
const ITEMS: readonly ItemId[] = ["torch", "planks", "medkit", "lure"];
const WAYS: readonly Way[] = ["careful", "normal", "bold"];
/** More options than any event has: the handler checks the real count. */
const MAX_OPTION = 9;

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const isId = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= 100;
const oneOf = <T extends string>(x: unknown, list: readonly T[]): x is T => typeof x === "string" && (list as readonly string[]).includes(x);
/** Only these keys: `need` must be there, `may` can be. */
const keys = (o: Obj, need: string[], may: string[] = []): boolean =>
  need.every((k) => k in o) && Object.keys(o).every((k) => need.includes(k) || may.includes(k));

export function parseCard(input: unknown): Card | null {
  if (!isObj(input)) return null;
  const c = input;
  switch (c.kind) {
    case "guard":
    case "look":
      return keys(c, ["kind"]) ? { kind: c.kind } : null;
    case "move":
      return keys(c, ["kind", "to"]) && isId(c.to) ? { kind: "move", to: c.to } : null;
    case "act": {
      if (!keys(c, ["kind", "at"], ["approach", "way"]) || !isId(c.at)) return null;
      if (c.approach !== undefined && c.approach !== 0 && c.approach !== 1 && c.approach !== "force") return null;
      if (c.way !== undefined && !oneOf(c.way, WAYS)) return null;
      const out: Extract<Card, { kind: "act" }> = { kind: "act", at: c.at };
      if (c.approach !== undefined) out.approach = c.approach;
      if (c.way !== undefined) out.way = c.way;
      return out;
    }
    case "item": {
      if (!keys(c, ["kind", "item"], ["at", "who"]) || !oneOf(c.item, ITEMS)) return null;
      if ((c.at !== undefined && !isId(c.at)) || (c.who !== undefined && !isId(c.who))) return null;
      const out: Extract<Card, { kind: "item" }> = { kind: "item", item: c.item };
      if (c.at !== undefined) out.at = c.at;
      if (c.who !== undefined) out.who = c.who;
      return out;
    }
    case "help":
      return keys(c, ["kind", "who"]) && isId(c.who) ? { kind: "help", who: c.who } : null;
    default:
      return null;
  }
}

function parsePlan(input: unknown): Plan | null {
  if (!Array.isArray(input) || input.length !== 2) return null;
  const a = parseCard(input[0]);
  const b = parseCard(input[1]);
  return a && b ? [a, b] : null;
}

/** Exactly one of the WildsAction shapes, or null. */
export function parseAction(input: unknown): WildsAction | null {
  if (!isObj(input)) return null;
  const a = input;
  switch (a.type) {
    case "ready":
    case "unready":
    case "next":
      return keys(a, ["type"]) ? { type: a.type } : null;
    case "pick-role":
      return keys(a, ["type", "role"]) && oneOf(a.role, ROLES) ? { type: "pick-role", role: a.role } : null;
    case "vote":
      return keys(a, ["type", "option"]) && Number.isInteger(a.option) && (a.option as number) >= 0 && (a.option as number) <= MAX_OPTION
        ? { type: "vote", option: a.option as number }
        : null;
    case "set-plan": {
      if (!keys(a, ["type", "plan"])) return null;
      const plan = parsePlan(a.plan);
      return plan ? { type: "set-plan", plan } : null;
    }
    default:
      return null;
  }
}
