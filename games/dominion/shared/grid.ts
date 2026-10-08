// Square grid geometry and the versioned PRNG. Rendering is isometric, rules
// aren't: everything here works in (row, col) and row-major tile indexes.

export const NEIGHBORS: readonly (readonly [number, number])[] = [
  [-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1],
];

export const rowOf = (i: number, size: number) => Math.floor(i / size);
export const colOf = (i: number, size: number) => i % size;
export const indexOf = (r: number, c: number, size: number) => r * size + c;
export const inBounds = (r: number, c: number, size: number) => r >= 0 && c >= 0 && r < size && c < size;

export function chebyshev(a: number, b: number, size: number): number {
  return Math.max(Math.abs(rowOf(a, size) - rowOf(b, size)), Math.abs(colOf(a, size) - colOf(b, size)));
}

/** The 8 neighbours of a tile that are on the board. */
export function neighbors(i: number, size: number): number[] {
  const r = rowOf(i, size);
  const c = colOf(i, size);
  const out: number[] = [];
  for (const [dr, dc] of NEIGHBORS) if (inBounds(r + dr, c + dc, size)) out.push(indexOf(r + dr, c + dc, size));
  return out;
}

/** Every tile within Chebyshev `radius`, the centre included. */
export function area(i: number, radius: number, size: number): number[] {
  const r0 = rowOf(i, size);
  const c0 = colOf(i, size);
  const out: number[] = [];
  for (let r = r0 - radius; r <= r0 + radius; r++) {
    for (let c = c0 - radius; c <= c0 + radius; c++) if (inBounds(r, c, size)) out.push(indexOf(r, c, size));
  }
  return out;
}

// ---------------------------------------------------------------------------
// PRNG (version 1: mulberry32). The state is one uint32, so it persists as a
// plain number and a stream can be resumed exactly where it stopped.
// ---------------------------------------------------------------------------

export class Rng {
  state: number;

  constructor(state: number) {
    this.state = state >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]!;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [items[i], items[j]] = [items[j]!, items[i]!];
    }
    return items;
  }
}

/** Derives an independent stream seed, so streams don't share a sequence. */
export function streamSeed(seed: number, stream: number): number {
  let h = (seed ^ Math.imul(stream + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
