# Blind Rally

One of you drives without seeing the road. The other sees it all and has to talk them through. 2–12 players.

> Blind Rally and Rally only appear on builds that ship the 3D engine. The hosted site has them; self-hosted copies don't.

## The short version

- You race in pairs. The Driver has the pedals, a speedo and a compass, and no road. The Navigator sees the course and the car, and can't touch a thing.
- Talk. Out loud, in the same room or on a call. The game doesn't carry voice.
- Up to four cars race at once. Fastest time wins, resets included.
- Pass every checkpoint in order, then the finish. Stuck in a ditch? The Driver can reset for a 5 second penalty.
- Anyone still out there when the time limit runs out is DNF.

## How it plays

1. **Pick seats.** After the host starts the game you land on the teams screen: up to four cars, each with a Driver seat and a Navigator seat. Tap Sit here on an empty seat. Be Driver / Be Navigator swaps you with your teammate; Leave seat puts you back in the spares. The host can move anyone with the dropdown next to their name.
2. **Pick the track.** Depending on the Track setting, the host taps a track card, or each car's captain taps one to vote (see Settings). The cards show difficulty, length, landmarks and par time. They never show the road, because anyone might end up as the Driver.
3. **Read your card, then ready up.** When you're in a seat and not ready, your role's briefing card sits on the screen with every control for this race's settings. "I'm ready" is the only ready button. Ready also loads your seat: a Navigator's 3D course starts downloading ("Loading the stage"), and the Driver can't move until it's in.
4. **Start.** The host taps Start race once every seated player is ready. Three, two, one, GO. All cars go at once, and the clock is the room's.
5. **Race.** The Navigator watches the car and calls the road. The Driver steers, brakes and listens. Checkpoints count by themselves as the car drives through them, in order.
6. **Finish.** Cross the finish after the last checkpoint. The race ends when every car has finished or dropped out, when the time runs out, or when the host taps End race.

The Start button is disabled, with a reason underneath, if no car has both seats filled ("A car needs a Driver and a Navigator."), a car has only one person ("Team 2 needs a Navigator."), or someone seated isn't ready yet. Empty cars just sit the race out.

## Winning and scoring

- Finishers rank by effective time: the clock from GO, plus 5 seconds per reset, minus any time your clock was stopped for a drop-out.
- Cars that didn't finish rank after every finisher, most checkpoints passed first. They show as "DNF, 3/5 checkpoints".
- Times are compared to the tenth of a second. Equal means a tie, shown as one ("=2nd"), never broken in secret.
- Both players in the fastest car win. A DNF can't win.
- Players in the room without a car show as "Watched".
- The Navigator's row also gets a line like "Closest guess: 12 m off after CP3": their best guess pin against where the server had the car. It's a stat, not a score.

## Settings

Host picks these in the lobby.

| Setting | Options | What it changes |
| --- | --- | --- |
| Mode | **Race**, Practice | Practice is one pair, no rivals, same clock. Race takes one car per two players, up to four. |
| Stage | **Solo**, Shared | Solo: every car has its own copy of the road. Shared: one road, and Navigators see rival cars as ghosts that can't hit you. |
| Track | **Host picks**, Team vote | Host picks: the host taps a card before ready-up. Team vote: one vote per car, cast by its captain. Only appears in Race mode; in Practice the host picks. |
| Time limit | 3 min, **5 min**, 8 min | Counts from GO. Still out there after that: DNF. |
| Navigator camera | **Any**, Top-down, Chase, Bonnet | Which 3D views the Navigator gets. Any lets them cycle all three. Has no effect when the 3D camera assist is off. |
| Assists | Beginner, **Classic**, Nightmare, Custom | What the Navigator gets. See below. |
| Weather | Clear, **Patchy cloud**, Murky | Mist hides bits of road. Same sky for every team. |

The Custom toggles (Live car marker, Trip meter, Pace notes, 3D camera, each On or Off) only appear when Assists is set to Custom. Switching to Custom starts from whatever the current preset has.

| Preset | Live car marker | Trip meter | Pace notes | 3D camera |
| --- | --- | --- | --- | --- |
| Beginner | on | on | on | on |
| Classic | off | on | on | on |
| Nightmare | off | off | off | off |

- **Live car marker**: the car's dot on the map. Off, the map never moves and you have to work out where you are.
- **Trip meter**: metres actually driven, wrong turns included.
- **Pace notes**: the stage's printed notes, in order.
- **3D camera**: the Navigator's 3D view. Off, they get the map and nothing else.

Everyone sees the settings in words on the teams screen, under "This race", before they ready up.

## The Driver

Your phone is the cockpit. Hold it sideways.

| | Touch | Keyboard |
| --- | --- | --- |
| Steer | Left and Right pads under your left thumb | A / D or Left / Right |
| Gas | The Gas pad, right side under your right thumb | W or Up |
| Brake | The Brake pad, left of Gas. Keep holding once stopped and you reverse. | S or Down |
| Reset car | Tap Reset car, then tap again within 3 seconds ("Tap again: +5 s") | Click the button the same way |

