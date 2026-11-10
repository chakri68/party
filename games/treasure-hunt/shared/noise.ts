// Integer-hashed value noise. Pure functions of (seed, x, z): no Math.random,
// no state, so the server and every test see the same world for a seed.

/** A 32-bit hash of three integers. */
export function hash3(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Value noise in [−1, 1], smooth (quintic fade) between integer lattice points. */
export function valueNoise2(seed: number, x: number, z: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = fade(x - x0);
  const fz = fade(z - z0);
  const v00 = hash3(seed, x0, z0) / 2147483647.5 - 1;
  const v10 = hash3(seed, x0 + 1, z0) / 2147483647.5 - 1;
  const v01 = hash3(seed, x0, z0 + 1) / 2147483647.5 - 1;
  const v11 = hash3(seed, x0 + 1, z0 + 1) / 2147483647.5 - 1;
  const a = v00 + (v10 - v00) * fx;
  const b = v01 + (v11 - v01) * fx;
  return a + (b - a) * fz;
}

/** Fractal sum of value noise, normalised back into [−1, 1]. */
export function fbm2(
  seed: number,
  x: number,
  z: number,
  octaves: number,
  lacunarity: number,
  gain: number,
): number {
  let sum = 0;
  let norm = 0;
  let amp = 1;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise2(seed + o * 1013, x * freq, z * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** A seeded stream of numbers in [0, 1). */
export type Rng = () => number;

/** A small seeded PRNG (mulberry32) for picking features. Returns [0, 1). */
export function rng(seed: number): Rng {
  let s = hash3(seed, 0x51ed, 0x7a3) | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
