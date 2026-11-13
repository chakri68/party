# Party recap

**Status:** spec, for review · **Date:** 2026-11-13
**Branch:** `product` · **Touches:** game-core, the shared room runtime and room view (`apps/server`, `apps/web`), six games, product web

When the host ends the party, everyone sees a recap of the night: who won the most, and a few awards like "Biggest liar: Sam". Players who joined get a way to start their own party. Today a room has no end. It sits empty for 6 hours and then deletes itself, and the room forgets each game as soon as the next one starts.

---

## 1. Decisions

| Decision | Choice | Why |
|---|---|---|
| When the recap shows | Host taps **End party**. Everyone in the room sees it at the same moment | A shared moment at the end of the night. No guessing when a party is "over" |
| What ends | The room. After End party nobody can start a game in it. Its link shows the recap until the room is cleaned up | A clear end. "Play again" is a new room |
| Awards | Two kinds: **any game** (from results every game already gives) and **game-specific** (from counts a game keeps) | Every game gets a recap from day one; the funny awards come from the games that have liars and votes |
| Game-specific awards, first batch | Cheat, Liar's Dice, Imposter, Nightfall, Fake Word + Bluff Definitions, Doodle Dash | Bluffing, voting and guessing make the best awards. Other games can add theirs later |
| Secrets | A game may count things that were hidden during play (lies nobody caught). The recap is the reveal | That's the fun of it. Only counts are shown, never cards or roles |
| Where it lives | Recap in shared code (self-hosted gets it). The "start your own party" prompts are product-only, through a new shell hook | Same split as the Host Pass sheet |
| Sharing | A **Share** button sends a short text recap with the site link (Web Share, or copy on desktop) | The group chat is where the next party starts |
| Empty party | End party with no finished games skips the recap and just closes the room | Nothing to show |

Out of scope: recap images, saved history across rooms (Host Pass "Saved game history" is its own feature), awards for the other 22 games, ending the party automatically.

## 2. Data

### Game side (game-core)

One optional method on `GameDefinition`, read once when a game finishes, next to `carryOver`:

```ts
/** Counts for the party recap, per player. Read once, when the game finishes. */
partyStats?(state: TState): Record<string, Partial<Record<StatKey, number>>>;
```

`StatKey` is a fixed list in game-core, shared by all games, so two games can feed the same award (both bluff games count `fooled`):

| StatKey | Meaning | Fed by |
|---|---|---|
| `liesTold` | claims or bids that were false | Cheat, Liar's Dice |
| `liesUncaught` | false claims nobody called | Cheat |
| `rightCalls` | called a bluff and was right | Cheat, Liar's Dice |
| `wrongCalls` | called a bluff and was wrong | Cheat, Liar's Dice |
| `bigBids` | bids above the table's honest average | Liar's Dice |
| `votesAgainst` | votes received to be thrown out | Imposter, Nightfall |
| `survivedAsBad` | rounds survived as imposter or wolf | Imposter, Nightfall |
| `fooled` | other players who picked your fake answer | Fake Word, Bluff Definitions |
| `firstGuesses` | turns where you guessed first | Doodle Dash |

Each game keeps these counts in its own state as it plays (most already hold the facts: Cheat's reveal has `lied`, Liar's Dice has `success`, Nightfall keeps `days[].votes`). The plan checks each game and adds counters where the state forgets.

### Room side (runtime)

`RoomData` gets a party log, saved with the rest of the room:

```ts
party: {
  startedAt: number;
  games: Array<{ gameId: string; endedAt: number; winnerIds: string[]; loserIds?: string[]; stats: Record<string, Partial<Record<StatKey, number>>> }>;
  names: Record<string, string>;   // every player who finished a game, so leavers still show by name
  endedAt: number | null;           // set by End party
}
```

- A game is logged when `getResult` first turns non-null (runtime.ts, where the phase becomes `results`). A game ended early with "back to lobby" is not logged.
- The log keeps at most 50 games. Older entries drop first.
- Computer players are left out of awards, but still count in game winners for the results screen as today.

## 3. Awards

`recap.ts` in game-core turns the log into a `Recap`. Pure, so the tests and the self-hosted app run the same code.

```ts
interface Recap {
  gamesPlayed: number;
  minutes: number;
  topGame: string | null;          // most played, by product name
  awards: Array<{ id: string; title: string; who: string[]; line: string }>;
}
```

The award table, in the order it is tried:

