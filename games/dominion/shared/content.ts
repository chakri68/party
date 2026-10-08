// Content tables (§6–8). Provisional numbers: they live here so balancing is a
// data change, never a code change. IDs are stable; display names aren't.

import type {
  DevelopKind,
  FactionKind,
  Improvement,
  MonumentId,
  Resource,
  RewardChoice,
  TechId,
  Terrain,
  UnitType,
} from "./types.ts";

export interface TerrainDef {
  name: string;
  land: boolean;
  /** Movement cost in half-points; null = impassable without a tech. */
  cost: number;
  /** Tech that makes it passable, if any. */
  needs?: TechId;
  /** Tech that grants the 1.25 defense bonus here. */
  defenseTech?: TechId;
}

export const TERRAIN: Record<Terrain, TerrainDef> = {
  plains: { name: "Plains", land: true, cost: 2 },
  forest: { name: "Forest", land: true, cost: 4, defenseTech: "archery" },
  mountain: { name: "Mountain", land: true, cost: 4, needs: "climbing", defenseTech: "meditation" },
  shallow: { name: "Shallow water", land: false, cost: 2 },
  ocean: { name: "Ocean", land: false, cost: 2 },
};

/** Road-to-road (or city) steps inside non-hostile territory. */
export const ROAD_COST = 1;

export interface UnitDef {
  name: string;
  cost: number;
  hp: number;
  attack: number;
  defense: number;
  /** Tiles. Stored internally as half-points. */
  move: number;
  range: number;
  needs?: TechId;
  /** Only from a city reward. */
  reward?: boolean;
  /** Can't move and attack in the same turn (siege). */
  staticAttack?: boolean;
  /** May attack again after a kill (knights). */
  chain?: boolean;
  /** Heals and converts instead of attacking (sages). */
  sage?: boolean;
  /** Can't be converted. */
  steadfast?: boolean;
}

export const UNITS: Record<UnitType, UnitDef> = {
  infantry: { name: "Infantry", cost: 2, hp: 10, attack: 2, defense: 2, move: 1, range: 1 },
  cavalry: { name: "Cavalry", cost: 3, hp: 10, attack: 2, defense: 1, move: 2, range: 1, needs: "riding" },
  archer: { name: "Archer", cost: 3, hp: 10, attack: 2, defense: 1, move: 1, range: 2, needs: "archery" },
  defender: { name: "Defender", cost: 3, hp: 15, attack: 1, defense: 3, move: 1, range: 1, needs: "strategy" },
  swordsman: { name: "Swordsman", cost: 5, hp: 15, attack: 3, defense: 3, move: 1, range: 1, needs: "metallurgy" },
  champion: { name: "Champion", cost: 0, hp: 35, attack: 4, defense: 4, move: 1, range: 1, reward: true, steadfast: true },
  siege: { name: "Siege engine", cost: 8, hp: 10, attack: 4, defense: 0, move: 1, range: 3, needs: "mathematics", staticAttack: true },
  knight: { name: "Knight", cost: 8, hp: 10, attack: 3, defense: 1, move: 3, range: 1, needs: "chivalry", chain: true },
  sage: { name: "Sage", cost: 5, hp: 10, attack: 0, defense: 1, move: 1, range: 1, needs: "philosophy", sage: true },
};

export const TRAINABLE: UnitType[] = ["infantry", "cavalry", "archer", "defender", "swordsman", "siege", "knight", "sage"];

/** Knights stop chaining after this many extra attacks, whatever's left to hit (§17). */
export const MAX_CHAIN = 4;
export const MEND_HP = 4;

export const VETERAN_KILLS = 3;
export const VETERAN_HP = 5;

export interface TechDef {
  name: string;
  tier: 1 | 2 | 3;
  parent?: TechId;
  /** Plain-language unlocks, for the tech tree. */
  unlocks: string;
}

