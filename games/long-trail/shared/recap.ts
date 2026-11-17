import type { EventOutcome } from "./events.ts";
import { stopById, type RouteDef, type SettingPack } from "./pack.ts";
import { cargoSale, goalMet, type EndView } from "./scoring.ts";
import type { DayReport } from "./travel.ts";
import type { Goal, Grade, JobId, Plan, Supply } from "./types.ts";

type RandomInt = (n: number) => number;

export interface DayLog {
  day: number;
  leader: string;
  plan: Plan;
  proposals: { by: string; plan: Plan; votes: Record<string, "go" | "no-go">; passed: boolean }[];
  stayedCourse: boolean;
  event: { id: string; text: string; choice?: { votes: Record<string, 0 | 1>; picked: 0 | 1; label: string } } | null;
  report: { km: number; reached: string | null; healthChanges: DayReport["healthChanges"]; stockDelta: Partial<Record<Supply | "coins", number>>; cargoDelta: Record<string, number> };
  /** What the event alone did. Missing when no event happened, and in games stored before this field. */
  eventOutcome?: EventOutcome;
  where: string; // stop name, or "between X and Y"
  /** The trip ended before this day ran (a removal mid-plan or mid-vote): only its votes are kept. */
  unfinished?: true;
}
export interface Recap {
  route: { stop: string; name: string; day: number }[];
  fates: { playerId: string; alive: boolean; day?: number; where?: string }[];
  bigCalls: { day: number; question: string; go: number; noGo: number; result: string }[]; // up to 3
  worstDay: { day: number; text: string } | null;
  reveals: { playerId: string; job: JobId; goal: string; met: boolean }[];
  haul: { coins: number; cargoSale: number; wealth: number; grade: Grade | null };
  /** How the trip ended, so the headline and the line tell the same story. */
  cause: "arrived" | "all-dead" | "deadline";
  line: string;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The server has no seat names, so recap text names a traveller with a token.
 * The client swaps each one for the seat name with `fillNames`.
 */
export const nameToken = (playerId: string) => `{{${playerId}}}`;
/** Tokens for everyone, for `buildRecap`'s `names`. */
export const nameTokens = (ids: string[]): Record<string, string> => Object.fromEntries(ids.map((id) => [id, nameToken(id)]));
/** Recap text with each name token swapped for `name(id)`. */
export function fillNames(text: string, name: (id: string) => string): string {
  return text.replace(/\{\{([^{}]+)\}\}/g, (_, id: string) => name(id));
}

interface Change {
  score: number;
  text: string;
}

/** What a day changed, scored with the worst-day weights on absolute values. `gains` adds the good news. */
function changes(d: DayLog, pack: SettingPack, names: Record<string, string>, gains: boolean): Change[] {
  const out: Change[] = [];
  for (const h of d.report.healthChanges) {
    const steps = h.from - h.to;
    if (steps > 0) out.push({ score: 10 * steps, text: hurtText(h, names) });
    else if (gains && steps < 0) out.push({ score: 10 * -steps, text: `${names[h.playerId] ?? "Someone"} got better` });
  }
  const add = (delta: number | undefined, weight: number, noun: string) => {
    const n = delta ?? 0;
    if (n < 0) out.push({ score: weight * -n, text: `Lost ${-n} ${noun}` });
    else if (gains && n > 0) out.push({ score: weight * n, text: `Got ${n} ${noun}` });
  };
  const s = d.report.stockDelta;
  add(s.food, 1, "food");
  add(s.water, 1, "water");
  add(s.coins, 0.5, "coins");
  // "Camels" -> "camels", and "camel" for one.
  const animals = pack.labels.animals.toLowerCase();
  add(s.animals, 5, Math.abs(s.animals ?? 0) === 1 ? animals.replace(/s$/, "") : animals);
  if (gains) {
    add(s.medicine, 1, "medicine");
    for (const [good, n] of Object.entries(d.report.cargoDelta)) add(n, 1, (pack.goods.find((g) => g.id === good)?.name ?? good).toLowerCase());
  }
  return out;
}

type HealthChange = DayLog["report"]["healthChanges"][number];

function hurtText(h: HealthChange, names: Record<string, string>): string {
  const who = names[h.playerId] ?? "Someone";
  return h.to === 0 ? `${who} died` : h.to === 1 ? `${who} was badly hurt` : `${who} got sick`;
}

/** "a", "a and b", "a, b and c". */
function listText(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The worst day's harm: everyone who got worse, worst first; else the biggest loss. */
function worstResult(d: DayLog, pack: SettingPack, names: Record<string, string>): string {
  const hurt = d.report.healthChanges.filter((h) => h.from > h.to).sort((a, b) => a.to - b.to || b.from - b.to - (a.from - a.to));
  if (hurt.length) return listText(hurt.map((h) => hurtText(h, names)));
  return dayResult(d, pack, names);
}

function biggest(cs: Change[]): Change | null {
  let best: Change | null = null;
  for (const c of cs) if (!best || c.score > best.score) best = c;
  return best;
}

function dayResult(d: DayLog, pack: SettingPack, names: Record<string, string>): string {
  const b = biggest(changes(d, pack, names, true));
  if (b) return b.text;
  return d.report.km > 0 ? `Moved ${d.report.km} km` : "Rested";
}

function planQuestion(p: Plan, route: RouteDef): string {
  let q = `${cap(p.pace)} pace, ${p.rations === "none" ? "no food" : `${p.rations} rations`}`;
  if (p.rest) q += ", rest";
  else if (p.fork) q += `, go to ${stopById(route, p.fork).name}`;
  return q;
}

export function buildRecap(
  log: DayLog[],
  pack: SettingPack,
  route: RouteDef,
  end: EndView,
  jobs: Record<string, JobId>,
  goals: Record<string, Goal>,
  goalText: Record<string, string>,
  randomInt: RandomInt,
  names: Record<string, string> = {},
): Recap {
  const players = Object.keys(jobs).filter((id) => !end.removed.includes(id));

  const stops: Recap["route"] = [{ stop: route.start, name: stopById(route, route.start).name, day: 1 }];
  for (const d of log) {
    const r = d.report.reached;
    if (r) stops.push({ stop: r, name: stopById(route, r).name, day: d.day });
  }

  const fates: Recap["fates"] = players.map((playerId) => {
    if (end.alive[playerId]) return { playerId, alive: true };
    const d = log.find((x) => x.report.healthChanges.some((h) => h.playerId === playerId && h.to === 0));
    return d ? { playerId, alive: false, day: d.day, where: d.where } : { playerId, alive: false };
  });

  const calls: { day: number; question: string; go: number; noGo: number; result: string; voters: number }[] = [];
  for (const d of log) {
    const result = dayResult(d, pack, names);
    for (const p of d.proposals) {
      const vs = Object.values(p.votes);
      const go = vs.filter((v) => v === "go").length;
      // A rejected plan never ran, so the day's outcome is not its result.
      calls.push({ day: d.day, question: planQuestion(p.plan, route), go, noGo: vs.length - go, result: p.passed ? result : "Rejected", voters: vs.length });
    }
    const ch = d.event?.choice;
    if (ch) {
      const vs = Object.values(ch.votes);
      const go = vs.filter((v) => v === ch.picked).length;
      calls.push({ day: d.day, question: ch.label, go, noGo: vs.length - go, result, voters: vs.length });
    }
  }
  // Closest first. A vote everyone agreed on is not close: leave those out unless there is nothing else.
  // A choice nobody voted on (0-0) was not a vote at all.
  const cast = calls.filter((c) => c.voters > 0);
  const split = cast.filter((c) => c.go > 0 && c.noGo > 0);
  const pool = split.length ? split : cast;
  pool.sort((a, b) => Math.abs(a.go - a.noGo) - Math.abs(b.go - b.noGo) || b.voters - a.voters || b.day - a.day);
  const bigCalls = pool.slice(0, 3).map(({ voters: _v, ...c }) => c);

  let worstDay: Recap["worstDay"] = null;
  let worst = 0;
  for (const d of log) {
    const score = changes(d, pack, names, false).reduce((a, c) => a + c.score, 0);
    if (score > worst) { // strictly greater, so ties go to the earliest day
      worst = score;
      const text = [d.event?.text, `${worstResult(d, pack, names)}.`].filter(Boolean).join(" ");
      worstDay = { day: d.day, text };
    }
  }

  const reveals = players.map((playerId) => {
    const goal = goals[playerId];
    return { playerId, job: jobs[playerId]!, goal: goalText[playerId] ?? "", met: goal ? goalMet(goal, end) : false };
  });

  const sale = cargoSale(end.cargo, end.endPrices);
  const cause: Recap["cause"] = end.arrived ? "arrived" : end.failedBy === "all-dead" ? "all-dead" : "deadline";
  const lines =
    cause === "arrived" ? pack.endLines.arrived[end.grade ?? "broke"] : cause === "all-dead" ? pack.endLines.failed.dead : pack.endLines.failed.deadline;
  const line = lines[randomInt(lines.length)] ?? "";

  return { route: stops, fates, bigCalls, worstDay, reveals, haul: { coins: end.coins, cargoSale: sale, wealth: end.coins + sale, grade: end.grade }, cause, line };
}
