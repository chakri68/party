import { jobInfo } from "../shared/info.ts";
import { N } from "../shared/numbers.ts";
import { stopById, type RouteDef, type SettingPack } from "../shared/pack.ts";
import type { Band, Goal, LongTrailPrivateState, LongTrailPublicState, LongTrailServerState } from "../shared/types.ts";
import { activeIds, find, isAlive, isArmable, leaderOf, legOut, openPlan, world } from "./world.ts";

type State = LongTrailServerState;

/** The goal card's own words, or plain words when the deal changed its details. */
export function goalTexts(pack: SettingPack, route: RouteDef, goals: Record<string, Goal>, ids: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const seen = { protect: 0, visit: 0 };
  const protects = pack.goals.filter((g) => g.goal === "protect-someone");
  const visits = pack.goals.filter((g) => typeof g.goal !== "string" && g.goal.kind === "visit");
  for (const id of ids) {
    const goal = goals[id]!;
    if (goal.kind === "protect") {
      out[id] = protects[seen.protect++ % protects.length]?.text ?? "Make sure this traveller reaches the end alive.";
    } else if (goal.kind === "visit") {
      const card = visits[seen.visit++ % Math.max(1, visits.length)];
      const same = card && typeof card.goal !== "string" && card.goal.kind === "visit" && card.goal.stop === goal.stop;
      out[id] = same ? card.text : `Visit ${stopById(route, goal.stop).name}.`;
    } else {
      out[id] = pack.goals.find((g) => JSON.stringify(g.goal) === JSON.stringify(goal))?.text ?? "Help the caravan arrive.";
    }
  }
  return out;
}

// ---- projections -----------------------------------------------------------

export function band(stock: number, perDay: number): Band {
  const days = perDay <= 0 ? Infinity : Math.floor(stock / perDay);
  return days >= 6 ? "plenty" : days >= 3 ? "some" : days >= 1 ? "low" : "out";
}

export function publicState(state: State): LongTrailPublicState {
  const { pack, route } = world(state);
  const c = state.caravan;
  const plan = state.plan ?? openPlan(state);
  const living = state.travellers.filter((id) => isAlive(state, id)).length;
  const nextKind = c.leg?.kind ?? (c.at === route.end ? undefined : legOut(route, c.at, plan.fork)?.kind);
  const stop = stopById(route, c.at);
  const market = c.leg === null ? stop.market : undefined;
  const b = state.phase === "vote" ? state.ballot : state.phase === "choice" ? state.choiceBallot : null;
  const revealed = state.phase === "recap" || (state.phase === "over" && !state.interrupted);
  return {
    phase: state.phase,
    deadline: state.deadline,
    phaseMs: state.phaseMs,
    settings: { ...state.settings },
    players: state.players.map((p) => ({ id: p.id, left: p.left, job: state.jobs[p.id]! })),
    leader: leaderOf(state),
    proposalNo: state.proposalNo,
    day: c.day,
    deadlineDay: route.deadline,
    route: { start: route.start, end: route.end, stops: route.stops.map((s) => ({ id: s.id, name: s.name, next: s.next.map((l) => l.to), market: !!s.market })) },
    at: c.at,
    leg: c.leg ? { to: c.leg.to, km: c.leg.km, kind: c.leg.kind, kmLeft: c.kmLeft } : null,
    visited: [...c.visited],
    stock: {
      food: band(c.stock.food, living * N.foodPerTraveller[plan.rations]),
      water: band(c.stock.water, living * N.waterPerTraveller[nextKind === "desert" ? "desert" : "other"]),
      medicine: c.stock.medicine,
      coins: c.stock.coins,
      animals: c.stock.animals,
      cargo: { ...c.stock.cargo },
    },
    capacity: c.stock.animals * pack.capacityPerAnimal,
    prices: market ? { goods: { ...(c.prices[c.at] ?? {}) }, supplies: { ...market.supplies } } : null,
    travellers: state.travellers.map((id) => ({ id, health: c.health[id] ?? 0 })),
    openPlan: openPlan(state),
    plan: state.plan,
    votes: b ? { voted: b.eligible.filter((id) => id in b.votes), of: b.eligible.length } : null,
    proposals: state.proposals,
    choice: state.choice ? { id: state.choice.id, text: state.choice.text, options: [state.choice.options[0].label, state.choice.options[1].label] } : null,
    fired: [...state.fired],
    lastDay: state.lastDay,
    acked: activeIds(state).filter((id) => state.acks.includes(id)),
    recap: revealed ? state.recap : null,
    goals: revealed ? { ...state.goals } : null,
    interrupted: state.interrupted,
  };
}

export function privateState(state: State, playerId: string): LongTrailPrivateState {
  const p = find(state, playerId);
  const job = state.jobs[playerId];
  if (!p || !job) return { job: null, info: null, goal: null, goalText: null, ability: null, vote: null, choiceVote: null, acked: false };
  const { pack, route } = world(state);
  const live = !p.left && state.phase !== "over";
  const info = live ? jobInfo(job, state.caravan, pack, route, { dangers: state.dangers, plan: state.plan ?? openPlan(state), travellers: state.travellers, choice: state.choice }) : null;
  const ability = isArmable(job)
    ? { job, armed: state.armed[job], used: state.used[job], canArm: live && !state.used[job] && isAlive(state, playerId) }
    : null;
  return {
    job,
    info,
    goal: state.goals[playerId] ?? null,
    goalText: state.goalText[playerId] ?? null,
    ability,
    vote: state.ballot?.votes[playerId] ?? null,
    choiceVote: state.choiceBallot?.votes[playerId] ?? null,
    acked: state.acks.includes(playerId),
  };
}
