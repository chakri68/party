// Dominion's data model. Everything is a JSON-friendly plain object: the room
// persists it as-is, and spatial indexes are rebuilt rather than stored (§16).

export const SCHEMA_VERSION = 1;
/** Bump when a rule change would reinterpret a running match. */
export const RULES_VERSION = 1;
export const CONTENT_VERSION = 1;
export const GENERATOR_VERSION = 1;

/** Ice is frozen water: land while it lasts, and it remembers what it was. */
export type Terrain = "plains" | "forest" | "mountain" | "shallow" | "ocean" | "ice";
export type Resource = "fruit" | "animals" | "fish" | "crops" | "ore";
export type Improvement = "farm" | "lumber_camp" | "mine" | "mill" | "forge" | "market" | "temple" | "monument" | "port" | "grove" | "reef_nest";
export type Feature = "village" | "ruins" | "beacon";
/** What a unit at sea is riding in. The unit's own type rides along as cargo. */
export type VesselType = "transport" | "scout" | "rammer" | "bomber";
export type ClassicFaction = "orchard" | "forest" | "steppe" | "highland" | "coastal" | "citadel";
/** Special factions each bend one core rule; picked by name only, never dealt in Mixed. */
export type SpecialFaction = "wildwood" | "tidefolk" | "rimeborn" | "bloom";
export type FactionKind = ClassicFaction | SpecialFaction;
export type UnitType =
  | "infantry" | "cavalry" | "archer" | "defender" | "swordsman" | "champion"
  | "siege" | "knight" | "sage"
  | "infiltrator" | "raider"
  | "bramble" | "dryad" | "owl_egg" | "great_owl"
  | "shell_guard" | "reef_runner" | "leviathan"
  | "sledge" | "ice_archer" | "glacier_warden"
  | "larva" | "drone" | "stinger" | "brood_mother";
export type TechId =
  | "gathering" | "farming" | "construction" | "strategy" | "diplomacy"
  | "hunting" | "forestry" | "mathematics" | "archery" | "spirituality"
  | "riding" | "roads" | "commerce" | "free_spirit" | "chivalry"
  | "climbing" | "mining" | "metallurgy" | "meditation" | "philosophy"
  | "fishing" | "sailing" | "navigation"
  | "tending" | "grovecraft" | "skyroost"
  | "tidecraft" | "currents" | "deep_calling"
  | "frostcraft" | "ice_roads" | "deep_freeze"
  | "spreading" | "venom" | "broodcraft";

/** Achievements that earn a placeable monument (§13). */
export type MonumentId = "research" | "trade" | "exploration" | "battle" | "peace";

/** What a player can do to a tile. Harvests consume the resource; the rest build. */
export type DevelopKind =
  | "harvest" | "farm" | "lumber_camp" | "mine" | "road"
  | "mill" | "forge" | "market" | "temple" | "port" | "demolish"
  | "tend" | "grove" | "reef_nest"
  | "spread" | "absorb";

export type RewardChoice =
  | "workshop" | "scout"
  | "treasury" | "walls"
  | "population" | "borders"
  | "champion" | "park";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type MapSizeSetting = "auto" | 16 | 24 | 32;
export type MapType = "continents" | "landmass" | "lakes" | "archipelago";
export type FogSetting = "on" | "terrain" | "off";
export type ResourceSetting = "sparse" | "standard" | "abundant";
export type FactionSetting = "mixed" | FactionKind;
export type VictorySetting = "conquest" | "score" | "capitals";
export type BotLevel = "easy" | "normal" | "hard";

export interface DominionSettings {
  victory: VictorySetting;
  mapSize: MapSizeSetting;
  mapType: MapType;
  /** Seconds; 0 = no clock. */
  turnClock: 0 | 60 | 120 | 180 | 300;
  /** Rounds; 0 = unlimited (conquest only). */
  roundLimit: 0 | 30 | 60 | 90;
  fog: FogSetting;
  resources: ResourceSetting;
  factions: FactionSetting;
  /** Computer players added on top of the people in the room. */
  bots: number;
  /** 0 = everyone for themselves; otherwise seats are dealt into this many teams. */
  teams: 0 | 2 | 3 | 4;
  /** Allies see what each other sees. Only meaningful with teams. */
  sharedVision: boolean;
  botLevel: BotLevel;
}

export const DEFAULT_SETTINGS: DominionSettings = {
  victory: "conquest",
  mapSize: "auto",
  mapType: "continents",
  turnClock: 180,
  roundLimit: 60,
  fog: "on",
  resources: "standard",
  factions: "mixed",
  bots: 0,
  botLevel: "normal",
  teams: 0,
  sharedVision: true,
};

