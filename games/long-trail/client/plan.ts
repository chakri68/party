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
  /** Propose was tapped and this plan is on its way: a second tap would only be rejected. */
  private sent = false;

  /** Start again from the open plan (a new day, a new leader, a new proposal). */
  reset() {
    this.draft = null;
    this.qty = {};
    this.sent = false;
  }

  /** The server said no: let the leader try again. */
  unlock() {
    this.sent = false;
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
      this.sent = false;
      x.changed();
    };
    const c = caravanOf(game);
    const trader = traderLeads(game, x.me);
    const problem = planProblem(c, pack, route, plan, game.travellers.map((t) => t.id), { healerAlive: healerAlive(game), traderLeads: trader });

    const stop = stopById(route, game.at);
    const forkDay = game.leg === null && stop.next.length === 2;
    const sick = game.travellers.filter((t) => t.health > 0 && t.health < 3);
    // Trades come first, so medicine bought in this plan counts for today's doses.
    const medicine = game.stock.medicine + Math.max(0, game.prices ? (this.qty.medicine ?? 0) : 0);

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
      medicine > 0
        ? h(
            "fieldset",
            { class: "lt-field" },
            h("legend", {}, game.stock.medicine === medicine ? `Medicine (${medicine} left)` : `Medicine (${medicine}, with what you buy)`),
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
      h(
        "button",
        {
          type: "button",
          class: "primary lt-action",
          disabled: !!problem || this.sent,
          onclick: (e: Event) => {
            if (this.sent) return;
            this.sent = true;
            (e.currentTarget as HTMLButtonElement).disabled = true;
            x.propose(this.plan(game));
          },
        },
        "Propose",
      ),
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
      // Food and water are bought by the dozen, so they get a 5 step too.
      const big = item === "food" || item === "water";
      const min = sell === undefined ? 0 : -(held ?? 0);
      const bump = (by: number) => {
        let next = Math.max(min, q + by);
        if (by > 1 && buy !== undefined && buy > 0 && q >= 0) {
          // A big step stops at what the coins can still pay for.
          const most = q + Math.floor(Math.max(0, totals.coinsAfter) / buy);
          next = Math.max(q + 1, Math.min(next, most));
        }
        this.qty[item] = next;
        this.sent = false;
        x.changed();
      };
      const price = buy === sell || sell === undefined ? `${buy} each` : `buy ${buy}, sell ${sell}`;
      const now = q > 0 ? `Buy ${q}` : q < 0 ? `Sell ${-q}` : held !== null ? `Have ${held}` : "";
      const name = itemName(pack, item);
      const less = q <= min;
      const more = buy === undefined ? q >= 0 : false;
      const step = (by: number, label: string, aria: string, disabled: boolean) =>
        h("button", { type: "button", class: "lt-step", "aria-label": aria, disabled, onclick: () => bump(by) }, label);
      return [
        h(
          "li",
          { class: big ? "lt-trade lt-trade-big" : "lt-trade" },
          h("span", { class: "lt-trade-name" }, h("b", {}, name), h("small", {}, price)),
          h("span", { class: "lt-trade-now", "aria-live": "polite" }, now),
          big ? step(-5, "−5", `5 less ${name}`, less) : null,
          step(-1, "−", `1 less ${name}`, less),
          step(1, "+", `1 more ${name}`, more),
          big ? step(5, "+5", `5 more ${name}`, more) : null,
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