| id | Title | Rule | Line |
|---|---|---|---|
| `champion` | Champion of the night | most game wins, at least 2 | "Won 4 of 6 games." |
| `liar` | Biggest liar | most `liesUncaught`, else most `liesTold`, at least 3 | "Told 9 lies. Got caught 2 times." |
| `eye` | Sharpest eye | most `rightCalls`, at least 2 | "Called 5 bluffs. All right." |
| `suspicious` | Most suspicious | most `votesAgainst`, at least 3 | "Got 7 votes against them." |
| `sneaky` | Best actor | most `survivedAsBad` + `fooled`, at least 2 | "Fooled the table 6 times." |
| `bold` | Boldest bidder | most `bigBids`, at least 3 | "Made 8 big bids." |
| `quick` | Fastest guesser | most `firstGuesses`, at least 2 | "Guessed first 5 times." |
| `trusting` | Too trusting | most `wrongCalls`, at least 3 | "Called 4 bluffs. All wrong." |

- **A tie** names everyone tied ("Sam and Mei"), up to 3. More than 3 tied: the award is skipped.
- **At most 5 awards**, taken in table order. Champion always comes first when it qualifies.
- **One award per player**, where possible: a player who already has an award is passed over for the next one if someone else is close (within 1). So the recap spreads across the room.
- **Nothing qualifies:** the recap still shows the games played and the time, with "Quiet night. Play more to earn awards."

All copy follows the site rule: short, plain sentences, no idioms.

## 4. Protocol and runtime

- New host-only client message `end-party`. Allowed in the lobby or on the results screen, not mid-game (the host ends the game first).
- On `end-party`: set `party.endedAt`, clear `game`, set the room phase to `ended`, broadcast the room state. `publicState()` carries `recap: Recap | null` when the phase is `ended`.
- In phase `ended`, every game message (select, start, settings) is refused. Chat and reactions still work, so people can talk about the recap.
- Anyone who opens the link later still joins as a viewer and sees the recap, until the 6-hour cleanup removes the room. After that, the "room closed" screen as today.
- Product `Room` needs nothing new. The D1 `rooms` row is not touched.

## 5. Web

### Shared (apps/web)

- **End party** button for the host, in the lobby next to the game picker and on the results screen. Tapping it asks once: "End the party for everyone? You will see the recap." (an inline confirm, not a browser dialog).
- **Recap screen**, the same for host and players:
  - Title "Tonight's recap", then "6 games · 1 hr 20 min · Most played: Cheat".
  - One card per award: title, name(s) in large type, the line under it. Cards rise in one after another; reduced motion shows them at once.
  - **Share** button: Web Share with text like "CouchParty recap: Biggest liar: Sam. Sharpest eye: Mei. Champion of the night: Arjun. Play at couchpartygames.com" (the link comes from the brand config). Desktop without Web Share copies it and says "Copied".
  - Under it, whatever the host app puts in the new hook slot (below). Self-hosted shows a plain **Home** button.
- **Room closed** screen (`room-not-found`) also gets the hook slot.

### Shell hook

```ts
// ShellOptions
partyOver?(outlet: HTMLElement, ctx: { isHost: boolean; recap: Recap | null }): void;
```

Called once on the recap screen and once on the room-closed screen (`recap: null` there).

### Product (apps/product-web)

What the hook puts in, by who you are:

| Who | Shows |
|---|---|
| Player who joined | "Your turn to host." · "Start your own party. It is free, and your friends do not need an app." · button **Start a room** · small line "Want every game and 16 players? See Host Pass" linking to `/pricing` |
| Host, no pass | **Start a new room** · "Get Host Pass for every game and up to 16 players." with a link to `/pricing` |
| Host with a pass | **Start a new room** only |
| Room closed screen | "This party is over." · **Start your own room** · "It is free. No app needed." |

"Start a room" goes to `/play`, the same as the landing page. Only the host check uses `/api/me`; a failed call shows the "no pass" version.

## 6. Testing

- **Unit, game-core `recap.ts`:** each award's rule and minimum; ties of 2 and of 4; the five-award cap; spreading awards across players; computer players left out; empty log; a leaver still named.
- **Unit, runtime:** a finished game is logged once; back-to-lobby logs nothing; `end-party` from a non-host or mid-game is refused; after `end-party` start and select are refused and chat still works; a late joiner gets the recap; the 50-game cap.
- **Unit, each of the six games:** a short scripted game gives the expected `partyStats` (for example, a Cheat game with 3 uncaught lies reports `liesUncaught: 3` for that player).
- **Browser, local:** a 3-player room (three tabs) plays two games, ends the party, and all three see the same recap; Share copies the text; the player tabs show "Your turn to host", the host tab shows the Host Pass line. Phone and desktop, light and dark.
