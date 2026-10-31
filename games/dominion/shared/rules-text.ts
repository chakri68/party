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
  "Each player starts with 1 city and 1 soldier. The map is hidden. You can see the land near your units. You can also see the land inside your borders.",
  "Your cities give you credits every turn. Credits are the money in this game. You spend credits on research, new units and your land.",
  "Your cities grow when you work their land. You can harvest a tile. You can also build on a tile. Each time, the city grows. A bigger city gives more credits. A bigger city can also hold more units. Each new city level gives you a choice of 2 rewards.",
  "You take a city by standing in it. Move a unit onto a village or an enemy city. Wait for your next turn. If your unit is still alive, you take the city. An enemy unit in your city stops the city's credits.",
  "Fights have no luck. You see the damage before you attack. The defender may live. Then the defender hits back, if your unit is in its range.",
  "Enemy soldiers block your path. Your unit stops when it moves next to an enemy soldier. Forests and mountains cost 2 times the moves. Roads cost half.",
  "Ports let you cross water. First, research Sailing. Then build a port on your coast. Walk a unit onto the port. The unit gets on a boat. Landing again ends the unit's turn. You can change a boat into a scout, a rammer or a bomber. 2 ports on the same water join their cities, like a road.",
  "You lose when you have no cities left. The last player with cities wins. Some games have a round limit. In those games, the top score wins at the end.",
  "Hold the capitals: this is another way to win. A capital is a player's first city. Own every first city at the end of your turn. Own them all again at the start of your next turn. Then you win.",
  "Milestones give you monuments. There are 5 milestones. Learn 10 techs. Join 5 cities by road. See 80% of the map. Win 10 fights. Stay at peace with 3 players for 5 rounds. Each milestone gives you 1 monument. You put the monument on your land.",
  "In a team game, team-mates cannot attack each other. Team-mates win together. Each player keeps their own credits and research.",
];

/** Each special faction's one-paragraph rules; shown once it's released. */
export const SPECIAL_RULES: Partial<Record<(typeof SPECIAL_FACTIONS)[number], string>> = {
  bloom:
    "The Bloom's land is called mycelium. The Bloom can spread mycelium to the next tile for 1 credit. The Bloom cannot spread it into a treaty partner's land. Bloom units move on mycelium for half a move per step. Off mycelium, each step costs 1.5 times as much. The Bloom do not harvest fruit or crops. The Bloom take them in for +1 population. The Bloom build no roads. A larva costs 1 credit. After 2 turns, a larva grows into a drone. On mycelium, a larva can change early. It can become a stinger or a brood mother. A stinger's hits poison the target. A brood mother lays larvae. Healing removes poison. Enemies on mycelium can burn the mycelium.",
  rimeborn:
    "Rimeborn never get on a boat. A Rimeborn unit can freeze a nearby shallow tile into ice. The unit must not have acted this turn. Freezing costs 1 credit and ends the unit's turn. With Deep freeze, Rimeborn can freeze open ocean too. Everyone can walk on ice. With Ice roads, Rimeborn can build roads on ice. Ice lasts 6 rounds. Rimeborn units, cities or land next to the ice make it last longer. Ice never melts under a unit. An ice archer's hit freezes the target. The target cannot move on its next turn.",
  tidefolk:
    "Tidefolk walk in shallow water. Shell guards and reef runners need no boat. Shell guards and reef runners defend better on water. Tidefolk can build reef villages on the water. To take a reef village, you need a boat or a unit that walks in water. Tidefolk build reef nests in place of ports. Deep calling lets Tidefolk reach the open ocean. Deep calling also gives them leviathans. Tidefolk have no warships.",
  wildwood:
    "Wildwood look after resources. Wildwood do not harvest them. Looking after a resource costs 3 credits. It gives +1 population. The resource stays on the tile. Wildwood cannot build lumber camps or mines. Each city gets +1 credit for every 5 untouched forest tiles. Groves also count as untouched forest. Each city can get up to +2 credits this way. An owl egg hatches into a great owl after 3 turns. Great owls fly over water, mountain tops and enemy lines. Great owls cannot take cities.",
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
  return `about ${Math.max(20, minutes)} min or more`;
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
          ? bots > settings.bots ? "You are alone, so 1 computer joins" : `Only ${bots} fit with ${humans} people`
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
      hint: settings.mapSize !== "auto" && size !== settings.mapSize ? `Too small for ${n}. Using ${size}×${size}` : undefined,
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
      hint: settings.mapType === "continents" || settings.mapType === "archipelago" ? "Others may be across the sea. Sailing lets you build ports" : undefined,
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
      hint: settings.factions === "mixed" ? "Each player gets a random one" : FACTIONS[settings.factions].blurb,
    },
  ];
  fields.push({
    key: "teams",
    label: "Teams",
    selected: pickIndex(teamCounts, settings.teams),
    options: teamCounts.map((t) => ({ label: t ? `${t} teams` : "Off", patch: { teams: t } })),
    hint: settings.teams && !teams ? `Needs at least ${settings.teams} players` : teams ? "Players join teams in turn order" : undefined,
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
