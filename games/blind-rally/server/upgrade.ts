import { DEFAULT_SETTINGS, TRACK_PICKS, VEHICLE_PICKS, type BlindRallyState } from "../shared/types.ts";
import { DEFAULT_VEHICLE, isVehicleId } from "../shared/vehicles.ts";

// Rooms live in Durable Object storage across deploys, so a state saved by an
// older Worker can turn up in a newer one. Each field added since M1 gets its
// default here, once, on the way in. Already-current states come back as the
// same object, so the hot path (snapshots at 10 Hz) doesn't copy anything.

export function upgrade(state: BlindRallyState): BlindRallyState {
  const old = state as Partial<BlindRallyState> & BlindRallyState;
  const settingsOk = TRACK_PICKS.includes(old.settings?.trackPick) && VEHICLE_PICKS.includes(old.settings?.vehiclePick);
  const carsOk = isVehicleId(old.vehicleId) && Array.isArray(old.vehicleBallot?.votes) && old.teams.every((t) => isVehicleId(t.vehicle));
  if (Array.isArray(old.ballots) && settingsOk && carsOk) return state;
  return {
    ...old,
    // Before track choice there was one track, and the host had "picked" it.
    // Before cars there was one car, and nobody had to pick it.
    settings: settingsOk
      ? old.settings
      : {
          ...old.settings,
          trackPick: TRACK_PICKS.includes(old.settings?.trackPick) ? old.settings.trackPick : DEFAULT_SETTINGS.trackPick,
          vehiclePick: VEHICLE_PICKS.includes(old.settings?.vehiclePick) ? old.settings.vehiclePick : DEFAULT_SETTINGS.vehiclePick,
        },
    ballots: Array.isArray(old.ballots) ? old.ballots : [{ target: "all", votes: [], tied: [] }],
    vehicleId: isVehicleId(old.vehicleId) ? old.vehicleId : DEFAULT_VEHICLE,
    vehicleBallot: Array.isArray(old.vehicleBallot?.votes) ? old.vehicleBallot : { votes: [], tied: [] },
    teams: old.teams.map((t) => (isVehicleId(t.vehicle) ? t : { ...t, vehicle: DEFAULT_VEHICLE })),
  };
}
