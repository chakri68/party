import { h } from "@games/ui";
import type { Disc } from "../shared/types.ts";

// Original drawings, one 48×48 viewBox each. Fills use the shell's tokens where
// the disc should sit in the theme (rims, the back), fixed colours for the art.

const RIM = `<circle cx="24" cy="24" r="22.5" fill="var(--card)" stroke="rgb(0 0 0 / .18)" stroke-width="1.5"/>
<circle cx="24" cy="24" r="19" fill="none" stroke="rgb(0 0 0 / .08)" stroke-width="1"/>`;

/** A single bloom on a short stem, two leaves. */
const ROSE = `<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">${RIM}
<path d="M24 29.5c-.6 4-2.2 7.2-4.6 9.6" fill="none" stroke="#3d7a35" stroke-width="2.2" stroke-linecap="round"/>
<path d="M22.6 34.2c-3.8-2.6-7.6-2-9.4.6 3.2 2 6.6 1.8 9.4-.6z" fill="#5a9e4b"/>
<path d="M23.4 32.6c3.2-2.8 7-3 9.2-.8-2.8 2.6-6.2 3-9.2.8z" fill="#4a8a3e"/>
<path d="M24 10.5c6.8 0 11.6 4.4 11.6 10.2 0 5.8-5 9.6-11.6 9.6s-11.6-3.8-11.6-9.6c0-5.8 4.8-10.2 11.6-10.2z" fill="#d8475f"/>
<path d="M13.2 18.6c2.4 4.6 6.4 6.6 10.8 6.6s8.4-2 10.8-6.6" fill="none" stroke="#a52a43" stroke-width="1.6" stroke-linecap="round"/>
<path d="M19.6 19.8c-.6-3.6 2-6 5-5.6 3 .4 4.2 3.4 2.4 5.4-1.6 1.8-4.4 1.2-4.6-.8-.2-1.4 1-2.2 2-2" fill="none" stroke="#8a1d33" stroke-width="1.8" stroke-linecap="round"/>
</svg>`;

/** A dark disc, one crooked bramble cane with hooked spikes. */
const THORN = `<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
<circle cx="24" cy="24" r="22.5" fill="#22301e" stroke="#0c120a" stroke-width="1.5"/>
<circle cx="24" cy="24" r="19" fill="none" stroke="rgb(255 255 255 / .07)" stroke-width="1"/>
<path d="M11.5 36c5-4.2 8.6-8.4 12-12.6 3.4-4.2 6.8-8 12.6-11.6" fill="none" stroke="#9c7442" stroke-width="3.6" stroke-linecap="round"/>
<g fill="#d9b27a">
<path d="M15.8 31.6l-6.2-.6 5.6-2.6z"/>
<path d="M20.4 26.8l1.4-7 1.6 5.6z"/>
<path d="M24.6 22.6l6.4.2-5.4 2.8z"/>
<path d="M29.4 16.8l.4-6.6 2 5.2z"/>
<path d="M33 14.2l5.8 1.4-5.6 1.2z"/>
</g>
</svg>`;

/** Face down: a quiet ring pattern, the same for everyone. */
const BACK = `<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
<circle cx="24" cy="24" r="22.5" fill="var(--surface-2)" stroke="var(--line)" stroke-width="1.5"/>
<circle cx="24" cy="24" r="16" fill="none" stroke="var(--muted)" stroke-opacity=".35" stroke-width="1.2" stroke-dasharray="2 3.2"/>
<circle cx="24" cy="24" r="9" fill="none" stroke="var(--muted)" stroke-opacity=".5" stroke-width="1.2"/>
<circle cx="24" cy="24" r="2.6" fill="var(--muted)" fill-opacity=".6"/>
</svg>`;

const ART: Record<Disc | "back", string> = { rose: ROSE, thorn: THORN, back: BACK };

export const discLabel = (d: Disc) => (d === "rose" ? "Rose" : "Thorn");

/** A disc you can't press: on mats, in flight. */
export function discEl(kind: Disc | "back", label?: string): HTMLElement {
  const el = h("span", { class: `th-disc ${kind}`, role: label ? "img" : null, "aria-label": label ?? null, "aria-hidden": label ? null : "true" });
  el.innerHTML = ART[kind];
  return el;
}

/** A hand disc: a button, so you can place it from the keyboard too. */
export function handDisc(d: Disc): HTMLButtonElement {
  const btn = h("button", { type: "button", class: `th-disc ${d}`, "aria-label": d === "rose" ? "Place a rose" : "Place your thorn", "data-disc": d });
  btn.innerHTML = ART[d];
  return btn;
}
