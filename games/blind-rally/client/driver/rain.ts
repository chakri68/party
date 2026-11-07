import { rainAt, SNOW_TRACKS } from "../../shared/sky.ts";
import type { BlindRallyPublicState, PublicTeam } from "../../shared/types.ts";
import { runClock } from "../role.ts";

/**
 * How loud the Driver's rain loop plays, 0..1: the public rain ramp on the
 * team's run clock, so it starts and stops when the Navigator's sky does.
 * Silent unless the car is running (before GO, home, paused, race over), and
 * on a snow track, where the "rain" falls as snow and makes no sound.
 */
export function driverRainLevel(game: BlindRallyPublicState, team: PublicTeam | undefined, now: number): number {
  if (SNOW_TRACKS.includes(game.trackId)) return 0;
  const clock = runClock(game, team, now);
  if (!clock.running) return 0;
  return rainAt({ light: { from: "day", to: "day", atMs: 0, overMs: 0 }, rain: game.skyRain }, clock.ms);
}
