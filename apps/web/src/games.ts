// Client half of the game registry (§43). Explicit imports keep Vite's chunking
// predictable; each game's client code loads only when a game starts.

import { blindRallyManifest, blindRallyRules, blindRallySettingFields, rallyManifest, rallyRules, rallySettingFields } from "@games/blind-rally/shared";
import { bluffDefinitionsManifest, bluffDefinitionsRules, bluffDefinitionsSettingFields, fakeWordManifest, fakeWordRules, fakeWordSettingFields } from "@games/bluff/shared";
import { chainWordsManifest, chainWordsRules, chainWordsSettingFields } from "@games/chain-words/shared";
import { cheatManifest, cheatRules, cheatSettingFields } from "@games/cheat/shared";
import { crazyEightsManifest, crazyEightsRules, crazyEightsSettingFields } from "@games/crazy-eights/shared";
import { dominionManifest, dominionRules, dominionSettingFields } from "@games/dominion/shared";
import { dontSayItManifest, dontSayItRules, dontSayItSettingFields } from "@games/dont-say-it/shared";
import { faceOffManifest, faceOffRules, faceOffSettingFields } from "@games/face-off/shared";
import { farkleManifest, farkleRules, farkleSettingFields } from "@games/farkle/shared";
import type { GameManifest, SettingField } from "@games/game-core";
import { heistManifest, heistRules, heistSettingFields } from "@games/heist/shared";
import { holdemManifest, holdemRules, holdemSettingFields } from "@games/holdem/shared";
import { imposterManifest, imposterRules, imposterSettingFields } from "@games/imposter/shared";
import { goFishManifest, goFishRules, goFishSettingFields } from "@games/go-fish/shared";
import { liarsDiceManifest, liarsDiceRules, liarsDiceSettingFields } from "@games/liars-dice/shared";
import { nightfallManifest, nightfallRules, nightfallSettingFields } from "@games/nightfall/shared";
import { ohHellManifest, ohHellRules, ohHellSettingFields } from "@games/oh-hell/shared";
import { oldMaidManifest, oldMaidRules, oldMaidSettingFields } from "@games/old-maid/shared";
import { passTheBombManifest, passTheBombRules, passTheBombSettingFields } from "@games/pass-the-bomb/shared";
import { presidentManifest, presidentRules, presidentSettingFields } from "@games/president/shared";
import { samePageManifest, samePageRules, samePageSettingFields } from "@games/same-page/shared";
import { scribblManifest, scribblRules, scribblSettingFields } from "@games/scribbl/shared";
import { sevensManifest, sevensRules, sevensSettingFields } from "@games/sevens/shared";
import { shortNightManifest, shortNightRules, shortNightSettingFields } from "@games/short-night/shared";
import { thornsManifest, thornsRules, thornsSettingFields } from "@games/thorns/shared";
import type { GameClientModule } from "@games/ui";

/** Headings in the host's game list, in the order they show. */
export const GAME_SECTIONS = [
  { id: "cards", label: "Cards" },
  { id: "dice", label: "Dice" },
  { id: "words", label: "Words and drawing" },
  { id: "roles", label: "Hidden roles" },
  { id: "racing", label: "Racing" },
  { id: "strategy", label: "Strategy" },
] as const;

export type GameSection = (typeof GAME_SECTIONS)[number]["id"];

