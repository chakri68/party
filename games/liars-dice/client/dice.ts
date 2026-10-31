import { dieSvg, h } from "@games/ui";
import type { Face } from "../shared/types.ts";

/** One die, drawn by the shared `dieSvg`. Null is face down. Classes restyle it (hit, wild, miss, lost). */
export function die(face: Face | null, cls = "", label?: string): HTMLElement {
  const el = h("span", { class: `ld-die${cls ? ` ${cls}` : ""}` });
  el.innerHTML = dieSvg(face, label ? { label } : {});
  return el;
}

/** Turns a die over in place, keeping the element (and anything animating it). */
export function setFace(el: HTMLElement, face: Face | null, label?: string): void {
  el.innerHTML = dieSvg(face, label ? { label } : {});
}

/** "2, 3, 3, 6": a cup read out, for screen readers. */
export function diceLabel(dice: readonly Face[]): string {
  return dice.length ? dice.join(", ") : "no dice";
}
