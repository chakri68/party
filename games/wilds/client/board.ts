import { TILE_ORDER, toPixel } from "../shared/hex.ts";
import type { PublicExplorer, PublicTile, Role, RuinId, Terrain, TileId, WildsPublicState } from "../shared/types.ts";

type Pub = WildsPublicState;
type OpenTile = Extract<PublicTile, { open: true }>;

/** Hex size in viewBox units: corner to centre. */
const S = 10;
const SQ3 = Math.sqrt(3);
const PAD = 1;
/** 7 hexes across, 7 rows down (radius 3), plus a little room for the outline. */
const VIEW_W = 7 * SQ3 * S + PAD * 2;
const VIEW_H = 11 * S + PAD * 2;

const NS = "http://www.w3.org/2000/svg";

type SvgAttrs = Record<string, string | number | undefined | null | false>;
function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: SvgAttrs = {}, ...kids: (SVGElement | string | null | false)[]): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) e.setAttribute(k, String(v));
  for (const k of kids) if (k) e.append(k);
  return e;
}

const HEX_POINTS = Array.from({ length: 6 }, (_, i) => {
  const a = ((60 * i - 30) * Math.PI) / 180;
  return `${(S * Math.cos(a)).toFixed(2)},${(S * Math.sin(a)).toFixed(2)}`;
}).join(" ");

/** Icon paths drawn in a box from -4 to 4. Colour is never the only sign of a terrain. */
const TERRAIN_ICON: Record<Terrain, string> = {
  grass: "M-3 2 L-2.4 -1 M0 2 L0 -2 M3 2 L2.4 -1",
  forest: "M0 -4 L3 1 L-3 1 Z M0 1 L0 3.5",
  reeds: "M-2.5 3.5 L-2.5 -1 M0 3.5 L0 -3 M2.5 3.5 L2.5 -1 M-2.5 -1 L-2.5 -2 M0 -3 L0 -4 M2.5 -1 L2.5 -2",
  river: "M-4 -1.5 Q-3 -2.7 -2 -1.5 T0 -1.5 T2 -1.5 T4 -1.5 M-4 1.5 Q-3 0.3 -2 1.5 T0 1.5 T2 1.5 T4 1.5",
  bridge: "M-4 -2 L4 -2 M-4 2 L4 2 M-2.5 -2 L-2.5 2 M0 -2 L0 2 M2.5 -2 L2.5 2",
  broken: "M-4 -2 L-1 -2 M1.2 -2 L4 -2 M-4 2 L-1.2 2 M1 2 L4 2 M-2.5 -2 L-2.5 2 M2.5 -2 L2.5 2 M-0.6 -3 L0.6 3",
  rock: "M-4 3 L-1.5 -2.5 L0.5 0 L1.8 -1.2 L4 3 Z",
  camp: "M-4 3 L0 -3.5 L4 3 Z M0 3 L0 0 M-1.2 3 L0 0 L1.2 3",
  gate: "M-3 3.5 L-3 -0.5 A3 3 0 0 1 3 -0.5 L3 3.5 M-1.2 3.5 L-1.2 0.4 A1.2 1.2 0 0 1 1.2 0.4 L1.2 3.5",
  ruin: "M-4 3 L4 3 M-3 3 L-3 -1 M0 3 L0 -1 M3 3 L3 -1 M-4 -1 L4 -1",
  ash: "M-2.5 -1 L-2 -1 M1 -2 L1.5 -2 M-1 2 L-0.5 2 M2.5 1 L3 1 M-3.5 1.5 L-3 1.5",
};

const RUIN_ICON: Record<RuinId, string> = {
  shrine: "M-4 3.5 L4 3.5 M-3 3.5 L-3 -1 M0 3.5 L0 -1 M3 3.5 L3 -1 M-4 -1 L0 -4 L4 -1 Z",
  tower: "M-2 3.5 L-2 -2.5 L2 -2.5 L2 3.5 M-3 -2.5 L-2 -4 L2 -4 L3 -2.5 M-0.8 -0.5 L0.8 -0.5 L0.8 1.2 L-0.8 1.2 Z",
  cave: "M-4 3.5 A4 5 0 0 1 4 3.5 Z M-1.6 3.5 A1.6 2.2 0 0 1 1.6 3.5",
};

