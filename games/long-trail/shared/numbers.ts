/** Game numbers. Starting values, tuned in Task 7. */
export const N = {
  kmPerDay: { slow: 20, steady: 30, hard: 40 },
  foodPerTraveller: { full: 2, half: 1, none: 0 },
  waterPerTraveller: { desert: 2, other: 1 },
  /** risk points per traveller per day */
  risk: { hard: 1, half: 1, none: 2, thirst: 3, hungry: 2, sick: 1 },
  /** chance of losing a health step, per risk point */
  riskStepChance: 0.12,
  /** per traveller below Well, on a rest day with full rations */
  restHealChance: 0.6,
  /** at max, the next hard day kills one animal and resets to 0 */
  animalFatigue: { hard: 1, rest: -2, max: 3 },
  /** the Trader leading: buy this much cheaper, sell this much dearer */
  traderEdge: 0.1,
} as const;
