import { audio } from "@games/audio";
import { h, replaceChildren, type GameClientApi } from "@games/ui";
import { distance, reachable } from "../shared/hex.ts";
import { passable } from "../shared/maps.ts";
import { N } from "../shared/numbers.ts";
import { ROLE_ATTRS, WAY_BONUS, failCost, percent } from "../shared/roll.ts";
import { RUINS, type Approach } from "../shared/ruins.ts";
import type {
  Attr, Card, ItemId, Plan, PublicExplorer, PublicTile, Role, RuinId, TileId, Way, WildsPrivateState, WildsPublicState,
} from "../shared/types.ts";

type Pub = WildsPublicState;
type Priv = WildsPrivateState;

// ---- pure helpers (tested in test/client.test.ts) --------------------------

export type Draft = [Card | null, Card | null];
export type Slot = 0 | 1;
/** What a tap on the board picks for the open slot. */
export type Picking = { kind: "move" } | { kind: "act" } | { kind: "help" } | { kind: "item"; item: ItemId };
export interface Targets { highlight: Map<TileId, "ok" | "off">; offReason: Map<TileId, string> }

export const ATTR_NAME: Record<Attr, string> = { strength: "Strength", mind: "Mind", stealth: "Stealth" };
export const WAY_NAME: Record<Way, string> = { careful: "Careful", normal: "Normal", bold: "Bold" };
export const ITEM_NAME: Record<ItemId, string> = { torch: "Torch", planks: "Planks", medkit: "Medkit", lure: "Lure" };
const STONES = Object.keys(RUINS).length;

const FOG = "Fog: you can't plan a path there.";
const FOG_SEE = "Fog: you can't see what is there.";
const NEXT_TO = "Too far. Pick your tile or a tile next to you.";
const NEXT_ONLY = "Pick a tile next to you.";

/** +2, +0, −1. */
export const signed = (n: number): string => (n < 0 ? `−${-n}` : `+${n}`);

/** `Mind +2 · Bold +1 · need 9 · 72%`. Normal adds nothing, so it isn't named. */
export function oddsLine(role: Role | null, ap: Approach, way: Way): string {
  const attr = role ? ROLE_ATTRS[role][ap.attr] : 0;
  const parts = [`${ATTR_NAME[ap.attr]} ${signed(attr)}`];
  if (way !== "normal") parts.push(`${WAY_NAME[way]} ${signed(WAY_BONUS[way])}`);
  parts.push(`need ${ap.need}`, `${percent(attr + WAY_BONUS[way], ap.need)}%`);
  return parts.join(" · ");
}

/** What a failed roll costs, after the way of acting. */
export function failLine(ap: Approach, way: Way): string {
  const c = failCost(ap, way);
  const parts: string[] = [];
  if (c.damage > 0) parts.push(`you lose ${c.damage} ${c.damage === 1 ? "Heart" : "Hearts"}`);
  if (c.noise > 0) parts.push(`${c.noise} noise on the ruin`);
  return `If you fail: ${parts.join(", ")}.`;
}

export const FORCE_LINE = `No roll. The sun moves on by 1. ${N.forceNoise} noise.`;

const tileMap = (pub: Pub): Map<TileId, PublicTile> => new Map(pub.tiles.map((t) => [t.id, t] as const));
const meIn = (pub: Pub, me: string): PublicExplorer | undefined => pub.explorers.find((e) => e.id === me && !e.left);

/** Where you will stand when a slot plays: after Beat 1's Move, if Beat 1 is a Move. */
export function fromTile(pub: Pub, me: string, draft: Draft, slot: Slot): TileId | null {
  const first = draft[0];
  if (slot === 1 && first?.kind === "move") return first.to;
  return meIn(pub, me)?.tile ?? null;
}

/** Players a Help or a Medkit can name from `from`, with why the others can't be. */
export function people(pub: Pub, me: string, from: TileId, kind: "help" | "medkit"): { id: string; why: string | null }[] {
  return pub.explorers
    .filter((e) => !e.left && (kind === "medkit" || e.id !== me))
    .map((e) => {
      if (kind === "medkit" && e.down) return { id: e.id, why: "A Medkit can't get a down player up. Use Help." };
      if (e.id !== me && distance(from, e.tile) > 1) return { id: e.id, why: "Too far. Stand on their tile or next to it." };
      return { id: e.id, why: null };
    });
}

