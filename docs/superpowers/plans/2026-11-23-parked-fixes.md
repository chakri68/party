# Parked UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the items parked during the 2026-11-23 UI/UX fixes: one timer look across games, the lobby bar's real height, a Blind Rally Nightmare warning, and a shorter CouchParty games list on phones.

**Architecture:** A small `countdown` helper in `packages/ui` gives every game the same timer pill and the same number format; games keep their own deadline logic and only swap the element. The lobby bar measures itself with a ResizeObserver. Blind Rally uses the existing `SettingField.warn`. The CouchParty list change is product-only, on the `product` branch.

**Tech Stack:** TypeScript, plain DOM (`h()` from `@games/ui`), CSS, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-23-ux-fixes-design.md` (the "Timers shown six ways: parked" line) and `docs/superpowers/reviews/2026-11-23-ui-ux-review.md` (Medium: "Timers shown 6 different ways"; "Games list starts on the ~5th phone screen").

## Global Constraints

- UI only: "functionally nothing should change only the UI". Deadlines, timeouts and server rules stay as they are.
- Copy: short plain sentences, basic words, no idioms. No emoji; icons are SVG.
- Phone portrait 360x780 first, landscape 780x360 where a game is played sideways, then desktop 1280x800. Tap targets 40 px+.
- Shared code lands on master; CouchParty files (`apps/product-*`) only on the `product` branch.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01KwNUn8AHWzbftW559ZRTih`.

## Calls made (Claude's)

- **One timer look:** a pill with a small clock icon and the time. Under 60 s it reads `45 s`; from 60 s it reads `1:05`. It turns to the warning colour at 10 s or less. It shows `Paused` while the room is paused. It sits in the game's top row where each game's timer already is.
- **Bars stay:** where a game also has a draining bar (Cheat's call window, Scribbl's drawing bar), the bar stays; only the number beside it uses the shared format.
- **Screen readers:** `role="timer"`, `aria-live="off"`; the pill's `aria-label` is "Time left: 45 seconds" style, updated at most once per 10 s, so readers are not flooded.

## Review Focus

1. A deadline of 0, null or in the past: the pill is hidden (no "0 s" left on screen after a phase ends). Test in Task 1.
2. Paused rooms: the pill says "Paused" and does not count down (games that read `pausedAt`). Test in Task 1.
3. A view that stops: no interval keeps running after the game view is gone (each game already owns its tick; the helper owns no timer). Test in Task 1 (the helper has no setInterval).
4. Lobby bar that changes height (a long warning line wraps, or the button label changes): toasts and the page's bottom padding follow. Test in Task 2.
5. CouchParty with JS off: the full list still shows. Test in Task 4.

---

### Task 1: The shared countdown and every game on it

