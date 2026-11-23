import type { ClientMessage, RoomPublicState, SeatPublic } from "@games/protocol";

/** Phase 3 adds "mute". */
export type SeatActionKind = "make-host" | "remove";

export interface SeatAction {
  kind: SeatActionKind;
  label: string;
  /** The question to ask first, or null to act at once. */
  confirm: string | null;
  danger: boolean;
}

/** What the host can do to one seat, in menu order. Nothing for anyone else. */
export function seatActions(room: RoomPublicState, me: string, seat: SeatPublic): SeatAction[] {
  if (room.hostId !== me || seat.id === me) return [];
  const actions: SeatAction[] = [];
  if (!seat.bot && seat.presence === "connected") {
    actions.push({ kind: "make-host", label: "Make host", confirm: `Make ${seat.name} the host?`, danger: false });
  }
  actions.push({ kind: "remove", label: "Remove", confirm: seat.bot ? null : `Remove ${seat.name} from the room?`, danger: true });
  return actions;
}

export function seatActionMessage(kind: SeatActionKind, seat: SeatPublic): ClientMessage {
  return kind === "make-host" ? { type: "transfer-host", playerId: seat.id } : { type: "remove-player", playerId: seat.id };
}

/**
 * Who gets the host role if the host leaves now. Mirrors the server's
 * `ensureHost`: the connected person who joined first; with nobody connected,
 * the first other person still seated. Null when no other person is here
 * (computers are never host).
 */
export function nextHost(room: RoomPublicState, me: string): SeatPublic | null {
  const people = room.seats.filter((s) => s.id !== me && !s.bot && s.presence !== "left");
  const connected = people.filter((s) => s.presence === "connected").sort((a, b) => a.joinedAt - b.joinedAt);
  return connected[0] ?? people[0] ?? null;
}

/**
 * What to ask before you leave the room, or null to leave at once. A player
 * leaving a game drops out of it; the host leaving hands the room on.
 */
export function leaveQuestion(room: RoomPublicState, me: string): string | null {
  const playing = room.phase === "playing";
  const host = room.hostId === me && room.phase !== "ended";
  if (!playing && !host) return null;
  const lines = [playing ? "Leave the game? You will be out for the rest of this round." : "Leave the room?"];
  if (host) {
    const next = nextHost(room, me);
    lines.push(next ? `${next.name} will be the host.` : "Nobody else is here. The room stays open for a few hours.");
  }
  return lines.join(" ");
}