function moveWhy(pub: Pub, me: string, from: TileId, tiles: Map<TileId, PublicTile>): (t: TileId) => string | null {
  const role = meIn(pub, me)?.role ?? null;
  const steps = role === "runner" ? N.runnerMove : N.move;
  const spider = pub.spider?.tile ?? null;
  const canEnter = (t: TileId): boolean => {
    const x = tiles.get(t);
    return !!x && x.open && passable(x.terrain) && x.fire === 0 && t !== spider;
  };
  const reach = reachable(from, steps, canEnter, (t) => {
    const x = tiles.get(t);
    return !!x && x.open && x.terrain === "reeds";
  });
  return (t) => {
    if (t === from) return "You are here.";
    const x = tiles.get(t)!;
    if (!x.open) return FOG;
    if (reach.has(t)) return null;
    if (x.terrain === "river") return "River: you can't walk there. Find a bridge.";
    if (x.terrain === "broken") return "Broken bridge: it needs fixing first.";
    if (!passable(x.terrain)) return "Rock: you can't walk there.";
    if (x.fire > 0) return "Fire: you can't walk into it.";
    if (t === spider) return "The spider is there.";
    if (distance(from, t) > steps) return `Too far. You can move ${steps} tiles.`;
    return "You can't get there in one Move. Reeds stop a Move.";
  };
}

function actWhy(pub: Pub, me: string, from: TileId, tiles: Map<TileId, PublicTile>): (t: TileId) => string | null {
  const role = meIn(pub, me)?.role ?? null;
  return (t) => {
    if (distance(from, t) > 1) return NEXT_TO;
    const x = tiles.get(t)!;
    if (!x.open) return FOG_SEE;
    if (x.terrain === "gate") {
      if (pub.gateOpen) return "The gate is already open.";
      if (pub.stones.length < STONES) return `You need all ${STONES} key stones. You have ${pub.stones.length}.`;
      if (t !== from) return "Stand on the gate to open it.";
      return null;
    }
    if (x.ruin) return pub.stones.includes(x.ruin) ? "The key stone here is already found." : null;
    if (x.cache) return null;
    if (x.terrain === "broken") return role === "fixer" ? null : "Only a Fixer can fix this. Planks work too.";
    return "Nothing to do here.";
  };
}

function itemWhy(pub: Pub, me: string, from: TileId, item: ItemId, tiles: Map<TileId, PublicTile>): (t: TileId) => string | null {
  const spider = pub.spider?.tile ?? null;
  return (t) => {
    const x = tiles.get(t)!;
    if (item === "lure") {
      if (!x.open) return FOG_SEE;
      return distance(from, t) > N.lureRange ? `Too far. A Lure reaches ${N.lureRange} tiles.` : null;
    }
    if (item === "torch" || item === "planks") {
      if (distance(from, t) !== 1) return t === from ? NEXT_ONLY : `Too far. ${NEXT_ONLY}`;
      if (!x.open) return FOG_SEE;
      if (item === "torch") {
        if (t === spider) return null;
        if (x.terrain !== "forest" && x.terrain !== "bridge") return "Nothing here burns. Use the Torch on forest, a bridge or the spider.";
        return x.fire > 0 ? "It is already burning." : null;
      }
      if (x.terrain === "bridge") return "The bridge is fine.";
      return x.terrain === "broken" || x.terrain === "river" ? null : "Planks go on a river or a broken bridge.";
    }
    // medkit: a tile with someone it can reach
    return whoWhy(pub, me, from, "medkit", t);
  };
}

function whoWhy(pub: Pub, me: string, from: TileId, kind: "help" | "medkit", t: TileId): string | null {
  const here = people(pub, me, from, kind).filter((p) => pub.explorers.find((e) => e.id === p.id)!.tile === t);
  if (here.some((p) => p.why === null)) return null;
  if (here.length) return here[0]!.why;
  return kind === "help" ? "Nobody to help here. Tap a friend, or a name below." : "Nobody here. Tap a player, or a name below.";
}

