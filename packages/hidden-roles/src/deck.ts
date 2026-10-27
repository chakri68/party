// Role decks as lobby settings. A deck is a count per role; the host either picks
// a preset (which scales itself to the head count) or goes Custom and sets every
// count by hand. Settings stay flat, one top-level key per role, because the room
// shallow-merges each lobby patch: a nested `counts` object in one patch would
// carry stale siblings over a change that landed a moment earlier.

import type { SettingField } from "@games/game-core";

export interface RoleSpec {
  id: string;
  label: string;
  team: string;
  /** Most copies a deck may hold. 1 makes the role unique. */
  max: number;
}

/** roleId -> how many cards of it. */
export type Deck = Record<string, number>;

export interface Preset {
  id: string;
  label: string;
  /** Must fit `DeckRules` for every head count the game seats. */
  deck(players: number): Deck;
}

export interface DeckRules {
  /** Cards dealt for this many players (N, or N plus centre cards). */
  size(players: number): number;
  /** Teams that need at least one card in every deck. */
  requireTeams: string[];
  /**
   * What players call each team, for the missing-team message: { village: "Village" }
   * gives "Needs at least one Village card". A team left out is named after its
   * first role instead ("Needs at least one Seer team card"), which reads oddly
   * when that role isn't the team's plain card.
   */
  teamLabels?: Record<string, string>;
  /**
   * The smallest table the game seats. Below it the lobby hint lists the deck
   * rather than a problem: a host alone shouldn't be told their deck is wrong
   * when the real problem is that nobody's arrived.
   */
  minPlayers?: number;
}

/** `preset: "custom"` reads the counts; any preset id ignores them. */
export interface DeckSettings {
  preset: string;
  [countKey: `n:${string}`]: number;
}

export const CUSTOM = "custom";

export function countKey(roleId: string): `n:${string}` {
  return `n:${roleId}`;
}

/**
 * The deck part of a game's settings, or null when something's off. Unknown keys
 * are dropped (the game parses its own keys alongside); missing counts are 0.
 */
export function parseDeckSettings(input: unknown, roles: RoleSpec[], presets: Preset[]): DeckSettings | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const preset = raw.preset;
  if (typeof preset !== "string" || (preset !== CUSTOM && !presets.some((p) => p.id === preset))) return null;
  const out: DeckSettings = { preset };
  for (const r of roles) {
    const n = raw[countKey(r.id)] ?? 0;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) return null;
    out[countKey(r.id)] = n;
  }
  return out;
}

/** The deck these settings deal at this head count. Zero counts are left out. */
export function deckFor(settings: DeckSettings, roles: RoleSpec[], presets: Preset[], players: number): Deck {
  const preset = presets.find((p) => p.id === settings.preset);
  if (preset) return preset.deck(players);
  const deck: Deck = {};
  for (const r of roles) {
    const n = settings[countKey(r.id)] ?? 0;
    if (n > 0) deck[r.id] = n;
  }
  return deck;
}

/** Why this deck can't deal this table, worded for players, or null. Size first: it's the usual one. */
export function deckProblem(deck: Deck, roles: RoleSpec[], rules: DeckRules, players: number): string | null {
  const want = rules.size(players);
  const have = Object.values(deck).reduce((a, b) => a + b, 0);
  if (have !== want) return `Need exactly ${want} role card${want === 1 ? "" : "s"} (have ${have})`;
  for (const r of roles) {
    if ((deck[r.id] ?? 0) <= r.max) continue;
    return r.max === 1 ? `${r.label} is unique` : `At most ${r.max} ${r.label}`;
  }
  for (const team of rules.requireTeams) {
    const members = roles.filter((r) => r.team === team);
    if (members.some((r) => (deck[r.id] ?? 0) > 0)) continue;
    const label = rules.teamLabels?.[team];
    return label ? `Needs at least one ${label} card` : `Needs at least one ${members[0]?.label ?? team} team card`;
  }
  return null;
}

/** "2 Werewolf, 1 Seer, 3 Villager", in role order. */
function deckList(deck: Deck, roles: RoleSpec[]): string {
  return roles
    .filter((r) => (deck[r.id] ?? 0) > 0)
    .map((r) => `${deck[r.id]} ${r.label}`)
    .join(", ");
}

/**
 * Lobby rows: a preset picker, plus one count select per role while on Custom.
 * Every count option patches only its own key, so two quick edits both land.
 * Picking Custom copies the current preset's deck in as a starting point.
 */
export function deckSettingFields(
  settings: DeckSettings,
  roles: RoleSpec[],
  presets: Preset[],
  rules: DeckRules,
  players: number,
): SettingField[] {
  const isCustom = settings.preset === CUSTOM;
  const deck = deckFor(settings, roles, presets, players);
  const customPatch: Record<string, unknown> = isCustom
    ? { preset: CUSTOM }
    : { preset: CUSTOM, ...Object.fromEntries(roles.map((r) => [countKey(r.id), deck[r.id] ?? 0])) };

  const presetRow: SettingField = {
    key: "preset",
    label: "Roles",
    selected: isCustom ? presets.length : Math.max(0, presets.findIndex((p) => p.id === settings.preset)),
    options: [
      ...presets.map((p) => ({ label: p.label, patch: { preset: p.id } })),
      { label: "Custom", patch: customPatch },
    ],
    hint: (players >= (rules.minPlayers ?? 0) && deckProblem(deck, roles, rules, players)) || deckList(deck, roles),
  };
  if (!isCustom) return [presetRow];

  return [
    presetRow,
    ...roles.map((r): SettingField => {
      const key = countKey(r.id);
      return {
        key,
        label: r.label,
        selected: Math.min(settings[key] ?? 0, r.max),
        options: Array.from({ length: r.max + 1 }, (_, k) => ({ label: String(k), patch: { [key]: k } })),
      };
    }),
  ];
}
