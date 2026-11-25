import { seededRandomInt, type GameContext, type GameResult, type GameTransition } from "@games/game-core";
import { notMyProblemGame as nmp } from "../server/game.ts";
import type { State } from "../server/state.ts";
import {
  DEFAULT_SETTINGS,
  type ActionKind,
  type NmpAction,
  type NmpEvent,
  type NmpSettings,
  type ProblemKind,
} from "../shared/index.ts";

export const ctx = (now = 0, seed = 1): GameContext => ({ now, randomInt: seededRandomInt(seed) });

/** Hands by seat, and the draw pile top first. Ids are `${kind}-${k}`, counted in that order. */
export interface TestDeck {
  hands: ActionKind[][];
  pile: (ActionKind | ProblemKind)[];
}

export const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

/** A new game for p0..p(n-1), dealer at seat 0 unless given. */
export function start(n: number, deck?: TestDeck, settings: Partial<NmpSettings> = {}, dealerSeat = 0, now = 0): State {
  return startWith(n, deck, settings, dealerSeat, now).state;
}

export function startWith(n: number, deck?: TestDeck, settings: Partial<NmpSettings> = {}, dealerSeat = 0, now = 0) {
  return nmp.createGame(
    ids(n).map((id) => ({ id })),
    { ...DEFAULT_SETTINGS, ...settings },
    { roundNumber: 1, dealerSeat },
    ctx(now),
    deck ? { deck: deck as unknown as unknown[] } : undefined,
  );
}

/** An action without a token gets the state's current one. */
type Loose<A> = A extends { token: number } ? Omit<A, "token"> & { token?: number } : never;
export type LooseAction = Loose<NmpAction>;

export function tryAct(state: State, playerId: string, action: LooseAction, c: GameContext = ctx()): GameResult<State, NmpEvent> {
  return nmp.handleAction(state, playerId, { token: state.token, ...action } as NmpAction, c);
}

export function act(state: State, playerId: string, action: LooseAction, c: GameContext = ctx()): GameTransition<State, NmpEvent> {
  const r = tryAct(state, playerId, action, c);
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}: ${r.error.message}`);
  return r.transition;
}

/** Fires the current step's timer. */
export function fireTimer(state: State, c: GameContext = ctx()): GameTransition<State, NmpEvent> {
  return nmp.onTimer!(state, `step:${state.token}`, c);
}

/** The first card of this kind in the player's hand. */
export function cardOf(state: State, playerId: string, kind: ActionKind): string {
  const card = state.players.find((p) => p.id === playerId)!.hand.find((c) => c.kind === kind);
  if (!card) throw new Error(`${playerId} holds no ${kind}`);
  return card.id;
}

export const player = (state: State, playerId: string) => state.players.find((p) => p.id === playerId)!;
export const turnPlayer = (state: State) => state.players[state.turnIndex]!.id;
