import type { GameEventEnvelope, PartyStats, TimerRequest } from "@games/game-core";
import type { ActionCard, NmpEvent, NmpSettings, PileCard, ProblemCard, Step } from "../shared/types.ts";

export interface ServerPlayer {
  id: string;
  hand: ActionCard[];
  warnings: number;
  shield: ActionCard | null;
  overtime: boolean;
  fired: boolean;
  firedOrder: number | null;
  removed: boolean;
  away: boolean;
}

export interface ServerProblem {
  card: ProblemCard;
  ownerId: string;
  lastMovedFromId: string | null;
  /** Transfer attempts used (Blame Game and Revenge, canceled ones too). */
  attempts: number;
}

export type ServerMove =
  | { kind: "blame"; actorId: string; card: ActionCard; targetId: string }
  | { kind: "not-me"; actorId: string; card: ActionCard }
  | { kind: "revenge"; actorId: string; card: ActionCard; targetId: string };

export interface State {
  settings: NmpSettings;
  players: ServerPlayer[];
  /** Top is index 0. */
  drawPile: PileCard[];
  discard: ActionCard[];
  /** Cards played face down that nobody saw. */
  hiddenDiscard: ActionCard[];
  resolvedProblems: ProblemCard[];
  step: Step;
  /** Bumped on every step change. Actions and timers carry it. */
  token: number;
  round: number;
  /** The seat that played first. A new round starts when the turn comes back to it. */
  firstSeat: number;
  turnIndex: number;
  actionsLeft: number;
  drawsLeft: number;
  /** The turn player was fired or removed: end the turn once the Problem is gone. */
  turnOver: boolean;
  problem: ServerProblem | null;
  moves: ServerMove[];
  report: { ownerId: string; reportCard: ActionCard; faceDown: ActionCard } | null;
  passed: string[];
  deadline: number | null;
  windowMs: number | null;
  pausedLeftMs: number | null;
  firedCount: number;
  lastEvent: NmpEvent | null;
  winnerIds: string[];
  stats: PartyStats;
}

/** What a transition says besides the state. Helpers push into it. */
export interface Out {
  events: GameEventEnvelope<NmpEvent>[];
  timers: TimerRequest[];
}

export const newOut = (): Out => ({ events: [], timers: [] });
export const clone = (s: State): State => structuredClone(s);
export const done = (state: State, out: Out) => ({ state, events: out.events, timers: out.timers });

/**
 * A public event. It also becomes the feed line, except a new turn or a pass:
 * those would hide the last outcome (warned, fixed, moved, ...).
 */
export function emit(s: State, out: Out, e: NmpEvent): void {
  out.events.push({ visibility: { kind: "public" }, event: e });
  if (e.type !== "turn" && e.type !== "passed") s.lastEvent = e;
}

/** An event only this player gets. */
export function tell(out: Out, playerId: string, e: NmpEvent): void {
  out.events.push({ visibility: { kind: "private", playerId }, event: e });
}

export const timerId = (token: number) => `step:${token}`;

/** Bumps token, cancels the old step timer, sets `step:${token}` for ms, sets deadline/windowMs. */
export function setStep(s: State, out: Out, step: Step, ms: number | null, now: number): void {
  out.timers.push({ kind: "cancel", timerId: timerId(s.token) });
  s.token++;
  s.step = step;
  s.passed = [];
  if (ms === null) {
    s.deadline = null;
    s.windowMs = null;
    return;
  }
  out.timers.push({ kind: "set", timerId: timerId(s.token), delayMs: ms });
  s.deadline = now + ms;
  s.windowMs = ms;
}

export const alive = (p: ServerPlayer): boolean => !p.fired && !p.removed;

export function playerById(s: State, id: string): ServerPlayer | undefined {
  return s.players.find((p) => p.id === id);
}

export const turnPlayerOf = (s: State): ServerPlayer => s.players[s.turnIndex]!;

/** Takes the card out of the hand and puts it face up on the discard pile. */
export function spend(s: State, p: ServerPlayer, card: ActionCard): void {
  p.hand = p.hand.filter((c) => c.id !== card.id);
  s.discard.push(card);
}
