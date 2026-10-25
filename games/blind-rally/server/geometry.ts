import file from "../data/tracks.json";
import { parseTrackFile, type TrackData } from "../shared/track-data.ts";

// The server's copy of the track data (map §3.5): checkpoint gates, the
// finish, recovery anchors and bounds, for checking what a Navigator's Godot
// claims. Validated at module load, so a bad export breaks the Worker's
// startup, not the third checkpoint of someone's race.
//
// data/tracks.json is written by godot/tools/export_tracks.gd from the track
// scenes (scripts/export-godot.mjs runs it on every export).

const TRACKS: readonly TrackData[] = parseTrackFile(file);

export function trackData(id: string): TrackData {
  const t = TRACKS.find((x) => x.id === id);
  if (!t) throw new Error(`blind-rally: no track data for ${id}`);
  return t;
}
