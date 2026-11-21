# Play with computers: a link that opens a ready room

## Why

Solo and first-time visitors want to try a card or dice game alone. Today they must make a room, pick a game, and add computers by hand. A link should do all of that in one tap.

## Goals

- A link like `/play?game=cheat` (CouchParty) or `/?game=cheat` (master) shows the home screen with the name field. The create button reads "Play Cheat with computers".
- One tap makes a room. The person lands in the lobby with the game picked and the computers seated. They tap "Start game".
- `computers=N` is optional. The default is enough computers to reach the game's "Best for" count (`bestMinPlayers - 1`, at least 1).
- CouchParty's game list gets a "Play with computers" link on each game that has computer players.

## Non-goals

- Starting the game at once (the person can still change settings or send the link to a friend).
- Making the room when the page opens. A link preview or a reload must never make rooms.
- Opening room creation to everyone on master. Only the owner key makes rooms there.

## Approaches

1. **Server sets it up when the room is made (chosen).** `POST /api/rooms?game=<id>&computers=<n>` passes a setup to `claim`. The room starts on that game with the computers seated. Checked in one place, one commit, no flicker.
2. Client sets it up after joining: the host's client sends `select-game` and `add-bot` after it connects. No server change, but several round trips, a visible flicker, and a race with a friend joining first.
3. Start the game straight away. Rejected by the owner: a friend can't join, and settings and rules are skipped.

## Design

- **Server.**
  - A `RoomSetup` (`{ gameId: string; computers?: number }`) is parsed from the `/api/rooms` query.
  - `claim(grant, setup?)` applies the setup only when all of these hold: the game exists, it has a bot, and it is not locked for the room's tier.
  - The count is clamped to `1..maxSeats(def) - 1`.
  - A bad setup is ignored, and the room is a normal one. It is never an error.
  - Computers are seated exactly as `add-bot` seats them, through one shared helper.
  - The first person who joins becomes host, as today.
- **Manifest.**
  - `computers?: true` on `GameManifest` says the game has computer players.
  - A registry test checks it matches `def.bot` for every game.
  - The client and the CouchParty gallery read it.
- **Web shell.**
  - The home view reads `game` and `computers` from the address on the home path.
  - When the game is known and has `computers`, the create button says "Play <name> with computers".
  - `ShellOptions.createRoom` takes an optional setup and passes it on.
  - The default creator adds it to the `/api/rooms` query.
  - Unknown ids are ignored, and the button says "Create room".
- **CouchParty (product branch only).**
  - The gallery adds the link to games with `computers`.
  - `roomCreator` and `api.createRoom` pass the setup on.

## Left to the builder

- Exact copy on the gallery link and button. Short plain words, no emoji.
- Whether to strip the query from the address after the room is made. It goes away anyway, because the room has its own path.
