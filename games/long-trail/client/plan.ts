// The leader's plan form, and the read-only plan card everyone votes on.
import { h } from "@games/ui";
import { stopById, type RouteDef, type SettingPack } from "../shared/pack.ts";
import { planProblem, unitPrice } from "../shared/travel.ts";
import type { LongTrailPublicState, Pace, Plan, Rations, Trade } from "../shared/types.ts";
import { caravanOf, HEALTH_LABEL, itemName, PACE_LABEL, planLines, RATIONS_LABEL, SUPPLIES, tradeTotals } from "./format.ts";

type Pub = LongTrailPublicState;

export interface PlanCtx {
  game: Pub;
  pack: SettingPack;
  route: RouteDef;
  me: string;
  name: (id: string) => string;
  /** Re-render after a change. */
  changed: () => void;
  propose: (plan: Plan) => void;
}

/** Trader's edge: the proposing leader is a living Trader. Same test as the server. */
export function traderLeads(game: Pub, leader: string): boolean {
  const job = game.players.find((p) => p.id === leader)?.job;
  return job === "trader" && (game.travellers.find((t) => t.id === leader)?.health ?? 0) > 0;
}

export function healerAlive(game: Pub): boolean {
  return game.players.some((p) => !p.left && p.job === "healer" && (game.travellers.find((t) => t.id === p.id)?.health ?? 0) > 0);
}

function segmented<T extends string>(label: string, options: [T, string][], value: T, set: (v: T) => void, disabled = false): HTMLElement {
  return h(
    "fieldset",
    { class: "lt-field" },
    h("legend", {}, label),
    h(
      "div",
      { class: "lt-seg", role: "group" },
      options.map(([v, text]) =>
        h("button", { type: "button", class: "lt-seg-btn", "aria-pressed": String(v === value), disabled, onclick: () => set(v) }, text),
      ),
    ),
  );
}

export class PlanForm {
  private draft: Plan | null = null;
  private qty: Record<string, number> = {};

  /** Start again from the open plan (a new day, a new leader, a new proposal). */
  reset() {
    this.draft = null;
    this.qty = {};
  }

  plan(game: Pub): Plan {
    const d = (this.draft ??= structuredClone(game.openPlan));
    // A traveller who left or died since the draft began can no longer take a dose.
    d.doses = d.doses.filter((id) => game.travellers.some((t) => t.id === id && t.health > 0));
    const trades: Trade[] = Object.entries(this.qty)
      .filter(([, q]) => q !== 0)
      .map(([item, qty]) => ({ item, qty }));
    return { ...d, doses: [...d.doses], trades };
  }

  render(x: PlanCtx): HTMLElement {
    const { game, pack, route } = x;
    const plan = this.plan(game);
    const d = this.draft!;
    const set = (patch: Partial<Plan>) => {
      Object.assign(d, patch);
      x.changed();
    };
    const c = caravanOf(game);
    const trader = traderLeads(game, x.me);
    const problem = planProblem(c, pack, route, plan, game.travellers.map((t) => t.id), { healerAlive: healerAlive(game), traderLeads: trader });

    const stop = stopById(route, game.at);
    const forkDay = game.leg === null && stop.next.length === 2;
    const sick = game.travellers.filter((t) => t.health > 0 && t.health < 3);

    const parts: (HTMLElement | null)[] = [
      segmented<Pace>("Pace", [["slow", PACE_LABEL.slow], ["steady", PACE_LABEL.steady], ["hard", PACE_LABEL.hard]], d.pace, (pace) => set({ pace }), d.rest),
      segmented<Rations>("Rations", [["full", RATIONS_LABEL.full], ["half", RATIONS_LABEL.half], ["none", RATIONS_LABEL.none]], d.rations, (rations) => set({ rations })),
      h(
        "fieldset",
        { class: "lt-field" },
        h("legend", {}, "Rest"),
        h(
          "button",
          { type: "button", class: "lt-toggle", "aria-pressed": String(d.rest), onclick: () => set({ rest: !d.rest }) },
          d.rest ? "Resting today" : "Rest today",
        ),
        h("p", { class: "lt-hint" }, d.rest ? "No travel today. Rest with full rations to heal." : "Rest heals, but the day is lost."),
      ),
      forkDay
        ? segmented<string>(
            "Which way?",
            // No km here: the public state keeps them hidden, and the Scout's job is to know them.
            stop.next.map((l): [string, string] => [l.to, stopById(route, l.to).name]),
            d.fork ?? "",
            (fork) => set({ fork }),
          )
        : null,
      game.stock.medicine > 0
        ? h(
            "fieldset",
            { class: "lt-field" },
            h("legend", {}, `Medicine (${game.stock.medicine} left)`),
            sick.length
              ? h(
                  "div",
                  { class: "lt-doses" },
                  sick.map((t) =>
                    h(
                      "label",
                      { class: "lt-check" },
                      h("input", {
                        type: "checkbox",
                        checked: d.doses.includes(t.id),
                        onchange: (e: Event) => {
                          const on = (e.target as HTMLInputElement).checked;
                          set({ doses: on ? [...d.doses, t.id] : d.doses.filter((id) => id !== t.id) });
                        },
                      }),
                      h("span", {}, `${x.name(t.id)} (${HEALTH_LABEL[t.health]})`),
                    ),
                  ),
                )
              : h("p", { class: "lt-hint" }, "Nobody needs medicine."),
          )
        : null,
      game.prices ? this.trades(x, plan.trades, trader) : null,
    ];

    return h(
      "div",
      { class: "lt-form" },
      parts,
      h("p", { class: "lt-problem", role: "status" }, problem ?? ""),
      h("button", { type: "button", class: "primary lt-action", disabled: !!problem, onclick: () => x.propose(this.plan(game)) }, "Propose"),
    );
  }

