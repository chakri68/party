# Pass the Bomb: modes and the room vote

Part 5 of the word-games roadmap (`2026-10-27-word-games-shared-kit-design.md`). Source: `party-word-games-spec.md` §4.2–4.3 and §11, plus the controller's rulings in `.superpowers/sdd/games/bomb-upgrade-brief.md`. An upgrade to `games/pass-the-bomb`, not a new package. With every new setting at its default the game plays exactly as it shipped, apart from the room vote on unknown words (default `vote`).

## What changes

Four mode toggles, each a host setting, any combination allowed if it's solvable:

| Setting | On means | Bomb shows |
| --- | --- | --- |
| `ending` | the letters must END the word | `END` badge |
| `reverse` | the bomb shows the letters backwards: `GNI` means ING | `BACKWARDS` badge, letters reversed |
| `length` | 5 to 10 letters, inclusive | `5–10` badge |
| `category` | the word must be on a curated list: animals, food, body, home, nature, jobs | the category, on the bomb |

And one setting for words the game doesn't know, `unknown`:

- `strict`: rejected, as before.
- `vote` (default): the room decides, in 4 seconds.
- `allow`: accepted.

"Unknown" means it fits every shape rule but isn't in the dictionary (or, in category mode, isn't on the category's list).

## Prompts

A prompt is a cluster, plus a category in category mode. Every pass deals a new one, as before.

- Without category: the clusters are `CLUSTERS` (or a test deck), each kept only if at least 8 dictionary words fit it under the enabled `ending`/`length` rules.
- With category: per category, every 2- and 3-letter run found in its words is a candidate, kept if at least 8 of the category's words fit it. A category with no viable run under the current modes is never dealt.
- `reverse` changes only what's shown, so it never affects solvability.

The viable list per (deck, ending, length, category) is built on first use and cached for the life of the isolate, with each prompt's answers attached.

Dealing: a category first (uniformly, among those with a prompt that has 8+ unused answers), then a cluster within it, never the same prompt as the one just played when there's a choice. Without category it's one stage. If no prompt has 8 unused answers left, the one with the most unused answers is dealt; if every answer is used, any viable prompt (see Rulings).

`reverse` lives in one strategy function, `effectiveCluster(display, modes)` in `shared/rules.ts`. Server state keeps the effective cluster (what the word needs); public state carries the displayed one, made by `displayCluster`, which for reversal is the same function (reversal is its own inverse). Changing what REVERSE means is a change to those two.

Solvability on the host's side: `shared/viable.ts` holds a generated table, prompts and distinct answers per (ending, length, category), so the lobby can show it without the dictionary. A test recomputes it from `allWords()` and the category lists and fails if they drift. `parseSettings` returns null for a combination with zero prompts (the room answers "Those settings aren't valid."); the setting field marks the option `(too few words)`. Today every combination has prompts; the thinnest (category + ending + length) gets a "thin" hint. `createGame` throws if it ever gets a combination with none.

## Validation order

`handleAction` for `{ type: "word" }`:

