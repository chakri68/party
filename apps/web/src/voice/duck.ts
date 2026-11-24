// How loud game sound should be right now: lower while someone else talks.
// My own voice never ducks my game sound (user, 2026-11-24). Speaking already
// has a hold (SPEAK_HOLD_TICKS), so there is no extra hold here. With element
// playback there are no levels, so no one reads as speaking and nothing ducks.

import { DUCK_GAIN } from "@games/audio";
import type { VoiceView } from "./voice.ts";

export function duckLevel(v: VoiceView, on: boolean): number {
  if (!on || v.status !== "on" || v.deafened) return 1;
  return v.members.some((m) => !m.self && m.speaking && !m.blocked) ? DUCK_GAIN : 1;
}