// ---------------------------------------------------------------------------
// Server state
// ---------------------------------------------------------------------------

export interface Tile {
  t: Terrain;
  res: Resource | null;
  imp: Improvement | null;
  road: boolean;
  feat: Feature | null;
  /** The city standing on this tile. */
  city: string | null;
  /** The city whose territory this tile is. Ownership follows that city's owner. */
  claim: string | null;
  /**
   * Improvements this tile already paid population for. Demolishing doesn't
   * take it back, and rebuilding the same thing doesn't pay twice (§6).
   */
  credited?: Improvement[];
  /** Score a temple here has gathered (§13). */
  culture?: number;
  /** Tended by Wildwood: paid its population once, resource left standing. */
  tended?: boolean;
  /** Frozen water: what it thaws back into, who froze it, and the round it's due to thaw. */
  ice?: { from: "shallow" | "ocean"; owner: string; until: number };
  /** Mycelium the Bloom spread here, and whose. (Their territory is mycelium anyway.) */
  myc?: string;
}

export interface Unit {
  id: string;
  type: UnitType;
  owner: string;
  /** City whose capacity this unit uses; null while homeless. */
  home: string | null;
  at: number;
  hp: number;
  maxHp: number;
  kills: number;
  veteran: boolean;
  /** Remaining movement this turn, in half-points. */
  mp: number;
  moved: boolean;
  attacked: boolean;
  /** Nothing more this turn: attacked, healed, captured or freshly trained. */
  done: boolean;
  /** Has stood on this tile since its owner's turn began. Capturing needs it. */
  settled: boolean;
  /** Extra attacks a knight has chained this turn. */
  chained?: number;
  /** Changed sides; never refunds on disband (§8). */
  converted?: boolean;
  /** At sea: the vessel carrying it. Health is one pool, the cargo's (§9). */
  vessel?: VesselType | null;
  /** Owner-turns lived, for types that mature into another. */
  age?: number;
  /** Hit by frost: can't move on its owner's next turn. */
  chilled?: boolean;
  /** Poisoned: loses 1 HP at each of its owner's next `turns` turn starts, and can't heal. */
  poison?: { turns: number; by: string };
}

export interface City {
  id: string;
  name: string;
  at: number;
  /** null: a city whose empire surrendered. Capturable like a village. */
  owner: string | null;
  level: number;
  /** Development credit towards the next level. */
  pop: number;
  /** The founder's capital. Only the founder gets the capital bonus. */
  capitalOf: string | null;
  workshop: boolean;
  walls: boolean;
  parks: number;
  /** Levels whose reward hasn't been picked yet, oldest first. */
  pendingRewards: number[];
  /** A champion that couldn't spawn yet for lack of room. */
  pendingChampion: boolean;
  /** Sabotaged: pays nothing at its owner's next turn (§11). */
  sabotaged?: boolean;
}

/** Peace between two empires; `brokenBy` is set once one side has broken it. */
export interface Treaty {
  a: string;
  b: string;
  /** Round peace began, for the peace monument. */
  since: number;
  /** Who broke it. Hostility waits until the breaker's next turn starts. */
  brokenBy?: string;
}

export interface PeaceOffer {
  from: string;
  to: string;
  /** Round it was made; it lapses two rounds later. */
  round: number;
}

export interface CityMemory {
  name: string;
  level: number;
  owner: string | null;
  capital: boolean;
}

/** What a faction remembers of the world: last-seen tile codes and when. */
export interface Memory {
  /** Packed tile (see `encodeTile`); -1 = never explored. */
  codes: number[];
  /** Round last seen; -1 = never. */
  seen: number[];
  /** Keyed by tile index. */
  cities: Record<string, CityMemory>;
}

export interface Faction {
  id: string;
  kind: FactionKind;
  /** Index into PLAYER_COLORS. Unique per match. */
  color: number;
  credits: number;
  techs: TechId[];
  eliminated: boolean;
  surrendered: boolean;
  kills: number;
  memory: Memory;
  /** Team number, or null without teams. Allies share victory, never treasury. */
  team?: number | null;
  /** Achievements earned, and how many of their monuments are still to place. */
  monuments?: { earned: MonumentId[]; unplaced: number };
  /** Held every original capital when its last turn ended (capital-control win). */
  holdingCapitals?: boolean;
  /** Empires this one has met; treaties need contact first (§11). */
  contacts?: string[];
  /** Empires it keeps an embassy with. */
  embassies?: string[];
  /** Beacons this empire has found, by tile; each pays once (§9). */
  beacons?: number[];
  /** Set for computer players; they have no room seat. */
  bot?: { level: BotLevel; name: string } | null;
}