/** Which tiles a card can name, and why the others are off. */
export function targets(pub: Pub, me: string, from: TileId, picking: Picking): Targets {
  const tiles = tileMap(pub);
  const why =
    picking.kind === "move" ? moveWhy(pub, me, from, tiles)
    : picking.kind === "act" ? actWhy(pub, me, from, tiles)
    : picking.kind === "item" ? itemWhy(pub, me, from, picking.item, tiles)
    : (t: TileId) => whoWhy(pub, me, from, "help", t);
  const highlight = new Map<TileId, "ok" | "off">();
  const offReason = new Map<TileId, string>();
  for (const t of pub.tiles) {
    const w = why(t.id);
    highlight.set(t.id, w === null ? "ok" : "off");
    if (w !== null) offReason.set(t.id, w);
  }
  return { highlight, offReason };
}

/** A short name for a planned card. */
export function cardLabel(card: Card | null, pub: Pub, me: string, name: (id: string) => string): string {
  if (!card) return "Empty";
  const tiles = tileMap(pub);
  const who = (id: string | undefined) => (!id || id === me ? "you" : name(id));
  switch (card.kind) {
    case "move": return "Move";
    case "look": return "Look";
    case "guard": return "Guard";
    case "help": return `Help ${who(card.who)}`;
    case "item": return card.item === "medkit" ? `Medkit on ${who(card.who)}` : ITEM_NAME[card.item];
    case "act": {
      const x = tiles.get(card.at);
      if (x?.open && x.ruin) {
        const ruin = RUINS[x.ruin];
        if (card.approach === "force") return `Force: ${ruin.name}`;
        if (card.approach === undefined) return `Act: ${ruin.name}`;
        const way = card.way && card.way !== "normal" ? `, ${WAY_NAME[card.way]}` : "";
        return `Act: ${ruin.name}${way}`;
      }
      if (x?.open && x.terrain === "gate") return "Open the gate";
      if (x?.open && x.cache) return "Open the cache";
      if (x?.open && x.terrain === "broken") return "Fix the bridge";
      return "Act";
    }
  }
}

/** A draft with empty slots filled as Guard, the way the server treats them. */
export const toPlan = (d: Draft): Plan => [d[0] ?? { kind: "guard" }, d[1] ?? { kind: "guard" }];

// ---- the tray ---------------------------------------------------------------

const CARDS = ["move", "look", "act", "item", "help", "guard"] as const;
type CardKind = (typeof CARDS)[number];
const CARD_NAME: Record<CardKind, string> = { move: "Move", look: "Look", act: "Act", item: "Item", help: "Help", guard: "Guard" };
const CARD_HINT: Record<CardKind, string> = {
  move: "Walk on open land",
  look: "Open the land near you",
  act: "Ruin, cache, bridge, gate",
  item: "Use something in your bag",
  help: "+1 to a roll, or get a friend up",
  guard: "Block 1 damage",
};
/** Small inline SVG icons for the cards. */
const CARD_ICON: Record<CardKind, string> = {
  move: "M4 18 L9 13 M9 13 L14 16 L20 6 M16 6 L20 6 L20 10",
  look: "M2 12 Q12 3 22 12 Q12 21 2 12 Z M12 9 A3 3 0 1 1 12 15 A3 3 0 1 1 12 9 Z",
  act: "M5 19 L14 10 M12 4 L20 12 L17 15 L9 7 Z",
  item: "M5 9 L19 9 L18 20 L6 20 Z M9 9 L9 6 A3 3 0 0 1 15 6 L15 9",
  help: "M12 20 L4 12 A4.5 4.5 0 0 1 12 6 A4.5 4.5 0 0 1 20 12 Z",
  guard: "M12 3 L19 6 L19 12 Q19 18 12 21 Q5 18 5 12 L5 6 Z",
};

function icon(d: string): HTMLElement {
  const span = h("span", { class: "wd-card-icon", "aria-hidden": "true" });
  span.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return span;
}

interface Sheet { at: TileId; ruin: RuinId; approach: 0 | 1 | null; way: Way }

