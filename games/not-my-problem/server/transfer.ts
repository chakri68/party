import { bumpStat, type GameContext, type GameError } from "@games/game-core";
import { MAX_TRANSFERS, type ActionCard, type ActionKind } from "../shared/types.ts";
import { openProblem } from "./problem.ts";
import { alive, emit, playerById, setStep, type Out, type ServerMove, type ServerPlayer, type State } from "./state.ts";

// One transfer attempt: a Blame Game, the target window (Accept, Not Me or
// Revenge), then the HR window. The played cards wait in `s.moves` until
// `resolveTransfer` puts them on the discard pile.

const err = (code: string, message: string): GameError => ({ code, message });
const wrongTime = () => err("wrong-time", "You can't play that card now.");
const wrongCard = (kind: ActionKind, card: ActionCard) =>
  card.kind === kind ? null : err("wrong-card", "That is the wrong card.");

const reactionMs = (s: State) => s.settings.reactionSeconds * 1000;

/** Takes the card out of the hand. It stays in the move until the attempt closes. */
function take(p: ServerPlayer, card: ActionCard): void {
  p.hand = p.hand.filter((c) => c.id !== card.id);
}

/** Living players other than `exclude`, minus the one an Angry Client last moved away from. */
function targetsExcept(s: State, exclude: string[]): string[] {
  const problem = s.problem!;
  const blocked = problem.card.kind === "angry-client" ? problem.lastMovedFromId : null;
  return s.players.filter((p) => alive(p) && !exclude.includes(p.id) && p.id !== blocked).map((p) => p.id);
}

/** Who the owner may pass the Problem to right now. Empty when they can't. */
export function blameTargets(s: State): string[] {
  if (s.step !== "problem" || !s.problem || s.problem.attempts >= MAX_TRANSFERS) return [];
  return targetsExcept(s, [s.problem.ownerId]);
}

/** Who the target may send the Problem on to right now. Empty when they can't. */
export function revengeTargets(s: State): string[] {
  const blame = s.moves[0];
  if (s.step !== "target" || !s.problem || blame?.kind !== "blame" || s.problem.attempts >= MAX_TRANSFERS) return [];
  return targetsExcept(s, [blame.targetId, blame.actorId]);
}

/** Who may play HR Complaint on the last move: alive, here, and not the one who made it. */
export function hrEligible(s: State): string[] {
  const last = s.moves.at(-1);
  if (!last) return [];
  return s.players.filter((p) => alive(p) && !p.away && p.id !== last.actorId).map((p) => p.id);
}

export function blame(s: State, out: Out, actor: ServerPlayer, card: ActionCard, targetId: string, ctx: GameContext): GameError | null {
  if (s.step !== "problem" || !s.problem) return wrongTime();
  if (s.problem.ownerId !== actor.id) return err("not-your-problem", "This is not your Problem.");
  const bad = wrongCard("blame-game", card);
  if (bad) return bad;
  if (s.problem.attempts >= MAX_TRANSFERS) return err("no-transfers", "This Problem can't be passed again.");
  if (!blameTargets(s).includes(targetId)) return err("bad-target", "You can't pick that player.");

  take(actor, card);
  s.problem.attempts++;
  s.moves.push({ kind: "blame", actorId: actor.id, card, targetId });
  emit(s, out, { type: "played", playerId: actor.id, kind: card.kind, targetId });
  setStep(s, out, "target", reactionMs(s), ctx.now);
  const target = playerById(s, targetId)!;
  if (target.away) return respondToTransfer(s, out, target, { kind: "accept" }, ctx);
  return null;
}

export type TransferResponse =
  | { kind: "accept" }
  | { kind: "not-me"; card: ActionCard }
  | { kind: "revenge"; card: ActionCard; targetId: string };

