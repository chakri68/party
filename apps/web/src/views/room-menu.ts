// The room menu: on every room screen (lobby, game, results), the "..."
// button at the top right holds the room's own buttons, so the screen stays
// clean. What it lists is `roomMenuItems` (tested); RoomView draws it and acts
// on each item exactly as the old header and turn-control buttons did.

import type { RoomPublicState } from "@games/protocol";
import { focusPhase } from "./focus.ts";

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
  | "home"
  /** Not a button: a muted line where Join voice would be. */
  | "no-voice";

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
  "no-voice": "Voice does not work in this browser.",
};

/**
 * The menu's items, in order, on a focus screen. Empty elsewhere (party over).
 * Pause, Restart and End game only in a game: the lobby keeps its host
 * controls on the page.
 * - board: the sound board button would show (`soundBoardModel(...).button`).
 * - voice: `voiceMenuItem(...)`: "unsupported" lists a line saying voice does not work here.
 * - pausable: the game's manifest says the host can pause it.
 * - hostActions: false drops Pause, Restart and End game, where they would do
 *   nothing (the "Could not connect" screen, the game just ended). Default true.
 */
export function roomMenuItems(
  room: RoomPublicState,
  me: string,
  o: { board: boolean; voice: "join" | "voice" | "unsupported" | null; pausable: boolean; hostActions?: boolean },
): RoomMenuItem[] {
  if (!focusPhase(room.phase)) return [];
  const items: RoomMenuItem[] = [];
  if (o.board) items.push("sounds");
  items.push("reactions");
  if (o.voice === "join") items.push("join-voice");
  else if (o.voice === "voice") items.push("voice");
  else if (o.voice === "unsupported") items.push("no-voice");
  items.push("settings");
  if (room.phase === "playing" && room.hostId === me && o.hostActions !== false) {
    if (o.pausable) items.push(room.paused ? "resume" : "pause");
    items.push("restart", "end-game");
  }
  items.push("home");
  return items;
}
