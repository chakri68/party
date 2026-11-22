// Which room screens use focus mode: the slim header, the Room menu and the
// header mic, with no voice row. Shared by RoomView, the Room menu and the
// voice bar.

import type { RoomPhase } from "@games/protocol";

/**
 * A focus screen: every room screen but the party-over one (`ended`), which
 * keeps its own header. Null is no room screen (a fatal message).
 */
export function focusPhase(phase: RoomPhase | null): boolean {
  return phase === "lobby" || phase === "playing" || phase === "results";
}
