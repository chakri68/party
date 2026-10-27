import { flatDistance, type PaceNote, type TrackData, type Vec3 } from "../../shared/track-data.ts";

// Rally's co-driver reads the pace notes out in order, so it has to guess
// where along the route the car is. Two upper bounds, the tighter one wins:
//   - the next gate's route distance minus the straight line to it (a road
//     is never shorter than the crow's line, so this runs early);
//   - the last gate's distance plus the trip meter since it (detours count
//     on the trip meter, so this runs early too).
// Early is the right way to be wrong for a co-driver: a call comes a touch
// soon, never after the corner. Never below the last gate passed.

/** Metres along the route, from Godot's own checkpoint count, the car's position and the metres driven since that checkpoint. */
export function routeProgress(track: TrackData, passed: number, position: Vec3, tripSinceGate: number): number {
  const n = track.checkpoints.length;
  const from = passed > 0 ? track.checkpoints[Math.min(passed, n) - 1]!.distance : 0;
  const next = passed < n ? track.checkpoints[passed]! : track.finish;
  const byLine = next.distance - flatDistance(position, next.position);
  const byTrip = from + Math.max(0, tripSinceGate);
  return Math.min(next.distance, Math.max(from, Math.min(byLine, byTrip)));
}

/** The next `count` notes past `progress`, with metres to each. Notes come sorted (trackProblems insists); the export ends them on FINISH. */
export function upcoming(track: TrackData, progress: number, count = 2): { note: PaceNote; inM: number }[] {
  return track.paceNotes
    .filter((n) => n.distance > progress)
    .slice(0, count)
    .map((note) => ({ note, inM: note.distance - progress }));
}
