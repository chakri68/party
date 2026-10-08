import type { SettingField } from "@games/game-core";
import { FACTION_KINDS, FACTIONS, SPECIAL_FACTIONS, TILES_PER_PLAYER } from "./content.ts";
import {
  DEFAULT_SETTINGS,
  type DominionSettings,
  type FactionKind,
  type FactionSetting,
  type FogSetting,
  type MapSizeSetting,
  type MapType,
  type BotLevel,
  type ResourceSetting,
  type VictorySetting,
} from "./types.ts";

/** Plain-language rules for the lobby's Rules button. */
const BASE_RULES: string[] = [
  "Everyone starts with one city and one infantry on a hidden map. You see around your units and inside your borders.",
  "Each turn your cities pay credits. Spend them on research, units, and developing tiles in your territory.",
  "Harvesting and building on tiles grows the city that owns them. Bigger cities pay more, hold more units, and each new level offers a choice of reward.",
  "Move a unit onto a village or an enemy city, survive until your next turn, then capture it. An enemy standing in your city stops its income.",
  "Combat is predictable: you'll see the damage before you commit. A defender that survives hits back if the attacker is in its range.",
  "Stepping next to an enemy fighter stops your move. Forests and mountains cost double, roads cost half.",
  "With Sailing, build a port on your shore. A unit that walks onto it boards a transport; landing again ends its turn. Ships can be refitted into scouts, rammers and bombers. Two ports on the same water link their cities like a road.",
  "Lose every city and you're out. Last empire standing wins; at the round limit, the highest score does.",
  "Hold the capitals: own every original capital at the end of your turn and still at the start of your next, and you win.",
  "Milestones (10 techs, 5 connected cities, 80% of the map explored, 10 battles won) each earn a monument to place on your land.",
  "With teams, allies can't attack each other and win together. Treasuries and research stay separate.",
];

/** Each special faction's one-paragraph rules; shown once it's released. */
export const SPECIAL_RULES: Partial<Record<(typeof SPECIAL_FACTIONS)[number], string>> = {
  rimeborn:
    "Rimeborn never board a ship. A unit that hasn't acted can freeze a neighbouring shallow tile into ice for 1 credit, ending its turn (open ocean too, with Deep freeze). Ice is land for everyone and takes roads with Ice roads. It lasts 6 rounds, longer while Rimeborn units, cities or land are beside it, and never thaws under a unit. Ice archers' hits chill: the target can't move on its next turn.",
  tidefolk:
    "Tidefolk walk the shallows: shell guards and reef runners need no ship and defend better on water. They settle reef villages (villages on the water; only a ship or an amphibious unit can take one), build reef nests instead of ports, and reach the open ocean with Deep calling and its leviathans. No warships.",
  wildwood:
    "Wildwood tend resources instead of harvesting them: 3 credits for +1 population, and the resource stays. They can't build lumber camps or mines; each city earns +1 income per 4 untouched forest tiles (groves count), up to +2. Owl eggs hatch into great owls after 3 turns, which fly over water, peaks and enemy lines but can't capture.",
};

/** What the lobby shows: the base rules, then each released special faction's entry. */
export const dominionRules: string[] = [
  ...BASE_RULES,
  ...SPECIAL_FACTIONS.flatMap((k) => (FACTIONS[k].released && SPECIAL_RULES[k] ? [SPECIAL_RULES[k]] : [])),
];

const pickIndex = <T>(options: readonly T[], value: T) => Math.max(0, options.indexOf(value));

export const MAP_SIZES = [16, 24, 32] as const;

/** Smallest map that gives every player their 48 tiles; "auto" also leans bigger for crowds. */
export function resolveMapSize(setting: MapSizeSetting, players: number): number {
  const need = (s: number) => s * s >= players * TILES_PER_PLAYER;
  if (setting !== "auto" && need(setting)) return setting;
  const preferred = setting === "auto" ? (players <= 2 ? 16 : players <= 5 ? 24 : 32) : setting;
  return MAP_SIZES.find((s) => s >= preferred && need(s)) ?? 32;
}

