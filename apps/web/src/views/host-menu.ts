import type { ClientMessage, RoomPublicState, SeatPublic } from "@games/protocol";

export type SeatActionKind = "mute" | "allow-talk" | "make-host" | "remove";

export interface SeatAction {
  kind: SeatActionKind;
  label: string;
  /** The question to ask first, or null to act at once. */
  confirm: string | null;
  danger: boolean;
}

/**
 * What the host can do to one seat, in menu order. Nothing for anyone else.
 * `voice`: the seat's voice entry, when it is in voice (computers never are).
 * Mute or Allow to talk come first and act at once: one tap undoes them.
 */
export function seatActions(room: RoomPublicState, me: string, seat: SeatPublic, voice?: { hostMuted: boolean } | null): SeatAction[] {
  if (room.hostId !== me || seat.id === me) return [];
  const actions: SeatAction[] = [];
  if (voice) {
    actions.push(
      voice.hostMuted
        ? { kind: "allow-talk", label: "Allow to talk", confirm: null, danger: false }
        : { kind: "mute", label: "Mute", confirm: null, danger: false },
    );
  }
  if (!seat.bot && seat.presence === "connected") {
    actions.push({ kind: "make-host", label: "Make host", confirm: `Make ${seat.name} the host?`, danger: false });
  }
  actions.push({ kind: "remove", label: "Remove", confirm: seat.bot ? null : `Remove ${seat.name} from the room?`, danger: true });
  return actions;
}

export function seatActionMessage(kind: SeatActionKind, seat: SeatPublic): ClientMessage {
  switch (kind) {
    case "mute":
      return { type: "host-mute", playerId: seat.id, muted: true };
    case "allow-talk":
      return { type: "host-mute", playerId: seat.id, muted: false };
    case "make-host":
      return { type: "transfer-host", playerId: seat.id };
    case "remove":
      return { type: "remove-player", playerId: seat.id };
  }
}

/**
 * The room menu's Mute all and Allow all to talk, in menu order. Only for the
 * host, and only with someone else in voice (the host need not be in voice);
 * empty otherwise. Mute all while anyone else can still talk; Allow all to
 * talk while anyone else is muted. With only some muted, both.
 */
export function muteAllActions(room: RoomPublicState, me: string, members: { id: string; hostMuted: boolean }[]): ("mute-all" | "allow-all")[] {
  if (room.hostId !== me) return [];
  const others = members.filter((m) => m.id !== me);
  const actions: ("mute-all" | "allow-all")[] = [];
  if (others.some((m) => !m.hostMuted)) actions.push("mute-all");
  if (others.some((m) => m.hostMuted)) actions.push("allow-all");
  return actions;
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
    lines.push(next ? `${next.name} will be the host.` : "No other person is here. The room stays open for a few hours.");
  }
  return lines.join(" ");
}
