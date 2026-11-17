import type { EventOutcome } from "../../shared/events.ts";
import type { ChoiceEvent, LegKind, RouteDef, SceneId, SettingPack } from "../../shared/pack.ts";
import type { DayLog } from "../../shared/recap.ts";
import type { Health, LongTrailPublicState, Pace, Plan } from "../../shared/types.ts";

export type Terrain = LegKind | "town" | "market" | "gate";
export interface Walker {
  id: string;
  color: string;
  health: Health; // the final health; 0 = fades out in settle
  riding: boolean;
}
export type BeatKind = "travel" | "event" | "situation" | "settle";
export interface Beat {
  kind: BeatKind;
  ms: number; // Infinity for "situation"
  health: Record<string, Health>; // what each walker is drawn with as this beat starts
  camels: number; // camels drawn as this beat starts
  scene?: SceneId; // event and situation beats
  outcome?: EventOutcome | null; // event beats
  fill?: [number, number]; // travel: share of the leg walked at the start and at the end, 0..1
  arrive?: string | null; // travel: stop id reached, slides in
  speed?: 0 | 1 | 2 | 3; // travel: the day's pace
  terrain?: Terrain; // travel: the walked leg's kind, also on the day it ends at a stop
}
export interface SceneModel {
  terrain: Terrain;
  fork: boolean; // halted at a fork with no leg yet: draw two alike paths
  camp: boolean;
  speed: 0 | 1 | 2 | 3; // 0 stopped (halted or camping), then slow, steady, hard
  walkers: Walker[];
  camels: number;
  overloaded: boolean;
  beats: Beat[]; // [] in plan and vote
  beatsKey: string; // `${phase}:${day}`; a new key starts the sequence again
}
export interface SceneInput {
  game: LongTrailPublicState;
  pack: SettingPack;
  route: RouteDef;
  draft: Plan | null; // the leader's draft in plan, else null
  colorOf: (playerId: string) => string | null;
}
export const FALLBACK_COLOR = "#d9c3a0";

const MS = { travel: 3000, event: 4000, result: 5000, settle: 2000 } as const;
const SPEED: Record<Pace, 1 | 2 | 3> = { slow: 1, steady: 2, hard: 3 };
type Report = DayLog["report"];

/** The plan the scene shows: the draft, the one up for a vote, or the day's. */
function shownPlan({ game, draft }: SceneInput): Plan {
  if (game.phase === "plan") return draft ?? game.openPlan;
  if (game.phase === "vote") return game.plan ?? game.openPlan;
  if (game.phase === "choice" && game.today) return game.today.plan;
  if (game.phase === "summary" && game.lastDay) return game.lastDay.plan;
  return game.openPlan;
}

/** The report of the day being played out: today's in a choice, the last day's in the summary. */
function playedReport(game: LongTrailPublicState): Report | null {
  if (game.phase === "choice") return game.today?.report ?? null;
  if (game.phase === "summary" && game.lastDay && !game.lastDay.unfinished) return game.lastDay.report;
  return null;
}

/** Health before the given changes, walking them back from `now`. */
function before(now: Record<string, Health>, changes: Report["healthChanges"]): Record<string, Health> {
  const out = { ...now };
  for (let i = changes.length - 1; i >= 0; i--) {
    const c = changes[i]!;
    if (c.playerId in out) out[c.playerId] = c.from;
  }
  return out;
}

/** Health after the given changes, from `start`. */
function after(start: Record<string, Health>, changes: Report["healthChanges"]): Record<string, Health> {
  const out = { ...start };
  for (const c of changes) if (c.playerId in out) out[c.playerId] = c.to;
  return out;
}

/** Health-1 walkers in `order` who ride: only the first `camels` of them. */
export function ridingIds(order: string[], health: Record<string, Health>, camels: number): Set<string> {
  return new Set(order.filter((id) => health[id] === 1).slice(0, Math.max(0, camels)));
}

/** The leg that ended at `reached` today, from the stop visited before it. */
function finishedLeg({ game, route }: SceneInput, reached: string) {
  const from = game.visited[game.visited.lastIndexOf(reached) - 1];
  return route.stops.find((x) => x.id === from)?.next.find((l) => l.to === reached);
}

