import type { GameContext } from "@games/game-core";
import { penaltyOf } from "../shared/rules.ts";
import { MAX_WARNINGS, PROBLEM_MS } from "../shared/types.ts";
import { alive, emit, playerById, setStep, spend, turnPlayerOf, type Out, type State } from "./state.ts";
import { afterProblem, checkEnd } from "./turn.ts";

/** The active Problem now waits on `ownerId`: fix, pass, bluff or accept. */
export function openProblem(s: State, out: Out, ownerId: string, now: number): void {
  s.problem!.ownerId = ownerId;
  s.moves = [];
  setStep(s, out, "problem", PROBLEM_MS, now);
}

/** The Problem is gone for good. The caller has already spent whatever fixed it. */
function resolveProblem(s: State): void {
  if (!s.problem) return;
  s.resolvedProblems.push(s.problem.card);
  s.problem = null;
  s.moves = [];
}

export function fixProblem(s: State, out: Out, by: "quick-fix" | "report", ctx: GameContext): void {
  const ownerId = s.problem!.ownerId;
  resolveProblem(s);
  emit(s, out, { type: "fixed", playerId: ownerId, by });
  afterProblem(s, out, ctx);
}

/**
 * A shield takes exactly one; the rest count. At three the player is fired:
 * hand and shield are discarded, and a Problem they hold goes with them.
 *
 * Contract: this may resolve the player's Problem (when they are fired) and
 * may finish the game, but it never moves play on. The caller must check
 * `s.step === "finished"` and whether `s.problem` is gone, then continue
 * (usually `afterProblem`).
 */
export function giveWarnings(s: State, out: Out, playerId: string, amount: number): void {
  const p = playerById(s, playerId)!;
  if (!alive(p) || amount <= 0) return;
  let shielded = false;
  if (p.shield) {
    s.discard.push(p.shield);
    p.shield = null;
    amount--;
    shielded = true;
  }
  p.warnings = Math.min(MAX_WARNINGS, p.warnings + amount);
  emit(s, out, { type: "warned", playerId, amount, shielded });
  if (p.warnings >= MAX_WARNINGS) {
    s.discard.push(...p.hand);
    p.hand = [];
    p.overtime = false;
    p.fired = true;
    p.firedOrder = ++s.firedCount;
    if (s.problem?.ownerId === playerId) resolveProblem(s);
    if (turnPlayerOf(s).id === playerId) s.turnOver = true;
    emit(s, out, { type: "fired", playerId, order: p.firedOrder });
  }
  checkEnd(s, out);
}

/**
 * The owner takes the warnings and the Problem is done, then play moves on.
 * `amount` is the printed penalty unless given (a caught Fake Report gives one more).
 */
export function acceptProblem(s: State, out: Out, ctx: GameContext, amount = penaltyOf(s.problem!.card.kind)): void {
  const { ownerId } = s.problem!;
  resolveProblem(s);
  giveWarnings(s, out, ownerId, amount);
  if (s.step !== "finished") afterProblem(s, out, ctx);
}

/** Nobody answered in time: a Quick Fix if the owner holds one, otherwise the warnings. */
export function problemTimeout(s: State, out: Out, ctx: GameContext): void {
  const owner = playerById(s, s.problem!.ownerId)!;
  const fix = owner.hand.find((c) => c.kind === "quick-fix");
  if (!fix) return acceptProblem(s, out, ctx);
  spend(s, owner, fix);
  fixProblem(s, out, "quick-fix", ctx);
}
