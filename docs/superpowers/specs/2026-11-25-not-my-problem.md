# Not My Problem! — Product & Game Design Specification

**Status:** Proposed / MVP design, revision 2 • **Game ID:** `not-my-problem`  
**Target:** `chakri68/party`, shared `master` branch  
**Players:** 3–8 (best 4–6) • **Target duration:** 10–15 minutes • **Platform:** mobile-first multiplayer web

> **Revision 2.** Changed after a review of revision 1 against the repository and a rough simulation of the deck. The main changes: the deck now grows with the player count and running out of cards ends the game; the first version has 10 cards; strikes are now warnings; reaction windows are longer and come only around Problems; you play cards first and draw last; Fake Report penalties are more even; there is a tiebreaker; and computer players come with the MVP. Section 15 lists every change and the reason for it.

## 1. Product vision

Everyone works at the world's most hopeless company. Problems keep coming, employees pass the blame, and the last employee who has not been fired wins. Make mistakes. Blame friends. Keep your job.

A light, original card game about passing a Problem around: hidden hands, quick reactions, bluffing and short-lived alliances. The design draws on the tension of games like Exploding Kittens, but the mechanics are its own (warnings, transfers, counters). That name, its art and its text never appear in the manifest, the player docs or the UI. Voice chat makes the arguing fun, but you never need it to play.

### Goals
- Explain the core rules in under two minutes; make each card explain itself.
- Keep players involved outside their turn with short, meaningful reactions, without needing fast reflexes.
- Reward planning and social play without memorization.
- Reuse the existing room, reconnect, timer, private-state, results, recap and computer-player systems.
- Keep waiting short and every reaction chain bounded.

### Non-goals (MVP)
No collectible cards, monetization, deck building, persistent progression, custom room runtime, AI-generated effects, or mandatory voice chat. No licensed art or text from other games.

## 2. Quick-start rules (player-facing)

1. You start with five cards and no warnings. Three warnings and you are fired.
2. On your turn, play up to two cards if you want. Then draw one card. Drawing ends your turn.
3. If you draw a Problem, fix it or pass it to someone else. They can push back, and other players can step in.
4. If nobody fixes a Problem, whoever holds it gets the warnings printed on it.
5. The last employee who has not been fired wins. If the cards run out first, the employee with the fewest warnings wins.

Copy note: all player-facing words follow AGENTS.md and must be easy for Indian readers who read English as a second language. Use "warning", never "strike" (in Indian English a strike usually means workers refusing to work).

## 3. Components and setup

Each employee has a private hand, a public warning count, a seat, a status, an optional public shield (Intern), and a public Overtime flag. All ordinary cards have unique instance IDs, even when they share a definition. Problem cards never go in a hand. They sit in a dedicated active-Problem slot.

Setup: shuffle only the action cards. Deal each player one Quick Fix and four other random action cards. Shuffle the Problems into the rest to make the draw pile. Start from the seat after the dealer. Nobody starts with a Problem. The draw pile order and every later shuffle stay private to the server.

### Starting deck (MVP; scales with player count; playtest values)

The deck size grows with N, the starting player count. After dealing, the draw pile is about 6N cards, so the pile running out is the game's natural clock (about six turns each).

| Card | Copies |
|---|---:|
| Quick Fix | N + 2 |
| Blame Game | N + 2 |
| Not Me | N |
| Revenge | floor(N/2) + 1 |
| Intern | floor(N/2) |
| HR Complaint | ceil(N/2) + 1 |
| Overtime | ceil(N/2) |
| Promotion | ceil(N/2) |
| Spy | ceil(N/2) |
| Fake Report | ceil(N/2) |
| **Problems** | **3N** |

Problems cycle through this weighted order: Server Down, Server Down, Data Leak, Angry Client, Server Down, Angry Client.

Example, N = 4: 32 action cards and 12 Problems. Dealing takes 20 cards, which leaves a draw pile of 12 actions and 12 Problems, 24 cards in all.