export function parseSettings(input: unknown): DominionSettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const s = { ...DEFAULT_SETTINGS, ...(input as Partial<DominionSettings>) };
  const ok =
    (["conquest", "score", "capitals"] as unknown[]).includes(s.victory) &&
    (["auto", 16, 24, 32] as unknown[]).includes(s.mapSize) &&
    (["continents", "landmass", "lakes", "archipelago"] as unknown[]).includes(s.mapType) &&
    ([0, 60, 120, 180, 300] as unknown[]).includes(s.turnClock) &&
    ([0, 30, 60, 90] as unknown[]).includes(s.roundLimit) &&
    (["on", "terrain", "off"] as unknown[]).includes(s.fog) &&
    (["sparse", "standard", "abundant"] as unknown[]).includes(s.resources) &&
    // Unreleased factions can't be asked for, even by a hand-built patch.
    (s.factions === "mixed" || (Object.hasOwn(FACTIONS, s.factions as string) && FACTIONS[s.factions as FactionKind].released)) &&
    ([0, 2, 3, 4] as unknown[]).includes(s.teams) &&
    typeof s.sharedVision === "boolean" &&
    Number.isInteger(s.bots) && s.bots >= 0 && s.bots <= MAX_BOTS &&
    (["easy", "normal", "hard"] as unknown[]).includes(s.botLevel);
  if (!ok) return null;
  // Score games need an end; unlimited only makes sense for conquest.
  const roundLimit = s.victory === "score" && s.roundLimit === 0 ? 60 : s.roundLimit;
  return {
    victory: s.victory,
    mapSize: s.mapSize,
    mapType: s.mapType,
    turnClock: s.turnClock,
    roundLimit,
    fog: s.fog,
    resources: s.resources,
    factions: s.factions,
    bots: s.bots,
    botLevel: s.botLevel,
    teams: s.teams,
    sharedVision: s.sharedVision,
  };
}

export const MAX_PARTICIPANTS = 8;

/** Teams only when every team gets someone; otherwise everyone plays alone. */
export function resolveTeams(requested: number, participants: number): number {
  return requested >= 2 && participants >= requested ? requested : 0;
}
export const MAX_BOTS = 7;

/** Computer players that actually join: never past 8 seats, and a lone person always gets one. */
export function resolveBots(requested: number, humans: number): number {
  const bots = Math.min(requested, MAX_PARTICIPANTS - humans);
  return humans + bots < 2 ? 2 - humans : bots;
}

/** A rough guide, not a promise (§3): ~2.5 minutes a round per player, capped by the clock. */
function estimate(settings: DominionSettings, players: number, size: number): string {
  const perTurn = settings.turnClock ? Math.min(settings.turnClock, 90) : 75;
  const rounds = settings.roundLimit || Math.round(size * 1.5);
  const minutes = Math.round((rounds * players * perTurn) / 60 / 10) * 10;
  if (!settings.roundLimit) return `no fixed end; often ${minutes}+ min`;
  return `about ${Math.max(20, minutes)} min, give or take a war`;
}

