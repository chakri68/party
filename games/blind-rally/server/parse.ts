import { MAX_TEAMS, type BlindRallyAction, type Role } from "../shared/types.ts";

const isRole = (v: unknown): v is Role => v === "driver" || v === "navigator";
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
    case "race.reset":
      return a.reason === "fell" ? { type: "race.reset", reason: "fell" } : { type: "race.reset" };
    case "team.leave":
    case "race.start":
    case "race.end":
      return { type: a.type };
    default:
      return null;
  }
}