Why these numbers: a rough simulation (greedy players, 4000 seeds) of revision 1's fixed deck of about 76 cards with 2N + 4 Problems gave **0.23 players fired per 4-player game**, and the final standings were tied in **97–100% of games**. With Problems = 3N and the counts above, it gave about 1.3 / 1.9 / 3.0 / 4.2 players fired at N = 3 / 4 / 6 / 8, and a single winner in about 83% / 70% / 48% / 32% of games before the tiebreaker. Fewer Problems (2.5N or 2N) made being fired rare again. That simulation ignored HR Complaint, Fake Report and Overtime, so these are starting values. Tune them with a seeded bot simulation (section 12) before playtests.

## 4. Turn structure

Turns go clockwise through surviving seats. A round is one pass around the seats. Rounds show in the UI, and nothing in the rules depends on them.

| Phase | Behavior |
|---|---|
| Start | Action budget of two. Start the 25-second turn timer. |
| Action | The current player may play up to two proactive cards, then taps **Draw**. Proactive cards never start a reaction window (section 6), so this phase never pauses. |
| Draw | Draw one card (or two, if under Overtime, one at a time). An action card goes into the hand privately. A Problem becomes the active Problem, owned by the drawer. |
| Problem | The Problem owner gets a 15-second response timer: fix, transfer, bluff, or accept the warnings. Transfers open reaction windows (section 6). When the Problem is gone, carry on with any remaining Overtime draw. |
| End | Advance to the next surviving seat. |

- When the turn timer runs out in Action, the player draws, as if they had tapped Draw.
- When the Problem timer runs out, play a Quick Fix from the owner's hand if they hold one. Otherwise they accept the warnings. That way a player whose phone locks is not fired just for looking away.
- Problem responses and reactions do not use the action budget. Each one uses up the card played.
- There is no hand limit. Hands start at five and seldom grow large in a game of about six turns each.
- A player fired during their own turn takes no more actions. Their turn ends.

Playing cards first and drawing last means a turn never pauses halfway: the Problem comes at the end. This removes revision 1's "suspended turn" continuation and stops a reaction from using up the turn timer.

## 5. Card catalogue (MVP)

A card is spent once it is played, even if it is canceled. Targets must be surviving players unless stated otherwise. Hidden cards and draws never appear in public logs.

| Card | Timing | Effect / restrictions |
|---|---|---|
| Quick Fix | Problem response | Fix your current Problem. It is discarded. |
| Blame Game | Problem response | Pass your Problem to another surviving player. Not yourself, and not a player the Problem's rule forbids. Counts as one transfer attempt. |
| Not Me | Reaction (target) | When a Problem is passed to you, send it back. It stays with the player who passed it. |
| Revenge | Reaction (target) | When a Problem is passed to you, send it to a third player instead (not you, not the one who passed it). Counts as one transfer attempt; you can't play it when no attempts are left. |
| HR Complaint | Reaction (others) | In the HR window, cancel the last transfer move: the Blame Game, Not Me or Revenge that was just played. HR Complaint can't be canceled. |
| Fake Report | Problem response | Play this together with one other card face down, and claim the face-down card is a Quick Fix. Opens a challenge window (section 7). |
| Overtime | Proactive | Pick another employee. On their next turn they draw two cards instead of one, one at a time. Only one Overtime per employee at a time (public flag); a second can't target them. |
| Intern | Proactive | Put a public shield on yourself. It takes one future warning, then it is discarded. One shield per employee. |
| Promotion | Proactive | Remove one warning from yourself. Can't bring back a fired player. |
| Spy | Proactive | Take one random card from another employee's hand (it must not be empty). Only the two of you see which card. |

Proactive cards can only be played in your own Action phase.

### Problems

