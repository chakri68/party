import type { GameContext, GameError } from "@games/game-core";
import { ACTION_BUDGET, PROACTIVE, TURN_MS, isProblem, type ActionCard, type ActionKind } from "../shared/types.ts";
import { openProblem } from "./problem.ts";
import { alive, emit, setStep, spend, tell, turnPlayerOf, type Out, type ServerPlayer, type State } from "./state.ts";

const err = (code: string, message: string): GameError => ({ code, message });

export function startTurn(s: State, out: Out, now: number): void {
  s.actionsLeft = ACTION_BUDGET;
  s.drawsLeft = 0;
  s.turnOver = false;
  s.moves = [];
  const p = turnPlayerOf(s);
  setStep(s, out, "action", TURN_MS, now);
  emit(s, out, { type: "turn", playerId: p.id, round: s.round });
}

/**
 * Whether `p` may play a proactive card of this kind right now (budget and
 * turn aside), and whom it may target: null for no target.
 */
export function proactiveTargets(s: State, p: ServerPlayer, kind: ActionKind): GameError | { targets: string[] | null } {
  const others = s.players.filter((o) => alive(o) && o.id !== p.id);
  switch (kind) {
    case "intern":
      return p.shield ? err("has-shield", "You already have an Intern.") : { targets: null };
    case "promotion":
      return p.warnings > 0 ? { targets: null } : err("no-warnings", "You have no warnings to remove.");
    case "overtime":
      return { targets: others.filter((o) => !o.overtime).map((o) => o.id) };
    case "spy":
      return { targets: others.filter((o) => o.hand.length > 0).map((o) => o.id) };
    default:
      return err("wrong-time", "You can't play that card now.");
  }
}

/** Card ids `p` may play in their action step now, with targets. */
export function playableProactive(s: State, p: ServerPlayer): { cardId: string; targets: string[] | null }[] {
  if (s.step !== "action" || turnPlayerOf(s).id !== p.id || s.actionsLeft <= 0) return [];
  return p.hand.flatMap((card) => {
    if (!PROACTIVE.includes(card.kind)) return [];
    const r = proactiveTargets(s, p, card.kind);
    if ("code" in r || (r.targets && !r.targets.length)) return [];
    return [{ cardId: card.id, targets: r.targets }];
  });
}

export function playProactive(
  s: State,
  out: Out,
  p: ServerPlayer,
  card: ActionCard,
  targetId: string | undefined,
  ctx: GameContext,
): GameError | null {
  if (s.step !== "action") return err("wrong-time", "You can't play that card now.");
  if (turnPlayerOf(s).id !== p.id) return err("not-your-turn", "It's not your turn.");
  if (s.actionsLeft <= 0) return err("no-actions", "You played two cards already. Draw now.");
  const r = proactiveTargets(s, p, card.kind);
  if ("code" in r) return r;
  if (r.targets && (!targetId || !r.targets.includes(targetId))) return err("bad-target", "You can't pick that player.");
  const target = r.targets ? s.players.find((o) => o.id === targetId)! : null;

  s.actionsLeft--;
  if (card.kind === "intern") {
    p.hand = p.hand.filter((c) => c.id !== card.id);
    p.shield = card;
  } else spend(s, p, card);
  emit(s, out, { type: "played", playerId: p.id, kind: card.kind, ...(target && { targetId: target.id }) });

  if (card.kind === "promotion") p.warnings--;
  else if (card.kind === "overtime") target!.overtime = true;
  else if (card.kind === "spy") {
    const taken = target!.hand[ctx.randomInt(target!.hand.length)]!;
    target!.hand = target!.hand.filter((c) => c.id !== taken.id);
    p.hand.push(taken);
    emit(s, out, { type: "spied", fromId: target!.id, toId: p.id });
    for (const id of [target!.id, p.id]) tell(out, id, { type: "spied", fromId: target!.id, toId: p.id, card: taken });
  }
  return null;
}

/** Tap Draw (or the turn timer ran out): one card, or two under Overtime. */
export function beginDraw(s: State, out: Out, ctx: GameContext): void {
  const p = turnPlayerOf(s);
  s.drawsLeft = p.overtime ? 2 : 1;
  p.overtime = false;
  drawNext(s, out, ctx);
}

/** One draw, then continue/finish. */
export function drawNext(s: State, out: Out, ctx: GameContext): void {
  const p = turnPlayerOf(s);
  const card = s.drawPile.shift();
  if (!card) {
    checkEnd(s, out);
    return;
  }
  s.drawsLeft--;
  if (isProblem(card)) {
    emit(s, out, { type: "drew", playerId: p.id, problem: card.kind });
    s.problem = { card, ownerId: p.id, lastMovedFromId: null, attempts: 0 };
    openProblem(s, out, p.id, ctx.now);
    return;
  }
  p.hand.push(card);
  emit(s, out, { type: "drew", playerId: p.id, problem: null });
  tell(out, p.id, { type: "drew-card", card });
  afterProblem(s, out, ctx);
}

/** After a draw or a finished Problem: the next Overtime draw, or the end of the turn. */
export function afterProblem(s: State, out: Out, ctx: GameContext): void {
  if (checkEnd(s, out)) return;
  if (!s.turnOver && s.drawsLeft > 0) drawNext(s, out, ctx);
  else endTurn(s, out, ctx);
}

/** The turn goes to the next surviving seat. Passing the first seat starts a new round. */
export function endTurn(s: State, out: Out, ctx: GameContext): void {
  if (checkEnd(s, out)) return;
  const n = s.players.length;
  for (let k = 1; k <= n; k++) {
    const idx = (s.turnIndex + k) % n;
    if (idx === s.firstSeat) s.round++;
    if (alive(s.players[idx]!)) {
      s.turnIndex = idx;
      break;
    }
  }
  startTurn(s, out, ctx.now);
}

/** Survivors: fewest warnings first, then most cards. Stable, so ties keep seat order. */
export function survivorsRanked(s: State): ServerPlayer[] {
  return s.players.filter(alive).sort((a, b) => a.warnings - b.warnings || b.hand.length - a.hand.length);
}

/** Finishes and returns true if over: one survivor left, or no cards to draw and no Problem. */
export function checkEnd(s: State, out: Out): boolean {
  if (s.step === "finished") return true;
  const ranked = survivorsRanked(s);
  let winners: ServerPlayer[];
  if (ranked.length <= 1) winners = ranked;
  else if (!s.drawPile.length && !s.problem) {
    const best = ranked[0]!;
    winners = ranked.filter((p) => p.warnings === best.warnings && p.hand.length === best.hand.length);
  } else return false;
  s.winnerIds = winners.map((p) => p.id);
  setStep(s, out, "finished", null, 0);
  emit(s, out, { type: "game-over", winnerIds: s.winnerIds });
  return true;
}
