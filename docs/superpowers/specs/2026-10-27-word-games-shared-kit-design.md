# Word games, part 1: the shared kit

Source: `party-word-games-spec.md`, checked against the repo on 2026-10-27.

## Why this exists

Seven word/bluff/social games are coming (`party-word-games-spec.md`). Four of them need a dictionary, four need a ballot, and three need to tidy free text. Two of those three things already exist, just locked inside one game each. This part pulls them out so the games after it import instead of copying.

No new game ships here. The only visible change is "nothing broke".

## What the source spec gets wrong about this repo

The source spec assumes a fresh PartyKit stack. The repo already has the equivalent, and new games plug into it as-is:

| Source spec | Here, and staying |
| --- | --- |
| PartyKit rooms, `WireMessage`, `room.*` events (§2, §13) | Worker + one Durable Object per room (`apps/server/src/runtime.ts`), `packages/protocol` |
| Pure reducer `(state, action, now, rng)` | `GameDefinition` in `packages/game-core`, `ctx.now` / `ctx.randomInt`, `TimerRequest` |
| Per-player secrets | `getPrivateState`, private-visibility events |
| Host migration, reconnect, grace, rate limits, rematch | runtime: `hostId`, `resumeToken`, `GRACE_MS`, `allow()`, `carryOver` |
| Host config form | `SettingField[]` |
| `src/party/...` layout (§14) | `games/<name>/{shared,server,client,test}`, registered in `apps/server/src/games.ts` and `apps/web/src/games.ts` |

So source §15 Milestone 0 is mostly done, and §13/§14 are dropped.

## Roadmap (one spec → plan → build cycle each)

1. **Shared kit** (this doc)
2. **Chain Words**: smallest game; first real user of `@games/words`
3. **Imposter**: private roles, clues, accusation ballot, last guess
4. **Bluff pair**: Fake Word + Bluff Definitions, one package with two manifests (the Blind Rally / Rally pattern). Blocked on a licensed definitions dataset (WordNet or Wiktionary, CC BY-SA), so research starts early
5. **Pass the Bomb upgrade**: the four mode toggles and the community veto, on the existing game. Where the shipped game deliberately differs from source §4 (new cluster every pass, fuse 6–45 s, lives 1/2/3), that gets decided in its own spec, not here
6. **Team describing game** (source "Taboo"): needs generic teams. Blind Rally's are driver/navigator-shaped, so that's built there
7. **Reflex duel game** (source "Anomia")

Parts 6 and 7 get original names, cards and a mechanic twist of their own. Both source titles are commercial games, and the source spec asks for rebranding anyway.

## Design

Three moves and one small addition. Every one of them reuses code that's already here.

### 1. `packages/words` (`@games/words`), from Pass the Bomb and Scribbl

Two entry points, because the dictionary is ~220 KB and the client has no business carrying it:

- `@games/words` (`src/index.ts`): client-safe. `editDistance` and `isClose`, moved verbatim from `games/scribbl/shared/rules.ts`. Fake Word needs "too close to the real word" and Bluff Definitions needs "too close to the real definition", and Scribbl already solved it.
- `@games/words/dictionary` (`src/dictionary.ts`): server only.
  - `PACKED` and `WORD_COUNT`: the generated file, moved from `games/pass-the-bomb/server/dictionary.ts`.
  - `unpack`: moved from `games/pass-the-bomb/server/words.ts`.
  - `isWord(word)`: same lazy `Set`, same behaviour.
  - `allWords()`: new. The unpacked, sorted array, cached. Bomb's cluster test and its game test already call `unpack(PACKED)` themselves. Chain Words' rescue rule and the Bomb's solvability checks need the same list, so it gets unpacked once.
- `scripts/build-dictionary.mjs`: moved from `games/pass-the-bomb/scripts/`. Only the output path changes. The generated header gains a provenance line: SCOWL via Debian `wamerican`, permissive licence, see `/usr/share/doc/wamerican/copyright`. That covers source §11's "track provenance".

Callers after the move:

