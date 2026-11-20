# Computer players, part 2: the other 11 games

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Computer players for Sevens, Old Maid, Go Fish, Farkle, President, Overheat, Oh Hell, Liar's Dice, Thorns, Cheat and Hold'em, on the room support that part 1 shipped.

**Architecture:** Each game adds `games/<id>/server/bot.ts` exporting a `GameBot` and wires it as `bot` on its definition. Task 1 first closes the gaps part 1 left for games with optional moves (re-rolled choices, empty updates) and gives tests a run-length check. Then one task per game, simplest first.

**Tech Stack:** TypeScript, vitest, Cloudflare Durable Objects (partyserver).

**Spec:** `docs/superpowers/specs/2026-11-19-computer-players-design.md` (sections Goals, Each game's bot, Tests, Latency, When a bot can't move).

**Research:** `.superpowers/sdd/2026-11-20-computer-players-part-2/bot-games-survey.md` in the worktree (git-ignored): per game, its actions, phases, who is awaited, off-turn moves, view contents, settings, `skipTurn`, stats and a suggested strategy, with file:line citations. Each game task's brief points to its section.

## Global Constraints

- A bot sees only `view = { playerId, public, private }` and `ctx`. It never imports server state or reads anything else. It changes nothing in the view.
- `decide` returns a legal action whenever the seat is in `getAwaitedPlayerIds`. It returns `null` when it has nothing to do. Off-turn (optional) moves are sent only when the view says they are allowed right now (`canCall`, `canReady`, `canRebuy`, ...). A rejected or throwing off-turn move ends the game for everyone (part 1 Ruling E).
- Off-turn choices that involve chance use `ctx.chance(key)` (Task 1), never `ctx.randomInt`, so asking again gives the same answer. Awaited moves may use `ctx.randomInt` (they are decided once, when the timer fires).
- After `ready` or any one-shot off-turn move is sent, `decide` returns `null` for that step (the view's flag goes false), so nothing loops.
- "Average person" play: a sensible move most of the time, a random legal move about 1 time in 8 to 10, bluffs and calls at believable rates. A beginner should win often enough to want another game.
- `decide` stays cheap: a few ms. Hold'em equity uses at most 200 Monte Carlo trials.
- Tests per game (`games/<id>/test/bot.test.ts`): unit tests for the obvious spots; an all-bot `playBots` run over seeds 1..200 at the game's `minPlayers`, `bestMinPlayers` and `maxPlayers` (cap the max at 7 if a run takes over ~5 s), and over each setting that changes legal moves. Each run: `outcome` not null, `rejected` and `stuck` empty, `longestRun < BOT_MAX_RUN` (Task 1). A "stays fast" check like Crazy Eights'.
- Each game task also: adds the game id to the list in `apps/server/test/games.test.ts` (kept sorted); adds the game to the "For now, that is ..." line in `docs/games/rooms.md`; adds one line to `docs/games/<id>.md` saying computers can play.
- Player copy: short plain sentences, basic words, no idioms, no emoji, for Indian readers of English as a second language.
- `PROTOCOL_VERSION` changes only if a wire type changes. Adding a field to a game's public state is not a wire change.
- Commit trailer, exactly:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01KwNUn8AHWzbftW559ZRTih`

## Review Focus

1. A bot sends an off-turn move the game no longer accepts (the window just closed, another bot already called). Expected: the bot checks the flag and returns `null`; the game never ends as "stuck" for this. Owned by Tasks 8-12 (Oh Hell, Liar's Dice and Thorns ready steps, Cheat calls, Hold'em rebuy and back); each tests "flag false -> null".
2. One seat moves many times in a row with nobody else moving (Sevens with 2 players and 3 decks; Overheat flipping alone; Farkle final-round chase). Expected: the game never trips `BOT_MAX_RUN`. Owned by Task 1 (`longestRun`) and each game's all-bot run.
3. A simultaneous step (President exchange, Thorns first placement, Oh Hell ready) where several bots are awaited at once. Expected: each bot answers once; the step ends.
4. Hold'em after every person busts: bots keep playing each other. Expected: the hand flow still ends the game in reasonable time, and a sat-out bot sends `back`.
5. A bot's random choice in a call window. Expected: its real call rate matches the intended rate, not a much higher one (Task 1 `chance`).

---

### Task 1: Bot context and runtime fixes for optional moves

**Files:**
- Modify: `packages/game-core/src/index.ts` (BotContext, export `BOT_MAX_RUN`)
- Modify: `packages/game-core/src/testing.ts` (`playBots`)
- Modify: `apps/server/src/runtime.ts` (`scheduleBots`, `onBotTimer`, use the shared `BOT_MAX_RUN`)
- Modify: `games/crazy-eights/server/bot.ts` only if its types need it
- Modify: `AGENTS.md` (computer players section)
- Test: `packages/game-core/test/bots.test.ts`, `apps/server/test/bots.test.ts`

**Interfaces:**
- Produces: `BotContext.chance(key: string): number`, an integer in `[0, 100)`, the same for the same seat, game and key every time it is asked. Runtime: `stableHash` of the game's start (the value that is fixed for one game, e.g. a stored game serial or seed) + seat id + key. `playBots`: `stableHash(seed + ":" + playerId + ":" + key)`.
- Produces: `export const BOT_MAX_RUN = 50` from `@games/game-core`; the runtime imports it.
- Produces: `BotRunResult.longestRun: number`: the most accepted actions by one seat with no other seat's accepted action between (fired timers don't count and don't reset it), matching how the runtime counts `botRun`.

- [ ] **Step 1: Tests first**
  - game-core: `chance` is stable (same key twice -> same value), differs across keys and seats over a sample, and stays in `[0, 100)`.
  - game-core: `playBots` hands `decide` deep-frozen copies of the views (`structuredClone` then freeze, so the live state is never frozen) (a bot that does `view.private.hand.sort()` throws inside `playBots` and shows up in `rejected` or as a thrown test error, your choice; say which).
  - game-core: `longestRun` is right for a toy where one seat moves 3 times in a row.
  - server: a bot timer that fires while the bot is not awaited and `decide` returns `null` does not bump `stateVersion` and sends no update; the fired timer is still removed from storage.
  - server: when `decide` throws during scheduling, the error is logged (`host.logError`) and no timer is set.
- [ ] **Step 2: Run them, see them fail.**
- [ ] **Step 3: Implement.** Keep one timer path; the "no change, no commit" rule may be a flag on the commit or an early return, whichever is smaller. The runtime's in-a-row cap uses the shared constant.
- [ ] **Step 4: Run** `pnpm vitest run packages/game-core apps/server/test games/crazy-eights` and `pnpm -r --no-bail typecheck`. All pass.
- [ ] **Step 5: AGENTS.md:** in the computer players section add the off-turn rule (check the view's flag, use `ctx.chance` for choices, return null after a one-shot move) and the `longestRun` check in tests.
- [ ] **Step 6: Commit** "Bots: stable chance for off-turn choices, no empty updates, run length in tests".

### Task 2: Old Maid

Survey section: old-maid (XS). Bot: on its turn, take a random slot from the source player's hand (about 1 in 3 an end slot). Nothing else.
- [ ] Unit test: awaited -> a slot in range; not awaited -> null.
- [ ] All-bot runs and the per-game list/docs from Global Constraints.
- [ ] Commit "Old Maid: computer players".

### Task 3: Go Fish

Survey section: go-fish (S).
- Memory from the public `asks` log: prefer asking a player who recently asked for a rank I hold; avoid a player who recently said "go fish" for it.
- Else ask for the rank I hold most of, at a random live player.
- About 1 in 4 turns: ignore memory (random askable rank and target).
- [ ] Unit tests: a recent ask is used; a known "go fish" target is avoided; never asks for a rank not in `askableRanks`.
- [ ] All-bot runs, list, docs. Commit "Go Fish: computer players".

### Task 4: Farkle

Survey section: farkle (S). Keep all triples-or-better and 1s; keep 5s only when they are the only scorers or reach the bank threshold; with 4+ dice and only singles, keep one die. Bank thresholds by dice left: 6 (hot) never under 1000; 4-5 at 500; 3 at 350; 1-2 at 250. Never bank under `entry` when not on board. Final round: roll until ahead of the top score. With three-farkle penalty on and 2 farkles: thresholds 100 lower. About 1 in 8 decisions: jitter the threshold by up to 150. Fallback: keep `bestSelection`.
- [ ] Unit tests: hot dice kept; never banks under entry; final-round chase.
- [ ] All-bot runs (each entry/target setting that changes play), list, docs. Commit "Farkle: computer players".

### Task 5: Sevens

Survey section: sevens (S). Play the card that opens the most of my own later cards in its suit (ties: the one that reaches the farthest own card); about 1 in 8 a random playable card. With `forcedPlay` off, never pass while holding a playable card (blocking passes by several bots can go round forever). Pass only when `canPass` and nothing plays.
- [ ] Unit tests: picks the opening card; never passes with a playable card.
- [ ] All-bot runs at 2 players with the largest deck setting too. **If any seed gives `longestRun >= BOT_MAX_RUN`, stop and report it with the seed; do not change the cap.** (The controller rules on it.)
- [ ] List, docs. Commit "Sevens: computer players".

### Task 6: President

Survey section: president (S). Exchange: give back the lowest `mustGive` cards (reuse `worstCards`). Lead: lowest rank in `playableRanks`, all copies; keep 2s and Aces unless the hand is 3 cards or fewer. Follow: lowest playable rank with exactly `need` cards; with more than 5 cards, pass instead of spending a 2 or Ace about 60% of the time (use `ctx.randomInt`: awaited). About 1 in 8 a random legal play.
- [ ] Unit tests: exchange gives the worst cards; follows with the lowest that fits; keeps power cards early.
- [ ] All-bot runs (each setting that changes legal plays, e.g. match skips), list, docs. Commit "President: computer players".

### Task 7: Overheat

Survey section: overheat (S). Check `pub.pending?.chooserId === me` before `currentPlayerId` (a Shove makes another seat choose). Flip if not flipped; then margin = gauge - heat - fuses (halved under turbo): bank at margin <= 4, flip at >= 7, between flip about 1 in 3; bank if banking wins. Shove: the opponent most likely to bust. Fuse: the leader. Wrench: bust a target if my highest card would push them over, else give my highest and take their lowest. Build legal targets from public state (or move a views-based `validTargets` into `shared/rules.ts`; say which).
- [ ] Unit tests: chooser path; banks at low margin; never targets an invalid player.
- [ ] All-bot runs, list, docs. Commit "Overheat: computer players".

### Task 8: Oh Hell

Survey section: oh-hell (M). Bid: count likely winners (high trumps; any trump when hand size <= 3; non-trump Aces; a King with 2+ of its suit counts half), round; move off `forbiddenBid` by 1. Play: need tricks -> lead highest / follow with the lowest card that wins, else lowest; enough tricks -> highest card that does not win, else highest. About 1 in 10 a random legal card. Round summary: send `ready` when `canReady` (deterministic), else null.
- [ ] Unit tests: never bids the forbidden bid; ducks when the bid is made; ready only when `canReady`.
- [ ] All-bot runs, list, docs. Commit "Oh Hell: computer players".

### Task 9: Liar's Dice

Survey section: liars-dice (M). P(bid true) from a binomial over unseen dice (1/3 per die when ones are wild for that face, else 1/6). Call liar when P(true) < a threshold in 0.25-0.4 (awaited: `randomInt` ok). Spot-on (if allowed) when P(exact) >= 0.3 and a 1-in-4 roll. Raise on the face I hold most of at its minimum quantity; if P(true) < 0.4 try the cheapest better face; else call. About 1 in 5 raises is a small bluff (quantity at most expected + 1). Opening: one under the expected count of my best face, at least 1; avoid opening on 1s with wild ones. Every bid passes `isLegalBid` before it is returned. Reveal: `ready` when `canReady`.
- [ ] Unit tests: calls an impossible bid; every returned bid is legal under each wild setting; ready only when allowed.
- [ ] All-bot runs (wild ones on/off, spot-on on/off), list, docs. Commit "Liar's Dice: computer players".

### Task 10: Thorns

Survey section: thorns (M). Place a thorn about 1 in 3 if it has one and none is on its mat yet; in turns, after 2+ own discs, bid about 1 in 3. Own-stack rule: with my thorn down, never bid above the roses on top of it (a sure loss); pass once `minBid` passes that. Fair value = my safe roses + about half the other discs; raise by 1 while `minBid` <= fair value, else pass; never bid the table total unless it is within fair value. Flip: from `canFlip`, the mat with the most discs left. Result: `ready` when `canReady`. Forced to bid with my thorn down: bid `minBid`.
- [ ] Unit tests: never over-bids past its own thorn; flips only allowed mats; first placement answers once.
- [ ] All-bot runs, list, docs. Commit "Thorns: computer players".

### Task 11: Cheat

Survey section: cheat (M). Add `decks` to the public state (fair, not secret; the client may ignore it).
- Play: honest when holding an allowed rank (all copies, max 4); with 1-2 cards left and an honest play, always honest. Lie when no honest play: 1 card (2 about 25%) claimed as the allowed rank. About 15% tack one junk card onto an honest play.
- Call window (off-turn): if `!canCall` -> null. Call for sure when the owner has 0 cards left or when claim count + my copies of that rank > 4 x decks. Else call when `ctx.chance(windowKey) < rate`: base 12, 30 for 3-4 cards claimed, halved when the pile is big. Else `pass` when passing is allowed (so the window can close early). `windowKey` names this window (pile size, who played, claim, count).
- [ ] Unit tests: certain-lie call; no move when `canCall` is false; the call decision is the same when asked twice; stats still counted (liesTold, rightCalls, ...).
- [ ] All-bot runs, list, docs. Commit "Cheat: computer players".

### Task 12: Hold'em

Survey section: holdem (M).
- `legal === null`: `rebuy` when `canRebuy`, `back` when `canBack`, never `show`; else null. Return before any heavy work.
- Preflop: 5-tier hand table; strong -> raise about 3 big blinds; playable -> call up to about 4 big blinds, sometimes raise; rest -> check if free, else fold (call about 15% when cheap). Short stack (under about 8 big blinds): push or fold.
- After the flop: equity by at most 200 Monte Carlo trials against the live opponents (unknown cards = deck minus my hole, board and any face-up cards), reusing `bestHand`/`compareHands`/`makeDeck`. Fold under pot odds (with about 10% looseness), call between, raise over about 0.65 (0.5 heads-up) sized 1/2 to 3/4 pot, bluff about 8-10% when checked to with 1-2 opponents. All-in over 0.8 equity.
- Raises are integers clamped to `[minRaiseTo, maxRaiseTo]`; `check` when `legal.check`; never `call` for 0.
- [ ] Unit tests: rebuy/back paths; folds trash to a big raise; never an illegal raise size; decide under 20 ms on the river with 5 opponents.
- [ ] All-bot runs (fewer seeds if slow, at least 50, and say so), including one where bots keep playing after the person busts. List, docs. Commit "Hold'em: computer players".
