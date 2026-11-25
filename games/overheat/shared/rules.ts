import {
  COLOURS,
  CLASSIC_POWERS,
  CUTTHROAT_COPIES,
  COLOUR_BONUS,
  POWERS,
  POWER_COPIES,
  RAINBOW_BONUS,
  REDLINE_BONUS,
  type Card,
  type Colour,
  type EngineCard,
  type PowerKind,
  type PowerSetting,
} from "./types.ts";

/** 72 number cards (4 colours × 1–9 × 2), then the power cards. Not shuffled. */
export function buildDeck(powers: PowerSetting): Card[] {
  const deck: Card[] = [];
  let id = 0;
  for (const colour of COLOURS) {
    for (let value = 1; value <= 9; value++) {
      for (let copy = 0; copy < 2; copy++) deck.push({ kind: "number", id: id++, colour, value });
    }
  }
  if (powers === "classic") {
    for (const power of CLASSIC_POWERS) {
      for (let copy = 0; copy < POWER_COPIES[power]; copy++) deck.push({ kind: "power", id: id++, power });
    }
  } else if (powers === "cutthroat") {
    for (const power of POWERS) {
      for (let copy = 0; copy < CUTTHROAT_COPIES[power]; copy++) deck.push({ kind: "power", id: id++, power });
    }
  }
  return deck;
}

const CODE_COLOURS: Record<string, Colour> = { R: "red", A: "amber", B: "blue", G: "green" };

/** "R7" / "A1" / "B9" / "G3", or a power name. Anything else is null. */
export function cardFromCode(code: string, id: number): Card | null {
  if ((POWERS as readonly string[]).includes(code)) return { kind: "power", id, power: code as PowerKind };
  const m = /^([RABG])([1-9])$/.exec(code);
  if (!m) return null;
  return { kind: "number", id, colour: CODE_COLOURS[m[1]!]!, value: Number(m[2]) };
}

export function isAimed(power: PowerKind): boolean {
  return power === "shove" || power === "wrench" || power === "fuse";
}

export function enginePoints(engine: EngineCard[]): number {
  return engine.reduce((sum, e) => sum + e.card.value * e.mult, 0);
}

/** 5 per colour with 3+ cards, +5 if all 4 colours show. Counts cards, not mult. */
export function colourBonus(engine: EngineCard[]): number {
  const counts = new Map<Colour, number>();
  for (const e of engine) counts.set(e.card.colour, (counts.get(e.card.colour) ?? 0) + 1);
  let bonus = 0;
  for (const n of counts.values()) if (n >= 3) bonus += COLOUR_BONUS;
  if (counts.size === COLOURS.length) bonus += RAINBOW_BONUS;
  return bonus;
}

export function bankScore(engine: EngineCard[], redline: boolean): number {
  return enginePoints(engine) + colourBonus(engine) + (redline ? REDLINE_BONUS : 0);
}

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What players see for each power card. Plain words; the wire values stay as they are. */
export const POWER_NAMES: Record<PowerKind, string> = {
  vent: "Cool",
  turbo: "Double",
  shove: "Push",
  wrench: "Swap",
  fuse: "Burn",
  heatwave: "Limit down",
  steal: "Steal",
  dump: "Dump",
  audit: "Audit",
  block: "Block",
};

/** One plain line per card, for the rules and the card help. */
export const POWER_LINES: Record<PowerKind, string> = {
  vent: "Cool: your heat goes down by 5.",
  turbo: "Double: your next number card counts double.",
  shove: "Push: a player you pick must flip the next card.",
  wrench: "Swap: swap one of your cards with one of a player's cards.",
  fuse: "Burn: a player you pick gets +1 heat at the start of each of their turns.",
  heatwave: "Limit down: the limit goes down by 3 for everyone still flipping.",
  steal: "Steal: take a number card from a player.",
  dump: "Dump: give your last card to a player.",
  audit: "Audit: a player loses their best card.",
  block: "Block: keep it in your hand. Cancel a card played on you.",
};

export function cardLabel(card: Card): string {
  return card.kind === "number" ? `${title(card.colour)} ${card.value}` : POWER_NAMES[card.power];
}
