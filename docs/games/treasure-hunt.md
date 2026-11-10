# Treasure Hunt

Every round is a new 3D map with hidden caches on it. Read your clues, find the caches and pick them up before the time runs out. Walk, or drive the buggy. 1–8 players.

> Treasure Hunt only appears in dev builds for now (`pnpm dev`). The hosted site and self-hosted copies don't list it yet.

## The short version

- You need a computer with a keyboard and a mouse. Phones and tablets only see a message.
- The map is new every round. Everyone starts at the same place.
- You get a list of clues. Each clue points to one hidden cache.
- Walk, run and jump. Get in the buggy to go far.
- Walk up to a cache and press **E** to pick it up. You must be on foot.
- The player who finds the most caches before the time runs out wins.

## How it plays

1. **The map loads.** After the host starts the game, the map downloads and then builds. A bar shows how much has come in.
2. **Wait for the others.** When your map is ready, you see "Waiting for N players". The round starts when everyone has the map.
3. **Get ready.** A big 3, 2, 1 shows over the map. Nobody can move until it ends.
4. **Hunt.** Click the map to look around with the mouse. Your clues are in a box on the right. **Hide clues** and **Show clues** in the strip above the map close and open it. The strip also shows the time left and how many caches you have found, like "3 of 6 found".
5. **Pick up a cache.** A cache is a small wooden box. It shows up only when you are close to it, about 40 m. Walk up to it, get out of the buggy, and press **E**. The clue gets a tick.
6. **End.** The round ends when the time runs out, or when everyone has found all their caches. The host can also press **End round** to end it early.

Everyone gets a different list, but every list has the same number of caches and about the same mix of easy and hard ones.

If someone's map does not load in 60 seconds, the round starts without them. When their map loads, they can still walk around, but they have no clues.

## Clues

There are three kinds of clue. The easy ones come first.

| Kind | Example | What it means |
| --- | --- | --- |
| A place | "By the door of the red lighthouse." | The cache is at that place. Look around it. |
| Between two places | "Between the orange camp and the yellow plane, nearer the orange camp." | The cache is near the line between them, closer to the one named last. |
| Distance and direction | "About 150 m from the grey stone circle, at 90°." | Stand at the grey stone circle. Face 90° and walk about 150 m. |

Some caches have two clues. Directions are in degrees, clockwise from north. **0° is north**, 90° is east, 180° is south and 270° is west. The strip at the top of the map shows where you are facing.

Every place on the map has its own colour word, like "the red lighthouse". So a clue always means one place.

## Winning

The player with the most caches wins. If two players found the same number, the one with the harder caches wins. If it is still a tie, the one who found their last cache first wins. If nobody found a cache, nobody wins.

## Controls

| Key | What it does |
| --- | --- |
| Mouse | Look around (click the map first) |
| W, A, S, D or the arrow keys | Move, or drive the buggy |
| Shift | Run |
| Space | Jump |
| E | Get in or out of the buggy, or pick up a cache when you are next to one |
| R | Put the buggy back on its wheels if it flips or gets stuck |
| Esc | Free the mouse |

## Settings

| Setting | Choices | What it does |
| --- | --- | --- |
| Round length | 15, 30 or 60 minutes (30 to start with) | How long the hunt lasts. This is Timed mode, the only mode for now. |

## When things go wrong

- **The map did not load.** Press **Try again**. It downloads it again from the start.
- **Your phone joined.** It shows "Treasure Hunt needs a computer with a keyboard and mouse." It still counts as ready, so the round is not held up.
- **Pressing E does not pick up the cache.** A short message says why:
  - "Get out of the buggy first."
  - "Go closer to the cache."
  - "Wait a moment and try again." This shows when you just drove very fast, or the game lost your place for a moment.
- **Someone leaves.** The round goes on without them. If everyone leaves, it is over.
