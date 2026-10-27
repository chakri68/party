// Client half of the game registry (§43). Explicit imports keep Vite's chunking
// predictable; each game's client code loads only when a game starts.

import { blindRallyManifest, blindRallyRules, blindRallySettingFields, rallyManifest, rallyRules, rallySettingFields } from "@games/blind-rally/shared";
import { chainWordsManifest, chainWordsRules, chainWordsSettingFields } from "@games/chain-words/shared";
import { cheatManifest, cheatRules, cheatSettingFields } from "@games/cheat/shared";
import { crazyEightsManifest, crazyEightsRules, crazyEightsSettingFields } from "@games/crazy-eights/shared";
import { dominionManifest, dominionRules, dominionSettingFields } from "@games/dominion/shared";
import type { GameManifest, SettingField } from "@games/game-core";
import { goFishManifest, goFishRules, goFishSettingFields } from "@games/go-fish/shared";
import { oldMaidManifest, oldMaidRules, oldMaidSettingFields } from "@games/old-maid/shared";
import { passTheBombManifest, passTheBombRules, passTheBombSettingFields } from "@games/pass-the-bomb/shared";
import { presidentManifest, presidentRules, presidentSettingFields } from "@games/president/shared";
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

/**
 * Blind Rally needs a Godot export that isn't in git (map D1). Vite inlines
 * the flag, so a build without it drops the entry and its chunks entirely:
 * `pnpm dev` and `pnpm run deploy` set VITE_BLIND_RALLY=1, scripts/host.mjs
 * doesn't. The server checks its own BLIND_RALLY var the same way. Rally
 * boots the same export, so it hangs off the same flag.
 */
const BLIND_RALLY = import.meta.env.VITE_BLIND_RALLY === "1";

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
  president: {
    manifest: presidentManifest,
    rules: presidentRules,
    settingFields: presidentSettingFields,
    loadClient: () => import("@games/president/client").then((m) => m.default),
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
  "chain-words": {
    manifest: chainWordsManifest,
    rules: chainWordsRules,
    settingFields: chainWordsSettingFields,
    loadClient: () => import("@games/chain-words/client").then((m) => m.default),
  },
  cheat: {
    manifest: cheatManifest,
    rules: cheatRules,
    settingFields: cheatSettingFields,
    loadClient: () => import("@games/cheat/client").then((m) => m.default),
  },
  dominion: {
    manifest: dominionManifest,
    rules: dominionRules,
    settingFields: dominionSettingFields,
    loadClient: () => import("@games/dominion/client").then((m) => m.default),
  },
  ...(BLIND_RALLY && {
    "blind-rally": {
      manifest: blindRallyManifest,
      rules: blindRallyRules,
      settingFields: blindRallySettingFields,
      loadClient: () => import("@games/blind-rally/client").then((m) => m.default),
    },
    rally: {
      manifest: rallyManifest,
      rules: rallyRules,
      settingFields: rallySettingFields,
      loadClient: () => import("@games/blind-rally/client").then((m) => m.rally),
    },
  }),
};
