import { h, replaceChildren } from "@games/ui";
import { teamColor, type TeamColorKey } from "../shared/teams.ts";
import type { THAction, THPublic } from "../shared/types.ts";
import { MAX_TEAMS } from "../shared/world.ts";

// The teams phase: a panel over the stage while Godot loads under it. Pick a
// team, make a new one, and the host moves people and starts. Solo is a team
// of one. The words come from the pure helpers up top (the tests drive
// those); the class only puts them in the DOM.

export interface Member {
  id: string;
  name: string;
  /** Their map has loaded. */
  ready: boolean;
  you: boolean;
}

export interface Row {
  id: number;
  color: TeamColorKey;
  /** "Orange". */
  name: string;
  /** "Circle": never colour alone. */
  shape: string;
  hex: string;
  mine: boolean;
  members: Member[];
}

type Game = Pick<THPublic, "phase" | "teams" | "players">;

/** Still here and on a team. */
const present = (game: Game) => game.players.filter((p) => !p.removed && p.teamId !== null);

/** One row per team, in team order. Names come from the room's seats. */
export function teamRows(game: Game, names: Record<string, string>, me: string): Row[] {
  const here = present(game);
  return game.teams.map((t) => {
    const c = teamColor(t.color);
    const members = here.filter((p) => p.teamId === t.id).map((p) => ({ id: p.id, name: names[p.id] ?? "Someone", ready: p.ready, you: p.id === me }));
    return { id: t.id, color: c.key, name: c.name, shape: c.shape[0]!.toUpperCase() + c.shape.slice(1), hex: c.hex, mine: members.some((m) => m.you), members };
  });
}

/** "Asha (you) · loading". */
export const memberText = (m: Member) => `${m.name}${m.you ? " (you)" : ""} · ${m.ready ? "ready" : "loading"}`;

/** The server's rule: one player with the map loaded. */
export function canStart(game: Game): boolean {
  return game.phase === "teams" && present(game).some((p) => p.ready);
}

/** The line under the host's Start, or null when everyone is ready (or it's not the teams phase). */
export function startNote(game: Game): string | null {
  if (game.phase !== "teams") return null;
  if (!canStart(game)) return "Waiting for the map to load.";
  return present(game).some((p) => !p.ready) ? "Players still loading will watch this round." : null;
}

type TeamAct = Extract<THAction, { type: "team.join" | "team.new" | "team.assign" | "start" }>;

export class TeamsPanel {
  readonly el = h("section", { class: "th-teams", "aria-label": "Teams", hidden: true });
  private act: (a: TeamAct) => void;

  constructor(act: (a: TeamAct) => void) {
    this.act = act;
  }

  update(game: Game, names: Record<string, string>, me: string, isHost: boolean) {
    this.el.hidden = game.phase !== "teams";
    if (this.el.hidden) return;
    const rows = teamRows(game, names, me);

    // The host's one control for anyone: a team picker by their name.
    const mover = (m: Member, teamId: number) => {
      if (!isHost) return null;
      const select = h(
        "select",
        { class: "th-move", "aria-label": `Move ${m.name}` },
        rows.map((r) => h("option", { value: String(r.id) }, r.name)),
      );
      select.value = String(teamId);
      select.addEventListener("change", () => this.act({ type: "team.assign", playerId: m.id, teamId: Number(select.value) }));
      return select;
    };

    const row = (r: Row) =>
      h(
        "li",
        { class: `th-team${r.mine ? " mine" : ""}`, style: `--th-team: ${r.hex}` },
        h(
          "div",
          { class: "th-team-head" },
          h("span", { class: "th-swatch", "aria-hidden": "true" }),
          h("span", { class: "th-team-name" }, r.name),
          h("span", { class: "th-team-shape" }, r.shape),
          r.mine ? null : h("button", { type: "button", class: "th-join", onclick: () => this.act({ type: "team.join", teamId: r.id }) }, "Join"),
        ),
        h(
          "ul",
          { class: "th-members" },
          r.members.map((m) => h("li", { class: `th-member${m.ready ? " ready" : ""}` }, h("span", { class: "th-member-text" }, memberText(m)), mover(m, r.id))),
        ),
      );

    const note = isHost ? startNote(game) : null;
    replaceChildren(
      this.el,
      h("h2", { class: "th-teams-title" }, "Teams"),
      h("ul", { class: "th-team-list" }, rows.map(row)),
      h("button", { type: "button", class: "th-new", disabled: game.teams.length >= MAX_TEAMS, onclick: () => this.act({ type: "team.new" }) }, "New team"),
      isHost
        ? h(
            "div",
            { class: "th-start-row" },
            h("button", { type: "button", class: "primary th-start", disabled: !canStart(game), onclick: () => this.act({ type: "start" }) }, "Start"),
            note ? h("p", { class: "th-start-note" }, note) : null,
          )
        : h("p", { class: "th-start-note" }, "The host will start the game."),
    );
  }
}