- `games/pass-the-bomb/server/words.ts` keeps `CLUSTERS` and `MIN_MATCHES`, and imports `isWord` from `@games/words/dictionary`.
- `games/scribbl/shared/rules.ts` drops `editDistance` and `isClose`. `scribbl/server/game.ts` imports them from `@games/words`.
- The dictionary and edit-distance tests move to `packages/words/test/`. The cluster tests stay with the Bomb and use `allWords()`.
- Both games add `"@games/words": "workspace:*"`.

**Guard:** a test in `packages/words/test/` scans `games/*/client/**` and `games/*/shared/**` for `@games/words/dictionary` and fails on any hit. Today that rule is a comment in the generated file's header. Once five games import from the package, a comment won't stop anyone.

### 2. Ballot helpers in `@games/game-core`, from Blind Rally

They live next to `shuffle` and `seededRandomInt`. They're runtime-agnostic and state-shaped, and a separate package for ~60 lines would be ceremony.

```ts
/** JSON-safe, so it lives in game state as-is. Eligibility is fixed when it opens (source §11). */
export interface Ballot<C extends string = string> {
  eligible: string[];
  votes: Record<string, C>;
}

export function openBallot<C extends string>(eligible: readonly string[]): Ballot<C>;
/** Null on success. Re-voting overwrites: still one vote each. */
export function castVote<C extends string>(b: Ballot<C>, voterId: string, choice: C, allowed: readonly C[]): GameError | null;
/** Someone left mid-vote: they stop counting, either way. */
export function dropVoter(b: Ballot, voterId: string): void;
export function allVoted(b: Ballot): boolean;
/** More than half of everyone eligible, not of those who bothered (the Bomb veto rule). */
export function strictMajority<C extends string>(b: Ballot<C>, choice: C): boolean;
/**
 * Most votes wins. A tie is settled by stableHash(seedKey + leaders) and reported in `tied`,
 * so a game can run a runoff instead (Imposter does). `order` fixes iteration so the hash
 * sees the same list whoever voted first. No votes: winner null.
 */
export function tally<C extends string>(b: Ballot<C>, order: readonly C[], seedKey: string): { winner: C | null; tied: C[]; counts: Record<C, number> };
/** FNV-1a, 32-bit. Moved from Blind Rally's ballot.ts. */
export function stableHash(text: string): number;
```

Error codes are `not-eligible` and `bad-choice`. Self-votes and own-entry votes are left out by the caller, which passes an `allowed` list without them: what counts as "yours" is different in every game (source §11's table).

Blind Rally's `ballot.ts` imports `stableHash` and deletes its own `hash`. Its votes are per team, keyed by `teamId`, so moving it to `Ballot` would reshape saved state for no gain. It keeps its own `tally`.

### 3. Free text, from `@games/protocol`

Clues (40 chars) and fake definitions (180 chars) reuse `cleanChatText`, which already does one line, no control characters, and a code-point-safe cap. The addition is an optional `max = CHAT_MAX_LENGTH` parameter. Room chat keeps calling it the old way.

## Not in this part

- Teams: part 6.
- Spectator roles: per game, through `lateJoin`/`onPlayerJoined` (the Blind Rally pattern).
- Content packs and validation scripts: each game brings its own with its first content.
- Profanity filtering: comes with the first game that shows other people's free text (part 3).

## Testing and done-ness

- `packages/words/test`: unpack, `isWord`, `allWords` (sorted, matches `WORD_COUNT`), `editDistance`/`isClose` (Scribbl's cases, moved), and the import guard.
- `packages/game-core/test/ballot.test.ts`: eligibility rejection, bad choice, re-vote overwrites, `dropVoter`, `strictMajority` with abstainers, tally winner, tie reported and stable across vote order, empty ballot.
- `pnpm test` and `pnpm typecheck` green. Every Bomb, Scribbl and Blind Rally assertion is still there, moved rather than dropped.
- `pnpm build`, then grep `apps/web/dist` for a long substring of `PACKED`: no hits. This is a check run once, not a test.
- One local `pnpm dev` game each of Pass the Bomb and Scribbl.
