# Short Night (game id `short-night`)

Part 3 of the social deduction roadmap (`2026-10-28-social-deduction-design.md`). Source: `social-deduction-spec.md` §4 for the shape, minus everything the roadmap cut: no centre cards, no swaps, nothing that changes a card once it's dealt. First real user of `@games/hidden-roles`.

## The game

4–10 players, one card each, two teams: **village** and **wolves**. One night, one talk, one vote, done. Village wins if a Wolf is voted out; wolves win otherwise.

Every card except Wolf and Villager is original. The night runs in a fixed, published order; each acting role gets its own 15 s step whether or not anyone's acting in it. Every result is computed from the deal, which never changes, so nothing learned at night goes stale.

### Roles

Listed in night order. "Reads as a wolf" means a Wolf or the Stray (ruling 4).

| Role | Team | Max | Night | Result |
| --- | --- | --- | --- | --- |
| Wolf | wolves | 3 | Step 1, passive | The other Wolves. A lone Wolf instead learns one player holding a Villager card (or that there's none). |
| Lamplighter | village | 1 | Step 2, picks one other player | Whether they read as village or as a wolf. |
| Matchmaker | village | 1 | Step 3, picks two other players | Whether the two read as the same side or different sides. |
| Bellringer | village | 1 | Step 4, passive | How many of their two seat neighbours read as wolves: 0, 1 or 2. |
| Gossip | village | 1 | Step 5, passive | Two other players, at least one of whom reads as a wolf. The partial truth. |
| Wanderer | village | 1 | Step 6, picks one other player | One role that player's card is *not*, drawn from the roles in this deck. |
| Stray | village | 1 | none | Reads as a wolf to every check above. Knows it. |
| Villager | village | 10 | none | Nothing. |

### Phases

| Phase | Length | Ends early when | Then |
| --- | --- | --- | --- |
| `reveal` | 30 s | everyone still connected has tapped "Got it" | `night`, step 0 |
| `night` | one step per acting role in the deck, `stepSeconds` each | never | next step, or `day` after the last |
| `day` | `discussMinutes` (3/4/5/6, default 4) | host taps "Vote now" | `vote` |
| `vote` | 20 s | everyone still connected has voted | resolve (below) |
| `runoff` | 10 s | everyone still connected has voted | resolve |
| `finished` | | | results |

Vote resolution, as §4.3: each player picks another player or `nobody`. `nobody` wins only with strictly more votes than every named player. Otherwise the named player with the most votes is out. Named leaders tied: a runoff among them. Runoff still tied, or nobody voted in it: nobody is out. No votes at all in the first ballot: nobody is out (the top named player has 0 votes, which isn't "voted out").

### State

Server: settings, seed, the deal (`cards: Record<id, RoleId>`, fixed), seat order, the night steps (role ids), passive results computed at the deal, each actor's submitted targets and result, acks, the two ballots, the outcome.

Public, before `finished`: phase, deadline, phase length, the night steps (role ids, derived from the public deck), the current step index, the deck counts, each player's `left` flag, ack and vote *counts*, the runoff's tied candidates. Nothing per-player that depends on a card.

Public, at `finished`: every card, the night log in order (step, who held the card, their targets, their result), both ballots in full, who went out and their card, the winning team, the end reason.

Private, to each seat: their card, from `night` on their own result once their step has started (wolves see each other from step 1), their pending action's choices during their step, their own vote.

### Settings

Flat, per the kit: `preset` (`beginner` / `standard` / `full` / `custom`), `n:<role>` counts, `discussMinutes`, `stepSeconds` (10/15/20, default 15). `setupProblem` is the kit's `deckProblem` (size N, teams village and wolves) plus "at least two non-wolf cards".

Presets, wolves 1 at 4–5 players and 2 at 6–10, the remaining seats filled in this order, Villagers after:

- **Beginner**: Lamplighter.
- **Standard**: Lamplighter, Matchmaker, Gossip.
- **Full**: Lamplighter, Matchmaker, Gossip, Bellringer, Wanderer, Stray. At 4 players that's the first three; at 10, all six and two Villagers.

## Rulings

1. **The night is as long as the deck says, never shorter.** One step per acting role *in the deck* (Wolf always, plus each info role with a count). The deck is public (the lobby lists it), so this reveals nothing the room didn't already know. A step never ends early, whether its actor acted, never existed, left or is disconnected, so the night's length says nothing about who's acting. Every phone shows the same banner ("Night: Lamplighter, 2 of 5") for every step.
2. **Missed actions are no action.** A picker who doesn't pick in their 15 s gets "You didn't pick in time" and nothing else. No random target (§4.5).
3. **Passive results are drawn at the deal** (Gossip's pair, the lone Wolf's Villager, Bellringer's count) with the game's RNG, and shown from the role's step. Wanderer's "not" role is drawn when they pick. Both deterministic under a seed.
4. **One role reads as a wolf: the Stray.** It's village, wins with the village, and every team check (Lamplighter, Matchmaker, Bellringer, Gossip) sees it as a wolf. The Wanderer and the lone Wolf deal in cards, not teams, and see the true card: the Wanderer can learn "not a Wolf" about the Stray. That contradiction is the Stray's tell, on purpose. Voting out the Stray is voting out a villager. Full preset only.
5. **Wolves see each other in step 1**, not at the deal: the role card says "Wolf" from the start, and the wolf list appears when the night reaches them. Same for every role: nobody's result appears before its step.
6. **The lone Wolf's consolation** is one random player holding a Villager card. A deck with no Villagers says so instead. It's information a Wolf can lean on to claim an info role without being contradicted by that player.
7. **Targets are any other player in the deal,** including one who left: their card is still on the table.
8. **Runoff choices are the tied leaders only,** no `nobody`; a tied leader can't vote for themselves. A runoff that stays tied, or that nobody votes in, puts nobody out.
9. **Votes are secret until results.** Public state carries only how many have voted; the shell's "awaited" list is empty during the vote, runoff and night (it's public, and night's would name the actor). During `reveal` it lists who hasn't tapped "Got it", which says nothing about cards.
10. **Leaving.** A leaver's row shows "left"; their card stays secret until results. Their step still runs at full length. In a ballot their vote is dropped and votes for them go back to their voters; if a runoff is down to one candidate, that candidate is out. If the last Wolf leaves before the outcome, or fewer than 3 players are left, the game ends **interrupted**: no winner, everything revealed. This covers the vote too, not just "before the vote" as the brief says, because a wolf win by a disconnect is the §10 thing to avoid.
11. **Disconnects never stall.** Disconnected players don't hold up the reveal or a ballot (the early close looks only at connected players); the night never waits for anyone; the day is the host's or the clock's.
12. **Rematch deals fresh.** No `carryOver`: nothing about a finished game shapes the next.
13. **No-wolf decks are impossible.** The brief overrides the roadmap's "only as an explicit setting": the validator requires a wolf, so the village's "no elimination" win from §4.4 never comes up.
14. **The results screen** headlines "Village wins" / "Wolves win" / "Interrupted"; standings list each player's card and won/lost, winners first.

## Leaving and disconnects, by phase

| Phase | Disconnect | Leave |
| --- | --- | --- |
| reveal | doesn't hold the early close | as below; acks of the rest still count |
| night | step runs its full length; no action | step runs its full length; no action |
| day | nothing | nothing |
| vote / runoff | doesn't hold the early close | ballot dropped, votes for them returned |
| any, last Wolf leaves | | interrupted |
| any, < 3 left | | interrupted |

## Files

`games/short-night/{shared,server,client,test}` as Imposter: `shared/roles.ts` (role table, night order, presets, deck rules, `setupProblem`), `shared/types.ts`, `shared/rules-text.ts` (rules, setting fields), `server/game.ts`, `client/view.ts` + `styles.css` (uses `roleReveal`).
