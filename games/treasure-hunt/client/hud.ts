import { h } from "@games/ui";
import { clockText } from "../shared/sky.ts";
import type { PhotoCam, THMode, THPrivate } from "../shared/types.ts";

export const HOTCOLD_LABEL = "Hot or cold";
export const hotColdOpensText = (ms: number) => `Hot or cold opens in ${formatLeft(ms)}.`;

export interface HotColdView {
  /** 0 (cold) to 3 (hot), or null with no signal. */
  meter: 0 | 1 | 2 | 3 | null;
  leftMs: number;
  canUse: boolean;
  /** Ms until it opens, while it is locked; else null. */
  opensInMs: number | null;
}

/**
 * The Hot or cold meter and button, from the private state. `streamed` is the
 * latest relayed level for the active cache and wins over `active.level`.
 * `hunting` is the phase check, passed in (the private state has no phase).
 */
export function hotColdView(priv: THPrivate | null, now: number, streamed: 0 | 1 | 2 | 3 | null, hunting = true): HotColdView {
  const hc = priv?.hotcold;
  if (!hc) return { meter: null, leftMs: 0, canUse: false, opensInMs: null };
  const live = hc.active && hc.active.until > now ? hc.active : null;
  const opensInMs = !hc.used && hc.unlockAt !== null && hc.unlockAt > now ? hc.unlockAt - now : null;
  return {
    meter: live ? (streamed ?? live.level) : null,
    leftMs: live ? live.until - now : 0,
    canUse: hunting && !hc.used && hc.unlockAt !== null && opensInMs === null,
    opensInMs,
  };
}

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
export function clueItems(
  priv: THPrivate | null,
  photoFor?: (id: string, cam: PhotoCam) => string | undefined,
): { text: string; found: boolean; taken: boolean; photo: { src?: string } | null }[] {
  return (priv?.clues ?? []).map((c) => {
    const src = c.photo ? photoFor?.(c.id, c.photo) : undefined;
    return { text: c.clues.join(" "), found: c.found, taken: c.taken, photo: c.photo ? (src ? { src } : {}) : null };
  });
}

/**
 * What the clue list's render depends on, small: a photo counts by its pose
 * and whether (and how long) its image is, not the ~40 KB data URL, since
 * render runs every tick.
 */
export function clueListKey(priv: THPrivate | null, items: ReturnType<typeof clueItems>, canHot = false): string {
  const clues = priv?.clues ?? [];
  return items
    .map((it, i) => {
      const cam = clues[i]?.photo;
      const photo = it.photo && cam ? `${cam.x},${cam.z},${cam.yaw},${cam.pitch},${cam.fov}:${it.photo.src?.length ?? 0}` : "";
      return `${it.found ? 1 : 0}${it.taken ? 1 : 0}${canHot ? 1 : 0}|${photo}|${it.text}`;
    })
    .join("\n");
}

export const PHOTO_WAIT = "The photo is loading.";
export const PHOTO_ALT = "Photo clue";

/** What a clue's photo slot shows: the image, the loading line, or nothing. */
export function photoView(photo: { src?: string } | null): { src: string; alt: string } | { wait: string } | null {
  if (!photo) return null;
  return photo.src ? { src: photo.src, alt: PHOTO_ALT } : { wait: PHOTO_WAIT };
}

/** The game clock for the bar, or "" when there is none. */
export const clockLabel = (min: number | null | undefined) => (min == null ? "" : clockText(min));

export interface HudState {
  /** Ms left on the round, or null when there's no timer to show. */
  left: number | null;
  /** Ms left on the countdown, or null outside it. */
  countdown: number | null;
  /** pool is the target in Race. */
  score: { found: number; pool: number; mode: THMode } | null;
  priv: THPrivate | null;
  /** The game minute after midnight, or null when there's no clock to show. */
  clock?: number | null;
  hot?: HotColdView;
}

