// The logo mark and the handful of line icons the shell uses. Paths only (no
// text, no emoji), so they render identically everywhere. public/favicon.svg and
// the PNG icons are drawn from the same geometry (apps/web/brand/).

export const MARK_SVG = `
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <g transform="rotate(-14 32 36)">
    <rect x="11" y="10" width="30" height="42" rx="5" fill="#c6f432"/>
  </g>
  <g transform="rotate(10 32 36)">
    <rect x="23" y="12" width="30" height="42" rx="5" fill="#fffdf8"/>
    <path d="M38 44s-9-5.6-11.6-10.6C24.5 29.6 26.8 25 31.2 25c2.6 0 4.6 1.4 6.8 3.8 2.2-2.4 4.2-3.8 6.8-3.8 4.4 0 6.7 4.6 4.8 8.4C47 38.4 38 44 38 44z" fill="#0e0e0c"/>
  </g>
</svg>`;

export function brandMark(className = "mark"): HTMLElement {
  const span = document.createElement("span");
  span.className = className;
  span.innerHTML = MARK_SVG;
  return span;
}

const STROKE = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
  "sound-on": `<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>`,
  "sound-off": `<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/>`,
  "arrow-right": `<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>`,
  dice: `<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="8.5" cy="8.5" r="1.3" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>`,
  bug: `<rect x="8" y="6" width="8" height="14" rx="4"/><path d="M12 6V3M4 13h4M16 13h4M5 7l3 2M19 7l-3 2M5 19l3-2M19 19l-3-2"/>`,
} as const;

export type IconName = keyof typeof ICONS;

/** A 24×24 line icon that takes its colour from the surrounding text. */
export function icon(name: IconName): HTMLElement {
  const span = document.createElement("span");
  span.className = "icon";
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = `<svg viewBox="0 0 24 24" width="100%" height="100%" ${STROKE}>${ICONS[name]}</svg>`;
  return span;
}
