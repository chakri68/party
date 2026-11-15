import { stopById, type Leg, type RouteDef } from "./pack.ts";

type RandomInt = (n: number) => number;

/**
 * Per game, each fork's risky way gets its own km, so which way is shorter is news every game
 * and the Scout's info matters. Keyed by the fork's stop id. `km` is keyed by leg, `${from}>${to}`.
 * The server keeps this in state; the pack's own km and safe flags are only the starting shape.
 */
export type ForkRolls = Record<string, { safe: string; km: Record<string, number> }>;

/** The legs of one way out of a fork, up to the stop where the two ways meet. */
function wayLegs(route: RouteDef, fork: string, first: Leg, meet: string): { from: string; leg: Leg }[] {
  const out: { from: string; leg: Leg }[] = [];
  let from = fork;
  for (let leg: Leg | undefined = first; leg; ) {
    out.push({ from, leg });
    if (leg.to === meet) break;
    from = leg.to;
    const next = stopById(route, from).next;
    leg = next.length === 1 ? next[0] : undefined;
  }
  return out;
}

/** Stops reached from a leg on, one way only (stops at the next fork or the end). */
function reach(route: RouteDef, first: Leg): string[] {
  const out: string[] = [];
  for (let leg: Leg | undefined = first; leg; ) {
    out.push(leg.to);
    const next: Leg[] = stopById(route, leg.to).next;
    leg = next.length === 1 ? next[0] : undefined;
  }
  return out;
}

/** How the risky way's km compare with the safe way's, leg by leg: 40% shorter to 30% longer. */
const RISKY_SCALE = [0.6, 0.7, 0.8, 0.9, 1.1, 1.2, 1.3] as const;

/**
 * For each fork: the safe way stays the pack's safe way, with its own km, so the safe path is as
 * long as it always was and the deadlines stay as reachable as before. The risky way gets the safe
 * way's km, each leg scaled by a roll from RISKY_SCALE (to the nearest 10 km), so it is shorter in
 * some games and longer in others. A risky way with a different leg count scales its own km.
 */
export function rollForks(route: RouteDef, randomInt: RandomInt): ForkRolls {
  const out: ForkRolls = {};
  for (const stop of route.stops) {
    if (stop.next.length !== 2) continue;
    const [a, b] = stop.next as [Leg, Leg];
    const onB = reach(route, b);
    const meet = reach(route, a).find((id) => onB.includes(id)) ?? route.end;
    const ways = [wayLegs(route, stop.id, a, meet), wayLegs(route, stop.id, b, meet)] as const;
    const safeIdx = b.safe ? 1 : 0;
    const safeKm = ways[safeIdx]!.map((x) => x.leg.km);
    const km: Record<string, number> = {};
    ways.forEach((w, i) => {
      const same = w.length === safeKm.length;
      w.forEach((x, j) => {
        const base = same ? safeKm[j]! : x.leg.km;
        const scale = i === safeIdx ? 1 : RISKY_SCALE[randomInt(RISKY_SCALE.length)]!;
        km[`${x.from}>${x.leg.to}`] = Math.max(10, Math.round((base * scale) / 10) * 10);
      });
    });
    out[stop.id] = { safe: stop.next[safeIdx]!.to, km };
  }
  return out;
}

/** The route as this game has it: the rolled km on fork legs, and the rolled safe way. */
export function withForks(route: RouteDef, forks: ForkRolls): RouteDef {
  const km = Object.assign({}, ...Object.values(forks).map((f) => f.km)) as Record<string, number>;
  return {
    ...route,
    stops: route.stops.map((s) => ({
      ...s,
      next: s.next.map((l) => {
        const leg: Leg = { to: l.to, km: km[`${s.id}>${l.to}`] ?? l.km, kind: l.kind };
        const f = forks[s.id];
        if (f) leg.safe = l.to === f.safe;
        else if (l.safe !== undefined) leg.safe = l.safe;
        return leg;
      }),
    })),
  };
}
