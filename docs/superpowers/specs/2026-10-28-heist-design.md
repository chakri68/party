# Heist (game id `heist`)

Part 4 of the social deduction roadmap (`2026-10-28-social-deduction-design.md`). Genre: spec §7, hidden saboteurs on mission teams. Mechanics, names and numbers here are our own; the source game's squad table, five-rejection loss and two-fail fourth mission are left out per the roadmap ruling.

## Rules

5–10 players. Each is secretly **crew** or a **mole**. Moles see each other; crew see only themselves.

Five jobs, played in order. For each job:

1. **Propose.** The leader picks exactly the job's crew size of distinct players, themselves allowed.
2. **Vote.** Everyone still in votes Go or No-go, secretly. More than half of the players in the game must say Go; a tie fails. When the vote closes, every vote is shown by name.
3. **Job.** A passed crew plays one card each, face down. Crew can only play Clean. A mole plays Clean or Sabotage, but each mole has two Sabotage cards for the whole game. One Sabotage fails the job. The table learns whether the job came off and how many Sabotage cards were in, never whose.

The leader moves one seat on after every proposal, passed or not.

**Heat.** Every failed proposal adds one heat. At three heat the current job is lost to the moles and heat drops to zero. Heat also drops to zero after any played job.

First side to three jobs wins.

## Derived numbers

**Moles.** `usualMoles(N) = 2 + ⌊(N − 5) / 2⌋`: 2 at 5–6, 3 at 7–8, 4 at 9–10. The host may ask for one fewer; the count must land in `[2, ⌊(N − 1)/2⌋]`. That upper bound equals the usual count at every N from 5 to 10, so "one more" never fits and the lobby doesn't offer it (ruling 2).

**Crew sizes.** For job `k` in 0..4:

    lo = ⌈N/3⌉, hi = ⌈N/2⌉
    size(N, k) = lo + round((hi − lo) · k / 4)

| N | sizes |
| --- | --- |
| 5 | 2 2 3 3 3 |
| 6 | 2 2 3 3 3 |
| 7 | 3 3 4 4 4 |
| 8 | 3 3 4 4 4 |
| 9 | 3 4 4 5 5 |
| 10 | 4 4 5 5 5 |

Why these bounds: the first job at `⌈N/3⌉` is small enough that a clean early crew is plausible; the last at `⌈N/2⌉` is about half the table, so by then nearly any crew holds a mole and the vote has to do the work. It never exceeds `N − 1` (somebody always sits out to vote against it). Tests check every N.

## Phases

| Phase | Ends when | Then |
| --- | --- | --- |
| `reveal` | everyone connected tapped Got it, or 30 s | `propose` |
| `propose` | leader proposes, or leader timer | `vote`; on timeout a failed proposal (heat +1) |
| `vote` | every connected voter has voted, or vote timer | `job` if passed, else heat +1 and `propose` (next leader) or a heat loss |
| `job` | the card timer, always its full length | the job's result, then `propose` for the next job or `finished` |
| `finished` | — | rematch from the lobby |

A heat loss or a played job that gives a side its third job goes straight to `finished`.

Timers by preset (leader / vote / card):

| Preset | Leader | Vote | Card |
| --- | --- | --- | --- |
| Beginner (default) | 60 s | 30 s | 20 s |
| Standard | 45 s | 20 s | 20 s |
| Fast | 30 s | 15 s | 10 s |

## State

**Server:** phase, deadline, phaseMs, settings, players (`id`, `left`, `away`), `alignment` by id, `budget` by mole, `leader` (seat index), `job` (0..4), `heat`, `score` {crew, moles}, `crew` (the pending proposal), `ballot`, `cards` by crew member (this job's), `proposals` (closed), `jobs` (played or lost), acks, winner, endReason.

**Public:** phase, clock, players (`id`, `left`), leader id, job index, the five sizes for the current head count, heat, score, mole count, the pending crew, ack count, votes-in count and voter count, closed proposals with their votes by name, finished jobs with crew, Sabotage count and auto-played count. From `finished`: every alignment, winner, end reason.

**Private:** your alignment, the moles (moles only, seat order), your Sabotage cards left (moles only), whether you've acked, your vote, whether you can vote, whether you're on the job and the card you've put in.

Never sent to anyone, ever: who played which card.

## Leaving and disconnects

- A disconnected player keeps their seat for the shell's 60 s grace and holds nothing up: the reveal and the vote close once everyone connected is done; a leader who's away is just slow (their timer runs, the host can skip them); the job runs its clock anyway.
- A leaver on the pending crew (during `vote` or `job`) voids the proposal: no heat, cards put in are taken back (Sabotage cards return to the budget), and the same leader proposes again. If the leader is the leaver, the next seat proposes.
- A leaver elsewhere drops out of the ballot (`dropVoter`) and the leader rotation. A leader who leaves during `propose` hands it to the next seat at a fresh clock, no heat.
- Crew sizes follow the head count still in.
- Fewer than 5 left, no moles left, or no crew left: the game ends interrupted with no winner and every alignment shown (spec §10).

## Settings

Flat, two rows: `preset` (beginner, standard, fast) and `moles` (`usual`, `fewer`; `more` parses but isn't offered). `setupProblem` explains any count outside the range, e.g. "6 players need at least 2 moles".

## Rulings

1. **Presets differ only in timers.** The brief's Beginner keeps the brief's default timers; Standard takes the source spec's §7.4 numbers (45/20/20); Fast is shorter. No special roles anywhere.
2. **No "one more mole" option.** The range's top equals the usual count at every N, so it could never be picked. The settings value still parses so a saved room doesn't break.
3. **The job always runs its full clock,** and the table sees no count of cards in. A job that ended when the last card landed would time the slowest player, and the slow one is the mole thinking it over. Cards can be changed until the clock ends.
4. **Same screen for every crew member on a job.** Clean and Sabotage cards both show, same size, same place. A crew player's Sabotage card says "Moles only" and does nothing; a mole's says how many are left. At arm's length the screens match.
5. **Auto-played cards are counted publicly** per job ("1 card auto-played"), never named, per the brief.
6. **Missing votes are No-go,** recorded as such in the public history and marked as missed so nobody's blamed for a vote they didn't cast.
7. **The vote closes early once every connected voter is in.** Approval is public after the close anyway, so early close tells nothing. Pending shows as a count; `getAwaitedPlayerIds` is empty during the vote and the job (spec §10: counts, not names).
8. **The leader's no-show is a proposal.** It goes into the history with an empty crew and `timedOut`, adds heat, rotates the leader. No auto-pick.
9. **First leader is a random seat;** the rotation then follows seat order, skipping leavers.
10. **Rematch carries nothing.** Fresh alignments, fresh first leader, fresh budgets.
11. **The deal's public trace is the mole count only.** Lists that come from the deal (the moles' own list) go out in seat order.
12. **A voided proposal leaves no record.** Its votes (if the vote had closed) are already history; a vote still open is discarded unseen.
13. **Heat-lost jobs** go into the job list with no crew and `heat: true`.

## Kit fit

- `roleReveal`, `findLeaks`, `setupProblem`, ballots: used as-is.
- `@games/hidden-roles` deck settings: not used. Heist has two alignments and a count, not a role deck; a preset-plus-counts row set would offer nonsense (a Custom deck with zero crew). A single `moles` row and `setupProblem` cover it.