| Problem | Penalty if not fixed | Special rule |
|---|---:|---|
| Server Down | 1 warning | None. |
| Data Leak | 2 warnings | A shield takes only one of the two. |
| Angry Client | 1 warning | Can't move to the player it last moved away from (not by Blame Game, not by Revenge). |

The current owner and the transfer attempts left are public. A resolved Problem (fixed or penalized) goes to a separate resolved-Problems pile.

## 6. Reactions

The server holds all state and resolves every effect. No client applies an effect directly. Playing a card checks timing, ownership, target and budget, takes the card out of the hand, and creates a pending effect with a unique ID. Everyone sees the played card and its target.

Only transfers can be countered. Proactive cards, Quick Fix, accepting warnings and the Fake Report submission open no window. That keeps all waiting around the Problem, where the drama is.

Each transfer attempt (Blame Game) runs at most two windows, in order:

1. **Target window.** Only the target acts: Not Me, Revenge (pick a seat), or Accept. It closes as soon as the target chooses, or when time runs out (meaning Accept). One person decides, so nobody has to race.
2. **HR window.** The result is shown ("A passed it to B", "B sent it back", "B sent it on to C"). Every surviving player except the one who made the last move may play HR Complaint. The first HR Complaint the server receives wins. A later one is turned down privately and the card stays in that player's hand, so a slower player loses nothing. The window closes early when everyone eligible has passed.

Resolution:

- No HR Complaint: the last move stands. Blame Game alone moves the Problem to the target. Not Me leaves it with the source. Revenge moves it to the third player.
- HR Complaint: undo the last move. HR on a Blame Game keeps the Problem with the source. HR on Not Me or Revenge moves it to the original target.
- After any change, the Problem's holder gets a fresh 15-second response timer. That includes the source after a Not Me.

Bounds: each Problem has at most **4 transfer attempts**, counting Blame Game and Revenge, canceled ones included. After that only fix, bluff or accept remain. At most two windows run per attempt, so the stack can be no more than three deep (transfer, reaction, HR). Keep that as an assertion in code, not a player-facing rule. Show the attempts left in the UI.

Window length is a host setting: **Reaction time** 5 / **8** / 12 seconds (the same options as Cheat), default 8. Four seconds was too short for picking a card, then a seat, then confirming on a phone.

Privacy: whether a window opens and how long it lasts depends only on public state, never on whether someone holds a suitable card. Private legal-action flags (`canReact`, `canHr`, `canChallenge`) can limit what each player sees.

### Example
A draws Data Leak and plays Blame Game on B. In B's target window, B plays Revenge on C. In the HR window, D plays HR Complaint. The Revenge is undone and the Problem goes to B, the original target. B gets a fresh timer and plays Quick Fix. The Problem is discarded and A's turn ends.

## 7. Bluffing: Fake Report

The owner plays Fake Report plus one other card face down and claims it is a Quick Fix. It may really be one, which is a trap for a challenger. The server opens a challenge window (Reaction time setting) for the other surviving employees. The first challenge the server receives wins. A later one is turned down without cost.

- **No challenge:** the Problem is fixed. The face-down card goes to a hidden discard pile without being shown.
- **Right challenge** (it was not a Quick Fix): show the card. The bluffer takes the Problem's printed warnings **plus one**. The Problem is then resolved and discarded.
- **Wrong challenge** (it was a Quick Fix): show it. The challenger takes one warning. The Problem is fixed.

All played cards are spent. This copies the pattern of Cheat's call window. A challenge can't be countered, and a report gets only one challenge window.

Balance note: against a printed penalty of 1, bluffing beats accepting while the chance of a challenge is under one half, and every bluff caught costs one extra warning. A truthful report costs two cards, where Quick Fix costs one. That is the price of setting a trap.

## 8. Ending and results