export interface DominionState {
  schemaVersion: number;
  rulesVersion: number;
  contentVersion: number;
  generatorVersion: number;

  settings: DominionSettings;
  size: number;
  tiles: Tile[];
  cities: Record<string, City>;
  units: Record<string, Unit>;
  /** Turn order. */
  factions: Faction[];

  /** Hidden. Never leaves the server (§10). */
  seed: number;
  /** Separate streams so one consumer can't shift another's future (§4). */
  rng: { ruins: number; names: number; ai?: number };

  /** Bumped on every accepted change. */
  revision: number;
  phase: "playing" | "finished";
  round: number;
  /** Increments each turn; actions must name it, so a stale one can't land. */
  turn: number;
  current: number;
  /** Server time the current turn ends; null without a clock. */
  deadline: number | null;
  nextId: number;
  treaties?: Treaty[];
  offers?: PeaceOffer[];
  /** Actions the current computer player has taken this turn; a hard stop for runaway turns. */
  botSteps?: number;
  /** Actions it tried this turn that the rules refused; never tried again this turn. */
  botBanned?: string[];
  outcome: { winnerIds: string[]; reason: "conquest" | "score" | "capitals" | "draw" } | null;
}

// ---------------------------------------------------------------------------
// Actions & events
// ---------------------------------------------------------------------------

export type DominionAction =
  | { type: "move"; turn: number; unit: string; to: number }
  | { type: "attack"; turn: number; unit: string; target: number }
  | { type: "capture"; turn: number; unit: string }
  | { type: "heal"; turn: number; unit: string }
  | { type: "promote"; turn: number; unit: string }
  | { type: "upgrade"; turn: number; unit: string; vessel: Exclude<VesselType, "transport"> }
  | { type: "disband"; turn: number; unit: string }
  /** Sage: heal every adjacent friendly unit. */
  | { type: "mend"; turn: number; unit: string }
  /** Sage: turn an adjacent enemy unit to your side. */
  | { type: "convert"; turn: number; unit: string; target: number }
  | { type: "monument"; turn: number; tile: number }
  /** Rimeborn: freeze an adjacent water tile into ice. */
  | { type: "freeze"; turn: number; unit: string; target: number }
  /** Bloom: a larva on mycelium grows early into another form, paying the difference. */
  | { type: "evolve"; turn: number; unit: string; into: UnitType }
  /** Burn the hostile mycelium the unit stands on. */
  | { type: "burn"; turn: number; unit: string }
  | { type: "sabotage"; turn: number; unit: string }
  | { type: "offer-peace"; turn: number; to: string }
  /** Answers can come out of turn; they can't spend or move anything. */
  | { type: "answer-peace"; from: string; accept: boolean }
  | { type: "break-peace"; turn: number; with: string }
  | { type: "embassy"; turn: number; with: string }
  | { type: "train"; turn: number; city: string; unitType: UnitType }
  | { type: "research"; turn: number; tech: TechId }
  | { type: "develop"; turn: number; tile: number; kind: DevelopKind }
  | { type: "reward"; turn: number; city: string; choice: RewardChoice }
  | { type: "end-turn"; turn: number }
  | { type: "surrender" };

/**
 * Events exist to animate; the settled state always comes from the projection.
 * Every one is redacted per recipient before it leaves (§10).
 */
export type DominionEvent =
  | { type: "turn-start"; playerId: string; round: number }
  /** `from`/`to` are null where the recipient couldn't see that end. */
  | { type: "move"; unit: string; from: number | null; to: number | null }
  | {
      type: "attack";
      from: number;
      to: number;
      damage: number;
      retaliation: number;
      defenderKilled: boolean;
      attackerKilled: boolean;
    }
  | { type: "spawn"; at: number }
  | { type: "heal"; at: number; amount: number }
  | { type: "capture"; at: number; by: string }
  | { type: "develop"; at: number; kind: DevelopKind }
  | { type: "research"; tech: TechId }
  | { type: "city-level"; city: string; level: number }
  | { type: "ruins"; at: number; reward: RuinReward }
  | { type: "convert"; at: number; by: string }
  /** Bomber splash on a neighbouring tile; sent only to those who saw it. */
  | { type: "splash"; at: number; damage: number; killed: boolean }
  | { type: "beacon"; at: number }
  | { type: "freeze"; at: number }
  | { type: "thaw"; at: number }
  | { type: "burn"; at: number }
  /** Poison ticking on a unit. */
  | { type: "poison"; at: number }
  | { type: "sabotage"; at: number; by: string }
  | { type: "contact"; with: string }
  | { type: "peace-offered"; from: string; to: string }
  | { type: "peace-answered"; from: string; to: string; accepted: boolean }
  | { type: "peace-broken"; by: string; with: string }
  | { type: "embassy"; from: string; to: string }
  | { type: "monument"; at: number; kind?: MonumentId }
  | { type: "achievement"; kind: MonumentId }
  | { type: "eliminated"; playerId: string }
  | { type: "game-over"; winnerIds: string[] };