const FLAME = "M0 -4 C2.5 -1.5 3 0 3 1.2 C3 3 1.5 4 0 4 C-1.5 4 -3 3 -3 1.2 C-3 -0.5 -1.5 -1 -1 -2.5 C-0.5 -1 0 -1 0 -4 Z";
const SMOKE = "M-3 3 Q-4 1.5 -2.5 0.5 Q-3 -1.5 -1 -1.5 Q0 -3.5 2 -2.5 Q4 -2 3.2 0 Q4.5 1.5 3 3 Z";
const CACHE = "M-3 -1 L3 -1 L3 3 L-3 3 Z M-3 1 L3 1 M-3 -1 Q0 -3.5 3 -1";
const NEST = "M0 -3.5 L0 3.5 M-3 -1.8 L3 1.8 M-3 1.8 L3 -1.8 M-1.6 -0.9 L0 -1.8 L1.6 -0.9 L1.6 0.9 L0 1.8 L-1.6 0.9 Z";
const SPIDER =
  "M0 -1.4 A1.6 2 0 1 1 0 2.6 A1.6 2 0 1 1 0 -1.4 Z M0 -1.4 A1 1 0 1 1 0 -3.4 A1 1 0 1 1 0 -1.4 Z " +
  "M-1.4 -0.4 L-3.6 -2.2 M-1.5 0.6 L-4 0 M-1.4 1.6 L-3.6 3 M1.4 -0.4 L3.6 -2.2 M1.5 0.6 L4 0 M1.4 1.6 L3.6 3";
const STONE = "M0 -2.2 L1.8 0 L0 2.2 L-1.8 0 Z";

/** The arrow's label, shown under the board next to a small arrow. */
export const ARROW_LABEL = "If nothing changes";
export const hasArrow = (pub: Pub): boolean => (pub.spider?.arrow?.path.length ?? 0) >= 2;

export const TERRAIN_NAME: Record<Terrain, string> = {
  grass: "Grass", forest: "Forest", reeds: "Reeds", river: "River", bridge: "Bridge", broken: "Broken bridge",
  rock: "Rock", camp: "Camp", gate: "Gate", ruin: "Ruin", ash: "Ash",
};
const RUIN_NAME: Record<RuinId, string> = { shrine: "Sunken Shrine", tower: "Star Tower", cave: "Root Cave" };

/** Where each token sits when several share a tile. */
function fan(n: number): { x: number; y: number; r: number }[] {
  if (n <= 1) return [{ x: 0, y: 0, r: S * 0.42 }];
  const spread = S * 0.42;
  const r = n <= 3 ? S * 0.32 : S * 0.27;
  return Array.from({ length: n }, (_, i) => {
    const a = (-90 + (360 / n) * i) * (Math.PI / 180);
    return { x: spread * Math.cos(a), y: spread * Math.sin(a), r };
  });
}

/** The SVG island. Rebuilt on each render: 37 hexes cost next to nothing. */
export class BoardView {
  readonly svg: SVGSVGElement;
  private name: (id: string) => string = (id) => id;
  private me: string | null = null;
  private onTap: (t: TileId) => void;

