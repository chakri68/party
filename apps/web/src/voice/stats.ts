// Voice link stats as text lines for the dev debug panel. Pure: the panel
// draws these, and nothing here leaves the device.

import type { VoicePeerStats } from "@games/webrtc";
import type { VoiceView } from "./voice.ts";

const dash = (v: number | null) => (v === null ? "-" : String(v));
const yesNo = (v: boolean | null) => (v === null ? "-" : v ? "yes" : "no");

/** A header line (status, mic, talking, TURN server), then one line per peer in roster order. */
export function voiceStatsLines(v: VoiceView, stats: VoicePeerStats[], nameOf: (id: string) => string): string[] {
  const byPeer = new Map(stats.map((s) => [s.peerId, s]));
  const lines = [`voice: ${v.status} · mic: ${v.mic} · talking: ${yesNo(v.talking)} · relay server: ${yesNo(v.hasTurn)}`];
  for (const m of v.members) {
    if (m.self) continue;
    const s = byPeer.get(m.id);
    lines.push(`${nameOf(m.id)}: ${m.link ?? "-"} · rtt ${dash(s?.rttMs ?? null)} ms · lost ${dash(s?.packetsLost ?? null)} · relay ${yesNo(s?.relayed ?? null)}`);
  }
  return lines;
}
