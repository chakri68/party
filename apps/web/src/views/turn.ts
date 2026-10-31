// "Your turn", said by the shell so every game gets it the same way.
//
// Games already chime and buzz, and each has a status line, but the status
// line scrolls off a phone and the chime's gone with the sound off. So when
// the room is waiting on you, the shell adds three things the game can't:
//
//   - a frame around the whole screen: pulses as the turn arrives, then stays
//     as a thin edge until you've moved, wherever you've scrolled to
//   - a pill at the top that says so, for a couple of seconds
//   - the tab title, which blinks while the tab's in the background, so a
//     laptop player in another tab sees it
//
// Screen readers hear it once, politely, through the pill.

import { h } from "@games/ui";

const PILL_MS = 2600;
const BLINK_MS = 1000;

export class TurnSignal {
  private frame = h("div", { class: "turn-frame", "aria-hidden": "true" });
  private pill = h("div", { class: "turn-pill", role: "status" });
  private label: string | null = null;
  private baseTitle = "";
  private pillTimer: ReturnType<typeof setTimeout> | undefined;
  private blink: ReturnType<typeof setInterval> | undefined;

  private titleOf: () => string;

  constructor(titleOf: () => string) {
    this.titleOf = titleOf;
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  mount(parent: HTMLElement) {
    parent.append(this.frame, this.pill);
  }

  destroy() {
    this.set(null);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.frame.remove();
    this.pill.remove();
  }

  /** `null` when it isn't your turn. Same label twice is a no-op. */
  set(label: string | null) {
    if (label === this.label) return;
    const arriving = this.label === null && label !== null;
    this.label = label;
    this.frame.classList.toggle("on", label !== null);
    if (arriving) {
      // Restart the pulse even if the last one hasn't finished.
      this.frame.classList.remove("arrive");
      void this.frame.offsetWidth;
      this.frame.classList.add("arrive");
      this.pill.textContent = label;
      this.pill.classList.add("show");
      clearTimeout(this.pillTimer);
      this.pillTimer = setTimeout(() => this.pill.classList.remove("show"), PILL_MS);
    } else if (label === null) {
      clearTimeout(this.pillTimer);
      this.pill.classList.remove("show");
      this.pill.textContent = "";
    }
    this.onVisibility();
  }

  private onVisibility = () => {
    clearInterval(this.blink);
    this.blink = undefined;
    this.baseTitle = this.titleOf();
    if (!this.label) {
      document.title = this.baseTitle;
      return;
    }
    const marked = `● ${this.label} · ${this.baseTitle}`;
    document.title = marked;
    if (!document.hidden) return;
    let on = true;
    this.blink = setInterval(() => {
      on = !on;
      document.title = on ? marked : this.baseTitle;
    }, BLINK_MS);
  };
}
