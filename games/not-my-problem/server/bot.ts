import type { BotContext, GameBot } from "@games/game-core";
import type { ActionCard, ActionKind, NmpAction, NmpPrivateState, NmpPublicPlayer, NmpPublicState } from "../shared/types.ts";

/** Percent of Problems the bot bluffs with a Fake Report when it can't fix or pass them. */
const BLUFF = 60;
/** Percent of HR windows where the bot wants to cancel the move. */
const HR_WANT = 35;
/** Percent of Fake Reports the bot challenges. */
const CHALLENGE = 30;
/** Proactive cards in the order the bot plays them. */
const PROACTIVE_ORDER: readonly ActionKind[] = ["intern", "promotion", "spy", "overtime"];
/** Least useful first: the card the bot gives up as a Fake Report's face-down card. */
const KEEP_ORDER: readonly ActionKind[] = [
  "overtime", "spy", "promotion", "intern", "fake-report", "hr-complaint", "revenge", "not-me", "blame-game", "quick-fix",
];

type Playable = NmpPrivateState["playable"][number];

/** The first of `ids` with the highest score. */
function best(ids: readonly string[], score: (id: string) => number): string {
  return ids.reduce((top, id) => (score(id) > score(top) ? id : top));
}

/**
 * Not My Problem!: on its turn, play Intern, Promotion, Spy and Overtime when
 * it can (two at most), then draw. With a Problem: pass it to whoever has the
 * most warnings, else fix it, else sometimes bluff, else take it. Passed a
 * Problem: Not Me, else Revenge, else take it. In HR and challenge windows,
 * act now and then, keyed on the window so asking again gives the same answer.
 */
export const notMyProblemBot: GameBot<NmpPublicState, NmpPrivateState, NmpAction> = {
  decide({ playerId, public: pub, private: priv }, ctx) {
    const token = priv.token;
    const kindOf = (cardId: string) => priv.hand.find((c) => c.id === cardId)?.kind;
    const find = (kind: ActionKind): Playable | undefined => priv.playable.find((p) => kindOf(p.cardId) === kind);
    const seat = (id: string): NmpPublicPlayer | undefined => pub.players.find((p) => p.id === id);
    const warnings = (id: string) => seat(id)?.warnings ?? 0;
    const cards = (id: string) => seat(id)?.handCount ?? 0;

    switch (pub.step) {
      case "action": {
        if (!priv.canDraw) return null;
        // `playable` is empty once the two cards are used, so this stops at two.
        for (const kind of PROACTIVE_ORDER) {
          const p = find(kind);
          if (!p) continue;
          if (!p.targets) return { type: "play", token, cardId: p.cardId };
          // Spy: take from the biggest hand. Overtime: the one with the fewest warnings, then most cards.
          const targetId =
            kind === "spy" ? best(p.targets, cards) : best(p.targets, (id) => -warnings(id) * 100 + cards(id));
          return { type: "play", token, cardId: p.cardId, targetId };
        }
        return { type: "draw", token };
      }
      case "problem":
        if (pub.problem?.ownerId !== playerId || !priv.canAccept) return null;
        return decideProblem(priv, ctx, find, warnings);
      case "target": {
        if (!priv.canAccept) return null;
        const notMe = find("not-me");
        if (notMe) return { type: "not-me", token, cardId: notMe.cardId };
        const revenge = find("revenge");
        if (revenge?.targets) return { type: "revenge", token, cardId: revenge.cardId, targetId: best(revenge.targets, warnings) };
        return { type: "accept", token };
      }
      case "hr": {
        if (!priv.canPass || !pub.problem) return null;
        const hr = find("hr-complaint");
        const want = ctx.chance(`hr:${pub.problem.cardId}:${pub.token}`) < HR_WANT;
        return want && hr ? { type: "hr", token, cardId: hr.cardId } : { type: "pass", token };
      }
      case "challenge": {
        if (!priv.canChallenge || !pub.problem) return null;
        const go = ctx.chance(`ch:${pub.problem.cardId}:${pub.token}`) < CHALLENGE;
        return go ? { type: "challenge", token } : { type: "pass", token };
      }
      default:
        return null;
    }
  },
};

function decideProblem(
  priv: NmpPrivateState,
  ctx: BotContext,
  find: (kind: ActionKind) => Playable | undefined,
  warnings: (id: string) => number,
): NmpAction {
  const token = priv.token;
  // Listed only while attempts are left and someone can take it.
  const blame = find("blame-game");
  if (blame?.targets) return { type: "blame", token, cardId: blame.cardId, targetId: best(blame.targets, warnings) };
  const fix = find("quick-fix");
  if (fix) return { type: "fix", token, cardId: fix.cardId };
  const report = find("fake-report");
  if (report && ctx.randomInt(100) < BLUFF) {
    const others = priv.hand.filter((c) => c.id !== report.cardId);
    const faceDown = others.reduce((a: ActionCard, b) => (KEEP_ORDER.indexOf(b.kind) < KEEP_ORDER.indexOf(a.kind) ? b : a));
    return { type: "fake-report", token, cardId: report.cardId, faceDownId: faceDown.id };
  }
  return { type: "accept", token };
}
