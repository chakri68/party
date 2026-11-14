import type { ChoiceEvent, Danger, Effect, EventCard, LegKind, RouteDef, SettingPack } from "./pack.ts";
import { roll, type Caravan, type DayReport } from "./travel.ts";
import type { ArmableJob, Health, JobId, Supply } from "./types.ts";

type RandomInt = (n: number) => number;

/** Odds of a severity 0, 1, 2 card, by the leg's danger. */
export const SEVERITY_WEIGHTS: Record<Danger, [number, number, number]> = { 0: [3, 1, 0], 1: [1, 2, 1], 2: [0, 1, 3] };

/** Quartermaster cache, added at the end of the next moving day's travel. */
export const CACHE_FOOD = 10;

export interface EffectReport {
  text: string[];
  healthChanges: DayReport["healthChanges"];
  stock: Partial<Record<Supply | "coins", number>>; // what actually changed, after clamping
  km: number; // what actually changed on the leg, negative = lost
}
export interface Armed {
  guide: boolean;
  scout: boolean;
  quartermaster: boolean;
  lookout: boolean;
}
export interface Used {
  guide: boolean;
  scout: boolean;
  quartermaster: boolean;
  lookout: boolean;
}

export const isChoice = (card: EventCard): card is ChoiceEvent => "options" in card;

/**
 * One danger per leg, keyed `${from}>${to}`. Uniform over calm, rough, dangerous,
 * except the safe branch at a fork, which is never dangerous.
 */
export function rollDangers(route: RouteDef, randomInt: RandomInt): Record<string, Danger> {
  const out: Record<string, Danger> = {};
  for (const stop of route.stops) {
    for (const leg of stop.next) out[`${stop.id}>${leg.to}`] = randomInt(leg.safe ? 2 : 3) as Danger;
  }
  return out;
}

/** Cards matching `kind`, minus `exclude`; the full matching pool again once that runs dry. */
function draw(pack: SettingPack, kind: LegKind | "any", danger: Danger, randomInt: RandomInt, exclude: string[], keep: (card: EventCard) => boolean): EventCard {
  const matching = pack.events.filter((e) => (e.kind === kind || e.kind === "any") && keep(e));
  if (matching.length === 0) throw new Error(`no events for ${kind}`);
  const fresh = matching.filter((e) => !exclude.includes(e.id));
  const pool = fresh.length > 0 ? fresh : matching;
  const bySeverity: EventCard[][] = [[], [], []];
  for (const e of pool) bySeverity[e.severity]?.push(e);
  const weights = SEVERITY_WEIGHTS[danger].map((w, s) => (bySeverity[s]?.length ? w : 0));
  const present = [0, 1, 2].filter((s) => bySeverity[s]?.length);
  // If the danger gives every severity in the pool zero weight, fall back to what exists.
  const usable = weights.some((w) => w > 0) ? weights : [0, 1, 2].map((s) => (present.includes(s) ? 1 : 0));
  let r = randomInt(usable.reduce((a, b) => a + b, 0));
  let severity = present[present.length - 1] ?? 0;
  for (let s = 0; s < 3; s++) {
    const w = usable[s] ?? 0;
    if (r < w) {
      severity = s;
      break;
    }
    r -= w;
  }
  const cards = bySeverity[severity] ?? [];
  return cards[randomInt(cards.length)] as EventCard;
}

export function drawEvent(pack: SettingPack, kind: LegKind | "any", danger: Danger, randomInt: RandomInt, exclude: string[]): EventCard {
  return draw(pack, kind, danger, randomInt, exclude, () => true);
}

const livingOf = (c: Caravan, travellers: string[]) => travellers.filter((id) => (c.health[id] ?? 0) > 0);
/** One pick from a list; randomInt is only used when there is a real choice to make. */
const pick = <T>(list: T[], randomInt: RandomInt): T | undefined => (list.length > 1 ? list[randomInt(list.length)] : list[0]);

/** True if the effect, or either side of a chance, is marked lostTime. */
export function hasLostTime(effect: Effect): boolean {
  return !!effect.lostTime || (!!effect.chance && (hasLostTime(effect.chance.then) || (!!effect.chance.else && hasLostTime(effect.chance.else))));
}

/**
 * Applies an effect to the caravan. Stock clamps at 0. Km moves the current leg only:
 * lost km never go past the stop the leg started from, and nothing moves while halted.
 * Gained km never finish the leg (arrival happens on a travel day).
 * `scout` zeroes the km on every lostTime effect it applies.
 */
