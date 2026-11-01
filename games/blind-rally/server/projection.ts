import {
  CAMERA_MODES,
  CLOUDS,
  effectiveAssists,
  teamColor,
  type BlindRallyPrivateState,
  type BlindRallyPublicState,
  type BlindRallyState,
  type CameraMode,
  effectiveTrackPick,
} from "../shared/types.ts";
import { skyPlan, skyWords } from "../shared/sky.ts";
import { trackCatalog, trackData } from "./geometry.ts";
import { effectiveTime, pinView } from "./race.ts";
import { vehicleOf } from "./vehicles.ts";
import { captainOf, isSolo, seatOf, startBlocker } from "./teams.ts";

// Three audiences (spec §8.2, map §2). Public and Driver DTOs are built from
// an allow-list of fields, never by spreading state, so nothing new on the
// server leaks by default. test/projection.test.ts walks both for a deny-list.

export function publicState(state: BlindRallyState): BlindRallyPublicState {
  return {
    phase: state.phase,
    mode: state.settings.mode,
    stageMode: state.settings.stageMode,
    trackId: state.trackId,
    skyWords: skyWords(skyPlan(state.settings.time, state.seed, trackData(state.trackId))),
    trackPick: effectiveTrackPick(state.settings),
    // Names, difficulty, length, par and a landmark count: the lobby's cards. No geometry (spec §4.1).
    tracks: trackCatalog(),
    ballot: effectiveTrackPick(state.settings) === "ballot" ? ballotView(state) : null,
    vehiclePick: state.settings.vehiclePick,
    vehicleBallot: state.settings.vehiclePick === "ballot" ? vehicleBallotView(state) : null,
    timeLimitMs: state.settings.timeLimit * 60_000,
    teams: state.teams.map((t) => ({
      id: t.id,
      driverId: t.driverId,
      navigatorId: t.navigatorId,
      captainId: captainOf(t),
      color: t.color,
      status: t.run?.status ?? null,
      resets: t.run?.resets ?? 0,
      penaltyMs: t.run?.penaltyMs ?? 0,
      pausedMs: t.run?.pausedMs ?? 0,
      pausedSince: t.run?.pausedSince ?? null,
      away: t.run ? [...t.run.away] : [],
      graceEndsAt: t.run?.graceEndsAt ?? null,
      // Checkpoints stay server-side until the results: a Driver mustn't count gates (spec §4.1).
      timeMs: t.run?.status === "finished" ? effectiveTime(state, t.run, t.run.finishedAt!) : null,
      vehicle: vehicleOf(state, t),
    })),
    players: state.players.map((p) => ({ id: p.id, ready: p.ready })),
    startsAt: state.startsAt,
    endsAt: state.endsAt,
    endedAt: state.endedAt,
    startBlocker: state.phase === "teams" ? startBlocker(state) : null,
  };
}

/** The fair ballot as everyone sees it: who voted for what, and whether a coin settled it. */
function ballotView(state: BlindRallyState): BlindRallyPublicState["ballot"] {
  const b = state.ballots.find((x) => x.target === "all");
  return { votes: (b?.votes ?? []).map((v) => ({ teamId: v.teamId, trackId: v.trackId })), tied: [...(b?.tied ?? [])] };
}

/** Who voted for which class, and whether a coin settled it. */
function vehicleBallotView(state: BlindRallyState): BlindRallyPublicState["vehicleBallot"] {
  const b = state.vehicleBallot;
  return { votes: b.votes.map((v) => ({ teamId: v.teamId, vehicleId: v.vehicleId })), tied: [...b.tied] };
}

export function privateState(state: BlindRallyState, playerId: string): BlindRallyPrivateState {
  const seat = seatOf(state, playerId);
  if (!seat) return { role: null };
  const { team, role } = seat;
  // lastSeq lets a reloaded Driver page carry on counting where the server is.
  // A Rally car of one has the Navigator's screen: it's the one with the road in it.
  if (role === "driver" && !isSolo(team)) return { role, teamId: team.id, lastSeq: team.run?.lastSeq ?? 0 };
  const policy = state.settings.camera;
  const allowedCameras: CameraMode[] = policy === "free" ? [...CAMERA_MODES] : [policy];
  // Rally starts behind the car, like a racing game; Blind Rally from above, like a map.
  const camera = state.variant === "rally" && allowedCameras.includes("chase") ? "chase" : allowedCameras[0]!;
  return {
    role: "navigator",
    teamId: team.id,
    session: {
      trackId: state.trackId,
      seed: state.seed,
      sky: skyPlan(state.settings.time, state.seed, trackData(state.trackId)),
      clouds: CLOUDS[state.settings.weather],
      camera,
      allowedCameras,
      teamNumber: team.id,
      teamColor: teamColor(team.color).hex,
      teamShape: teamColor(team.color).shape,
      vehicle: vehicleOf(state, team),
      ghosts: state.settings.stageMode === "shared",
      // Field by field, the same three a ghost relay carries (race.ts ghostOf).
      rivals:
        state.settings.stageMode === "shared"
          ? state.teams.filter((t) => t.id !== team.id && t.navigatorId).map((t) => ({ teamId: t.id, color: teamColor(t.color).hex, vehicle: vehicleOf(state, t) }))
          : [],
      assists: effectiveAssists(state.settings),
    },
    run: {
      checkpoints: team.run?.cp ?? 0,
      checkpointCount: trackData(state.trackId).checkpoints.length,
      holdUntil: team.run?.holdUntil ?? 0,
      pins: pinView(team.run?.pins),
    },
  };
}
