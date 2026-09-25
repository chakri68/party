// The bomb and its bang, as inline SVG. Decorative: the status line says what's
// going on, so both are aria-hidden. The spark and the burst are animated in
// styles.css, so these are just shapes.

import { h } from "@games/ui";

/** Round body, a cap, a curled fuse, and a spark at its tip. 120×120. */
const BOMB = `
<svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">
  <path class="pb-fuse" d="M86 30 C 92 18, 104 24, 100 12" />
  <rect class="pb-cap" x="72" y="26" width="20" height="14" rx="3" transform="rotate(40 82 33)" />
  <circle class="pb-body" cx="56" cy="72" r="40" />
  <path class="pb-shine" d="M30 56 A 30 30 0 0 1 48 40" />
  <g transform="translate(100 11)"><g class="pb-spark">
    <path class="pb-spark-rays" d="M0 -11 L2.5 -3 L11 0 L2.5 3 L0 11 L-2.5 3 L-11 0 L-2.5 -3 Z" />
    <circle class="pb-spark-core" r="3.5" /></g>
  </g>
</svg>`;

/** A jagged star in two layers, fire round a hot white middle. */
function star(points: number, outer: number, inner: number, jitter: number[]): string {
  const pts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = (i % 2 ? inner : outer) * (jitter[i % jitter.length] ?? 1);
    const a = (Math.PI * i) / points - Math.PI / 2;
    pts.push(`${(60 + r * Math.cos(a)).toFixed(1)},${(60 + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}

const BURST = `
<svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">
  <polygon class="pb-burst-outer" points="${star(11, 58, 30, [1, 0.9, 0.82, 1, 0.94, 0.86])}" />
  <polygon class="pb-burst-inner" points="${star(9, 38, 20, [0.9, 1, 0.85, 0.95])}" />
</svg>`;

export function bombEl(): HTMLElement {
  const el = h("div", { class: "pb-bomb" });
  el.innerHTML = BOMB;
  return el;
}

export function burstEl(): HTMLElement {
  const el = h("div", { class: "pb-burst" });
  el.innerHTML = BURST;
  return el;
}