export function applyEffect(c: Caravan, effect: Effect, travellers: string[], randomInt: RandomInt, opts: { scout?: boolean } = {}): EffectReport {
  const report: EffectReport = { text: [], healthChanges: [], stock: {}, km: 0 };
  const run = (e: Effect) => {
    for (const [item, delta] of Object.entries(e.stock ?? {}) as [Supply | "coins", number][]) {
      const before = c.stock[item];
      c.stock[item] = Math.max(0, before + delta);
      const real = c.stock[item] - before;
      if (real !== 0) {
        report.stock[item] = (report.stock[item] ?? 0) + real;
        report.text.push(`${item} ${real > 0 ? "+" : ""}${real}`);
      }
    }
    if (e.cargo) {
      let left = -e.cargo;
      let lost = 0;
      while (left > 0) {
        const top = Object.entries(c.stock.cargo).reduce<[string, number] | null>((best, kv) => (kv[1] > 0 && (!best || kv[1] > best[1]) ? kv : best), null);
        if (!top) break;
        const take = Math.min(left, 1);
        c.stock.cargo[top[0]] = top[1] - take;
        left -= take;
        lost += take;
      }
      if (lost > 0) report.text.push(`cargo -${lost}`);
    }
    if (e.health) {
      const living = livingOf(c, travellers);
      let targets: string[] = [];
      if (e.health.target === "everyone") targets = living;
      else if (e.health.target === "random") targets = [pick(living, randomInt)].filter((x): x is string => x !== undefined);
      else {
        const low = Math.min(...living.map((id) => c.health[id] ?? 0));
        const weakest = pick(living.filter((id) => (c.health[id] ?? 0) === low), randomInt);
        targets = weakest === undefined ? [] : [weakest];
      }
      for (const id of targets) {
        const from = c.health[id] ?? 0;
        const to = Math.min(3, Math.max(0, from - e.health.steps)) as Health;
        c.health[id] = to;
        if (to !== from) report.healthChanges.push({ playerId: id, from, to });
      }
    }
    if (e.km && c.leg && !(opts.scout && e.lostTime)) {
      const before = c.kmLeft;
      c.kmLeft = e.km < 0 ? Math.min(c.leg.km, before - e.km) : Math.max(Math.min(before, 1), before - e.km);
      const real = before - c.kmLeft; // positive = gained
      if (real !== 0) {
        report.km += real;
        report.text.push(`${real > 0 ? "+" : ""}${real} km`);
      }
    }
    if (e.chance) {
      const branch = roll(e.chance.p, randomInt) ? e.chance.then : e.chance.else;
      if (branch) run(branch);
    }
  };
  run(effect);
  return report;
}

export interface ResolvedEvent {
  card: EventCard;
  fired: ArmableJob[];
  pendingChoice: ChoiceEvent | null;
  report: EffectReport | null;
}

const canUse = (job: ArmableJob, armed: Armed, used: Used, alive: Record<JobId, boolean>) => armed[job] && !used[job] && alive[job];
const spend = (job: ArmableJob, armed: Armed, used: Used, fired: ArmableJob[]) => {
  used[job] = true;
  armed[job] = false;
  fired.push(job);
};

/**
 * Plays out one drawn card. An armed, unused, living Guide rerolls the first plain card
 * (another plain one, the reroll stands). A Lookout swaps the first choice card for
 * another choice. A Scout saves the km of a lostTime effect. Plain events apply now;
 * a choice comes back as `pendingChoice` and applies through resolveChoice.
 * Mutates `armed` and `used`. Rerolls draw from the card's own kind at its own severity's danger.
 */
export function resolveEvent(
  c: Caravan,
  pack: SettingPack,
  card: EventCard,
  armed: Armed,
  used: Used,
  alive: Record<JobId, boolean>,
  travellers: string[],
  randomInt: RandomInt,
): ResolvedEvent {
  const fired: ArmableJob[] = [];
  const kind = c.leg?.kind ?? card.kind;
  if (isChoice(card) && canUse("lookout", armed, used, alive)) {
    spend("lookout", armed, used, fired);
    card = draw(pack, kind, card.severity, randomInt, [card.id], isChoice);
  } else if (!isChoice(card) && canUse("guide", armed, used, alive)) {
    spend("guide", armed, used, fired);
    card = draw(pack, kind, card.severity, randomInt, [card.id], (e) => !isChoice(e));
  }
  if (isChoice(card)) return { card, fired, pendingChoice: card, report: null };
  const scout = canUse("scout", armed, used, alive) && hasLostTime(card.effect);
  if (scout) spend("scout", armed, used, fired);
  return { card, fired, pendingChoice: null, report: applyEffect(c, card.effect, travellers, randomInt, { scout }) };
}

/** Applies the chosen option of a choice event, with the Scout's save if it is armed and applies. */
export function resolveChoice(
  c: Caravan,
  card: ChoiceEvent,
  option: 0 | 1,
  armed: Armed,
  used: Used,
  alive: Record<JobId, boolean>,
  travellers: string[],
  randomInt: RandomInt,
): { fired: ArmableJob[]; report: EffectReport } {
  const fired: ArmableJob[] = [];
  const effect = card.options[option].effect;
  const scout = canUse("scout", armed, used, alive) && hasLostTime(effect);
  if (scout) spend("scout", armed, used, fired);
  return { fired, report: applyEffect(c, effect, travellers, randomInt, { scout }) };
}
