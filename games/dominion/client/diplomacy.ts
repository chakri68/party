// Diplomacy: everyone you've met, where you stand, and what you can do about
// it. Answers to offers work out of turn; everything else waits for yours.

import { h } from "@games/ui";
import { EMBASSY_COST } from "../shared/content.ts";
import type { DiplomacyView, DominionAction, DominionPrivateState } from "../shared/types.ts";

type Intent = DominionAction extends infer A ? (A extends { turn: number } ? Omit<A, "turn"> : A) : never;

export interface DiplomacyOptions {
  view: DominionPrivateState;
  round: number;
  who(id: string): { name: string; color: string };
  act(intent: Intent, what: string): void;
  onClose(): void;
}

const RELATION: Record<DiplomacyView["relation"], string> = {
  war: "At war",
  peace: "At peace",
  notice: "Peace broken",
};

export function diplomacyScreen({ view, round, who, act, onClose }: DiplomacyOptions): HTMLElement {
  const hasTech = view.techs.includes("diplomacy");
  let armedBreak: string | null = null;

  const list = h("ul", { class: "dm-dip-list" });
  const render = () => {
    list.replaceChildren(
      ...(view.diplomacy.length
        ? view.diplomacy.map((d) => row(d))
        : [h("li", { class: "dm-dip-empty" }, "You haven't met anyone yet. Explore; empires meet when they see each other.")]),
    );
  };

  const row = (d: DiplomacyView) => {
    const them = who(d.id);
    const actions: HTMLElement[] = [];
    if (d.offerFromThem) {
      actions.push(
        h("button", { type: "button", class: "dm-btn primary", onclick: () => act({ type: "answer-peace", from: d.id, accept: true }, "accept peace") }, "Accept peace"),
        h("button", { type: "button", class: "dm-btn", onclick: () => act({ type: "answer-peace", from: d.id, accept: false }, "decline") }, "Decline"),
      );
    } else if (d.relation === "war") {
      actions.push(
        h(
          "button",
          {
            type: "button",
            class: "dm-btn",
            disabled: !view.myTurn || !hasTech || d.offerFromMe,
            title: !hasTech ? "Research Diplomacy first" : d.offerFromMe ? "Waiting for their answer" : "",
            onclick: () => act({ type: "offer-peace", to: d.id }, "offer peace"),
          },
          d.offerFromMe ? "Offer sent" : "Offer peace",
        ),
      );
    } else if (d.relation === "peace") {
      const armed = armedBreak === d.id;
      actions.push(
        h(
          "button",
          {
            type: "button",
            class: `dm-btn${armed ? " dm-danger" : ""}`,
            disabled: !view.myTurn,
            onclick: () => {
              // Always two taps: this one can't be taken back.
              if (!armed) {
                armedBreak = d.id;
                render();
                return;
              }
              act({ type: "break-peace", with: d.id }, "break peace");
            },
          },
          armed ? "Tap again: break peace" : "Break peace",
        ),
      );
    }
    if (!d.embassy) {
      actions.push(
        h(
          "button",
          {
            type: "button",
            class: "dm-btn dm-buy",
            disabled: !view.myTurn || !hasTech || view.credits < EMBASSY_COST,
            title: !hasTech ? "Research Diplomacy first" : "",
            onclick: () => act({ type: "embassy", with: d.id }, "embassy"),
          },
          "Build embassy",
          h("span", { class: "dm-cost" }, `${EMBASSY_COST}¢ · +1¢ a turn while at peace, and a view of their capital`),
        ),
      );
    }
    const detail =
      d.relation === "peace" && d.peaceSince !== null
        ? `Since round ${d.peaceSince} (${round - d.peaceSince} rounds)`
        : d.relation === "notice"
          ? d.brokenBy === view.me
            ? "You broke it. Hostilities open at the start of your next turn."
            : "They broke it. Hostilities open at the start of their next turn."
          : d.offerFromThem
            ? "They're offering peace."
            : "";
    return h(
      "li",
      { class: `dm-dip-row ${d.relation}`, style: `--c:${them.color}` },
      h(
        "div",
        { class: "dm-dip-who" },
        h("strong", {}, them.name),
        h("span", { class: `dm-dip-rel ${d.relation}` }, RELATION[d.relation]),
        d.embassy ? h("span", { class: "dm-dip-rel" }, "Embassy") : null,
        detail ? h("p", { class: "dm-muted" }, detail) : null,
      ),
      h("div", { class: "dm-actions" }, actions),
    );
  };

  render();
  const close = h("button", { type: "button", class: "dm-ts-close", "aria-label": "Close diplomacy", onclick: onClose }, "×");
  const root = h(
    "div",
    { class: "dm-dip", role: "dialog", "aria-modal": "true", "aria-label": "Diplomacy" },
    h(
      "div",
      { class: "dm-dip-card dm-plate" },
      h("header", { class: "dm-dip-head" }, h("h2", {}, "Diplomacy"), close),
      !hasTech ? h("p", { class: "dm-muted" }, "Diplomacy (after Strategy) lets you offer peace, open embassies and train infiltrators. You can still answer offers.") : null,
      list,
    ),
  );
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  });
  root.addEventListener("click", (e) => e.target === root && onClose());
  requestAnimationFrame(() => close.focus());
  return root;
}
