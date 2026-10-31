import { h } from "@games/ui";
import type { Control, Controls } from "./input.ts";
import "./driver.css";

// The Driver's thumb zones as parts: the Driver's phone (driver.ts) lays
// them out round its cockpit, Rally (rally/drive.ts) lays them over the
// course. Same pads, same Controls, same look.

const arrow = (dir: "left" | "right") => {
  const el = h("span", { class: "br-glyph", "aria-hidden": "true" });
  el.innerHTML = `<svg viewBox="0 0 24 24"><path d="${dir === "left" ? "M15 4 7 12l8 8" : "M9 4l8 8-8 8"}" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return el;
};

const pad = (control: Control, label: string, glyph: Node | string) =>
  h("div", { class: `br-pad br-pad-${control}`, "data-control": control }, glyph, h("span", { class: "br-pad-label" }, label));

export const steerZone = () =>
  h("div", { class: "br-zone br-steer", role: "group", "aria-label": "Steer with A and D, or the arrow keys" }, pad("left", "Left", arrow("left")), pad("right", "Right", arrow("right")));

export const pedalZone = () =>
  h(
    "div",
    { class: "br-zone br-pedals", role: "group", "aria-label": "Pedals: W to go, S to brake or go backwards" },
    pad("brake", "Brake", h("span", { class: "br-glyph br-glyph-brake", "aria-hidden": "true" })),
    pad("gas", "Go", h("span", { class: "br-glyph br-glyph-gas", "aria-hidden": "true" })),
  );

/**
 * Wires both zones to `controls` and lights the pads in `root` while held.
 * Each zone is split down the middle: the whole half is the pad, gaps and all.
 */
export function bindPads(controls: Controls, root: HTMLElement, steer: HTMLElement, pedals: HTMLElement): void {
  const halves = (zone: HTMLElement, a: Control, b: Control) => (x: number) => {
    const r = zone.getBoundingClientRect();
    return x < r.left + r.width / 2 ? a : b;
  };
  controls.onHeld = (held) => {
    for (const p of root.querySelectorAll<HTMLElement>(".br-pad")) p.classList.toggle("down", held.has(p.dataset.control as Control));
  };
  controls.zone(steer, halves(steer, "left", "right"));
  controls.zone(pedals, halves(pedals, "brake", "gas"));
}

export const coarse = () => matchMedia("(pointer: coarse)").matches;

/** A full-screen toggle for the top bar, on phones that have one, or null. */
export function fullscreenButton(): HTMLElement | null {
  if (!coarse() || !document.fullscreenEnabled) return null;
  const fs = h("button", { type: "button", class: "br-fs", "aria-label": "Full screen", onclick: () => void toggleFullscreen() });
  fs.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return fs;
}

/** Android only, in practice: iPhones have no element full screen. Landscape lock where allowed. */
async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) return void (await document.exitFullscreen());
    await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    await (screen.orientation as ScreenOrientation & { lock?(o: string): Promise<void> }).lock?.("landscape");
  } catch {
    /* refused: rotating by hand works too */
  }
}
