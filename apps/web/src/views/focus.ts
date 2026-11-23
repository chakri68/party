// Which room screens use focus mode: the slim header, the Room menu and the
// header mic, with no voice row. Shared by RoomView, the Room menu and the
// voice bar. Party over has the same slim header and menu, but no voice.

import type { RoomPhase } from "@games/protocol";

/**
 * A focus screen: every room screen but the party-over one (`ended`), where
 * voice is over. Null is no room screen (a fatal message).
 */
export function focusPhase(phase: RoomPhase | null): boolean {
  return phase === "lobby" || phase === "playing" || phase === "results";
}

/** The slim header with the Room menu: the focus screens and party over. */
export function slimHeader(phase: RoomPhase | null): boolean {
  return focusPhase(phase) || phase === "ended";
}
