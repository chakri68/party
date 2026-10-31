import { type BlindRallyState, type TeamState } from "../shared/types.ts";
import { DEFAULT_VEHICLE, VEHICLE_IDS, type VehicleId } from "../shared/vehicles.ts";
import { count } from "./ballot.ts";
import { isEmpty } from "./teams.ts";

// Rally's car class (rally-spec.md). Free: each car has its own pick. Ballot:
// one vote per car and the whole grid drives the leader, counted live like
// the track's, so every Godot builds the right car when its player readies.

/** The class this car drives. Blind Rally has no choice: it is always the hatchback. */
export function vehicleOf(state: BlindRallyState, team: TeamState): VehicleId {
  if (state.variant !== "rally") return DEFAULT_VEHICLE;
  return state.settings.vehiclePick === "ballot" ? state.vehicleId : team.vehicle;
}

/**
 * After anything that might move the count: drops votes from cars that have
 * gone or emptied, recounts, and moves `vehicleId` to the leader. Returns
 * whether it moved. A move un-readies everyone in a car: each Godot has
 * already built the old class, and unlike a track, every player drives it.
 */
export function settleVehicle(state: BlindRallyState): boolean {
  if (state.phase !== "teams") return false;
  const ballot = state.vehicleBallot;
  const live = new Set(state.teams.filter((t) => !isEmpty(t)).map((t) => t.id));
  ballot.votes = ballot.votes.filter((v) => live.has(v.teamId));
  // Free pick (or Blind Rally): there is no ballot, so whatever was voted is void.
  if (state.variant !== "rally" || state.settings.vehiclePick !== "ballot") {
    ballot.votes = [];
    ballot.tied = [];
    return false;
  }
  const c = count(
    ballot.votes.map((v) => v.vehicleId),
    VEHICLE_IDS,
    `${state.seed}:vehicle`,
  );
  ballot.tied = c?.tied ?? [];
  if (!c || c.winner === state.vehicleId) return false;
  state.vehicleId = c.winner;
  const seated = new Set(state.teams.flatMap((t) => [t.driverId, t.navigatorId]));
  for (const p of state.players) if (seated.has(p.id)) p.ready = false;
  return true;
}
