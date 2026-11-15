import { shuffle } from "@games/game-core";
import { distance, neighbours } from "../shared/hex.ts";
import { EVENTS } from "../shared/events.ts";
import { passable } from "../shared/maps.ts";
import { N } from "../shared/numbers.ts";
import type { Deck, EventId, LiveEvent, PendingBargain, Step, TileId, World } from "../shared/types.ts";
import { burning, rainOut } from "./fire.ts";
import { active, addNoise, hurt, openAround, type Rnd } from "./world.ts";

const ALL = Object.keys(EVENTS) as EventId[];

export function newDeck(rnd: Rnd): Deck {
  return { pile: shuffle([...ALL], rnd), lastKind: null };
}

const tilesOf = (w: World, f: (t: World["tiles"][string]) => boolean): TileId[] =>
  w.order.filter((id) => f(w.tiles[id]!));
const closedCaches = (w: World) => tilesOf(w, (t) => t.cache && !t.open);
const bridges = (w: World, terrain: "bridge" | "broken") => tilesOf(w, (t) => t.terrain === terrain);

export function canApply(w: World, id: EventId, pending: PendingBargain | null): boolean {
  switch (id) {
    case "quiet-morning": case "bird-calls": case "clear-sky": case "falling-rocks": return true;
    case "old-camp": return closedCaches(w).length > 0;
    case "rain": case "dry-wind": return burning(w).length > 0;
    case "hungry-spider":
      return active(w).some((e) => distance(e.tile, w.spider.tile) <= N.spiderNoiseRange);
    case "rotten-bridge": return bridges(w, "bridge").length > 0;
    case "echo-reeds": return tilesOf(w, (t) => t.terrain === "reeds").length > 0;
    case "stone-hand": return pending === null && bridges(w, "broken").length > 0;
    case "warm-spring": return pending === null && w.explorers.some((e) => !e.left && e.hearts < N.hearts);
  }
}

/** The card for round `forRound`. Applies spec 6.1. Removes it from the pile. Falls back to quiet-morning. */
export function draw(
  deck: Deck, w: World, forRound: number, pending: PendingBargain | null, current: EventId | null, rnd: Rnd,
): EventId {
  if (deck.pile.length === 0) deck.pile = shuffle([...ALL], rnd);
  for (let i = 0; i < deck.pile.length; i++) {
    const id = deck.pile[i]!;
    const kind = EVENTS[id].kind;
    if (id === current) continue;
    if (forRound <= N.calmRounds && kind !== "calm") continue;
    if (kind === "harm" && deck.lastKind === "harm") continue;
    if (kind === "bargain" && pending) continue;
    if (!canApply(w, id, pending)) continue;
    deck.pile.splice(i, 1);
    deck.lastKind = kind;
    return id;
  }
  deck.lastKind = "calm";
  return "quiet-morning";
}

const pickOne = <T>(items: T[], rnd: Rnd): T | undefined => items[rnd(items.length)];

/** Shown tiles, chosen when the card becomes this round's event. */
export function pickTiles(w: World, id: EventId, rnd: Rnd): TileId[] {
  switch (id) {
    case "old-camp": { const t = pickOne(closedCaches(w), rnd); return t ? [t] : []; }
    case "bird-calls": {
      const edge = tilesOf(w, (t) => !t.open && neighbours(t.id).some((n) => w.tiles[n]?.open));
      return shuffle(edge, rnd).slice(0, N.birdTiles);
    }
    case "clear-sky": {
      const gate = tilesOf(w, (t) => t.terrain === "gate");
      const who = active(w);
      const ruins = tilesOf(w, (t) => t.ruin !== null && !w.stones.includes(t.ruin));
      let best: TileId | null = null;
      let bestD = Infinity;
      for (const r of ruins) {
        const d = Math.min(...who.map((e) => distance(e.tile, r)), Infinity);
        if (d < bestD) { best = r; bestD = d; } // order is fixed, so ties go to the lower index
      }
      return best ? [...gate, best] : gate;
    }
    case "falling-rocks": {
      const who = active(w);
      if (who.length === 0) return [];
      const start = rnd(who.length);
      for (let k = 0; k < who.length; k++) {
        const e = who[(start + k) % who.length]!;
        const opts = neighbours(e.tile).filter((n) => w.tiles[n] && passable(w.tiles[n]!.terrain));
        const t = pickOne(opts, rnd);
        if (t) return [t];
      }
      return [];
    }
    case "rotten-bridge": { const t = pickOne(bridges(w, "bridge"), rnd); return t ? [t] : []; }
    case "echo-reeds": {
      const t = pickOne(tilesOf(w, (x) => x.terrain === "reeds"), rnd);
      return t ? [t] : [];
    }
    case "stone-hand": { const t = pickOne(bridges(w, "broken"), rnd); return t ? [t] : []; }
    default: return [];
  }
}

