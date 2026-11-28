import { h } from "./dom.ts";

/**
 * One play chip, drawn: a disc with a notched rim, in `currentColor` with the
 * page's --bg cut out. Decorative. `className` sizes and colours it.
 */
export function chipIcon(className: string): HTMLElement {
  const el = h("span", { class: className, "aria-hidden": "true" });
  el.innerHTML =
    '<svg viewBox="0 0 20 20" width="100%" height="100%" focusable="false">' +
    '<circle cx="10" cy="10" r="9" fill="currentColor"/>' +
    '<circle cx="10" cy="10" r="6.6" fill="none" stroke="var(--bg)" stroke-width="2.2" stroke-dasharray="3.2 2.7"/>' +
    '<circle cx="10" cy="10" r="3.6" fill="var(--bg)" opacity=".35"/>' +
    "</svg>";
  return el;
}
