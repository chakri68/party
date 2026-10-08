// The tech tree as a web: your city in the middle, the five roots around it,
// each branch reaching outward one step per tier. Every root gets a slice of
// the circle sized by how many leaves hang off it, so branches never cross.
// It's a screen of its own over the map, not a dialog: a web needs room.

import { h } from "@games/ui";
import { MONUMENTS, parentFor, rootTechsFor, techCost, TECHS, techsFor, UNITS } from "../shared/content.ts";
import type { DominionPrivateState, FactionKind, TechId } from "../shared/types.ts";
import { spriteEntry, spriteUrl, type SpriteKey } from "./assets.ts";

/** A faction's own art if it has some, else the stand-in. */
const artFor_ = (id: string, fallback: string) => (spriteEntry(id) ? id : fallback);

/** Distance from the centre per depth, in % of the web's side. */
const RADII = [0, 21, 36, 48];
const SVG_NS = "http://www.w3.org/2000/svg";


interface Placed {
  tech: TechId;
  parent: TechId | null;
  x: number;
  y: number;
}

/** A faction's own tree: special factions swap a branch, and its children follow. */
function layout(kind: FactionKind): Placed[] {
  const tree = techsFor(kind);
  const roots = rootTechsFor(kind);
  const children = (t: TechId) => tree.filter((c) => parentFor(kind, c) === t);
  const leaves = (t: TechId): number => {
    const kids = children(t);
    return kids.length ? kids.reduce((n, c) => n + leaves(c), 0) : 1;
  };
  const out: Placed[] = [];
  const total = roots.reduce((n, t) => n + leaves(t), 0);
  const place = (tech: TechId, parent: TechId | null, from: number, to: number, depth: number) => {
    const a = (from + to) / 2;
    out.push({ tech, parent, x: 50 + RADII[depth]! * Math.cos(a), y: 50 + RADII[depth]! * Math.sin(a) });
    let at = from;
    for (const c of children(tech)) {
      const span = ((to - from) * leaves(c)) / leaves(tech);
      place(c, tech, at, at + span, depth + 1);
      at += span;
    }
  };
  let at = -Math.PI / 2 - (Math.PI * leaves(roots[0]!)) / total;
  for (const t of roots) {
    const span = (2 * Math.PI * leaves(t)) / total;
    place(t, null, at, at + span, 1);
    at += span;
  }
  return out;
}


/** The art each node shows: what the tech lets you build, harvest or train. */
function artFor(tech: TechId, kind: FactionKind, color: string): SpriteKey {
  const unit = (type: string): SpriteKey => ({ id: artFor_(`unit.${type}.${kind}.idle`, `unit.${type}.orchard.idle`), color });
  const art: Record<TechId, SpriteKey> = {
    gathering: { id: "resource.fruit.default" },
    farming: { id: "improvement.farm.default" },
    construction: { id: "resource.crops.default" },
    strategy: unit("infantry"),
    diplomacy: { id: "feature.village.default" },
    hunting: { id: "resource.animals.default" },
    forestry: { id: "improvement.lumber_camp.default" },
    mathematics: { id: "feature.ruins.default" },
    archery: unit("archer"),
    spirituality: { id: "feature.village.default" },
    riding: unit("cavalry"),
    roads: { id: "road.center" },
    commerce: { id: artFor_(`city.${kind}.tier1`, "city.orchard.tier1"), color },
    free_spirit: unit("cavalry"),
    chivalry: unit("cavalry"),
    climbing: { id: "terrain.mountain.default" },
    mining: { id: "improvement.mine.default" },
    metallurgy: { id: "resource.ore.default" },
    meditation: { id: "terrain.mountain.v2" },
    philosophy: { id: "effect.research" },
    fishing: { id: "resource.fish.default" },
    sailing: { id: "terrain.water.shallow.default" },
    navigation: { id: "terrain.ocean.default" },
    tending: { id: "resource.animals.default" },
    grovecraft: { id: "terrain.forest.default" },
    skyroost: unit("great_owl"),
    tidecraft: { id: "resource.fish.default" },
    currents: { id: "terrain.water.shallow.default" },
    deep_calling: { id: "terrain.ocean.default" },
    frostcraft: { id: "terrain.water.shallow.v2" },
    ice_roads: { id: "road.center" },
    deep_freeze: { id: "terrain.ocean.v2" },
  };
  return art[tech];
}

