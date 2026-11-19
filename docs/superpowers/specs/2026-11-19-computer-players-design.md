# Computer players: design

Date: 2026-11-19. Status: draft, waiting for approval.

## Why

People land on the site alone, mostly first-time visitors who want to see what a game is like before they bring friends, and people who want to practise a game on their own. Today a card game can't start with one person, so they bounce. Computer players ("computers" in the UI, "bots" in code) let one person fill a table and play.

Bots are a try-it and practice table, not the main way to play. Success: one person opens a room, adds computers, starts a card game and finishes it, and the game felt like playing people: not instant, not unbeatable, not stupid.

## Goals

- A host can add and remove computers in the lobby, for games that support them.
- Bots play the 12 card and dice games: Sevens, Crazy Eights, Old Maid, Go Fish, President, Cheat, Oh Hell, Hold'em, Liar's Dice, Farkle, Overheat, Thorns.
- One level, "plays like an average person": sensible moves, the odd mistake, bluffs sometimes. Losing badly every game is the worst outcome for a first-timer.
- Bots think for about 1 to 2.5 seconds before each move, so the table feels alive.
- The room machinery (seats, timing, lobby, recap) is written once. A game adds one `decide()` function and its tests.

## Non-goals

- Bots in word, drawing, talking, hidden-role or racing games (Scribbl, Fake Word, Bluff Definitions, Same Page, Don't Say It, Face-Off, Chain Words, Pass the Bomb, Imposter, Nightfall, Short Night, Heist, Long Trail, The Wilds, Blind Rally, Rally, Treasure Hunt).
- Difficulty levels. Can come later if people ask.
- Bots taking over the seat of a person who leaves mid-game.
- Moving Dominion's own bots onto this system. Dominion keeps its "Computers" setting and its in-game bots for now.
- "Try it now" from the landing page (approach B in the conversation). It comes later as a room-creation parameter, roughly "start with game X and N computers". This design should make that a thin layer: create room, add N bots, select game. Nothing in this design should block it.

## Anti-goals

- A bot that sees anything a person in its seat wouldn't. No peeking at hands, the deck or other private state, ever.
- A bot whose move skips the game's own rules check.
- A room or game that gets stuck because a bot can't or won't move.
- Bots that crowd out people: a person must always be able to take a seat a bot is holding (see "Seats and caps").

## Approaches considered

1. **The room owns bot seats; each game adds `decide()`. Picked.** The room seats bots, drives their turns from `getAwaitedPlayerIds`, and sends each move through `handleAction`. Each game writes a pure decision function. Seats, timing, lobby, recap and safety are written once.
2. **Each game adds bots itself, like Dominion.** A "Computers" setting and in-game bot players per game. Rejected: the seat, timing and naming code repeated 12 times, a different lobby per game, and the room's minimum-player check still needs changing.
3. **Bots as fake socket clients.** A server-side "player" connects and plays like a phone. Rejected: socket, reconnect and token handling just to send moves the server can make directly, and harder to test.

## Where it runs

On the server, in the room's Durable Object, next to the game rules. Nothing runs on the host's device: the host can lock their phone and bots keep playing. In self-hosting (`scripts/host.mjs`) the server is the laptop running it, so bots run there.

## Design

### Seats

- `SeatData` and `SeatPublic` get `bot?: true`. A bot seat has an id (`bot-` plus a short random id), a name, an `avatarSeed`, `presence: "connected"`, `ready: true`, `owner: false`, no resume token anyone holds, and never a `suggestion`.
- Names come from a fixed list of short, common, easy-to-read names that suit Indian players (for example Asha, Ravi, Meera, Arjun, Priya, Kiran, Neha, Vikram). The room picks one that no seated person or bot already uses.
- Seat rows in the lobby and in games show a small "computer" tag (text, no emoji) next to a bot's name, the same way "host" shows.

### Protocol

- New client messages, host only, lobby only: `add-bot` and `remove-bot { seatId }`. Anyone else, or any other phase, gets the usual non-fatal error.
- `SeatPublic.bot` goes on the wire. Bump `PROTOCOL_VERSION`.

### Which games allow bots

- `GameDefinition` gets an optional `bot` member: `{ decide(view, ctx): TAction | null }`. A game supports bots exactly when it has one. The manifest doesn't change, so a game can't claim bot support without an implementation.
- `RoomPublicState` tells the client which games allow bots (for example `botGameIds`), so the lobby can show the button and grey out the rest.

### What `decide()` sees

- `view`: `{ playerId, public: getPublicState(state), private: getPrivateState(state, playerId) }`. Exactly what that seat's phone gets. Never the raw state.
- `ctx`: `randomInt` from the room's RNG, so seeded test games replay exactly. Nothing else.
- It returns one action (in the game's own action shape, already valid for `parseAction`) or `null` for "I have nothing to do".
- It must be pure: no state of its own across calls. If a game's bot needs memory (say, which cards it has seen played), it works it out from the public state the game already shows, or the game adds that to the public or private view, which people see too.

### Driving turns

Some moves aren't turns. Cheat's call window awaits nobody (the clock closes it, or every possible caller passing). Hold'em's `rebuy` and `show` are sent while the bot isn't awaited. So the room can't drive bots from `getAwaitedPlayerIds` alone. *(Builder check; my call.)*

- After every committed change while a game is playing, the room asks `decide()` for each bot seat that has no pending bot timer. `null` means "nothing to do right now". A non-null answer means "I want to move": the room sets a timer `bot:<seatId>` (delay as in "Latency"). Bot timers use their own prefix, not `GAME_TIMER_PREFIX`, and the game never sees them.
- When `bot:<seatId>` fires, the room calls `decide()` again on the current state; the earlier answer is never stored, because things may have changed. If it returns an action, run it through `handleAction` exactly as a person's action is run (`applyTransition(result.transition, true)`), then commit. That commit asks every bot again, which schedules any next move, including a second move by the same bot.
- If it now returns `null` and the bot is not awaited, that's fine: the moment passed (say, someone else already called Cheat).
- Optional moves are where bluff-catching lives. Cheat's bot decides to call or let it go inside the call window, and Hold'em's busted bot can rebuy. The all-bot tests must exercise these.
- Asking every bot after every change is cheap: a few bots, a few milliseconds each at most (see "Latency").

### Latency

Bots must never make a person wait on the server, and bot-heavy tables shouldn't drag. Balanced against keeping one simple code path:

- **A person's move is never held up by a bot.** Bots never run inside a person's action. The person's update is committed and broadcast first. The bot's move comes from its own timer, as its own commit.
- **One path for timers.** Bot timers use the room's existing timer table and Durable Object alarm, the same as game timers. They survive the object being evicted. No in-memory `setTimeout` side path, even though it would save a few milliseconds of scheduling. Two timer systems aren't worth that.
- **Think time scales with the table.** The pause is there to feel human, not to slow things down. Rough targets, tuned by the builder:
  - about 0.8 to 1.6 s for a normal move;
  - about 0.4 s when the bot has only one legal move;
  - shorter when several bots move in a row, so the wait between two of a person's turns stays under about 5 s at a full table of bots.
- **`decide()` is cheap.** Simple rules and weights, no deep search. Budget: a few milliseconds at most, so it never stalls the room for the other players. Hold'em-style odds use a small fixed number of samples, not open-ended ones.
- **No extra round trips.** A bot move costs exactly what a person's move costs: one transition, one commit, one broadcast. Several bots due at once fire in the same alarm and share one commit.

*Update 2026-11-19: the pause was too fast to follow. It is now 1.6 to 2.6 s for a normal move (shorter only above 4 bots, never under 1 s) and 0.9 to 1.3 s for a follow-up move by the same bot.*

### When a bot can't move

This must never leave a game stuck.

A bot is **stuck** when its timer fires while it's awaited and `decide` returns `null`, throws, or returns an action `handleAction` rejects. Also when one bot seat makes more than a fixed number of moves in a row (for example 50) with no other seat moving in between; bots taking turns against each other, or bots playing on while a person who is out watches, never trip it. *(Builder check; my call.)*

When a bot is stuck:

1. Log it with the game id, the seat and the reason.
2. Call the game's `skipTurn(state, botId)`. All 12 games have it.
3. If that leaves the bot still awaited and stuck on its next try, **end the game back to the lobby**, the same way the host's `return-to-lobby` does: clear game and bot timers, drop disconnected seats, reset ready. Everyone sees a short message: "A computer player got stuck, so the game ended." The game doesn't count in the recap. This is a new room path (none exists today); the message may need a small wire addition, which rides the same `PROTOCOL_VERSION` bump.

Every game with a bot has a test that plays many seeded all-bot games to the end (see "Tests"), so these paths should never fire in practice.

### When no person is watching

*(Builder check; my call.)*

- **Paused:** while no person in the room is `connected`, bots don't move. Locked phones and dropped Wi-Fi land here: bot timers aren't set, and the room asks the bots again the moment a person reconnects. A bot game left alone doesn't burn alarms, and nobody misses half a game.
- **Ended:** if every person who is in the game has `left` (they pressed Leave, or the host removed them), the game ends back to the lobby the same way as a stuck bot, without the stuck message and without a recap entry. There's nobody to play for.
- **Still playing:** a person who is out of the hand (busted, out of dice) but still seated is watching. Bots play on.

### Seats and caps

- Bots count toward the game's `minPlayers` and `maxPlayers` and the free CouchParty room's seat cap, like people.
- "Add computer" is disabled when the table is full for the selected game (`maxSeats`).
- **A person always gets in:** when someone joins a full lobby that has bots, the room removes the newest bot to make room, so a person is never turned away for a computer. During a game, joining works as it does today: bots aren't removed mid-game.
- At least one person must be seated to start. The owner rule (`ownerHere`) already guarantees that.

### Room rules that must ignore bots

- **Host:** a bot is never host. Host migration skips bot seats.
- **Cleanup:** an empty room is one with no connected people. Bots don't keep a room alive, and they don't hold off the cleanup timer.
- **Presence and grace:** bots are always "connected". No grace timers, no disconnect or reconnect hooks for them.
- **Nudge and turn signal:** a person can't nudge a bot. The "waiting for" line still names a bot that's thinking.
- **Chat and emotes:** bots don't chat or react.
- **Suggestions:** bots don't suggest games, and their seats don't count in suggestion counts.

### Switching games

- When the host picks a game without bot support while bots are seated, the room keeps the bots. In the game list, games without bot support are greyed out (not selectable by the host) with the line "Remove computers to play this". One tap removes all computers. Bots are never removed silently, so going back to a card game keeps the setup.
- If bots are seated and the current game somehow doesn't support them (a room stored before this shipped), Start is disabled with the same line.

### Party recap

- Bots win and lose games like anyone, and the results screen shows that. But they get no awards and can't be "Champion of the night". `logGame` already filters by "human"; it now also treats bot seats as not human, for players, winners, losers and stats.

### Lobby UI

- Host sees "Add computer" under the seat list when the selected game supports bots, with a short line under it: "Computers play by the same rules. They only see their own cards."
- Each bot row has a remove button for the host, in the same place as the kick button for people.
- Non-hosts see the bot rows but no controls.
- Copy follows AGENTS.md: short plain sentences, basic words, no idioms, no emoji, icons as SVG.

### Each game's bot

For each of the 12 games:

- `games/<id>/server/bot.ts` with `decide()`, wired as `bot` on the game definition.
- Average-person play: pick a sensible move most of the time, a worse legal one sometimes, and in bluffing games bluff and call at believable rates. The builder tunes the exact numbers per game. The bar is that a beginner can win often enough to want another game.
- The game's `docs/games/<id>.md` says computers can play, in a line.

## Tests

- **Room:** add and remove bots (host only, lobby only); caps; a person joining a full lobby bumps the newest bot; bot never becomes host; bots don't keep a room alive; bot timers fire and play; a bot takes a move it isn't awaited for (toy game with an optional move); a `null`, throwing or rejected `decide` goes to `skipTurn`, then to the lobby; the in-a-row cap; bots pause with no person connected and resume on reconnect; the game ends when every person has left; recap has no bot awards; switching to a non-bot game is blocked until computers are removed.
- **Per game:**
  - `decide()` unit tests for the obvious spots.
  - An all-bot run: many seeded games (for example 200) with only bots, at several table sizes. Each must finish within a move cap, every move must be accepted by `handleAction`, and `decide` must never return `null` while the bot is awaited.
  - A no-peeking test: `decide()` gives the same answer when everything outside its own view changes.
- **Registry:** a test lists which games have `bot`. Adding bots to a new game updates that list on purpose.

## Build order

1. Room support, protocol and lobby UI, with a test-only toy game that has a bot. Ship it with no real game having `bot`, so nothing changes for players yet.
2. One pilot game end to end (Crazy Eights: simple rules, lots of turns). Play it by hand before going further.
3. The other 11 games, a few at a time, each with its own tests and review.

Each step is its own commit, reviewed by a high-effort subagent before the next one.

## Left to the builder

- Exact bot names list, delay range and the move-in-a-row cap.
- The exact shape of `botGameIds` on the wire.
- Each game's strategy and tuning numbers, inside "average person".
- Where the lobby button and copy sit, inside the existing lobby style.