export function dominionSettingFields(raw: unknown, players: number): SettingField[] {
  const settings = parseSettings(raw) ?? DEFAULT_SETTINGS;
  const humans = Math.max(players, 1);
  const bots = resolveBots(settings.bots, humans);
  const n = humans + bots;
  const size = resolveMapSize(settings.mapSize, n);

  const victories: VictorySetting[] = ["conquest", "score", "capitals"];
  const sizes: MapSizeSetting[] = ["auto", 16, 24, 32];
  const types: MapType[] = ["continents", "landmass", "lakes", "archipelago"];
  const clocks = [0, 60, 120, 180, 300] as const;
  // Score games need an end, so no "unlimited" for them.
  const limits = ([0, 30, 60, 90] as const).filter((l) => l !== 0 || settings.victory === "conquest");
  const fogs: FogSetting[] = ["on", "terrain", "off"];
  const resources: ResourceSetting[] = ["sparse", "standard", "abundant"];
  const factions: FactionSetting[] = ["mixed", ...FACTION_KINDS.filter((k) => FACTIONS[k].released)];
  const teamCounts = [0, 2, 3, 4] as const;
  const teams = resolveTeams(settings.teams, n);
  const botCounts = Array.from({ length: MAX_BOTS + 1 }, (_, k) => k);
  const levels: BotLevel[] = ["easy", "normal", "hard"];

  const fields: SettingField[] = [
    {
      key: "bots",
      label: "Computers",
      selected: pickIndex(botCounts, settings.bots),
      options: botCounts.map((k) => ({ label: k ? String(k) : "None", patch: { bots: k } })),
      hint:
        bots !== settings.bots
          ? bots > settings.bots ? "Playing alone: one computer joins" : `Room for ${bots} with ${humans} people`
          : undefined,
    },
    {
      key: "victory",
      label: "Victory",
      selected: pickIndex(victories, settings.victory),
      options: [
        { label: "Conquest", patch: { victory: "conquest" } },
        { label: "Score", patch: { victory: "score" } },
        { label: "Hold the capitals", patch: { victory: "capitals" } },
      ],
      hint: estimate(settings, n, size),
    },
    {
      key: "mapSize",
      label: "Map",
      selected: pickIndex(sizes, settings.mapSize),
      options: sizes.map((s) => ({
        label: s === "auto" ? `Auto (${resolveMapSize("auto", n)}×${resolveMapSize("auto", n)})` : `${s}×${s}`,
        patch: { mapSize: s },
      })),
      hint: settings.mapSize !== "auto" && size !== settings.mapSize ? `Too small for ${n}; using ${size}×${size}` : undefined,
    },
    {
      key: "mapType",
      label: "Terrain",
      selected: pickIndex(types, settings.mapType),
      options: [
        { label: "Continents", patch: { mapType: "continents" } },
        { label: "Landmass", patch: { mapType: "landmass" } },
        { label: "Lakes", patch: { mapType: "lakes" } },
        { label: "Archipelago", patch: { mapType: "archipelago" } },
      ],
      hint: settings.mapType === "continents" || settings.mapType === "archipelago" ? "Rivals may be across the water: Sailing builds ports" : undefined,
    },
    {
      key: "turnClock",
      label: "Turn clock",
      selected: pickIndex(clocks, settings.turnClock),
      options: clocks.map((c) => ({ label: c ? `${c / 60} min` : "Off", patch: { turnClock: c } })),
    },
    {
      key: "roundLimit",
      label: "Rounds",
      selected: pickIndex(limits, settings.roundLimit),
      options: limits.map((l) => ({ label: l ? String(l) : "Unlimited", patch: { roundLimit: l } })),
    },
    {
      key: "fog",
      label: "Fog",
      selected: pickIndex(fogs, settings.fog),
      options: [
        { label: "On", patch: { fog: "on" } },
        { label: "Terrain shown", patch: { fog: "terrain" } },
        { label: "Off", patch: { fog: "off" } },
      ],
    },
    {
      key: "resources",
      label: "Resources",
      selected: pickIndex(resources, settings.resources),
      options: [
        { label: "Sparse", patch: { resources: "sparse" } },
        { label: "Standard", patch: { resources: "standard" } },
        { label: "Abundant", patch: { resources: "abundant" } },
      ],
    },
    {
      key: "factions",
      label: "Factions",
      selected: pickIndex(factions, settings.factions),
      options: factions.map((f) => ({ label: f === "mixed" ? "Mixed" : FACTIONS[f].name, patch: { factions: f } })),
      hint: settings.factions === "mixed" ? "Dealt out at random" : FACTIONS[settings.factions].blurb,
    },
  ];
  fields.push({
    key: "teams",
    label: "Teams",
    selected: pickIndex(teamCounts, settings.teams),
    options: teamCounts.map((t) => ({ label: t ? `${t} teams` : "Off", patch: { teams: t } })),
    hint: settings.teams && !teams ? `Needs at least ${settings.teams} empires` : teams ? "Seats are dealt into teams in turn order" : undefined,
  });
  if (teams) {
    fields.push({
      key: "sharedVision",
      label: "Team vision",
      selected: settings.sharedVision ? 0 : 1,
      options: [
        { label: "Shared", patch: { sharedVision: true } },
        { label: "Own only", patch: { sharedVision: false } },
      ],
    });
  }
  if (bots > 0) {
    fields.splice(1, 0, {
      key: "botLevel",
      label: "Computer skill",
      selected: pickIndex(levels, settings.botLevel),
      options: [
        { label: "Easy", patch: { botLevel: "easy" } },
        { label: "Normal", patch: { botLevel: "normal" } },
        { label: "Hard", patch: { botLevel: "hard" } },
      ],
    });
  }
  return fields;
}
