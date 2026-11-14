# Notes for agents

Party games for a group chat, played on phones. Read this before adding a game or touching the room.

## Where things live

- `games/<id>/`: one game. `shared/` (types, rules, manifest), `server/game.ts` (the `GameDefinition`), `client/` (the view), `test/`.
- `packages/game-core`: the game contract (`GameDefinition`), ballots, RNG, party recap stats and awards (`recap.ts`).
- `packages/protocol`: wire messages and room state. Bump `PROTOCOL_VERSION` when either changes shape.
- `apps/server`: the room runtime (`runtime.ts`, a Durable Object) and the game registry (`games.ts`).
- `apps/web`: the shell (lobby, results, recap) and the client registry (`src/games.ts`). `src/shell.ts` is the seam a host app uses.
- `docs/games/`: how each game and the room work, for players. Keep it in step with what ships.
- `apps/product-*` (CouchParty) live only on the `product` branch.

## Branches

Shared code lands on `master`. `product` merges `master` in, and adds only CouchParty's own apps on top. Never build a shared feature on `product`.

## Copy

Words players read: short, plain sentences, basic words, no idioms. Write for someone reading English as a second language. No emoji in the UI; icons are SVG.

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

   Most games fit one or two. Every game counts toward "Champion of the night" through its winners, with no extra work.

2. Keep the counts in server state as play happens: `stats: PartyStats` in the state type, `stats: {}` in `createGame`, and `bumpStat((state.stats ??= {}), playerId, "liesTold")` at the moment it happens. The `??=` covers a game stored before the field existed.
3. Return them: `partyStats(state) { return state.stats ?? {}; }` on the definition.
4. Never put the counts in `getPublicState` or `getPrivateState`. Some are secrets until the recap ("survived as a Wolf" names a Wolf).
5. Test it: a short scripted game in `test/game.test.ts` that checks `partyStats` gives the expected counts, and that the public and private state don't contain them.
6. Nothing fits your mechanic? Add a new key to `STAT_KEYS`, an award row to `RULES` in `packages/game-core/src/recap.ts` (title, minimum, line), and a test for it in `packages/game-core/test/recap.test.ts`. Don't stretch an old key to mean something else: two games sharing a key share an award.

Games without stats yet (the exempt list) can get them the same way. Take the game off the list in the same change.
