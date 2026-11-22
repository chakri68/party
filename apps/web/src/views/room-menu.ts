// The room menu: on every room screen (lobby, game, results), the "..."
// button at the top right holds the room's own buttons, so the screen stays
// clean. What it lists is `roomMenuItems` (tested); RoomView draws it and acts
// on each item exactly as the old header and turn-control buttons did.

import type { RoomPhase, RoomPublicState } from "@games/protocol";

/**
 * A focus screen: the slim header, the Room menu, and no voice row. Every room
 * screen but the party-over one (`ended`), which keeps its own header. Null is
 * no room screen (a fatal message).
 */
export function focusPhase(phase: RoomPhase | null): boolean {
  return phase === "lobby" || phase === "playing" || phase === "results";
}

export type RoomMenuItem =
  | "sounds"
  | "reactions"
  | "join-voice"
  | "voice"
  | "settings"
  | "pause"
  | "resume"
  | "restart"
  | "end-game"
  | "home";

export const ROOM_MENU_LABELS: Record<RoomMenuItem, string> = {
  sounds: "Sound board",
  reactions: "Reactions",
  "join-voice": "Join voice",
  voice: "Voice",
  settings: "Sound and vibration",
  pause: "Pause",
  resume: "Resume",
  restart: "Restart",
  "end-game": "End game",
  home: "Home",
};

/**
 * The menu's items, in order, on a focus screen. Empty elsewhere (party over).
 * Pause, Restart and End game only in a game: the lobby keeps its host
 * controls on the page.
 * - board: the sound board button would show (`soundBoardModel(...).button`).
 * - voice: `voiceMenuItem(...)`, or null where voice cannot work.
 * - pausable: the game's manifest says the host can pause it.
 * - hostActions: false drops Pause, Restart and End game, where they would do
 *   nothing (the "Could not connect" screen, the game just ended). Default true.
 */
export function roomMenuItems(
  room: RoomPublicState,
  me: string,
  o: { board: boolean; voice: "join" | "voice" | null; pausable: boolean; hostActions?: boolean },
): RoomMenuItem[] {
  if (!focusPhase(room.phase)) return [];
  const items: RoomMenuItem[] = [];
  if (o.board) items.push("sounds");
  items.push("reactions");
  if (o.voice === "join") items.push("join-voice");
  else if (o.voice === "voice") items.push("voice");
  items.push("settings");
  if (room.phase === "playing" && room.hostId === me && o.hostActions !== false) {
    if (o.pausable) items.push(room.paused ? "resume" : "pause");
    items.push("restart", "end-game");
  }
  items.push("home");
  return items;
}
