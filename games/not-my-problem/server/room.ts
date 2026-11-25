import type { GameContext } from "@games/game-core";
import { dropProblem, problemTimeout } from "./problem.ts";
import { closeReport, settleReport } from "./report.ts";
import { alive, emit, playerById, turnPlayerOf, type Out, type State } from "./state.ts";
import { resolveTransfer, respondToTransfer, settleHr } from "./transfer.ts";
import { afterProblem, beginDraw, checkEnd, endTurn } from "./turn.ts";

// What the room does to the game: timers, skips, players going away or leaving.

/** The step's default when its time is up (or the host skips): draw, the Problem timeout, Accept, close the window. */
export function timeoutStep(s: State, out: Out, ctx: GameContext): void {
  switch (s.step) {
    case "action":
      return beginDraw(s, out, ctx);
    case "problem":
      return problemTimeout(s, out, ctx);
    case "target":
      return acceptForTarget(s, out, ctx);
    case "hr":
      return resolveTransfer(s, out, false, ctx);
    case "challenge":
      return closeReport(s, out, ctx);
    case "finished":
      return;
  }
}

/** The Blame Game target answers Accept. */
function acceptForTarget(s: State, out: Out, ctx: GameContext): void {
  const blame = s.moves[0];
  if (blame?.kind !== "blame") throw new Error(`not-my-problem: bad transfer stack ${s.moves.map((m) => m.kind).join(",")}`);
  const error = respondToTransfer(s, out, playerById(s, blame.targetId)!, { kind: "accept" }, ctx);
  if (error) throw new Error(`not-my-problem: target Accept refused: ${error.code}`);
}

const isTarget = (s: State, playerId: string) => s.step === "target" && s.moves[0]?.kind === "blame" && s.moves[0].targetId === playerId;

/**
 * They stay seated. A target keeps their window: its timer answers Accept, and
 * they can still answer if they come back in time. An HR or challenge window
 * may now have nobody left to wait for.
 */
export function disconnect(s: State, out: Out, playerId: string, ctx: GameContext): void {
  playerById(s, playerId)!.away = true;
  settleHr(s, out, ctx);
  settleReport(s, out, ctx);
}

/**
 * Their hand and shield go to the discard pile and their Overtime ends. A
 * Problem they own goes with them; a pass to them fizzles and the Problem
 * stays with its owner. If it was their turn, the turn ends (after any
 * Problem still open). Then the end checks.
 */
export function remove(s: State, out: Out, playerId: string, ctx: GameContext): void {
  const p = playerById(s, playerId)!;
  const wasIn = alive(p);
  p.removed = true;
  s.discard.push(...p.hand, ...(p.shield ? [p.shield] : []));
  p.hand = [];
  p.shield = null;
  p.overtime = false;
  emit(s, out, { type: "removed", playerId });
  // A fired player holds nothing and nothing waits on them.
  if (!wasIn) return;
  if (turnPlayerOf(s).id === playerId) s.turnOver = true;
  if (checkEnd(s, out)) return;

  if (s.problem?.ownerId === playerId) {
    dropProblem(s);
    return afterProblem(s, out, ctx);
  }
  switch (s.step) {
    case "action":
      if (s.turnOver) endTurn(s, out, ctx);
      return;
    case "target":
      // The destination is gone, so resolving fizzles the move.
      if (isTarget(s, playerId)) resolveTransfer(s, out, false, ctx);
      return;
    case "hr":
      return settleHr(s, out, ctx);
    case "challenge":
      return settleReport(s, out, ctx);
    default:
      return;
  }
}
