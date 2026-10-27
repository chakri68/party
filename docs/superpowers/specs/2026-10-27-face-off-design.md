# Face-Off: design

Part 7, the last, of the word-games roadmap (`2026-10-27-word-games-shared-kit-design.md`). Source: `party-word-games-spec.md` §10 ("Anomia"), plus the controller's rulings in `.superpowers/sdd/games/face-off-brief.md`. The genre stays (say an example of a category, fastest wins); the commercial game's symbol-matching cards don't. Original name, original categories, original UI. House references: `games/imposter` (ballots) and `games/dont-say-it` (deadlines in state, one phase timer, the early-alarm guard).

## The game

3–12 players. Everyone holds one face-up category card ("a breakfast food", "something with wheels"). Every 4–9 seconds the server sparks a duel between two players. Each duelist has to say, out loud, an example of the *other* player's category. Both get a big buzzer; the first to buzz claims the point. The players not in the duel then have 6 seconds to Confirm or Overturn the claim. An overturn gives the point to the other duelist.

- **Winner**: +1. **Loser**: draws a new card.
- **Nobody buzzes in 8 s**: no score, both duelists draw new cards.
- **Redo** (either duelist, once per duel): no score, same pair, sparked again in 2 s.

First to 10, 15 or 20 points wins. After 5 minutes the duel in progress finishes and the highest score wins; ties share.

## Phases

One `phase` timer with the absolute `deadline` in state, plus a `cap` timer for the 5 minutes.

| Phase | Ends when | Then |
| --- | --- | --- |
| `lull` | the spark delay runs out | `duel` (if 2+ connected players; else another lull) |
| `duel` | a duelist buzzes, or 8 s, or a redo | buzz: `confirm`; 8 s: no score, `lull`; redo: `lull` with the same pair queued |
| `confirm` | everyone eligible (and connected) has voted, or 6 s, or a redo | the point is scored, then `lull` or `finished` |

The cap timer, firing in a `lull`, ends the game there. Firing in a `duel` or `confirm`, it sets `capped` and the game ends when that duel resolves (a redo included).

## State

Server: settings, players (`id`, `seat`, `card` as an index into the deck, `score`, `removed`, `away`), phase, deadline, `phaseMs`, `endsAt` (the cap), `capped`, the duel (`a`, `b`, `claimId`, `redone`, ballot), the queued pair after a redo, the last pair (for the weighting), the last outcome, the deck order and position, `usedBefore`, `reshuffled`, a test deck, `endReason`.

Public: phase, deadline, `phaseMs`, `endsAt`, target, players (id, category text, score, removed), the duel (the two ids, who claimed, `redone`, votes cast, voters), the queued pair, the last outcome (kind, winner, loser, confirm and overturn counts, who drew), `reshuffled`, `endReason`.

Private: `canBuzz`, `canRedo`, `canVote`, and your own vote.

Categories are public on purpose: they're face up. The only secret is the vote. Public state carries the number of votes cast, never who voted which way; the counts go public when the duel resolves. A test reads the serialised public state and every other player's private state for the vote.

## Actions

- `buzz` (a duelist, `duel`): claims the point. The second buzz is too late.
- `redo` (a duelist, `duel` or `confirm`, once per duel).
- `vote` with `choice: "confirm" | "overturn"` (an eligible non-duelist, `confirm`). Re-voting overwrites.

Timed phases reject actions with `time-up` once `ctx.now` reaches the deadline, alarm or not. `onTimer` ignores an alarm more than 500 ms early and re-arms it.

## Settings

`target` 10 / 15 / 20 (default 10). The cap is a fixed 5 minutes.

## Edge cases

- **A duelist leaves** (removed) in `duel` or `confirm`: the duel is void. No score, nobody draws, back to `lull`.
- **A voter leaves**: `dropVoter`; if everyone left has voted, it closes.
- **A voter drops** (socket down): stops counting toward "everyone's voted", so the vote doesn't wait 6 s on a dead phone. Their vote, if cast, still counts.
- **A duelist drops**: nothing special. The duel times out within 8 s, or the other one buzzes and the table judges.
- **Below 3 players**: the game ends (`abandoned`). The highest score still wins.
- **Fewer than 2 connected players at a spark**: no duel; another lull.
- **Host skip** (the runtime's skip-turn, for an awaited player): in `duel`, the duel's void as if nobody buzzed; in `confirm`, the voter's dropped.

## Rulings

1. **Overturn needs more overturns than confirms** among the votes cast. A tie, or no votes, and the claim stands. The brief says silence keeps the claim; a level split is the same doubt.
2. **Eligible voters are the connected non-duelists when the vote opens.** A dropped phone can't vote, and waiting on it only drags the 6 s out. Nobody eligible at all: the claim stands at once.
3. **The vote closes early** once every eligible voter who's still connected has voted.
4. **Votes stay secret until the duel resolves**, then the two counts go public (never names). Source §11.
5. **Redo is once per duel.** Two duelists who keep calling redo would stall the table forever. The re-sparked duel shows `redone` and has no redo button.
6. **Redo re-sparks after 2 s, not at once.** The spark is the surprise; the pair needs a beat to reset.
7. **A duelist who leaves voids the duel and nobody draws.** The one still here keeps their card; they did nothing wrong.
8. **No buzz in 8 s: both draw.** That's the brief's rule, and it clears two categories nobody could crack.
9. **The outcome shows during the next lull**, not in its own phase. The lull is at least 4 s, enough to read "Ada +1, Bo draws".
10. **Pair weighting.** The exact last pair is out whenever any other pair exists. Each pair's weight is 3 × 3, with each player in the last pair counting 1 instead of 3. With three players, the two new pairs are equally likely.
11. **The 5-minute cap lets the live duel finish.** Cutting off someone mid-buzz feels like a bug.
12. **Ties share the win**, at the cap or on abandon. Nobody with a point: nobody wins.
13. **No two players hold the same card.** Draws come from a shuffled order; cards the last match used go to the back (via `carryOver`). If the order runs out, it reshuffles everything not in someone's hand and the table is told (`reshuffled`), per source §11.
14. **Arrival order is the only order.** The server takes the first buzz it receives; no client timestamps. The vote is there to fix what latency gets wrong.
15. **Room chat stays open.** It's a spoken game.
16. **A duel takes over the game area, not the screen.** It replaces the table for everyone, but the shell's header, reactions and chat stay reachable, or ruling 15 would be a lie for most of every spark cycle. A duelist's buzzer takes focus when the duel opens (unless they're typing), so Space and Enter buzz rather than pressing some shell button.

## Content

`shared/categories.ts`: 155 original, broad, easy categories, lowercase, each finishing "Name …" naturally ("a breakfast food", "something cold"). Public. A test checks the count, no duplicates, the shape and the length.

## Deferred

Two duels at once, themed packs, a host-chosen cap, "wild" cards, typed answers.
