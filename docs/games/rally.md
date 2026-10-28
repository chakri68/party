# Rally

Everyone drives their own car down the same stage at once. Rivals are ghosts: no contact, just shame. 1–8 players.

> Rally and Blind Rally only appear on builds that ship the 3D engine. The hosted site has them; self-hosted copies don't.

## The short version

- Each player gets their own car. Up to four race; anyone past that watches.
- All cars run the same stage at the same time. You see the others as ghosts. You can't hit them and they can't hit you.
- Pass every checkpoint in order, then the finish. Your co-driver reads the pace notes along the top.
- Fastest time wins, resets included. A reset costs 5 seconds.
- Still out there when the time limit runs out: DNF.

## How it plays

1. **The grid.** When the host starts the game you land on the starting grid: the track cards, one card per car, and the rules for this race. You're already in a car; nobody picks seats. If all four are taken you watch, and the next free car is yours.
2. **Pick the track.** The host taps a track card, or everyone votes (see Settings). The cards show difficulty, length, landmarks and par time.
3. **Read your card, then ready up.** Your briefing card has every control for this race. Tap "I'm ready". That also loads the course ("Loading the stage").
4. **Start.** The host taps Start race once every car is ready. Three, two, one, GO.
5. **Drive.** Steer, watch the co-driver, keep the car on the road. Checkpoints count by themselves as you drive through them, in order.
6. **Finish.** Cross the line after the last checkpoint. The race ends when every car has finished or dropped out, when the time runs out, or when the host taps End race.

Start race is disabled, with the reason underneath, if nobody's in a car ("Nobody's in a car yet.") or someone hasn't readied up ("Waiting for 2 players to ready up.").

## Winning and scoring

- Finishers rank by time: the clock from GO plus 5 seconds per reset, minus any time your clock was stopped for a drop-out.
- Cars that didn't finish rank after every finisher, most checkpoints passed first ("DNF, 3/5 checkpoints").
- Times are compared to the tenth of a second. Equal times tie and show as one ("=2nd").
- The fastest finisher wins. A DNF can't.
- Results always count your resets, clean runs included: "2nd · Car 1 · Pine Panic, 1:51.0 (no resets)" or "(2 resets, +10 s)".
- Players without a car show as "Watched".

## Settings

Host picks these in the lobby. Everything else is fixed: always a race, always one shared stage, and every assist on.

| Setting | Options | What it changes |
| --- | --- | --- |
| Track | **Host picks**, Everyone votes | Host picks: the host taps a card. Everyone votes: one vote per car; a tie goes to a coin flip. |
| Time limit | 3 min, **5 min**, 8 min | Counts from GO. Still out there after that: DNF. |
| Camera | **Any**, Top-down, Chase, Bonnet | Which views you get. Any lets you cycle all three, starting in chase. |
| Weather | Clear, **Patchy cloud**, Murky | Mist hides bits of road. Same sky for everyone. |

## On your screen

The course fills the screen with a thin strip on top: your car's badge, the clock, a Reset button, a Notes button, and the trip meter. The host also has Start race / End race there.

Over the course: your speed in km/h with D or R for the way you're going, and the co-driver.

- **Co-driver.** The next call, how far away, and the one after: "RIGHT 4 in 120 m", "then HAIRPIN LEFT". Inside 15 metres it says "now". It's a guess from the last checkpoint and your trip meter, like a real co-driver's. It errs on the early side.
- **Notes.** Tap Notes for the stage's full pace notes, with metres along the clean line. The game never highlights your position there. Tap a line to mark your place; tap again to clear it.
- **Trip.** Metres you've actually driven, wrong turns included.
- **Map.** Your dot is on it, with live GPS. Ghosts never are.

### Controls

| Control | Keyboard | Touch |
| --- | --- | --- |
| Steer | A / D or Left / Right | Two pads under your left thumb (hold the phone sideways) |
| Gas | W or Up | The Gas pad, under your right thumb |
| Brake / reverse | S or Down. Keep holding once stopped and you reverse. | The Brake pad |
| Reset | R, twice | The Reset button, twice. The button reads "Again: +5 s" in between. |
| Camera | Y | |
| Map | M, or click the corner map | Tap the corner map |
| Zoom | - and = | |
| Rotate view | C | |
| GPS dot | G | |
| Mute engine | N | |

- The second R or tap has to come within 3 seconds, or the reset forgets.
- Slide a thumb from one pad to the other without lifting. Pressing steer and a pedal together works.
- If the page loses focus or the tab is hidden, your controls let go.
- Reset is greyed out before GO, while you're parked after a reset, and while you're paused.
- Nothing on a phone screen scrolls or zooms.

## When things go sideways

- **You drop mid-race.** Your clock stops, your car parks, and a banner counts down "You dropped out: 23 s to get back. Clock stopped." You have 30 seconds. After that you're DNF. When you're back, your course restarts and the car reappears at the last checkpoint the server counted. Paused time is taken off your final time.
- **You leave the room mid-race.** Your car is DNF.
- **Reset.** Costs 5 seconds. You go back to the last checkpoint the server counted, so a reset can't skip one, and the car sits still for 1.5 seconds. If the car falls out of the world, the game parks it and asks for the same reset, same cost.
- **A gate out of order,** or the finish before the last checkpoint, doesn't count. Go back and drive it.
- **Vote ties.** A coin flip, shown as one: "Tie: picked by coin flip". With no votes the track stays as it was.
- **Changing the track** un-readies everyone, since each course loads when you ready up.
- **Time's up, or End race.** Whoever's still out is DNF. End race asks the host to confirm.
- **Play again.** Everyone starts in the same cars, with the same colours, on the last track.
- **More than four players.** The rest watch from the grid. Players joining mid-race watch too.

## Tips

- Following a rival is allowed, and as good an idea as they are.
- Listen to the co-driver for the call after next as well as the next one. The "then" line is there for a reason.
- A lost, stuck car is cheaper to reset than to rescue.
