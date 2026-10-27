# Social Deduction Kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the four social deduction parts what the repo lacks: head-count-dependent setup checks, role decks as lobby settings, a conceal-on-blur role reveal, and a reusable secrecy test harness.

**Architecture:** One optional hook on `GameDefinition` (`setupProblem`) that the runtime enforces at start and publishes in the lobby state. A new client-safe package `packages/hidden-roles` with pure deck logic and a thin reveal widget. A `testing` subpath in game-core for the leak harness.

**Tech Stack:** TypeScript 6, vitest, pnpm workspaces, Cloudflare Worker runtime (`apps/server`), vanilla DOM client (`apps/web`, `h()` helper).

**Spec:** `docs/superpowers/specs/2026-10-28-social-deduction-design.md` (section "Gaps the kit has to fill", items 1–4; item 5 `atLeast` is dropped: no planned game needs it).

## Global Constraints

- Commit straight to master; never push; stage only your own paths, never `git add -A` (untracked root `*.md` specs must stay untracked).
- Commit title `<Area>: <what>`, dry mechanistic body, last lines: blank line then `Claude-Session: https://claude.ai/code/session_01KwNUnArs756peQLwwY8XrV`.
- `packages/hidden-roles` must be client-safe: no imports from any `server/`, no Node APIs.
- Settings stay flat objects: the room shallow-merges `update-settings` patches (`apps/server/src/runtime.ts`, `update-settings`), so a nested object in a patch would resend stale siblings. Per-role counts are top-level keys.
- Existing games must behave identically: `setupProblem` is optional and absent means "no problem".
- Verify with `pnpm vitest run --testTimeout=60000` and `pnpm typecheck`.

## Review Focus

1. Player count changes after the host built a valid custom deck (someone joins or leaves the lobby): the lobby must show the problem and Start must refuse, without the host touching settings. Test in Task 1 (runtime) and Task 2 (`deckProblem` with a new N).
2. "Play again" from results with a different head count: the same refusal as Start. Task 1 test.
3. Custom count edits arriving back to back (two roles changed quickly): both survive. Task 2 test that each count patch only names its own key.
4. A tab backgrounded with the role showing: on return the role is concealed until tapped again. Task 3 test on the reveal state machine.
5. A secret that appears in an event (not state) for the wrong seat: the harness must catch it. Task 4 test.

---

### Task 1: `setupProblem` hook

**Files:**
- Modify: `packages/game-core/src/index.ts` (`GameDefinition`)
- Modify: `packages/protocol/src/index.ts` (`RoomPublicState`)
- Modify: `apps/server/src/runtime.ts` (start path ~:595-640, public state ~:830-846)
- Modify: `apps/web/src/views/room.ts` (lobby Start ~:563, results Play again ~:719, settings block ~:644)
- Test: `apps/server/test/` (new `setup-problem.test.ts`, following the existing runtime test harness there)

**Interfaces:**
- Produces: `GameDefinition.setupProblem?(settings: TSettings, playerCount: number): string | null`. Message is shown verbatim to players, e.g. `"Need exactly 8 role cards"`.
- Produces: `RoomPublicState.setupProblem: string | null`, computed from the selected game's parsed settings and the count of seats that would be dealt in (same set `start-game` uses: connected seats).

- [ ] **Step 1: Write failing runtime tests** using a stub game registered in the test whose `setupProblem` returns `n === 3 ? null : "Need exactly 3"`:
  - `start-game` with 4 connected → error code `"bad-setup"`, message `"Need exactly 3"`, room stays in lobby.
  - lobby public state with 4 seats has `setupProblem: "Need exactly 3"`; after one leaves, `null`.
  - a game without the hook → `setupProblem: null`, starts as before.
  - from `results`, `start-game` (Play again) with a changed count → same `"bad-setup"` refusal.
- [ ] **Step 2: Run** `pnpm vitest run apps/server` → new tests FAIL.
- [ ] **Step 3: Implement.** Check right after the min/max player check in the start path; compute the public field next to `canStart`. Lobby: render the problem under the game settings (class `setting-problem`, readable contrast, `role="status"`) and disable both Start and Play again while it's non-null, with the button text unchanged.
- [ ] **Step 4: Run** `pnpm vitest run apps packages` and `pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** `Shell: a game can refuse a setup that doesn't fit the table`.

### Task 2: Role decks as settings (`packages/hidden-roles`)

**Files:**
- Create: `packages/hidden-roles/package.json` (`@games/hidden-roles`, exports `"."`), `tsconfig.json` (copy `packages/words`), `src/index.ts`, `src/deck.ts`
- Test: `packages/hidden-roles/test/deck.test.ts`
- Run `pnpm install` after creating the package.

