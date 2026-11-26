// The card faces' pictures: a shape for each colour and an icon for each power.
// Plain SVG strings, no DOM, so the model and tests can use them too.
import type { Colour, PowerKind } from "../shared/types.ts";

/** Colour is never the only signal: each colour has its own shape. */
export const SHAPES: Record<Colour, string> = {
  red: '<circle cx="12" cy="12" r="9"/>',
  amber: '<path d="M12 2.5 22 20.5H2z"/>',
  blue: '<rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/>',
  green: '<path d="M12 1.5 22.5 12 12 22.5 1.5 12z"/>',
};

/** A colour's shape, for a corner of a number card. `cls` is "ov-sh" or "ov-sh br". */
export function shapeSvg(colour: Colour, cls: string): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${SHAPES[colour]}</svg>`;
}

/** Line icons on a 24 grid, drawn with the stroke (see .ov-picon). */
const ICONS: Record<PowerKind, string> = {
  vent: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 3.5l3 2.5 3-2.5M9 20.5l3-2.5 3 2.5M3 10.6l3.7-.6L5.4 6.5M21 13.4l-3.7.6 1.3 3.5M3 13.4l3.7.6-1.3 3.5M21 10.6l-3.7-.6 1.3-3.5"/>',
  turbo: '<rect x="3.5" y="6.5" width="10.5" height="14" rx="1.8"/><rect x="10" y="3.5" width="10.5" height="14" rx="1.8"/><path d="M13.4 8.3l4.2 4.6M17.6 8.3l-4.2 4.6"/>',
  shove: '<rect x="15" y="4" width="6.5" height="16" rx="1.6"/><path d="M2.5 12h9.5M8.5 8l4 4-4 4"/>',
  wrench: '<path d="M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4"/>',
  fuse: '<path d="M12 2.5c.6 3.2 5.8 5.6 5.8 11a5.8 5.8 0 0 1-11.6 0c0-2.8 1.6-4.4 2.6-5.8.4 1.8 1.3 2.9 2.4 3.3-.3-3.1-.2-5.8.8-8.5z"/><path d="M12 20a2.4 2.4 0 0 1-2.4-2.4c0-1.6 1.4-2.4 2.4-4 1 1.6 2.4 2.4 2.4 4A2.4 2.4 0 0 1 12 20z"/>',
  heatwave: '<path d="M3.5 5h17M12 8.5v11M7.5 15l4.5 4.5 4.5-4.5"/><path d="M3.5 10.5h4M16.5 10.5h4" stroke-dasharray="1.5 2"/>',
  steal: '<rect x="13" y="3" width="8" height="11" rx="1.6"/><path d="M15.5 18.5H4M8 14.5l-4 4 4 4"/>',
  dump: '<rect x="3" y="3" width="8" height="11" rx="1.6"/><path d="M8.5 18.5H20M16 14.5l4 4-4 4"/>',
  audit: '<circle cx="10" cy="10" r="6.2"/><path d="M14.6 14.6 21 21M7.5 10.2l1.8 1.8 3.4-3.6"/>',
  block: '<path d="M12 2.8 20 6v6c0 5-3.4 8.2-8 9.4-4.6-1.2-8-4.4-8-9.4V6z"/><path d="M8.5 12h7"/>',
};

/** A power card's icon as SVG markup. */
export function powerIcon(kind: PowerKind): string {
  return `<svg class="ov-picon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[kind]}</svg>`;
}

/** What a power card does, which picks its colour: helps you, hits a player, hits everyone, keeps you safe. */
export function powerKindClass(kind: PowerKind): "help" | "hit" | "all" | "guard" {
  if (kind === "vent" || kind === "turbo") return "help";
  if (kind === "heatwave") return "all";
  if (kind === "block") return "guard";
  return "hit";
}
