import type { RoomPublicState } from "@games/protocol";
import type { GameClientApi } from "@games/ui";
import { teamColor, type BlindRallyEvent, type BlindRallyPrivateState, type BlindRallyPublicState, type TeamColorKey } from "../shared/types.ts";

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

/** Fonts from ui_theme.md, loaded once: the pixel face must never flash a fallback. */
export function loadFonts(): void {
  if (document.querySelector("link[data-blind-rally-fonts]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Press+Start+2P&display=block";
  link.dataset.blindRallyFonts = "";
  document.head.append(link);
}

/** Team clock: time since the start, plus penalties. */
export const raceElapsed = (game: BlindRallyPublicState, now: number) =>
  game.startsAt === null ? 0 : Math.max(0, Math.min(game.endedAt ?? now, game.endsAt ?? now) - game.startsAt);

const SHAPES = {
  circle: '<circle cx="8" cy="8" r="6"/>',
  square: '<rect x="2.5" y="2.5" width="11" height="11" rx="1"/>',
  triangle: '<path d="M8 1.8 14.6 13.8H1.4z"/>',
  diamond: '<path d="M8 1 15 8 8 15 1 8z"/>',
};

/**
 * "▲ Team 3" in the team's colour: shape, number and colour together, so
 * nobody has to tell green from orange to find their car (spec §7.4, §10).
 */
export function teamBadge(team: { id: number; color: TeamColorKey }): HTMLElement {
  const c = teamColor(team.color);
  const el = document.createElement("span");
  el.className = "br-badge";
  el.style.setProperty("--br-team", c.hex);
  el.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${SHAPES[c.shape]}</svg>`;
  el.append(`Team ${team.id}`);
  el.title = `${c.name} team`;
  return el;
}