/**
 * Island-turn step 1. Returns a NEW pending bargain (stone hand accepted), else null.
 * The caller keeps any older pending bargain, and lands its noise before this call.
 * "This round" effects: Quiet morning sets spider.still, Hungry spider sets speedBonus.
 * Dry wind does nothing here: the island turn checks `ev.id === "dry-wind"` and spreads fire twice.
 */
export function applyEvent(
  w: World, ev: LiveEvent, option: number | null, _pending: PendingBargain | null, rnd: Rnd, steps: Step[],
): PendingBargain | null {
  void rnd;
  const card = EVENTS[ev.id];
  const nothing = !canApply(w, ev.id, null);
  steps.push({ t: "event", id: ev.id, option: card.options ? option : null, nothing });
  if (nothing) return null;
  const tile = ev.tiles[0];
  const choice = option ?? (card.kind === "bargain" ? 1 : 0); // no vote on a bargain means Refuse
  switch (ev.id) {
    case "quiet-morning": w.spider.still = true; break;
    case "hungry-spider": w.speedBonus = 1; break;
    case "dry-wind": break;
    case "rain": rainOut(w, steps); break;
    case "old-camp": if (tile) openAround(w, tile, N.campOpen, steps); break;
    case "bird-calls": {
      const shut = ev.tiles.filter((t) => w.tiles[t] && !w.tiles[t]!.open);
      for (const t of shut) w.tiles[t]!.open = true;
      if (shut.length > 0) steps.push({ t: "open", tiles: shut });
      break;
    }
    case "clear-sky": {
      const at = ev.tiles[choice];
      if (at) openAround(w, at, choice === 0 ? N.eventOpenGate : N.eventOpenRuin, steps);
      break;
    }
    case "falling-rocks":
      if (tile) for (const e of w.explorers) if (!e.left && !e.down && e.tile === tile) hurt(w, e.id, "rocks", steps);
      break;
    case "rotten-bridge":
      if (tile && w.tiles[tile]!.terrain === "bridge" && !w.explorers.some((e) => !e.left && e.tile === tile)) {
        const t = w.tiles[tile]!;
        t.terrain = "broken";
        t.fire = 0;
        steps.push({ t: "bridge", tile, fixed: false, by: null });
      }
      break;
    case "echo-reeds": if (tile) addNoise(w, tile, N.echoNoise, steps); break;
    case "stone-hand": {
      if (choice !== 0 || !tile) break;
      for (const id of bridges(w, "broken")) {
        w.tiles[id]!.terrain = "bridge";
        steps.push({ t: "bridge", tile: id, fixed: true, by: null });
      }
      return { tile, due: w.round + N.stoneDelay };
    }
    case "warm-spring": {
      if (choice !== 0) break;
      w.sun += 1;
      for (const e of w.explorers) {
        if (e.left) continue;
        if (e.down) {
          e.down = false;
          e.hearts = 1;
          steps.push({ t: "up", who: e.id, by: null });
        } else if (e.hearts < N.hearts) {
          e.hearts += 1;
          steps.push({ t: "heal", who: e.id, by: "event", hearts: 1 });
        }
      }
      break;
    }
  }
  return null;
}
