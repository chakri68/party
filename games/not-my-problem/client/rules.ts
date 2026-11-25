import { h } from "@games/ui";
import { ACTION_TEXT, PROBLEM_TEXT } from "../shared/cards.ts";
import { notMyProblemQuickRules } from "../shared/rules-text.ts";
import { ACTION_KINDS, PROBLEM_KINDS, type ActionKind } from "../shared/types.ts";
import { actionIcon, problemIcon, timingLabel } from "./cards.ts";

// The Rules sheet: the quick rules, then every card in groups. All words come
// from the shared rules text and card tables, so it says what the server does.

const kinds = (timing: (typeof ACTION_TEXT)[ActionKind]["timing"]) => ACTION_KINDS.filter((k) => ACTION_TEXT[k].timing === timing);

/** The card groups, in the order a player meets them. */
export const RULE_GROUPS: { title: string; kinds: ActionKind[] }[] = [
  { title: "When you hold a Problem", kinds: kinds("problem") },
  { title: "Reactions", kinds: kinds("reaction") },
  { title: "Your turn", kinds: kinds("proactive") },
];

const row = (icon: HTMLElement, name: string, line: string, when?: string) =>
  h(
    "li",
    { class: "nmp-rule-card" },
    icon,
    h("span", { class: "nmp-rule-text" }, h("strong", {}, name), when ? h("span", { class: "nmp-label" }, when) : null, h("span", {}, line)),
  );

export interface RulesSheet {
  el: HTMLDialogElement;
  open(): void;
  close(): void;
}

export function rulesSheet(onClose: () => void): RulesSheet {
  const el = h("dialog", { class: "nmp-rules", "aria-labelledby": "nmp-rules-title" });
  const close = () => {
    if (el.open) el.close();
  };
  // The sheet's padding is on this inner box, so a tap on the dialog itself is the dim area.
  el.append(
    h(
      "div",
      { class: "nmp-rules-body" },
      h(
        "div",
        { class: "nmp-rules-head" },
        h("h2", { id: "nmp-rules-title" }, "How to play"),
        h("button", { type: "button", class: "link", onclick: close }, "Close"),
      ),
      h("ul", { class: "nmp-rules-list" }, notMyProblemQuickRules.map((t) => h("li", {}, t))),
      h("h3", {}, "Problem cards"),
      h("ul", { class: "nmp-rule-cards" }, PROBLEM_KINDS.map((k) => row(problemIcon(k), PROBLEM_TEXT[k].name, PROBLEM_TEXT[k].line))),
      RULE_GROUPS.flatMap((g) => [
        h("h3", {}, g.title),
        h(
          "ul",
          { class: "nmp-rule-cards" },
          g.kinds.map((k) => row(actionIcon(k), ACTION_TEXT[k].name, ACTION_TEXT[k].line, g.title === "Reactions" ? timingLabel(k) : undefined)),
        ),
      ]),
    ),
  );
  el.addEventListener("close", onClose);
  // A tap on the dim area around the sheet closes it.
  el.addEventListener("click", (e) => {
    if (e.target === el) close();
  });
  return {
    el,
    open: () => {
      if (!el.open) el.showModal();
    },
    close,
  };
}