- An employee is fired the moment they reach three warnings. Their hand and shield go to the discard pile, their Overtime flag is cleared, and their future turns are canceled. If they held the active Problem, it is discarded.
- **One survivor left:** that employee wins at once.
- **Draw pile empty and no active Problem:** the game ends. Among surviving employees, the fewest warnings wins. Tiebreaker: most cards in hand. Only players still tied after that share the win.
- **Round limit:** none in the MVP. The deck size is the clock.
- A fired player stays in the room as a spectator. They see public information and keep chat and voice. They can't see hands or act.
- **Results** (shell results view): survivors first, by fewest warnings and then most cards; then fired players, last fired first. The shell numbers places `i + 1`, so the game gives every player a distinct place. Each standing sets `label`, e.g. "1 warning" or "Fired 2nd", so the shell doesn't print "N cards left".

## 9. UX and visual direction

The look is a comically bad office: paper cards, red stamps, folders, warning labels and expressive drawings. Use readable type, distinct SVG icons and category labels, not color alone. Copy in plain, short sentences in basic English for Indian readers (AGENTS.md and the copy rule above). No emoji anywhere in the game UI.

### Mobile table
- Top: draw pile count, current turn, timer and compact seats showing warnings, hand counts, shield and Overtime flag.
- Center: a large active Problem with its owner, penalty and transfer attempts left; the current window; a short event feed.
- Bottom: your private hand (scrolls sideways or wraps), a card detail sheet, legal action buttons, **Draw**.
- Targeting: select a card, select a seat that is allowed, confirm. Highlight allowed seats clearly. Looking at a card never plays it.
- During a window: a compact prompt with who played what, what it will do, a countdown, the legal responses and Pass. Never cover the whole hand.
- An onboarding sheet with the quick-start rules and a grouped card list. Card text must match the server's rules exactly.
- Reconnect restores the current state, deadlines, legal actions and private hand. Animations are cosmetic and can be skipped. Reduced motion and accessible labels are required.

Sound cues for a new Problem, transfer, challenge, warning and game over are optional, follow the mute setting, and must not drown out voice.

## 10. Technical architecture

The platform has everything this needs. Checked in the repo:

- Private events (`EventVisibility`) and per-player private state.
- Several timers at once, keyed by `timerId`.
- An off-turn window with early close (Cheat: `step: "window"`, `canCall`, `getAwaitedPlayerIds` returning `[]`).
- `skipTurn`, `onPlayerDisconnected` / `Reconnected` / `Removed`, `pause`.
- Test deck injection (`CreateGameOptions.deck`) and `findLeaks` for privacy tests.

The protocol carries game state, actions and events as `unknown`, so **no `PROTOCOL_VERSION` bump**. Expect roughly 1500–2500 lines of server code, plus a sizable client. Most of the cost is in the client prompts and the test grid in section 12, not the platform.

```text
games/not-my-problem/
  shared/   manifest.ts  types.ts  cards.ts  rules.ts  rules-text.ts  index.ts
  server/   game.ts  effects.ts  projection.ts  bot.ts  index.ts
  client/   index.ts  view.ts  cards.ts  styles.css
  test/     game.test.ts  effects.test.ts  privacy.test.ts  bot.test.ts
```

Follow Cheat's file layout and the current client registry contract (`GameEntry` in `apps/web/src/games.ts`: manifest, section `cards`, rules, settingFields, loadClient).

### Integration checklist
- Register in `apps/server/src/games.ts` and `apps/web/src/games.ts`.
- Manifest: id, name, description, SVG icon key, minPlayers 3, maxPlayers 8, bestMinPlayers 4, bestMaxPlayers 6, `computers: true`, `pausable: true`.
- Add the id to the "computer players" and "can pause" lists in `apps/server/test/games.test.ts`.
- Implement `parseSettings`, `parseAction`, `createGame`, `handleAction`, `onTimer`, `getPublicState`, `getPrivateState`, `getAwaitedPlayerIds`, `getResult`, `partyStats`, `skipTurn`, `pause`, removal and disconnect hooks.
- Use `ctx.randomInt`, `ctx.now` and the shared `shuffle`. Never use ambient random or time.
- Use one reused window timer ID plus a window token in state (as Cheat does). Ignore stale timers and actions.
- Player docs at `docs/games/not-my-problem.md`, including the lines for computer players and pause. Name the game in the "Computer players" part of `docs/games/rooms.md`.

