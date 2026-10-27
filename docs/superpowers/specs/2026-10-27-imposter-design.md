# Imposter: design

Part 3 of the word-games roadmap (`2026-10-27-word-games-shared-kit-design.md`). Source: `party-word-games-spec.md` §6, plus the controller's rulings in `.superpowers/sdd/games/imposter-brief.md`. Template: `games/scribbl` (a secret word for some, rounds, scores).

## The game

3–12 players. Each round, one of them is the Imposter. Everyone else gets a secret word and its category; the Imposter only gets the category. Everyone types one short clue, the clues go up together, the table talks, then votes on who the Imposter is. Catch them and they get one guess at the word: a right guess steals the round. Innocents score 2 each for a catch that sticks; otherwise the Imposter scores 2. Most points after 3, 5 or 7 rounds wins.

## Phases

One `phase` timer per round, with the absolute `deadline` in state for the clients to draw.

| Phase | Ends when | Then |
| --- | --- | --- |
| `reveal` | everyone here tapped "Got it", or 20 s | `clues` |
| `clues` | everyone here sent one, or 60 s | `discuss` |
| `discuss` | 30/60/90 s (host's pick), or the host says vote | `vote` |
| `vote` | everyone here voted, or 30 s | tie: `runoff`; nobody voted: `round-result`; else `reveal-role` |
| `runoff` | same, 30 s, between the tied leaders only | `reveal-role` |
| `reveal-role` | 5 s | caught: `guess`; else `round-result` |
| `guess` | the Imposter guesses, or 20 s | `round-result` |
| `round-result` | 10 s, or the host says next | next round, or `finished` |

"Everyone here" means every player still in the game whose socket is up. A dropped player doesn't hold a phase; they can still act when they're back, if the phase is still on.

## State

Server: settings, a per-game `seed` (for `tally`), players (`id`, `score`, `removed`, `away`, `imposterCount`), the round number, used words, and a `round` record: phase, deadline, imposter, category, word, acks, clues (by player, plus a shuffled display order), the ballot and its candidates, `runoff`, `accusedId`, the guess and whether it hit, and who scored.

Public: phase, round of rounds, deadline and phase length, category, each player's score and a `done` flag for the current phase (acked, clued, voted), the clues once they're out (shuffled order), the candidates while voting, `tied` (who the runoff is between), and from `reveal-role` on: the votes, the counts and the accused's role. From `round-result` on: the Imposter, the word, the guess and the outcome.

Private: your role, the word (innocents only, until it's public anyway), your clue, your vote, and which players you may vote for.

Neither the word nor the role is in public state, or in the Imposter's private state, before `round-result`. Tests check both, with the word searched for anywhere in the serialised JSON.

## Actions

- `ack`: seen my role. Any time in `reveal`.
- `clue {text}`: once, in `clues`. `cleanChatText(text, 40)`, non-empty. An innocent's clue is rejected if its `normalizeGuess` form contains the word's.
- `vote {playerId}`: in `vote`/`runoff`. Through `castVote` with an explicit `allowed`: the candidates minus yourself. Re-voting before the close overwrites.
- `guess {text}`: the Imposter, once, in `guess`.
- `next`: the host, in `discuss` (vote now) and `round-result` (next round).

Every action in a timed phase is rejected with `time-up` once `ctx.now` reaches the deadline, even if the alarm hasn't fired yet. `onTimer` ignores an alarm more than 500 ms early and re-arms it (Dominion's guard, as in Chain Words).

## Settings

`rounds` 3/5/7 (default 5), `discussSeconds` 30/60/90 (default 60).

## Edge cases

- **The Imposter leaves** (removed, or leaves the room) before `reveal-role`: the round is dropped. No score, no word, no role shown, and a fresh round starts with a new Imposter and word, under the same round number.
- **An innocent leaves**: `dropVoter`, votes cast for them are cleared so those voters can vote again, and the phase checks whether it's now complete. Below 3 players left, the game ends with no winner.
- **Disconnects** just mark the player away. The deadlines carry the round.
- **Host skip** (the runtime's skip-turn, for an awaited player): `reveal` acks for them, `clues` gives them no clue, `vote` drops them from the ballot, `guess` counts as a miss.

## Rulings

1. **Clues are typed all at once**, not in turn (controller ruling): faster on phones, at the cost of building on earlier clues. Display order is shuffled per round, so it doesn't leak who typed first.
2. **The Imposter's clue is never checked against the word.** Rejecting it would tell them the word. If they happen to type it, it goes up like any other clue.
3. **The guess is exact, after `normalizeGuess`, plus a plural `s`/`es` either way.** `isClose` is not used to accept: one letter off between real words is often a different word (lamp/camp, bread/broad). A near miss is flagged `close` in the result, as a consolation line, not points.
4. **Nobody votes:** nobody is accused, and the Imposter scores. A runoff nobody votes in is settled like a runoff tie, by `tally`'s `stableHash`, since the table already narrowed it down.
5. **A runoff candidate leaving** with one candidate left: that one is accused.
6. **The Imposter leaving after `reveal-role`** (caught, about to guess) counts as a missed guess. The roles are out by then, so dropping the round would be the odder outcome.
7. **A dropped round doesn't count** toward the match. Each drop costs a player, so it can't loop.
8. **The restart hints who left was the Imposter.** It can't be helped: only their leaving drops a round. The word and the rest stay hidden.
9. **Category is public.** Every seat in the game knows it, and the spec's secret is the word and the role. It also lets the table show it big.
10. **Imposter choice:** uniformly among the players who've been Imposter the fewest times. Word choice: uniformly among unused words, avoiding the previous round's category when another has words left. Words never repeat in a game until the pack is spent, then it starts over.
11. **Votes are revealed** at `reveal-role` (who voted whom, from the deciding ballot), matching source §11's "secret until a reveal phase".
12. **Room chat stays open** (`ownChat` unset). Talking is the point, and there's no in-game chat. A typed clue in room chat is the player's own risk, same as saying it out loud.
13. **No profanity filter.** The shared-kit doc pencilled it in for the first game that shows typed text. Clues go to a room of people who invited each other, and the host can remove someone. A filter is a word list with false positives; deferred until a public lobby exists.
14. **`normalizeGuess` moves** from Scribbl into `@games/words`, verbatim; Scribbl imports it back.
15. **The last round** still gets its 10 s `round-result` before the game finishes, so the final reveal isn't covered by the results screen.

## Content

`server/words.ts`: original categories, 12+ words each, 150+ in total, server only. No word contains its category's name, and no word appears twice (normalised). A test checks all three.

## Deferred

Two Imposters in big lobbies, spoken-clue mode, personal stats (source §6, "cosmetic only").
