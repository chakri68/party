import file from "../data/tracks.json";
import { parseTrackFile, type TrackData } from "../shared/track-data.ts";

// The server's copy of the track data (map §3.5): checkpoint gates, the
// finish, recovery anchors and bounds, for checking what a Navigator's Godot
// claims. Validated at module load, so a bad export breaks the Worker's
// startup, not the third checkpoint of someone's race.
//
// TODO(M1 step 9, Godot half): data/tracks.json is hand-written from
// godot/tools/build_pine_panic.gd for now; godot/tools/export_tracks.gd
// should write it from the scenes.

const TRACKS: readonly TrackData[] = parseTrackFile(file);

export function trackData(id: string): TrackData {
  const t = TRACKS.find((x) => x.id === id);
  if (!t) throw new Error(`blind-rally: no track data for ${id}`);
  return t;
}
