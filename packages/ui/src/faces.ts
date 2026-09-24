// Generated avatars: a little face on a coloured disc, picked deterministically
// from a seed, so a player looks the same on every screen and every device
// without us storing or sending anything but the seed. Plain SVG, no text, so
// it renders identically everywhere.

/** FNV-1a, then mulberry32: a stable stream of "random" picks per seed. */
function picker(seed: string): <T>(options: readonly T[]) => T {
  let h = 0x811c9dc5;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  let a = h >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
  return (options) => options[Math.floor(next() * options.length)]!;
}

// Soft enough to sit on the near-black UI, loud enough to tell apart at 24px.
// No lime: that colour means "your turn" and "selected".
const DISCS = ["#f4a259", "#f27a6f", "#ffd166", "#7bdff2", "#b8a1ff", "#8ce99a", "#ff9fbd", "#5fd3bc", "#d9c3a0", "#9ec1ff"];
const INK = "#0e0e0c";

// 36×36 canvas; the face sits a touch below centre, like faces do.
const EYES = [
  // dots
  `<circle cx="13" cy="16" r="2"/><circle cx="23" cy="16" r="2"/>`,
  // happy arcs
  `<path d="M10.5 17a2.6 2.6 0 0 1 5 0M20.5 17a2.6 2.6 0 0 1 5 0" fill="none" stroke-width="1.8" stroke-linecap="round"/>`,
  // big eyes with pupils
  `<circle cx="13" cy="16" r="3.4" fill="#fff"/><circle cx="23" cy="16" r="3.4" fill="#fff"/><circle cx="13.8" cy="16.4" r="1.7"/><circle cx="23.8" cy="16.4" r="1.7"/>`,
  // sleepy
  `<path d="M10.5 16.5h5M20.5 16.5h5" stroke-width="1.8" stroke-linecap="round"/>`,
  // wink
  `<circle cx="13" cy="16" r="2"/><path d="M20.5 16.8a2.6 2.6 0 0 1 5 0" fill="none" stroke-width="1.8" stroke-linecap="round"/>`,
  // shades
  `<rect x="8.5" y="13.5" width="8" height="5" rx="2"/><rect x="19.5" y="13.5" width="8" height="5" rx="2"/><path d="M16.5 15h3" stroke-width="1.4"/>`,
];

const MOUTHS = [
  // smile
  `<path d="M13.5 23a4.5 4.5 0 0 0 9 0" fill="none" stroke-width="1.8" stroke-linecap="round"/>`,
  // grin
  `<path d="M12.5 22h11a5.5 5.5 0 0 1-11 0z"/>`,
  // flat
  `<path d="M14.5 24h7" stroke-width="1.8" stroke-linecap="round"/>`,
  // o
  `<circle cx="18" cy="24" r="2.2"/>`,
  // smirk
  `<path d="M14 24.5c3 1 6 .5 8-1.5" fill="none" stroke-width="1.8" stroke-linecap="round"/>`,
  // tongue out
  `<path d="M13.5 22.5h9"  stroke-width="1.8" stroke-linecap="round"/><path d="M16 22.5h4v2a2 2 0 0 1-4 0z" fill="#f27a8a"/>`,
];

const EXTRAS = [
  "",
  "",
  // blush
  `<ellipse cx="10" cy="21" rx="2.2" ry="1.3" fill="#ff5d73" opacity=".35"/><ellipse cx="26" cy="21" rx="2.2" ry="1.3" fill="#ff5d73" opacity=".35"/>`,
  // brows
  `<path d="M10.5 11.5l4.5-1M21 10.5l4.5 1" stroke-width="1.6" stroke-linecap="round"/>`,
  // freckles
  `<circle cx="10" cy="20.5" r=".7"/><circle cx="12" cy="21.5" r=".7"/><circle cx="24" cy="21.5" r=".7"/><circle cx="26" cy="20.5" r=".7"/>`,
  // tuft
  `<path d="M16 5.5c1-2 3-2.5 4.5-1.5M18 5.5c.5-1.5 2-2.5 4-2" fill="none" stroke-width="1.6" stroke-linecap="round"/>`,
];

const TILTS = [-8, -4, 0, 0, 4, 8];

/** The avatar's SVG markup for a seed. Same seed, same face, forever. */
export function faceSvg(seed: string): string {
  const pick = picker(seed);
  const disc = pick(DISCS);
  const eyes = pick(EYES);
  const mouth = pick(MOUTHS);
  const extra = pick(EXTRAS);
  const tilt = pick(TILTS);
  return (
    `<svg viewBox="0 0 36 36" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">` +
    `<circle cx="18" cy="18" r="18" fill="${disc}"/>` +
    `<g fill="${INK}" stroke="${INK}" stroke-width="0" transform="rotate(${tilt} 18 18)">${extra}${eyes}${mouth}</g>` +
    `</svg>`
  );
}