/** Share of the leg walked before and after the day's travel. */
function fillOf(input: SceneInput, report: Report, eventKm: number): [number, number] {
  const { game } = input;
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  if (game.leg) {
    const end = (game.leg.km - game.leg.kmLeft - eventKm) / game.leg.km;
    return [clamp(end - report.km / game.leg.km), clamp(end)];
  }
  if (report.reached) {
    // The pack route's km: approximate on legs whose km is rolled per game (forks).
    const km = finishedLeg(input, report.reached)?.km;
    return [km ? clamp(1 - report.km / km) : 0, 1];
  }
  return [0, 0];
}

function beatsOf(input: SceneInput, final: Record<string, Health>, plan: Plan, terrain: Terrain): Beat[] {
  const { game, pack } = input;
  const report = playedReport(game);
  if (!report) return [];
  const outcome = game.phase === "summary" ? (game.lastDay!.eventOutcome ?? null) : null;
  const eventPart = outcome ? report.healthChanges.slice(report.healthChanges.length - outcome.healthChanges.length) : [];
  // Travel's own changes show in settle, so every beat before it starts from the day's start.
  const atStart = before(final, report.healthChanges);
  const camels = game.stock.animals;
  const camelsAt = (delta: number | undefined) => Math.max(0, camels - (delta ?? 0));
  const beats: Beat[] = [];
  const event = game.phase === "summary" ? game.lastDay!.event : null;
  const choiceDone = !!event?.choice;
  if (!plan.rest && !choiceDone) {
    beats.push({
      kind: "travel",
      ms: MS.travel,
      health: atStart,
      camels: camelsAt(report.stockDelta.animals),
      fill: fillOf(input, report, outcome?.km ?? 0),
      arrive: report.reached,
      speed: SPEED[plan.pace],
      terrain: game.leg?.kind ?? (report.reached ? finishedLeg(input, report.reached)?.kind : undefined) ?? terrain,
    });
  }
  if (game.phase === "choice") {
    const card = pack.events.find((e) => e.id === game.choice?.id);
    beats.push({ kind: "situation", ms: Infinity, health: { ...atStart }, camels, scene: card?.scene ?? "calm" });
    return beats;
  }
  if (event) {
    const card = pack.events.find((e) => e.id === event.id);
    let scene: SceneId | undefined;
    if (event.choice) {
      const opt = (card as ChoiceEvent | undefined)?.options?.[event.choice.picked];
      scene = outcome?.lucky === false ? (opt?.badScene ?? opt?.scene) : opt?.scene;
    } else scene = card?.scene;
    beats.push({ kind: "event", ms: choiceDone ? MS.result : MS.event, health: { ...atStart }, camels: camelsAt(outcome?.stock.animals), scene: scene ?? "calm", outcome });
  }
  beats.push({ kind: "settle", ms: MS.settle, health: after(atStart, eventPart), camels });
  return beats;
}

export function sceneModel(input: SceneInput): SceneModel {
  const { game, route, colorOf } = input;
  const plan = shownPlan(input);
  const stop = game.route.stops.find((x) => x.id === game.at);
  const terrain: Terrain = game.leg ? game.leg.kind : game.at === route.end ? "gate" : stop?.market ? "market" : "town";

  const report = playedReport(game);
  const diedToday = new Set((report?.healthChanges ?? []).filter((c) => c.to === 0).map((c) => c.playerId));
  const left = new Set(game.players.filter((p) => p.left).map((p) => p.id));
  const shown = game.travellers.filter((t) => !left.has(t.id) && (t.health > 0 || diedToday.has(t.id)));
  const camels = game.stock.animals;
  const final = Object.fromEntries(shown.map((t) => [t.id, t.health])) as Record<string, Health>;
  const riding = ridingIds(shown.map((t) => t.id), final, camels);
  const walkers: Walker[] = shown.map((t) => ({ id: t.id, color: colorOf(t.id) ?? FALLBACK_COLOR, health: t.health, riding: riding.has(t.id) }));

  const load = Object.values(game.stock.cargo).reduce((a, n) => a + n, 0);
  return {
    terrain,
    fork: !game.leg && (stop?.next.length ?? 0) === 2,
    camp: plan.rest,
    speed: !game.leg || plan.rest ? 0 : SPEED[plan.pace],
    walkers,
    camels,
    overloaded: load > game.capacity,
    beats: beatsOf(input, final, plan, terrain),
    beatsKey: `${game.phase}:${game.day}`,
  };
}