export const TECHS: Record<TechId, TechDef> = {
  gathering: { name: "Gathering", tier: 1, unlocks: "Harvest fruit" },
  farming: { name: "Farming", tier: 2, parent: "gathering", unlocks: "Farms on crops" },
  construction: { name: "Construction", tier: 3, parent: "farming", unlocks: "Mills; demolish improvements" },
  strategy: { name: "Strategy", tier: 2, parent: "gathering", unlocks: "Defenders" },
  hunting: { name: "Hunting", tier: 1, unlocks: "Harvest animals" },
  forestry: { name: "Forestry", tier: 2, parent: "hunting", unlocks: "Lumber camps in forests" },
  mathematics: { name: "Mathematics", tier: 3, parent: "forestry", unlocks: "Siege engines" },
  archery: { name: "Archery", tier: 2, parent: "hunting", unlocks: "Archers, forest defense" },
  spirituality: { name: "Spirituality", tier: 3, parent: "archery", unlocks: "Temples" },
  riding: { name: "Riding", tier: 1, unlocks: "Cavalry" },
  roads: { name: "Roads", tier: 2, parent: "riding", unlocks: "Roads and city connections" },
  commerce: { name: "Commerce", tier: 3, parent: "roads", unlocks: "Markets" },
  free_spirit: { name: "Free Spirit", tier: 2, parent: "riding", unlocks: "Disband for a refund; cavalry fall back after attacking" },
  chivalry: { name: "Chivalry", tier: 3, parent: "free_spirit", unlocks: "Knights" },
  climbing: { name: "Climbing", tier: 1, unlocks: "Move onto mountains" },
  mining: { name: "Mining", tier: 2, parent: "climbing", unlocks: "Mines on ore" },
  metallurgy: { name: "Metallurgy", tier: 3, parent: "mining", unlocks: "Swordsmen and forges" },
  meditation: { name: "Meditation", tier: 2, parent: "climbing", unlocks: "Mountain defense" },
  philosophy: { name: "Philosophy", tier: 3, parent: "meditation", unlocks: "Sages; research costs a fifth less" },
  fishing: { name: "Fishing", tier: 1, unlocks: "Harvest fish" },
};

export const TECH_ORDER = Object.keys(TECHS) as TechId[];
export const ROOT_TECHS = TECH_ORDER.filter((t) => !TECHS[t].parent);

/** With Philosophy the price drops by a fifth, the discount rounded up (§7). */
export function techCost(tech: TechId, ownedCities: number, known: readonly TechId[] = []): number {
  const base = 3 + 3 * TECHS[tech].tier + 2 * Math.max(0, ownedCities - 1);
  return known.includes("philosophy") ? base - Math.ceil(base * 0.2) : base;
}

export interface FactionDef {
  name: string;
  blurb: string;
  startTech: TechId;
  /** Resource the start region leans toward. */
  homeResource: Resource;
  /** Overrides the usual opening treasury (a tier-2 start pays for itself). */
  openingCredits?: number;
}

export const FACTIONS: Record<FactionKind, FactionDef> = {
  orchard: {
    name: "Orchard settlers",
    blurb: "Farmers in timber cottages. Start with Gathering, near fruit.",
    startTech: "gathering",
    homeResource: "fruit",
  },
  forest: {
    name: "Forest clans",
    blurb: "Hunters in log longhouses. Start with Hunting, near game.",
    startTech: "hunting",
    homeResource: "animals",
  },
  steppe: {
    name: "Steppe riders",
    blurb: "Horse herders of the open plains. Start with Riding.",
    startTech: "riding",
    homeResource: "fruit",
  },
  highland: {
    name: "Highland smiths",
    blurb: "Miners and metalworkers. Start with Climbing, near the peaks.",
    startTech: "climbing",
    homeResource: "fruit",
  },
  coastal: {
    name: "Coastal navigators",
    blurb: "Fisherfolk of the shore. Start with Fishing, on the coast.",
    startTech: "fishing",
    homeResource: "fish",
  },
  citadel: {
    name: "Citadel keepers",
    blurb: "Builders of walls. Start with Strategy and a leaner purse.",
    startTech: "strategy",
    homeResource: "fruit",
    openingCredits: 3,
  },
};

export const FACTION_KINDS = Object.keys(FACTIONS) as FactionKind[];

/** Player identity colors. Ownership is drawn in these, never in faction palette. */
export const PLAYER_COLORS = [
  { name: "Red", hex: "#E53935" },
  { name: "Blue", hex: "#1E88E5" },
  { name: "Gold", hex: "#FDD835" },
  { name: "Purple", hex: "#8E24AA" },
  { name: "Teal", hex: "#00ACC1" },
  { name: "Orange", hex: "#FB8C00" },
  { name: "Pink", hex: "#EC407A" },
  { name: "White", hex: "#ECEFF1" },
];

export interface DevelopDef {
  name: string;
  cost: number;
  /** Population paid once, on building. */
  pop: number;
  needs: TechId;
  /** Which tiles qualify. */
  terrain: Terrain[];
  resource?: Resource[];
  /** Built improvement, if any. Harvests leave nothing behind. */
  builds?: Improvement;
  /** One per city. */
  unique?: boolean;
  /** +1 population per adjacent improvement of this kind in the same city, on building. */
  adjacentPop?: Improvement;
}

export type BuildKind = Exclude<DevelopKind, "harvest" | "demolish">;

