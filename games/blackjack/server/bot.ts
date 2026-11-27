import type { GameBot } from "@games/game-core";
import { cardValue, handTotal, isPair } from "../shared/rules.ts";
import {
  MIN_BET,
  type BlackjackAction,
  type BlackjackPrivateState,
  type BlackjackPublicState,
  type Card,
  type LegalMoves,
  type MoveKind,
} from "../shared/types.ts";

/**
 * Basic strategy for this table: 6 decks, the dealer stands on every 17,
 * double on any first two cards (after a split too), split once, no
 * surrender. One letter per dealer card, 2 to 10 then Ace.
 *
 * H hit, S stand, D double (else hit), d double (else stand), P split.
 */
const HARD: Record<number, string> = {
  9: "HDDDDHHHHH",
  10: "DDDDDDDDHH",
  11: "DDDDDDDDDH",
  12: "HHSSSHHHHH",
  13: "SSSSSHHHHH",
  14: "SSSSSHHHHH",
  15: "SSSSSHHHHH",
  16: "SSSSSHHHHH",
};
const SOFT: Record<number, string> = {
  13: "HHHDDHHHHH",
  14: "HHHDDHHHHH",
  15: "HHDDDHHHHH",
  16: "HHDDDHHHHH",
  17: "HDDDDHHHHH",
  18: "SddddSSHHH",
};
/** By card value (Ace 11). A dash plays the pair as a total. */
const PAIRS: Record<number, string> = {
  11: "PPPPPPPPPP",
  10: "----------",
  9: "PPPPP-PP--",
  8: "PPPPPPPPPP",
  7: "PPPPPP----",
  6: "PPPPP-----",
  5: "----------",
  4: "---PP-----",
  3: "PPPPPP----",
  2: "PPPPPP----",
};

type Play = "H" | "S" | "D" | "d" | "P";

/** The table's advice for these cards against the dealer's face-up card. */
export function basicStrategy(cards: Pick<Card, "rank">[], dealerUp: Pick<Card, "rank">, canSplit: boolean): Play {
  const up = dealerUp.rank === 1 ? 11 : cardValue(dealerUp);
  const col = up - 2;
  if (canSplit && isPair(cards)) {
    const v = cards[0]!.rank === 1 ? 11 : cardValue(cards[0]!);
    const pair = PAIRS[v]![col]!;
    if (pair === "P") return "P";
  }
  const { total, soft } = handTotal(cards);
  if (total >= 21) return "S";
  const row = (soft ? SOFT : HARD)[total];
  if (!row) return total >= (soft ? 19 : 17) ? "S" : "H";
  return row[col] as Play;
}

/** A sane bet: 3 to 10 in 100 of the stack, in tens, never under the smallest bet. */
export function botBet(stack: number, min: number, roll: number): number {
  const amount = Math.floor((stack * (3 + roll)) / 100 / 10) * 10;
  return Math.min(stack, Math.max(min, amount, MIN_BET));
}

const MOVE: Record<Play, (m: LegalMoves) => MoveKind> = {
  P: () => "split",
  D: (m) => (m.double ? "double" : "hit"),
  d: (m) => (m.double ? "double" : "stand"),
  H: () => "hit",
  S: () => "stand",
};

export const blackjackBot: GameBot<BlackjackPublicState, BlackjackPrivateState, BlackjackAction> = {
  decide(view, ctx) {
    const priv = view.private;
    if (priv.canRebuy) return { type: "rebuy" };
    if (priv.bet) return { type: "bet", amount: botBet(priv.bet.max, priv.bet.min, ctx.randomInt(8)) };
    // Skipped twice by the host: come back for the next round.
    if (priv.canBack) return { type: "back" };
    const moves = priv.moves;
    if (!moves) return null;
    const me = view.public.players.find((p) => p.id === view.playerId);
    const hand = me?.hands[moves.hand];
    const up = view.public.dealer.cards[0];
    const play: Play = hand && up ? basicStrategy(hand.cards, up, moves.split) : "S";
    return { type: MOVE[play](moves), hand: moves.hand, cards: moves.cards };
  },
};
