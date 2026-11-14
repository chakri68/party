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

interface Change {
  score: number;
  text: string;
}

/** What a day changed, scored with the worst-day weights on absolute values. `gains` adds the good news. */
function changes(d: DayLog, pack: SettingPack, names: Record<string, string>, gains: boolean): Change[] {
  const out: Change[] = [];
  for (const h of d.report.healthChanges) {
    const steps = h.from - h.to;
    const who = names[h.playerId] ?? "Someone";
    if (steps > 0) out.push({ score: 10 * steps, text: h.to === 0 ? `${who} died` : h.to === 1 ? `${who} was badly hurt` : `${who} got sick` });
    else if (gains && steps < 0) out.push({ score: 10 * -steps, text: `${who} got better` });
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
  const an = s.animals ?? 0;
  add(s.animals, 5, Math.abs(an) === 1 ? "animal" : "animals");
  if (gains) {
    add(s.medicine, 1, "medicine");
    for (const [good, n] of Object.entries(d.report.cargoDelta)) add(n, 1, (pack.goods.find((g) => g.id === good)?.name ?? good).toLowerCase());
  }
  return out;
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
  let q = `${cap(p.pace)} pace, ${p.rations} rations`;
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
      calls.push({ day: d.day, question: planQuestion(p.plan, route), go, noGo: vs.length - go, result, voters: vs.length });
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
    const score = changes(d, pack, names, false).reduce((a, c) => a + c.score, 0);
    if (score > worst) { // strictly greater, so ties go to the earliest day
      worst = score;
      const text = [d.event?.text, `${dayResult(d, pack, names)}.`].filter(Boolean).join(" ");
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
