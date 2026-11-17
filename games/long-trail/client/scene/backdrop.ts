// The land behind the caravan: sky, a far layer (a Kenney image when one is
// loaded, else drawn here), near hills and the ground with the path. Layers
// scroll at 0.15x, 0.4x and 1x. Every shape is flat, with a lighter rim on top
// in the Kenney style. The band paints its own sky, so it reads the same in
// light and dark themes.
import type { Art } from "./art.ts";
import type { Terrain } from "./model.ts";

type C = CanvasRenderingContext2D;
export interface View {
  w: number;
  h: number;
  ground: number; // y of the path, where feet stand
  s: number; // scale: 1 = a band 150 px tall
}

interface Palette {
  sky: [string, string]; // top, bottom
  far: string;
  near: string;
  rim: string; // the lighter top edge of hills and ground
  ground: string;
  path: string;
  prop: string;
  prop2: string;
}

const P = (sky: [string, string], far: string, near: string, rim: string, ground: string, path: string, prop: string, prop2: string): Palette => ({
  sky, far, near, rim, ground, path, prop, prop2,
});

export const PALETTES: Record<Terrain, Palette> = {
  desert: P(["#f3b874", "#fde6b6"], "#e9b47a", "#dc9a56", "#f6cf8f", "#ebbd78", "#d9a463", "#a7774a", "#9a8a45"),
  mountain: P(["#93bcd0", "#ecdcc0"], "#9b93ad", "#857469", "#a59487", "#ad9a82", "#cdb99c", "#6f625b", "#8a7c70"),
  river: P(["#8ec4d6", "#f1e2bc"], "#86b39c", "#6f9c69", "#93bd7f", "#bfae74", "#dcc793", "#5d8a3c", "#8a7f6a"),
  plain: P(["#a3cde0", "#f4e5bd"], "#a6bf8c", "#83a660", "#a3c27a", "#a9bb64", "#dcc78f", "#5f8f45", "#e0b84a"),
  town: P(["#e9a87a", "#fbe0b3"], "#cf9f7c", "#bd8662", "#d9a47a", "#ddb47c", "#c99b66", "#9b7552", "#b98a5e"),
  market: P(["#e9a87a", "#fbe0b3"], "#cf9f7c", "#bd8662", "#d9a47a", "#ddb47c", "#c99b66", "#9b7552", "#b98a5e"),
  gate: P(["#da8d6a", "#f8d8a6"], "#bd8b71", "#ab7458", "#c58f6e", "#d7aa74", "#c59462", "#8f6a4a", "#b08158"),
};
const NIGHT_SKY: [string, string] = ["#151a36", "#3d3d62"];
const NIGHT_SHADE = "rgba(16,20,48,0.45)";
const WATER = "#4f9fb8";
const WATER_LIGHT = "#86c9da";

/** A fixed random number 0..1 for tile `i`, so props stay put as they scroll. */
function rnd(i: number, k = 0): number {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}
const wave = (u: number) => 0.5 + 0.5 * Math.sin(u);
const tri = (u: number) => Math.abs(((u % 2) + 2) % 2 - 1); // 0..1..0

/** A filled skyline from a height function of world x, with a rim on top. */
function ridge(c: C, v: View, base: number, off: number, height: (u: number) => number, fill: string, rim?: string): void {
  const stepPx = 4;
  const trace = (dy: number, col: string) => {
    c.fillStyle = col;
    c.beginPath();
    c.moveTo(0, v.h);
    for (let x = 0; x <= v.w + stepPx; x += stepPx) c.lineTo(x, base + dy - height((x + off) / v.s) * v.s);
    c.lineTo(v.w + stepPx, v.h);
    c.closePath();
    c.fill();
  };
  if (rim) trace(0, rim);
  trace(rim ? 2 * v.s : 0, fill);
}

function imageWidth(img: CanvasImageSource): [number, number] {
  const m = img as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number };
  return [m.naturalWidth || m.width || 1, m.naturalHeight || m.height || 1];
}

