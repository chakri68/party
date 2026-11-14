import { stopById, type RouteDef, type SettingPack } from "./pack.ts";
import { cargoSale, goalMet, type EndView } from "./scoring.ts";
import type { DayReport } from "./travel.ts";
import type { Goal, Grade, JobId, Plan, Supply } from "./types.ts";

type RandomInt = (n: number) => number;

export interface DayLog {
  day: number;
  leader: string;
  plan: Plan;
  proposals: { by: string; votes: Record<string, "go" | "no-go">; passed: boolean }[];
  stayedCourse: boolean;
  event: { id: string; text: string; choice?: { votes: Record<string, 0 | 1>; picked: 0 | 1; label: string } } | null;
  report: { km: number; reached: string | null; healthChanges: DayReport["healthChanges"]; stockDelta: Partial<Record<Supply | "coins", number>>; cargoDelta: Record<string, number> };
  where: string; // stop name, or "between X and Y"
}
export interface Recap {
  route: { stop: string; name: string; day: number }[];
  fates: { playerId: string; alive: boolean; day?: number; where?: string }[];
  bigCalls: { day: number; question: string; go: number; noGo: number; result: string }[]; // up to 3
  worstDay: { day: number; text: string } | null;
  reveals: { playerId: string; job: JobId; goal: string; met: boolean }[];
  haul: { coins: number; cargoSale: number; wealth: number; grade: Grade | null };
  line: string;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lost = (d: number | undefined) => Math.max(0, -(d ?? 0));

interface Change {
  score: number;
  text: string;
}

/** Everything a day took away, scored with the worst-day formula. */
function changes(d: DayLog, names: Record<string, string>): Change[] {
  const out: Change[] = [];
  for (const h of d.report.healthChanges) {
    const steps = h.from - h.to;
    if (steps <= 0) continue;
    const who = names[h.playerId] ?? "Someone";
    const text = h.to === 0 ? `${who} died` : h.to === 1 ? `${who} was badly hurt` : `${who} got sick`;
    out.push({ score: 10 * steps, text });
  }
  const s = d.report.stockDelta;
  if (lost(s.food)) out.push({ score: lost(s.food), text: `Lost ${lost(s.food)} food` });
  if (lost(s.water)) out.push({ score: lost(s.water), text: `Lost ${lost(s.water)} water` });
  if (lost(s.coins)) out.push({ score: lost(s.coins) / 2, text: `Lost ${lost(s.coins)} coins` });
  if (lost(s.animals)) out.push({ score: 5 * lost(s.animals), text: `Lost ${lost(s.animals)} ${lost(s.animals) === 1 ? "animal" : "animals"}` });
  return out;
}

function biggest(cs: Change[]): Change | null {
  let best: Change | null = null;
  for (const c of cs) if (!best || c.score > best.score) best = c;
  return best;
}

function dayResult(d: DayLog, names: Record<string, string>): string {
  const b = biggest(changes(d, names));
  if (b) return b.text;
  return d.report.km > 0 ? `Moved ${d.report.km} km` : "Rested";
}

function planQuestion(d: DayLog, route: RouteDef): string {
  const p = d.plan;
  let q = `${cap(p.pace)} pace, ${p.rations} rations`;
  if (p.rest) q += ", rest";
  else if (p.fork) q += `, ${stopById(route, p.fork).name}`;
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
    const result = dayResult(d, names);
    for (const p of d.proposals) {
      const vs = Object.values(p.votes);
      const go = vs.filter((v) => v === "go").length;
      calls.push({ day: d.day, question: p.passed ? planQuestion(d, route) : "A plan that did not pass", go, noGo: vs.length - go, result, voters: vs.length });
    }
    const ch = d.event?.choice;
    if (ch) {
      const vs = Object.values(ch.votes);
      const go = vs.filter((v) => v === ch.picked).length;
      calls.push({ day: d.day, question: ch.label, go, noGo: vs.length - go, result, voters: vs.length });
    }
  }
  calls.sort((a, b) => Math.abs(a.go - a.noGo) - Math.abs(b.go - b.noGo) || b.voters - a.voters || b.day - a.day);
  const bigCalls = calls.slice(0, 3).map(({ voters: _v, ...c }) => c);

  let worstDay: Recap["worstDay"] = null;
  let worst = 0;
  for (const d of log) {
    const score = changes(d, names).reduce((a, c) => a + c.score, 0);
    if (score > worst) {
      worst = score;
      const text = [d.event?.text, `${dayResult(d, names)}.`].filter(Boolean).join(" ");
      worstDay = { day: d.day, text };
    }
  }

  const reveals = players.map((playerId) => {
    const goal = goals[playerId];
    return { playerId, job: jobs[playerId]!, goal: goalText[playerId] ?? "", met: goal ? goalMet(goal, end) : false };
  });

  const sale = cargoSale(end.cargo, end.endPrices);
  const lines = end.arrived && end.grade ? pack.endLines.arrived[end.grade] : pack.endLines.failed;
  const line = lines[randomInt(lines.length)] ?? "";

  return { route: stops, fates, bigCalls, worstDay, reveals, haul: { coins: end.coins, cargoSale: sale, wealth: end.coins + sale, grade: end.grade }, line };
}
