import { macroHeight } from "../../shared/generate.ts";
import { pieceLabel } from "../../shared/templates.ts";
import type { TreasureLayout } from "../../shared/types.ts";
import { worldToMap, type MapView, type Overlay } from "./overlays.ts";

// The island as a picture. The base (ground, sea, trails) is painted once
// into a TEX² texture over the macro extent; draw() blits whatever part a
// view covers and puts the pieces and overlays on top in screen px, so their
// text stays sharp on the 300 m minimap and the whole-island map alike.

const TEX = 1024;

/** Godot's terrain_field.gd BIOME_COLORS, as 0–255, in BIOMES order. */
const BIOME_RGB: [number, number, number][] = [
  [115, 158, 77], // meadow
  [56, 107, 56], // forest
  [128, 122, 115], // rocky
  [89, 115, 82], // wetland
  [235, 240, 245], // snowcap
];
const SAND: [number, number, number] = [204, 189, 140];
const SEA_SHALLOW: [number, number, number] = [52, 116, 158];
const SEA_DEEP: [number, number, number] = [12, 38, 66];
const SAND_TOP = 1.5;
const TRAIL = "#c9a86a";
/** --accent: I'm the lime arrow. */
const ME = "#c6f432";
const INK = "#0e0e0c";
const WHITE = "#ffffff";

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Surface = OffscreenCanvas | HTMLCanvasElement;

