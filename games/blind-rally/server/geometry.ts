import file from "../data/tracks.json";
import { parseTrackFile, type TrackData } from "../shared/track-data.ts";
import type { PublicTrack } from "../shared/types.ts";

// The server's copy of the track data (map §3.5): checkpoint gates, the
// finish, recovery anchors and bounds, for checking what a Navigator's Godot
// claims. Validated at module load, so a bad export breaks the Worker's
// startup, not the third checkpoint of someone's race.
//
// data/tracks.json is written by godot/tools/export_tracks.gd from the track
// scenes (scripts/export-godot.mjs runs it on every export). Which tracks
// exist is the file's business: nothing on the server names one.

const TRACKS: readonly TrackData[] = parseTrackFile(file);

export function trackData(id: string): TrackData {
  const t = TRACKS.find((x) => x.id === id);
  if (!t) throw new Error(`blind-rally: no track data for ${id}`);
  return t;
}

export const hasTrack = (id: unknown): id is string => typeof id === "string" && TRACKS.some((t) => t.id === id);

/** A fresh room's track: the file's first. */
export const defaultTrack = (): string => TRACKS[0]!.id;

/**
 * The lobby's cards: an allow-list of header fields and two counts. Anything
 * with a coordinate in it stays here (test/projection.test.ts walks it).
 */
const CATALOG: readonly PublicTrack[] = TRACKS.map((t) => ({
  id: t.id,
  name: t.name,
  difficulty: t.difficulty,
  length: t.length,
  landmarkCount: t.landmarks.length,
  par_seconds: t.par_seconds,
}));

export const trackCatalog = (): PublicTrack[] => CATALOG.map((t) => ({ ...t }));
