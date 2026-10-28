# Imposter

Everyone knows the secret but one. Clue it or talk it out, and find the one bluffing. 3–12 players.

Two modes: **Typed clues** (a secret word) and **Spoken, places** (a secret place, no typing). The host picks in the lobby. Same bones either way: one Imposter per round, a vote, a last guess if they're caught.

## The short version

- Each round, one player is the Imposter. Nobody's told who.
- Everyone else knows the secret. The Imposter knows only the category (typed clues) or nothing (spoken).
- You prove you know it without giving it away, then vote for the Imposter.
- Catch them and they get one guess at the secret. Right, and they steal the round.
- Innocents who catch the Imposter get 2 points each. Anything else, the Imposter gets 2. Most points after the last round wins.

## How it plays

### Typed clues (the default)

1. **Your card (20 s).** Tap the card to see it. Innocents get the secret word and its category. The Imposter gets "Imposter" and the category. Tap **Got it** when you've looked. The phase ends when everyone's done, or at 20 seconds.
2. **Clues (60 s).** Everyone types one clue, up to 40 characters, at the same time. Innocents can't use the word itself, even inside a longer clue (it's refused with "That's the word. Something else."). The Imposter's clue is never checked against the word, because a refusal would give it away. No clue by the deadline, and you show as "no clue".
3. **Talk it over.** The clues go up together, in shuffled order. You talk out loud, and room chat's open, for the Talking time the host set. The host can tap **Vote now** to cut it short.
4. **Vote (30 s).** Tap a player. Not yourself. You can change your vote until the clock runs out or everyone's in.
5. **Runoff (30 s).** If the top spot is tied, only the tied players are on the ballot. A runoff that's still tied is settled by a coin the server flips, so someone is always accused.
6. **The reveal.** The accused player's role is announced: Imposter or not. This lasts 5 seconds.
7. **Last guess (20 s).** If the accused was the Imposter, they type a guess at the word. Everyone else watches.
8. **Round over (10 s).** The result and the word show. The host can tap **Next round** (or **Finish** on the last one); otherwise it moves on by itself.

### Spoken, places

1. **Your card (20 s).** Innocents get a place. The Imposter gets "No place for you. Listen, and work out where." Every screen also has a full list of the 41 places, Imposter included, under **All places**.
2. **Talk (4, 6 or 8 minutes, the host's pick).** Nobody types. Ask each other questions out loud. One player is named as the suggested first asker; after that, anyone can ask. Answer so the others know you've been there, without telling the Imposter where. The host can tap **Vote now** to end it early.
3. **I know where we are.** Once a round, the Imposter can stop the clock. See below.
4. **Vote (30 s), runoff (30 s), the reveal (5 s).** Same as typed clues.
5. **Last guess (30 s).** The caught Imposter taps a place off the list, then confirms with a second tap on "It's the ...".
6. **Round over (10 s).** Same as above.

### I know where we are

In spoken mode, the button's on every player's screen and looks identical, so seeing it proves nothing. Tap it once and it arms for 4 seconds ("Tap again to stop the clock"). A second tap within that window goes through, but only for the Imposter. If you're not the Imposter, you get a note only you can see: "You're not the Imposter. Keep asking."

When the Imposter stops the clock, everyone sees "The Imposter stopped the clock", without a name. The Imposter then picks a place (30 s). Right, and the Imposter takes the round. Wrong, and the innocents do.

## Roles

Two roles, dealt fresh each round. There's no deck to configure: it's always one Imposter.

### Innocent

- **Team:** innocents.
- **Does:** knows the secret. In typed clues, gives a clue that shows they know it. In spoken mode, asks and answers questions.
- **Learns:** the word and category (typed clues) or the place (spoken).

### Imposter

- **Team:** alone.
- **Does:** bluffs. In typed clues, gives a clue that fits the category. In spoken mode, listens for where everyone is. If caught, guesses the secret. In spoken mode, can stop the clock early to guess the place.
- **Learns:** the category (typed clues only). Nothing else until the round ends.

Who's Imposter: it's picked from whoever's been Imposter the fewest times so far, so everyone gets a turn before anyone gets a second one.

## Winning and scoring

Per round, one side scores 2 points: each innocent, or the Imposter alone.

| What happened | Who scores 2 |
| --- | --- |
| Imposter caught, then guesses wrong or runs out of time | Innocents |
| Imposter caught, then guesses right | Imposter |
| Someone innocent is accused | Imposter |
| Nobody got a vote at all | Imposter |
| Spoken: Imposter stopped the clock and picked the place | Imposter |
| Spoken: Imposter stopped the clock and picked wrong | Innocents |

Most points after the last round wins. Tied top scores share the win.

Typed guesses ignore case, accents, spaces and punctuation ("ice-cream" and "ice cream" are the same), and a plural counts ("lamp" matches "lamps"). One letter off between real words isn't a match, but shows "So close." on the result. Spoken guesses are exact: the place you tap is the place or it isn't.

## Settings

Host picks these in the lobby.

| Setting | Options | What it changes |
| --- | --- | --- |
| Mode | **Typed clues** (default), Spoken, places | Which of the two games above you play. |
| Rounds | 3, **5** (default), 7 | How many rounds. The hint shows a rough maximum in minutes. |
| Talking time | Typed clues: 30 s, **60 s** (default), 90 s. Spoken: 4 min, **6 min** (default), 8 min | The talk phase. Which row shows depends on the mode. |

## On your screen

- **Your card.** Face down. Tap to reveal, tap to hide. It turns itself face down when you switch tabs or apps. After you tap **Got it**, it's turned face down for you. The card face looks the same for everyone, apart from the words on it.
- **Category** (typed clues) sits above the card, in the open.
- **Round and phase** along the top, with a countdown. The last 5 seconds of timed phases tick out loud.
- **The table.** Everyone's score, a tick when they're done with the current step, their clue once clues are in, and vote counts after the vote.
- **Vote.** Tap a name. Your pick is highlighted, and you can change it.
- **Sounds and buzzes** mark a new round, the clues going up, the vote opening, the reveal, and the result. A rejected action shakes the box.

## When things go sideways

- **Someone's connection drops.** They don't hold up the reveal, clues or vote. If nobody's connected, the clock decides.
- **Someone leaves.** If fewer than three players remain, the game ends: "Not enough players left." The Imposter and the secret are shown, and nobody wins.
- **The Imposter leaves before the reveal.** The round is thrown out and dealt again with the same round number: "Someone left mid-round. New word, new Imposter." (or "New place..." in spoken mode.)
- **The Imposter leaves after being caught, or after stopping the clock.** Their guess counts as a miss.
- **Votes for a player who leaves** go back to the people who cast them, who can vote again.
- **A timer runs out.** Reveal: you move on. Clues: whoever hasn't sent one shows "no clue". Vote: it counts whatever's in. Last guess: no guess, a miss. A host stuck on a missing player gets a **Skip** button for them.
- **Nobody votes in the first vote.** The Imposter takes the round.
- **Play again.** Words and places already used this game are carried into the rematch, so you won't see them back until the pack's spent.

## Tips

- Typed clues: a clue that's too exact tells the Imposter the word. One that's too vague points at you.
- The Imposter can't be refused for a bad clue, so a clue that merely fits is safe for them. Watch for ones that fit a bit too well.
- Spoken: the place list is public. Questions that split two similar places are worth more than ones that fit a lot of them.
