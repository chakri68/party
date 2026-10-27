# Word games, part 2: Chain Words

Source: `party-word-games-spec.md` §5, plus the controller's brief. Template: `games/pass-the-bomb`.

## The game

Everyone builds one chain. Each word starts with the last letter of the word before it: ROCKET, TIGER, RIVER. It's your turn, there's a visible clock, and a wrong word just bounces: try again before the clock runs out. Run out and you lose a life, and the turn moves on. Last one with lives wins.

2–12 players. Same shape as the Bomb: a holder, typed words, lives, the typing stream, a shake on a bad word. The difference is the clock: the Bomb's fuse is hidden and spans many passes; here every turn gets its own, and everyone sees it.

## Rules as implemented

- A word counts if it's a–z only, 3–30 letters, starts with the required letter, is in `@games/words/dictionary` (`isWord`), and nobody has played it this game (exact normalised match: trimmed, lowercase; no stemming).
- The opening word comes from `shared/openers.ts`, about 60 common words, drawn at random. It counts as played.
- The required letter is the last letter of the last word in the chain, unless the rescue changed it (below).
- Accepted: the word joins the chain, the turn passes to the next living seat, and the next player gets a fresh clock.
- Rejected: an error to the holder only. The clock keeps running. Others see the holder's input shake via the stream (`wrong: true`), like the Bomb.
- Clock runs out: the holder loses a life. At zero they're out (`outOrder`). If more than one is left, the next living seat gets the turn, the same letter, and a fresh clock.
- Last one standing wins.

### Rescue

After any word lands (and once at the start, after the opener), the server checks whether any unused dictionary word starts with the required letter. Every dictionary word is already a–z and 3+ letters, so "available on letter L" is `count(L) − used words starting with L`. The per-letter counts come from `allWords()` once and are cached (`server/words.ts`). If it's zero, the letter is rerolled at random among letters that still have words, a public `rescued` event says so, and nobody loses anything. In practice only X runs dry (46 words), and only in a very long game.

## State

Server (`ChainWordsServerState`):

- `phase`: `"live" | "finished"`. No pause phase: after a timeout the next turn starts at once, because the next player has been watching the clock count down and knows they're up.
- `settings`, `players` (`id`, `lives`, `removed`, `away`, `words`), `turn` (bumps on every change of holder; pins typing to one turn), `holderId`, `letter`, `deadline` (absolute server ms), `chain` (every word played, `{ playerId | null, word }`, opener first), `outOrder`, `typing`.
- `used` is derived from `chain`: one list, so the two can't drift.

Public: everything above except `away` and `typing`, with `chain` trimmed to its last 12 links plus a `chainLength`. Nothing in this game is secret; the private state is just `{ holding }`.

## Timer

One timer, `turn`. Every new turn sets it to `turnMs` and writes `deadline = now + turnMs`; setting it again replaces it. `onTimer` ignores an alarm that fires before `deadline − 500 ms` and re-arms it for the remainder (Dominion's guard), so an early or duplicate alarm can't cost anyone a life.

## Actions and hooks

- `word { text }`: as above. Error codes: `game-finished`, `not-in-game`, `not-your-turn`, `bad-word` (shape or letter), `used`, `not-a-word`.
- `onStream` / `getStreamSnapshot`: the holder's typing for this turn, through the Bomb's `parseTyping`.
- `onPlayerDisconnected` / `onPlayerReconnected`: mark `away`. A holder who drops keeps the turn; the clock will take a life, or the host can skip.
- `skipTurn` (host, for a dropped holder): passes the turn on with a fresh clock, same letter, no life lost.
- `onPlayerRemoved`: out, not counted as eliminated. Down to one ends the game. If they held the turn, it moves on with a fresh clock.
- `getAwaitedPlayerIds`: the holder while live.
- `getResult`: winner first, then by how long they lasted, leavers last. Labels like the Bomb's ("2 lives left", "out 2nd", "first out", "left").

## Settings

- Turn time: 5 / 8 / 12 s, default 8.
- Lives: 1 / 2 / 3, default 3.

## Edge cases

- Next seat: the next living seat that's connected, else the next living seat at all (the Bomb's `nextAlive`). A turn handed to a dropped connection just times out on them.
- Everyone else away: they still get turns, and the clock eats their lives. The game ends; nobody waits forever.
- Opening holder: the dealer's left, like the Bomb.

## Rulings

1. **Helpers come from the Bomb's package, not a copy.** `normalizeWord`, `parseTyping`, `ordinal`, `TypingData`, `MIN_WORD`, `MAX_WORD` are imported from `@games/pass-the-bomb/shared`. The brief allows it, it's a few hundred bytes in the client chunk, and moving them into a shared package would be a second refactor of a game that just had one. If a third typed-word game turns up, that's the time to move them.
2. **The opener counts as played.** Otherwise someone can replay ROCKET on turn one, which reads as a bug.
3. **A timeout keeps the letter.** The next player gets the same letter the timed-out one had. Source §5 doesn't say; rerolling would make a timeout a way to dodge a hard letter.
4. **A rescue never fires twice in a row on the same letter**: it picks only among letters with words left, so the new letter is always playable.
5. **The whole dictionary running dry ends the game** with everyone still in as joint winners. It can't happen at 63k words, but the code doesn't loop on it.
6. **Skip and leave give a fresh clock.** The Bomb's fuse is a round-long thing and carries over; here the clock belongs to the turn, so the next player gets all of it.
7. **No pause after a timeout.** See State. The client shows who timed out in the status line and a bubble on their chip instead.
8. **Words per player** are counted and shown in the results label after the lives ("3 lives left, 9 words"), because in a game with no hidden fuse they're the closest thing to a score.

## Deferred

Hard Mode, Category Chain, Sudden Death (source says future). A word list in the client for instant "used" feedback (the server says so in one round trip).