/** Two beats, six cards, and the ruin sheet. Tile taps come in through `tap`. */
export class PlanTray {
  /** Called when something in the tray changed and the board needs new highlights. */
  onChange: () => void = () => {};
  private name: (id: string) => string = (id) => id;
  private root = h("section", { class: "wd-tray", "aria-label": "Your plan" });
  private draft: Draft = [null, null];
  private slot: Slot = 0;
  private picking: Picking | { kind: "item-choose" } | null = null;
  private sheet: Sheet | null = null;
  private note = "";
  private stage = "";
  private resync = false;
  private last: { pub: Pub; priv: Priv | null; me: string } | null = null;

  private api: GameClientApi;

  constructor(api: GameClientApi) {
    this.api = api;
  }

  setNames(name: (id: string) => string): void {
    this.name = name;
  }

  /** The server refused a plan: say why, and take its copy back. */
  rejected(message: string): void {
    this.note = message;
    this.resync = true;
  }

  /** Highlights for the board while a card waits for a target. */
  targets(): Targets & { marks: Map<TileId, string> } {
    const marks = new Map<TileId, string>();
    const empty = { highlight: new Map(), offReason: new Map(), marks };
    const l = this.last;
    if (!l || l.pub.phase !== "plan") return empty;
    this.draft.forEach((c, i) => {
      if (c?.kind === "move") marks.set(c.to, marks.has(c.to) ? "1 2" : String(i + 1));
    });
    if (this.locked() || !this.picking || this.picking.kind === "item-choose") return { ...empty, marks };
    const from = fromTile(l.pub, l.me, this.draft, this.slot);
    if (!from) return { ...empty, marks };
    return { ...targets(l.pub, l.me, from, this.picking), marks };
  }

  /** A tap on the board. */
  tap(t: TileId): void {
    const l = this.last;
    if (!l || this.locked() || l.pub.phase !== "plan") return;
    const p = this.picking;
    if (!p || p.kind === "item-choose") {
      this.note = "Pick an action card first.";
      return this.onChange();
    }
    const from = fromTile(l.pub, l.me, this.draft, this.slot);
    if (!from) return;
    const { offReason } = targets(l.pub, l.me, from, p);
    const why = offReason.get(t);
    if (why) {
      this.note = why;
      audio.play("reject");
      return this.onChange();
    }
    this.note = "";
    switch (p.kind) {
      case "move":
        return this.set({ kind: "move", to: t });
      case "act": {
        const x = l.pub.tiles.find((y) => y.id === t);
        if (x?.open && x.ruin) {
          const prev = this.draft[this.slot];
          const same = prev?.kind === "act" && prev.at === t;
          this.sheet = {
            at: t, ruin: x.ruin,
            approach: same && (prev.approach === 0 || prev.approach === 1) ? prev.approach : null,
            way: (same && prev.way) || "normal",
          };
          return this.onChange();
        }
        return this.set({ kind: "act", at: t });
      }
      case "item":
        if (p.item === "medkit") return this.pickWho(t, "medkit");
        return this.set({ kind: "item", item: p.item, at: t });
      case "help":
        return this.pickWho(t, "help");
    }
  }

  private pickWho(t: TileId, kind: "help" | "medkit") {
    const l = this.last!;
    const from = fromTile(l.pub, l.me, this.draft, this.slot)!;
    const okHere = people(l.pub, l.me, from, kind).filter((p) => p.why === null && l.pub.explorers.find((e) => e.id === p.id)!.tile === t);
    if (okHere.length !== 1) {
      this.note = "More than one player is here. Pick a name below.";
      return this.onChange();
    }
    this.setWho(okHere[0]!.id, kind);
  }

  private setWho(id: string, kind: "help" | "medkit") {
    this.set(kind === "help" ? { kind: "help", who: id } : { kind: "item", item: "medkit", who: id });
  }

  private locked(): boolean {
    return !!this.last?.priv?.ready;
  }

  /** Put a card in the open slot, send the plan, and move to the other slot if it's empty. */
  private set(card: Card) {
    this.draft[this.slot] = card;
    this.picking = null;
    this.sheet = null;
    this.note = "";
    const other: Slot = this.slot === 0 ? 1 : 0;
    if (!this.draft[other]) this.slot = other;
    this.api.act({ type: "set-plan", plan: toPlan(this.draft) });
    audio.play("card-place");
    this.onChange();
  }

