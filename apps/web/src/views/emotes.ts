import { REACTIONS, type Reaction } from "@games/protocol";
import { h } from "@games/ui";
import { icon } from "../brand.ts";

/** Past this many on screen, new ones wait their turn (by not showing). Mashing is a feature; 200 nodes isn't. */
const MAX_FLOATING = 40;

export interface EmotesOptions {
  send(emoji: Reaction): void;
  me(): string | null;
  nameOf(playerId: string): string;
}

/**
 * Floating emoji for the whole room. A header button opens a bar of the six;
 * the bar stays open so you can mash. What floats is whatever the server
 * echoes back, so everyone sees the same thing, rate limit included.
 */
export class Emotes {
  readonly wrap = h("span", { class: "emote-wrap" });
  readonly layer = h("div", { class: "emote-layer", "aria-hidden": "true" });

  private button = h("button", { type: "button", class: "icon-btn", "aria-label": "Send a reaction", "aria-expanded": "false" }, icon("smile"));
  private bar = h("div", { class: "emote-bar", role: "group", "aria-label": "Reactions", hidden: true });
  private opts: EmotesOptions;

  constructor(opts: EmotesOptions) {
    this.opts = opts;
    this.bar.append(...REACTIONS.map((r) => h("button", { type: "button", "aria-label": `Send ${r}`, onclick: () => this.opts.send(r) }, r)));
    this.button.addEventListener("click", () => this.toggle());
    this.wrap.append(this.button, this.bar);
    this.wrap.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !this.bar.hidden) {
        this.toggle(false);
        this.button.focus();
      }
    });
    document.addEventListener("pointerdown", this.onOutside);
  }

  toggle(open = this.bar.hidden) {
    this.bar.hidden = !open;
    this.button.setAttribute("aria-expanded", String(open));
  }

  show(from: string, emoji: Reaction) {
    if (this.layer.childElementCount >= MAX_FLOATING) return;
    const who = from === this.opts.me() ? "you" : this.opts.nameOf(from);
    // One smooth rise and, separately, a slow side-to-side sway. Waypoints in a
    // single keyframe list would ease in and out at every stop: lurch, lurch.
    const sway = 0.9 + Math.random() * 0.6;
    const el = h(
      "span",
      {
        class: "emote",
        style: `left: ${8 + Math.random() * 84}%; --dur: ${2.6 + Math.random() * 0.8}s`,
      },
      h(
        "span",
        {
          class: "emote-sway",
          // Random amplitude, and a random phase so a burst doesn't sway in lockstep.
          style: `--dx: ${(Math.random() < 0.5 ? -1 : 1) * (12 + Math.random() * 18)}px; animation-duration: ${sway}s; animation-delay: -${Math.random() * sway}s`,
        },
        h("span", { class: "emote-glyph", style: `--s: ${0.85 + Math.random() * 0.4}` }, emoji),
        h("span", { class: "emote-name" }, who),
      ),
    );
    // Children's animations bubble up here too; only the fade-out means it's over.
    el.addEventListener("animationend", (e) => {
      if (e.target === el && e.animationName === "emote-life") el.remove();
    });
    this.layer.append(el);
  }

  destroy() {
    document.removeEventListener("pointerdown", this.onOutside);
    this.layer.remove();
  }

  private onOutside = (e: PointerEvent) => {
    if (!this.bar.hidden && !this.wrap.contains(e.target as Node)) this.toggle(false);
  };
}
