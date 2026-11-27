// The view's words, with no DOM: the log lines, the summary and the seat tags.
// Kept apart so tests can read them.
import { formatChips } from "@games/game-core";
import { joinList, seatName, type GameViewProps } from "@games/ui";
import type { HandSummary, LegalMoves, MoveKind, TeenPattiEvent, TeenPattiPublicPlayer } from "../shared/types.ts";
import { cardLabel } from "./cards.ts";

/** "Ana", "Ana and Ben", "Ana, Ben and Cy". */
export const names = (list: string[]) => joinList(list);

const who = (props: GameViewProps, id: string | null) => (id === props.playerId ? "You" : seatName(props.room, id));
const verb = (props: GameViewProps, id: string, you: string, they: string) => (id === props.playerId ? you : they);

export const MOVE_WORD: Record<MoveKind, string> = {
  chaal: "Chaal",
  double: "Double",
  "all-in": "All-in",
  show: "Show",
  sideshow: "Sideshow",
};

/** "Ana wins 1,240 · Pair of Kings". One clause per pot that someone won. */
export function summaryText(summary: HandSummary, props: GameViewProps): string {
  const me = props.playerId;
  const pots = summary.pots.filter((p) => !p.uncalled);
  return pots
    .map((pot, i) => {
      const winners = names(pot.winners.map((id) => who(props, id)));
      const single = pot.winners.length === 1;
      const v = single ? (pot.winners[0] === me ? "win" : "wins") : "share";
      const which = pots.length > 1 ? `${i === 0 ? "Main pot" : `Side pot${pots.length > 2 ? ` ${i}` : ""}`}: ` : "";
      return `${which}${winners} ${v} ${formatChips(pot.amount)}${pot.label ? ` · ${pot.label}` : ""}`;
    })
    .join(". ");
}

/** What a seat shows under its stack: the hand's state, or the last move. */
export function seatTag(p: TeenPattiPublicPlayer): { text: string; hot: boolean } | null {
  if (p.removed) return { text: "Left", hot: false };
  if (p.out) return { text: "Out", hot: false };
  if (!p.inHand) return null;
  if (p.packed) return { text: "Packed", hot: false };
  if (p.allIn) return { text: "All-in", hot: true };
  if (p.lastMove) return { text: `${MOVE_WORD[p.lastMove.kind]} ${formatChips(p.lastMove.amount)}`, hot: false };
  return null;
}

/** The buttons for a turn, in order, each with its price. `label` is the whole line; the view stacks `word` over `price`. */
export function moveButtons(legal: LegalMoves): { action: string; label: string; word: string; price?: string; primary?: boolean }[] {
  const out: { action: string; label: string; word: string; price?: string; primary?: boolean }[] = [{ action: "pack", label: "Pack", word: "Pack" }];
  const add = (action: MoveKind, amount: number, primary?: boolean) => {
    const word = MOVE_WORD[action];
    const price = formatChips(amount);
    out.push({ action, label: `${word} ${price}`, word, price, ...(primary ? { primary } : {}) });
  };
  if (legal.allIn !== null) add("all-in", legal.allIn, true);
  if (legal.chaal !== null) add("chaal", legal.chaal, true);
  if (legal.double !== null) add("double", legal.double);
  if (legal.show !== null) add("show", legal.show);
  if (legal.sideshow !== null) add("sideshow", legal.sideshow.cost);
  return out;
}

export function describe(e: TeenPattiEvent, props: GameViewProps): string | null {
  const me = props.playerId;
  switch (e.type) {
    case "hand-start":
      return `Hand ${e.handNumber}. Everyone puts in the boot of ${formatChips(e.boot)}. ${who(props, e.dealerId)} ${verb(props, e.dealerId, "deal", "deals")}.`;
    case "level-up":
      return `The boot goes up to ${formatChips(e.boot)}.`;
    case "your-cards":
      return `Your cards are ${joinList(e.cards.map((c) => `the ${cardLabel(c)}`))}.`;
    case "saw":
      return e.playerId === me ? null : `${who(props, e.playerId)} sees their cards.`;
    case "bet": {
      const name = who(props, e.playerId);
      const how = e.seen ? "" : " Blind";
      switch (e.kind) {
        case "chaal": return `${name} ${verb(props, e.playerId, "bet", "bets")} ${formatChips(e.amount)}${how}.`;
        case "double": return `${name} ${verb(props, e.playerId, "double", "doubles")} to ${formatChips(e.amount)}${how}. The stake is now ${formatChips(e.stake)}.`;
        case "all-in": return `${name} ${verb(props, e.playerId, "go", "goes")} all-in for ${formatChips(e.amount)}.`;
        case "show": return `${name} ${verb(props, e.playerId, "pay", "pays")} ${formatChips(e.amount)} for a Show.`;
        case "sideshow": return `${name} ${verb(props, e.playerId, "pay", "pays")} ${formatChips(e.amount)} for a Sideshow.`;
      }
      return null;
    }
    case "pack": {
      const name = who(props, e.playerId);
      const why =
        e.reason === "timer" ? " (out of time)" : e.reason === "skip" ? " (skipped)" : e.reason === "sitting-out" ? " (sitting out)" : "";
      if (e.reason === "sideshow") return `${name} ${verb(props, e.playerId, "lose", "loses")} the Sideshow and ${verb(props, e.playerId, "pack", "packs")}.`;
      if (e.reason === "left") return `${name} left. The game packed their cards.`;
      return `${name} ${verb(props, e.playerId, "pack", "packs")}${why}.`;
    }
    case "sideshow-ask":
      return `${who(props, e.fromId)} ${verb(props, e.fromId, "ask", "asks")} ${e.toId === me ? "you" : seatName(props.room, e.toId)} for a Sideshow.`;
    case "sideshow-answer": {
      const name = who(props, e.toId);
      if (e.accepted) return `${name} ${verb(props, e.toId, "say", "says")} yes.`;
      const why = e.auto === "timer" ? " (out of time)" : e.auto ? " (away)" : "";
      return `${name} ${verb(props, e.toId, "say", "says")} no${why}.`;
    }
    case "sideshow-cards":
      return null;
    case "pot-limit":
      return `The pot reached the limit of ${formatChips(e.limit)}. Every hand turns over.`;
    case "reveal":
      return null;
    case "awarded":
      return `${summaryText(e.summary, props)}.`;
    case "sitting-out":
      return `${who(props, e.playerId)} ${verb(props, e.playerId, "are", "is")} sitting out.`;
    case "back":
      return `${who(props, e.playerId)} ${verb(props, e.playerId, "are", "is")} back.`;
    case "busted": {
      const list = e.playerIds.map((id) => who(props, id));
      return `${names(list)} ${list.length === 1 && e.playerIds[0] !== me ? "is" : "are"} out.`;
    }
    case "player-removed":
      return null;
    case "game-over":
      if (e.reason === "abandoned") return "Everyone else left.";
      if (e.reason === "time") return "Time is up. The player with the most chips wins.";
      return e.winnerIds.includes(me) ? "You have all the chips." : `${names(e.winnerIds.map((id) => who(props, id)))} has all the chips.`;
  }
}
