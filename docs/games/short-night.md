# Short Night

One night, one talk, one vote. Find a wolf before the morning's out. 4–10 players.

## The short version

- Everyone gets a secret card. Most are village. One or two are Wolves.
- There's one night. Each role that acts gets a short step and learns something true about the table.
- Then you talk out loud, then vote for who goes.
- Vote out a Wolf and the village wins. Anything else, the Wolves win.
- One round, no scores. The game ends at the vote.

## How it plays

1. **Your card (30 s).** Tap the card to see your role. Tap **Got it** when you've looked. The night starts when everyone has, or at 30 seconds. The order of tonight's steps is listed on screen, and so is the deck.
2. **Night.** Each role in the deck that acts gets its own step, in a fixed order: Wolf, Lamplighter, Matchmaker, Bellringer, Eavesdropper, Wanderer. Roles not in the deck get no step. Every step runs its full length (10, 15 or 20 seconds, the host's pick), whether or not anyone's acting. The top of the screen shows which step you're on, such as "Lamplighter · 2 of 5".
3. **Morning (the Talking time).** "Talk it out." Out loud. Claim whatever you like; Wolves lie. The host can tap **Vote now** to skip ahead.
4. **Vote (20 s).** Tap a player or **Nobody goes**. Not yourself. You can change your vote until the clock runs out or everyone's in. The screen shows "x of y in".
5. **Runoff (10 s).** If two or more players tie for the most votes, only they are on the ballot. Still tied, or nobody votes: nobody goes.
6. **Dawn.** The game ends and everything's shown: every card, what each role picked and learned, and who voted for whom.

## Night screens look the same for everyone

This is on purpose. If your phone behaved differently when you were the one awake, it'd give you away.

- **Everyone picks on every step.** The headline reads "The Lamplighter is awake. Everyone picks a player." on every phone. The number of players to pick (one or two) comes from the step, not your card. The list is everyone but you, in seat order, with a **Confirm** button that unlocks when you've picked the right number.
- **Only the awake role's picks count.** The server only receives a pick from a player whose card matches the current step. Everyone else's Confirm just locks their screen, and the sub-line says as much: "Only the picks of the card that's awake count. Pick anyway, so nobody can tell whose turn it is."
- **Steps never end early.** The clock gives nothing away. A step runs its full time even after the acting player has picked.
- **Same sound and buzz on every phone** when a step starts.
- **Your result goes on your card, face down.** You never see it on the main screen. It's in the card under "Your night:", behind the tap to reveal.
- **The deck and the step order are public.** Seeing a step on the list tells you the role is in the deck, not who holds it.

In the code: `games/short-night/client/view.ts` (`pickCount`, `press`, `renderPanel`) makes every phone ask the same question and show the same list, and only sends a pick when your card is the one awake. `games/short-night/server/game.ts` ignores everyone else and never ends a step early.

## Roles

"Reads as a wolf" is what the team-check roles (Lamplighter, Matchmaker, Bellringer, Eavesdropper) see. A Wolf reads as a wolf, and so does the Stray. They can't tell those apart. The Wanderer and a lone Wolf see real cards. Everything you learn at night is true, and nobody's card ever changes.

### Wolf

- **Team:** Wolves. Up to 3 in a deck.
- **Does:** wakes first, and doesn't pick anything.
- **Learns:** who the other Wolves are. If you're the only Wolf, you learn one random Villager instead ("Ben holds a Villager"), or that no Villagers were dealt.

### Lamplighter

- **Team:** Village. Unique.
- **Does:** picks one player.
- **Learns:** whether they read as village or as a wolf.

### Matchmaker

- **Team:** Village. Unique.
- **Does:** picks two players.
- **Learns:** whether they read as the same side or different sides.

### Bellringer

- **Team:** Village. Unique.
- **Does:** nothing; the bell rings by itself.
- **Learns:** how many of the players seated on either side of you read as wolves: none, one or both. Seats are in the order shown at the table, and the circle wraps around.

### Eavesdropper

- **Team:** Village. Unique.
- **Does:** nothing; the names come to you.
- **Learns:** two names, at least one of whom reads as a wolf. You don't learn which.

### Wanderer

- **Team:** Village. Unique.
- **Does:** picks one player.
- **Learns:** one card that player doesn't hold. It's drawn from the cards in the deck, and it's never "Wanderer".

### Stray

- **Team:** Village. Unique.
- **Does:** no night step.
- **Learns:** nothing. You're on the village's side, but you read as a wolf to the Lamplighter, Matchmaker, Bellringer and Eavesdropper. Voting out the Stray doesn't win it for the village.

### Villager

- **Team:** Village. Up to 10 in a deck.
- **Does:** no night step. Wits only.
- **Learns:** nothing.

If a picker doesn't pick before their step ends, their card says "You didn't pick in time." and they learn nothing.

## Winning and scoring

No scores. The vote decides:

- The player voted out is a **Wolf**: the village wins.
- Anyone else voted out (the Stray included), or **Nobody goes**: the Wolves win.

Nobody goes if no player got a vote, or if "Nobody goes" got more votes than any player. If it ties with the top player, the tied players go to the runoff.

Winners are everyone on the winning team who's still in the room. The Dawn screen lists each player's card with won or lost.

## Settings

Host picks these in the lobby.

| Setting | Options | What it changes |
| --- | --- | --- |
| Roles | **Standard** (default), Beginner, Full, Custom | The deck. See below. The hint under it lists the deck, such as "2 Wolf, 1 Lamplighter, 1 Matchmaker, 1 Eavesdropper, 1 Villager", or says what's wrong with it. |
| Talking time | 3 min, **4 min** (default), 5 min, 6 min | How long the morning talk lasts. |
| Night step | 10 s, **15 s** (default), 20 s | How long each night step runs. The hint shows how many steps and how many seconds of night. |

**Presets** scale to the head count. Wolves are 1 at 4–5 players and 2 at 6–10. Then the extras fit in order, and Villagers fill what's left.

| Preset | Extras |
| --- | --- |
| Beginner | Lamplighter |
| Standard | Lamplighter, Matchmaker, Eavesdropper |
| Full | Lamplighter, Matchmaker, Eavesdropper, Bellringer, Wanderer, Stray |

**Custom** adds a row of counts, one per role. Picking Custom starts you from the current preset's deck. Counts go from 0 to a role's maximum: Wolf 3, Villager 10, every other role 1. The deck must:

- add up to exactly the number of players ("Need exactly 6 role cards (have 5)");
- hold at least one Wolf and at least one Village card;
- leave at least two cards that aren't Wolves ("Needs at least two non-wolf cards").

With fewer than 4 players in the room, the Roles hint just lists the deck instead of complaining. The host can't start while the deck has a problem. A preset deck always fits.

## On your screen

- **Your card.** Face down. Tap to reveal, tap to hide again. It hides itself the moment you switch tabs or apps, so a phone left on a table doesn't leak your role. It shows your role, your team, a one-line description, and (once it's your step) your night result.
- **Night order.** During the reveal and the night, the steps in the deck are listed and the current one is marked.
- **The timer and bar** run along the top. The last 5 seconds of a vote or runoff tick out loud.
- **Vote.** Tap a name, or **Nobody goes**. Highlighted means chosen.
- **Dawn.** Lists every card, the night log (who held what, who picked whom, what they learned), and both ballots.
- **Sounds and buzzes** mark each night step, morning, a vote opening, and the result.

## When things go sideways

- **Someone's connection drops.** They don't hold up the reveal or the ballots. If nobody's connected, the clock decides.
- **Someone leaves.** Their card stays on the table, secret until Dawn. Votes for them go back to their voters. A step for their role still runs its full length.
- **The last Wolf leaves.** The game ends: "The last Wolf left. No winner."
- **Fewer than 3 players are left.** "Too few players left. No winner."
- **A runoff is down to one candidate** because the other left: "A runoff candidate left. No winner." A leave alone doesn't decide who goes.
- **A timer runs out.** Reveal: the night starts. Night: the next step (or morning). Morning: the vote opens. Vote: it counts what's in. Missing votes just don't count. A host stuck waiting on someone at the reveal gets a **Skip** button for them.
- **Rematch.** After Dawn, non-hosts tap **Play again**; the host taps **Rematch** or **Back to lobby**. The deck is dealt again for whoever's there. If the head count changed and the deck no longer fits, the lobby says what's wrong.

## Tips

- All results are true, but "reads as" isn't "is". A Lamplighter's "wolf" could be the Stray.
- Everyone sees the deck. A claim of a role that isn't in it is a lie.
- Claims that disagree with each other can't both be true. Use that.