/** The target's answer. Any answer (or the timer, as Accept) opens the HR window. */
export function respondToTransfer(s: State, out: Out, actor: ServerPlayer, r: TransferResponse, ctx: GameContext): GameError | null {
  const first = s.moves[0];
  if (s.step !== "target" || !s.problem || first?.kind !== "blame") return wrongTime();
  if (first.targetId !== actor.id) return err("not-target", "This was not passed to you.");

  if (r.kind === "not-me") {
    const bad = wrongCard("not-me", r.card);
    if (bad) return bad;
    take(actor, r.card);
    s.moves.push({ kind: "not-me", actorId: actor.id, card: r.card });
    emit(s, out, { type: "played", playerId: actor.id, kind: r.card.kind });
  } else if (r.kind === "revenge") {
    const bad = wrongCard("revenge", r.card);
    if (bad) return bad;
    if (s.problem.attempts >= MAX_TRANSFERS) return err("no-transfers", "This Problem can't be passed again.");
    if (!revengeTargets(s).includes(r.targetId)) return err("bad-target", "You can't pick that player.");
    take(actor, r.card);
    s.problem.attempts++;
    s.moves.push({ kind: "revenge", actorId: actor.id, card: r.card, targetId: r.targetId });
    emit(s, out, { type: "played", playerId: actor.id, kind: r.card.kind, targetId: r.targetId });
  }
  openHr(s, out, ctx);
  return null;
}

/** Opens the HR window, or resolves at once when nobody may play HR Complaint. */
function openHr(s: State, out: Out, ctx: GameContext): void {
  if (!hrEligible(s).length) return resolveTransfer(s, out, false, ctx);
  setStep(s, out, "hr", reactionMs(s), ctx.now);
}

/**
 * The first HR Complaint wins: it cancels the last move and closes the window.
 * A later one carries the old token and never gets here.
 */
export function hrComplaint(s: State, out: Out, actor: ServerPlayer, card: ActionCard, ctx: GameContext): GameError | null {
  if (s.step !== "hr") return wrongTime();
  const bad = wrongCard("hr-complaint", card);
  if (bad) return bad;
  if (!hrEligible(s).includes(actor.id)) return err("not-eligible", "You can't play HR Complaint now.");
  if (s.passed.includes(actor.id)) return err("passed", "You passed.");
  take(actor, card);
  s.discard.push(card);
  emit(s, out, { type: "played", playerId: actor.id, kind: card.kind });
  resolveTransfer(s, out, true, ctx);
  return null;
}

/** One eligible player lets the move stand. When all have, the window closes early. */
export function hrPass(s: State, out: Out, playerId: string, ctx: GameContext): GameError | null {
  if (s.step !== "hr") return err("wrong-time", "You can't pass now.");
  const eligible = hrEligible(s);
  if (!eligible.includes(playerId)) return err("not-eligible", "You can't pass now.");
  if (s.passed.includes(playerId)) return err("passed", "You passed.");
  s.passed.push(playerId);
  emit(s, out, { type: "passed", playerId });
  if (eligible.every((id) => s.passed.includes(id))) resolveTransfer(s, out, false, ctx);
  return null;
}

/** Where the Problem ends up, and whose move put it there (null: it stays with the source). */
function destination(moves: ServerMove[], canceled: boolean): { toId: string; mover: string | null } {
  const blame = moves[0]!;
  const standing = canceled ? moves.slice(0, -1) : moves;
  const last = standing.at(-1);
  if (!last || last.kind === "not-me") return { toId: blame.actorId, mover: null };
  return { toId: last.targetId, mover: last.actorId };
}

/** Closes the attempt: the cards go to discard, the Problem moves (or not), and its holder gets a fresh timer. */
export function resolveTransfer(s: State, out: Out, canceled: boolean, ctx: GameContext): void {
  const problem = s.problem!;
  // Transfer, reaction, HR: never deeper than that.
  if (!s.moves.length || s.moves.length > 2 || s.moves[0]!.kind !== "blame") {
    throw new Error(`not-my-problem: bad transfer stack ${s.moves.map((m) => m.kind).join(",")}`);
  }
  s.discard.push(...s.moves.map((m) => m.card));
  const { toId, mover } = destination(s.moves, canceled);
  if (mover && toId !== problem.ownerId) {
    problem.lastMovedFromId = mover;
    bumpStat((s.stats ??= {}), mover, "problemsPassed");
    emit(s, out, { type: "moved", problemKind: problem.card.kind, fromId: mover, toId });
  }
  openProblem(s, out, toId, ctx.now);
}