Slide a thumb from one pad to the other and it switches without lifting. Each zone is split down the middle, so the whole half is the pad. You can press steer and pedals together. If the page loses focus or the tab is hidden, everything lets go.

What's on the dash:

- **Speedo**: speed in km/h, and D or R for the way you're going.
- **Compass**: which way the bonnet points, like "042° NE". Your Navigator can tell you to head north. It tells you where you're pointing, not where the road goes.
- **Clock**: your car's time, with the penalty so far and the time left ("+5 s · 3:12 left").
- **Status line** at the top: "<Navigator> navigating" when all's well, "No signal from <Navigator>" if nothing has come through for 1.5 seconds, "<Navigator> dropped out", or "You're offline".
- **Top bar buttons**: Not ready (before the start, takes you back to the teams screen), and for the host Start race and End race. On phones there's also a full-screen button.
- **Hits**: when the car bumps something, the dash flashes and a phone buzzes. Harder hits flash longer. The countdown and GO buzz too.

Nothing on this screen scrolls or zooms, so a stray pinch can't crash you.

## The Navigator

You see the course and the car, but the car isn't yours to touch. Your Driver's inputs reach the car in real time. Say what's coming, not what just went by.

Top strip: your car's badge, the Driver's status ("<Driver> driving", or "<Driver> isn't touching anything" after a second of quiet, or "dropped out"), the Trip meter if it's on, the clock, a Notes button if pace notes are on, and the Not ready / Start race / End race buttons as for the Driver.

| Control | Keys | What it does |
| --- | --- | --- |
| Camera | Y | Cycles the allowed views (top-down, chase, bonnet). Only if the camera setting is Any. |
| Zoom | - and = | Out and in. |
| Rotate | C | Turns the view with the car, or back to north up. |
| Map | M | Opens the big map. You can also tap the corner map. Esc, or a tap outside the map, closes it. |
| Guess pin | Tap the big map | Tap where you think the car is. A long press clears it. |
| GPS | G | Hides or shows the car's live dot. Only with the Live car marker assist. |
| Sound | N | Mutes the engine. |

- **Guess pins** are for when you've lost track of the car. Pins only count from the green light, one every half second at most, and not while your team is paused. Your closest one makes the results. With the 3D camera assist off, the map is your whole view and a tap places the pin directly.
- **Pace notes**: tap Notes to open a pad of the stage's notes with metres along the clean line. The game never highlights where you are, because that would give the car away. Tap a line to mark your place yourself; tap again to rub it out.
- **Trip meter** reads "Trip 840 m" or "Trip 1.20 km" in the top strip.
- **Pause**: there isn't one.

If the stage won't load, the screen says "The stage didn't load", with a Try again button. Your Driver waits while you do.

## On your screen (everyone)

- Teams cards show a colour, a shape and a number per team (Orange circle, Sky square, Green triangle, Purple diamond), so you never need to tell colours apart.
- During the race, a team's status reads On stage, Paused, Finished or DNF, with time and penalties.
- The captain (Navigator by default) carries a "captain" tag. They cast the car's track vote.
- Spares and late joiners see the teams screen as a spectator view: "You're watching this one." Before the race starts, anyone not in a car can take an empty seat.

## When things go sideways

- **Someone drops mid-race.** The whole team's clock stops, the Driver's controls are ignored, and a banner shows "<Name> dropped out: 23 s to get back. Clock stopped." You have 30 seconds, counted from the first drop. After that the team is DNF. If a Navigator comes back, their 3D course restarts and the car reappears at the last checkpoint the server counted. Time spent paused is taken off your final time.
- **Someone leaves the room for good mid-race.** Their car is out (DNF) and the seat stays filled for the results.
- **The car falls out of the world.** The Navigator's course parks the car and asks the server for a reset, with the usual 5 second penalty.
- **Reset.** Costs 5 seconds. The car goes back to the last checkpoint the server counted, so a reset can't skip one, and sits still for 1.5 seconds. You can't reset while parked, paused or before GO.
- **Checkpoints out of order, or the finish before the last checkpoint.** They don't count. Drive the missed gate.
- **Track vote ties.** A tie goes to a coin flip, and everyone sees it was one ("Tie: picked by coin flip"). With no votes the track stays as it was (the default, or last race's track on a rematch).
- **Changing the track** un-readies the Navigators, since their course loads when they ready up.
- **Changing seats** un-readies everyone in the car.
- **Time runs out, or the host taps End race.** Everyone still on the road is DNF. End race asks you to confirm.
- **Play again.** Everyone starts in the same cars and seats with the same colours, on the last race's track. Swap seats there.

## Tips

- Call corners early. The Driver only has what you say.
- Reset when you're properly stuck. Five seconds is cheaper than a minute of reversing.
- Following a rival on a shared stage is allowed. Following a lost rival is a choice.
