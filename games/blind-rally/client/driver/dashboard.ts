import { h } from "@games/ui";

// The Driver's instruments: speed, gear, compass, impacts. All of it comes
// from the server's `dash`/`hit` relays, which carry a few numbers and nothing
// about where the car is. Which way it points isn't where the road goes: the
// compass says "north-east", never "bend ahead". Nothing here may grow a hint
// about the road (spec §4.1).

const SVG = "http://www.w3.org/2000/svg";
/** The gauge tops out a bit past the car's 115 km/h. */
const GAUGE_MAX_KMH = 130;
const SEGMENTS = 26;
/** The arc: 240° opening at the bottom, like a real tacho. */
const SWEEP = 240;
const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...children: Node[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...children);
  return el;
}

export class Dashboard {
  /** The instrument row: the dial, and the compass beside it. */
  readonly el: HTMLElement;
  private gauge: HTMLElement;
  private compass = new Compass();
  private digits = h("span", { class: "br-speed-num" });
  private lead = h("span", { class: "br-speed-lead", "aria-hidden": "true" });
  private gear = h("span", { class: "br-gear" }, "D");
  private segs: SVGRectElement[] = [];
  private shown = -1;
  private hitTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    const arc = svg("svg", { class: "br-arc", viewBox: "-50 -50 100 100", "aria-hidden": "true" });
    for (let i = 0; i < SEGMENTS; i++) {
      const deg = -SWEEP / 2 + (SWEEP * i) / (SEGMENTS - 1);
      const r = svg("rect", { x: -1.6, y: -46, width: 3.2, height: 9, rx: 0.8, transform: `rotate(${deg.toFixed(2)})` });
      arc.append(r);
      this.segs.push(r);
    }
    this.gauge = h(
      "div",
      { class: "br-gauge", role: "img", "aria-label": "Speed" },
      arc,
      h("div", { class: "br-speed" }, h("span", { class: "br-speed-digits" }, this.lead, this.digits), h("span", { class: "br-unit" }, "km/h"), this.gear),
    );
    this.el = h("div", { class: "br-dials" }, this.gauge, this.compass.el);
    this.speed(0);
  }

  /** m/s from the dash relay; negative is reverse. */
  speed(ms: number) {
    const kmh = Math.min(999, Math.round(Math.abs(ms) * 3.6));
    if (kmh !== this.shown) {
      this.shown = kmh;
      const s = String(kmh);
      // Unlit leading zeros, the way a three-digit LCD shows 7 km/h.
      this.lead.textContent = "0".repeat(3 - s.length);
      this.digits.textContent = s;
      this.gauge.setAttribute("aria-label", `${kmh} km/h`);
      const lit = Math.round((Math.min(kmh, GAUGE_MAX_KMH) / GAUGE_MAX_KMH) * SEGMENTS);
      this.segs.forEach((r, i) => r.classList.toggle("on", i < lit));
    }
    this.gear.textContent = ms < -0.4 ? "R" : "D";
    this.gear.classList.toggle("rev", ms < -0.4);
  }

  /** Compass bearing from the dash relay: 0 north, clockwise, whole degrees. */
  heading(deg: number) {
    this.compass.set(deg);
  }

  /** A thump: the whole dash flashes, harder hits for longer. */
  hit(strength: number, host: HTMLElement) {
    host.style.setProperty("--br-hit", String(Math.min(1, 0.35 + strength / 4)));
    host.classList.remove("hit");
    void host.offsetWidth;
    host.classList.add("hit");
    clearTimeout(this.hitTimer);
    this.hitTimer = setTimeout(() => host.classList.remove("hit"), 420);
  }

  destroy() {
    clearTimeout(this.hitTimer);
  }
}

/** "042° NE": three digits, a degree sign, the nearest of 8 points. The Navigator's Godot compass reads the same. */
export function headingText(bearing: number): string {
  return `${String(bearing).padStart(3, "0")}° ${POINTS[Math.round(bearing / 45) % 8]}`;
}

/**
 * A heading indicator, the aircraft kind: a card ticked every 10° (longer
 * every 30°) and lettered every 90° turns under a fixed lubber line, so what's
 * under the line is where the bonnet points. The letters counter-turn to stay
 * upright. The card goes the short way round (359 to 0 is one degree, not a
 * lap) and eases between relays; letters and card share one linear timing so
 * the letters stay level mid-turn.
 */
class Compass {
  readonly el: HTMLElement;
  private face: SVGSVGElement;
  private label = h("span", { class: "br-compass-label" }, "---°");
  /** Unwrapped: 350 then 10 is 370, so the CSS transition never spins back through 180. */
  private turned = 0;
  private bearing = -1;

  constructor() {
    this.face = svg("svg", { class: "br-compass-face", viewBox: "-50 -50 100 100", "aria-hidden": "true" });
    const card = svg("g", { class: "br-compass-card" });
    for (let d = 0; d < 360; d += 10) {
      const major = d % 30 === 0;
      card.append(svg("line", { class: major ? "major" : "", x1: 0, y1: -45, x2: 0, y2: major ? -37 : -41, transform: `rotate(${d})` }));
    }
    for (const [i, name] of ["N", "E", "S", "W"].entries()) {
      const letter = svg("text", { class: `br-compass-letter${name === "N" ? " north" : ""}`, "text-anchor": "middle", "dominant-baseline": "central" });
      letter.textContent = name;
      letter.style.setProperty("--br-at", `${i * 90}deg`);
      card.append(svg("g", { transform: `rotate(${i * 90}) translate(0 -27)` }, letter));
    }
    this.face.append(
      svg("circle", { class: "br-compass-bezel", r: 48 }),
      card,
      // Fixed: the lubber line at twelve o'clock, and the car, nose up, in the middle.
      svg("path", { class: "br-compass-lubber", d: "M0 -33 L-1.6 -44 L-5 -51 L5 -51 L1.6 -44 Z" }),
      svg("path", { class: "br-compass-car", d: "M0 -8 L6 7 L0 4 L-6 7 Z" }),
    );
    this.el = h("div", { class: "br-compass", role: "img", "aria-label": "Compass" }, this.face, this.label);
  }

  /** A bearing as parseDash leaves it: whole degrees, 0..359. */
  set(b: number) {
    if (b === this.bearing) return;
    this.bearing = b;
    this.turned += ((b - this.turned) % 360 + 540) % 360 - 180;
    this.face.style.setProperty("--br-turned", `${this.turned}deg`);
    const text = headingText(b);
    this.label.textContent = text;
    this.el.setAttribute("aria-label", `Heading ${text}`);
  }
}
