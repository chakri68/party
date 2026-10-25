import file from "../../data/tracks.json";
import type { TrackData, TrackFile } from "../../shared/track-data.ts";

// The Navigator's copy of the track data, for the pace notes. This chunk is
// only loaded for a Navigator's seat (client/view.ts), so a Driver never
// downloads it (map §3.5). The server validates the same file at startup.

const TRACKS = (file as unknown as TrackFile).tracks;

export const navigatorTrack = (id: string): TrackData | null => TRACKS.find((t) => t.id === id) ?? null;
