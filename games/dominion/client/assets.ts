// Asset loading (Part 1 owns the loader and validator). Gameplay asks for
// stable sprite IDs; this file maps them to art, tints ownership masks with the
// player's colour, splits terrain into ground/props layers, and rasterises.
// Anything missing or broken becomes a labelled placeholder, never a crash.

import manifestJson from "./assets/manifest.json";

export interface SpriteEntry {
  url: string;
  size: [number, number];
  /** Normalised ground anchor. */
  anchor: [number, number];
  bounds: [number, number, number, number];
  ownerMask?: string;
  layers?: string[];
}

export interface AssetManifest {
  schemaVersion: number;
  assetVersion: string;
  sprites: Record<string, SpriteEntry>;
  audio: Record<string, { url: string; category: string; gain: number; loop: boolean; loopPoints?: [number, number] }>;
  licenses: { scope: string; author: string; license: string }[];
}

export const SUPPORTED_SCHEMA = 1;

/** Problems with a manifest, as human-readable lines. Empty means fine. */
export function validateManifest(m: AssetManifest, available: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  if (m.schemaVersion !== SUPPORTED_SCHEMA) problems.push(`schemaVersion ${m.schemaVersion} isn't ${SUPPORTED_SCHEMA}`);
  for (const [id, s] of Object.entries(m.sprites)) {
    if (!/^[a-z0-9_]+(\.[a-z0-9_]+)+$/.test(id)) problems.push(`${id}: bad id`);
    if (!available.has(s.url)) problems.push(`${id}: no file at ${s.url}`);
    const [w, h] = s.size;
    if (!(w > 0 && h > 0)) problems.push(`${id}: bad size`);
    const [ax, ay] = s.anchor;
    if (!(ax >= 0 && ax <= 1 && ay >= 0 && ay <= 1)) problems.push(`${id}: anchor outside the sprite`);
    const [bx, by, bw, bh] = s.bounds;
    if (bx < 0 || by < 0 || bx + bw > w || by + bh > h) problems.push(`${id}: bounds outside the sprite`);
  }
  return problems;
}

// Vite bundles every sprite as its own lazy chunk; nothing loads until asked.
const files = import.meta.glob<string>("./assets/sprites/**/*.svg", { query: "?raw", import: "default" });
const byUrl = new Map(Object.entries(files).map(([path, load]) => [path.replace("./assets/", ""), load]));

// The JSON is untrusted as far as types go; validateManifest is the real check.
const manifest = manifestJson as unknown as AssetManifest;
const problems = validateManifest(manifest, new Set(byUrl.keys()));
if (problems.length) console.warn("dominion assets:", problems);
const usable = new Map(
  Object.entries(manifest.sprites).filter(([id, s]) => byUrl.has(s.url) && !problems.some((p) => p.startsWith(`${id}:`))),
);

