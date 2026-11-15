// The round report: the round played back on the board, one step at a time, then the lines.
import { dieSvg, h } from "@games/ui";
import { EVENTS } from "../shared/events.ts";
import { distance } from "../shared/hex.ts";
import { N } from "../shared/numbers.ts";
import { RUINS } from "../shared/ruins.ts";
import type { PublicTile, Step, TileId, WildsPublicState } from "../shared/types.ts";
import { tileXY } from "./board.ts";
import { ATTR_NAME, ITEM_NAME, signed } from "./plan.ts";

type Pub = WildsPublicState;
type Name = (id: string) => string;
type RollStep = Extract<Step, { t: "roll" }>;

/** About half a second a step. A walk takes a beat a tile, a roll a little longer to read. */
export const STEP_MS = 500;
export const HOP_MS = 250;
export const ROLL_MS = 1200;
/** A long round is played faster, never faster than this a frame. */
export const MIN_MS = 120;

export interface Frame {
  /** The board as it is after this step. */
  pub: Pub;
  ms: number;
  caption: string;
  roll: RollStep | null;
  /** Something that slides from one tile to the next as the frame comes in. */
  slide: { who: string; from: TileId; to: TileId } | null;
  /** A tile whose fire flickers in. */
  flame: TileId | null;
}

/** The spider's id in `Frame.slide`. Player ids never look like this. */
export const SPIDER = "@spider";

const hearts = (n: number) => `${n} ${n === 1 ? "Heart" : "Hearts"}`;

/** `{{p0}}` tokens in the server's lines, filled with names. */
export const fillNames = (line: string, name: Name): string => line.replace(/\{\{([^}]+)\}\}/g, (_, id: string) => name(id));

/** "4 + 3 + 2 = 9. Need 9." The bonus is left out when it is 0. */
export function rollText(s: RollStep): string {
  const total = s.dice[0] + s.dice[1] + s.bonus;
  const bonus = s.bonus === 0 ? "" : ` ${s.bonus < 0 ? "−" : "+"} ${Math.abs(s.bonus)}`;
  return `${s.dice[0]} + ${s.dice[1]}${bonus} = ${total}. Need ${s.need}.`;
}

/** How the vote went, or null for an event with no vote. */
export function voteResult(pub: Pub): string | null {
  const votes = pub.lastRound?.votes;
  const ev = pub.lastRound?.steps.find((s): s is Extract<Step, { t: "event" }> => s.t === "event");
  if (!votes || !ev || ev.option === null) return null;
  const card = EVENTS[ev.id];
  const options = card.options ?? [];
  const chosen = options[ev.option] ?? "";
  const total = votes.reduce((a, b) => a + b, 0);
  if (total === 0) return card.kind === "bargain" ? `No one voted, so: ${chosen}.` : `No one voted. ${chosen}.`;
  const tie = votes.filter((v) => v === votes[ev.option!]).length > 1;
  const why = tie ? (card.kind === "bargain" ? " A tie means Refuse." : " A tie goes to the first option.") : "";
  return `The vote: ${chosen}, ${votes[ev.option]} of ${total}.${why}`;
}

/**
 * The round as frames, from the board before the beats (`start`) to the board now (`end`).
 * Tiles that open take what `end` shows; a tile still in the fog at the end never opens here.
 * The last frame is `end` itself, so the playback always lands on the real state.
 */
