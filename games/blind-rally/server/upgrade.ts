import { DEFAULT_SETTINGS, TRACK_PICKS, type BlindRallyState } from "../shared/types.ts";

// Rooms live in Durable Object storage across deploys, so a state saved by an
// older Worker can turn up in a newer one. Each field added since M1 gets its
// default here, once, on the way in. Already-current states come back as the
// same object, so the hot path (snapshots at 10 Hz) doesn't copy anything.

export function upgrade(state: BlindRallyState): BlindRallyState {
  const old = state as Partial<BlindRallyState> & BlindRallyState;
  const settingsOk = TRACK_PICKS.includes(old.settings?.trackPick);
  if (Array.isArray(old.ballots) && settingsOk) return state;
  return {
    ...old,
    // Before track choice there was one track, and the host had "picked" it.
    settings: settingsOk ? old.settings : { ...old.settings, trackPick: DEFAULT_SETTINGS.trackPick },
    ballots: Array.isArray(old.ballots) ? old.ballots : [{ target: "all", votes: [], tied: [] }],
  };
}
