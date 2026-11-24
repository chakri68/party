// The one timer look every game uses: a small pill with a clock and the time
// left. The game keeps its own tick and deadline maths and calls `set` with
// the ms left; the pill owns no timer, so nothing runs after a view is gone.

/** Ms left as players read it: "45 s" under a minute, "1:05" from there. */
export function formatSeconds(ms: number): string {
  const secs = Math.max(0, Math.ceil(ms / 1000));
  if (secs < 60) return `${secs} s`;
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

export interface CountdownOptions {
  /** The room is paused: say so, and don't count. */
  paused?: boolean;
  /** This clock alone is held (a dispute): show the time it stopped at, muted. */
  stopped?: boolean;
  /** Ms left at or under which the pill turns to the warning colour. Default 10 s. */
  lowAt?: number;
}

export interface Countdown {
  el: HTMLElement;
  /** Ms left; `null` or nothing left (and not paused) hides the pill. */
  set(left: number | null, opts?: CountdownOptions): void;
}

const CLOCK_SVG =
  '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' +
  "</svg>";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "45 seconds", "1 minute 5 seconds", "2 minutes", for screen readers. */
function spoken(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (!m) return plural(s, "second");
  return s ? `${plural(m, "minute")} ${plural(s, "second")}` : plural(m, "minute");
}

/** Screen readers hear the time at most once per this many seconds. */
const LABEL_STEP = 10;

export function countdown(): Countdown {
  const el = document.createElement("span");
  el.setAttribute("class", "countdown");
  el.setAttribute("role", "timer");
  el.setAttribute("aria-live", "off");
  el.hidden = true;
  const icon = document.createElement("span");
  icon.setAttribute("class", "countdown-icon");
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = CLOCK_SVG;
  const text = document.createElement("span");
  text.setAttribute("class", "countdown-text");
  el.append(icon, text);

  let shownText = "";
  let label = "";
  /** The seconds the label last said; null when it said something else. */
  let labelSecs: number | null = null;

  const setText = (t: string) => {
    if (t !== shownText) text.textContent = shownText = t;
  };
  const setLabel = (l: string, secs: number | null) => {
    labelSecs = secs;
    if (l !== label) el.setAttribute("aria-label", (label = l));
  };

  return {
    el,
    set(left, opts = {}) {
      if (opts.paused) {
        el.hidden = false;
        el.classList.toggle("low", false);
        el.classList.toggle("stopped", false);
        setText("Paused");
        setLabel("Timer paused", null);
        return;
      }
      if (left === null || left <= 0) {
        el.hidden = true;
        el.classList.toggle("low", false);
        labelSecs = null;
        return;
      }
      el.hidden = false;
      const secs = Math.ceil(left / 1000);
      el.classList.toggle("stopped", !!opts.stopped);
      setText(formatSeconds(left));
      if (opts.stopped) {
        el.classList.toggle("low", false);
        setLabel(`Paused. Time left: ${spoken(secs)}`, null);
        return;
      }
      el.classList.toggle("low", left <= (opts.lowAt ?? 10_000));
      if (labelSecs === null || secs > labelSecs || labelSecs - secs >= LABEL_STEP) {
        setLabel(`Time left: ${spoken(secs)}`, secs);
      }
    },
  };
}
