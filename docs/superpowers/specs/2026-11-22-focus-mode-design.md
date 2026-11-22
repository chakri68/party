# In-game focus mode: design (short)

Status: approved in conversation 2026-11-22.

## Intent

During a game, the room's own controls take three rows above the game on a phone (7 header icons, the voice row, the host buttons). The user wants the screen to focus on the game, not on "random UI elements like join voice". Lobby and results keep today's layout; only the `playing` phase changes.

## Approaches

- **(Picked) One slim row plus a "..." menu.** Room code, signal, chat and (when in voice) the mic stay out; everything else moves into one menu. One tap more for rare actions, nothing lost.
- Auto-hiding top bar (slides away, swipe to show). Rejected: hidden state is confusing on phones and fights games that use swipes.
- Bottom dock. Rejected: games already use the bottom of the screen for hands and buttons.

## Design (playing phase only)

Top row: `[CODE] [signal]  ...  [mic, only when in voice] [chat] [...]`. The brand logo and wordmark are not shown in a game.

The "..." menu (a dialog list, like the seat menu) holds, in order:
- Sound board (when the board button would show today), opens the board panel.
- Reactions, opens the emote bar.
- Join voice (out of voice), or Voice (in voice: the people panel, as the people button opens today).
- Sound and vibration settings.
- Host only: Pause/Resume (pausable games), Restart, End game, with today's confirms.
- Home: the same link the logo is today (the logo is not shown in a game).

Rule (user): nothing changes in behaviour, only the layout.

Voice in a game:
- Out of voice: the voice row is hidden (today it shows a small Join voice button).
- In voice: the voice row is hidden; a compact mic button sits in the top row. It works like today's mic button (tap to mute, hold-to-talk mode included) and shows speaking. Notes like "Muted: your mic is still on" go in its accessible name, not a visible row.
- The "Tap to allow sound" / "Tap to allow mic" prompts still show as a row when needed: without them voice silently fails.

Turn controls above the game keep only what matters right now: "X lost connection", "The game is paused.", "Remind X", "Skip X's turn", "Remove X". Pause, Restart and End game move to the menu.

## Non-goals

No change to lobby, results, recap, chat panel, emote floats, sound board panel contents, or any game view.

## Constraints

- Header fits 360 px phones (the board review found an 18 px overflow once; recheck).
- Copy plain for ESL readers; no emoji; SVG icons; menu button aria-label "Room menu".
- Space push-to-talk and Godot frame handling unchanged.

## Left to the builder

Menu icon; exact compact mic look; whether the board and emote panels anchor under the "..." button or under the row.