**Interfaces:**
- Produces, from `@games/hidden-roles`:
  ```ts
  interface RoleSpec { id: string; label: string; team: string; max: number }   // max 1 = unique
  type Deck = Record<string, number>;                                            // roleId -> count
  interface Preset { id: string; label: string; deck(players: number): Deck }
  interface DeckRules { size(players: number): number; requireTeams: string[] }
  interface DeckSettings { preset: string; [countKey: `n:${string}`]: number }   // flat
  function countKey(roleId: string): `n:${string}`;
  function parseDeckSettings(input: unknown, roles: RoleSpec[], presets: Preset[]): DeckSettings | null;
  function deckFor(settings: DeckSettings, roles: RoleSpec[], presets: Preset[], players: number): Deck;
  function deckProblem(deck: Deck, roles: RoleSpec[], rules: DeckRules, players: number): string | null;
  function deckSettingFields(settings: DeckSettings, roles: RoleSpec[], presets: Preset[], rules: DeckRules, players: number): SettingField[];
  ```
  `preset: "custom"` means use the `n:*` counts; any other value is a preset id and the counts are ignored. Presets compute their deck from the head count, so they're always valid for supported counts.

- [ ] **Step 1: Write failing tests:**
  - `deckProblem` messages, verbatim: wrong size → `"Need exactly 8 role cards (have 7)"`; a role over `max` with `max 1` → `"Seer is unique"`, with `max > 1` → `"At most 3 Werewolf"`; a required team with zero cards → `"Needs at least one Werewolf team card"` (team label = label of the first role on that team); valid → `null`.
  - Every preset in a fixture role set yields `deckProblem === null` for every N in 3..12.
  - Custom deck valid at N=5 becomes `"Need exactly 8 role cards (have 7)"` at N=6 with rules `size = n + 2` (Review Focus 1).
  - `deckSettingFields` with a preset selected: one row (`key: "preset"`, options = presets + `Custom`), hint lists the deck, e.g. `"2 Werewolf, 1 Seer, 3 Villager"`. With `custom`: preset row plus one row per role, `options` 0..max, each option's `patch` is exactly `{ "n:<roleId>": k }` (Review Focus 3), and the preset row's hint is the `deckProblem` message or the deck list.
  - Switching to Custom carries the current preset's deck: the `Custom` option's patch sets `preset: "custom"` and every `n:*` key to the preset's counts at this N.
  - `parseDeckSettings` drops unknown keys, rejects negative/non-integer counts and unknown presets (returns `null`), fills missing counts with 0.
- [ ] **Step 2: Run** `pnpm vitest run packages/hidden-roles` → FAIL.
- [ ] **Step 3: Implement** in `src/deck.ts`, re-export from `src/index.ts`. `SettingField` comes from `@games/game-core` (type-only import).
- [ ] **Step 4: Run** tests and `pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** `Hidden roles: decks as flat lobby settings, with a validator`.

### Task 3: Role reveal widget

**Files:**
- Create: `packages/hidden-roles/src/reveal.ts`; export from `src/index.ts`
- Create: `packages/hidden-roles/src/reveal.css` (imported by consumers' views; use existing CSS custom properties from `apps/web/src/style.css`)
- Test: `packages/hidden-roles/test/reveal.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type RevealState = "hidden" | "shown";
  function nextRevealState(state: RevealState, event: "tap" | "background"): RevealState; // tap toggles; background -> hidden
  function roleReveal(opts: { title: string; body: Node | string; warning?: string }): { el: HTMLElement; update(body: Node | string): void; destroy(): void };
  ```
  `roleReveal` renders a card showing `"Tap to reveal"` (and `warning`, default `"Check nobody's looking"`), toggles on click/Enter/Space via `nextRevealState`, and listens for `visibilitychange` (hidden) and window `blur` to send `background`. Hidden means the body is not in the DOM, not just invisible. 44px+ target, respects `prefers-reduced-motion`.

- [ ] **Step 1: Write failing tests** for `nextRevealState`: hidden+tap→shown, shown+tap→hidden, shown+background→hidden, hidden+background→hidden (Review Focus 4). The repo has no DOM test environment; the widget is the thin shell over this and gets checked in browser QA of the first game that uses it.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** tests + `pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** `Hidden roles: a role card that hides itself when the tab does`.

### Task 4: Secrecy harness (`@games/game-core/testing`)

**Files:**
- Create: `packages/game-core/src/testing.ts`; add `"./testing": "./src/testing.ts"` to `packages/game-core/package.json` exports
- Test: `packages/game-core/test/testing.test.ts`

**Interfaces:**
- Produces:
  ```ts
  function findLeaks<S>(opts: {
    def: Pick<AnyGameDefinition, "getPublicState" | "getPrivateState">;
    state: S;
    events?: GameEventEnvelope<unknown>[];
    players: string[];
    secret: string;          // matched case-insensitively in JSON.stringify output
    allowed: string[];       // seats entitled to see it
  }): string[];              // e.g. ["public state", "private state of p2", "public event #0", "private event #1 to p2"]
  ```
  Must not import vitest (it's imported by game tests, which bring their own `expect`).

- [ ] **Step 1: Write failing tests** with a toy definition: secret only in p1's private state, `allowed: ["p1"]` → `[]`; secret in public state → `["public state"]`; secret in p2's private state → `["private state of p2"]`; a public event carrying it → `["public event #0"]`; a private event to p2 carrying it → `["private event #0 to p2"]`, and to p1 → not reported (Review Focus 5); case-insensitive match.
- [ ] **Step 2: Run** `pnpm vitest run packages/game-core` → FAIL. **Step 3: Implement.** **Step 4: Run** + `pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** `Game core: findLeaks, one secrecy check for every hidden-role game`.
