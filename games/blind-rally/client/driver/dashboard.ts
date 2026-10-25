import { h } from "@games/ui";

// The Driver's instruments: speed, gear, impacts. All of it comes from the
// server's `dash`/`hit` relays, which carry a number each and nothing about
// where the car is. Nothing here may grow a hint about the road (spec §4.1).

const SVG = "http://www.w3.org/2000/svg";
/** The gauge tops out a bit past the car's 115 km/h. */
const GAUGE_MAX_KMH = 130;
const SEGMENTS = 26;
/** The arc: 240° opening at the bottom, like a real tacho. */
const SWEEP = 240;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

export class Dashboard {
  readonly el: HTMLElement;
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
    this.el = h(
      "div",
      { class: "br-gauge", role: "img", "aria-label": "Speed" },
      arc,
      h("div", { class: "br-speed" }, h("span", { class: "br-speed-digits" }, this.lead, this.digits), h("span", { class: "br-unit" }, "km/h"), this.gear),
    );
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
      this.el.setAttribute("aria-label", `${kmh} km/h`);
      const lit = Math.round((Math.min(kmh, GAUGE_MAX_KMH) / GAUGE_MAX_KMH) * SEGMENTS);
      this.segs.forEach((r, i) => r.classList.toggle("on", i < lit));
    }
    this.gear.textContent = ms < -0.4 ? "R" : "D";
    this.gear.classList.toggle("rev", ms < -0.4);
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