  private trades(x: PlanCtx, trades: Trade[], trader: boolean): HTMLElement {
    const { game, pack, route } = x;
    const c = caravanOf(game);
    const totals = tradeTotals(c, pack, route, trades, trader);
    const items = [...pack.goods.map((g) => g.id), ...SUPPLIES];
    const rows = items.flatMap((item) => {
      const buy = unitPrice(c, route, item, true, trader);
      const sell = unitPrice(c, route, item, false, trader);
      if (buy === undefined && sell === undefined) return [];
      const q = this.qty[item] ?? 0;
      const held = SUPPLIES.includes(item as never) ? null : (game.stock.cargo[item] ?? 0);
      const bump = (by: number) => {
        this.qty[item] = q + by;
        x.changed();
      };
      const price = buy === sell || sell === undefined ? `${buy} each` : `buy ${buy}, sell ${sell}`;
      const now = q > 0 ? `Buy ${q}` : q < 0 ? `Sell ${-q}` : held !== null ? `Have ${held}` : "";
      return [
        h(
          "li",
          { class: "lt-trade" },
          h("span", { class: "lt-trade-name" }, h("b", {}, itemName(pack, item)), h("small", {}, price)),
          h("span", { class: "lt-trade-now", "aria-live": "polite" }, now),
          h("button", { type: "button", class: "lt-step", "aria-label": `Less ${itemName(pack, item)}`, disabled: sell === undefined ? q <= 0 : q <= -(held ?? 0), onclick: () => bump(-1) }, "−"),
          h("button", { type: "button", class: "lt-step", "aria-label": `More ${itemName(pack, item)}`, disabled: buy === undefined ? q >= 0 : false, onclick: () => bump(1) }, "+"),
        ),
      ];
    });
    const heavy = totals.cargoAfter > totals.capacityAfter;
    return h(
      "fieldset",
      { class: "lt-field" },
      h("legend", {}, trader ? "Market (Trader prices)" : "Market"),
      h("ul", { class: "lt-trades" }, rows),
      h(
        "p",
        { class: "lt-totals" },
        `${pack.labels.coins}: ${game.stock.coins} → ${totals.coinsAfter}. ${pack.labels.cargo}: ${totals.cargoAfter} of ${totals.capacityAfter}.`,
      ),
      heavy ? h("p", { class: "lt-hint warn" }, "Too heavy. The caravan will walk one pace slower.") : null,
    );
  }
}

/** The plan being voted on: same card on every phone. */
export function planCard(plan: Plan, pack: SettingPack, route: RouteDef, name: (id: string) => string, title: string): HTMLElement {
  return h("div", { class: "lt-plan-card" }, h("p", { class: "lt-kicker" }, title), h("ul", {}, planLines(plan, pack, route, name).map((l) => h("li", {}, l))));
}