export const DEVELOP: Record<BuildKind, DevelopDef> = {
  farm: { name: "Farm", cost: 5, pop: 2, needs: "farming", terrain: ["plains"], resource: ["crops"], builds: "farm" },
  lumber_camp: { name: "Lumber camp", cost: 3, pop: 1, needs: "forestry", terrain: ["forest"], builds: "lumber_camp" },
  mine: { name: "Mine", cost: 5, pop: 2, needs: "mining", terrain: ["mountain"], resource: ["ore"], builds: "mine" },
  road: { name: "Road", cost: 2, pop: 0, needs: "roads", terrain: ["plains", "forest"] },
  mill: { name: "Mill", cost: 5, pop: 0, needs: "construction", terrain: ["plains"], builds: "mill", unique: true, adjacentPop: "farm" },
  forge: { name: "Forge", cost: 5, pop: 0, needs: "metallurgy", terrain: ["plains"], builds: "forge", unique: true, adjacentPop: "mine" },
  market: { name: "Market", cost: 6, pop: 0, needs: "commerce", terrain: ["plains"], builds: "market", unique: true },
  temple: { name: "Temple", cost: 8, pop: 1, needs: "spirituality", terrain: ["plains", "forest"], builds: "temple" },
};

/** What a market counts next to it: things that make things. */
export const PRODUCTION: Improvement[] = ["farm", "lumber_camp", "mine", "mill", "forge"];
export const MARKET_CAP = 4;
export const DEMOLISH_COST = 1;

/** Temple score per owner-turn, and the most one temple can gather. */
export const TEMPLE_CULTURE = 10;
export const TEMPLE_CULTURE_CAP = 100;

export interface MonumentDef {
  name: string;
  goal: string;
}

/** Peace waits for diplomacy; the rest are live. */
export const MONUMENTS: Record<Exclude<MonumentId, "peace">, MonumentDef> = {
  research: { name: "Grand library", goal: "Research 10 technologies" },
  trade: { name: "Merchant arch", goal: "Connect 5 cities to your capital" },
  exploration: { name: "Compass tower", goal: "Explore 80% of the map" },
  battle: { name: "Victory column", goal: "Win 10 battles" },
};
export const MONUMENT_POP = 3;

export const HARVEST: Partial<Record<Resource, { cost: number; pop: number; needs: TechId }>> = {
  fruit: { cost: 2, pop: 1, needs: "gathering" },
  animals: { cost: 2, pop: 1, needs: "hunting" },
  fish: { cost: 2, pop: 1, needs: "fishing" },
};

export const RESOURCE_NAMES: Record<Resource, string> = {
  fruit: "Fruit",
  animals: "Wild game",
  fish: "Fish",
  crops: "Crops",
  ore: "Ore",
};

export const IMPROVEMENT_NAMES: Record<Improvement, string> = {
  farm: "Farm",
  lumber_camp: "Lumber camp",
  mine: "Mine",
  mill: "Mill",
  forge: "Forge",
  market: "Market",
  temple: "Temple",
  monument: "Monument",
};

/** Two choices per level band; the first is the default when time runs out. */
export function rewardChoices(level: number): [RewardChoice, RewardChoice] {
  if (level <= 2) return ["workshop", "scout"];
  if (level === 3) return ["treasury", "walls"];
  if (level === 4) return ["population", "borders"];
  return ["park", "champion"];
}

export const REWARDS: Record<RewardChoice, { name: string; blurb: string }> = {
  workshop: { name: "Workshop", blurb: "+1 income" },
  scout: { name: "Scouts", blurb: "Reveal the land around the city" },
  treasury: { name: "Treasury", blurb: "+5 credits now" },
  walls: { name: "Walls", blurb: "Units in the city defend at ×2" },
  population: { name: "Growth", blurb: "+3 population" },
  borders: { name: "Borders", blurb: "Territory grows to radius 2" },
  park: { name: "Park", blurb: "+50 score" },
  champion: { name: "Champion", blurb: "A 35 HP unit joins the city" },
};

export const OPENING_CREDITS = 5;
export const SCOUT_RADIUS = 4;
export const TREASURY_CREDITS = 5;
export const POPULATION_REWARD = 3;

export const CITY_DEFENSE = 1.5;
export const WALLS_DEFENSE = 2;
export const TERRAIN_DEFENSE = 1.25;

export const HEAL = 2;
export const HEAL_HOME = 4;

export const SCORE = {
  cityLevel: 100,
  tech: 25,
  explored: 5,
  park: 50,
  kill: 10,
  monument: 100,
};

/** Tiles each participant needs (§3). */
export const TILES_PER_PLAYER = 48;
