import type { PublicTrack } from "./types.ts";

// The public half of the track list (map §3.5) arrives in the public state,
// built by the server from data/tracks.json: names and numbers only. Nothing
// here lists tracks itself, so a new track is an export, not a code change.

export type { PublicTrack };

/** The track's display name, or its id if this list doesn't know it (a stale page, say). */
export const trackName = (tracks: readonly PublicTrack[], id: string) => tracks.find((t) => t.id === id)?.name ?? id;
