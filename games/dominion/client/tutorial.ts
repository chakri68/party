// First steps (§15): exploration → harvest → city upgrade → research →
// recruit → combat → capture → naval travel. No scripted map: a small coach
// card names the next thing to try and ticks it off when it happens in the
// real game. Progress lives in this browser; it's onboarding, not state.

import { h } from "@games/ui";
import { FACTIONS } from "../shared/content.ts";
import type { DominionEvent, DominionPrivateState, FactionKind } from "../shared/types.ts";

type StepId = "explore" | "harvest" | "grow" | "research" | "recruit" | "fight" | "capture" | "sail";

interface Step {
  id: StepId;
  title: string;
  how: string;
}

const STORE = "dm:tutorial";

function steps(kind: FactionKind): Step[] {
  const f = FACTIONS[kind];
  const harvest = f.tends ? "Tend" : f.absorbs ? "Absorb or harvest" : "Harvest";
  const sail =
    f.noShips
      ? { title: "Cross the water", how: "Tap a unit next to shallow water. Tap a tile with a blue ring. The water freezes. Then walk on the ice." }
      : kind === "tidefolk"
        ? { title: "Go into the water", how: "Your shell guards can walk in shallow water. Move a shell guard onto the water." }
        : { title: "Go to sea", how: "Research Sailing. Build a port on your coast. Walk a unit onto the port. The unit gets on a boat." };
  return [
    { id: "explore", title: "Explore", how: "Tap one of your units. Then tap a lit-up tile. Your unit moves there. You see more of the map as you move." },
    { id: "harvest", title: `${harvest} a resource`, how: `Tap fruit, wild game or fish inside your borders. Choose ${harvest.toLowerCase()} in the side panel. Your city grows.` },
    { id: "grow", title: "Grow a city", how: "Build on a city's tiles. Do this until the city reaches level 2. Then choose a reward." },
    { id: "research", title: "Research a technology", how: "Open Research at the bottom left. Each tech gives you new units or buildings." },
    { id: "recruit", title: "Train a unit", how: "Tap one of your cities. The city tile must be empty. Train a unit." },
    { id: "fight", title: "Win a fight", how: "Tap a unit next to an enemy. Tap the enemy with the red ring. You see the damage before you attack." },
    { id: "capture", title: "Take a village", how: "Move a unit onto a village. Wait 1 turn. Then press Capture. The village becomes your city." },
    { id: "sail", ...sail },
  ];
}

interface Progress {
  done: StepId[];
  hidden: boolean;
}

function load(): Progress {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? "null") as Progress | null;
    if (raw && Array.isArray(raw.done)) return { done: raw.done, hidden: !!raw.hidden };
  } catch {
    /* private window or blocked storage: start fresh */
  }
  return { done: [], hidden: false };
}

function save(p: Progress): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(p));
  } catch {
    /* not worth bothering anyone about */
  }
}

export class Tutorial {
  readonly el = h("section", { class: "dm-coach dm-plate", "aria-label": "First steps", "aria-live": "polite" });
  private progress = load();
  private kind: FactionKind = "orchard";

  /** Tick off whatever this update shows the player doing. */
  observe(view: DominionPrivateState, events: DominionEvent[]): void {
    this.kind = view.kind;
    const mine = new Set(view.units.filter((u) => u.owner === view.me).map((u) => u.id));
    const myTile = (at: number) => view.units.some((u) => u.at === at && u.owner === view.me);
    const myCity = (at: number) => view.cities.some((c) => c.at === at && c.owner === view.me);
    const hit = (id: StepId) => {
      if (!this.progress.done.includes(id)) this.progress.done.push(id);
    };
    for (const e of events) {
      if (e.type === "move" && mine.has(e.unit) && view.myTurn) hit("explore");
      if (e.type === "develop" && view.myTurn) hit("harvest");
      if (e.type === "city-level") hit("grow");
      if (e.type === "research") hit("research");
      if (e.type === "spawn" && view.myTurn && myCity(e.at)) hit("recruit");
      if (e.type === "attack" && view.myTurn && e.defenderKilled && myTile(e.from)) hit("fight");
      if (e.type === "capture" && e.by === view.me) hit("capture");
      if (e.type === "freeze" && view.myTurn) hit("sail");
    }
    const afloat = view.units.some((u) => {
      const t = view.tiles[u.at];
      return u.owner === view.me && (!!u.vessel || t?.t === "shallow" || t?.t === "ocean" || t?.t === "ice");
    });
    if (afloat) hit("sail");
    save(this.progress);
    this.render();
  }

  /** Bring it back from the guide, from the first step not yet done. */
  show(): void {
    this.progress.hidden = false;
    save(this.progress);
    this.render();
  }

  restart(): void {
    this.progress = { done: [], hidden: false };
    save(this.progress);
    this.render();
  }

  get finished(): boolean {
    return steps(this.kind).every((s) => this.progress.done.includes(s.id));
  }

  get hidden(): boolean {
    return this.progress.hidden;
  }

  private render(): void {
    const list = steps(this.kind);
    const next = list.find((s) => !this.progress.done.includes(s.id));
    if (this.progress.hidden || !next) {
      this.el.replaceChildren();
      this.el.hidden = true;
      return;
    }
    this.el.hidden = false;
    const n = list.indexOf(next) + 1;
    this.el.replaceChildren(
      h(
        "header",
        { class: "dm-coach-head" },
        h("span", { class: "dm-coach-count" }, `First steps, ${this.progress.done.length} of ${list.length}`),
        h(
          "button",
          {
            type: "button",
            class: "dm-coach-hide",
            "aria-label": "Hide first steps",
            title: "Hide. Open the guide (?) to see them again.",
            onclick: () => {
              this.progress.hidden = true;
              save(this.progress);
              this.render();
            },
          },
          "×",
        ),
      ),
      h("p", { class: "dm-coach-title" }, `${n}. ${next.title}`),
      h("p", { class: "dm-coach-how" }, next.how),
      h(
        "ol",
        { class: "dm-coach-dots", "aria-hidden": "true" },
        list.map((s) => h("li", { class: this.progress.done.includes(s.id) ? "done" : s === next ? "now" : "" })),
      ),
    );
  }
}