function surface(w: number, h: number): Surface {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const mix = (a: readonly number[], b: readonly number[], t: number) => a.map((v, i) => v + (b[i]! - v) * t);

export class MapCanvas {
  private tex: Surface;
  private layout: TreasureLayout;
  /** World metres covered by the texture, from origin, on both axes. */
  private extent: number;

  constructor(layout: TreasureLayout) {
    this.layout = layout;
    this.extent = layout.macro.cell * (layout.macro.size - 1);
    this.tex = surface(TEX, TEX);
    const ctx = this.tex.getContext("2d") as Ctx2D;
    this.paintGround(ctx);
    this.paintTrails(ctx);
  }

  /** The layout this was painted from. */
  get seed() {
    return this.layout.seed;
  }

  /** The view's part of the base, then the pieces, then the overlays (in order). */
  draw(ctx: CanvasRenderingContext2D, view: MapView, overlays: readonly Overlay[]) {
    const { w, h } = view;
    const s = Math.min(w, h) / view.metresAcross;
    const k = TEX / this.extent;
    const o = this.layout.macro.origin;
    ctx.fillStyle = `rgb(${SEA_DEEP.join(" ")})`;
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    // Clamp the source rect to the texture by hand: browsers disagree on a rect that runs off it.
    const x0 = view.cx - w / 2 / s;
    const z0 = view.cz - h / 2 / s;
    const sx0 = Math.max(0, (x0 - o) * k);
    const sy0 = Math.max(0, (z0 - o) * k);
    const sx1 = Math.min(TEX, (x0 + w / s - o) * k);
    const sy1 = Math.min(TEX, (z0 + h / s - o) * k);
    if (sx1 > sx0 && sy1 > sy0) {
      const d = worldToMap({ x: o + sx0 / k, z: o + sy0 / k }, view);
      ctx.drawImage(this.tex, sx0, sy0, sx1 - sx0, sy1 - sy0, d.px, d.py, ((sx1 - sx0) / k) * s, ((sy1 - sy0) / k) * s);
    }

    ctx.font = "600 11px 'Space Grotesk', system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    for (const p of this.layout.pieces) {
      const at = worldToMap(p, view);
      if (at.px < -80 || at.py < -10 || at.px > w + 10 || at.py > h + 10) continue;
      ctx.beginPath();
      ctx.arc(at.px, at.py, 3, 0, Math.PI * 2);
      ctx.fillStyle = WHITE;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = INK;
      ctx.stroke();
      const label = pieceLabel(p);
      ctx.lineWidth = 3;
      ctx.strokeText(label, at.px + 6, at.py);
      ctx.fillText(label, at.px + 6, at.py);
    }

    // Pins under dots under me.
    const rank = { pin: 0, dot: 1, me: 2 } as const;
    for (const ov of [...overlays].sort((a, b) => rank[a.kind] - rank[b.kind])) {
      const at = worldToMap(ov, view);
      if (ov.kind === "pin") this.pin(ctx, at.px, at.py, ov.color, ov.mine);
      else if (ov.kind === "dot") this.dot(ctx, at.px, at.py, ov.color, ov.mate);
      else this.me(ctx, at.px, at.py, ov.yaw);
    }
  }

  private pin(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, mine: boolean) {
    const r = 4;
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = INK;
    ctx.stroke();
    if (!mine) return;
    ctx.beginPath();
    ctx.arc(x, y, r + 3, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  private dot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, mate: boolean) {
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = mate ? 2 : 1;
    ctx.strokeStyle = mate ? WHITE : INK;
    ctx.stroke();
  }

  /**
   * Godot's yaw: 0 faces −Z (up here) and positive turns left, so forward is
   * (−sin yaw, −cos yaw) in XZ, the same as the compass reads it.
   */
  private me(ctx: CanvasRenderingContext2D, x: number, y: number, yaw: number) {
    const fx = -Math.sin(yaw);
    const fy = -Math.cos(yaw);
    // Right of forward on screen (y down): (−fy, fx).
    const rx = -fy;
    const ry = fx;
    ctx.beginPath();
    ctx.moveTo(x + fx * 9, y + fy * 9);
    ctx.lineTo(x - fx * 6 + rx * 6, y - fy * 6 + ry * 6);
    ctx.lineTo(x - fx * 3, y - fy * 3);
    ctx.lineTo(x - fx * 6 - rx * 6, y - fy * 6 - ry * 6);
    ctx.closePath();
    ctx.fillStyle = ME;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }

  /** Biome tint × height brightness × hillshade from the NW; sea by depth. */
  private paintGround(ctx: Ctx2D) {
    const l = this.layout;
    const { origin, cell, size, biomes } = l.macro;
    const m = this.extent / TEX;
    const hts = new Float32Array(TEX * TEX);
    for (let j = 0; j < TEX; j++) {
      for (let i = 0; i < TEX; i++) hts[j * TEX + i] = macroHeight(l, origin + (i + 0.5) * m, origin + (j + 0.5) * m);
    }
    // Light from the NW and above: (−x, +y, −z), normalised.
    const lx = -0.5;
    const ly = 0.7071;
    const lz = -0.5;
    const img = new ImageData(TEX, TEX);
    const px = img.data;
    const biomeAt = (a: number, b: number) => BIOME_RGB[biomes[Math.min(size - 1, b) * size + Math.min(size - 1, a)]!] ?? BIOME_RGB[0]!;
    for (let j = 0; j < TEX; j++) {
      for (let i = 0; i < TEX; i++) {
        const h = hts[j * TEX + i]!;
        let rgb: number[];
        if (h < 0) {
          rgb = mix(SEA_SHALLOW, SEA_DEEP, clamp01(-h / 30));
        } else {
          // Biome colour, blended between the four grid vertices like Godot's.
          const fx = ((i + 0.5) * m) / cell;
          const fz = ((j + 0.5) * m) / cell;
          const a = Math.min(size - 2, Math.floor(fx));
          const b = Math.min(size - 2, Math.floor(fz));
          const top = mix(biomeAt(a, b), biomeAt(a + 1, b), fx - a);
          const bot = mix(biomeAt(a, b + 1), biomeAt(a + 1, b + 1), fx - a);
          rgb = mix(top, bot, fz - b);
          if (h < SAND_TOP) rgb = mix(SAND, rgb, h / SAND_TOP);
          // Slope from neighbours, in metres per metre.
          const e = hts[j * TEX + Math.min(TEX - 1, i + 1)]!;
          const w = hts[j * TEX + Math.max(0, i - 1)]!;
          const s = hts[Math.min(TEX - 1, j + 1) * TEX + i]!;
          const n = hts[Math.max(0, j - 1) * TEX + i]!;
          const dx = (e - w) / (2 * m);
          const dz = (s - n) / (2 * m);
          const len = Math.hypot(dx, 1, dz);
          const lam = (-dx * lx + ly - dz * lz) / len;
          const shade = (0.45 + 0.75 * clamp01(lam)) * (0.85 + 0.3 * clamp01(h / 150));
          rgb = rgb.map((c) => c * shade);
        }
        const o = (j * TEX + i) * 4;
        px[o] = rgb[0]!;
        px[o + 1] = rgb[1]!;
        px[o + 2] = rgb[2]!;
        px[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  private paintTrails(ctx: Ctx2D) {
    const k = TEX / this.extent;
    const o = this.layout.macro.origin;
    ctx.strokeStyle = TRAIL;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const t of this.layout.trails) {
      ctx.beginPath();
      t.pts.forEach(([x, z], n) => (n === 0 ? ctx.moveTo((x - o) * k, (z - o) * k) : ctx.lineTo((x - o) * k, (z - o) * k)));
      ctx.stroke();
    }
  }
}
