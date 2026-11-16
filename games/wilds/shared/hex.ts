import type { TileId } from "./types.ts";

export const RADIUS = 3;

export const id = (q: number, r: number): TileId => `${q},${r}`;
export const coords = (t: TileId): { q: number; r: number } => {
  const [q, r] = t.split(",").map(Number);
  return { q: q!, r: r! };
};

export const TILE_ORDER: TileId[] = (() => {
  const out: TileId[] = [];
  for (let r = -RADIUS; r <= RADIUS; r++) {
    for (let q = -RADIUS; q <= RADIUS; q++) {
      if (Math.abs(q + r) <= RADIUS) out.push(id(q, r));
    }
  }
  return out;
})();

const ORDER_INDEX = new Map<TileId, number>(TILE_ORDER.map((t, i) => [t, i]));
const ON_BOARD = (t: TileId): boolean => ORDER_INDEX.has(t);

const DIRECTIONS: [number, number][] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

const NEIGHBOURS = new Map<TileId, TileId[]>(
  TILE_ORDER.map((t) => {
    const { q, r } = coords(t);
    const list = DIRECTIONS.map(([dq, dr]) => id(q + dq, r + dr)).filter(ON_BOARD);
    return [t, list];
  }),
);

export function neighbours(t: TileId): TileId[] {
  return [...(NEIGHBOURS.get(t) ?? [])];
}

export function distance(a: TileId, b: TileId): number {
  const A = coords(a);
  const B = coords(b);
  const dq = A.q - B.q;
  const dr = A.r - B.r;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

/** 60 degree turn: (q, r) -> (-r, q + r). */
export function rotate(t: TileId, turns: number): TileId {
  let { q, r } = coords(t);
  const n = ((turns % 6) + 6) % 6;
  for (let i = 0; i < n; i++) [q, r] = [-r, q + r];
  return id(q, r);
}

export function within(t: TileId, range: number): TileId[] {
  return TILE_ORDER.filter((o) => distance(t, o) <= range);
}

/** Breadth-first search. Parents are set by the first visit, with neighbours tried in TILE_ORDER order. */
function search(
  from: TileId,
  maxSteps: number,
  canEnter: (t: TileId) => boolean,
  stopsAt?: (t: TileId) => boolean,
): Map<TileId, TileId | null> {
  const parent = new Map<TileId, TileId | null>([[from, null]]);
  let frontier = [from];
  for (let step = 0; step < maxSteps && frontier.length > 0; step++) {
    const next: TileId[] = [];
    // Expand in TILE_ORDER so ties go to the lower index.
    frontier.sort((a, b) => ORDER_INDEX.get(a)! - ORDER_INDEX.get(b)!);
    for (const cur of frontier) {
      if (cur !== from && stopsAt?.(cur)) continue;
      const nbs = neighbours(cur).sort((a, b) => ORDER_INDEX.get(a)! - ORDER_INDEX.get(b)!);
      for (const n of nbs) {
        if (parent.has(n) || !canEnter(n)) continue;
        parent.set(n, cur);
        next.push(n);
      }
    }
    frontier = next;
  }
  return parent;
}

function trace(parent: Map<TileId, TileId | null>, to: TileId): TileId[] {
  const out: TileId[] = [];
  for (let c: TileId | null | undefined = to; c != null; c = parent.get(c)) out.push(c);
  return out.reverse();
}

export function path(
  from: TileId,
  to: TileId,
  canEnter: (t: TileId) => boolean,
  stopsAt?: (t: TileId) => boolean,
): TileId[] | null {
  if (from === to) return [from];
  const parent = search(from, Infinity, canEnter, stopsAt);
  return parent.has(to) ? trace(parent, to) : null;
}

export function reachable(
  from: TileId,
  steps: number,
  canEnter: (t: TileId) => boolean,
  stopsAt?: (t: TileId) => boolean,
): Map<TileId, TileId[]> {
  const parent = search(from, steps, canEnter, stopsAt);
  const out = new Map<TileId, TileId[]>();
  for (const t of TILE_ORDER) if (parent.has(t)) out.set(t, trace(parent, t));
  return out;
}

/** Pointy-top layout. */
export function toPixel(t: TileId, size: number): { x: number; y: number } {
  const { q, r } = coords(t);
  return { x: size * Math.sqrt(3) * (q + r / 2), y: size * 1.5 * r };
}
