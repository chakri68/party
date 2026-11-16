import type { Approach } from "./ruins.ts";
import type { Attr, Role, Way } from "./types.ts";

export const ROLE_ATTRS: Record<Role, Record<Attr, 0 | 1 | 2>> = {
  runner: { strength: 0, mind: 1, stealth: 2 },
  fixer: { strength: 1, mind: 2, stealth: 0 },
  protector: { strength: 2, mind: 0, stealth: 1 },
  guide: { strength: 0, mind: 2, stealth: 1 },
};

export const WAY_BONUS: Record<Way, -1 | 0 | 1> = { careful: -1, normal: 0, bold: 1 };

/** Exact chance as a fraction of 36: how many of the 36 dice pairs make 2d6 + bonus >= need. */
export function chance36(bonus: number, need: 7 | 9): number {
  let n = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a + b + bonus >= need) n++;
  return n;
}

export const percent = (bonus: number, need: 7 | 9): number => Math.round((chance36(bonus, need) / 36) * 100);

/** The cost of a failed roll, after Careful: 1 damage becomes 1 noise, 2-3 noise becomes 1 noise. */
export function failCost(a: Approach, way: Way): { damage: number; noise: number } {
  if (way !== "careful") return { ...a.fail };
  return { damage: 0, noise: 1 };
}

export function rollDice(rnd: (n: number) => number): [number, number] {
  const first = 1 + rnd(6);
  const second = 1 + rnd(6);
  return [first, second];
}
