// The isometric board: projection, draw order, hit testing, camera and the
// little bits of motion. It draws what it's given and reports taps; it knows
// nothing about legality (§15: art never decides a move).
//
// Grid → screen: +col = (+48, +24), +row = (−48, +24) at zoom 1. A tile's
// ground anchor is the centre of its 96×48 diamond.

import { motionAllowed } from "@games/animation";
import { colOf, indexOf, rowOf } from "../shared/grid.ts";
import type { AttackOption, FactionKind, KnownCity, KnownTile, KnownUnit, Terrain } from "../shared/types.ts";
import { SpriteCache, type Raster, type SpriteKey } from "./assets.ts";

export const HALF_W = 48;
export const HALF_H = 24;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.5;
const DRAG_THRESHOLD = 8;
const MOVE_MS = 260;
const EFFECT_MS = 650;
const POKE_MS = 450;

export interface PlayerLook {
  color: string;
  kind: FactionKind;
  name: string;
}

export interface BoardModel {
  size: number;
  tiles: (KnownTile | null)[];
  units: KnownUnit[];
  cities: KnownCity[];
  players: Map<string, PlayerLook>;
  me: string;
  /** Own units with something left to do; they get a marker. */
  idle: Set<string>;
}

export interface Highlights {
  selected: number | null;
  moves: Set<number>;
  attacks: Map<number, AttackOption>;
  /** Attack target waiting for its confirming tap. */
  armed: number | null;
  /** Keyboard cursor. */
  cursor: number | null;
}

const NO_HIGHLIGHTS: Highlights = { selected: null, moves: new Set(), attacks: new Map(), armed: null, cursor: null };

const VARIANTS: Record<Terrain, string[]> = {
  plains: ["terrain.plains.default", "terrain.plains.v2", "terrain.plains.v3"],
  forest: ["terrain.forest.default", "terrain.forest.v2"],
  mountain: ["terrain.mountain.default", "terrain.mountain.v2"],
  shallow: ["terrain.water.shallow.default", "terrain.water.shallow.v2"],
  ocean: ["terrain.ocean.default", "terrain.ocean.v2"],
};

/** Flat colours for when terrain art is missing. */
const TERRAIN_FALLBACK: Record<Terrain, string> = {
  plains: "#6BAA3E",
  forest: "#3F7A32",
  mountain: "#A8A49B",
  shallow: "#5FD0D8",
  ocean: "#2A6FC4",
};

/** Grid direction → road sprite suffix (see road.center.svg). */
const ROAD_DIRS: [number, number, string][] = [
  [-1, 0, "n"], [-1, 1, "ne"], [0, 1, "e"], [1, 1, "se"], [1, 0, "s"], [1, -1, "sw"], [0, -1, "w"], [-1, -1, "nw"],
];

const UNIT_LABEL: Record<string, string> = {
  infantry: "INF", cavalry: "CAV", archer: "ARC", defender: "DEF", swordsman: "SWD", champion: "CHP",
};

interface Tween {
  from: [number, number];
  to: [number, number];
  t0: number;
}

interface Effect {
  sprite?: string;
  text?: string;
  color?: string;
  at: number;
  t0: number;
}

export function terrainSprite(t: Terrain, i: number, size: number): string {
  const list = VARIANTS[t];
  return list[(rowOf(i, size) * 3 + colOf(i, size) * 5) % list.length]!;
}

/** Light or dark text, whichever reads on `hex`. */
export function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 150 ? "#141414" : "#ffffff";
}

export class Board {
  readonly canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private cache: SpriteCache;
  private model: BoardModel | null = null;
  private hl: Highlights = NO_HIGHLIGHTS;
  private cam = { x: 0, y: 0, zoom: 1 };
  private width = 0;
  private height = 0;
  private dpr = 1;
  private frame = 0;
  private resize = new ResizeObserver(() => this.fit());
  private tweens = new Map<string, Tween>();
  private effects: Effect[] = [];
  private pokes = new Map<number, number>();
  private idlers: (() => void)[] = [];
  private rescale = 0;

