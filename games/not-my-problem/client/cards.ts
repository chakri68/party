import { h } from "@games/ui";
import { ACTION_TEXT, PROBLEM_TEXT, type CardText } from "../shared/cards.ts";
import type { ActionCard, ActionKind, ProblemKind } from "../shared/types.ts";

// One SVG icon per card kind and Problem kind, drawn as in the bold mockup
// (docs/superpowers/mockups/card-designs.html). Card words come from
// ACTION_TEXT / PROBLEM_TEXT only, so the screen says what the rules say.

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const ACTION_SVG: Record<ActionKind, string> = {
  // A wrench.
  "quick-fix": svg('<path d="M14.5 3.2a4.6 4.6 0 0 0-4.3 6.2L3.6 16a2.1 2.1 0 0 0 3 3l6.6-6.6a4.6 4.6 0 0 0 6.2-4.3l-3 1.2-2.6-2.6z"/>'),
  // A person, and an arrow pointing away from them.
  "blame-game": svg('<circle cx="17.5" cy="6.5" r="3"/><path d="M12.5 21c0-3.2 2.2-5.5 5-5.5s4.5 2.3 4.5 5.5M2.5 13h8.5M7.5 9.5 11 13l-3.5 3.5"/>'),
  // A raised hand: stop.
  "not-me": svg('<path d="M7 12.5V5.6a1.5 1.5 0 0 1 3 0V11M10 10.5V4a1.5 1.5 0 0 1 3 0v6.5M13 10.5V5.2a1.5 1.5 0 0 1 3 0v6.8M16 11a1.5 1.5 0 0 1 3 0v3.5a7 7 0 0 1-7 7 6.2 6.2 0 0 1-5.2-2.9L4.2 14a1.5 1.5 0 0 1 2.6-1.5L7 13"/>'),
  // An arrow that turns, aimed at someone else.
  revenge: svg('<path d="M20 7.5H9a5 5 0 0 0 0 10h3M16 3.5l4 4-4 4"/><circle cx="17.5" cy="17.5" r="2.5"/>'),
  // A loudspeaker.
  "hr-complaint": svg('<path d="M3 10v4h3.5l8.5 5.5V4.5L6.5 10z"/><path d="M18 9a4.2 4.2 0 0 1 0 6M20.5 6.5a7.8 7.8 0 0 1 0 11"/>'),
  // A report with a question mark.
  "fake-report": svg('<path d="M6 2.8h8.5l4 4V21.2H6z M14.5 2.8v4h4"/><path d="M10.3 11a2 2 0 1 1 3 1.7c-.7.4-1 .9-1 1.6M12.3 17.4v.2"/>'),
  // A stopwatch.
  overtime: svg('<circle cx="12" cy="13" r="8"/><path d="M12 8.5V13l3 2M9.5 2.5h5"/>'),
  // A person with a badge: the Intern.
  intern: svg('<circle cx="12" cy="7" r="3.8"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0M10 14.5h4l-.6 3h-2.8z"/>'),
  // An arrow up with a bar.
  promotion: svg('<path d="M12 19V5M6 11l6-6 6 6M6 21.5h12"/>'),
  // An eye.
  spy: svg('<path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
};

const PROBLEM_SVG: Record<ProblemKind, string> = {
  // Two server boxes, one with a cross.
  "server-down": svg('<rect x="3.5" y="3.5" width="17" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="17" height="7" rx="1.5"/><path d="M7 7h.01M7 17h.01M13 15l4 4M17 15l-4 4"/>'),
  // A drop.
  "data-leak": svg('<path d="M12 2.8s6.5 7.2 6.5 11.4a6.5 6.5 0 0 1-13 0C5.5 10 12 2.8 12 2.8z"/><path d="M9 15.5a3 3 0 0 0 3 2.5"/>'),
  // A speech bubble with "!".
  "angry-client": svg('<path d="M3.5 4.5h17v11.5H10l-5 4.5v-4.5H3.5z"/><path d="M12 7.5v4M12 13.8v.2"/>'),
};

/** Small icons for the seats: the Intern who takes a warning, Overtime, cards in hand. */
export const SHIELD_SVG = ACTION_SVG.intern;
export const OVERTIME_SVG = ACTION_SVG.overtime;
export const HAND_SVG = svg('<rect x="5" y="3" width="11" height="16" rx="2"/><path d="M19 7v13a1 1 0 0 1-1 1H9"/>');

export function icon(markup: string, cls = "nmp-icon"): HTMLElement {
  const el = h("span", { class: cls, "aria-hidden": "true" });
  el.innerHTML = markup;
  return el;
}

/** When a card can be played, as players read it. Text, not colour alone. */
export const TIMING_LABEL: Record<CardText["timing"], string> = {
  proactive: "Your turn",
  problem: "Your Problem",
  reaction: "Passed to you",
};

/** HR Complaint answers a pass, not a Problem passed to you. */
export function timingLabel(kind: ActionKind): string {
  return kind === "hr-complaint" ? "After a pass" : TIMING_LABEL[ACTION_TEXT[kind].timing];
}

/** When a card can be played, as one sentence for the detail sheet. */
export function playWhen(kind: ActionKind): string {
  if (kind === "hr-complaint") return "Play it right after someone passes a Problem.";
  switch (ACTION_TEXT[kind].timing) {
    case "proactive":
      return "Play it on your turn.";
    case "problem":
      return "Play it when you hold a Problem.";
    case "reaction":
      return "Play it when a Problem is passed to you.";
  }
}

export const cardName = (kind: ActionKind) => ACTION_TEXT[kind].name;
export const problemName = (kind: ProblemKind) => PROBLEM_TEXT[kind].name;

/** The art of an action card, for the hand and the detail sheet. */
export function actionIcon(kind: ActionKind): HTMLElement {
  return icon(ACTION_SVG[kind], "nmp-stamp");
}

export function problemIcon(kind: ProblemKind): HTMLElement {
  return icon(PROBLEM_SVG[kind], "nmp-stamp");
}

/** The colour of an action card: when it is played. Problems are always red. */
export type Timing = "fix" | "pass" | "reaction" | "turn";

export function timingClass(kind: ActionKind): Timing {
  switch (kind) {
    case "quick-fix":
    case "fake-report":
      return "fix";
    case "blame-game":
      return "pass";
    case "not-me":
    case "revenge":
    case "hr-complaint":
      return "reaction";
    case "overtime":
    case "intern":
    case "promotion":
    case "spy":
      return "turn";
  }
}

/** A bold face as plain data: its classes, its spoken label and its inside. No DOM, so it can be tested. */
export interface FaceSpec { cls: string; label: string; html: string }

/** An action card: the colour by when it is played, the icon, the name and the one line. */
export function actionFace(kind: ActionKind): FaceSpec {
  const { name, line } = ACTION_TEXT[kind];
  return {
    cls: `nmp-card t-${timingClass(kind)} k-${kind}`,
    label: `${name}. ${line}`,
    html: `<span class="nmp-ic" aria-hidden="true">${ACTION_SVG[kind]}</span><span class="nmp-card-name">${name}</span><span class="nmp-card-line">${line}</span>`,
  };
}

/** A Problem: red, its icon, and one dot for each warning it gives. The words come from the view. */
export function problemFace(kind: ProblemKind): { cls: string; icon: string; warn: string } {
  return {
    cls: `nmp-problem t-problem k-${kind}`,
    icon: PROBLEM_SVG[kind],
    warn: `<span class="nmp-warn" aria-hidden="true">${"<i></i>".repeat(PROBLEM_TEXT[kind].penalty)}</span>`,
  };
}

/** What a hand card shows now: its state classes, the tag on top, and its spoken label. */
export function handCardView(
  card: ActionCard,
  o: { now: boolean; anyPlayable: boolean; selected: boolean; canPickDown: boolean; picked: boolean },
): { classes: Record<"selected" | "playable" | "pick" | "picked" | "off", boolean>; tag: string; label: string } {
  const { name, line } = ACTION_TEXT[card.kind];
  return {
    classes: {
      selected: o.selected,
      playable: o.now,
      pick: o.canPickDown,
      picked: o.picked,
      // Greyed out: I must act now, and this card is not one of my choices.
      off: o.anyPlayable && !o.now && !o.canPickDown && !o.selected && !o.picked,
    },
    tag: o.canPickDown ? "Pick" : o.now ? "Play now" : timingLabel(card.kind),
    label: o.canPickDown ? `Put ${name} face down` : `${name}. ${line}${o.now ? " You can play it now." : ""}`,
  };
}

/** A hand card: a button with the bold face. The view adds the tag on top. */
export function handCard(card: ActionCard): HTMLButtonElement {
  const f = actionFace(card.kind);
  const btn = h("button", { type: "button", class: f.cls, "data-card": card.id });
  btn.innerHTML = f.html;
  return btn;
}

/** A card shown, not pressed: the face-down card to its owner, a card shown after a challenge. */
export function cardFace(kind: ActionKind, cls = ""): HTMLElement {
  const f = actionFace(kind);
  const el = h("div", { class: `${f.cls} nmp-face ${cls}`.trim(), role: "img", "aria-label": f.label });
  el.innerHTML = f.html;
  return el;
}
