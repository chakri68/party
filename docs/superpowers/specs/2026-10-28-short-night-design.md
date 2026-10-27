# Short Night (game id `short-night`)

Part 3 of the social deduction roadmap (`2026-10-28-social-deduction-design.md`). Source: `social-deduction-spec.md` §4 for the shape, minus everything the roadmap cut: no centre cards, no swaps, nothing that changes a card once it's dealt. First real user of `@games/hidden-roles`.

## The game

4–10 players, one card each, two teams: **village** and **wolves**. One night, one talk, one vote, done. Village wins if a Wolf is voted out; wolves win otherwise.

Every card except Wolf and Villager is original, and no role name or card text is borrowed from Blood on the Clocktower either: the final review caught a "Gossip" (a Clocktower name, now the Eavesdropper) and a Bellringer blurb worded close to the Empath's, now rewritten. The night runs in a fixed, published order; each acting role gets its own 15 s step whether or not anyone's acting in it. Every result is computed from the deal, which never changes, so nothing learned at night goes stale.

### Roles

Listed in night order. "Reads as a wolf" means a Wolf or the Stray (ruling 4).

| Role | Team | Max | Night | Result |
| --- | --- | --- | --- | --- |
| Wolf | wolves | 3 | Step 1, passive | The other Wolves. A lone Wolf instead learns one player holding a Villager card (or that there's none). |
| Lamplighter | village | 1 | Step 2, picks one other player | Whether they read as village or as a wolf. |
| Matchmaker | village | 1 | Step 3, picks two other players | Whether the two read as the same side or different sides. |
| Bellringer | village | 1 | Step 4, passive | The players seated either side of them: how many read as wolves, 0, 1 or 2. |
| Eavesdropper | village | 1 | Step 5, passive | Two other players, at least one of whom reads as a wolf. The partial truth. |
| Wanderer | village | 1 | Step 6, picks one other player | One role that player's card is *not*, drawn from the roles in this deck other than the Wanderer itself. |
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
- **Standard**: Lamplighter, Matchmaker, Eavesdropper.
- **Full**: Lamplighter, Matchmaker, Eavesdropper, Bellringer, Wanderer, Stray. At 4 players that's the first three; at 10, all six and two Villagers.

## Rulings

1. **The night is as long as the deck says, never shorter.** One step per acting role *in the deck* (Wolf always, plus each info role with a count). The deck is public (the lobby lists it), so this reveals nothing the room didn't already know. A step never ends early, whether its actor acted, never existed, left or is disconnected, so the night's length says nothing about who's acting. Every phone shows the same banner ("Night: Lamplighter, 2 of 5") for every step, and the same order list: only the dealt roles' steps. The brief's literal reading (every step always, dealt or not) was raised in review; the controller ruled the deck-public reading stands.
2. **Missed actions are no action.** A picker who doesn't pick in their 15 s gets "You didn't pick in time" and nothing else. No random target (§4.5).
3. **Passive results are drawn at the deal** (Eavesdropper's pair, the lone Wolf's Villager, Bellringer's count) with the game's RNG, and shown from the role's step. Wanderer's "not" role is drawn when they pick. Both deterministic under a seed.
4. **One role reads as a wolf: the Stray.** It's village, wins with the village, and every team check (Lamplighter, Matchmaker, Bellringer, Eavesdropper) sees it as a wolf. The Wanderer and the lone Wolf deal in cards, not teams, and see the true card: the Wanderer can learn "not a Wolf" about the Stray. That contradiction is the Stray's tell, on purpose. Voting out the Stray is voting out a villager. Full preset only. Results must be literally true (controller), so team-check results are worded in how players *read* ("At least one of A and B reads as a wolf", "A and B read as the same side"), never what they *are*; the rules text says what reading as a wolf means. The wording lives in `shared/describe.ts` and is tested.
5. **Wolves see each other in step 1**, not at the deal: the role card says "Wolf" from the start, and the wolf list appears when the night reaches them. Same for every role: nobody's result appears before its step.
6. **The lone Wolf's consolation** is one random player holding a Villager card. A deck with no Villagers says so instead. It's information a Wolf can lean on to claim an info role without being contradicted by that player.
7. **Targets are any other player in the deal,** including one who left: their card is still on the table.
8. **Runoff choices are the tied leaders only,** no `nobody`; a tied leader can't vote for themselves. A runoff that stays tied, or that nobody votes in, puts nobody out.
9. **Votes are secret until results.** Public state carries only how many have voted; the shell's "awaited" list is empty during the vote, runoff and night (it's public, and night's would name the actor). During `reveal` it lists who hasn't tapped "Got it", which says nothing about cards.
10. **Leaving.** A leaver's row shows "left"; their card stays secret until results. Their step still runs at full length. In a ballot their vote is dropped and votes for them go back to their voters; if a runoff is down to one candidate because the others left, the game ends interrupted (controller, spec §10: a leave alone must not decide who goes). A three-way runoff that loses one goes on between the other two. If the last Wolf leaves before the outcome, or fewer than 3 players are left, the game ends **interrupted**: no winner, everything revealed. This covers the vote too, not just "before the vote" as the brief says, because a wolf win by a disconnect is the §10 thing to avoid.
11. **Disconnects never stall.** Disconnected players don't hold up the reveal or a ballot (the early close looks only at connected players); the night never waits for anyone; the day is the host's or the clock's.
12. **Rematch deals fresh.** No `carryOver`: nothing about a finished game shapes the next.
13. **No-wolf decks are impossible.** The brief overrides the roadmap's "only as an explicit setting": the validator requires a wolf, so the village's "no elimination" win from §4.4 never comes up.
14. **The results screen** headlines "Village wins" / "Wolves win" / "Interrupted"; standings list each player's card and won/lost, winners first.
15. **Everyone picks, every step.** During each night step every phone still in the game shows the same pick list (everyone but you, in seat order), the same headline, the same Confirm, asking for the awake role's pick count, or one for a passive step. Only the real picker's Confirm is sent; everyone else's stays on the phone, so the server never sees a decoy and its rules are unchanged. Step start plays the same sound and the same buzz on every phone. What's left between phones is the role card's content, which is face down unless tapped, and a rejection note if the real pick arrives after the deadline (rare: Confirm is local and immediate).
17. **Dawn reads as a log.** Each picker's line says who they picked before what they learned ("Picked Cat. Cat reads as village."); a step that ran out says "No pick: time ran out." Ballots are listed in seat order. First-ballot vote counts sit beside each card as "2 votes", never "2×".
18. **Missing-team messages name the team**, "Needs at least one Village card" / "…Wolf card", through the kit's `DeckRules.teamLabels`.
16. **The Wanderer's draw can't come up empty.** Its "not" role comes from the deck's roles minus the target's card and the Wanderer; a dealable deck always leaves one. A test deck that doesn't falls back to any other role from the full list, which is still true.

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