  private pickCard(kind: CardKind) {
    const l = this.last!;
    this.sheet = null;
    this.note = "";
    if (kind === "look" || kind === "guard") return this.set({ kind });
    if (kind === "item") {
      const items = [...new Set(meIn(l.pub, l.me)?.items ?? [])];
      this.picking = items.length === 1 ? { kind: "item", item: items[0]! } : { kind: "item-choose" };
    } else {
      this.picking = { kind };
    }
    this.onChange();
  }

  render(pub: Pub, priv: Priv | null, me: string): HTMLElement {
    this.last = { pub, priv, me };
    const stage = `${pub.phase}:${pub.round}`;
    if (stage !== this.stage || this.resync) {
      if (stage !== this.stage) this.note = "";
      this.stage = stage;
      this.resync = false;
      this.draft = priv?.plan ? [priv.plan[0], priv.plan[1]] : [null, null];
      this.slot = 0;
      this.picking = null;
      this.sheet = null;
    }
    const self = meIn(pub, me);
    if (pub.phase !== "plan" || !self) {
      replaceChildren(this.root);
      return this.root;
    }
    if (self.down) {
      replaceChildren(this.root, h("p", { class: "wd-down-note" }, "You are down. A friend can Help you up."));
      return this.root;
    }
    if (priv?.ready) {
      const waiting = pub.explorers.filter((e) => !e.left && !e.down && !e.ready).length;
      replaceChildren(
        this.root,
        this.slots(true),
        h("p", { class: "wd-hint" }, waiting ? `Your plan is in. ${waiting} still planning.` : "Your plan is in."),
        h("button", { type: "button", class: "wd-wide", onclick: () => this.api.act({ type: "unready" }) }, "Edit"),
      );
      return this.root;
    }
    const empty = this.draft.some((c) => !c);
    replaceChildren(
      this.root,
      this.slots(false),
      this.cards(self),
      this.pickPanel(),
      h("p", { class: "wd-note", role: "status", "aria-live": "polite" }, this.note),
      h(
        "button",
        { type: "button", class: "primary wd-wide", onclick: () => { this.api.act({ type: "ready" }); audio.play("card-place"); } },
        "Ready",
      ),
      empty ? h("p", { class: "wd-hint" }, "An empty beat becomes Guard.") : null,
      this.sheet ? this.sheetView(self) : null,
    );
    return this.root;
  }

  private slots(locked: boolean): HTMLElement {
    const l = this.last!;
    return h(
      "div",
      { class: "wd-slots" },
      ([0, 1] as const).map((i) =>
        h(
          "button",
          {
            type: "button",
            class: "wd-slot",
            "aria-pressed": String(!locked && this.slot === i),
            disabled: locked,
            onclick: () => {
              this.slot = i;
              this.picking = null;
              this.sheet = null;
              this.note = "";
              this.onChange();
            },
          },
          h("small", {}, `Beat ${i + 1}`),
          h("b", {}, cardLabel(this.draft[i], l.pub, l.me, this.name)),
        ),
      ),
    );
  }

  private cards(self: PublicExplorer): HTMLElement {
    const active = this.picking?.kind === "item-choose" ? "item" : this.picking?.kind ?? null;
    return h(
      "div",
      { class: "wd-cards" },
      CARDS.map((k) => {
        const noItems = k === "item" && self.items.length === 0;
        return h(
          "button",
          {
            type: "button",
            class: "wd-card",
            "aria-pressed": String(active === k),
            disabled: noItems,
            title: noItems ? "Your bag is empty." : CARD_HINT[k],
            onclick: () => this.pickCard(k),
          },
          icon(CARD_ICON[k]),
          h("b", {}, CARD_NAME[k]),
          h("small", {}, noItems ? "Bag is empty" : CARD_HINT[k]),
        );
      }),
    );
  }