### `getAwaitedPlayerIds`
- Action phase: the turn player.
- Problem response: the Problem owner, not the turn player.
- Target window: the target.
- HR and challenge windows: `[]`. The clock is what's being waited on, not a player.

All game timers are at most 25 seconds, under the room's 60-second idle skip, so host skip matters mostly for disconnected seats. A skip uses the timeout default for that step.

### Pause
Store the time left on the active deadline when pausing, and restore it on resume (see Nightfall's `pause`).

### State model (illustrative)

```ts
type CardInstance = { id: string; definitionId: string };
type Step = 'action' | 'problem' | 'target-window' | 'hr-window' | 'challenge' | 'finished';
type PlayerState = {
  id: string; hand: CardInstance[]; warnings: number;
  fired: boolean; firedOrder: number | null; removed: boolean;
  shield: CardInstance | null; overtime: boolean;
};
type ProblemState = {
  card: CardInstance; ownerId: string; lastMovedFromId: string | null;
  transferAttempts: number;
};
type TransferMove =
  | { kind: 'blame'; actorId: string; card: CardInstance; targetId: string }
  | { kind: 'not-me'; actorId: string; card: CardInstance }
  | { kind: 'revenge'; actorId: string; card: CardInstance; targetId: string };
type State = {
  players: PlayerState[]; drawPile: CardInstance[];
  discard: CardInstance[]; hiddenDiscard: CardInstance[]; resolvedProblems: CardInstance[];
  step: Step; turnPlayerId: string; round: number; actionBudget: number;
  drawsLeft: number; problem: ProblemState | null;
  moves: TransferMove[];          // current attempt only: at most transfer + reaction
  hr: { actorId: string; card: CardInstance } | null;
  report: { ownerId: string; fakeReport: CardInstance; faceDown: CardInstance } | null;
  passed: string[]; deadline: number | null; windowToken: number;
  pausedLeftMs: number | null; stats: PartyStats;
};
```

Use explicit discriminated unions for card definitions, actions and steps. No scripts in card data. A finite set of typed effect handlers. Keep rule logic testable without DOM or Worker APIs.

### Information boundaries

| Public | Private (per recipient) | Server only |
|---|---|---|
| Seats, warnings, hand counts, shields, Overtime flags, turn, active Problem and attempts left, window state and timers, public discard | Own hand, legal actions, Spy result for the two players involved, own pending choices | Draw pile order, other hands, face-down Fake Report card (until challenged), hidden discard, party stats |

Test projections and event envelopes, including reconnect snapshots, with `findLeaks`.

### Client actions (illustrative)

`play-card` (proactive), `respond` (Quick Fix / Blame Game / Fake Report / accept), `react` (Not Me / Revenge / accept), `hr`, `challenge`, `pass`, `draw`. Each carries only the needed IDs, the chosen target and the current window token. The server checks phase, player, ownership, targets, budget, timing, deadline and transfer cap again. It never accepts a client-sent warning count, draw result or card definition.

### Disconnect and removal
- Disconnected players stay seated. Their windows time out with the default (Accept for a target, Pass otherwise). On their awaited step, the timeout default applies.
- On removal: discard their hand, shield and any active Problem they own. Undo pending moves that need them: a pending transfer to them fizzles, and the Problem stays with the source. Clear their Overtime. Then check the end conditions.

## 11. Party recap stats

`partyStats` from day one, never in projections.

- Fake Report uses the existing keys exactly as AGENTS.md defines them: `liesTold` for each report that wasn't a Quick Fix, `liesUncaught` when nobody challenged it, `rightCalls` / `wrongCalls` for the challenger.
- Add **one** new key, `problemsPassed`: one per Problem that ends up with someone else because of your Blame Game or Revenge (after HR). Its award row ("Not my problem", e.g. "Passed 5 Problems on.") goes in `RULES` in `packages/game-core/src/recap.ts`, with a test in `packages/game-core/test/recap.test.ts`.
- Recap shows at most 5 awards (`MAX_AWARDS`) and walks `RULES` in order, so a row placed last will seldom show. Decide its place in the order on purpose.
- Revision 1's "Office Hero" (Problems fixed) and "Office Menace" (counters) are dropped: fixing is routine, and the AGENTS table says most games need only one or two keys.

For playtesting, record locally: match length, time per turn, windows per Problem, players fired, cards played by type, wins by seat and abandonment. No analytics service.

## 12. Acceptance criteria and testing

- Every seat count from 3 to 8 can start. Each player gets exactly five action cards, including at least one Quick Fix, and no Problems. Deck sizes match section 3.
- Every card instance is in exactly one zone at all times (hand, pile, discard, hidden discard, pending move, shield, active Problem). No card is copied or lost through cancels, Spy or removal.
- Every card has tests for legal play, wrong phase, bad targets, card not owned, and its own edge cases.
- Transfer chains (each mix of Blame Game, Not Me, Revenge and HR), the transfer cap, Angry Client's rule after a Revenge, shield on Data Leak, both Fake Report outcomes, Overtime draws that hit Problems, and removal mid-window all give deterministic results.
- No stale action or timer can spend a card twice. A late HR Complaint or challenge costs nothing and reveals nothing.
- Public and other players' private views never contain hands, deck order or the face-down Fake Report card. Test events as well as snapshots.
- The match ends on one survivor or an empty draw pile. Tiebreaks and places are correct and distinct, and labels are set. Reconnect and host skip work in every step.
- The client works at 360px width, keyboard navigation works, countdowns are easy to read, and reduced motion works.
- **Bots:** an all-bot `playBots` run over many seeds and every seat count from 3 to 8: `outcome` not null, `rejected` and `stuck` empty, `longestRun` below `BOT_MAX_RUN`. Off-turn choices (HR, challenge) use `ctx.chance` keyed on the window, e.g. `hr:${problemId}:${attempt}:${moveIndex}`. Note that in `playBots` the lowest seat with a move goes first, so seat order decides "first HR wins" in simulations.
- **Balance harness:** a seeded script that totals bot games and reports players fired per game, single-winner rate and turns per game for each N. Use it to tune section 3 before playtests. Its numbers are only as good as the bots.
- Registry and recap tests pass, along with `pnpm test` and `pnpm typecheck`.
- Playtest targets (tuning goals, not guarantees): most new players get the loop after one turn, matches take 10–15 minutes, and off-turn play feels involved without long waits.

## 13. Delivery milestones

1. **Rules prototype:** Quick Fix, Blame Game, Not Me, HR Complaint, Server Down, warnings, both windows, the transfer cap, deterministic tests, a basic table and private hands. Simple bots plus the balance harness, to check the deck numbers early.
2. **Feature-complete MVP:** the other cards (Revenge, Fake Report, Overtime, Intern, Promotion, Spy), Data Leak and Angry Client, the end and tiebreak, results labels, recap stat, reconnect, pause, bots passing `playBots`, docs, and registration in both registries.
3. **Polish and balance:** animations, sounds, card list, accessibility, playtests at 3–8 players, then tuning copy counts and timers.
4. **Later expansion** (each needs its own interaction rules, privacy review and balance tests):
   - **Audit + Whistleblower** (hidden traps). Known problems: Audit is the only card played face down, so a "hidden action" always means Audit; quietly replacing a trap leaves the first player's private view either wrong or revealing; it's unclear whether Revenge sets off an Audit. Solve all three before shipping.
   - **Restructure** (call it "Reshuffle Desks" or similar), **Old Files** (was Dumpster Diving: take a card from the discard pile), **Reply All** (repeat an effect; plain name needed), **Office Gossip** (peek at cards), **Sick Leave** (skip a draw; check that it is fun), **Consultancy + Impossible Deadline** (only matter together).
   - Mystery Bug, Mass Outage, secret contracts, ghost voting, themed decks.

## 14. Open design decisions

- **Deck numbers.** Section 3 is a simulation-backed starting point, not final. Check with the bot harness, then playtests.
- **HR Complaint scope.** In the MVP it only cancels transfer moves. A wider HR (cancel Overtime or Spy) would add a window to proactive cards. Leave it out unless playtests say off-turn play is too thin.
- **Fake Report penalty.** Caught: printed penalty + 1. Wrong challenge: 1. Check how often bluffs happen and get called.
- **Timer lengths** (25 s turn, 15 s Problem, 8 s reaction default), and whether the Problem timeout should auto-play Quick Fix.
- **Three warnings.** Check whether three feels too forgiving at small N.
- **Dogpiling.** Check whether targeted transfers gang up on one player. A possible fix is "can't Blame Game the player who passed you your last Problem".
- Don't add complexity until the basic transfer loop is fun.

## 15. Changes from revision 1

| Change | Why |
|---|---|
| Deck scales with N (draw pile about 6N, Problems 3N, Quick Fix N + 2); empty pile ends the game; no round cap or late-game extra warnings | Revision 1's fixed deck of about 76 cards with 2N + 4 Problems meant about 4 Problems in a 4-player game: about 0.2 players fired, 97–100% tied endings. A fixed 6-round cap also made games about 6–8 min at N = 4 and about 20 min at N = 8. Late-game extra warnings made a late Data Leak fire anyone, which was not stated. |
| MVP cut to 10 cards and 3 Problems; the rest deferred | 18 cards with traps, hand swaps and repeats made a large rules engine and test grid. Audit has unsolved privacy problems (section 13). |
| Strikes are now warnings; Production Down → Server Down; Corporate Espionage → Spy; Dumpster Diving → Old Files (deferred) | "Strike" means workers refusing to work in Indian English. "Espionage" is a rare word. "Dumpster diving" is US slang. |
| Play cards first, draw last; Overtime acts on the target's next draw | No turn ever pauses halfway, so no stored continuation and no timer juggling. |
| Only transfers can be countered; a target window, then an HR window; first HR wins, later ones cost nothing | Revision 1 opened a 4 s window on every proactive card and up to 8 windows per Problem. The target window has one decider, so nobody races. The section 6 example (HR on Revenge) still works. |
| Reaction time setting 5 / 8 / 12 s, default 8 (was 4 s) | Picking a card, a seat and confirming on a phone takes longer than 4 s. Cheat uses the same options. |
| Fake Report: caught → printed penalty + 1, Problem resolved; wrong call → 1 | Revision 1 gave 2 warnings and left the Problem open, which in practice meant being fired. It also never said what the bluffer could do next. |
| Revenge counts toward the cap; Angry Client follows the last move; fresh timer after Not Me | These were not covered. |
| Problem timeout auto-plays a held Quick Fix | A locked phone shouldn't get you fired. |
| No hand limit | Hands seldom pass 10, and the limit added a whole phase. |
| Tiebreak (fewest warnings, then most cards) and distinct places with labels | Ties were nearly certain. The shell numbers places `i + 1` and can't show shared ranks. A shared win also counts every winner toward "Champion of the night". |
| Removed "all fired in one batch" and the depth-3 cap as a rule | Only one player is ever penalized at a time. The depth bound follows from the window structure. |
| One new stat key (`problemsPassed`) instead of three | Fixing is routine. Recap shows only 5 awards. |
| Bots and pause in the MVP | The game needs 3 or more players. Bots also drive the balance harness. Pause is a few lines. |
