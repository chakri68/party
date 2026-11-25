import { h } from "@games/ui";
import { ACTION_TEXT, PROBLEM_TEXT, type CardText } from "../shared/cards.ts";
import type { ActionCard, ActionKind, ProblemKind } from "../shared/types.ts";

// One simple stamp-style SVG per card kind and Problem kind. Card words come
// from ACTION_TEXT / PROBLEM_TEXT only, so the screen says what the rules say.

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ACTION_SVG: Record<ActionKind, string> = {
  // A wrench.
  "quick-fix": svg('<path d="M14.5 5.5a4 4 0 0 0 4.9 4.9l-8.6 8.6a2 2 0 0 1-2.8-2.8l8.6-8.6"/><path d="M14.5 5.5 17 3l1 3 3 1-2.5 2.5"/>'),
  // A finger pointing away.
  "blame-game": svg('<path d="M3 12h12"/><path d="m11 7 5 5-5 5"/><circle cx="20" cy="12" r="1.5"/>'),
  // A "no" sign.
  "not-me": svg('<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>'),
  // An arrow that turns around.
  revenge: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  // A form with a mark on it.
  "hr-complaint": svg('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M12 7v6"/><path d="M12 16.5v.5"/>'),
  // A report with a question.
  "fake-report": svg('<path d="M6 3h9l4 4v14H6z"/><path d="M10 11a2.5 2.5 0 1 1 3 2.4V15"/><path d="M13 18v.5"/>'),
  // A clock with a plus.
  overtime: svg('<circle cx="11" cy="13" r="8"/><path d="M11 9v4l3 2"/><path d="M19 2v5"/><path d="M16.5 4.5h5"/>'),
  // A person with a badge: the Intern.
  intern: svg('<circle cx="12" cy="7" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/><path d="M12 14v4"/>'),
  // An arrow up with a bar.
  promotion: svg('<path d="M12 20V6"/><path d="m6 11 6-6 6 6"/><path d="M6 21h12"/>'),
  // An eye.
  spy: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
};

const PROBLEM_SVG: Record<ProblemKind, string> = {
  // A server box with a cross.
  "server-down": svg('<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.5"/><path d="m14 14.5 3 3"/><path d="m17 14.5-3 3"/>'),
  // An open folder with drops falling out.
  "data-leak": svg('<path d="M3 6h6l2 2h10v8H3z"/><path d="M8 19v1"/><path d="M12 19v2"/><path d="M16 19v1"/>'),
  // A cross face.
  "angry-client": svg('<circle cx="12" cy="12" r="9"/><path d="m7.5 8.5 3 1.5"/><path d="m16.5 8.5-3 1.5"/><path d="M8.5 16.5a4.5 4.5 0 0 1 7 0"/>'),
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

/** A hand card: a button with the stamp, the name and the one line. */
export function handCard(card: ActionCard): HTMLButtonElement {
  const text = ACTION_TEXT[card.kind];
  return h(
    "button",
    { type: "button", class: `nmp-card k-${card.kind}`, "data-card": card.id },
    actionIcon(card.kind),
    h("span", { class: "nmp-card-name" }, text.name),
    h("span", { class: "nmp-card-line" }, text.line),
  );
}
