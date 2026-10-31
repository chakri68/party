// One die drawing for every dice game (Liar's Dice, Farkle). Plain SVG paths
// and circles, no text, so it reads the same everywhere. Colours come from
// CSS custom properties with fallbacks, so a game restyles a die (held, out of
// play, wild) with a class instead of a second drawing:
//
//   --die-face   body fill      (default: the shell's card white)
//   --die-pip    pip fill       (default: the card ink)
//   --die-edge   outline        (default: a faint dark line)

/** Pip centres on a 100×100 face, per value. */
const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]],
};

export interface DieOptions {
  /** Accessible name. Without one the drawing is decorative (aria-hidden). */
  label?: string;
}

/**
 * A die showing `face` (1–6). `null` draws one face down: no pips, a hatched
 * body, for dice you can't see (under someone else's cup).
 */
export function dieSvg(face: number | null, opts: DieOptions = {}): string {
  const a11y = opts.label ? `role="img" aria-label="${escapeAttr(opts.label)}"` : `aria-hidden="true"`;
  const body = `<rect x="4" y="4" width="92" height="92" rx="20" style="fill:var(--die-face,#fffdf8);stroke:var(--die-edge,rgb(0 0 0 / .18));stroke-width:3"/>`;
  if (face === null) {
    return `<svg viewBox="0 0 100 100" ${a11y} focusable="false" class="die-svg hidden-face">${body}<path d="M26 74 74 26M26 50 50 26M50 74 74 50" style="stroke:var(--die-pip,#1b1b1b);stroke-width:6;stroke-linecap:round;opacity:.22"/></svg>`;
  }
  const pips = (PIPS[face] ?? [])
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${face === 1 ? 11 : 9}" style="fill:var(--die-pip,#1b1b1b)"/>`)
    .join("");
  return `<svg viewBox="0 0 100 100" ${a11y} focusable="false" class="die-svg">${body}${pips}</svg>`;
}

/** "Five", "Sixes": how a face reads out loud. */
export const DIE_NAMES = ["", "One", "Two", "Three", "Four", "Five", "Six"] as const;

export function diePlural(face: number): string {
  return face === 6 ? "Sixes" : `${DIE_NAMES[face] ?? face}s`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
