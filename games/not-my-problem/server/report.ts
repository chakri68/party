import { bumpStat, type GameContext, type GameError } from "@games/game-core";
import { penaltyOf } from "../shared/rules.ts";
import type { ActionCard } from "../shared/types.ts";
import { acceptProblem, fixProblem, giveWarnings } from "./problem.ts";
import { alive, emit, finished, setStep, type Out, type ServerPlayer, type State } from "./state.ts";

// Fake Report: the owner plays it with one more card face down and claims a
// Quick Fix. One challenge window; the first challenge wins. Both cards wait
// in `s.report` until the window closes.

const err = (code: string, message: string): GameError => ({ code, message });

/** Who may challenge the report: alive, here, and not its owner. */
export function challengeEligible(s: State): string[] {
  const report = s.report;
  if (!report) return [];
  return s.players.filter((p) => alive(p) && !p.away && p.id !== report.ownerId).map((p) => p.id);
}

export function fakeReport(
  s: State,
  out: Out,
  owner: ServerPlayer,
  reportCard: ActionCard,
  faceDown: ActionCard,
  ctx: GameContext,
): GameError | null {
  if (s.step !== "problem" || !s.problem) return err("wrong-time", "You can't play that card now.");
  if (s.problem.ownerId !== owner.id) return err("not-your-problem", "This is not your Problem.");
  if (reportCard.kind !== "fake-report") return err("wrong-card", "That is the wrong card.");
  if (reportCard.id === faceDown.id) return err("bad-card", "Pick a second card to play face down.");

  owner.hand = owner.hand.filter((c) => c.id !== reportCard.id && c.id !== faceDown.id);
  s.report = { ownerId: owner.id, reportCard, faceDown };
  emit(s, out, { type: "report", playerId: owner.id });
  if (!challengeEligible(s).length) {
    closeReport(s, out, ctx);
    return null;
  }
  setStep(s, out, "challenge", s.settings.reactionSeconds * 1000, ctx.now);
  return null;
}

/** Nobody challenged: the Problem is fixed and the face-down card is never shown. */
export function closeReport(s: State, out: Out, ctx: GameContext): void {
  const { ownerId, reportCard, faceDown } = s.report!;
  s.report = null;
  s.discard.push(reportCard);
  s.hiddenDiscard.push(faceDown);
  if (faceDown.kind !== "quick-fix") {
    const stats = (s.stats ??= {});
    bumpStat(stats, ownerId, "liesTold");
    bumpStat(stats, ownerId, "liesUncaught");
  }
  fixProblem(s, out, "report", ctx);
}

/**
 * The first challenge wins and closes the window. A later one carries the old
 * token and never gets here.
 */
export function challenge(s: State, out: Out, challenger: ServerPlayer, ctx: GameContext): GameError | null {
  if (s.step !== "challenge" || !s.report) return err("wrong-time", "You can't challenge now.");
  if (!challengeEligible(s).includes(challenger.id)) return err("not-eligible", "You can't challenge now.");
  if (s.passed.includes(challenger.id)) return err("passed", "You passed.");

  const { ownerId, reportCard, faceDown } = s.report;
  const lied = faceDown.kind !== "quick-fix";
  s.report = null;
  s.discard.push(reportCard, faceDown);
  emit(s, out, { type: "challenged", challengerId: challenger.id, ownerId, card: faceDown, lied });
  const stats = (s.stats ??= {});
  if (lied) {
    bumpStat(stats, ownerId, "liesTold");
    bumpStat(stats, challenger.id, "rightCalls");
    acceptProblem(s, out, ctx, penaltyOf(s.problem!.card.kind) + 1);
    return null;
  }
  bumpStat(stats, challenger.id, "wrongCalls");
  giveWarnings(s, out, challenger.id, 1);
  if (finished(s)) return null;
  // The challenger is never the owner, so even if fired the Problem is still here to fix.
  fixProblem(s, out, "report", ctx);
  return null;
}

/** One eligible player lets the report stand. When all have, the window closes early. */
export function reportPass(s: State, out: Out, playerId: string, ctx: GameContext): GameError | null {
  if (s.step !== "challenge" || !s.report) return err("wrong-time", "You can't pass now.");
  const eligible = challengeEligible(s);
  if (!eligible.includes(playerId)) return err("not-eligible", "You can't pass now.");
  if (s.passed.includes(playerId)) return err("passed", "You passed.");
  s.passed.push(playerId);
  emit(s, out, { type: "passed", playerId });
  settleReport(s, out, ctx);
  return null;
}

/** Closes the challenge window early once every eligible player has passed (or gone). */
export function settleReport(s: State, out: Out, ctx: GameContext): void {
  if (s.step !== "challenge" || !s.report) return;
  if (challengeEligible(s).every((id) => s.passed.includes(id))) closeReport(s, out, ctx);
}
