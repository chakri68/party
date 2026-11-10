import { h } from "@games/ui";
import type { THPrivate } from "../shared/types.ts";

// The HUD over the map: the timer and score (they sit in the strip above it),
// the clue board down the right, and the 3-2-1 in the middle. The text comes
// from the pure functions up top; the class below only puts it in the DOM.
// None of it takes the mouse except the clue toggle, so a click on the map
// still reaches Godot and locks the pointer.

/** Time left as m:ss. A part second rounds up, so 0:00 means it's over. */
export function formatLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function scoreText(found: number, pool: number): string {
  return `${found} of ${pool} found`;
}

/** "3", "2", "1", then nothing. */
export function countdownText(ms: number): string {
  return ms > 0 ? String(Math.ceil(ms / 1000)) : "";
}

/** One line per cache in the pool, in pool order. */
export function clueItems(priv: THPrivate | null): { text: string; found: boolean }[] {
  return (priv?.clues ?? []).map((c) => ({ text: c.clues.join(" "), found: c.found }));
}

export interface HudState {
  /** Ms left on the round, or null when there's no timer to show. */
  left: number | null;
  /** Ms left on the countdown, or null outside it. */
  countdown: number | null;
  score: { found: number; pool: number } | null;
  priv: THPrivate | null;
}

export class Hud {
  readonly timer = h("span", { class: "th-timer", role: "timer", hidden: true });
  readonly score = h("span", { class: "th-score", hidden: true });
  readonly toggle = h("button", { type: "button", class: "th-clue-toggle", "aria-controls": "th-clues", hidden: true }, "Clues");
  private list = h("ol", { class: "th-clue-list" });
  readonly board = h("aside", { class: "th-clues", id: "th-clues", "aria-label": "Your clues", hidden: true }, h("h2", { class: "th-clues-title" }, "Your caches"), this.list);
  readonly count = h("p", { class: "th-count", "aria-live": "assertive", hidden: true });

  private open = true;
  private lastClues = "";

  constructor() {
    this.toggle.addEventListener("click", () => {
      this.open = !this.open;
      this.board.classList.toggle("th-clues-shut", !this.open);
      this.syncToggle();
    });
    this.syncToggle();
  }

  render(s: HudState) {
    this.timer.hidden = s.left === null;
    if (s.left !== null) this.timer.textContent = formatLeft(s.left);

    this.score.hidden = !s.score || s.score.pool === 0;
    if (s.score) this.score.textContent = scoreText(s.score.found, s.score.pool);

    const c = s.countdown === null ? "" : countdownText(s.countdown);
    this.count.hidden = c === "";
    if (this.count.textContent !== c) this.count.textContent = c;

    const items = clueItems(s.priv);
    this.board.hidden = this.toggle.hidden = items.length === 0;
    // Called on every tick for the clocks; only touch the list when it changed.
    const key = JSON.stringify(items);
    if (key === this.lastClues) return;
    this.lastClues = key;
    this.list.replaceChildren(
      ...items.map((it) =>
        h("li", { class: it.found ? "th-clue th-clue-found" : "th-clue" }, h("span", { class: "th-clue-mark" }, it.found ? "✓" : ""), h("span", {}, it.text)),
      ),
    );
  }

  private syncToggle() {
    this.toggle.setAttribute("aria-expanded", String(this.open));
    this.toggle.textContent = this.open ? "Hide clues" : "Show clues";
  }
}