export interface GameEntry {
  manifest: GameManifest;
  /** Which heading it sits under in the game list. */
  section: GameSection;
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
    section: "cards",
    manifest: sevensManifest,
    rules: sevensRules,
    settingFields: sevensSettingFields,
    loadClient: () => import("@games/sevens/client").then((m) => m.default),
  },
  "crazy-eights": {
    section: "cards",
    manifest: crazyEightsManifest,
    rules: crazyEightsRules,
    settingFields: crazyEightsSettingFields,
    loadClient: () => import("@games/crazy-eights/client").then((m) => m.default),
  },
  "old-maid": {
    section: "cards",
    manifest: oldMaidManifest,
    rules: oldMaidRules,
    settingFields: oldMaidSettingFields,
    loadClient: () => import("@games/old-maid/client").then((m) => m.default),
  },
  "go-fish": {
    section: "cards",
    manifest: goFishManifest,
    rules: goFishRules,
    settingFields: goFishSettingFields,
    loadClient: () => import("@games/go-fish/client").then((m) => m.default),
  },
  president: {
    section: "cards",
    manifest: presidentManifest,
    rules: presidentRules,
    settingFields: presidentSettingFields,
    loadClient: () => import("@games/president/client").then((m) => m.default),
  },
  scribbl: {
    section: "words",
    manifest: scribblManifest,
    rules: scribblRules,
    settingFields: scribblSettingFields,
    loadClient: () => import("@games/scribbl/client").then((m) => m.default),
  },
  "pass-the-bomb": {
    section: "words",
    manifest: passTheBombManifest,
    rules: passTheBombRules,
    settingFields: passTheBombSettingFields,
    loadClient: () => import("@games/pass-the-bomb/client").then((m) => m.default),
  },
  "chain-words": {
    section: "words",
    manifest: chainWordsManifest,
    rules: chainWordsRules,
    settingFields: chainWordsSettingFields,
    loadClient: () => import("@games/chain-words/client").then((m) => m.default),
  },
  imposter: {
    section: "roles",
    manifest: imposterManifest,
    rules: imposterRules,
    settingFields: imposterSettingFields,
    loadClient: () => import("@games/imposter/client").then((m) => m.default),
  },
  "fake-word": {
    section: "words",
    manifest: fakeWordManifest,
    rules: fakeWordRules,
    settingFields: fakeWordSettingFields,
    loadClient: () => import("@games/bluff/client").then((m) => m.fakeWord),
  },
  "bluff-definitions": {
    section: "words",
    manifest: bluffDefinitionsManifest,
    rules: bluffDefinitionsRules,
    settingFields: bluffDefinitionsSettingFields,
    loadClient: () => import("@games/bluff/client").then((m) => m.bluffDefinitions),
  },
  "dont-say-it": {
    section: "words",
    manifest: dontSayItManifest,
    rules: dontSayItRules,
    settingFields: dontSayItSettingFields,
    loadClient: () => import("@games/dont-say-it/client").then((m) => m.default),
  },
  "face-off": {
    section: "words",
    manifest: faceOffManifest,
    rules: faceOffRules,
    settingFields: faceOffSettingFields,
    loadClient: () => import("@games/face-off/client").then((m) => m.default),
  },
  cheat: {
    section: "cards",
    manifest: cheatManifest,
    rules: cheatRules,
    settingFields: cheatSettingFields,
    loadClient: () => import("@games/cheat/client").then((m) => m.default),
  },
  dominion: {
    section: "strategy",
    manifest: dominionManifest,
    rules: dominionRules,
    settingFields: dominionSettingFields,
    loadClient: () => import("@games/dominion/client").then((m) => m.default),
  },
  "short-night": {
    section: "roles",
    manifest: shortNightManifest,
    rules: shortNightRules,
    settingFields: shortNightSettingFields,
    loadClient: () => import("@games/short-night/client").then((m) => m.default),
  },
  heist: {
    section: "roles",
    manifest: heistManifest,
    rules: heistRules,
    settingFields: heistSettingFields,
    loadClient: () => import("@games/heist/client").then((m) => m.default),
  },
  nightfall: {
    section: "roles",
    manifest: nightfallManifest,
    rules: nightfallRules,
    settingFields: nightfallSettingFields,
    loadClient: () => import("@games/nightfall/client").then((m) => m.default),
  },
  "liars-dice": {
    section: "dice",
    manifest: liarsDiceManifest,
    rules: liarsDiceRules,
    settingFields: liarsDiceSettingFields,
    loadClient: () => import("@games/liars-dice/client").then((m) => m.default),
  },
  farkle: {
    section: "dice",
    manifest: farkleManifest,
    rules: farkleRules,
    settingFields: farkleSettingFields,
    loadClient: () => import("@games/farkle/client").then((m) => m.default),
  },
  thorns: {
    section: "dice",
    manifest: thornsManifest,
    rules: thornsRules,
    settingFields: thornsSettingFields,
    loadClient: () => import("@games/thorns/client").then((m) => m.default),
  },
  "oh-hell": {
    section: "cards",
    manifest: ohHellManifest,
    rules: ohHellRules,
    settingFields: ohHellSettingFields,
    loadClient: () => import("@games/oh-hell/client").then((m) => m.default),
  },
  holdem: {
    section: "cards",
    manifest: holdemManifest,
    rules: holdemRules,
    settingFields: holdemSettingFields,
    loadClient: () => import("@games/holdem/client").then((m) => m.default),
  },
  "same-page": {
    section: "words",
    manifest: samePageManifest,
    rules: samePageRules,
    settingFields: samePageSettingFields,
    loadClient: () => import("@games/same-page/client").then((m) => m.default),
  },
  ...(BLIND_RALLY && {
    "blind-rally": {
      section: "racing",
      manifest: blindRallyManifest,
      rules: blindRallyRules,
      settingFields: blindRallySettingFields,
      loadClient: () => import("@games/blind-rally/client").then((m) => m.default),
    },
    rally: {
      section: "racing",
      manifest: rallyManifest,
      rules: rallyRules,
      settingFields: rallySettingFields,
      loadClient: () => import("@games/blind-rally/client").then((m) => m.rally),
    },
  }),
};
