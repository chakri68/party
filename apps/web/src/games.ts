// Client half of the game registry (§43). Explicit imports keep Vite's chunking
// predictable; each game's client code loads only when a game starts.

import type { GameManifest, SettingField } from "@games/game-core";
import { sevensManifest, sevensRules, sevensSettingFields } from "@games/sevens/shared";
import type { GameClientModule } from "@games/ui";

export interface GameEntry {
  manifest: GameManifest;
  /** Plain-language rules for the lobby's Rules button (§25). */
  rules: string[];
  /** Lobby settings for the current room settings and head count. */
  settingFields(settings: unknown, players: number): SettingField[];
  loadClient(): Promise<GameClientModule>;
}

export const games: Record<string, GameEntry> = {
  sevens: {
    manifest: sevensManifest,
    rules: sevensRules,
    settingFields: sevensSettingFields,
    loadClient: () => import("@games/sevens/client").then((m) => m.default),
  },
};