  constructor(onTap: (t: TileId) => void) {
    this.onTap = onTap;
    const x0 = -VIEW_W / 2;
    const y0 = -VIEW_H / 2;
    this.svg = el("svg", {
      class: "wd-board",
      viewBox: `${x0.toFixed(2)} ${y0.toFixed(2)} ${VIEW_W.toFixed(2)} ${VIEW_H.toFixed(2)}`,
      role: "group",
      "aria-label": "The island",
    });
    this.svg.addEventListener("click", (e) => this.tapFrom(e.target));
    this.svg.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      this.tapFrom(e.target);
    });
  }

  /** Names for the tokens, and whose token is yours. */
  setPeople(name: (id: string) => string, me: string): void {
    this.name = name;
    this.me = me;
  }

  private tapFrom(target: EventTarget | null) {
    const g = target instanceof Element ? target.closest("[data-tile]") : null;
    const t = g?.getAttribute("data-tile");
    if (t) this.onTap(t);
  }

  /**
   * `highlight`: "ok" tiles light up, "off" tiles go dim; tiles not in it look normal.
   * `marks`: a short label on a tile, like the beat a planned move goes in.
   */
  render(pub: Pub, highlight: Map<TileId, "ok" | "off">, offReason: Map<TileId, string>, marks?: Map<TileId, string>): SVGSVGElement {
    const byId = new Map(pub.tiles.map((t) => [t.id, t] as const));
    const event = new Set(pub.event?.tiles ?? []);
    const people = new Map<TileId, PublicExplorer[]>();
    for (const e of pub.explorers) {
      if (e.left) continue;
      const list = people.get(e.tile) ?? [];
      list.push(e);
      people.set(e.tile, list);
    }
    const tiles = el("g", { class: "wd-tiles" });
    for (const id of TILE_ORDER) {
      const t = byId.get(id);
      if (!t) continue;
      tiles.append(this.hex(pub, t, highlight.get(id), offReason.get(id), event.has(id), people.get(id) ?? [], marks?.get(id)));
    }
    this.svg.replaceChildren(tiles, this.arrow(pub), this.tokens(people));
    return this.svg;
  }

  private hex(
    pub: Pub, t: PublicTile, hl: "ok" | "off" | undefined, why: string | undefined, shown: boolean,
    here: PublicExplorer[], mark: string | undefined,
  ): SVGGElement {
    const { x, y } = toPixel(t.id, S);
    const label = this.label(pub, t, here);
    const g = el("g", {
      class: ["wd-hex", hl && `wd-${hl}`].filter(Boolean).join(" "),
      transform: `translate(${x.toFixed(2)} ${y.toFixed(2)})`,
      "data-tile": t.id,
      tabindex: hl === "ok" ? 0 : undefined,
      role: hl ? "button" : undefined,
      "aria-label": why ? `${label} ${why}` : label,
    });
    g.append(el("title", {}, why ? `${label} ${why}` : label));
    if (!t.open) {
      g.append(el("polygon", { class: "wd-fog", points: HEX_POINTS }));
      if (t.marker) {
        const d = t.marker === "gate" ? TERRAIN_ICON.gate : RUIN_ICON[t.marker];
        g.append(el("path", { class: "wd-icon wd-faint", d, transform: "scale(1.05)" }));
      }
      if (t.smoke) g.append(el("path", { class: "wd-smoke", d: SMOKE, transform: "translate(3.6 -4) scale(0.7)" }));
    } else {
      g.append(el("polygon", { class: `wd-terrain wd-t-${t.terrain}`, points: HEX_POINTS }));
      const d = t.ruin ? RUIN_ICON[t.ruin] : TERRAIN_ICON[t.terrain];
      g.append(el("path", { class: "wd-icon", d, transform: "scale(1.05)" }));
      if (t.fire > 0) g.append(el("path", { class: "wd-fire", d: FLAME, transform: "translate(3.6 -4) scale(0.75)" }));
      if (t.noise > 0) g.append(this.noise(t));
      if (t.cache) g.append(el("path", { class: "wd-cache", d: CACHE, transform: "translate(-4 4.2) scale(0.6)" }));
      if (t.nest) g.append(el("path", { class: "wd-icon wd-nest", d: NEST, transform: "translate(4 4.2) scale(0.6)" }));
      if (t.ruin && pub.stones.includes(t.ruin)) g.append(el("path", { class: "wd-stone-mark", d: STONE, transform: "translate(4 4.2)" }));
      else if (t.ruin && pub.half.includes(t.ruin)) g.append(el("path", { class: "wd-half-mark", d: STONE, transform: "translate(4 4.2)" }));
      if (pub.spider?.tile === t.id) g.append(el("path", { class: "wd-spider", d: SPIDER, transform: "scale(1.15)" }));
    }
    if (shown) g.append(el("polygon", { class: "wd-shown", points: HEX_POINTS, transform: "scale(0.86)" }));
    if (hl) g.append(el("polygon", { class: `wd-hl wd-hl-${hl}`, points: HEX_POINTS, transform: hl === "ok" ? "scale(0.9)" : undefined }));
    if (mark) {
      g.append(
        el("g", { class: "wd-mark", transform: "translate(-4.2 -4.2)" },
          el("circle", { r: 2.6 }),
          el("text", { "text-anchor": "middle", "dominant-baseline": "central" }, mark)),
      );
    }
    return g;
  }

  /** 1–3 small marks along the top of the tile. */
  private noise(t: OpenTile): SVGGElement {
    const g = el("g", { class: "wd-noise", transform: "translate(0 -6.2)" });
    for (let i = 0; i < t.noise; i++) {
      const cx = (i - (t.noise - 1) / 2) * 2.2;
      g.append(el("path", { d: `M${(cx - 0.7).toFixed(1)} 0.8 Q${cx.toFixed(1)} -1.2 ${(cx + 0.7).toFixed(1)} 0.8` }));
    }
    return g;
  }

  private label(pub: Pub, t: PublicTile, here: PublicExplorer[]): string {
    const parts: string[] = [];
    if (!t.open) {
      parts.push(t.marker === "gate" ? "Gate, in the fog." : t.marker ? `${RUIN_NAME[t.marker]}, in the fog.` : "Fog.");
      if (t.smoke) parts.push("Smoke.");
    } else {
      parts.push(`${t.ruin ? RUIN_NAME[t.ruin] : TERRAIN_NAME[t.terrain]}.`);
      if (t.fire > 0) parts.push("Burning.");
      if (t.noise > 0) parts.push(`Noise ${t.noise}.`);
      if (t.cache) parts.push("A cache.");
      if (t.nest) parts.push("The spider's nest.");
      if (pub.spider?.tile === t.id) parts.push("The spider.");
    }
    if (here.length) parts.push(`${here.map((e) => this.name(e.id)).join(", ")}.`);
    return parts.join(" ");
  }

  /** Where the spider goes if nothing changes. Its words sit under the board (`ARROW_LABEL`): on a tile they hide tokens. */
  private arrow(pub: Pub): SVGGElement {
    const g = el("g", { class: "wd-arrow", "aria-hidden": "true" });
    if (!hasArrow(pub)) return g;
    const path = pub.spider!.arrow!.path;
    const pts = path.map((t) => toPixel(t, S));
    g.append(
      el("defs", {},
        el("marker", { id: "wd-arrow-head", viewBox: "0 0 6 6", refX: 3, refY: 3, markerWidth: 3.5, markerHeight: 3.5, orient: "auto-start-reverse" },
          el("path", { d: "M0 0 L6 3 L0 6 Z" }))),
      el("polyline", { points: pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" "), "marker-end": "url(#wd-arrow-head)" }),
    );
    return g;
  }

  private tokens(people: Map<TileId, PublicExplorer[]>): SVGGElement {
    const g = el("g", { class: "wd-tokens", "aria-hidden": "true" });
    for (const [tile, list] of people) {
      const at = toPixel(tile, S);
      fan(list.length).forEach((p, i) => {
        const e = list[i]!;
        const letter = (this.name(e.id).trim()[0] ?? "?").toUpperCase();
        const cls = ["wd-token", e.down && "wd-down", e.id === this.me && "wd-me"].filter(Boolean).join(" ");
        g.append(
          el("g", { class: cls, transform: `translate(${(at.x + p.x).toFixed(2)} ${(at.y + p.y).toFixed(2)})` },
            el("circle", { class: `wd-ring wd-role-${roleClass(e.role)}`, r: p.r.toFixed(2) }),
            el("text", { "text-anchor": "middle", "dominant-baseline": "central", "font-size": (p.r * 1.15).toFixed(2) }, letter)),
        );
      });
    }
    return g;
  }
}

const roleClass = (r: Role | null): string => r ?? "none";