  // Pointer state: one finger pans, two pinch.
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: { x: number; y: number; camX: number; camY: number; moved: boolean } | null = null;
  private pinch: { dist: number; zoom: number } | null = null;

  private readonly onTap: (tile: number) => void;

  constructor(onTap: (tile: number) => void) {
    this.onTap = onTap;
    this.cache = new SpriteCache(2, () => this.invalidate());
    this.canvas.className = "dm-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
  }

  mount(container: HTMLElement): void {
    container.append(this.canvas);
    this.resize.observe(container);
    this.fit();
  }

  destroy(): void {
    this.resize.disconnect();
    cancelAnimationFrame(this.frame);
    this.canvas.remove();
  }

  setModel(model: BoardModel): void {
    this.model = model;
    this.invalidate();
  }

  setHighlights(hl: Highlights): void {
    this.hl = hl;
    this.invalidate();
  }

  // ---- projection ---------------------------------------------------------

  /** Ground anchor of a tile in world pixels (zoom 1). */
  world(i: number): [number, number] {
    const size = this.model?.size ?? 1;
    const r = rowOf(i, size);
    const c = colOf(i, size);
    return [(c - r) * HALF_W, (c + r) * HALF_H];
  }

  private toScreen(wx: number, wy: number): [number, number] {
    return [(wx - this.cam.x) * this.cam.zoom + this.width / 2, (wy - this.cam.y) * this.cam.zoom + this.height / 2];
  }

  tileAt(sx: number, sy: number): number | null {
    if (!this.model) return null;
    const wx = (sx - this.width / 2) / this.cam.zoom + this.cam.x;
    const wy = (sy - this.height / 2) / this.cam.zoom + this.cam.y;
    const u = wx / HALF_W;
    const v = wy / HALF_H;
    const c = Math.round((u + v) / 2);
    const r = Math.round((v - u) / 2);
    const size = this.model.size;
    return r >= 0 && c >= 0 && r < size && c < size ? indexOf(r, c, size) : null;
  }

  /** `raise` lifts the tile that many screen px above centre (to clear an overlay). */
  centerOn(i: number, raise = 0): void {
    const [x, y] = this.world(i);
    this.cam.x = x;
    this.cam.y = y + raise / this.cam.zoom;
    this.clampCamera();
    this.invalidate();
  }

  /** Pans just enough that a tile isn't hidden under `bottomInset` px of overlay. */
  keepClear(i: number, bottomInset: number): void {
    const [, sy] = this.toScreen(...this.world(i));
    const limit = this.height - bottomInset - 40 * this.cam.zoom;
    if (sy <= limit) return;
    this.cam.y += (sy - limit) / this.cam.zoom;
    this.clampCamera();
    this.invalidate();
  }

  /** Whether a tile's anchor is comfortably on screen. */
  isOnScreen(i: number): boolean {
    const [sx, sy] = this.toScreen(...this.world(i));
    const m = 60;
    return sx > m && sy > m && sx < this.width - m && sy < this.height - m;
  }

