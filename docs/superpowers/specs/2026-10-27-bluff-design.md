# Fake Word and Bluff Definitions: design

Part 4 of the word-games roadmap (`2026-10-27-word-games-shared-kit-design.md`). Source: `party-word-games-spec.md` §7, §8, §11, plus the controller's rulings in `.superpowers/sdd/games/bluff-brief.md`. Template: `games/imposter` (ballots, deadlines, a secret that stays on the server).

Two games, one package, `games/bluff`, the way `games/blind-rally` hosts Blind Rally and Rally: two manifests, two `GameDefinition`s, two client modules, one state machine underneath, built by `makeBluffGame(variant)`.

## The games

3–12 players, 3 or 5 rounds (default 5). Each round the server picks one real, uncommon English word from a curated list, with its meaning.

- **Fake Word** (`fake-word`): everyone sees the meaning, and invents a word that could mean it. The real word goes in with the fakes; find it.
- **Bluff Definitions** (`bluff-definitions`): everyone sees the word, and writes a meaning for it. The real meaning goes in with the fakes; find it.

Then everyone votes for the one they think is real, never their own. +2 for finding it, +1 to an author for each opponent their fake fooled. No negatives. Most points after the last round wins; ties share.

## Phases

One `phase` timer per round, with the absolute `deadline` in state for the clients to draw. Deadlines are checked the Imposter way: an action at or past `round.deadline` (by `ctx.now`) is rejected with `time-up` even if the alarm hasn't fired, and an alarm more than 500 ms early re-arms instead of firing.

| Phase | Ends when | Then |
| --- | --- | --- |
| `write` | everyone here has submitted, or 45 s (Fake Word) / 60 s (Bluff Definitions) | `vote`, or `reveal` if nobody wrote anything |
| `vote` | everyone here has voted, or 30 s | `reveal` |
| `reveal` | 12 s, or the host says next | next round, or `finished` |

"Everyone here" is every player still in the game whose socket is up, as in Imposter. A dropped player doesn't hold a phase; nobody here at all leaves it to the clock.

## State

Server: variant, settings, a per-game `seed`, players (`id`, `score`, `removed`, `away`), the round number, the words used (carried into a rematch), an optional test deck, and a `round`: phase, deadline, the entry (word, meaning, notes), submissions by player, `options` (built when voting opens: opaque id, author or null for the real one, display text), the ballot, and points gained this round.

Public: variant, phase, round of rounds, deadline and phase length, players (score, removed, a `done` flag for the phase), and:
- the prompt: the meaning (Fake Word) or the word (Bluff Definitions), from the start;
- the other half, plus notes, from `reveal` on;
- `options` (id and text only) from `vote` on;
- from `reveal` on: which option is real, who wrote each fake, who voted for what, and points gained.

Private: what you submitted, whether you have, your own option's id, your vote, and the options you may vote for.

The real word (Fake Word) or meaning (Bluff Definitions) is in nobody's state before `reveal`, and there's no author or "real" marker on an option before then. Tests check both on the serialised JSON, for public state, every private state, and the events.

## Options

When voting opens, the submissions and the real answer are shuffled with `shuffle(ctx.randomInt)`, and each gets a fresh random six-character base-36 id, unique in the round. The id carries nothing (not the author, not the slot, not realness), and the order is the shuffle. A test runs many seeds and checks the real one lands in different slots and its id never repeats a pattern.

Bluff Definitions shows every option the same way: `displayDefinition` straightens curly quotes, lowercases the first letter and strips trailing `.`, `!`, `?`, `…` and spaces, on the real meaning too. The dataset's meanings are stored that way already.

## Actions

- `submit {text}`: once, in `write`.
  - Fake Word: trimmed and lowercased, then 3–18 letters a–z. Rejected if it's a dictionary word (`isWord`), the real word, within `editDistance` 2 of the real word, or the same as someone else's. The first three share one message.
  - Bluff Definitions: `cleanChatText(text, 180)`, at least 15 characters. Rejected if it's near the real meaning or near someone else's: `normalizeGuess` both (after `displayDefinition`), then equal, or `editDistance` within 15% of the shorter length (at least 2).
  - A rejection leaves the player free to try again.
