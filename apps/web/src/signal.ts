import { h } from "@games/ui";

// The room header's ping meter: three bars, coloured by the last round trip to
// the server. Tapping it says how good the link is in a word: Good, Weak or
// Bad. No milliseconds: players can't act on a number.

export type SignalLevel = "good" | "ok" | "slow" | "none";

/** Bar count and colour for a round trip in ms. Null means no live link. */
export function signalLevel(ms: number | null): SignalLevel {
  if (ms === null) return "none";
  if (ms < 150) return "good";
  if (ms < 300) return "ok";
  return "slow";
}

const WORDS: Record<SignalLevel, string> = { good: "Good", ok: "Weak", slow: "Bad", none: "Not connected" };

export function signalText(ms: number | null): string {
  return ms === null ? "Connection: not connected yet" : `Connection: ${WORDS[signalLevel(ms)]}`;
}

const BARS = `<svg viewBox="0 0 18 16" width="100%" height="100%" aria-hidden="true" focusable="false">
  <rect class="b1" x="1" y="10" width="4" height="5" rx="1"/>
  <rect class="b2" x="7" y="6" width="4" height="9" rx="1"/>
  <rect class="b3" x="13" y="1" width="4" height="14" rx="1"/>
</svg>`;

export const TIP_MS = 2500;

/**
 * The meter: a button in a small wrapper, with the tap's word in a tip just
 * under the bars. The tip is the button's sibling, not its child, so screen
 * readers announce it as a live region (a button's name is its aria-label).
 * `el` is the wrapper the header places; `set` updates it in place, so the
 * header needn't re-render.
 */
export function signalMeter(): { el: HTMLElement; button: HTMLButtonElement; set(ms: number | null): void } {
  const button = h("button", { type: "button", class: "icon-btn signal" }) as HTMLButtonElement;
  button.innerHTML = BARS;
  const tip = h("span", { class: "signal-tip", role: "status" });
  const el = h("span", { class: "signal-wrap" }, button, tip);
  let last: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  button.addEventListener("click", () => {
    tip.textContent = signalText(last);
    tip.classList.add("show");
    clearTimeout(timer);
    timer = setTimeout(() => {
      tip.classList.remove("show");
      // Emptied, so the next tap is announced again even with the same word.
      tip.textContent = "";
    }, TIP_MS);
  });
  const set = (ms: number | null) => {
    last = ms;
    button.dataset.level = signalLevel(ms);
    button.setAttribute("aria-label", signalText(ms));
    // Only a new word: rewriting the same text would make the live region speak again.
    if (tip.classList.contains("show") && tip.textContent !== signalText(ms)) tip.textContent = signalText(ms);
  };
  set(null);
  return { el, button, set };
}