  zoomBy(factor: number, sx = this.width / 2, sy = this.height / 2): void {
    const before = [(sx - this.width / 2) / this.cam.zoom + this.cam.x, (sy - this.height / 2) / this.cam.zoom + this.cam.y];
    this.cam.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.cam.zoom * factor));
    // Keep the point under the cursor where it was.
    this.cam.x = before[0]! - (sx - this.width / 2) / this.cam.zoom;
    this.cam.y = before[1]! - (sy - this.height / 2) / this.cam.zoom;
    this.clampCamera();
    this.scheduleRescale();
    this.invalidate();
  }

  private clampCamera(): void {
    const size = this.model?.size ?? 16;
    this.cam.x = Math.min(size * HALF_W, Math.max(-size * HALF_W, this.cam.x));
    this.cam.y = Math.min(size * 2 * HALF_H, Math.max(0, this.cam.y));
  }

  private fit(): void {
    const box = this.canvas.parentElement?.getBoundingClientRect();
    if (!box) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.width = box.width;
    this.height = box.height;
    this.canvas.width = Math.round(box.width * this.dpr);
    this.canvas.height = Math.round(box.height * this.dpr);
    this.canvas.style.width = `${box.width}px`;
    this.canvas.style.height = `${box.height}px`;
    this.scheduleRescale();
    this.invalidate();
  }

  /** Raster sharpness follows zoom, but only once zooming settles. */
  private scheduleRescale(): void {
    clearTimeout(this.rescale);
    this.rescale = window.setTimeout(() => {
      const want = Math.min(4, Math.max(1, Math.ceil(this.cam.zoom * this.dpr * 2) / 2));
      this.cache.setScale(want);
      this.invalidate();
    }, 200);
  }

  // ---- motion -------------------------------------------------------------

  animateMove(unitId: string, from: number, to: number): void {
    if (!motionAllowed()) return;
    this.tweens.set(unitId, { from: this.world(from), to: this.world(to), t0: performance.now() });
    this.invalidate();
  }

  effect(at: number, sprite: string): void {
    if (!motionAllowed()) return;
    this.effects.push({ sprite, at, t0: performance.now() });
    this.invalidate();
  }

  floatText(at: number, text: string, color: string): void {
    if (!motionAllowed()) return;
    this.effects.push({ text, color, at, t0: performance.now() });
    this.invalidate();
  }

  /** Resolves once every tween and effect has played out. */
  idle(): Promise<void> {
    if (!this.tweens.size && !this.effects.length) return Promise.resolve();
    return new Promise((resolve) => this.idlers.push(resolve));
  }

  // ---- input --------------------------------------------------------------

  private local(e: PointerEvent | WheelEvent): [number, number] {
    const box = this.canvas.getBoundingClientRect();
    return [e.clientX - box.left, e.clientY - box.top];
  }

  private onPointerDown = (e: PointerEvent) => {
    this.canvas.setPointerCapture(e.pointerId);
    const [x, y] = this.local(e);
    this.pointers.set(e.pointerId, { x, y });
    if (this.pointers.size === 1) {
      this.drag = { x, y, camX: this.cam.x, camY: this.cam.y, moved: false };
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), zoom: this.cam.zoom };
      if (this.drag) this.drag.moved = true; // a pinch is never a tap
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    const [x, y] = this.local(e);
    this.pointers.set(e.pointerId, { x, y });
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const target = this.pinch.zoom * (dist / this.pinch.dist);
      this.zoomBy(target / this.cam.zoom, (a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
      return;
    }
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(x - d.x, y - d.y) > DRAG_THRESHOLD) d.moved = true;
    if (d.moved) {
      this.cam.x = d.camX - (x - d.x) / this.cam.zoom;
      this.cam.y = d.camY - (y - d.y) / this.cam.zoom;
      this.clampCamera();
      this.invalidate();
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    const d = this.drag;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size > 0) return;
    this.drag = null;
    if (d && !d.moved && e.type === "pointerup") {
      const [x, y] = this.local(e);
      const tile = this.tileAt(x, y);
      if (tile !== null) this.onTap(tile);
    }
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const [x, y] = this.local(e);
    this.zoomBy(Math.exp(-e.deltaY * 0.0015), x, y);
  };

  // ---- drawing ------------------------------------------------------------

  invalidate(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private sprite(key: SpriteKey, i: number, lift = 0, alpha = 1, offset: [number, number] = [0, 0]): boolean {
    const r = this.cache.get(key);
    if (!r) return false;
    const [wx, wy] = this.world(i);
    this.blit(r, wx + offset[0], wy + offset[1] - lift, alpha);
    return true;
  }

  private blit(r: Raster, wx: number, wy: number, alpha = 1): void {
    const [sx, sy] = this.toScreen(wx, wy);
    const z = this.cam.zoom;
    const ctx = this.ctx;
    if (alpha !== 1) ctx.globalAlpha = alpha;
    ctx.drawImage(r.canvas, sx - r.ax * z, sy - r.ay * z, r.w * z, r.h * z);
    if (alpha !== 1) ctx.globalAlpha = 1;
  }

  private diamond(i: number, inset = 0): Path2D {
    const [sx, sy] = this.toScreen(...this.world(i));
    const w = (HALF_W - inset * 2) * this.cam.zoom;
    const h = (HALF_H - inset) * this.cam.zoom;
    const p = new Path2D();
    p.moveTo(sx, sy - h);
    p.lineTo(sx + w, sy);
    p.lineTo(sx, sy + h);
    p.lineTo(sx - w, sy);
    p.closePath();
    return p;
  }

  private draw(): void {
    const ctx = this.ctx;
    const m = this.model;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Night sea under everything; the world floats on it.
    const sea = ctx.createRadialGradient(this.width / 2, this.height * 0.45, 0, this.width / 2, this.height / 2, Math.max(this.width, this.height) * 0.75);
    sea.addColorStop(0, "#1c2938");
    sea.addColorStop(1, "#0d141d");
    ctx.fillStyle = sea;
    ctx.fillRect(0, 0, this.width, this.height);
    if (!m) return;
    const now = performance.now();
    const size = m.size;
    const z = this.cam.zoom;

    // Back to front: by row+col, then col (STYLE.md draw order).
    const order: number[] = [];
    for (let s = 0; s <= 2 * (size - 1); s++) {
      for (let c = Math.max(0, s - size + 1); c <= Math.min(size - 1, s); c++) order.push(indexOf(s - c, c, size));
    }
    const visible = order.filter((i) => {
      const [sx, sy] = this.toScreen(...this.world(i));
      return sx > -HALF_W * 2 * z && sx < this.width + HALF_W * 2 * z && sy > -HALF_H * 4 * z && sy < this.height + HALF_H * 8 * z;
    });

    const cityAt = new Map(m.cities.map((c) => [c.at, c]));
    const unitAt = new Map(m.units.map((u) => [u.at, u]));
    const colorOf = (id: string | null) => (id ? (m.players.get(id)?.color ?? "#9e9e9e") : "#9e9e9e");

    // 1. Ground. Cities carry their own ground.
    for (const i of visible) {
      const t = m.tiles[i];
      if (!t) continue; // clouds, drawn with the props so they occlude properly
      if (cityAt.has(i) && this.cache.has(this.citySprite(cityAt.get(i)!))) continue;
      const id = terrainSprite(t.t, i, size);
      if (!this.sprite({ id, layer: "ground", dim: !t.vis }, i)) {
        ctx.fillStyle = TERRAIN_FALLBACK[t.t];
        ctx.fill(this.diamond(i));
        if (!t.vis) {
          ctx.fillStyle = "rgba(14,16,24,0.5)";
          ctx.fill(this.diamond(i));
        }
      }
    }

    // Territory: a wash of the owner's colour and a border where it changes.
    ctx.lineWidth = Math.max(1.5, 2.5 * z);
    ctx.lineJoin = "round";
    for (const i of visible) {
      const t = m.tiles[i];
      if (!t?.owner) continue;
      const color = colorOf(t.owner);
      ctx.globalAlpha = t.vis ? 0.16 : 0.08;
      ctx.fillStyle = color;
      ctx.fill(this.diamond(i));
      ctx.globalAlpha = t.vis ? 0.95 : 0.5;
      this.borders(i, t.owner, color);
      ctx.globalAlpha = 1;
    }

    // 2. Roads, their own pass: diagonal ends spill onto neighbours.
    for (const i of visible) {
      const t = m.tiles[i];
      if (!t?.road || cityAt.has(i)) continue;
      this.sprite({ id: "road.center", dim: !t.vis }, i);
      const r = rowOf(i, size);
      const c = colOf(i, size);
      for (const [dr, dc, dir] of ROAD_DIRS) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const j = indexOf(rr, cc, size);
        if (m.tiles[j]?.road || cityAt.has(j)) this.sprite({ id: `road.${dir}`, dim: !t.vis }, i);
      }
    }

    // Move targets sit on the ground, under props and units.
    for (const i of this.hl.moves) {
      ctx.fillStyle = "rgba(255,255,255,0.28)";
      ctx.fill(this.diamond(i, 3));
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      ctx.lineWidth = Math.max(1, 1.5 * z);
      ctx.stroke(this.diamond(i, 3));
    }

    // 3. Per tile: props, overlay, city, unit.
    const tweening = new Map<string, [number, number]>();
    for (const [id, tw] of this.tweens) {
      const k = Math.min(1, (now - tw.t0) / MOVE_MS);
      if (k >= 1) {
        this.tweens.delete(id);
        continue;
      }
      const e = 1 - (1 - k) * (1 - k);
      const hop = Math.sin(k * Math.PI) * 10;
      tweening.set(id, [tw.from[0] + (tw.to[0] - tw.from[0]) * e, tw.from[1] + (tw.to[1] - tw.from[1]) * e - hop]);
    }

    for (const i of visible) {
      const t = m.tiles[i];
      if (!t) {
        this.cloud(i);
        continue;
      }
      const dim = !t.vis;
      const city = cityAt.get(i);
      if (!city) this.sprite({ id: terrainSprite(t.t, i, size), layer: "props", dim }, i);
      const overlay = t.feat ? `feature.${t.feat}.default` : t.imp ? `improvement.${t.imp}.default` : t.res ? `resource.${t.res}.default` : null;
      if (overlay && !city && !this.sprite({ id: overlay, dim }, i)) this.placeholderMark(i, overlay.split(".")[1]!.slice(0, 3).toUpperCase());
      if (city) this.drawCity(city, colorOf(city.owner), !city.vis);
      const unit = unitAt.get(i);
      if (unit) {
        const tw = tweening.get(unit.id);
        this.drawUnit(unit, colorOf(unit.owner), tw);
      }
    }

    // Attack targets, selection and cursor ride on top.
    for (const [i, opt] of this.hl.attacks) {
      const armed = this.hl.armed === i;
      ctx.strokeStyle = armed ? "#ff3b30" : "rgba(255,90,80,0.9)";
      ctx.lineWidth = Math.max(2, (armed ? 4 : 2.5) * z);
      ctx.stroke(this.diamond(i, 2));
      this.badge(i, `−${opt.damage}`, armed ? "#ff3b30" : "#c62828", "#fff", -58);
    }
    if (this.hl.selected !== null) {
      ctx.strokeStyle = "#c6f432";
      ctx.lineWidth = Math.max(2, 3 * z);
      ctx.stroke(this.diamond(this.hl.selected, 1));
    }
    if (this.hl.cursor !== null) {
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke(this.diamond(this.hl.cursor, 1));
      ctx.setLineDash([]);
    }

    // City names last, so nothing covers them.
    for (const i of visible) {
      const city = cityAt.get(i);
      if (city) this.cityLabel(city, colorOf(city.owner));
    }

    // Effects and floating numbers.
    this.effects = this.effects.filter((fx) => now - fx.t0 < EFFECT_MS);
    for (const fx of this.effects) {
      const k = (now - fx.t0) / EFFECT_MS;
      if (fx.sprite) {
        const r = this.cache.get({ id: fx.sprite });
        const [wx, wy] = this.world(fx.at);
        if (r) this.blit(r, wx, wy - 34 - k * 8, 1 - k * k);
      } else if (fx.text) {
        const [sx, sy] = this.toScreen(...this.world(fx.at));
        ctx.globalAlpha = 1 - k * k;
        ctx.font = `700 ${Math.round(16 * Math.max(0.8, z))}px "Space Grotesk", system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        const y = sy - (60 + k * 30) * z;
        ctx.strokeText(fx.text, sx, y);
        ctx.fillStyle = fx.color ?? "#fff";
        ctx.fillText(fx.text, sx, y);
        ctx.globalAlpha = 1;
      }
    }

    if (this.tweens.size || this.effects.length || this.pokes.size) this.invalidate();
    else for (const resolve of this.idlers.splice(0)) resolve();
  }

  /**
   * Unexplored land: a faceted cloud, in the art's own rules (flat tones,
   * light from the upper left). Heights vary a little so the fog reads as a
   * sea of cloud rather than a grid.
   */
  private cloud(i: number): void {
    const ctx = this.ctx;
    const z = this.cam.zoom;
    const [sx, sy] = this.toScreen(...this.world(i));
    const hash = (Math.imul(i + 1, 2654435761) >>> 0) % 7;
    // Low to the ground, so the cloud's diamond sits almost on its tile's.
    const poke = this.pokes.get(i);
    const k = poke === undefined ? 1 : Math.min(1, (performance.now() - poke) / POKE_MS);
    if (k >= 1) this.pokes.delete(i);
    // A tapped cloud hops and settles: a damped bounce.
    const bounce = k < 1 ? Math.sin(k * Math.PI * 2.5) * (1 - k) * 7 * z : 0;
    const lift = (3 + (hash % 3)) * z + bounce;
    const puff = (1 + (hash % 3) * 0.5) * z + Math.max(0, bounce) * 0.4;
    const w = HALF_W * z;
    const h = HALF_H * z;
    const T: [number, number] = [sx, sy - h - lift];
    const R: [number, number] = [sx + w, sy - lift];
    const B: [number, number] = [sx, sy + h - lift];
    const L: [number, number] = [sx - w, sy - lift];
    const C: [number, number] = [sx, sy - lift - puff];
    const poly = (fill: string, ...pts: [number, number][]) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(...pts[0]!);
      for (const p of pts.slice(1)) ctx.lineTo(...p);
      ctx.closePath();
      ctx.fill();
    };
    // Sides down to the ground, then the top as four facets around a raised centre.
    poly("#3a4a5f", L, B, [B[0], B[1] + lift], [L[0], L[1] + lift]);
    poly("#2f3d50", B, R, [R[0], R[1] + lift], [B[0], B[1] + lift]);
    poly("#55687f", T, R, B, L);
    poly("#62768e", L, T, C);
    poly("#5b6e86", T, R, C);
    poly("#55687f", L, C, B);
    poly("#4e6078", C, R, B);
  }

  /** A small hop on a fogged tile, to say "nothing to select here" without words. */
  poke(i: number): void {
    if (!motionAllowed()) return;
    this.pokes.set(i, performance.now());
    this.invalidate();
  }

  setZoom(zoom: number): void {
    this.cam.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    this.scheduleRescale();
    this.invalidate();
  }

  /** Border edges where the neighbouring tile has a different owner. */
  private borders(i: number, owner: string, color: string): void {
    const m = this.model!;
    const size = m.size;
    const r = rowOf(i, size);
    const c = colOf(i, size);
    const [sx, sy] = this.toScreen(...this.world(i));
    const z = this.cam.zoom;
    const inset = 3;
    const top: [number, number] = [sx, sy - (HALF_H - inset) * z];
    const right: [number, number] = [sx + (HALF_W - inset * 2) * z, sy];
    const bottom: [number, number] = [sx, sy + (HALF_H - inset) * z];
    const left: [number, number] = [sx - (HALF_W - inset * 2) * z, sy];
    // Grid neighbour → the diamond edge it shares.
    const edges: [number, number, [number, number], [number, number]][] = [
      [-1, 0, top, right],
      [0, 1, right, bottom],
      [1, 0, bottom, left],
      [0, -1, left, top],
    ];
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.beginPath();
    for (const [dr, dc, a, b] of edges) {
      const rr = r + dr;
      const cc = c + dc;
      const other = rr >= 0 && cc >= 0 && rr < size && cc < size ? m.tiles[indexOf(rr, cc, size)]?.owner : null;
      if (other === owner) continue;
      ctx.moveTo(...a);
      ctx.lineTo(...b);
    }
    ctx.stroke();
  }

  private citySprite(city: KnownCity): string {
    const kind = city.owner ? (this.model!.players.get(city.owner)?.kind ?? "orchard") : "orchard";
    return `city.${kind}.tier1`;
  }

  private drawCity(city: KnownCity, color: string, dim: boolean): void {
    const ok = this.sprite({ id: this.citySprite(city), color: city.owner ? color : "#9e9e9e", dim }, city.at);
    if (ok) return;
    // Placeholder: a flat house, owner colour.
    const ctx = this.ctx;
    const [sx, sy] = this.toScreen(...this.world(city.at));
    const z = this.cam.zoom;
    ctx.fillStyle = "#6BAA3E";
    ctx.fill(this.diamond(city.at));
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(sx - 20 * z, sy);
    ctx.lineTo(sx - 20 * z, sy - 22 * z);
    ctx.lineTo(sx, sy - 38 * z);
    ctx.lineTo(sx + 20 * z, sy - 22 * z);
    ctx.lineTo(sx + 20 * z, sy);
    ctx.closePath();
    ctx.fill();
  }

  private drawUnit(unit: KnownUnit, color: string, at?: [number, number]): void {
    const m = this.model!;
    const kind = m.players.get(unit.owner)?.kind ?? "orchard";
    const id = `unit.${unit.type}.${kind}.idle`;
    const [wx, wy] = at ?? this.world(unit.at);
    const r = this.cache.get({ id, color });
    const z = this.cam.zoom;
    const ctx = this.ctx;
    if (r) {
      this.blit(r, wx, wy + 6);
    } else {
      // Role-labelled placeholder until real art exists for this unit.
      const [sx, sy] = this.toScreen(wx, wy);
      ctx.fillStyle = color;
      ctx.strokeStyle = "#141414";
      ctx.lineWidth = 2;
      const w = 30 * z;
      const h = 40 * z;
      ctx.beginPath();
      ctx.roundRect(sx - w / 2, sy - h, w, h, 6 * z);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = inkOn(color);
      ctx.font = `700 ${Math.round(10 * Math.max(0.8, z))}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(UNIT_LABEL[unit.type] ?? "?", sx, sy - h / 2 + 4 * z);
    }
    // HP pill in the owner's colour, plus a veteran chevron.
    const [sx, sy] = this.toScreen(wx, wy);
    const label = `${unit.hp}${unit.veteran ? "★" : ""}`;
    this.pill(sx + 18 * z, sy + 2 * z, label, color, inkOn(color));
    if (unit.owner === m.me && m.idle.has(unit.id)) {
      ctx.fillStyle = "#c6f432";
      ctx.strokeStyle = "#141a00";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sx, sy - 58 * z, Math.max(3, 4.5 * z), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  private pill(cx: number, cy: number, text: string, bg: string, fg: string): void {
    const ctx = this.ctx;
    const z = this.cam.zoom;
    const fs = Math.round(11 * Math.min(1.4, Math.max(0.8, z)));
    ctx.font = `700 ${fs}px "Space Grotesk", system-ui, sans-serif`;
    const w = ctx.measureText(text).width + fs * 0.8;
    const h = fs * 1.35;
    ctx.fillStyle = bg;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, cy - h / 2, w, h, h / 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, cx, cy + 0.5);
    ctx.textBaseline = "alphabetic";
  }

  private badge(i: number, text: string, bg: string, fg: string, lift: number): void {
    const [sx, sy] = this.toScreen(...this.world(i));
    this.pill(sx, sy + lift * this.cam.zoom, text, bg, fg);
  }

  private cityLabel(city: KnownCity, color: string): void {
    const [sx, sy] = this.toScreen(...this.world(city.at));
    const z = this.cam.zoom;
    const name = `${city.capital ? "◆ " : ""}${city.name} · ${city.level}`;
    this.ctx.globalAlpha = city.vis ? 1 : 0.7;
    this.pill(sx, sy + 30 * z, name, city.owner ? color : "#5f5f5f", city.owner ? inkOn(color) : "#fff");
    this.ctx.globalAlpha = 1;
  }

  private placeholderMark(i: number, label: string): void {
    const [sx, sy] = this.toScreen(...this.world(i));
    this.pill(sx, sy - 6 * this.cam.zoom, label, "#fff7d6", "#3a2e00");
  }
}
