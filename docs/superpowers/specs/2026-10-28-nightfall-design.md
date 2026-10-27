# Nightfall (game id `nightfall`)

Part 5 of the social deduction roadmap (`2026-10-28-social-deduction-design.md`). Source: `social-deduction-spec.md` §5, §10 and §11, mostly as written. Folk Werewolf: the shape stays, the names and words are ours.

## The game

5–12 players, one secret card each, two teams: **village** and **wolves**. Nights and days alternate until one side wins. At night the Wolves pick someone to take; by day everyone talks, then votes someone out. The village wins when no Wolves are left alive; the Wolves win once they're at least as many as everyone else alive.

### Roles

| Role | Team | Max | Night |
| --- | --- | --- | --- |
| Wolf | wolves | 5 | Votes, with the other living Wolves, on one living non-Wolf to take. Knows the pack from the deal. |
| Watcher | village | 1 | Picks one other living player; at dawn learns, privately, whether they're a Wolf. |
| Keeper | village | 1 | Picks one living player (self allowed) to shelter. Not the same player two nights running. |
| Villager | village | 11 | Picks anyone. It counts for nothing (ruling 6). |

### Phases

| Phase | Length | Ends early when | Then |
| --- | --- | --- | --- |
| `reveal` | 30 s | everyone still in and connected has tapped "Got it" | `night` 1 |
| `night` | `nightSeconds` (20/30/45, default 30) | never | resolve, dawn, win check, `day` |
| `day` | `discussMinutes` (1–5, default 2) | host taps "Vote now" | `vote` |
| `vote` | 30 s | every connected living voter has voted | resolve |
| `runoff` | 20 s | every connected living voter has voted | resolve |
| `finished` | | | results |

**Night resolution, in order:** the Keeper's shelter, then the Wolves' attack, then the Watcher's reading. The attack target is the plurality of the living Wolves' votes; tied targets are broken by `tally`'s `stableHash` over `seed:night<n>`; no votes at all is no attack. A sheltered target survives. The dawn announcement names who died, or says nobody did, and the dead player's team, never their card. It never says whether a shelter worked.

**Day vote:** each living player votes for another living player, or skips. Skips count for nobody. The most votes goes out; tied leaders go to a 20 s runoff among them (they may vote for each other, not themselves; skip still allowed); still tied, or no votes at all, nobody goes. The executed player's team is announced.

**Win check** after each dawn and each execution: no living Wolves, village wins; living Wolves ≥ living non-Wolves, Wolves win. Once decided, nothing more happens.

### State

Server: settings, seed, the deal (`cards`, fixed), seat order with `dead` / `left` / `abandoned` / `away`, round number, the Wolves' ballot, the Keeper's and Watcher's picks for tonight, last night's shelter, the Watcher's readings, acks, the day ballots, the night and day logs, outcome.

Public, during play: phase, deadline, round, the deck counts (role order), each seat's `dead` / `left` / `abandoned` flags and the team of each dead player, ack and vote *counts*, runoff candidates, each dawn (who died and their team), each closed day (votes by name, runoff, who went and their team).

Public, at `finished`: every card, and each night in full: Wolves' votes, target, shelter, reading, death.

Private, to each seat: their card; the pack (Wolves); the pack's picks tonight (Wolves); their own recorded pick (Wolf, Watcher, Keeper); which picks their card can't make tonight; the Keeper's last shelter; the Watcher's readings, each from the dawn after it; their own vote; their vote choices.

### Settings

Flat, per the kit: `preset` (`beginner` / `standard` / `full` / `custom`), `n:<role>`, `discussMinutes` (1–5), `nightSeconds` (20/30/45).

Wolves 1 at 5–6, 2 at 7–9, 3 at 10–12. Beginner: Wolves and Villagers. Standard: plus the Watcher. Full: plus the Watcher and the Keeper.

`setupProblem`: the kit's `deckProblem` (exactly N cards, at least one card on each team, Watcher and Keeper unique), then "Needs at least two non-wolf cards", then "Wolves must be fewer than everyone else".

## Rulings