export class Hud {
  readonly timer = h("span", { class: "th-timer", role: "timer", hidden: true });
  readonly clock = h("span", { class: "th-clock", title: "Time in the game", hidden: true });
  readonly score = h("span", { class: "th-score", hidden: true });
  readonly race = h("span", { class: "th-race", hidden: true });
  readonly toggle = h("button", { type: "button", class: "th-clue-toggle", "aria-controls": "th-clues", hidden: true }, "Clues");
  private list = h("ol", { class: "th-clue-list" });
  private opens = h("p", { class: "th-hot-opens", hidden: true });
  readonly board = h("aside", { class: "th-clues", id: "th-clues", "aria-label": "Your clues", hidden: true }, h("h2", { class: "th-clues-title" }, "Your caches"), this.opens, this.list);
  readonly meter = h("span", { class: "th-meter", role: "img", "aria-label": HOTCOLD_LABEL, hidden: true }, ...[0, 1, 2, 3].map((i) => h("i", { class: `th-meter-bar th-meter-${i}` })), h("span", { class: "th-meter-left" }));
  readonly count = h("p", { class: "th-count", "aria-live": "assertive", hidden: true });

  private photoFor: ((id: string, cam: PhotoCam) => string | undefined) | undefined;
  private open = true;
  private lastClues = "";
  private onHot: ((cacheId: string) => void) | undefined;

  constructor(photoFor?: (id: string, cam: PhotoCam) => string | undefined, onHot?: (cacheId: string) => void) {
    this.photoFor = photoFor;
    this.onHot = onHot;
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

    const clock = clockLabel(s.clock);
    this.clock.hidden = clock === "";
    this.clock.textContent = clock;

    this.score.hidden = !s.score || s.score.pool === 0;
    if (s.score) this.score.textContent = scoreText(s.score.found, s.score.pool, s.score.mode);
    this.race.hidden = this.score.hidden || s.score?.mode !== "race";
    if (!this.race.hidden && s.score) this.race.textContent = raceText(s.score.pool);

    const c = s.countdown === null ? "" : countdownText(s.countdown);
    this.count.hidden = c === "";
    if (this.count.textContent !== c) this.count.textContent = c;

    const hot = s.hot;
    const meter = hot?.meter ?? null;
    this.meter.hidden = meter === null;
    if (hot && meter !== null) {
      this.meter.dataset.level = String(meter);
      (this.meter.lastElementChild as HTMLElement).textContent = formatLeft(hot.leftMs);
    }
    const opens = hot?.opensInMs ?? null;
    this.opens.hidden = opens === null;
    if (opens !== null) this.opens.textContent = hotColdOpensText(opens);

    const items = clueItems(s.priv, this.photoFor);
    this.board.hidden = this.toggle.hidden = items.length === 0;
    // Called on every tick for the clocks; only touch the list when it changed.
    const key = clueListKey(s.priv, items, hot?.canUse ?? false);
    if (key === this.lastClues) return;
    this.lastClues = key;
    const canHot = hot?.canUse ?? false;
    this.list.replaceChildren(
      ...items.map((it, i) =>
        h(
          "li",
          { class: it.found ? "th-clue th-clue-found" : it.taken ? "th-clue th-clue-taken" : "th-clue" },
          h("span", { class: "th-clue-mark" }, it.found ? "✓" : ""),
          h(
            "span",
            {},
            it.text,
            it.taken ? h("span", { class: "th-clue-tag" }, "Taken") : null,
            photoNode(photoView(it.photo)),
            canHot && !it.found && !it.taken ? this.hotButton(s.priv?.clues[i]?.id) : null,
          ),
        ),
      ),
    );
  }

  private hotButton(id: string | undefined) {
    const b = h("button", { type: "button", class: "th-hot-btn" }, HOTCOLD_LABEL);
    b.addEventListener("click", () => id && this.onHot?.(id));
    return b;
  }

  private syncToggle() {
    this.toggle.setAttribute("aria-expanded", String(this.open));
    this.toggle.textContent = this.open ? "Hide clues" : "Show clues";
  }
}

function photoNode(v: ReturnType<typeof photoView>) {
  if (!v) return null;
  return "src" in v ? h("img", { class: "th-clue-photo", src: v.src, alt: v.alt }) : h("span", { class: "th-clue-wait" }, v.wait);
}