export function buildFrames(start: Pub, end: Pub, steps: Step[], name: Name): Frame[] {
  const cur: Pub = structuredClone(start);
  cur.phase = end.phase;
  cur.event = structuredClone(end.event);
  if (cur.spider) cur.spider.arrow = null;
  const endTiles = new Map(end.tiles.map((t) => [t.id, t] as const));
  const frames: Frame[] = [];
  const push = (caption: string, extra: Partial<Pick<Frame, "ms" | "roll" | "slide" | "flame">> = {}) =>
    frames.push({ pub: structuredClone(cur), ms: STEP_MS, caption, roll: null, slide: null, flame: null, ...extra });

  const tile = (id: TileId) => {
    const i = cur.tiles.findIndex((t) => t.id === id);
    const t = cur.tiles[i];
    return t?.open ? t : null;
  };
  const who = (id: string) => cur.explorers.find((e) => e.id === id);

  /** A walk, one frame a tile. */
  const walk = (id: string, path: TileId[], caption: string, at: () => TileId | null, set: (t: TileId) => void) => {
    for (const to of path) {
      const from = at();
      if (from === to) continue;
      set(to);
      push(caption, { ms: HOP_MS, slide: from ? { who: id, from, to } : null });
    }
  };

  push("", { ms: STEP_MS });
  for (const s of steps) {
    switch (s.t) {
      case "move": {
        const e = who(s.who);
        if (!e) break;
        walk(s.who, s.path, `${name(s.who)} moves.`, () => e.tile, (t) => (e.tile = t));
        break;
      }
      case "open": {
        let any = false;
        for (const id of s.tiles) {
          const now = endTiles.get(id);
          const i = cur.tiles.findIndex((t) => t.id === id);
          if (!now?.open || i < 0 || cur.tiles[i]!.open) continue;
          cur.tiles[i] = structuredClone(now);
          any = true;
        }
        if (any) push("New land opens.");
        break;
      }
      case "roll":
        push(`${name(s.who)} rolls at the ${RUINS[s.ruin].name}. ${ATTR_NAME[s.attr]} ${signed(s.bonus)}${s.helpers.length ? ", with help" : ""}.`, { ms: ROLL_MS, roll: s });
        break;
      case "stone":
        cur.half = cur.half.filter((r) => r !== s.ruin);
        if (!cur.stones.includes(s.ruin)) cur.stones.push(s.ruin);
        push(s.how === "force" ? `${name(s.who)} forces the ${RUINS[s.ruin].name} open.` : `${name(s.who)} finds the key stone.`);
        break;
      case "half":
        if (!cur.half.includes(s.ruin)) cur.half.push(s.ruin);
        push(`The ${RUINS[s.ruin].name} is half open. The next try always works.`);
        break;
      case "damage": {
        const e = who(s.who);
        if (s.blocked) {
          push(`${name(s.who)} is safe. Guard stopped it.`);
          break;
        }
        if (e) e.hearts = Math.max(0, e.hearts - 1);
        const n = name(s.who);
        push(
          s.by === "spider" ? `The spider bites ${n}.`
          : s.by === "fire" ? `The fire hurts ${n}.`
          : s.by === "rocks" ? `Rocks hit ${n}.`
          : `${n} gets hurt at the ruin.`,
        );
        break;
      }
      case "down": {
        const e = who(s.who);
        if (e) Object.assign(e, { down: true, hearts: 0 });
        push(`${name(s.who)} is down.`);
        break;
      }
      case "up": {
        const e = who(s.who);
        if (e) Object.assign(e, { down: false, hearts: Math.max(1, e.hearts) });
        push(s.by ? `${name(s.by)} gets ${name(s.who)} back up.` : `${name(s.who)} is back up.`);
        break;
      }
      case "heal": {
        const e = who(s.who);
        if (e) e.hearts = Math.min(N.hearts, e.hearts + s.hearts);
        push(s.hearts > 0 ? `${name(s.who)} gets ${hearts(s.hearts)}.` : `${name(s.who)} already has ${hearts(N.hearts)}.`);
        break;
      }
      case "item":
        push(`${name(s.who)} uses the ${ITEM_NAME[s.item]}.`);
        break;
      case "lit": {
        const t = tile(s.tile);
        if (t) t.fire = N.fireLife;
        push(s.by ? `${name(s.by)} starts a fire.` : "The fire spreads.", { flame: s.tile });
        break;
      }
      case "out":
        for (const id of s.tiles) {
          const t = tile(id);
          if (t) t.fire = 0;
        }
        push("The fire goes out.");
        break;
      case "burnt": {
        const t = tile(s.tile);
        if (t) Object.assign(t, { terrain: s.to, fire: 0 });
        push(s.to === "broken" ? "The fire breaks the bridge." : "The forest burns down.");
        break;
      }
      case "bridge": {
        const t = tile(s.tile);
        if (t) t.terrain = s.fixed ? "bridge" : "broken";
        push(!s.fixed ? "The bridge breaks." : s.by ? `${name(s.by)} fixes the bridge.` : "The bridge is fixed.");
        break;
      }
      case "spider": {
        const caption = SPIDER_WHY[s.why];
        if (!cur.spider) cur.spider = { tile: s.path[0]!, arrow: null };
        const spider = cur.spider;
        const before = frames.length;
        walk(SPIDER, s.path, caption, () => spider.tile, (t) => (spider.tile = t));
        if (frames.length === before) push(caption);
        break;
      }
      case "noise": {
        const t = tile(s.tile);
        if (t) t.noise = s.level;
        push(`Noise goes up to ${s.level}.`);
        break;
      }
      case "cache": {
        const e = who(s.who);
        const t = e && cur.tiles.find((x): x is Extract<PublicTile, { open: true }> =>
          x.open && x.cache && distance(x.id, e.tile) <= 1 && !(endTiles.get(x.id) as { cache?: boolean } | undefined)?.cache);
        if (t) t.cache = false;
        push(s.item ? `${name(s.who)} finds ${ITEM_NAME[s.item]} in the cache.` : "The cache is empty.");
        break;
      }
      case "gate":
        cur.gateOpen = true;
        push(`${name(s.who)} opens the gate.`);
        break;
      case "guard":
        if (s.why) push(`${name(s.who)} guards instead. ${s.why}`);
        break;
      case "help-nothing":
        push(`${name(s.who)}'s Help did nothing.`);
        break;
      case "event": {
        const card = EVENTS[s.id];
        const option = s.option !== null ? card.options?.[s.option] : undefined;
        push(s.nothing ? `${card.title}: nothing happens.` : option ? `${card.title}: ${option}.` : `${card.title}.`);
        break;
      }
      case "fire-full":
        break;
    }
  }
  frames.push({ pub: end, ms: 0, caption: "", roll: null, slide: null, flame: null });
  return frames;
}

