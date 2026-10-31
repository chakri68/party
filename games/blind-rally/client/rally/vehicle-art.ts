import type { VehicleId } from "../../shared/vehicles.ts";

// The grid's car pictures: a flat side view of each class, nose to the right.
// Drawn in currentColor so the card's text colour paints them; the windows
// and tyres take the card's surface (rally.css), so they read as cut-outs.
// Not the Godot models, just enough shape to tell five cars apart at 120 px.

const SVG = "http://www.w3.org/2000/svg";

const wheel = (x: number, y: number, r: number) => `<circle class="tyre" cx="${x}" cy="${y}" r="${r}"/><circle cx="${x}" cy="${y}" r="${Math.max(1.6, r / 4)}"/>`;

const ART: Record<VehicleId, string> = {
  // A short two-box car with a sloping back.
  hatch:
    `<path d="M8 36V24q0-3 3-4l11-9q2-1 5-1h33q3 0 5 2l11 9 28 2q6 1 7 6v7z"/>` +
    `<path class="glass" d="M25 13h19v7H19zM47 13h13l8 7H47z"/>` +
    wheel(28, 36, 7) + wheel(90, 36, 7),
  // Tall and square, spare wheel on the back door, big tyres.
  "4x4":
    `<rect x="1" y="15" width="6" height="15" rx="2"/>` +
    `<path d="M6 34V12q0-4 4-4h60l10 11h26q6 0 6 5v10z"/>` +
    `<path class="glass" d="M12 12h26v7H12zM42 12h24l6 7H42z"/>` +
    wheel(28, 36, 9) + wheel(90, 36, 9),
  // Low three-box saloon with a long bonnet.
  rwd:
    `<path d="M5 37v-9q0-3 4-4l21-2 12-9q2-1 5-1h19q3 0 5 2l9 8 28 3q5 1 6 6v6z"/>` +
    `<path class="glass" d="M35 22l10-7h10v7zM58 15h8l7 7H58z"/>` +
    wheel(26, 37, 6.5) + wheel(94, 37, 6.5),
  // Cab at the front, a long open bed behind it.
  truck:
    `<path d="M3 34V21h3v-3h3v3h45V10q0-3 3-3h25l12 12h16q4 0 4 4v11z"/>` +
    `<path class="glass" d="M60 11h20l8 8H60z"/>` +
    wheel(22, 36, 8) + wheel(97, 36, 8),
  // Big wheel at the back under the cab, small one at the front, exhaust up top.
  tractor:
    `<rect x="14" y="3" width="36" height="4" rx="1.5"/>` +
    `<rect x="17" y="6" width="3" height="12"/><rect x="45" y="6" width="3" height="14"/>` +
    `<path d="M44 18h55q4 0 4 4v11H44z"/>` +
    `<rect x="82" y="5" width="3" height="13" rx="1"/>` +
    `<path class="guard" d="M11 30a19 19 0 0 1 38 0"/>` +
    wheel(30, 31, 14) + wheel(94, 38, 7.5),
};

/** A class's side view, 120×48, for the grid's car cards. Decoration: the card says the name. */
export function vehicleSvg(id: VehicleId): SVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 120 48");
  svg.setAttribute("class", `rl-car-art rl-car-${id}`);
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ART[id];
  return svg;
}
