import type { Presence } from "@games/protocol";
import { h, replaceChildren, type GameViewProps } from "@games/ui";
import { MAX_WARNINGS, type NmpPublicPlayer, type NmpPublicState } from "../shared/types.ts";
import { HAND_SVG, OVERTIME_SVG, SHIELD_SVG, icon } from "./cards.ts";

const PRESENCE_LABEL: Record<Presence, string> = {
  connected: "",
  reconnecting: "reconnecting",
  disconnected: "away",
  left: "left",
};

export interface SeatPick {
  /** Seats that can be picked now. */
  ids: Set<string>;
  /** The one picked so far, waiting on Confirm. */
  picked: string | null;
  /** "Give Overtime to", "Pass the Problem to": read before the name. */
  verb: string;
  onPick(id: string): void;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function tagFor(p: NmpPublicPlayer): string | null {
  if (p.fired) return "Fired";
  if (p.removed) return "Left";
  return null;
}

/** Warnings as three pips: filled is a warning. */
function pips(warnings: number): HTMLElement {
  return h(
    "span",
    { class: "nmp-pips", "aria-hidden": "true" },
    Array.from({ length: MAX_WARNINGS }, (_, i) => h("span", { class: i < warnings ? "on" : "" })),
  );
}

/** Every seat, in table order: name, warnings, cards, the Intern and Overtime signs. */
export function renderSeats(el: HTMLElement, props: GameViewProps, game: NmpPublicState, pick: SeatPick | null): void {
  const me = props.playerId;
  const live = game.step !== "finished";
  const owner = live ? (game.problem?.ownerId ?? null) : null;
  const turn = live ? game.turnPlayerId : null;
  const winners = new Set(game.winnerIds);
  replaceChildren(
    el,
    game.players.map((p) => {
      const seat = props.room.seats.find((s) => s.id === p.id);
      const name = p.id === me ? "You" : (seat?.name ?? "?");
      const away = !!seat && seat.presence !== "connected" && !p.removed && !p.fired;
      const tag = tagFor(p);
      const canPick = !!pick?.ids.has(p.id);
      const cls = [
        "nmp-seat",
        p.id === me && "me",
        p.id === turn && "turn",
        p.id === owner && "owner",
        tag && "out",
        away && "away",
        winners.has(p.id) && "winner",
        canPick && "pick",
        pick?.picked === p.id && "picked",
      ].filter(Boolean).join(" ");

      const label = [
        name,
        tag ?? plural(p.warnings, "warning"),
        tag ? "" : plural(p.handCount, "card"),
        p.shield ? "has an Intern" : "",
        p.overtime ? "has Overtime" : "",
        p.id === turn ? "playing now" : "",
        p.id === owner ? "holds the Problem" : "",
        away ? PRESENCE_LABEL[seat!.presence] : "",
      ].filter(Boolean).join(", ");

      const parts = [
        h(
          "span",
          { class: "nmp-seat-top" },
          h("span", { class: "nm", title: seat?.name ?? "" }, name),
          p.shield ? icon(SHIELD_SVG, "nmp-sign shield") : null,
          p.overtime ? icon(OVERTIME_SVG, "nmp-sign overtime") : null,
        ),
        h(
          "span",
          { class: "nmp-seat-bottom" },
          tag ? h("span", { class: "nmp-tag" }, tag) : [pips(p.warnings), h("span", { class: "nmp-count" }, icon(HAND_SVG, "nmp-sign"), String(p.handCount))],
          away ? h("span", { class: "nmp-away" }, PRESENCE_LABEL[seat!.presence]) : null,
        ),
      ];
      const attrs = { class: cls, role: "listitem", "data-player": p.id, "aria-current": p.id === turn ? "true" : null };
      if (canPick) {
        return h(
          "div",
          attrs,
          h(
            "button",
            {
              type: "button",
              class: "nmp-seat-body",
              "data-focus": `seat:${p.id}`,
              "aria-pressed": String(pick!.picked === p.id),
              "aria-label": `${pick!.verb} ${p.id === me ? "yourself" : (seat?.name ?? "?")}. ${label}`,
              onclick: () => pick!.onPick(p.id),
            },
            parts,
          ),
        );
      }
      return h("div", { ...attrs, "aria-label": label }, h("div", { class: "nmp-seat-body", "aria-hidden": "true" }, parts));
    }),
  );
}