const SPIDER_WHY: Record<Extract<Step, { t: "spider" }>["why"], string> = {
  scared: "The spider runs away.",
  noise: "The spider goes to the noise.",
  hunt: "The spider hunts.",
  home: "The spider goes home.",
  rest: "The spider rests.",
  still: "The spider stays still.",
};

/** Plays faster when the round is long, so it fits in `budget` ms. */
export function fitFrames(frames: Frame[], budget: number): Frame[] {
  const total = frames.reduce((a, f) => a + f.ms, 0);
  if (total <= budget || total === 0) return frames;
  const k = Math.max(0, budget) / total;
  return frames.map((f) => (f.ms === 0 ? f : { ...f, ms: Math.max(MIN_MS, Math.round(f.ms * k)) }));
}

// ---- playing it ---------------------------------------------------------------

/** Steps through frames on a timer. `show` draws one; `idle()` waits for the end. */
export class Playback {
  private frames: Frame[] = [];
  private i = -1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private waiters: (() => void)[] = [];
  private show: (f: Frame | null) => void;

  constructor(show: (f: Frame | null) => void) {
    this.show = show;
  }

  get running(): boolean {
    return this.timer !== null;
  }
  get frame(): Frame | null {
    return this.running ? (this.frames[this.i] ?? null) : null;
  }

  play(frames: Frame[]): void {
    this.cancel();
    if (frames.length === 0) return this.end();
    this.frames = frames;
    this.i = -1;
    this.timer = setTimeout(() => this.tick(), 0);
  }

  private tick(): void {
    this.i += 1;
    const f = this.frames[this.i];
    if (!f || this.i === this.frames.length - 1) return this.end();
    this.timer = setTimeout(() => this.tick(), f.ms);
    this.show(f);
  }

  /** Jump to the end. */
  skip(): void {
    if (this.running) this.end();
  }

  private cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private end(): void {
    this.cancel();
    this.frames = [];
    this.i = -1;
    this.show(null);
    for (const w of this.waiters.splice(0)) w();
  }

  idle(): Promise<void> {
    return this.running ? new Promise((r) => this.waiters.push(r)) : Promise.resolve();
  }

  destroy(): void {
    this.cancel();
    for (const w of this.waiters.splice(0)) w();
  }
}

/** The slide or flicker a frame brings in, on the board it was just drawn on. */
export function animate(svg: SVGSVGElement, f: Frame): void {
  if (typeof Element.prototype.animate !== "function") return;
  if (f.slide) {
    const el = f.slide.who === SPIDER
      ? svg.querySelector(`[data-tile="${f.slide.to}"] .wd-spider`)
      : svg.querySelector(`.wd-token[data-who="${CSS.escape(f.slide.who)}"]`);
    const a = tileXY(f.slide.from);
    const b = tileXY(f.slide.to);
    el?.animate(
      [{ translate: `${(a.x - b.x).toFixed(2)}px ${(a.y - b.y).toFixed(2)}px` }, { translate: "0px 0px" }],
      { duration: Math.round(f.ms * 0.85), easing: "ease-out" },
    );
  }
  if (f.flame) {
    svg.querySelector(`[data-tile="${f.flame}"] .wd-fire`)?.animate(
      [{ opacity: 0 }, { opacity: 1 }, { opacity: 0.4 }, { opacity: 1 }],
      { duration: Math.min(450, f.ms), easing: "ease-in-out" },
    );
  }
}

/** Two dice, the sum and the need, and whether it worked. */
export function rollBox(s: RollStep): HTMLElement {
  const dice = h("span", { class: "wd-dice" });
  dice.innerHTML = dieSvg(s.dice[0], { label: String(s.dice[0]) }) + dieSvg(s.dice[1], { label: String(s.dice[1]) });
  return h(
    "div",
    { class: `wd-roll ${s.pass ? "pass" : "fail"}` },
    dice,
    h("span", { class: "wd-roll-sum" }, rollText(s)),
    h("b", {}, s.pass ? "It works." : "It fails."),
  );
}
