import { MAX_TEAMS, type BlindRallyAction, type Role } from "../shared/types.ts";

const isRole = (v: unknown): v is Role => v === "driver" || v === "navigator";
/** Shape only: whether the track exists is the game's call, against the track file. */
const trackIdOk = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9_]{1,40}$/.test(v);
const coord = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e5;
const isTeamId = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= MAX_TEAMS;

/** Untrusted game-action payload → a clean action, or null ("bad-action"). */
export function parseAction(input: unknown): BlindRallyAction | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const a = input as Record<string, unknown>;
  switch (a.type) {
    case "team.join":
      return isTeamId(a.teamId) && isRole(a.role) ? { type: "team.join", teamId: a.teamId, role: a.role } : null;
    case "role.pick":
      return isRole(a.role) ? { type: "role.pick", role: a.role } : null;
    case "team.assign": {
      if (typeof a.playerId !== "string" || a.playerId.length > 64) return null;
      if (a.teamId === null) return { type: "team.assign", playerId: a.playerId, teamId: null };
      if (!isTeamId(a.teamId) || (a.role !== undefined && !isRole(a.role))) return null;
      return { type: "team.assign", playerId: a.playerId, teamId: a.teamId, ...(a.role !== undefined && { role: a.role as Role }) };
    }
    case "player.ready":
      return typeof a.ready === "boolean" ? { type: "player.ready", ready: a.ready } : null;
    case "race.event":
      if (a.kind === "finish") return { type: "race.event", kind: "finish" };
      // Godot counts gates 1..n; nobody builds a track with a thousand.
      if (a.kind === "cp" && Number.isInteger(a.checkpointId) && (a.checkpointId as number) >= 1 && (a.checkpointId as number) <= 999) {
        return { type: "race.event", kind: "cp", checkpointId: a.checkpointId as number };
      }
      return null;
    case "map.guess":
      if (a.clear === true) return { type: "map.guess", clear: true };
      // World metres; whether it's on the map is the game's call, against the track.
      return coord(a.x) && coord(a.z) ? { type: "map.guess", x: Math.round(a.x * 10) / 10, z: Math.round(a.z * 10) / 10 } : null;
    case "race.reset":
      return a.reason === "fell" ? { type: "race.reset", reason: "fell" } : { type: "race.reset" };
    case "track.pick":
      return trackIdOk(a.trackId) ? { type: "track.pick", trackId: a.trackId } : null;
    case "track.vote":
      if (a.trackId === null) return { type: "track.vote", trackId: null };
      return trackIdOk(a.trackId) ? { type: "track.vote", trackId: a.trackId } : null;
    case "team.leave":
    case "race.start":
    case "race.end":
      return { type: a.type };
    default:
      return null;
  }
}
