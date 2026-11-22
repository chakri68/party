// Who is in room voice. The roster is stored with the room; this file only
// decides who still belongs on it.

import type { Presence, RoomPhase, VoiceMember } from "@games/protocol";

/**
 * Members whose seat is still here and still a person: drops missing, bot,
 * "disconnected" and "left" seats, and everyone once the party has ended.
 * Order kept.
 */
export function pruneVoice(
  members: VoiceMember[],
  seats: { id: string; presence: Presence; bot?: true }[],
  phase: RoomPhase,
): VoiceMember[] {
  if (phase === "ended") return [];
  const here = new Set<string>();
  for (const s of seats) if (!s.bot && (s.presence === "connected" || s.presence === "reconnecting")) here.add(s.id);
  return members.filter((m) => here.has(m.id));
}
