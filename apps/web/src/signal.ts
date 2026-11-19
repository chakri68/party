import { h } from "@games/ui";

// The room header's ping meter: three bars, coloured by the last round trip to
// the server. Tapping it says the number in words.

export type SignalLevel = "good" | "ok" | "slow" | "none";

/** Bar count and colour for a round trip in ms. Null means no live link. */
export function signalLevel(ms: number | null): SignalLevel {
  if (ms === null) return "none";
  if (ms < 150) return "good";
  if (ms < 300) return "ok";
  return "slow";
}

const WORDS: Record<SignalLevel, string> = { good: "Good", ok: "OK", slow: "Slow", none: "Not connected" };

export function signalText(ms: number | null): string {
  return ms === null ? "Connection: not connected yet" : `Connection: ${WORDS[signalLevel(ms)]} (${Math.round(ms)} ms)`;
}

const BARS = `<svg viewBox="0 0 18 16" width="100%" height="100%" aria-hidden="true" focusable="false">
  <rect class="b1" x="1" y="10" width="4" height="5" rx="1"/>
  <rect class="b2" x="7" y="6" width="4" height="9" rx="1"/>
  <rect class="b3" x="13" y="1" width="4" height="14" rx="1"/>
</svg>`;

/** A button that shows the meter; `set` updates it in place, so the header needn't re-render. */
export function signalMeter(onTap: (text: string) => void): { el: HTMLButtonElement; set(ms: number | null): void } {
  const el = h("button", { type: "button", class: "icon-btn signal" }) as HTMLButtonElement;
  el.innerHTML = BARS;
  let last: number | null = null;
  el.addEventListener("click", () => onTap(signalText(last)));
  const set = (ms: number | null) => {
    last = ms;
    el.dataset.level = signalLevel(ms);
    el.setAttribute("aria-label", signalText(ms));
  };
  set(null);
  return { el, set };
}
