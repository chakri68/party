# Treasure Hunt

Every round is a new 3D map with hidden caches on it. Play in teams. Read your clues, find the caches and pick them up. Walk, or drive a buggy with a friend. 1–8 players.

> Treasure Hunt only appears in dev builds for now (`pnpm dev`). The hosted site and self-hosted copies don't list it yet.

## The short version

- You need a computer with a keyboard and a mouse. Phones and tablets only see a message.
- You play in teams. If you play alone, you are a team of one.
- The map is new every round. Everyone starts at the same place.
- Your team gets a list of clues. Each clue points to one hidden cache.
- Walk, run and jump. Get in a buggy to go far.
- Walk up to a cache and press **E** to pick it up. You must be on foot.
- **Timed:** the team with the most caches when the time ends wins. **Race:** the first team to find the set number wins.

## How it plays

1. **Pick a team.** While the map loads, a panel shows all the teams. Each team has a colour and a shape. Press **Join** to go to a team, or **New team** to make one. There can be 8 teams at most. Next to each name it says "loading" or "ready".
2. **The host starts.** The host can move players to other teams. The host can press **Start** once at least one player's map is ready. Players whose map is still loading watch this round. Everyone else sees "The host will start the game."
3. **Get ready.** A big 3, 2, 1 shows over the map. Nobody can move until it ends.
4. **Hunt.** Click the map to look around with the mouse. Your team's clues are in a box on the right. **Hide clues** and **Show clues** in the strip above the map close and open it. The strip also shows the time left and your team's score.
5. **Pick up a cache.** A cache is a small wooden box. It shows up when someone on your team is close to it, about 40 m. Walk up to it, get out of the buggy, and press **E**. The clue gets a tick.
6. **End.** The round ends when the time runs out, or when the hunt is over. The host can also press **End round** to end it early.
7. **Replay.** After the round, a map shows where every team went, with a mark at each cache they found. Move the time slider to watch it again.

## Timed and Race

| | Timed | Race |
| --- | --- | --- |
| Clues | Each team has its own list. Every list has the same number of caches and about the same mix of easy and hard ones. | All teams share one list. 3 clues are open at the start. 1 more opens each time any team finds a cache. |
| A found cache | Only counts for your team. | Is gone for everyone. Other teams see it struck out and marked "Taken". |
| Score | "3 of 6 found" | "2 of 5", with "Race to 5" next to it |
| The round ends | When the time runs out, or when every team has found all its caches. | When a team finds the set number, when every cache is found, or when the time runs out. |

## Buggies

- A buggy has 2 seats: the driver and the passenger.
- Walk up to a buggy and press **E** to get in. The first person in drives. The second person sits next to them.
- The passenger does not drive. They can look around and drop pins.
- Press **E** again to get out.

## Pins

- Press **P** to drop a pin where you are looking. You can also click on the full map.
- Each player can have 5 pins. A 6th pin removes your oldest one.
- Only your team sees your pins. Your own pins have a ring.

## The map

- The minimap always shows where your teammates are.
- It shows other teams only when they are within 150 m of you.
- Press **M** to open the full map of the island. Press **M** again to close it.

## Other players

- Every player is a figure in their team's colour, with a name tag over it. You can see the tag when they are within 50 m.
- Players and buggies pass through each other. Nobody can push you or block you.

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

The team with the most caches wins. If two teams found the same number, the team with the harder caches wins. If it is still a tie, the team that found its last cache first wins. If nobody found a cache, nobody wins.

## Controls

| Key | What it does |
| --- | --- |
| Mouse | Look around (click the map first) |
| W, A, S, D or the arrow keys | Move, or drive the buggy |
| Shift | Run |
| Space | Jump |
| E | Get in or out of a buggy, or pick up a cache when you are next to one |
| P | Drop a pin where you are looking |
| M | Open or close the full map |
| R | Put the buggy back on its wheels if it flips or gets stuck |
| Esc | Free the mouse |

## Settings

| Setting | Choices | What it does |
| --- | --- | --- |
| Mode | Timed or Race (Timed to start with) | How the round is won. See above. |
| Round length | 15, 30 or 60 minutes (30 to start with) | How long the hunt lasts. In Race too. |
| Caches to win | 3 to 10 (5 to start with) | Race only. How many caches a team must find to win. |

## When things go wrong

- **The map did not load.** Press **Try again**. It downloads it again from the start.
- **Your phone joined.** It shows "Treasure Hunt needs a computer with a keyboard and mouse." It still counts as ready. It also shows the teams, so a host on a phone can still pick teams and start.
- **Pressing E does not pick up the cache.** A short message says why:
  - "Get out of the buggy first."
  - "Go closer to the cache."
  - "Wait a moment and try again." This shows when you just drove very fast, or the game lost your place for a moment.
  - "Another team found this cache first." This is Race.
- **The host cannot start.** It says "Waiting for the map to load." Wait until at least one player's map is ready.
- **Someone leaves.** The round goes on without them. If everyone leaves, it is over.
