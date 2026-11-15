import { EVENTS } from "./events.ts";
import { RUINS } from "./ruins.ts";
import type { Step } from "./types.ts";

const MAX_LINES = 4;

const joinNames = (names: string[]): string =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/** At most 4 plain lines for the report: one per kind, in priority order. */
export function roundLines(steps: Step[], name: (id: string) => string): string[] {
  const find = <T extends Step["t"]>(t: T, ok: (s: Extract<Step, { t: T }>) => boolean = () => true) =>
    steps.find((s): s is Extract<Step, { t: T }> => s.t === t && ok(s as Extract<Step, { t: T }>));
  const out: (string | null)[] = [];

  const gate = find("gate");
  out.push(gate ? `${name(gate.who)} opened the gate.` : null);

  const stone = find("stone");
  if (!stone) out.push(null);
  else if (stone.how === "force") out.push(`${name(stone.who)} forced the ${RUINS[stone.ruin].name} open. The sun moved on.`);
  else out.push(`${name(stone.who)} found the key stone at the ${RUINS[stone.ruin].name}.`);

  const down = find("down");
  out.push(down ? `${name(down.who)} is down.` : null);

  const up = find("up", (s) => s.by !== null);
  out.push(up ? `${name(up.by!)} got ${name(up.who)} back up.` : null);

  const litAt = steps.findIndex((s) => s.t === "lit" && s.by !== null);
  if (litAt < 0) out.push(null);
  else {
    const lit = steps[litAt] as Extract<Step, { t: "lit" }>;
    const spread = steps.slice(litAt + 1).some((s) => s.t === "lit" && s.by === null);
    out.push(`${name(lit.by!)} started a fire.${spread ? " The fire spread." : ""}`);
  }

  const bridge = steps.find((s) => (s.t === "burnt" && s.to === "broken") || (s.t === "bridge" && !s.fixed));
  out.push(!bridge ? null : bridge.t === "burnt" ? "The fire burned the bridge." : "The bridge broke.");

  const bitten = [...new Set(steps.flatMap((s) => (s.t === "damage" && s.by === "spider" && !s.blocked ? [s.who] : [])))];
  out.push(bitten.length ? `The spider bit ${joinNames(bitten.map(name))}.` : null);

  const ev = find("event", (s) => s.nothing);
  out.push(ev ? `${EVENTS[ev.id].title}: nothing happened.` : null);

  return out.filter((l): l is string => l !== null).slice(0, MAX_LINES);
}