function art(key: SpriteKey, className: string): HTMLElement {
  const img = h("img", { alt: "", class: className, draggable: "false" });
  void spriteUrl(key).then((url) => {
    if (url) img.src = url;
    else img.remove();
  });
  return img;
}

export interface TechScreenOptions {
  view: DominionPrivateState;
  kind: FactionKind;
  /** The player's colour, for the city in the middle and unit art. */
  color: string;
  /** Touch screens confirm purchases with a second tap. */
  confirmTwice: boolean;
  onResearch(tech: TechId): void;
  onClose(): void;
}

export function techScreen({ view, kind, color, confirmTwice, onResearch, onClose }: TechScreenOptions): {
  el: HTMLElement;
  destroy(): void;
} {
  const LAYOUT = layout(kind);
  const TECH_ORDER = LAYOUT.map((n) => n.tech);
  const state = (t: TechId) => {
    if (view.techs.includes(t)) return "owned";
    const parent = parentFor(kind, t);
    return !parent || view.techs.includes(parent) ? "open" : "locked";
  };
  let selected: TechId | null =
    TECH_ORDER.find((t) => state(t) === "open" && view.credits >= techCost(t, view.cityCount, view.techs)) ??
    TECH_ORDER.find((t) => state(t) === "open") ??
    null;
  let armed = false;

  // Edges first, under the nodes.
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  // The web stretches to an ellipse on wide screens; strokes stay even (CSS).
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", "dm-ts-lines");
  svg.setAttribute("aria-hidden", "true");
  for (const n of LAYOUT) {
    const from = n.parent ? LAYOUT.find((p) => p.tech === n.parent)! : { x: 50, y: 50 };
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(from.x));
    line.setAttribute("y1", String(from.y));
    line.setAttribute("x2", String(n.x));
    line.setAttribute("y2", String(n.y));
    line.setAttribute("class", state(n.tech));
    svg.append(line);
  }

  const nodes = new Map<TechId, HTMLButtonElement>();
  for (const n of LAYOUT) {
    const s = state(n.tech);
    const cost = techCost(n.tech, view.cityCount, view.techs);
    const btn = h(
      "button",
      {
        type: "button",
        class: `dm-ts-node ${s}${s === "open" && view.credits >= cost ? " afford" : ""}`,
        style: `left:${n.x}%;top:${n.y}%`,
        "aria-label": `${TECHS[n.tech].name}, ${s === "owned" ? "researched" : s === "open" ? `${cost} credits` : "locked"}`,
        onclick: () => select(n.tech),
      },
      s === "open" ? h("span", { class: "dm-ts-cost" }, h("span", { class: "dm-coin" }), String(cost)) : null,
      s !== "locked" ? art(spriteEntry(`icon.tech.${n.tech}`) ? { id: `icon.tech.${n.tech}` } : artFor(n.tech, kind, color), "dm-ts-art") : null,
      h("span", { class: "dm-ts-name" }, TECHS[n.tech].name),
    );
    nodes.set(n.tech, btn);
  }

  const hub = h("div", { class: "dm-ts-hub", "aria-hidden": "true" }, art({ id: artFor_(`city.${kind}.tier1`, "city.orchard.tier1"), color }, "dm-ts-city"));
  const web = h("div", { class: "dm-ts-web" }, svg, hub, [...nodes.values()]);
  const scroll = h("div", { class: "dm-ts-scroll" }, web);
  const detail = h("div", { class: "dm-ts-detail dm-plate", "aria-live": "polite" });

  const close = h("button", { type: "button", class: "dm-ts-close", "aria-label": "Close research", onclick: onClose }, "×");
  const root = h(
    "div",
    { class: "dm-ts", role: "dialog", "aria-modal": "true", "aria-label": "Research" },
    h(
      "header",
      { class: "dm-ts-head" },
      h("div", { class: "dm-ts-purse" }, h("span", { class: "dm-coin" }), h("strong", {}, String(view.credits))),
      h("p", { class: "dm-ts-note" }, "Each city you hold makes research cost 2 more."),
      close,
    ),
    h(
      "ol",
      { class: "dm-ts-goals", "aria-label": "Milestones" },
      view.achievements.map((a) =>
        h(
          "li",
          { class: a.done ? "done" : "", title: MONUMENTS[a.kind as keyof typeof MONUMENTS]?.goal ?? "" },
          h("strong", {}, MONUMENTS[a.kind as keyof typeof MONUMENTS]?.name ?? a.kind),
          h("span", {}, a.done ? "Earned" : a.kind === "exploration" ? `${a.progress}% of ${a.goal}%` : `${Math.min(a.progress, a.goal)}/${a.goal}`),
        ),
      ),
    ),
    scroll,
    detail,
  );
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  });

  function renderDetail() {
    detail.replaceChildren();
    if (!selected) {
      detail.append(h("p", {}, "You've researched everything there is. For now."));
      return;
    }
    const tech = selected;
    const def = TECHS[tech];
    const s = state(tech);
    const cost = techCost(tech, view.cityCount, view.techs);
    const units = Object.values(UNITS).filter((u) => u.needs === tech).map((u) => u.name);
    const reason =
      s === "owned" ? null
      : s === "locked" ? `Research ${TECHS[parentFor(kind, tech)!].name} first`
      : !view.myTurn ? "You can research on your turn"
      : view.credits < cost ? `${cost - view.credits} more credits needed`
      : null;
    detail.append(
      h(
        "div",
        { class: "dm-ts-what" },
        h("h3", {}, def.name),
        h("p", {}, def.unlocks, units.length ? ` (${units.join(", ")})` : ""),
        reason ? h("p", { class: "dm-muted" }, reason) : null,
      ),
      s === "owned"
        ? h("span", { class: "dm-ts-done" }, "Researched")
        : h(
            "button",
            {
              type: "button",
              class: `dm-slab dm-ts-buy${armed ? " armed" : ""}`,
              disabled: !!reason,
              onclick: () => {
                if (confirmTwice && !armed) {
                  armed = true;
                  renderDetail();
                  return;
                }
                onResearch(tech);
              },
            },
            armed ? "Tap again to confirm" : "Research",
            h("span", { class: "dm-ts-buy-cost" }, h("span", { class: "dm-coin" }), String(cost)),
          ),
    );
  }

  function select(tech: TechId) {
    selected = tech;
    armed = false;
    for (const [t, btn] of nodes) btn.classList.toggle("sel", t === tech);
    renderDetail();
  }

  if (selected) select(selected);
  else renderDetail();

  // Fill the screen, stretching into an ellipse on wide ones (up to 1.6:1).
  // Below ~680px the web keeps that size and the screen scrolls instead, so
  // neighbouring nodes never overlap.
  const fit = () => {
    const box = scroll.getBoundingClientRect();
    const height = Math.max(box.height, 680);
    const width = Math.min(Math.max(box.width, 680), height * 1.6);
    web.style.width = `${width}px`;
    web.style.height = `${height}px`;
    web.style.setProperty("--node", `${Math.round(Math.min(130, Math.max(84, Math.min(width, height) * 0.135)))}px`);
    scroll.scrollLeft = (scroll.scrollWidth - scroll.clientWidth) / 2;
    scroll.scrollTop = (scroll.scrollHeight - scroll.clientHeight) / 2;
  };
  // Drag to pan, like the map. Touch already scrolls natively.
  let drag: { x: number; y: number; left: number; top: number; moved: boolean } | null = null;
  scroll.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, left: scroll.scrollLeft, top: scroll.scrollTop, moved: false };
  });
  scroll.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      scroll.setPointerCapture(e.pointerId);
      scroll.classList.add("dragging");
    }
    scroll.scrollLeft = drag.left - dx;
    scroll.scrollTop = drag.top - dy;
  });
  let swallowClick = false;
  const endDrag = () => {
    swallowClick = !!drag?.moved;
    scroll.classList.remove("dragging");
    drag = null;
  };
  scroll.addEventListener("pointerup", endDrag);
  scroll.addEventListener("pointercancel", endDrag);
  // A drag that ends over a node isn't a tap on it.
  scroll.addEventListener(
    "click",
    (e) => {
      if (swallowClick) e.stopPropagation();
      swallowClick = false;
    },
    true,
  );

  const observer = new ResizeObserver(fit);
  observer.observe(scroll);
  requestAnimationFrame(() => close.focus());
  return {
    el: root,
    destroy() {
      observer.disconnect();
      root.remove();
    },
  };
}
