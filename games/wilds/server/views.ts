import { neighbours } from "../shared/hex.ts";
import { EVENTS } from "../shared/events.ts";
import type {
  PublicTile, RoundLog, SpiderMove, Step, WildsPrivateState, WildsPublicState, WildsServerState, World,
} from "../shared/types.ts";
import { turnOrder } from "./beats.ts";

type State = WildsServerState;

const isOpen = (w: World, t: string): boolean => !!w.tiles[t]?.open;

/**
 * A step as the team may see it: nothing that names a tile in the fog.
 * The spider's path keeps only its open tiles. Null drops the step.
 */
export function shownStep(w: World, s: Step): Step | null {
  switch (s.t) {
    case "spider": {
      const path = s.path.filter((t) => isOpen(w, t));
      return path.length ? { ...s, path } : null;
    }
    case "out": {
      const tiles = s.tiles.filter((t) => isOpen(w, t));
      return tiles.length ? { ...s, tiles } : null;
    }
    case "noise": case "lit": case "burnt": case "bridge":
      return isOpen(w, s.tile) ? s : null;
    default:
      return s;
  }
}

export const shownSteps = (w: World, steps: Step[]): Step[] =>
  steps.flatMap((s) => {
    const x = shownStep(w, s);
    return x ? [x] : [];
  });

/** The arrow up to where it goes into the fog. */
function shownArrow(w: World, a: SpiderMove | null): SpiderMove | null {
  if (!a) return null;
  const path: string[] = [];
  for (const t of a.path) {
    if (!isOpen(w, t)) break;
    path.push(t);
  }
  return path.length ? { ...a, path } : null;
}

function tiles(state: State): PublicTile[] {
  const w = state.world;
  const markers = new Map<string, "gate" | keyof State["board"]["ruins"]>([[state.board.gate, "gate"]]);
  for (const [ruin, at] of Object.entries(state.board.ruins)) markers.set(at, ruin as keyof State["board"]["ruins"]);
  return w.order.map((id): PublicTile => {
    const t = w.tiles[id]!;
    if (t.open) {
      return {
        id, open: true, q: t.q, r: t.r, terrain: t.terrain, fire: t.fire, noise: t.noise,
        cache: t.cache, nest: t.nest, ruin: t.ruin,
      };
    }
    const out: PublicTile = { id, open: false };
    if (t.fire > 0 || neighbours(id).some((n) => (w.tiles[n]?.fire ?? 0) > 0)) out.smoke = true;
    const marker = markers.get(id);
    if (marker) out.marker = marker;
    return out;
  });
}

function shownRound(w: World, r: RoundLog | null): RoundLog | null {
  return r ? { ...r, steps: shownSteps(w, r.steps) } : null;
}

export function publicState(state: State): WildsPublicState {
  const w = state.world;
  const spiderSeen = isOpen(w, w.spider.tile);
  const ev = state.event && state.phase !== "roles" ? state.event : null;
  return {
    phase: state.phase,
    deadline: state.deadline,
    round: w.round,
    sun: Math.min(w.sun, w.sunLimit), // Force or Warm spring on the last round can push the count past it
    sunLimit: w.sunLimit,
    planSeconds: state.settings.planSeconds,
    stones: [...w.stones],
    half: [...w.half],
    gateOpen: w.gateOpen,
    order: turnOrder(w),
    tiles: tiles(state),
    explorers: w.explorers.map((e) => ({
      id: e.id, role: e.role, tile: e.tile, hearts: e.hearts, items: [...e.items],
      down: e.down, left: e.left, ready: state.ready.includes(e.id),
    })),
    spider: spiderSeen ? { tile: w.spider.tile, arrow: state.phase === "plan" ? shownArrow(w, state.arrow) : null } : null,
    event: ev ? { id: ev.id, tiles: [...ev.tiles], options: EVENTS[ev.id].options } : null,
    pending: state.pending,
    voted: state.ballot ? state.ballot.eligible.filter((id) => id in state.ballot!.votes) : null,
    lastRound: shownRound(w, state.lastRound),
    end: state.phase === "over" ? state.end : null,
  };
}

export function privateState(state: State, playerId: string): WildsPrivateState {
  const me = state.world.explorers.find((e) => e.id === playerId);
  const vote = state.ballot?.votes[playerId];
  const out: WildsPrivateState = {
    plan: state.plans[playerId] ?? null,
    ready: state.ready.includes(playerId),
    vote: vote === undefined ? null : Number(vote),
  };
  if (me?.role === "guide") out.next = state.next;
  return out;
}
