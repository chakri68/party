import type { SettingField } from "@games/game-core";
import { FACTIONS, TILES_PER_PLAYER } from "./content.ts";
import {
  DEFAULT_SETTINGS,
  type DominionSettings,
  type FactionSetting,
  type FogSetting,
  type MapSizeSetting,
  type MapType,
  type BotLevel,
  type ResourceSetting,
  type VictorySetting,
} from "./types.ts";

/** Plain-language rules for the lobby's Rules button. */
export const dominionRules: string[] = [
  "Everyone starts with one city and one infantry on a hidden map. You see around your units and inside your borders.",
  "Each turn your cities pay credits. Spend them on research, units, and developing tiles in your territory.",
  "Harvesting and building on tiles grows the city that owns them. Bigger cities pay more, hold more units, and each new level offers a choice of reward.",
  "Move a unit onto a village or an enemy city, survive until your next turn, then capture it. An enemy standing in your city stops its income.",
  "Combat is predictable: you'll see the damage before you commit. A defender that survives hits back if the attacker is in its range.",
  "Stepping next to an enemy fighter stops your move. Forests and mountains cost double, roads cost half.",
  "Lose every city and you're out. Last empire standing wins; at the round limit, the highest score does.",
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
    (["conquest", "score"] as unknown[]).includes(s.victory) &&
    (["auto", 16, 24, 32] as unknown[]).includes(s.mapSize) &&
    (["landmass", "lakes"] as unknown[]).includes(s.mapType) &&
    ([0, 60, 120, 180, 300] as unknown[]).includes(s.turnClock) &&
    ([0, 30, 60, 90] as unknown[]).includes(s.roundLimit) &&
    (["on", "terrain", "off"] as unknown[]).includes(s.fog) &&
    (["sparse", "standard", "abundant"] as unknown[]).includes(s.resources) &&
    (["mixed", "orchard", "forest"] as unknown[]).includes(s.factions) &&
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
  };
}

export const MAX_PARTICIPANTS = 8;
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

  const victories: VictorySetting[] = ["conquest", "score"];
  const sizes: MapSizeSetting[] = ["auto", 16, 24, 32];
  const types: MapType[] = ["landmass", "lakes"];
  const clocks = [0, 60, 120, 180, 300] as const;
  // Score games need an end, so no "unlimited" for them.
  const limits = ([0, 30, 60, 90] as const).filter((l) => l !== 0 || settings.victory === "conquest");
  const fogs: FogSetting[] = ["on", "terrain", "off"];
  const resources: ResourceSetting[] = ["sparse", "standard", "abundant"];
  const factions: FactionSetting[] = ["mixed", "orchard", "forest"];
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
        { label: "Landmass", patch: { mapType: "landmass" } },
        { label: "Lakes", patch: { mapType: "lakes" } },
      ],
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
      options: [
        { label: "Mixed", patch: { factions: "mixed" } },
        { label: FACTIONS.orchard.name, patch: { factions: "orchard" } },
        { label: FACTIONS.forest.name, patch: { factions: "forest" } },
      ],
      hint: settings.factions === "mixed" ? "Dealt out at random" : FACTIONS[settings.factions].blurb,
    },
  ];
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
