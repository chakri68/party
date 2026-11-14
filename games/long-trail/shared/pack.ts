import type { Goal, Grade, JobId, Length, SettingId, Stock, Supply } from "./types.ts";
import { tradeRoute } from "./packs/trade-route.ts";

export type LegKind = "desert" | "mountain" | "river" | "plain";
export type Danger = 0 | 1 | 2; // calm, rough, dangerous
/** At a fork, exactly one branch is safe. */
export interface Leg {
  to: string;
  km: number;
  kind: LegKind;
  safe?: boolean;
}
export interface StopDef {
  id: string;
  name: string;
  next: Leg[]; // [] at the end, 2 at a fork, otherwise 1
  market?: { goods: Record<string, [number, number]>; supplies: Partial<Record<Supply, number>> }; // price ranges, fixed supply prices
}
export interface RouteDef {
  start: string;
  end: string;
  deadline: number;
  stops: StopDef[];
}
export type Target = "everyone" | "random" | "weakest";
export interface Effect {
  stock?: Partial<Record<Supply | "coins", number>>;
  cargo?: number; // lose this many units of the most-held good (negative only)
  health?: { target: Target; steps: number }; // steps > 0 hurts
  km?: number; // negative = distance lost
  lostTime?: boolean; // marks it for the Scout
  chance?: { p: number; then: Effect; else?: Effect }; // p in 0..1
}
export interface PlainEvent {
  id: string;
  kind: LegKind | "any";
  severity: Danger;
  text: string;
  effect: Effect;
}
export interface ChoiceEvent {
  id: string;
  kind: LegKind | "any";
  severity: Danger;
  text: string;
  options: [{ label: string; effect: Effect }, { label: string; effect: Effect }]; // options[0] is the safer one
}
export type EventCard = PlainEvent | ChoiceEvent; // ChoiceEvent has `options`
export interface GoalCard {
  id: string;
  text: string;
  goal: Goal | "protect-someone"; // "protect-someone" gets a target when dealt
}
export interface SettingPack {
  id: SettingId;
  name: string;
  labels: Record<Supply | "coins" | "cargo", string>;
  goods: { id: string; name: string }[];
  jobs: Record<JobId, { name: string; info: string; ability: string }>; // copy for the view and rules
  routes: Record<Length, RouteDef>;
  start(players: number): Stock;
  capacityPerAnimal: number;
  events: EventCard[];
  goals: GoalCard[];
  grades: Record<Grade, number>; // wealth thresholds, broke = 0
  endLines: { arrived: Record<Grade, string[]>; failed: string[] };
}

const PACKS: Record<SettingId, SettingPack> = { "trade-route": tradeRoute };

export function packFor(id: SettingId): SettingPack {
  return PACKS[id];
}

export function stopById(route: RouteDef, id: string): StopDef {
  const s = route.stops.find((x) => x.id === id);
  if (!s) throw new Error(`no stop ${id}`);
  return s;
}

/** Every start to end path, as stop ids. */
export function pathsOf(route: RouteDef): string[][] {
  const out: string[][] = [];
  const walk = (id: string, path: string[]) => {
    const here = [...path, id];
    const stop = stopById(route, id);
    if (stop.next.length === 0) out.push(here);
    for (const leg of stop.next) walk(leg.to, here);
  };
  walk(route.start, []);
  return out;
}