1. Finished, out, not live (`not-live`, or `voting` during a vote), not holding.
2. `time-up` if `ctx.now >= fuseEndsAt`: the fuse has gone, the alarm just hasn't landed.
3. `shapeProblem(word, cluster, modes)`: letters only, 3+, 30 max, `length` 5–10, then the cluster: anywhere, or at the end. Shared, so the holder's screen shakes without a round trip. Objective: no vote can override it.
4. `used` this game. Then `rejected`: the room already voted it down this game.
5. Known (dictionary, or the category's list): accepted, the bomb passes.
6. Unknown: `strict` rejects; `allow` accepts; `vote` opens a vote, unless this hold has had 2 already (rejected), or nobody's eligible (accepted).

## The vote

Phase `vote`, between `live` and `live`:

- Opening: the fuse timer is cancelled and what's left of it (`fuseEndsAt - now`) goes into state. A `vote` timer is set for 4 s. The ballot is `openBallot` over every alive, connected player except the submitter, snapshotted. `holdVotes` goes up by one; it resets when the bomb changes hands.
- `{ type: "vote", ballot, choice }`, choices `reject` / `allow`, through `castVote`. Re-voting overwrites. Wrong ballot id, wrong phase or past the deadline are rejected.
- Closing: when everyone eligible has voted, when the outcome can't change any more (rejects already a strict majority, or too few left to make one), or when the timer fires. It's rejected only if `strictMajority(b, "reject")`.
- Allowed: the word goes into `used`, the bomb passes, the fuse is set again with what was left. Rejected: the word goes into `rejected`, the holder keeps it, the fuse resumes.
- During the vote, public state shows the word, who played it, the deadline, the voters and who has voted, never what they voted. On close, a `vote-closed` event and `lastVote` in public state carry every vote.
- Someone eligible disconnecting or leaving is `dropVoter`ed, and the close conditions are checked again. A ballot with nobody left allows.
- The submitter leaving: the vote is called off, the bomb passes, fuse resumed. The submitter disconnecting changes nothing.
- The game ending (everyone else left) cancels both timers.
- `onTimer` re-arms a `vote` or live `fuse` alarm that lands more than 500 ms early, and ignores a stale `fuse` during a vote.

## State

Server, added: `fuseEndsAt`, `fuseLeft` (ms frozen during a vote), `category` (the current one, or null), `holdVotes`, `voteSeq`, `vote` (`{ id, by, word, ballot, deadline }` or null), `lastVote`, `rejected`.

Public, added: `modes`, `category`, `unknown` (the setting), `vote` (`{ id, by, word, voters, voted, deadline, ms }`), `lastVote` (`{ id, by, word, allowed, votes }`). `cluster` in public state is now what the bomb shows. Neither the fuse length nor `fuseLeft` is ever public.

Private, added: `canVote`, `myVote`.

## Settings

`lives` 1/2/3 and `fuse` as before; `ending`, `reverse`, `length`, `category` booleans (default off); `unknown` `strict`/`vote`/`allow` (default `vote`).

## Client

- Lobby: seven fields via `passTheBombSettingFields`.
- Bomb: mode badges above it, the displayed letters on it, the category under them. The holder's status line says what's wanted, in the letters to type ("a word from ANIMALS with ER at the end (the bomb's backwards)").
- Typing highlights the effective cluster.
- Vote: a card over the table with the word, who played it, a 4 s bar off `serverNow()`, and "n of m voted". Voters get two big buttons, Allow and Reject; their pick stays highlighted. Everyone else gets "The room is deciding". The form hides while it's up. The tick stops: the fuse is frozen.
- After: a line under the table, "The room allowed GLORP, 2–1", with who voted what.

## Rulings

1. **A new cluster on every pass** stays (controller): better pacing than the spec's one-per-bomb, and one cluster doesn't get mined dry.
2. **Fuse presets and lives 1/2/3 stay** (controller). The spec's 10–20 s and 1/3/5 are not adopted.
3. **`unknown` defaults to `vote`** (controller): friends' rooms. The spec's "strict in public rooms" waits for public rooms.
4. **`length` is a toggle for 5–10**, not a configurable min/max. One setting, one meaning.
5. **Category changes on every pass**, with the cluster. Per-round categories ran dry fast in thin combinations, and every pass being a fresh prompt is the game's rhythm already.
6. **Category mode draws clusters from the category's own 2–3 letter runs**, not from `CLUSTERS`. Eighty-odd animals can't put 8 words under TR, so the shared list would leave category mode near empty. Single letters are not used: the category is the hard part, but "has an A" is no part at all.
7. **In category mode, "known" means on the list**, and a dictionary word that isn't (a platypus in "food") is unknown: the vote handles it, per spec §4.3's "category unknown membership".
8. **Running dry mid-game**: if no prompt has 8 unused answers, deal the one with the most; if none has any, deal any viable prompt. The game doesn't stall: fuses still blow, and unknown words can still be voted in. Only thin combinations in long games get there.
9. **A word the room rejected stays rejected for the game, for that category.** Otherwise the next holder can force the same vote again. It's keyed `category:word` in category mode and only checked for words that are unknown under the current prompt: ARM voted down as an animal still counts in a body round (review fix). It isn't in `used`, per spec, so it doesn't count as played.
10. **The vote closes early** when everyone has voted or the outcome is settled. Four seconds of waiting for a foregone result is just waiting.
11. **Late words lose**: a word with `ctx.now >= fuseEndsAt` is `time-up`, even if the alarm hasn't fired (spec §4.4). Votes past their deadline likewise.
12. **A resumed fuse keeps its remainder, floored at 1 ms**: a vote opened in the last moment resumes into a bang, as it would have without the vote.
13. **The vote is in public state as a phase, `vote`**, not a flag on `live`. The tick, the typing stream and the host's skip all key off `live`, and all three should stop while the room decides. `getAwaitedPlayerIds` is empty during it: the 4 s timer carries it, so there's nobody to skip.
14. **Displayed letters are public, effective letters are the client's to work out** with the shared `effectiveCluster`. Reversing three letters is a puzzle, not a secret.
16. **All copy names the letters to type**, never the bomb's (QA fix): "It needs IVE at the end (the bomb's backwards)." In QA, "ending in EVI backwards" read both ways. `wanted()` and `REVERSED_NOTE` in shared/rules.ts are the convention; the bomb itself still shows the reversed letters, so the puzzle moves from the copy to the bomb. Placeholders drop the note to fit ~300 px.
15. **Three existing tests change their setup, not their assertions.** Two pass a two-field settings literal to `createGame` and now spread `DEFAULT_SETTINGS` so they typecheck. The non-word test asks for `unknown: "strict"`: with the default now `vote`, "singz" opens a vote instead of bouncing, and strict is the shipped behaviour that test pins.

## Deferred

Configurable length bounds, more categories, a spoken-word mode (spec §4.1), and per-room public/private defaults for `unknown`.
