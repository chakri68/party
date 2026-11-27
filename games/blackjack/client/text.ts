// Words for the table: the log line, the status banner and hand results.
// Pure, so tests can read them without a page.
import { formatChips } from "../shared/rules.ts";
import type {
  BlackjackEvent,
  BlackjackPrivateState,
  BlackjackPublicPlayer,
  BlackjackPublicState,
  PublicHand,
} from "../shared/types.ts";
import { cardLabel } from "./cards.ts";

export interface Names {
  me: string;
  /** A seat's name; "You" is handled here. */
  name(id: string): string;
}

/** "Ana", "Ana and Ben", "Ana, Ben and Cy". */
export function list(items: string[]): string {
  return items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : (items[0] ?? "");
}

const who = (n: Names, id: string) => (id === n.me ? "You" : n.name(id));
/** "You bet" or "Ravi bets". */
const does = (n: Names, id: string, verb: string, they = `${verb}s`) => `${who(n, id)} ${id === n.me ? verb : they}`;

/** What a hand got, for its tag: "Win +100", "Blackjack +150", "Tie". */
export function resultText(hand: Pick<PublicHand, "result" | "bet" | "paid">): string {
  switch (hand.result) {
    case "win":
      return `Win +${formatChips(hand.paid - hand.bet)}`;
    case "blackjack":
      return `Blackjack +${formatChips(hand.paid - hand.bet)}`;
    case "push":
      return "Tie";
    case "lose":
      return "Lose";
    case "bust":
      return "Bust";
    default:
      return "";
  }
}

/** "Soft 17", "20", "Blackjack", "Bust 24", for a hand on the table. */
export function handLabel(hand: Pick<PublicHand, "total" | "soft" | "blackjack">): string {
  if (hand.blackjack) return "Blackjack";
  if (hand.total > 21) return `Bust ${hand.total}`;
  return hand.soft && hand.total < 21 ? `Soft ${hand.total}` : String(hand.total);
}

/** This round's chips won or lost, all hands together. */
export function roundNet(p: Pick<BlackjackPublicPlayer, "hands">): number | null {
  if (!p.hands.length || p.hands.some((h) => h.result === null)) return null;
  return p.hands.reduce((sum, h) => sum + h.paid - h.bet, 0);
}

export function describe(e: BlackjackEvent, n: Names): string | null {
  const why = (auto?: string) => (auto === "timer" ? " (out of time)" : auto === "skip" ? " (skipped)" : auto === "away" ? " (away)" : "");
  switch (e.type) {
    case "round-start":
      return `Round ${e.round}. Place your bets.${e.shuffled ? " The dealer shuffled the cards." : ""}`;
    case "bet":
      return `${does(n, e.playerId, "bet", "bets")} ${formatChips(e.amount)}.`;
    case "sit-out":
      return `${does(n, e.playerId, "sit")} out this round${why(e.auto)}.`;
    case "deal":
      return null;
    case "peek":
      return e.blackjack ? "The dealer checked the card. The dealer has Blackjack." : "The dealer checked the card. No Blackjack.";
    case "move":
      switch (e.kind) {
        case "hit":
          return `${does(n, e.playerId, "take")} a card.`;
        case "stand":
          return `${does(n, e.playerId, "stand")}${why(e.auto)}.`;
        case "double":
          return `${does(n, e.playerId, "double")}.`;
        case "split":
          return `${does(n, e.playerId, "split", "splits")}.`;
      }
      return null;
    case "bust":
      return `${who(n, e.playerId)} went over 21 with ${e.total}.`;
    case "dealer-reveal":
      return `The dealer turns over the ${cardLabel(e.card)}.`;
    case "dealer-draw":
      return `The dealer takes the ${cardLabel(e.card)}.`;
    case "settled": {
      if (!e.results.length) return "Nobody bet this round.";
      const mine = e.results.filter((r) => r.playerId === n.me);
      const dealer = e.dealerBust ? "The dealer went over 21." : `The dealer has ${e.dealerTotal}.`;
      if (!mine.length) return dealer;
      const net = mine.reduce((sum, r) => sum + r.paid - r.bet, 0);
      const you = net > 0 ? `You win ${formatChips(net)}.` : net < 0 ? `You lose ${formatChips(-net)}.` : "You get your bet back.";
      return `${dealer} ${you}`;
    }
    case "busted": {
      const parts: string[] = [];
      const out = e.playerIds.filter((id) => !e.rebuy.includes(id));
      if (out.length) parts.push(`${list(out.map((id) => who(n, id)))} ${out.length === 1 && out[0] !== n.me ? "is" : "are"} out of chips.`);
      if (e.rebuy.length) parts.push(`${list(e.rebuy.map((id) => who(n, id)))} can rebuy.`);
      return parts.join(" ");
    }
    case "rebuy":
      return `${does(n, e.playerId, "rebuy", "rebuys")} for ${formatChips(e.chips)} chips.`;
    case "stay-out":
      return `${does(n, e.playerId, "stay", "stays")} out.`;
    case "back":
      return `${who(n, e.playerId)} ${e.playerId === n.me ? "play" : "plays"} again from the next round.`;
    case "player-removed":
      return `${who(n, e.playerId)} left the game.`;
    case "game-over":
      if (e.reason === "abandoned") return "Everyone else left.";
      if (e.reason === "everyone-out") return "Everyone is out of chips.";
      return "That was the last round. Most chips wins.";
  }
}

/** Who the table waits on right now, by the public state alone. */
export function waitingOn(game: BlackjackPublicState): string[] {
  if (game.step === "betting") {
    return game.players
      .filter((p) => !p.removed && !p.out && !p.away && (p.pendingRebuy || (p.bet === null && !p.sittingOut && p.stack > 0)))
      .map((p) => p.id);
  }
  if (game.step === "play") return game.players.filter((p) => p.active >= 0 && !p.away).map((p) => p.id);
  return [];
}

/** The banner's line. */
export function statusText(game: BlackjackPublicState, priv: BlackjackPrivateState | null, n: Names): string {
  const me = game.players.find((p) => p.id === n.me);
  const others = (ids: string[]) => ids.filter((id) => id !== n.me).map((id) => n.name(id));
  if (game.step !== "over" && priv?.canBack && !priv.bet) return "You are sitting out";
  switch (game.step) {
    case "over":
      return "Game over";
    case "betting": {
      if (priv?.canRebuy) return "You are out of chips. Rebuy?";
      if (priv?.bet) return "Place your bet";
      if (me?.out) return "You are out of chips";
      const wait = others(waitingOn(game));
      return wait.length ? `Waiting for ${list(wait)} to bet` : "Dealing";
    }
    case "play": {
      if (priv?.moves) return me && me.hands.length > 1 ? `Your move · Hand ${priv.moves.hand + 1} of 2` : "Your move";
      const wait = others(waitingOn(game));
      return wait.length ? `Waiting for ${list(wait)}` : "Dealer's turn";
    }
    case "dealer":
      return "Dealer's turn";
    case "settle": {
      const net = me ? roundNet(me) : null;
      if (net === null) return "Next round soon";
      return net > 0 ? `You win ${formatChips(net)}` : net < 0 ? `You lose ${formatChips(-net)}` : "You get your bet back";
    }
  }
}

/** Quick bet amounts the stack can cover, smallest first. */
export function quickBets(min: number, max: number): number[] {
  return [10, 25, 50, 100, 250, 500].filter((n) => n >= min && n < max);
}
