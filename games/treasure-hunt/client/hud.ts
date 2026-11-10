import { h } from "@games/ui";
import type { THMode, THPrivate } from "../shared/types.ts";

// The HUD over the map: the timer and score (they sit in the strip above it),
// the clue board down the right, and the 3-2-1 in the middle. The text comes
// from the pure functions up top; the class below only puts it in the DOM.
// Only the clue toggle and the clue panel (so it can scroll) take the mouse;
// a click anywhere else on the map reaches Godot and locks the pointer.

/** Time left as m:ss. A part second rounds up, so 0:00 means it's over. */
export function formatLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Timed: "3 of 6 found". Race: "2 of 5", where 5 is the target. */
export function scoreText(found: number, pool: number, mode: THMode = "timed"): string {
  return mode === "race" ? `${found} of ${pool}` : `${found} of ${pool} found`;
}

/** Shown once beside the Race score, so "2 of 5" has a meaning. */
export const raceText = (target: number) => `Race to ${target}`;

/** "3", "2", "1", then nothing. */
export function countdownText(ms: number): string {
  return ms > 0 ? String(Math.ceil(ms / 1000)) : "";
}

/** One line per cache on the board, in board order. taken: another team got it first (Race). */
export function clueItems(priv: THPrivate | null): { text: string; found: boolean; taken: boolean }[] {
  return (priv?.clues ?? []).map((c) => ({ text: c.clues.join(" "), found: c.found, taken: c.taken }));
}

export interface HudState {
  /** Ms left on the round, or null when there's no timer to show. */
  left: number | null;
  /** Ms left on the countdown, or null outside it. */
  countdown: number | null;
  /** pool is the target in Race. */
  score: { found: number; pool: number; mode: THMode } | null;
  priv: THPrivate | null;
}

export class Hud {
  readonly timer = h("span", { class: "th-timer", role: "timer", hidden: true });
  readonly score = h("span", { class: "th-score", hidden: true });
  readonly race = h("span", { class: "th-race", hidden: true });
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
    if (s.score) this.score.textContent = scoreText(s.score.found, s.score.pool, s.score.mode);
    this.race.hidden = this.score.hidden || s.score?.mode !== "race";
    if (!this.race.hidden && s.score) this.race.textContent = raceText(s.score.pool);

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
        h(
          "li",
          { class: it.found ? "th-clue th-clue-found" : it.taken ? "th-clue th-clue-taken" : "th-clue" },
          h("span", { class: "th-clue-mark" }, it.found ? "✓" : ""),
          h("span", {}, it.text, it.taken ? h("span", { class: "th-clue-tag" }, "Taken") : null),
        ),
      ),
    );
  }

  private syncToggle() {
    this.toggle.setAttribute("aria-expanded", String(this.open));
    this.toggle.textContent = this.open ? "Hide clues" : "Show clues";
  }
}
