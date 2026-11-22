# Notes for agents

Party games for a group chat, played on phones. Read this before adding a game or touching the room.

## Where things live

- `games/<id>/`: one game. `shared/` (types, rules, manifest), `server/game.ts` (the `GameDefinition`), `client/` (the view), `test/`.
- `packages/game-core`: the game contract (`GameDefinition`), ballots, RNG, party recap stats and awards (`recap.ts`).
- `packages/protocol`: wire messages and room state. Bump `PROTOCOL_VERSION` when either changes shape.
- `apps/server`: the room runtime (`runtime.ts`, a Durable Object) and the game registry (`games.ts`).
- `apps/web`: the shell (lobby, results, recap) and the client registry (`src/games.ts`). `src/shell.ts` is the seam a host app uses.
- `apps/web/src/voice/`: room voice (mesh, audio, controller, push-to-talk). `views/voice-bar.ts` draws it.
- `docs/games/`: how each game and the room work, for players. Keep it in step with what ships.
- `apps/product-*` (CouchParty) live only on the `product` branch.

## Branches

Shared code lands on `master`. `product` merges `master` in, and adds only CouchParty's own apps on top. Never build a shared feature on `product`.

## Copy

Words players read: short, plain sentences, basic words, no idioms. Write for someone reading English as a second language. No emoji in the UI; icons are SVG.

## Adding a game: best player counts

Set `bestMinPlayers` and `bestMaxPlayers` in the manifest: the head counts the game plays best at, inside `minPlayers`..`maxPlayers`. The game list tags the game "Best for N" when the room has that many. `apps/server/test/games.test.ts` fails for a registered game without them.

## Adding a game: computer players

Computer players are optional. To give a game one:

1. Write `games/<id>/server/bot.ts` with a `GameBot` and set it as `bot` on the definition, and set `computers: true` on the manifest. `decide(view, ctx)` gets only the public and private views a person gets, never the server state. It must be pure: no memory between calls, and random only through `ctx`. It never changes the view. Keep it to a few ms.
2. Return a move whenever the game waits on that seat, including every extra step (like calling a suit). Return `null` only when there is nothing to do. The room treats `null` from a seat it waits on as stuck: it skips that turn once, and ends the game if it happens again.
3. Off-turn moves (call a bluff, ready up): the room asks `decide` on every update, also when the seat isn't waited on. Send such a move only when the view's flag says it's allowed now (`canCall`, `canReady`, ...); a refused or throwing off-turn move ends the game. Make the choice with `ctx.chance(key)` (0 to 99, the same answer each time for this seat, game and key), never `ctx.randomInt`, so asking again doesn't change its mind. The answer is fixed for the whole game, so the key must name the exact decision: the round or hand, and the bid or claim being answered, e.g. `call:${round}:${pileCount}:${claimBy}`. A bare `chance("call")` gives one answer all game, so the bot calls always or never. After a one-shot move the flag goes false and `decide` returns `null`. Moves the game waits on may use `ctx.randomInt`.
4. Test it: an all-bot `playBots` run (from `@games/game-core/testing`) over many seeds and table sizes, and each setting that changes play. Check that `outcome` is not null, `rejected` and `stuck` are empty, and `longestRun` is below `BOT_MAX_RUN` (the room's cap on one seat's moves in a row). See `games/crazy-eights/test/bot.test.ts`.
5. Add the game's id to the list in `apps/server/test/games.test.ts` ("lists exactly the games with computer players").
6. Add one line to `docs/games/<id>.md` saying computers can play, and name the game in the "Computer players" part of `docs/games/rooms.md`.

## Adding a game: pause

Pause is optional. The host can pause a game that has it. To give a game pause:

1. Define `pause(state, paused, ctx)` on the definition. It gets the state, whether the room is pausing (`paused` is true) or resuming (false), and `ctx`. When pausing, note `ctx.now` in your state. When resuming, shift your own deadline fields by the time paused (`ctx.now` minus the time you noted), and clear the note. The room holds the timers and stops `ctx.now` while paused. See Nightfall's `pause`.
2. Set `pausable: true` on the manifest.
3. Add the game's id to the list in `apps/server/test/games.test.ts` ("lists exactly the games that can pause").
4. Add one line to `docs/games/<id>.md` saying the host can pause, and test it like `Nightfall through the room` in `apps/server/test/host-controls.test.ts`.

## Adding a game: Space

Room voice uses Space for push-to-talk when nothing that takes Space has focus. If your game takes Space with nothing focused (jump, buzz), set `usesSpace: true` on the manifest. Then voice leaves Space alone while your game is on screen, and push-to-talk is the mic button only. Add the game's id to the list in `apps/server/test/games.test.ts` ("lists exactly the games that use Space"). Players never see this flag, so the player docs don't mention it.

## Adding a game: party recap stats

When the host ends the party, everyone gets a recap with awards like "Biggest liar" and "Most suspicious". The awards come from counts each game keeps. **Every new game reports them from day one.** A test enforces it: `apps/server/test/games.test.ts` fails for any registered game without `partyStats` that isn't on the old exempt list. Don't add to that list.

1. Pick the stat keys that fit your game's mechanics, from `STAT_KEYS` in `packages/game-core/src/index.ts`:

   | Your game has… | Count |
   |---|---|
   | claims or bids that can be false | `liesTold` for each false one; `liesUncaught` when nobody called it |
   | calling someone's bluff | `rightCalls` / `wrongCalls` for the caller |
   | bids or bets well above the odds | `bigBids` |
   | votes to throw someone out | `votesAgainst`, per vote received |
   | a hidden bad role (imposter, wolf, spy) | `survivedAsBad` for each round or day they get through |
   | other players picking your fake answer | `fooled`, per player fooled |
   | a race to answer or guess | `firstGuesses` for whoever's first |
   | votes on a plan or proposal | `noGoVotes`, per No-go cast |

   Most games fit one or two. Every game counts toward "Champion of the night" through its winners, with no extra work.

2. Keep the counts in server state as play happens: `stats: PartyStats` in the state type, `stats: {}` in `createGame`, and `bumpStat((state.stats ??= {}), playerId, "liesTold")` at the moment it happens. The `??=` covers a game stored before the field existed.
3. Return them: `partyStats(state) { return state.stats ?? {}; }` on the definition.
4. Never put the counts in `getPublicState` or `getPrivateState`. Some are secrets until the recap ("survived as a Wolf" names a Wolf).
5. Test it: a short scripted game in `test/game.test.ts` that checks `partyStats` gives the expected counts, and that the public and private state don't contain them.
6. Nothing fits your mechanic? Add a new key to `STAT_KEYS`, an award row to `RULES` in `packages/game-core/src/recap.ts` (title, minimum, line), and a test for it in `packages/game-core/test/recap.test.ts`. Don't stretch an old key to mean something else: two games sharing a key share an award.

Games without stats yet (the exempt list) can get them the same way. Take the game off the list in the same change.
