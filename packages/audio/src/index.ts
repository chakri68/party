// Stub (§28). Real sounds land in Phase 5; until then games can call it freely.

export type SoundId = "card-place" | "your-turn" | "pass" | "win" | "reject" | "nudge";

export interface AudioManager {
  /** Call from a user gesture; browsers block audio until then. */
  unlock(): void;
  play(sound: SoundId): void;
  enabled: boolean;
}

export const audio: AudioManager = {
  enabled: true,
  unlock() {},
  play() {},
};
