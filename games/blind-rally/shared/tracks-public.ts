// The public half of the track list (map §3.5): what a lobby, a Driver or a
// results screen may know. Geometry, checkpoints and pace notes are in
// data/tracks.json (contract: shared/track-data.ts), and only server/ and
// client/navigator/ read it. test/tracks.test.ts keeps the two in step.
// Field names follow that file, hence par_seconds.

export interface PublicTrack {
  id: string;
  name: string;
  difficulty: "easy" | "medium" | "hard";
  /** A clean run's time, once someone's measured one. */
  par_seconds: number | null;
}

export const TRACKS: readonly PublicTrack[] = [
  { id: "pine_panic", name: "Pine Panic", difficulty: "easy", par_seconds: null },
];

export const DEFAULT_TRACK = TRACKS[0]!.id;

export const trackName = (id: string) => TRACKS.find((t) => t.id === id)?.name ?? id;
