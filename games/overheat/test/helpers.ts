import { seededRandomInt, type GameContext, type GameResult, type GameTransition } from "@games/game-core";
import { overheatGame as oh } from "../server/game.ts";
import { cardFromCode, enginePoints } from "../shared/rules.ts";
import {
  DEFAULT_SETTINGS,
  type Card,
  type EngineCard,
  type NumberCard,
  type OverheatAction,
  type OverheatEvent,
  type OverheatServerState,
  type OverheatSettings,
  type Status,
} from "../shared/types.ts";

export type Result = GameResult<OverheatServerState, OverheatEvent>;
export type Transition = GameTransition<OverheatServerState, OverheatEvent>;

export const ctx = (seed = 1): GameContext => ({ now: 0, randomInt: seededRandomInt(seed) });
export const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));

interface PlayerOpts {
  engine: string[];
  mult2: number[]; // indices into engine
  heat: number;
  gauge: number;
  status: Status;
  fuses: number;
  turbo: boolean;
  flipped: boolean;
  score: number;
  removed: boolean;
}

/**
 * A mid-round state on step "turn". Card ids are handed out in order:
 * players' engines, then the deck, then the discard. Heat defaults to the
 * engine's points; a player's gauge defaults to the round gauge (24).
 */
export function stateWith(opts: {
  n?: number;
  turn?: number;
  first?: number;
  gauge?: number;
  round?: number;
  deck?: string[];
  discard?: string[];
  settings?: Partial<OverheatSettings>;
  players?: Partial<PlayerOpts>[];
} = {}): OverheatServerState {
  const n = opts.n ?? opts.players?.length ?? 3;
  const gauge = opts.gauge ?? 24;
  let id = 0;
  const mk = (code: string): Card => {
    const c = cardFromCode(code, id++);
    if (!c) throw new Error(`bad card code ${code}`);
    return c;
  };
  const ps = Array.from({ length: n }, (_, i) => {
    const o = opts.players?.[i] ?? {};
    const engine: EngineCard[] = (o.engine ?? []).map((code, k) => ({
      card: mk(code) as NumberCard,
      mult: o.mult2?.includes(k) ? 2 : 1,
    }));
    return {
      id: `p${i}`,
      score: o.score ?? 0,
      removed: o.removed ?? false,
      status: o.status ?? "flipping",
      engine,
      heat: o.heat ?? enginePoints(engine),
      gauge: o.gauge ?? gauge,
      fuses: o.fuses ?? 0,
      turbo: o.turbo ?? false,
      flipped: o.flipped ?? false,
      redline: false,
      roundPoints: 0,
    };
  });
  const deck = (opts.deck ?? []).map(mk);
  const discard = (opts.discard ?? []).map(mk);
  return {
    phase: "playing",
    step: "turn",
    settings: { ...DEFAULT_SETTINGS, powers: "off", ...opts.settings },
    players: ps,
    round: opts.round ?? 1,
    gauge,
    firstIndex: opts.first ?? 0,
    turnIndex: opts.turn ?? 0,
    pending: null,
    deck,
    discard,
    roundEndsAt: 0,
    winnerIds: [],
    endReason: null,
  };
}

export function act(s: OverheatServerState, playerId: string, a: OverheatAction, c: GameContext = ctx()): Result {
  return oh.handleAction(s, playerId, a, c);
}
export function ok(r: Result): Transition {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}: ${r.error.message}`);
  return r.transition;
}
export function err(r: Result): string {
  if (r.ok) throw new Error("expected a rejection");
  return r.error.code;
}
export const types = (t: { events: { event: { type: string } }[] }) => t.events.map((e) => e.event.type);
export const find = <K extends OverheatEvent["type"]>(t: Transition, type: K) =>
  t.events.map((e) => e.event).find((e): e is Extract<OverheatEvent, { type: K }> => e.type === type);
