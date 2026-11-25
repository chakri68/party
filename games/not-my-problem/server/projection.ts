import type { GameOutcome } from "@games/game-core";
import {
  MAX_TRANSFERS,
  type ActionKind,
  type NmpPrivateState,
  type NmpPublicState,
  type PublicMove,
} from "../shared/types.ts";
import { alive, playerById, turnPlayerOf, type ServerMove, type State } from "./state.ts";
import { blameTargets, hrEligible, revengeTargets } from "./transfer.ts";
import { playableProactive, survivorsRanked } from "./turn.ts";

const publicMove = (m: ServerMove): PublicMove =>
  m.kind === "not-me" ? { kind: m.kind, actorId: m.actorId } : { kind: m.kind, actorId: m.actorId, targetId: m.targetId };

export function getPublicState(s: State): NmpPublicState {
  const live = s.step !== "finished";
  const problem = live ? s.problem : null;
  return {
    players: s.players.map((p) => ({
      id: p.id,
      warnings: p.warnings,
      handCount: p.hand.length,
      shield: p.shield !== null,
      overtime: p.overtime,
      fired: p.fired,
      firedOrder: p.firedOrder,
      removed: p.removed,
      away: p.away,
      passed: s.passed.includes(p.id),
    })),
    step: s.step,
    token: s.token,
    round: s.round,
    turnPlayerId: live ? turnPlayerOf(s).id : null,
    actionsLeft: s.actionsLeft,
    drawCount: s.drawPile.length,
    discardCount: s.discard.length,
    problem: problem && {
      cardId: problem.card.id,
      kind: problem.card.kind,
      ownerId: problem.ownerId,
      lastMovedFromId: problem.lastMovedFromId,
      attemptsLeft: MAX_TRANSFERS - problem.attempts,
    },
    moves: live ? s.moves.map(publicMove) : [],
    report: live && s.report ? { ownerId: s.report.ownerId } : null,
    deadline: s.deadline,
    windowMs: s.windowMs,
    lastEvent: s.lastEvent,
    winnerIds: s.winnerIds,
  };
}

export function getPrivateState(s: State, playerId: string): NmpPrivateState {
  const p = playerById(s, playerId);
  const none: NmpPrivateState = {
    hand: [], token: s.token, playable: [],
    canDraw: false, canAccept: false, canPass: false, canChallenge: false, myReportCard: null,
  };
  if (!p || !alive(p) || s.step === "finished") return { ...none, hand: p ? [...p.hand] : [] };
  const myTurn = s.step === "action" && turnPlayerOf(s).id === playerId;
  const myProblem = s.step === "problem" && s.problem?.ownerId === playerId;
  const myTarget = s.step === "target" && getAwaitedPlayerIds(s).includes(playerId);
  const canHr = s.step === "hr" && hrEligible(s).includes(playerId) && !s.passed.includes(playerId);
  /** Cards of a kind, with their targets (null: none needed). An empty target list means not playable. */
  const cards = (on: boolean, kind: ActionKind, targets: string[] | null = null) =>
    on && (targets === null || targets.length) ? p.hand.filter((c) => c.kind === kind).map((c) => ({ cardId: c.id, targets })) : [];
  return {
    ...none,
    hand: [...p.hand],
    playable: [
      ...playableProactive(s, p),
      ...cards(myProblem, "quick-fix"),
      ...cards(myProblem, "blame-game", blameTargets(s)),
      ...cards(myTarget, "not-me"),
      ...cards(myTarget, "revenge", revengeTargets(s)),
      ...cards(canHr, "hr-complaint"),
    ],
    canDraw: myTurn,
    canAccept: myProblem || myTarget,
    canPass: canHr,
    myReportCard: s.report?.ownerId === playerId ? s.report.faceDown : null,
  };
}

/** Whose move the game waits on. In HR and challenge windows it's the clock. */
export function getAwaitedPlayerIds(s: State): string[] {
  switch (s.step) {
    case "action":
      return [turnPlayerOf(s).id];
    case "problem":
      return s.problem ? [s.problem.ownerId] : [];
    case "target": {
      const last = s.moves.at(-1);
      return last && last.kind !== "not-me" ? [last.targetId] : [];
    }
    default:
      return [];
  }
}

/** Up to 8 seats, so no 11th to worry about. */
const ordinal = (n: number) => ["1st", "2nd", "3rd"][n - 1] ?? `${n}th`;

/** Survivors by rank, then fired players (last fired first), then leavers. */
export function getResult(s: State): GameOutcome | null {
  if (s.step !== "finished") return null;
  const fired = s.players.filter((p) => p.fired && !p.removed).sort((a, b) => b.firedOrder! - a.firedOrder!);
  const removed = s.players.filter((p) => p.removed);
  return {
    winnerIds: s.winnerIds,
    standings: [
      ...survivorsRanked(s).map((p) => ({
        playerId: p.id,
        value: p.warnings,
        label: `${p.warnings} ${p.warnings === 1 ? "warning" : "warnings"}`,
      })),
      ...fired.map((p) => ({ playerId: p.id, value: p.warnings, label: `Fired ${ordinal(p.firedOrder!)}` })),
      ...removed.map((p) => ({ playerId: p.id, value: p.warnings, label: "left" })),
    ],
  };
}