function sky(c: C, v: View, colors: [string, string], night: boolean): void {
  const g = c.createLinearGradient(0, 0, 0, v.ground);
  g.addColorStop(0, colors[0]);
  g.addColorStop(1, colors[1]);
  c.fillStyle = g;
  c.fillRect(0, 0, v.w, v.h);
  if (night) return;
  c.fillStyle = "rgba(255,250,230,0.35)";
  c.beginPath();
  c.arc(v.w * 0.82, v.ground * 0.28, 15 * v.s, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#fff6dc";
  c.beginPath();
  c.arc(v.w * 0.82, v.ground * 0.28, 10 * v.s, 0, Math.PI * 2);
  c.fill();
}

function stars(c: C, v: View, maxY: number): void {
  c.fillStyle = "#f4efd8";
  for (let i = 0; i < 26; i++) {
    const y = rnd(i, 2) * maxY;
    const r = (rnd(i, 3) < 0.25 ? 1.1 : 0.6) * v.s;
    c.fillRect(rnd(i, 1) * v.w, y, r, r);
  }
  c.fillStyle = "#f6f1dc";
  c.beginPath();
  c.arc(v.w * 0.2, maxY * 0.5, 8 * v.s, 0, Math.PI * 2);
  c.fill();
}

function clouds(c: C, art: Art, v: View, off: number): void {
  if (!art.clouds.length) return;
  const gap = 170 * v.s;
  const first = Math.floor(off / gap) - 1;
  for (let i = first; i <= first + Math.ceil(v.w / gap) + 2; i++) {
    const img = art.clouds[Math.floor(rnd(i, 5) * art.clouds.length)]!;
    const [iw, ih] = imageWidth(img);
    const h = (16 + rnd(i, 6) * 8) * v.s;
    const x = i * gap - off + rnd(i, 7) * gap * 0.5;
    c.globalAlpha = 0.9;
    c.drawImage(img, x, (4 + rnd(i, 8) * 16) * v.s, (h * iw) / ih, h);
  }
  c.globalAlpha = 1;
}

/** The far layer's shape when there is no image for it. */
function farShape(t: Terrain): (u: number) => number {
  if (t === "desert") return (u) => 20 * wave(u / 60) ** 1.8 + 9 * wave(u / 23 + 1);
  if (t === "mountain") return (u) => 34 * tri(u / 70) + 10 * tri(u / 27);
  return (u) => 16 * wave(u / 55) + 7 * wave(u / 21 + 2);
}

function farLayer(c: C, art: Art, v: View, t: Terrain, horizon: number, off: number): void {
  const img = art.far[t];
  if (!img) {
    ridge(c, v, horizon, off, farShape(t), PALETTES[t].far);
    return;
  }
  const [iw, ih] = imageWidth(img);
  const h = horizon * (t === "mountain" ? 0.7 : 0.55);
  const w = (h * iw) / ih;
  const top = horizon - h + 3 * v.s;
  for (let x = -(((off % w) + w) % w); x < v.w; x += w) c.drawImage(img, x, top, w + 1, h);
}

function nearShape(t: Terrain): (u: number) => number {
  switch (t) {
    case "desert": return (u) => 14 * wave(u / 38) ** 2.2 + 5 * wave(u / 15);
    case "mountain": return (u) => 20 * tri(u / 34) + 7 * tri(u / 11);
    case "river": return (u) => 9 * wave(u / 46) + 4 * wave(u / 17);
    case "plain": return (u) => 11 * wave(u / 52) + 4 * wave(u / 19 + 1);
    default: return (u) => 6 * wave(u / 60) + 3 * wave(u / 25);
  }
}

/** Trees, rocks or town roofs that sit on the near hills. */
function nearProps(c: C, v: View, t: Terrain, horizon: number, off: number, shape: (u: number) => number): void {
  const p = PALETTES[t];
  const gap = (t === "town" || t === "market" || t === "gate" ? 22 : 30) * v.s;
  const first = Math.floor(off / gap) - 1;
  for (let i = first; i <= first + Math.ceil(v.w / gap) + 2; i++) {
    if (rnd(i, 11) < (t === "desert" || t === "mountain" ? 0.85 : 0.35)) continue;
    const x = i * gap - off + rnd(i, 12) * gap * 0.5;
    const y = horizon + 2 * v.s - shape((x + off) / v.s) * v.s;
    const k = 0.7 + rnd(i, 13) * 0.6;
    if (t === "plain" || t === "river") {
      c.fillStyle = "#6e5038";
      c.fillRect(x - 0.8 * v.s, y - 7 * k * v.s, 1.6 * v.s, 7 * k * v.s);
      dot(c, x, y - 9 * k * v.s, 4.5 * k * v.s, t === "river" ? "#4f7f45" : p.prop);
      dot(c, x - 2 * v.s, y - 8 * k * v.s, 3 * k * v.s, "rgba(255,255,255,0.12)");
    } else if (t === "town" || t === "market") {
      const bw = (8 + rnd(i, 14) * 8) * v.s;
      const bh = (6 + rnd(i, 15) * 10) * v.s;
      c.fillStyle = p.prop2;
      c.fillRect(x, y - bh, bw, bh + 4 * v.s);
      if (rnd(i, 16) > 0.6) dot(c, x + bw / 2, y - bh, bw * 0.35, p.prop2);
    } else if (t === "gate") {
      c.fillStyle = p.prop2;
      c.fillRect(x, y - 10 * v.s, 4 * v.s, 4 * v.s);
    } else {
      c.fillStyle = p.prop;
      c.beginPath();
      c.moveTo(x - 6 * k * v.s, y + v.s);
      c.lineTo(x - 2 * k * v.s, y - 6 * k * v.s);
      c.lineTo(x + 4 * k * v.s, y - 4 * k * v.s);
      c.lineTo(x + 7 * k * v.s, y + v.s);
      c.closePath();
      c.fill();
    }
  }
}

function dot(c: C, x: number, y: number, r: number, fill: string): void {
  c.fillStyle = fill;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
}

/** The path, straight, or split into two alike branches at a fork. */
function path(c: C, v: View, t: Terrain, off: number, fork: boolean): void {
  const p = PALETTES[t];
  const mid = v.ground - 0.5 * v.s;
  const thick = 11 * v.s;
  const splitX = fork ? v.w * 0.6 : v.w;
  c.fillStyle = p.path;
  c.fillRect(0, mid - thick / 2, splitX + 1, thick);
  if (fork) {
    c.strokeStyle = p.path;
    c.lineWidth = thick * 0.85;
    c.lineCap = "butt";
    for (const dir of [-1, 1]) {
      c.beginPath();
      c.moveTo(splitX - thick, mid);
      c.bezierCurveTo(splitX + 20 * v.s, mid, splitX + 30 * v.s, mid + dir * 9 * v.s, v.w + 4, mid + dir * 10 * v.s);
      c.stroke();
    }
  }
  // Stones in the path scroll with the ground.
  const gap = 15 * v.s;
  c.fillStyle = "rgba(0,0,0,0.08)";
  for (let i = Math.floor(off / gap) - 1; i * gap - off < splitX; i++) {
    const x = i * gap - off + rnd(i, 21) * gap;
    if (x > splitX - 4 * v.s) continue;
    c.fillRect(x, mid + (rnd(i, 22) - 0.5) * thick * 0.6, 2 * v.s, 1.2 * v.s);
  }
}

function groundProps(c: C, v: View, t: Terrain, horizon: number, off: number): void {
  const p = PALETTES[t];
  const gap = 24 * v.s;
  const back = [horizon + 4 * v.s, v.ground - 8 * v.s] as const;
  const front = [v.ground + 9 * v.s, v.h - 3 * v.s] as const;
  for (let i = Math.floor(off / gap) - 1; i * gap - off < v.w + gap; i++) {
    if (rnd(i, 31) < 0.3) continue;
    const zone = rnd(i, 32) < 0.5 || t === "river" ? front : back;
    if (zone[1] - zone[0] < 2 * v.s) continue;
    const x = i * gap - off + rnd(i, 33) * gap * 0.6;
    const y = zone[0] + rnd(i, 34) * (zone[1] - zone[0]);
    const k = v.s * (0.7 + rnd(i, 35) * 0.6);
    const kind = rnd(i, 36);
    if (t === "plain" || t === "river") {
      c.fillStyle = kind < 0.8 ? p.prop : p.prop2;
      for (const dx of [-2.5, 0, 2.5]) {
        c.beginPath();
        c.moveTo(x + dx * k - 1.2 * k, y);
        c.lineTo(x + dx * 1.6 * k, y - (dx ? 4 : 6) * k);
        c.lineTo(x + dx * k + 1.2 * k, y);
        c.closePath();
        c.fill();
      }
    } else if (t === "desert" && kind < 0.4) {
      dot(c, x, y - 2 * k, 2.4 * k, p.prop2);
      dot(c, x + 2.5 * k, y - 1.5 * k, 1.8 * k, p.prop2);
    } else if (t === "desert" && kind < 0.7) {
      c.fillStyle = p.rim;
      c.fillRect(x - 6 * k, y, 12 * k, 1 * k);
    } else {
      c.fillStyle = kind < 0.5 ? p.prop : p.prop2;
      c.beginPath();
      c.ellipse(x, y, 3.2 * k, 2 * k, 0, Math.PI, Math.PI * 2);
      c.fill();
    }
  }
}

function water(c: C, v: View, top: number, bottom: number, off: number): void {
  c.fillStyle = WATER;
  c.fillRect(0, top, v.w, bottom - top);
  c.fillStyle = WATER_LIGHT;
  const gap = 34 * v.s;
  for (let i = Math.floor(off / gap) - 1; i * gap - off < v.w; i++) {
    const x = i * gap - off + rnd(i, 41) * gap * 0.5;
    const y = top + (0.2 + rnd(i, 42) * 0.6) * (bottom - top);
    c.fillRect(x, y, (6 + rnd(i, 43) * 10) * v.s, 1.2 * v.s);
  }
  // Reeds along the near bank.
  c.fillStyle = PALETTES.river.prop;
  const rg = 19 * v.s;
  for (let i = Math.floor(off / rg) - 1; i * rg - off < v.w; i++) {
    if (rnd(i, 44) < 0.45) continue;
    const x = i * rg - off + rnd(i, 45) * rg;
    for (const dx of [-1.5, 0, 1.5]) {
      const h = (8 - Math.abs(dx) * 1.5) * v.s;
      c.fillRect(x + dx * v.s, bottom - h, 0.9 * v.s, h + 2 * v.s);
    }
    c.fillStyle = "#8a6440";
    c.fillRect(x - 0.5 * v.s, bottom - 8 * v.s, 1.6 * v.s, 2.6 * v.s);
    c.fillStyle = PALETTES.river.prop;
  }
}

export function drawBackdrop(c: C, art: Art, v: View, terrain: Terrain, scrollPx: number, opts: { fork: boolean; night: boolean }): void {
  const p = PALETTES[terrain];
  const river = terrain === "river";
  const horizon = v.ground - (river ? 30 : 18) * v.s;
  c.save();
  sky(c, v, opts.night ? NIGHT_SKY : p.sky, opts.night);
  if (!opts.night) clouds(c, art, v, scrollPx * 0.05);
  farLayer(c, art, v, terrain, horizon, scrollPx * 0.15);
  const near = nearShape(terrain);
  ridge(c, v, horizon + 2 * v.s, scrollPx * 0.4, near, p.near, p.rim);
  nearProps(c, v, terrain, horizon, scrollPx * 0.4, near);
  // The ground, with a lighter rim, then water, path and props.
  c.fillStyle = p.rim;
  c.fillRect(0, horizon, v.w, v.h - horizon);
  c.fillStyle = p.ground;
  c.fillRect(0, horizon + 2 * v.s, v.w, v.h - horizon);
  if (river) water(c, v, horizon + 4 * v.s, v.ground - 9 * v.s, scrollPx);
  path(c, v, terrain, scrollPx, opts.fork);
  groundProps(c, v, terrain, horizon, scrollPx);
  if (opts.night) {
    c.fillStyle = NIGHT_SHADE;
    c.fillRect(0, 0, v.w, v.h);
    stars(c, v, horizon * 0.4);
  }
  c.restore();
}
