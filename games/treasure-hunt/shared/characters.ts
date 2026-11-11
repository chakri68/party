import { stableHash } from "@games/game-core";

/** Same ids, same order as Godot's CharacterModel.IDS. */
export const CHARACTERS = ["female-a", "female-b", "female-c", "female-d", "male-a", "male-b", "male-c", "male-d"] as const;
export type CharacterId = (typeof CHARACTERS)[number];

export const CHARACTER_LABELS: Record<CharacterId, string> = {
  "female-a": "Woman 1",
  "female-b": "Woman 2",
  "female-c": "Woman 3",
  "female-d": "Woman 4",
  "male-a": "Man 1",
  "male-b": "Man 2",
  "male-c": "Man 3",
  "male-d": "Man 4",
};

export const isCharacterId = (v: unknown): v is CharacterId => typeof v === "string" && (CHARACTERS as readonly string[]).includes(v);

/** What a player wears until they pick: a stable spread over the eight. */
export const defaultCharacter = (playerId: string): CharacterId => CHARACTERS[stableHash(playerId) % CHARACTERS.length]!;
