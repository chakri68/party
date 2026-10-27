import type { RoomPublicState } from "@games/protocol";
import type { GameClientApi } from "@games/ui";
import { teamColor, type BlindRallyEvent, type BlindRallyPrivateState, type BlindRallyPublicState, type PublicTeam, type TeamColorKey } from "../shared/types.ts";

// The contract between view.ts and the two lazily loaded seats. view.ts only
// knows this file's types; driver/ and navigator/ are separate chunks, so a
// Driver never downloads the Godot glue or anything track-shaped (map §3.5).

export interface RoleProps {
  room: RoomPublicState;
  game: BlindRallyPublicState;
  private: Exclude<BlindRallyPrivateState, { role: null }>;
  playerId: string;
  events: BlindRallyEvent[];
}

export interface RoleView {
  mount(container: HTMLElement): void;
  update(props: RoleProps): void;
  /** A relay from the server, already addressed to us. */
  stream(from: string, data: unknown): void;
  rejected(message: string): void;
  destroy(): void;
}

export type RoleViewFactory = (api: GameClientApi) => RoleView;

/** Race clock: time since the start, the same for everyone. */
export const raceElapsed = (game: BlindRallyPublicState, now: number) =>
  game.startsAt === null ? 0 : Math.max(0, Math.min(game.endedAt ?? now, game.endsAt ?? now) - game.startsAt);

/**
 * One team's clock, the way the server will score it: elapsed, minus any
 * drop-out pause (frozen while it's running), plus penalties. Final once
 * they've finished.
 */
export function teamClock(game: BlindRallyPublicState, team: PublicTeam | undefined, now: number): number {
  if (!team) return raceElapsed(game, now);
  if (team.timeMs !== null) return team.timeMs;
  const end = Math.min(game.endedAt ?? now, game.endsAt ?? now);
  const pausing = team.pausedSince !== null && game.startsAt !== null ? Math.max(0, end - Math.max(team.pausedSince, game.startsAt)) : 0;
  return Math.max(0, raceElapsed(game, now) - team.pausedMs - pausing) + team.penaltyMs;
}

/** "Sam dropped out: 23 s to get back. Clock stopped." for whichever teammate's gone, or null. */
export function awayBanner(team: PublicTeam | undefined, nameOf: (role: "driver" | "navigator") => string, now: number): string | null {
  if (!team || !team.away.length || team.status !== "running") return null;
  // A Rally car of one is away from both seats: that's one person, said once.
  const who = [...new Set(team.away.map(nameOf))].join(" and ");
  const left = team.graceEndsAt === null ? 0 : Math.max(0, Math.ceil((team.graceEndsAt - now) / 1000));
  return `${who} dropped out: ${left} s to get back. Clock stopped.`;
}

const SHAPES = {
  circle: '<circle cx="8" cy="8" r="6"/>',
  square: '<rect x="2.5" y="2.5" width="11" height="11" rx="1"/>',
  triangle: '<path d="M8 1.8 14.6 13.8H1.4z"/>',
  diamond: '<path d="M8 1 15 8 8 15 1 8z"/>',
};

/**
 * "▲ Team 3" in the team's colour: shape, number and colour together, so
 * nobody has to tell green from orange to find their car (spec §7.4, §10).
 * Rally's cars of one say "Car 3".
 */
export function teamBadge(team: { id: number; color: TeamColorKey }, word: "Team" | "Car" = "Team"): HTMLElement {
  const c = teamColor(team.color);
  const el = document.createElement("span");
  el.className = "br-badge";
  el.style.setProperty("--br-team", c.hex);
  el.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${SHAPES[c.shape]}</svg>`;
  el.append(`${word} ${team.id}`);
  el.title = `${c.name} ${word.toLowerCase()}`;
  return el;
}