**Files:**
- Create: `packages/ui/src/countdown.ts`, `packages/ui/test/countdown.test.ts`
- Modify: `packages/ui/src/index.ts` (export), the shared timer CSS (where the shell's base styles live, `apps/web/src/style.css`)
- Modify: each game client that shows a countdown number. Survey with `grep -rln "deadline\|secondsLeft\|countdown" games/*/client`. Known: face-off, nightfall, scribbl, heist, same-page, overheat, cheat, chain-words, bluff, dominion, dont-say-it, oh-hell, imposter, long-trail, holdem, pass-the-bomb, treasure-hunt, short-night, wilds, thorns, blind-rally. A game whose timer is part of a game picture (a 3D scene, a bomb fuse) keeps its picture; if it also prints seconds, the text uses `formatSeconds`.

**Interfaces:**
- Produces:
  - `formatSeconds(ms: number): string`: `Math.ceil(ms / 1000)` seconds; under 60 gives `"45 s"`, else `"m:ss"`. Negative gives `"0 s"`.
  - `countdown(): Countdown` where `interface Countdown { el: HTMLElement; set(left: number | null, opts?: { paused?: boolean; lowAt?: number }): void }`. `left` is ms left; `null` or `<= 0` without `paused` hides the pill. `lowAt` defaults to 10 000 ms and toggles class `low`. The pill is `span.countdown` with an SVG clock icon (aria-hidden) and a text span.

- [ ] **Step 1: Write the failing tests** in `countdown.test.ts`: `formatSeconds(45_000) === "45 s"`, `formatSeconds(44_001) === "45 s"`, `formatSeconds(65_000) === "1:05"`, `formatSeconds(-5) === "0 s"`; `set(null)` hides; `set(0)` hides; `set(5_000)` shows "5 s" with class `low`; `set(30_000)` no `low`; `set(30_000, { paused: true })` shows "Paused"; `aria-label` reads "Time left: 30 seconds" and does not change between `set(29_500)` and `set(25_000)` but does at `set(19_000)`; the module source contains no `setInterval`.
- [ ] **Step 2: Run and check it fails.** `pnpm vitest run packages/ui/test/countdown.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `countdown.ts`** and the `.countdown` styles (pill, icon 14 px, tabular numbers, `.low` in the existing warning colour, `[hidden]` hides).
- [ ] **Step 4: Run and check it passes.**
- [ ] **Step 5: Move every game's countdown onto it.** Replace each game's own timer span and number formatting with `countdown()` and `set(...)`, keeping its tick and deadline maths. Remove the old per-game timer CSS that the pill replaces. Update any game test that reads the old text. Update `docs/games/*.md` only where they quote the old format.
- [ ] **Step 6: Check by eye** at 360x780 in at least Nightfall, Scribbl, Face-Off, Same Page and Cheat (local `wrangler dev`, headless Chrome), and paused Nightfall shows "Paused".
- [ ] **Step 7: Run `pnpm typecheck` and `pnpm vitest run`.** Expected: PASS (the treasure-hunt caches timing test can flake under load; re-run it alone).
- [ ] **Step 8: Commit** "Games: one timer look".

### Task 2: The lobby bar measures itself

**Files:**
- Modify: `apps/web/src/views/lobby.ts` or `room.ts` (where `.lobby-actions` mounts), `apps/web/src/style.css:424-436`
- Test: `apps/web/test/lobby.test.ts` (or the lobby test file that exists)

**Interfaces:**
- Produces: `watchBarHeight(bar: HTMLElement, root: HTMLElement): () => void` in `apps/web/src/views/lobby.ts`: sets `--lobby-bar` on `root` to the bar's `offsetHeight` px now and on every resize (ResizeObserver); returns a stop function that disconnects and removes the property. With no `ResizeObserver` it sets the value once.

- [ ] **Step 1: Failing tests:** with a fake ResizeObserver, `watchBarHeight` sets `--lobby-bar: 64px` at once, `90px` after the fake fires with a taller bar, and the stop function disconnects and removes the property; with `ResizeObserver` undefined it sets the value once and does not throw.
- [ ] **Step 2: Run and check it fails.**
- [ ] **Step 3: Implement**, call it where the bar mounts and stop it when the lobby leaves. Replace fixed padding under the bar with `var(--lobby-bar)` (keep `70px` as the fallback).
- [ ] **Step 4: Run tests, `pnpm typecheck`.** Check by eye at 360x780 with a settings warning showing.
- [ ] **Step 5: Commit** "Lobby: the bar measures itself".

### Task 3: Blind Rally Nightmare warning

**Files:**
- Modify: `games/blind-rally/shared/` (where its settings fields are built; see other games' `warn` use, e.g. `grep -rn "warn:" games/*/shared`), `docs/games/blind-rally.md`
- Test: `games/blind-rally/test/` (settings test)

- [ ] **Step 1: Failing test:** the assists-preset field's `warn` returns "Very hard. No map help for the Driver or the Navigator." when the preset is `nightmare`, and nothing for the others. (Read `rules-text.ts:49` first; if the Navigator still gets a map, say "Very hard. Every help is off." instead, and use that text in the test.)
- [ ] **Step 2: Run and check it fails.**
- [ ] **Step 3: Implement** with the existing `SettingField.warn` shape.
- [ ] **Step 4: Run tests and typecheck.** Add the line to `docs/games/blind-rally.md` under settings.
- [ ] **Step 5: Commit** "Blind Rally: warn on Nightmare".

### Task 4: CouchParty games list on phones (product branch)

Runs in a worktree of `product`, after Tasks 1 to 3 are merged to master and master is merged into product.

**Files:**
- Modify: `apps/product-web/src/gallery.ts`, `apps/product-web/src/site.css`, `apps/product-web/index.html` (the games section)
- Test: `apps/product-web/test/gallery.test.ts`

**Calls made (Claude's):** under 600 px the list shows the first 8 games, then a "Show all N games" button that reveals the rest in place (no new page). Order stays as it is. Desktop is unchanged. With JS off, all games show (the hiding is added by script). The hero's "See all N games" link still jumps to the list and opens it fully.

- [ ] **Step 1: Failing tests:** `galleryHtml` output keeps every game; a new `collapseList(list: HTMLElement, first: number): void` marks items after `first` hidden and adds a button whose text is "Show all N games"; clicking it un-hides all and removes the button; the button has `aria-expanded="false"` then `"true"` before removal; an `#games` hash on load opens the full list.
- [ ] **Step 2: Run and check it fails.** `pnpm vitest run apps/product-web`.
- [ ] **Step 3: Implement** with `matchMedia("(max-width: 599px)")`; do nothing on wider screens.
- [ ] **Step 4: Run `pnpm typecheck` and `pnpm vitest run apps/product-web apps/product-server`.** Check by eye at 360x780 and 1280x800.
- [ ] **Step 5: Commit** "CouchParty: shorter games list on phones".
