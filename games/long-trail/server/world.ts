import { packFor, stopById, type Leg, type RouteDef, type SettingPack } from "../shared/pack.ts";
import type { ArmableJob, JobId, LongTrailServerState, Pace, Plan, Rations } from "../shared/types.ts";

// Read-only lookups on server state, shared by the phase machine and the views.

type State = LongTrailServerState;

export const JOBS: JobId[] = ["guide", "healer", "trader", "quartermaster", "scout", "driver", "cook", "lookout"];
export const ARMABLE: readonly JobId[] = ["guide", "scout", "quartermaster", "lookout"];
export const isArmable = (job: JobId | undefined): job is ArmableJob => !!job && ARMABLE.includes(job);

export const world = (state: State): { pack: SettingPack; route: RouteDef } => {
  const pack = packFor(state.settings.setting);
  return { pack, route: pack.routes[state.settings.length] };
};
export const find = (state: State, id: string) => state.players.find((p) => p.id === id);
export const activeIds = (state: State) => state.players.filter((p) => !p.left).map((p) => p.id);
export const leaderOf = (state: State) => state.players[state.leader]!.id;
export const isAlive = (state: State, id: string) => state.travellers.includes(id) && (state.caravan.health[id] ?? 0) > 0;
/** The job's holder is still travelling and alive. Dead travellers lose their ability. */
export const jobAlive = (state: State, job: JobId) => state.travellers.some((id) => state.jobs[id] === job && isAlive(state, id));
export const aliveJobs = (state: State) => Object.fromEntries(JOBS.map((j) => [j, jobAlive(state, j)])) as Record<JobId, boolean>;

/** The way out of a halted stop: the picked branch at a fork, the one leg otherwise. */
export function legOut(route: RouteDef, at: string, fork: string | null): Leg | undefined {
  const next = stopById(route, at).next;
  return next.length === 2 ? (next.find((l) => l.to === fork) ?? next.find((l) => l.safe) ?? next[0]) : next[0];
}

/** Yesterday's pace and rations (day 1: steady, full), the safe branch at a fork, nothing else. */
export function openPlan(state: State): Plan {
  const { route } = world(state);
  const c = state.caravan;
  const fork = c.leg === null && stopById(route, c.at).next.length === 2 ? (legOut(route, c.at, null)?.to ?? null) : null;
  const pace: Pace = state.lastPlan?.pace ?? "steady";
  const rations: Rations = state.lastPlan?.rations ?? "full";
  return { pace, rations, rest: false, fork, doses: [], trades: [] };
}
