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
