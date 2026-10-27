# Social deduction: gap analysis and roadmap

Source: `social-deduction-spec.md` (repo root, untracked). This doc checks it against the repo, rules on what changes, and splits the work into parts. Each game part gets its own design doc from its implementer, same as the word games (`2026-10-27-word-games-shared-kit-design.md`).

## What the repo already covers

The spec was written against a generic PartyKit stack. Most of its §3 and §13 is already here, under other names:

| Spec asks for | Repo has |
| --- | --- |
| PartyKit room service, server-owned state | Cloudflare Durable Object rooms, `apps/server/src/runtime.ts` |
| `GameDefinition` with `reduce`/`publicView`/`privateView`/`winner` | `GameDefinition` in `packages/game-core`: `handleAction`, `getPublicState`, `getPrivateState`, `getResult` |
| Strict public/private selectors | Same. Every game already ships secrecy tests; the runtime never broadcasts raw state |
| Absolute deadlines, idempotent timeouts | `TimerRequest` by id (setting an id replaces it), deadlines checked against `ctx.now` |
| Secure seeded shuffles | `ctx.randomInt` (secure in prod), `?seed=` debug |
| Ballots with eligibility + thresholds | `Ballot`, `openBallot`, `castVote`, `dropVoter`, `tally`, `strictMajority` in game-core |
| Reconnect tokens, grace, host migration | Runtime seats, `GRACE_MS` (60 s), `ensureHost` |
| Rematch with fresh shuffle | `carryOver` hands on only what a game chooses (teams, used content) |
| Lobby presets, settings | `SettingField[]` select rows, `parseSettings`, merged patches |
| Late join / spectators | `manifest.lateJoin` + `onPlayerJoined` |
| Schema validation, escaped names, rate limits | Protocol parsing, `cleanChatText`, existing name rules |

## Gaps the kit has to fill

1. **Setup that depends on the head count.** Decks must be exactly N or N+3 cards, wolf counts scale with N. Today the runtime only checks `minPlayers`/`maxPlayers`, and `parseSettings` doesn't know N. Add an optional `setupProblem(settings, playerCount): string | null` to `GameDefinition`. The runtime refuses `start` with that message; the lobby shows it under the settings (the client registry already gets `players` in `settingFields`). "Needs review on player change" falls out of it: the problem reappears the moment N changes.
2. **Role reveal screen.** Tap to reveal, hides on `visibilitychange`/blur, "Tap to reveal" on return. One client helper in a shared package, used by all four games.
3. **Role decks as settings.** A helper that turns a preset list plus per-role counts into `SettingField` rows (Beginner / Standard / Custom, then one count row per role when Custom) and a validator. Count rows are just selects; no new lobby widget.
4. **Secrecy harness.** A test helper that plays a scripted game and asserts a secret string never appears in public state, public events, or another seat's private state until a named phase. Each game wrote this by hand last time.
5. **Threshold vote.** `tally`/`strictMajority` cover most ballots; add `atLeast(b, choice, num, den)` for two-thirds style rules if a game needs one.

Package: `packages/hidden-roles` (client-safe: reveal helper, deck settings, validator) plus test helper in game-core's test utils. Server-only content stays in each game's `server/`, as with words.

## Rulings

- **Commercial games stay out.** The spec names One Night Ultimate Werewolf, Spyfall and The Resistance. Same policy as Taboo → Don't Say It and Anomia → Face-Off: keep the genre, ship our own mechanics and names, and leave out each game's fingerprints. Folk Werewolf/Mafia is public domain and ships close to the spec.
- **Spyfall-inspired mode becomes an Imposter mode, not a new game.** Imposter is already "everyone shares a secret but one". Add a `spoken` mode: the secret is a *place* from an original pack (30+), there are no typed clues, the table talks for a timer, and the Imposter can stop the clock once to guess the place from the public list. Then Imposter's existing vote, runoff and caught-guess flow. Spyfall's occupation tags and its anytime unanimous-accusation mechanic are left out. Costs: plays more like Imposter than Spyfall.
- **One Night becomes "Short Night".** One night, one discussion, one vote, all on the spec's timers and tie rules (§4.3). Left out: the N+3 center cards and card swapping (Robber, Troublemaker, Insomniac), which are that game's signature. Instead: wolves know each other, and every other role is a one-shot information role with original powers (implementer designs 5–7 of them, each resolving from a fixed night order with no state that later actions rewrite). Village wins if a wolf is voted out; wolves win otherwise; a no-wolf deal is allowed only as an explicit setting. Costs: less chaotic than the source.
- **Resistance-style becomes "Heist".** Hidden saboteurs on crews, leader proposes, table approves, crew plays secret cards, aggregate result only. Left out: The Resistance's exact player/squad table, the five-rejection auto-loss and the two-fail fourth mission. Our own twist: each saboteur holds a limited sabotage budget for the whole game, and rejected proposals raise a shared "heat" track that hands the saboteurs the job when it maxes out. Crew sizes and saboteur counts are derived and tested, not copied. Costs: balance needs real playtests.
- **Classic Werewolf ships as "Nightfall".** Villager, Wolf, Seer, Guardian; the spec's §5 cycle, tie rules, win checks and abandonment rules as written. Eliminated players watch and keep the room chat (honour system, as the spec says).
- **No chaos modifiers.** Spec §9 says post-MVP. No `ModifierDefinition` stub either: nothing would call it (YAGNI).
- **Grace stays 60 s,** shell-wide, not the spec's 30 s.
- **Room chat stays.** The spec assumes voice-only; the shell's chat is site-wide and helps remote tables. Games don't touch it.
- **Deferred:** public shared-screen route, sounds/TTS, a first-time tutorial beyond the lobby rules text, locale packs.

## Roadmap

Same execution model as the word games: one opus implementer per part (design doc, plan, TDD build), a sonnet reviewer, browser QA by subagent, fix rounds, then one whole-branch review.

1. **Kit**: `setupProblem` hook (runtime + lobby), `packages/hidden-roles` (reveal helper, deck settings + validator), secrecy harness, `atLeast` if needed. Retrofit nothing that already works.
2. **Imposter `spoken` mode**: places pack, early guess. Smallest game change, proves nothing in the kit is needed for it.
3. **Short Night**: first real user of the deck settings and reveal helper.
4. **Heist**.
5. **Nightfall**: multi-round, eliminations, abandonment. Last because it's the biggest state machine.

Each part ships playable and tested before the next starts.