  /** What to do next for the card being picked: an item, a name, or a tile. */
  private pickPanel(): HTMLElement | null {
    const p = this.picking;
    const l = this.last!;
    if (!p) return null;
    const cancel = h("button", { type: "button", class: "link", onclick: () => { this.picking = null; this.note = ""; this.onChange(); } }, "Cancel");
    if (p.kind === "item-choose") {
      const items = [...new Set(meIn(l.pub, l.me)?.items ?? [])];
      return h(
        "div",
        { class: "wd-pick" },
        h("p", {}, "Which item?"),
        h("div", { class: "wd-pick-row" }, items.map((it) =>
          h("button", { type: "button", onclick: () => { this.picking = { kind: "item", item: it }; this.onChange(); } }, ITEM_NAME[it]))),
        cancel,
      );
    }
    const from = fromTile(l.pub, l.me, this.draft, this.slot);
    if (p.kind === "help" || (p.kind === "item" && p.item === "medkit")) {
      if (!from) return null;
      const kind = p.kind === "help" ? "help" : "medkit";
      const list = people(l.pub, l.me, from, kind);
      return h(
        "div",
        { class: "wd-pick" },
        h("p", {}, kind === "help" ? "Help who? Help works on your tile or next to it." : "Medkit on who?"),
        h("div", { class: "wd-pick-row" }, list.map((x) =>
          h(
            "button",
            {
              type: "button",
              class: x.why ? "wd-off" : "",
              "aria-disabled": x.why ? "true" : undefined,
              title: x.why ?? undefined,
              onclick: () => {
                if (x.why) { this.note = x.why; return this.onChange(); }
                this.setWho(x.id, kind);
              },
            },
            x.id === l.me ? "You" : this.name(x.id),
          ))),
        cancel,
      );
    }
    const what = p.kind === "move" ? "Tap a lit tile to move there." : p.kind === "act" ? "Tap a lit tile to act there." : `Tap a lit tile for the ${ITEM_NAME[p.item]}.`;
    return h("div", { class: "wd-pick" }, h("p", {}, what), cancel);
  }

  private sheetView(self: PublicExplorer): HTMLElement {
    const s = this.sheet!;
    const ruin = RUINS[s.ruin];
    const pub = this.last!.pub;
    const close = () => { this.sheet = null; this.onChange(); };
    const body: (HTMLElement | null)[] = [];
    if (pub.half.includes(s.ruin)) {
      body.push(
        h("p", {}, "This ruin is half open. Your Act takes the key stone. No roll."),
        h("button", { type: "button", class: "primary wd-wide", onclick: () => this.set({ kind: "act", at: s.at }) }, "Take the key stone"),
      );
    } else {
      body.push(
        h("div", { class: "wd-ways-in" }, ruin.approaches.map((ap, i) =>
          h(
            "button",
            {
              type: "button",
              class: "wd-way-in",
              "aria-pressed": String(s.approach === i),
              onclick: () => { s.approach = i as 0 | 1; this.onChange(); },
            },
            h("b", {}, ap.label),
            h("span", { class: "wd-odds" }, oddsLine(self.role, ap, s.way)),
            h("small", {}, "+1 if someone helps"),
            h("small", {}, failLine(ap, s.way)),
          ))),
        h("div", { class: "wd-ways", role: "group", "aria-label": "Way of acting" }, (["careful", "normal", "bold"] as const).map((w) =>
          h(
            "button",
            { type: "button", "aria-pressed": String(s.way === w), onclick: () => { s.way = w; this.onChange(); } },
            h("b", {}, WAY_NAME[w]),
            h("small", {}, w === "careful" ? `${signed(WAY_BONUS.careful)}. A fail costs less.` : w === "bold" ? `${signed(WAY_BONUS.bold)}. ${N.boldNoise} noise on your tile.` : "No change."),
          ))),
        h(
          "button",
          {
            type: "button",
            class: "primary wd-wide",
            disabled: s.approach === null,
            onclick: () => { if (s.approach !== null) this.set({ kind: "act", at: s.at, approach: s.approach, way: s.way }); },
          },
          s.approach === null ? "Pick a way in" : "Plan this",
        ),
        h(
          "button",
          { type: "button", class: "wd-force", onclick: () => this.set({ kind: "act", at: s.at, approach: "force" }) },
          h("b", {}, "Force"),
          h("small", {}, FORCE_LINE),
        ),
      );
    }
    return h(
      "div",
      { class: "wd-sheet-wrap", onclick: (e: Event) => { if (e.target === e.currentTarget) close(); } },
      h(
        "div",
        { class: "wd-sheet", role: "dialog", "aria-label": ruin.name },
        h("div", { class: "wd-sheet-head" }, h("h2", {}, ruin.name), h("button", { type: "button", class: "link", onclick: close }, "Close")),
        ...body,
      ),
    );
  }
}
