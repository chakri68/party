# Don't Say It: design

Part 6 of the word-games roadmap (`2026-10-27-word-games-shared-kit-design.md`). Source: `party-word-games-spec.md` §9 ("Taboo"), plus the controller's rulings in `.superpowers/sdd/games/dont-say-it-brief.md`. Original name, original cards, original UI. House reference: `games/imposter` (deadlines in state, private views, secrecy and guard tests).

## The game

4–12 players in two teams, Amber and Teal. Teams take turns. On a turn, one player describes a word to their own team out loud, without saying the word or any of the five words printed under it. The describer's teammates guess. The other team sees the same card and watches for slips.

- **Got it**: +1, next card.
- **Skip**: 0, next card.
- **Oops** (the describer owns up): −1, next card.
- **Buzz** (anyone on the other team): the clock stops. The describer says **Fair** (−1, next card) or **Nope**. Nope goes to the other team's captain, who says **Uphold** (−1, next card) or **Drop** (0, the same card carries on). The clock picks up where it stopped.

A team's total never goes below 0. Each team gets 2, 3 or 5 turns of 45, 60 or 90 seconds. Most points wins. A tie gets one sudden-death turn each; still tied, both teams win.

## Phases

One `phase` timer, with the absolute `deadline` in state for the clients to draw.

| Phase | Ends when | Then |
| --- | --- | --- |
| `teams` | the host starts (both teams 2+) | `ready` |
| `ready` | the describer taps Start | `turn` |
| `turn` | the clock runs out, or the describer leaves | `turn-result` |
| `buzzed` | the describer says Fair or Nope, or 20 s | Fair: `turn`; Nope or time: `appeal` |
| `appeal` | the captain says Uphold or Drop, or 20 s | `turn` (time counts as Drop) |
| `turn-result` | 8 s, or the host says next | `ready`, sudden death, or `finished` |

While `buzzed` or `appeal`, the turn's remaining time sits in `turnLeft` and the phase timer is reset to the dispute's own 20 s. Resuming sets the deadline to `now + turnLeft` and re-arms the timer (the Pass the Bomb vote's pattern).

## State

Server: settings, players (`id`, `seat`, `team`, `removed`, `away`, `described`), the two scores, `firstTeam`, the turn index, `suddenDeath`, phase, deadline, `phaseMs`, the match's card order (indexes into the deck) and position, the turn record (team, describer, current card, resolved cards with outcomes, net points, buzzer, captain, `turnLeft`), `usedBefore` (from the last match), and `endReason`.

Public: phase, teams (name, members, score, live captain), turn number of total, `suddenDeath`, the active team and describer, deadline and `phaseMs`, `turnMs` and `turnLeft` (frozen clock), the buzzer and deciding captain, the turn's resolved cards (target and outcome), the net points this turn, `reshuffled`, `endReason`.

Private: your team, your role this turn (`describer`, `guesser`, `watcher`), the card (target plus the five) for the describer and the other team only, whether you can buzz, and whether you're the one deciding a dispute.

The current card is never in public state, public events, or the private state of the describer's teammates. A resolved card's target goes public: it's off the table, and the guessers want to know what they just got. Tests check all of it on the serialised JSON.

## Actions

- `switch` (anyone, `teams`): to the other team, if the sizes end within 1 of each other or closer than they were.
- `shuffle` (host, `teams`): a fresh random balanced split.
- `start` (host, `teams`): both teams need 2+.
- `go` (describer, `ready`): starts the clock and deals the first card.
- `got` / `skip` / `oops` (describer, `turn`).
- `buzz` (other team, `turn`).
- `fair` / `nope` (describer, `buzzed`).
- `uphold` / `drop` (the captain, `appeal`).
- `next` (host, `turn-result`).

Timed phases reject actions with `time-up` once `ctx.now` reaches the deadline, alarm or not. `onTimer` ignores an alarm more than 500 ms early and re-arms it.

## Settings

`turnSeconds` 45/60/90 (default 60), `turnsPerTeam` 2/3/5 (default 3).

## Edge cases

- **Describer leaves** (removed) in `turn`, `buzzed` or `appeal`: the turn ends where it stands, no penalty, the card in hand retired unscored. In `ready`, before the clock started, a teammate takes the turn instead.
- **Describer drops** (socket down): in `ready`, a connected teammate takes over if there is one; in `buzzed`, it goes straight to the captain; in `turn`, the clock carries on.
- **Captain leaves or drops** during `appeal`: the next connected player on that team decides; if there's nobody, it's a Drop.
- **A team falls below 2** during play: the game ends. `getResult` names the leading team's players, or nobody if level. In `teams`, fewer than 4 players left ends it the same way; an uneven split is fixable by switching.
- **Host skip** (the runtime's skip-turn, for an awaited player): `ready` hands the turn to the next teammate, `turn` ends the turn, `buzzed` counts as Nope, `appeal` as Drop.

## Rulings

1. **Team names are Amber and Teal**, shown as words as well as colours, so nothing depends on colour alone.
2. **The first team is random**; turns alternate from there. Sudden death keeps the alternation, so the team that opened the match opens it.
3. **Describer order:** the active team's player who's described the fewest times, ties by seat order; connected players first. That rotates cleanly and copes with people leaving.
4. **Captain:** the first player of a team by seat order who's still in and connected (connected first is ours: a captain on a dead socket would only stall the appeal). Public state shows each team's captain so nobody's surprised.
5. **The describer starts the clock** (`ready`, untimed). The room shouldn't lose 60 seconds to someone fetching a drink. The runtime's skip-turn covers the idle (after a minute) and the dropped (at once).
6. **Disputes have a 20 s clock each.** A describer who says nothing escalates (silence isn't a confession); a captain who says nothing drops it (the buzz needs a yes). The turn's clock stays frozen through both.
7. **The floor applies on every change**, not only at the end, so the total on screen is the total. The turn's net figure counts what actually moved.
8. **The card in hand when time runs out** is retired unscored ("time" in the summary). It won't come back this match.
9. **Resolved cards go public** with their outcome, during the turn and in the summary. Skipped ones too: they're gone for the match.
10. **No repeats in a match.** The card order is shuffled at the start, with cards the last match used pushed to the back (carried through `carryOver`). If a match somehow runs through all 160, the order reshuffles and the table is told (`reshuffled`), per source §11.
11. **Buzzes aren't rationed.** The clock is frozen through a dispute, so a frivolous buzz costs the describing team nothing but patience, and the captain can only uphold what the describer already contested. Honour system, as source §9 asks.
12. **Teams survive a rematch** via `carryOver`; newcomers go to the smaller team, leavers are dropped, and a split that's more than 1 apart is evened out at random. The `teams` phase still opens every match, so it can be changed.
13. **Room chat stays open.** Typing the word in chat is the same as saying it, and the other team can buzz that too.
14. **No turn ends early on an empty deck** in practice (see 10); the deck is 160 cards.

## Content

`server/cards.ts`: 160 original cards, a target plus exactly five forbidden words each, server only (a guard test keeps `client/` and `shared/` from importing `server/`). No forbidden word equals or contains its target, no target twice, no forbidden word twice on one card, all lowercase. A test checks it.

## Deferred

More than two teams, difficulty tags and packs, manual team assignment by the host, a per-buzz rate limit.
