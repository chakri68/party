import { seatName, type GameViewProps } from "@games/ui";
import type { NmpEvent } from "../shared/types.ts";
import { cardName, problemName } from "./cards.ts";

/** "Asha", "Asha and Ravi", "Asha, Ravi and Mina". */
function list(names: string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "Nobody");
}

/** One event as one plain sentence, with names from the room. */
export function describe(e: NmpEvent, props: GameViewProps): string {
  const me = props.playerId;
  const who = (id: string) => (id === me ? "You" : seatName(props.room, id));
  const whom = (id: string) => (id === me ? "you" : seatName(props.room, id));
  const has = (id: string, you: string, them: string) => (id === me ? you : them);
  switch (e.type) {
    case "turn":
      return e.playerId === me ? "Your turn." : `${who(e.playerId)}'s turn.`;
    case "played":
      return e.targetId
        ? `${who(e.playerId)} played ${cardName(e.kind)} on ${whom(e.targetId)}.`
        : `${who(e.playerId)} played ${cardName(e.kind)}.`;
    case "drew":
      return e.problem
        ? `${who(e.playerId)} drew a Problem: ${problemName(e.problem)}.`
        : `${who(e.playerId)} drew a card.`;
    case "drew-card":
      return `You drew ${cardName(e.card.kind)}.`;
    case "spied":
      if (e.card && e.toId === me) return `You took ${cardName(e.card.kind)} from ${whom(e.fromId)}.`;
      if (e.card && e.fromId === me) return `${who(e.toId)} took your ${cardName(e.card.kind)}.`;
      return `${who(e.toId)} took a card from ${whom(e.fromId)}.`;
    case "moved":
      return `${who(e.fromId)} passed ${problemName(e.problemKind)} to ${whom(e.toId)}.`;
    case "fixed":
      return e.by === "report"
        ? `The report worked. ${who(e.playerId)} fixed the Problem.`
        : `${who(e.playerId)} fixed the Problem.`;
    case "warned": {
      if (e.amount <= 0) return `${has(e.playerId, "Your", `${seatName(props.room, e.playerId)}'s`)} Intern took the warning.`;
      const got = `${who(e.playerId)} got ${e.amount} ${e.amount === 1 ? "warning" : "warnings"}.`;
      return e.shielded ? `${has(e.playerId, "Your", `${seatName(props.room, e.playerId)}'s`)} Intern took 1 warning. ${got}` : got;
    }
    case "fired":
      return e.playerId === me ? "You are fired." : `${who(e.playerId)} is fired.`;
    case "report":
      return `${who(e.playerId)} played a Fake Report. ${has(e.playerId, "You say", "They say")} the face-down card is a Quick Fix.`;
    case "challenged":
      return e.lied
        ? `${who(e.challengerId)} challenged ${whom(e.ownerId)}. The card was ${cardName(e.card.kind)}, not a Quick Fix.`
        : `${who(e.challengerId)} challenged ${whom(e.ownerId)}. It was a real Quick Fix.`;
    case "passed":
      return `${who(e.playerId)} passed.`;
    case "removed":
      return `${who(e.playerId)} left the game.`;
    case "game-over": {
      if (!e.winnerIds.length) return "The game is over.";
      if (e.winnerIds.includes(me)) return e.winnerIds.length === 1 ? "You win!" : `You win, with ${list(e.winnerIds.filter((id) => id !== me).map(whom))}.`;
      return `${list(e.winnerIds.map(who))} ${e.winnerIds.length === 1 ? "wins" : "win"}.`;
    }
  }
}

/**
 * The feed line for an update: the latest public event, unless this update
 * also told me something only I know about it (the card I drew or took).
 */
export function feedLine(lastEvent: NmpEvent | null, events: NmpEvent[], props: GameViewProps): string {
  const mine = events.findLast((e) => e.type === "drew-card" || (e.type === "spied" && !!e.card));
  if (mine && lastEvent && (lastEvent.type === "drew" || lastEvent.type === "spied")) return describe(mine, props);
  return lastEvent ? describe(lastEvent, props) : "";
}
