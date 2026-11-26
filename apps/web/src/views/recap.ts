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

/** "Loudest moment: 5 people talking at once, in Overheat." */
export function momentText(moment: NonNullable<Recap["moment"]>, gameName: (id: string) => string): string {
  const where = moment.gameId ? gameName(moment.gameId) : "the lobby";
  return `Loudest moment: ${moment.count} people talking at once, in ${where}.`;
}

/** One paragraph for the group chat: the main awards, the table ones, then the moment. */
export function recapShareText(recap: Recap, appTitle: string, site: string, gameName: (id: string) => string): string {
  const all = [...recap.awards, ...recap.table];
  const parts = all.length
    ? all.map((a) => `${a.title}: ${joinNames(a.who)}.`)
    : [`${recap.gamesPlayed === 1 ? "1 game" : `${recap.gamesPlayed} games`} tonight.`];
  if (recap.moment) parts.push(momentText(recap.moment, gameName));
  return `${appTitle} recap: ${parts.join(" ")} Play at ${site}`;
}

/** Called with the slot under the recap or the closed message. Absent: a Home button. */
export type PartyOverHook = (outlet: HTMLElement, ctx: { isHost: boolean; recap: Recap | null }) => void;

function outlet(hook: PartyOverHook | undefined, isHost: boolean, recap: Recap | null, home: () => void): HTMLElement {
  const slot = h("div", { class: "party-over" });
  if (hook) hook(slot, { isHost, recap });
  else slot.append(h("button", { type: "button", onclick: home }, "Home"));
  return slot;
}

export type ShareMode = "files" | "text" | "copy-image" | "copy-text";

/**
 * How the button shares. The share sheet is for phones (coarse pointer); a
 * desktop always copies, the picture too when the browser can.
 */
export function shareMode(env: { canShareFiles: boolean; hasShare: boolean; coarse: boolean; hasClipboardItem: boolean }): ShareMode {
  if (env.coarse && env.hasShare) return env.canShareFiles ? "files" : "text";
  return env.hasClipboardItem ? "copy-image" : "copy-text";
}

export function shareButton(recap: Recap, o: RecapViewOptions): HTMLElement {
  const text = recapShareText(recap, o.appTitle, location.host, o.gameName);
  const nav: { share?: (d: ShareData) => Promise<void> } = navigator;
  const coarse = matchMedia("(pointer: coarse)").matches;
  const label = nav.share && coarse ? "Share" : "Copy recap";
  // Plain, not primary: the slot below holds the next step, which matters more.
  const btn = h("button", { type: "button" }, label);
  // Drawn in the background from the start, so a click never has to wait:
  // Safari drops the tap if we await before sharing or copying.
  let file: File | null = null;
  let failed = false;
  const png: Promise<Blob> = import("./recap-image.ts")
    .then((m) => m.recapImage(recap, { appTitle: o.appTitle, gameName: o.gameName, site: location.host }))
    .then((b) => {
      file = new File([b], "recap.png", { type: "image/png" });
      return b;
    });
  png.catch(() => (failed = true));
  const copied = () => {
    btn.replaceChildren(icon("check"), "Copied");
    setTimeout(() => (btn.textContent = label), 1500);
  };
  const copyText = () => navigator.clipboard.writeText(text).then(copied, () => {});
  btn.addEventListener("click", () => {
    const readyFile = file;
    const hasClipboardItem = typeof ClipboardItem !== "undefined" && !!navigator.clipboard?.write && !failed;
    const mode = shareMode({
      canShareFiles: !!readyFile && !!navigator.canShare?.({ files: [readyFile] }),
      hasShare: !!nav.share,
      coarse,
      hasClipboardItem,
    });
    // Everything below starts the share or copy in this same tick.
    // A dismissed share sheet or a blocked clipboard stays silent.
    if (mode === "files") nav.share!({ files: [readyFile!], text }).catch(() => {});
    else if (mode === "text") nav.share!({ text }).catch(() => {});
    else if (mode === "copy-image") {
      navigator.clipboard
        .write([new ClipboardItem({ "image/png": png, "text/plain": new Blob([text], { type: "text/plain" }) })])
        .then(copied, copyText);
    } else copyText();
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

function awardList(awards: Recap["awards"], cls: string, from: number): HTMLElement {
  return h(
    "ol",
    { class: cls },
    awards.map((a, i) =>
      h(
        "li",
        { class: "award", style: `--i: ${from + i}` },
        h("span", { class: "award-title" }, a.title),
        h("strong", { class: "award-who" }, joinNames(a.who)),
        h("span", { class: "muted" }, a.line),
      ),
    ),
  );
}

export function recapView(o: RecapViewOptions): HTMLElement {
  const { recap } = o;
  return h(
    "section",
    { class: "recap" },
    h("h2", {}, "Tonight's recap"),
    h("p", { class: "muted recap-meta" }, recapMeta(recap, o.gameName)),
    recap.awards.length ? awardList(recap.awards, "awards", 0) : null,
    recap.table.length ? h("h3", { class: "recap-table" }, "Around the table") : null,
    recap.table.length ? awardList(recap.table, "awards awards-table", recap.awards.length) : null,
    recap.quiet ? h("p", { class: "recap-quiet" }, recap.quiet) : null,
    recap.moment ? h("p", { class: "recap-moment" }, momentText(recap.moment, o.gameName)) : null,
    h("div", { class: "actions" }, shareButton(recap, o)),
    outlet(o.partyOver, o.isHost, recap, o.home),
  );
}

/** A room that's gone, or a party that ended before any game finished. */
export function closedView(message: string, isHost: boolean, partyOver: PartyOverHook | undefined, home: () => void): HTMLElement {
  return h("section", { class: "message closed" }, h("p", {}, message), outlet(partyOver, isHost, null, home));
}
