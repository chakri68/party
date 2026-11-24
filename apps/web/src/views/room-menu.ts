// The room menu: on every room screen (lobby, game, results, party over), the "..."
// button at the top right holds the room's own buttons, so the screen stays
// clean. The sound board and reactions are header buttons, not menu items.
// What it lists is `roomMenuItems` (tested); RoomView draws it and acts on
// each item exactly as the old header and turn-control buttons did.

import type { RoomPublicState } from "@games/protocol";
import { focusPhase } from "./focus.ts";

export type RoomMenuItem =
  | "join-voice"
  | "voice"
  /** The host mutes everyone else in voice, or lets them all talk again. */
  | "mute-all"
  | "allow-all"
  | "settings"
  /** The host's own sound list, for a host whose phone owns one. */
  | "my-sounds"
  | "pause"
  | "resume"
  | "restart"
  | "end-game"
  | "home"
  /** Not a button: a muted line where Join voice would be. */
  | "no-voice";

export const ROOM_MENU_LABELS: Record<RoomMenuItem, string> = {
  "join-voice": "Join voice",
  voice: "Voice",
  "mute-all": "Mute all",
  "allow-all": "Allow all to talk",
  settings: "Sound and vibration",
  "my-sounds": "My sounds",
  pause: "Pause",
  resume: "Resume",
  restart: "Restart",
  "end-game": "End game",
  home: "Home",
  "no-voice": "Voice does not work in this browser.",
};

/**
 * The menu's items, in order, on a focus screen. Party over: only Sound and
 * vibration and Home (voice is over). Empty elsewhere.
 * Pause, Restart and End game only in a game: the lobby keeps its host
 * controls on the page.
 * - voice: `voiceMenuItem(...)`: "unsupported" lists a line saying voice does not work here.
 * - pausable: the game's manifest says the host can pause it.
 * - hostActions: false drops Pause, Restart and End game, where they would do
 *   nothing (the "Could not connect" screen, the game just ended). Default true.
 * - mySounds: this phone owns a sound library. The host then gets My sounds.
 * - muteAll: `muteAllAction(...)`. The host gets it right after the voice item.
 */
export function roomMenuItems(
  room: RoomPublicState,
  me: string,
  o: { voice: "join" | "voice" | "unsupported" | null; pausable: boolean; hostActions?: boolean; mySounds?: boolean; muteAll?: "mute-all" | "allow-all" | null },
): RoomMenuItem[] {
  if (room.phase === "ended") return ["settings", "home"];
  if (!focusPhase(room.phase)) return [];
  const items: RoomMenuItem[] = [];
  if (o.voice === "join") items.push("join-voice");
  else if (o.voice === "voice") items.push("voice");
  else if (o.voice === "unsupported") items.push("no-voice");
  if (o.muteAll && room.hostId === me) items.push(o.muteAll);
  items.push("settings");
  if (o.mySounds && room.hostId === me) items.push("my-sounds");
  if (room.phase === "playing" && room.hostId === me && o.hostActions !== false) {
    if (o.pausable) items.push(room.paused ? "resume" : "pause");
    items.push("restart", "end-game");
  }
  items.push("home");
  return items;
}