export type RuinReward =
  | { kind: "credits"; amount: number }
  | { kind: "population"; amount: number; city: string }
  | { kind: "tech"; tech: TechId }
  | { kind: "unit"; at: number }
  | { kind: "explore"; radius: number };

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

export interface PublicPlayer {
  id: string;
  kind: FactionKind;
  color: number;
  eliminated: boolean;
  team?: number | null;
  /** Computer players carry their own name and skill. */
  name?: string;
  /** A person's empire, played by the computer after they were removed. */
  caretaker?: boolean;
  bot?: BotLevel;
}

export interface DominionPublicState {
  size: number;
  round: number;
  turn: number;
  phase: "playing" | "finished";
  currentPlayerId: string | null;
  deadline: number | null;
  roundLimit: number;
  victory: VictorySetting;
  players: PublicPlayer[];
}

/** A tile as one player knows it. */
export interface KnownTile {
  t: Terrain;
  res: Resource | null;
  imp: Improvement | null;
  road: boolean;
  feat: Feature | null;
  /** Owner of the territory, as last seen. */
  owner: string | null;
  /** Visible right now. Otherwise this is memory, `seen` rounds old. */
  vis: boolean;
  seen: number;
  /** Already tended (visible tiles only). */
  tended?: boolean;
  /** Spread mycelium and whose, as last seen. */
  myc?: string;
}

export interface KnownUnit {
  id: string;
  type: UnitType;
  owner: string;
  at: number;
  hp: number;
  maxHp: number;
  veteran: boolean;
  vessel?: VesselType | null;
  /** Can't move on its owner's next turn. */
  chilled?: boolean;
  poisoned?: boolean;
  /** Own units only. */
  mine?: {
    kills: number;
    mp: number;
    moved: boolean;
    attacked: boolean;
    done: boolean;
    settled: boolean;
    home: string | null;
    /** Turns until it matures, for eggs and the like. */
    maturesIn?: number;
  };
}

export interface KnownCity {
  id: string | null;
  name: string;
  at: number;
  owner: string | null;
  level: number;
  capital: boolean;
  vis: boolean;
  /** Own cities only. */
  mine?: {
    id: string;
    pop: number;
    nextLevelAt: number;
    workshop: boolean;
    walls: boolean;
    parks: number;
    units: number;
    capacity: number;
    income: IncomeBreakdown;
    occupied: boolean;
    connected: boolean;
    pendingRewards: number[];
    pendingChampion: boolean;
  };
}

export interface IncomeBreakdown {
  level: number;
  workshop: number;
  capital: number;
  connection: number;
  market: number;
  /** Wildwood: untouched forest in the city's territory. */
  forest: number;
  /** Tidefolk: reef nests among fish and reefs. */
  reef: number;
  total: number;
}

export interface AttackOption {
  target: number;
  damage: number;
  retaliation: number;
}

export interface DominionPrivateState {
  me: string;
  kind: FactionKind;
  myTurn: boolean;
  turn: number;
  /** Row-major; null = never explored. */
  tiles: (KnownTile | null)[];
  units: KnownUnit[];
  cities: KnownCity[];
  credits: number;
  income: number;
  techs: TechId[];
  cityCount: number;
  score: number;
  /** Legal moves and attacks for my units, computed from what I can see. */
  moves: Record<string, number[]>;
  attacks: Record<string, AttackOption[]>;
  /** My units that could still do something this turn. */
  idleUnits: string[];
  eliminated: boolean;
  /** Progress towards each achievement; shown only to its owner (§13). */
  achievements: { kind: MonumentId; done: boolean; progress: number; goal: number }[];
  monumentsToPlace: number;
  /** Adjacent enemies a sage could convert, per sage. */
  converts: Record<string, number[]>;
  /** Water each of my units could freeze, per unit (Rimeborn). */
  freezes: Record<string, number[]>;
  /** Everyone this player has met, and where things stand with them. */
  diplomacy: DiplomacyView[];
}

export interface DiplomacyView {
  id: string;
  /** "notice": peace was broken; hostilities resume when the breaker's next turn starts. */
  relation: "war" | "peace" | "notice";
  peaceSince: number | null;
  brokenBy: string | null;
  embassy: boolean;
  /** Pending offers either way. */
  offerFromThem: boolean;
  offerFromMe: boolean;
}
