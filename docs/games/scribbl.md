# Scribbl

One of you draws a word, everyone else races to guess it. Faster guesses score more. 2–12 players.

## The short version
- One player draws at a time. Everyone else types guesses into the chat box.
- A correct guess scores 300 points at the start of the clock, falling to 50 at the buzzer. The drawer scores for every guesser.
- Everyone draws once per round. Most points after the last round wins.

## How it plays
1. A turn opens with the drawer picking one of three words. Only they see the options. You have 15 seconds; run out and one is picked for you.
2. The drawing clock starts. The drawer sketches on the canvas and can't type.
3. Everyone else sees blanks showing the word's length (a word like "hot dog" shows as `3 3`) and types guesses.
4. Letters get filled in as the clock runs down. Words of 3 letters or fewer get none, 4–5 letters get one, longer words get two. The first lands 60% of the way through (50% if there are two), the second at 75%. The last hidden letter is never given away.
5. The turn ends when time's up or everyone who's present has guessed.
6. The word shows for 5 seconds along with who scored what, then the next player draws.

When every seat has drawn, that's one round. Then the next round starts, and so on.

## Winning and scoring
- **Guessers:** 50 to 300 points, scaled to the time left on the clock and rounded to the nearest 5.
- **Drawer:** 200 split across everyone who could guess, rounded to the nearest 5, earned each time someone gets it. If you draw so well that all guess, you collect roughly 200 in total.
- After the last round, the highest score wins. Ties share the win. If nobody scored, nobody wins.
- If the game gets called off early because too few players are left, the scoreboard is shown with no winner.

## Settings
Host picks these in the lobby.

| Setting | Options | What it changes |
| --- | --- | --- |
| Rounds | 2, **3**, 4, 5 | How many times each player draws. The lobby shows the total drawings and a rough time estimate. |
| Time to draw | 60 s, **80 s**, 100 s, 120 s | The length of the drawing clock. Higher means the top score decays more slowly. |

## On your screen
- **Top bar:** the round, the word (blanks, or the word itself if you know it), and a countdown.
- **Canvas:** the drawing, live. Draw with a mouse, finger or pen.
- **Drawer's tools (only you see them):** 14 colours, four brush sizes, Eraser, Undo, Clear.
- **Drawing limits:** a drawing can use up to 16,000 points and 1,500 strokes. Undo and Clear don't give the ink back.
- **Players list:** scores, a "drawing" tag on the drawer and "got it" on anyone who's guessed.
- **Chat box:** type guesses here. Case, accents, spaces and hyphens don't matter, so "Ice-cream", "ice cream" and "icecream" are the same guess. Messages are capped at 60 characters.
- **"close!":** if your guess is one typo off a word of 4+ letters, you get a "close!" line that only you see.
- **After you guess it:** your messages only go to the drawer and other people who've got it. They show as a separate, spoiler-safe line. People who haven't guessed can't read them.
- **Outside a drawing:** while nobody's mid-guess (picking, reveal), everyone can chat normally.
- **Sound and haptics:** a tick for the last 5 seconds of a drawing, a sound on correct guesses, a nudge on "close!", and a vibration when it's your turn to draw.

## When things go sideways
- **Drawer doesn't pick:** after 15 seconds a random word from their three is chosen.
- **Drawer removed by the host mid-drawing:** the turn ends right away ("<name> left.") and the word is shown.
- **Drawer removed while picking:** their turn is skipped.
- **Drawer disconnects mid-drawing:** nothing special happens. The clock keeps running until time's up or everyone's guessed.
- **A guesser drops:** they're ignored when checking if everyone has guessed. If they were the last one holding things up, the turn ends.
- **You're away on your turn:** your turn is skipped ("is away and misses their turn"), not made up later.
- **Fewer than two players left:** the game ends.
- **Nobody guesses:** the turn ends at time's up with no points.
- Words don't repeat within a game until the list runs out.

## Tips
- Guess fast. The score drops with the clock, and there's no penalty for wrong guesses.
- Drawers earn from every correct guess, so a clear drawing beats a clever one.
