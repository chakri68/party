// Client half of the game registry (§43). Explicit imports keep Vite's chunking
// predictable; each game's client code loads only when a game starts.

import { crazyEightsManifest, crazyEightsRules, crazyEightsSettingFields } from "@games/crazy-eights/shared";
import type { GameManifest, SettingField } from "@games/game-core";
import { goFishManifest, goFishRules, goFishSettingFields } from "@games/go-fish/shared";
import { oldMaidManifest, oldMaidRules, oldMaidSettingFields } from "@games/old-maid/shared";
import { passTheBombManifest, passTheBombRules, passTheBombSettingFields } from "@games/pass-the-bomb/shared";
import { scribblManifest, scribblRules, scribblSettingFields } from "@games/scribbl/shared";
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
  "crazy-eights": {
    manifest: crazyEightsManifest,
    rules: crazyEightsRules,
    settingFields: crazyEightsSettingFields,
    loadClient: () => import("@games/crazy-eights/client").then((m) => m.default),
  },
  "old-maid": {
    manifest: oldMaidManifest,
    rules: oldMaidRules,
    settingFields: oldMaidSettingFields,
    loadClient: () => import("@games/old-maid/client").then((m) => m.default),
  },
  "go-fish": {
    manifest: goFishManifest,
    rules: goFishRules,
    settingFields: goFishSettingFields,
    loadClient: () => import("@games/go-fish/client").then((m) => m.default),
  },
  scribbl: {
    manifest: scribblManifest,
    rules: scribblRules,
    settingFields: scribblSettingFields,
    loadClient: () => import("@games/scribbl/client").then((m) => m.default),
  },
  "pass-the-bomb": {
    manifest: passTheBombManifest,
    rules: passTheBombRules,
    settingFields: passTheBombSettingFields,
    loadClient: () => import("@games/pass-the-bomb/client").then((m) => m.default),
  },
};