export function spriteEntry(id: string): SpriteEntry | undefined {
  return usable.get(id);
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

export interface SpriteKey {
  id: string;
  /** Player colour for the ownership mask. */
  color?: string;
  /** Terrain layer: "ground" or "props". */
  layer?: string;
  /** Remembered, not currently visible: drawn darker. */
  dim?: boolean;
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(k > 0 ? c + (255 - c) * k : c * (1 + k)));
  return `#${ch.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

const TONES: Record<string, number> = { light: 0.25, mid: 0, dark: -0.3 };

/** Applies the colour and layer choices to the source SVG. */
function prepare(src: string, entry: SpriteEntry, key: SpriteKey): string {
  if (!key.color && !key.layer) return src;
  const doc = new DOMParser().parseFromString(src, "image/svg+xml");
  if (key.layer && entry.layers) {
    for (const other of entry.layers) if (other !== key.layer) doc.getElementById(other)?.remove();
  }
  const mask = entry.ownerMask ? doc.getElementById(entry.ownerMask) : null;
  if (mask && key.color) {
    // Found by group id, never by colour (STYLE.md).
    for (const el of mask.querySelectorAll("[fill]")) {
      el.setAttribute("fill", shade(key.color, TONES[el.getAttribute("data-tone") ?? "mid"] ?? 0));
    }
  }
  return new XMLSerializer().serializeToString(doc);
}

/** Raw SVG text per file, loaded once and shared by every consumer. */
const sources = new Map<string, Promise<string | null>>();
function loadSource(entry: SpriteEntry): Promise<string | null> {
  let p = sources.get(entry.url);
  if (!p) {
    p = (byUrl.get(entry.url)?.() ?? Promise.resolve(null)).catch(() => null);
    sources.set(entry.url, p);
  }
  return p;
}

const urls = new Map<string, Promise<string | null>>();

/**
 * A sprite as an image URL, for DOM use (the tech web). Kept for the page's
 * lifetime: there are a handful of them and they're reused on every open.
 */
export function spriteUrl(key: SpriteKey): Promise<string | null> {
  const k = `${key.id}|${key.color ?? ""}|${key.layer ?? ""}`;
  let p = urls.get(k);
  if (!p) {
    const entry = usable.get(key.id);
    p = entry
      ? loadSource(entry).then((src) =>
          src ? URL.createObjectURL(new Blob([prepare(src, entry, key)], { type: "image/svg+xml" })) : null,
        )
      : Promise.resolve(null);
    urls.set(k, p);
  }
  return p;
}

async function toImage(svg: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface Raster {
  canvas: HTMLCanvasElement;
  /** Logical size and anchor, for placement at any zoom. */
  w: number;
  h: number;
  ax: number;
  ay: number;
}

/**
 * Sprites rasterised at a fixed scale, keyed by variant. Draw calls never wait:
 * `get` returns null until the raster is ready and `onReady` asks for a redraw.
 */
export class SpriteCache {
  private rasters = new Map<string, Raster | "loading" | "missing">();
  /** Last scale's rasters, shown stretched while the new ones render. */
  private stale = new Map<string, Raster>();
  private scale: number;
  private readonly onReady: () => void;

  constructor(scale: number, onReady: () => void) {
    this.scale = scale;
    this.onReady = onReady;
  }

  /** Re-rasterise at a new scale (zoom or screen density changed a lot). */
  setScale(scale: number): void {
    if (scale === this.scale) return;
    this.scale = scale;
    for (const [k, r] of this.rasters) if (typeof r !== "string") this.stale.set(k, r);
    this.rasters.clear();
  }

  has(id: string): boolean {
    return usable.has(id);
  }

  get(key: SpriteKey): Raster | null {
    const k = `${key.id}|${key.color ?? ""}|${key.layer ?? ""}|${key.dim ? 1 : 0}`;
    const hit = this.rasters.get(k);
    if (hit === "missing") return null;
    if (hit === "loading") return this.stale.get(k) ?? null;
    if (hit) return hit;
    const entry = usable.get(key.id);
    if (!entry) {
      this.rasters.set(k, "missing");
      return null;
    }
    this.rasters.set(k, "loading");
    const scale = this.scale;
    const fallback = this.stale.get(k) ?? null;
    void this.build(entry, key, scale).then(
      (r) => {
        if (scale !== this.scale) return;
        this.rasters.set(k, r ?? "missing");
        this.stale.delete(k);
        if (r) this.onReady();
      },
      () => this.rasters.set(k, "missing"),
    );
    return fallback;
  }

  private async build(entry: SpriteEntry, key: SpriteKey, scale: number): Promise<Raster | null> {
    const src = await loadSource(entry);
    if (!src) return null;
    const img = await toImage(prepare(src, entry, key));
    const [w, h] = entry.size;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(w * scale);
    canvas.height = Math.ceil(h * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    if (key.dim) {
      // Darken only the sprite's own pixels.
      ctx.globalCompositeOperation = "source-atop";
      ctx.fillStyle = "rgba(14, 16, 24, 0.5)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    return { canvas, w, h, ax: entry.anchor[0] * w, ay: entry.anchor[1] * h };
  }
}
