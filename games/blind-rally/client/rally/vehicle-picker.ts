import { h, replaceChildren, type GameClientApi } from "@games/ui";
import type { BlindRallyPublicState } from "../../shared/types.ts";
import { VEHICLE_IDS, VEHICLES, type VehicleId, type VehicleInfo } from "../../shared/vehicles.ts";
import { vehicleSvg } from "./vehicle-art.ts";

// Rally's car picker on the grid, the track picker's twin (client/stages.ts).
// Free: you tap your own car. Ballot: you tap your car's vote, again to take
// it back, and everyone drives the winner. The five buttons are built once
// and updated in place, so focus stays put when the state comes back.

const BARS: [keyof VehicleInfo["bars"], string][] = [["speed", "Speed"], ["grip", "Grip"], ["offroad", "Off-road"], ["weight", "Weight"]];

export interface VehicleCard {
  id: VehicleId;
  name: string;
  blurb: string;
  bars: VehicleInfo["bars"];
  /** Free: my car's class. Ballot: my car's vote. */
  selected: boolean;
  votes: number;
  /** A level top that a coin toss broke: true on every class in it. */
  tied: boolean;
}

/** What each of the five cards shows, for player `me`. */
export function vehicleCards(game: BlindRallyPublicState, me: string): VehicleCard[] {
  const ballot = game.vehiclePick === "ballot" ? game.vehicleBallot : null;
  const mine = game.teams.find((t) => t.driverId === me);
  const myVote = ballot && mine ? ballot.votes.find((v) => v.teamId === mine.id)?.vehicleId ?? null : null;
  return VEHICLE_IDS.map((id) => ({
    id,
    name: VEHICLES[id].name,
    blurb: VEHICLES[id].blurb,
    bars: VEHICLES[id].bars,
    selected: ballot ? myVote === id : mine?.vehicle === id,
    votes: ballot ? ballot.votes.filter((v) => v.vehicleId === id).length : 0,
    tied: !!ballot && ballot.tied.length > 1 && ballot.tied.includes(id),
  }));
}

export class VehiclePicker {
  readonly el = h("section", { class: "rl-cars-pick", "aria-label": "Car" });
  private api: GameClientApi;
  private title = h("h3", {});
  private hint = h("p", { class: "br-stage-hint" });
  private list = h("div", { class: "rl-pick-list", role: "group", "aria-label": "Cars", onkeydown: (e: Event) => this.arrow(e as KeyboardEvent) });
  private buttons = new Map<VehicleId, HTMLButtonElement>();
  private editable = false;
  private mode: "free" | "ballot" = "free";
  private selected: VehicleId | null = null;

  constructor(api: GameClientApi) {
    this.api = api;
    for (const id of VEHICLE_IDS) {
      const b = h("button", { type: "button", class: "rl-pick", onclick: () => this.tap(id) });
      this.buttons.set(id, b);
      this.list.append(b);
    }
    replaceChildren(this.el, this.title, this.list, this.hint);
  }

  /** `editable`: in a car. Everyone else sees the cards read-only. The grid shows this only before the countdown. */
  update(game: BlindRallyPublicState, me: string, editable: boolean) {
    const ballot = game.vehiclePick === "ballot" ? game.vehicleBallot : null;
    const mine = game.teams.find((t) => t.driverId === me);
    // Every car drives the ballot's leader, so any car's class says who leads.
    const leader = game.teams.find((t) => t.driverId !== null)?.vehicle ?? null;
    const cards = vehicleCards(game, me);
    this.editable = editable && !!mine;
    this.mode = ballot ? "ballot" : "free";
    this.selected = cards.find((c) => c.selected)?.id ?? null;
    this.list.classList.toggle("ballot", !!ballot);
    this.title.textContent = ballot ? "Car: everyone votes" : mine ? "Your car" : "Cars";

    // One tab stop for the row: the selected card, else the first. Arrows move between them.
    const stop = this.selected ?? VEHICLE_IDS[0];
    for (const c of cards) {
      const tag =
        ballot && c.id === leader && ballot.votes.length
          ? c.tied ? "Winning: coin toss" : "Winning"
          : !ballot && c.selected ? "Yours" : "";
      const b = this.buttons.get(c.id)!;
      b.className = `rl-pick${c.selected ? " chosen" : ""}${ballot && c.id === leader ? " leads" : ""}`;
      b.setAttribute("aria-pressed", String(c.selected));
      if (this.editable) b.removeAttribute("aria-disabled");
      else b.setAttribute("aria-disabled", "true");
      b.tabIndex = c.id === stop ? 0 : -1;
      replaceChildren(
        b,
        h("span", { class: "rl-pick-name" }, c.name),
        vehicleSvg(c.id),
        h("span", { class: "rl-pick-blurb" }, c.blurb),
        h(
          "span",
          { class: "rl-bars" },
          BARS.map(([key, label]) =>
            h(
              "span",
              { class: "rl-bar" },
              h("span", { class: "rl-bar-label", "aria-hidden": "true" }, label),
              h("span", { class: "rl-ticks", "aria-hidden": "true" }, [1, 2, 3, 4, 5].map((n) => h("i", { class: n <= c.bars[key] ? "on" : "" }))),
              h("span", { class: "rl-sr" }, `${label} ${c.bars[key]} of 5.`),
            ),
          ),
        ),
        // The foot keeps its height when empty, so the five rows stay level.
        h(
          "span",
          { class: "br-track-foot" },
          ballot ? h("span", { class: "rl-pick-votes" }, `${c.votes} vote${c.votes === 1 ? "" : "s"}`) : null,
          tag ? h("span", { class: `br-track-tag${c.tied ? " tie" : ""}` }, tag) : null,
        ),
      );
    }

    const leaderName = leader ? VEHICLES[leader].name : VEHICLES.hatch.name;
    this.hint.textContent = ballot
      ? [
          this.editable
            ? this.selected ? "You voted for this. Tap again to remove your vote." : "Tap a car to vote for it."
            : "Every car gets 1 vote. You get a vote when you get a car.",
          ballot.votes.length ? `Everyone drives the ${leaderName}.` : `No votes yet. Everyone drives the ${leaderName} for now.`,
          "A new winner un-readies everyone.",
        ].join(" ")
      : this.editable
        ? "Tap a car to drive it. Changing your car un-readies you."
        : "Each player chooses a car. You choose when you get one.";
  }

  private tap(id: VehicleId) {
    if (!this.editable) return;
    if (this.mode === "ballot") this.api.act({ type: "vehicle.vote", vehicleId: this.selected === id ? null : id });
    else if (this.selected !== id) this.api.act({ type: "vehicle.pick", vehicleId: id });
  }

  /** Left/Right (and Home/End) walk the row, like a radio group. Enter and Space are the button's own. */
  private arrow(e: KeyboardEvent) {
    const all = [...this.buttons.values()];
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const to =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? (at + 1) % all.length
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (at - 1 + all.length) % all.length
      : e.key === "Home" ? 0
      : e.key === "End" ? all.length - 1
      : -1;
    if (to < 0) return;
    e.preventDefault();
    for (const b of all) b.tabIndex = -1;
    all[to]!.tabIndex = 0;
    all[to]!.focus();
    all[to]!.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}