- `vote {optionId}`: in `vote`, through `castVote` with `allowed` = every option but your own. Re-voting before the close overwrites.
- `next`: the host, in `reveal`.

## Settings

`rounds` 3/5 (default 5). The writing timer is fixed per variant (brief).

## Edge cases

- **Leaving mid-write**: their submission, if in, stays and can still fool people (and score, for the record). They're no longer waited on.
- **Leaving mid-vote**: `dropVoter`. Their fake stays on the board.
- **Below 3 players left**: the game ends, no winner (`abandoned`).
- **Disconnects** mark the player away. The deadline carries the round.
- **Host skip** (the runtime's skip-turn): in `write`, they're marked done with nothing; in `vote`, `dropVoter`.

## Rulings

1. **No fakes, no vote.** If nobody submitted anything, a ballot with one option is pointless: straight to `reveal`, nobody scores, a `no-fakes` event says so.
2. **One submission, no edits.** Same as Imposter's clue. Simpler state, and an edit after others have seen "done" ticks buys nothing.
3. **Rejections can hint.** Fake Word's "real word, or too close to one" shares one message for dictionary words, the real word and near misses, so it doesn't single out the answer; a near-miss can still tell a player they're within two letters of a real word. Bluff Definitions saying "that's the real meaning" only tells someone what they already knew. Both are within the brief's rules, and the writing timer limits probing.
4. **Near-identical definitions** (tightened in fix round 1): equal after `normalizeGuess`; or `editDistance` ≤ max(2, 15% of the shorter); or one normalised text inside the other (shorter ≥ 12 letters), which catches the real meaning with a clause cut off; or a Jaccard overlap ≥ 0.7 over words of 3+ letters, which catches reordering and swaps.
5. **Reveal is 12 s** and the host can skip it, like Imposter's result. The last round's reveal still plays before the game finishes.
6. **Rematches avoid repeats.** `carryOver` hands on the words used; the next game of the same kind skips them until the list runs out, then starts over. Within one game a word never repeats (5 rounds against 112 words).
7. **Points for a leaver's fake still count** on their (struck-through) row. It's the honest record; they're not in the winner pool anyway.
8. **Removed players can't vote**, and the ballot's eligible list is fixed when voting opens (§11). Someone who never submitted still votes.
9. **The real answer is server-only**: `server/words.ts`, never imported by `client/` or `shared/` (a guard test checks, alongside the dictionary's).
10. **No profanity filter** (as Imposter ruling 13). Fake Word's a–z rule already rules out URLs and formatting; definitions go through `cleanChatText`.
11. **Fake Word entries are 3–18 letters, and so are the real words.** A 20-letter real word among 18-letter fakes would give itself away; the dataset test checks.
12. **Clashes are rationed** (fix round 1). A shape problem (length, letters) is an ordinary rejection: the phone checks it too, and it knows no secrets. A clash (real word, near the answer, a duplicate) knows secrets, so each player gets three explained clashes per round, then "Try something else." for the rest. The count has to live in state, so a clash is a transition with a private `refused` event rather than an error.
13. **One sense per real meaning.** "; also …" second senses only ever appeared on real options, so they moved into the notes. The real list carries no `;`, `!`, `?` or curly quotes; a test checks.

## Content

`server/words.ts`: 112 real, uncommon words (fix round 1 dropped the six most familiar and added eleven), each with a meaning and a note written for this project (no dictionary text copied). Every word is in the dictionary (`isWord`), a–z, 3–18 letters; meanings are 15–180 characters, already in display form, and never contain their word. A test checks all of it, and that nothing appears twice.

## Deferred

The style-bonus vote (off by brief), plausible distractor examples (§8: nothing generates fakes for missing players), a category hint line beyond "an uncommon English word".