1. **Names.** Wolf and Villager are folk; the Seer is the **Watcher** and the Guardian the **Keeper**. "Taken in the night" for a Wolf kill, "voted out" for an execution.
2. **One night, one clock.** All night roles act at once. The night never ends early, whoever has picked, left or disconnected.
3. **Identical night screens.** Every living phone shows the same headline, the same list (every living player, you included, in seat order) and the same Confirm. Only Wolf, Watcher and Keeper Confirms go to the server; a Villager's stays on the phone. The night's start plays the same sound and buzz everywhere.
4. **Picks a card can't make** (a Wolf picking a Wolf, the Watcher picking themselves, the Keeper repeating last night) are caught on the phone with the same neutral line for every card ("That pick doesn't work for your card"), and refused by the server too. The rows look the same either way: disabling them would mark the phone.
5. **Wolves see their pack from the deal** and, inside the face-down card, each other's picks tonight. Picks lock on Confirm for everyone, as in Short Night.
6. **Villagers' picks are local** and never reach the server. Nothing about them could matter, and the server can't leak what it never gets.
7. **Missed picks are no action.** A Wolf who doesn't pick abstains; all abstain, no attack. A Keeper who doesn't pick shelters nobody, and the next night may shelter anyone. A Watcher who doesn't pick learns nothing.
8. **The Watcher's reading** is "Wolf" or "not a Wolf", true, and shows from the dawn after the night it was taken, even if the Watcher died that night (they're dead, but the card still shows it at the end).
9. **Skip is a vote for nobody,** counted for no one. It exists so a player who wants to abstain doesn't hold the early close.
10. **Votes are secret until the ballot closes,** then public by name in the day log, as the genre does it. Public state carries only counts while it's open; the awaited list is empty outside the reveal.
11. **Leaving** (the runtime's `onPlayerRemoved`, after grace or on purpose): the seat shows "left" at once and can't act. Their open votes and night picks are dropped, and so is every vote and night pick *for* them (so a leaver can't be voted out or taken: spec §10, nobody is "eliminated by the opposing team" for leaving; the picker's phone sees the target gone from the living list and asks again, whatever the card). If a runoff loses all but one candidate to leaves, it closes at once and nobody goes. At the next phase boundary every living leaver becomes **abandoned**: not dead, and off the count. **A result reached by abandonment never hands a side the win** (controller, spec §10): every win check runs twice, once counting the abandoned as still alive on their team and once without them. Decided the first way (by deaths and executions), that win stands, even if someone also left. Decided only the second way (an empty side or parity caused by leavers, alone or together with deaths), the game ends **interrupted**: no winner, `endReason: "abandoned"`, everything revealed. This replaces the first build's "parity by a leave is a Wolf win".
12. **Phase boundaries settle leavers first** and run that same check, then resolve the phase, then check again. No one dies between boundaries, so at a boundary only leavers can decide it, and that's always an interruption: the last Wolf leaving mid-vote interrupts rather than handing the village a win, a villager leaving to parity by day interrupts when the vote opens.
13. **Disconnects never stall.** A disconnected player doesn't hold up the reveal or a ballot; the night and the day run on the clock. Their night pick simply doesn't come.
14. **Dead players** keep their card face down, can't pick or vote, and see the public screen with "You're out. Keep what you know to yourself." Room chat is untouched.
15. **Results:** headline "Village wins" / "Wolves win" / "Interrupted: a side left the game"; every card; each night (Wolves' votes, target, shelter, reading, death) and each day (votes, runoff, who went). Winners are the winning team's seats that didn't leave, dead ones included.
16. **Rematch deals fresh.** No `carryOver`.
17. **The host's "Vote now"** works from the day phase only, dead host or not: it moves the clock, not the game.

## Leaving and disconnects, by phase

| Phase | Disconnect | Leave |
| --- | --- | --- |
| reveal | doesn't hold the early close | left now, abandoned at the night's start |
| night | no pick | picks for and by them dropped (pickers asked again); abandoned at dawn, before the attack resolves |
| day | nothing | abandoned at the vote's start |
| vote / runoff | doesn't hold the early close | votes for and by them dropped; abandoned at the close, before the tally |
| any boundary or win check | | decided only once leavers are left out (empty side or parity): interrupted |

## Files

`games/nightfall/{shared,server,client,test}` as Short Night: `shared/roles.ts` (role table, presets, deck rules, `setupProblem`), `shared/types.ts`, `shared/rules-text.ts`, `server/game.ts`, `client/view.ts` + `styles.css` (uses `roleReveal`).
