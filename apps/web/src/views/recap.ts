// The end of the night: what everyone sees once the host ends the party, and
// what a link to a closed room shows. The host app fills the slot underneath.

import type { Recap } from "@games/game-core";
import { h } from "@games/ui";
import { icon } from "../brand.ts";

/** "Sam", "Sam and Mei", "Sam, Mei and Arjun". */
export function joinNames(names: string[]): string {
  if (names.length < 2) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function durationText(minutes: number): string {
  if (minutes < 1) return "Less than 1 min";
  if (minutes < 60) return `${minutes} min`;
  const hr = Math.floor(minutes / 60);
  const min = minutes % 60;
  return min ? `${hr} hr ${min} min` : `${hr} hr`;
}

/** "6 games · 1 hr 20 min · Most played: Cheat". */
export function recapMeta(recap: Recap, gameName: (id: string) => string): string {
  const parts = [recap.gamesPlayed === 1 ? "1 game" : `${recap.gamesPlayed} games`, durationText(recap.minutes)];
  if (recap.topGameId) parts.push(`Most played: ${gameName(recap.topGameId)}`);
  return parts.join(" · ");
}

/** One paragraph for the group chat. */
export function recapShareText(recap: Recap, appTitle: string, site: string): string {
  const body = recap.awards.length
    ? recap.awards.map((a) => `${a.title}: ${joinNames(a.who)}.`).join(" ")
    : `${recap.gamesPlayed === 1 ? "1 game" : `${recap.gamesPlayed} games`} tonight.`;
  return `${appTitle} recap: ${body} Play at ${site}`;
}

/** Called with the slot under the recap or the closed message. Absent: a Home button. */
export type PartyOverHook = (outlet: HTMLElement, ctx: { isHost: boolean; recap: Recap | null }) => void;

function outlet(hook: PartyOverHook | undefined, isHost: boolean, recap: Recap | null, home: () => void): HTMLElement {
  const slot = h("div", { class: "party-over" });
  if (hook) hook(slot, { isHost, recap });
  else slot.append(h("button", { type: "button", onclick: home }, "Home"));
  return slot;
}

function shareButton(text: string): HTMLElement {
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
  const canShare = !!nav.share && matchMedia("(pointer: coarse)").matches;
  const label = canShare ? "Share" : "Copy recap";
  const btn = h("button", { type: "button", class: "primary" }, label);
  btn.addEventListener("click", async () => {
    try {
      if (canShare) await nav.share!({ text });
      else {
        await navigator.clipboard.writeText(text);
        btn.replaceChildren(icon("check"), "Copied");
        setTimeout(() => (btn.textContent = label), 1500);
      }
    } catch {
      // Share sheet dismissed, or clipboard blocked: the recap is on screen anyway.
    }
  });
  return btn;
}

export interface RecapViewOptions {
  recap: Recap;
  isHost: boolean;
  appTitle: string;
  gameName: (id: string) => string;
  partyOver?: PartyOverHook;
  home: () => void;
}

export function recapView(o: RecapViewOptions): HTMLElement {
  const { recap } = o;
  return h(
    "section",
    { class: "recap" },
    h("h2", {}, "Tonight's recap"),
    h("p", { class: "muted recap-meta" }, recapMeta(recap, o.gameName)),
    recap.awards.length
      ? h(
          "ol",
          { class: "awards" },
          recap.awards.map((a, i) =>
            h(
              "li",
              { class: "award", style: `--i: ${i}` },
              h("span", { class: "award-title" }, a.title),
              h("strong", { class: "award-who" }, joinNames(a.who)),
              h("span", { class: "muted" }, a.line),
            ),
          ),
        )
      : h("p", { class: "recap-quiet" }, recap.quiet ?? ""),
    h("div", { class: "actions" }, shareButton(recapShareText(recap, o.appTitle, location.host))),
    outlet(o.partyOver, o.isHost, recap, o.home),
  );
}

/** A room that's gone, or a party that ended before any game finished. */
export function closedView(message: string, isHost: boolean, partyOver: PartyOverHook | undefined, home: () => void): HTMLElement {
  return h("section", { class: "message closed" }, h("p", {}, message), outlet(partyOver, isHost, null, home));
}
