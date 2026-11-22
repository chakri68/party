# Rooms, the lobby and everything around the games

Everything that isn't a specific game: your name and face, getting into a room, what the host controls, chat, reconnecting, and the results screen. Same for every game.

## The short version

- Pick a name and a face, then create a room or join one with its four-character code.
- Whoever holds the host role picks the game, tweaks its settings and hits **Start game**. Everyone else taps **I'm ready**.
- Chat and emoji reactions live in the header. In a game, the reactions are in the menu (the three dots at the top right). Chat goes read-only during games that have their own chat.
- If your connection drops, your seat is held for 60 seconds.
- When a game ends you get a results screen, then **Play again** (or **Rematch**, for the host).

## Your name and face

On the home screen you set a **Name** (up to 20 characters) and get a random face. Both are saved on your device, not an account.

- Tap the face to roll a new one. It's saved straight away.
- Tap the dice ("Random name and face") to roll both. The name comes out as an adjective and an animal, like "Sneaky Walrus".
- The name is saved when you hit **Join** or **Create room**. Leave it empty and you get "Pick a name first."

If you open a room link without a name set, you're asked for one first ("Joining ABCD"), with the same face and dice controls.

## Making a room

Room creation is gated by an owner key, so who can do it depends on where you are.

- **The hosted copy.** Only the owner can create rooms. Their device holds the key; everyone else sees a **Host your own** panel instead of a **Create room** button, plus a "got a room code?" join box. Rooms there are invite-only.
- **A self-hosted copy.** Run `npx github:chakri68/party` (needs Node.js 22+; see "Host your own" in the README). It prints a host link with the owner key in it and opens it. That link shows **Create room**. Friends open the room link and just join. Keep the terminal open while you play, and keep the host link to yourself.

Either way, rooms are only ever created from the **Create room** button. After that you land in the lobby and share the invite from there.

Heads up: on both setups the game can't start unless the owner is connected to the room. If they aren't, the host's start button reads "Can't start yet".

## Joining

- Type the four-character code into the box next to **Join**. Letters and numbers; case doesn't matter. Anything else gets "Room codes are four letters/numbers."
- Or open the invite link (`/room/ABCD`). The lobby's **Copy link** button copies it; on a phone it reads **Share invite** and opens the share sheet.
- Rooms you've been in within the last 6 hours show up on the home screen under "Pick up where you left off" as **Rejoin ABCD**, up to three of them.

You can't get in if:

| You see | Why |
|---|---|
| That room doesn't exist (or everyone left and it closed). | Wrong code, or the room was empty for 6 hours and got cleaned up. |
| This room is full. | The selected game's player limit is reached. |
| A game is already underway. You can join once this round ends. | Most games don't take new players mid-round. |
| This room is open in another tab. | Same seat, newer connection. Tap **Use here** to take it back. |
| The host locked this room. | The host locked the room to new players. |
| The host removed you from this room. | Exactly that. |
| A new version is out. Refresh to keep playing. | Tap **Refresh**. |

## The lobby

Top to bottom:

- **Room code** in large type, the invite address, and **Copy link** / **Share invite**.
- The current game with its description. **Rules** opens "How to play" for that game. The host also gets **Change**.
- The game's settings, if it has any.
- **Players**, with a count like `3/8`. Each row shows the face, name, "(you)" next to yours, a "host" tag, and "ready" or "not ready". Someone who has dropped shows "reconnecting…". Empty slots up to the game's minimum read "Waiting for a player…".
- For the host, **Lock room** (or **Unlock room**). While it is locked, everyone sees "The room is locked. New players can't join."
- **I'm ready** and, for the host, the start button.
- **Leave room**.

Outside a game, the header has the room code, a sound button, a sound board button, an emoji button and a chat button.

In a game the header is one small row, so the game has more space: the room code, the connection bars, your mic (only when you are in voice), the chat button and the menu (the three dots at the top right). The room's other buttons are in the menu: **Sound board**, **Reactions**, **Join voice** or **Voice**, **Sound and vibration**, and for the host **Pause** (or **Resume**), **Restart** and **End game**. **Home** in the menu goes to the home page, like the logo does outside a game.

### What only the host can do

The host is the first person into the room. The tag next to their name says "host". Only they can:

- **Change** the game. This opens "Pick a game": games sit under headings (Cards, Words and drawing, Hidden roles, Racing, Strategy), each with its player range. A game that plays best with the number of people in the room right now gets a "Best for N" tag. A search box appears once there are more than six games. A game that can't seat everyone currently in the room is greyed out with "Up to N players, you're M". Picking a different game resets the settings to that game's defaults.
- Change the **settings**. Everyone else sees them read-only.
- **Start game**.
- Tap the dots next to a player to **Make host** or **Remove** them. Both ask first. **Make host** only shows for players who are connected. A computer still has its own remove button, and it doesn't ask.
- **Lock room** in the lobby. While it is locked, new players can't join. Players already in the room can still come back. So can someone whose phone went to sleep and lost their seat. Tap **Unlock room** to open it again.
- Mid-game: **Skip** and **Remove** buttons above the game, and **Pause**, **Restart** and **End game** in the menu (the three dots at the top right). All are covered below.
- **Sounds: off** at the top of the sound board turns the board off for everyone. Only the host still sees the board button, to turn it on again.

### Computer players

Some games let the host add computer players, so a small group can still play. For now, that is Cheat, Crazy Eights, Farkle, Go Fish, Hold'em, Liar's Dice, Oh Hell, Old Maid, Overheat, President, Sevens and Thorns. Only the host can add them, and only in the lobby, when the chosen game supports them. Tap **Add computer** under the player list. In the lobby, each computer shows a "computer" tag and has no ready sign. In a game, a small robot badge sits on its picture. The host removes one with the remove button next to its name, without asking first.

Computers play by the same rules as everyone. They only see their own cards, as a person does.

A link can also start a new room on a game that has computers, with some already seated. The first person to join is still the host. If the game is locked for the room, the room starts as a normal empty one.

In the lobby, a person always gets a seat. If the room is full, a computer leaves to make space. During a game, a full room stays full.

While computers are seated, games that can't have computers are greyed out with "Remove computers to play this". **Remove computers** in the game list takes them all out at once. The start button also stays off until you do.

Computers pause when nobody is connected, and play again when someone comes back. If a computer gets stuck, the game ends for everyone with "A computer player got stuck, so the game ended."

### Ready and Start

**I'm ready** toggles to **Not ready**. It's a signal to the host, nothing more. The server doesn't wait for it, and Start works with nobody ready. Ready flags reset when a game starts.

The host's button changes with the room:

| Button | Meaning |
|---|---|
| Need N more | Fewer connected players than the game's minimum. Disabled. |
| Can't start yet | Enough players, but the room can't start, usually because the owner isn't connected. Disabled. |
| Start game | Go. |

A game can also refuse to start because of its setup, such as a role deck that doesn't add up for the number of players. The reason appears as a line under the settings, and the button stays disabled until you change the settings or the head count. Players who aren't connected when you start don't get dealt in and are dropped from the room.

Non-hosts see "Waiting for <host> to start."

## Rules

**Rules** in the lobby opens the game's rules in a "How to play" dialog. It's the same short list for everyone and works any time you're in the lobby.

## Chat

The speech-bubble button in the header opens the chat. You need a seat first; there's no chat button on the name prompt or the "Connecting…" screen.

- On a phone it's a sheet from the bottom; on a wide screen a panel on the right. It doesn't block the table, so you can leave it open. Drag the header down (phone) or right (wide) to close it, or tap the **x**, or press Escape.
- Messages are trimmed to 200 characters. The room keeps the last 100. People who join later see them.
- Five messages in five seconds is the limit. Past that, "Easy there. Give it a second."
- A short run of emoji (three or fewer, nothing else) is shown big.
- A badge on the button counts unread lines (9+ past nine). If the panel is shut when a line comes in, it also pops up as a brief toast.
- To react to a message, tap the smile beside it and pick one of 👍 😂 ❤️ 😮 😭 🔥. Tap a reaction pill to add or remove yours. Hover a pill to see who sent it.

### When chat goes read-only

Some games have their own guessing or answering built into the screen, and the room's chat would just hand out answers. Scribbl is the one that does this. While it's running, the chat box is greyed out with "Paused for this game" and sending is refused with "Chat's in the game for this one." You can still read and react. It comes back when the game ends.

## Emotes

The smile button in the header opens a bar of the same six emoji. In a game, tap **Reactions** in the menu. Tap one and it floats up everyone's screen with your name under it. The bar stays open so you can mash. The cap is 10 per 3 seconds per person; extras are quietly dropped. The screen also stops adding new ones past 40 at a time.

## Sound board

The board button (four squares) in the header opens **Sound board** (in the menu during a game), a grid of short sounds. Tap one and everyone in the room hears it, in voice or not.

- You can tap one sound every 3 seconds. The tiles go dim until you can tap again, and an early tap says "Wait a moment before the next sound."
- The room plays at most 3 sounds in any 3 seconds, and the rest are skipped.
- Sounds follow your volume. If **Sounds** is off in Settings, you hear none. **Sound board** in Settings turns off only board sounds, on this phone.
- A self-hosted copy has only the free sounds.

## Sound and vibration

The speaker button opens **Settings**:

- **Sounds**: on or off. The icon in the header shows which.
- **Volume**: a slider, greyed out when sounds are off.
- **Sound board**: sound board sounds on this phone. Greyed out when Sounds is off.
- **Vibration**: only shown on devices that can vibrate.

The settings stay on your device.

## Voice

You can talk with the room while you play. Voice usually goes straight from phone to phone. Sometimes it goes through a relay server.

- **Join voice**: the button under the header. In a game, **Join voice** is in the menu (the three dots at the top right). Until your browser allows the mic, it first tells you what happens. Pick **Turn on mic** to talk, or **Listen only** to only hear. Your browser asks to use the mic. If you say no, you can still listen, and your mic stays off. Outside a game, the bar says "Your mic is off". In a game, the mic button shows it. To talk later, allow the mic in your browser settings.
- **Mute** stops sending your voice, but your mic is still on. Outside a game, the bar says so. In a game, the mic button shows it. **Turn off mic** turns the mic off fully, and the phone's mic light goes off. **Leave voice** stops voice for you.
- **Hear no one** (the headphones button) stops all voices for you. Tap it again to hear everyone.
- **Volume** and **Mute for me**: each person in voice has a volume slider and a **Mute for me** button. Only you stop hearing them. They do not know. This is saved for the room on your phone.
- **Push to talk**: turn it on in voice settings. Then you talk only while you hold the mic button. On a computer you can also hold Space. Some games use Space, and then only the button works.
- If the phone blocks sound, tap **Tap to turn on sound**. If your mic stops (a call, or you pulled out a headset), tap **Tap to talk again.**
- Voice stays on between games. It stops when you leave voice, leave the room, or the party ends.
- If you reload the page, voice comes back as you left it. If you were muted, you stay muted. If your mic was off, or you picked **Listen only**, it stays off.
- If the mic you picked in settings is gone (for example, you unplugged a headset), voice uses your other mic.
- Up to 8 people can be in voice. The ninth person sees "Voice is full." and can still play.
- The bar is small: the mic, hear no one, who is talking, and a dot that turns green when voice is connected. In the lobby and on results, tap **People in voice** to see everyone in voice. **Turn off mic** and **Leave voice** are there too.
- In a game there is no bar. Once you are in voice, your mic button is at the top, next to chat. Its small dot is green when someone talks, and orange while voice connects. **Voice** in the menu shows everyone in voice, with **Hear no one**, voice settings, **Turn off mic** and **Leave voice**.

The settings button in the bar opens **Voice settings**: which mic, which speaker (only where the phone allows it), remove echo, remove background noise, keep my mic volume steady, push to talk, and "Hear no one also mutes my mic". **Hide my network address** sends voice through a relay server, so others cannot see your address. It needs a relay server, and is greyed out when there is none.

The settings stay on your device. No one records your voice.

## Connection drops and reconnecting

Next to the room code, three bars show your connection to the server: green is good (under 150 ms), yellow is OK (under 300 ms), and one red bar is slow. Tap the bars to see the number.

If your connection goes, the header shows "reconnecting…" and your seat stays yours. The server holds it for **60 seconds**.

- Come back inside that window (same device and browser) and you're back in the seat. Your game, hand and ready state are as you left them.
- In the lobby, if the 60 seconds run out, you're taken off the player list.
- In a game, your seat stays after the 60 seconds. You show as disconnected and the game waits on you if it's your turn. The host can then **Skip <name>'s turn** or **Remove <name>**.
- If your client can't reach the room for 15 seconds you get "Couldn't reconnect to the room. Still trying in the background. Your seat is kept for a minute." with **Try again** and **Leave room**.

Open the room in a second tab and the first one stops with "This room is open in another tab." The newest connection wins.

An empty room is deleted after 6 hours.

## When the host leaves

The host role isn't tied to who made the room. If the host disconnects, they keep it through their 60 seconds. After that, or if they leave outright, it passes to whoever has been in the room longest and is still connected. That person gets a toast: "You're the host now." If nobody is connected, the role stays put until someone comes back.

The host can also give the role to someone else with **Make host**. They get "You're the host now."

If the host ends a game, everyone else gets "<name> ended the game." and returns to the lobby.

## During a game

The shell adds a few controls above the game when it's waiting on someone:

- Everyone: **Remind <name>** appears once the person whose turn it is has been idle for 30 seconds. They get a "reminded you. It's your turn!" toast, a sound and a short buzz. There's a 10 second cooldown between reminders.
- Host: **Skip <name>'s turn** appears after 60 seconds idle, or straight away if that person has dropped. Not every game can skip.
- Host: **Remove <name>** for anyone disconnected past their grace (asks to confirm). They're out for the rest of the round.

The host also has these in the menu (the three dots at the top right):

- **Restart** starts the same game again with the same settings (asks first). Players who are reconnecting stay in.
- **Pause** and **Resume**, in games that can pause (Nightfall for now). While paused, the timer stops and nobody can play.
- **End game** sends everyone back to the lobby (asks to confirm).

## Leaving

**Leave room** goes back to the home screen and gives up your seat. Mid-game it asks first: "Leave the game? You'll be out for the rest of this round." You can't resume a seat you left on purpose.

## Late joining

Joining a game already in progress is refused ("A game is already underway.") unless the game allows it. Blind Rally and Rally do. Newcomers count toward the player limit like anyone else, and the game decides what they are when they arrive. Everything else makes you wait for the round to end.

## Results and Play again

When a game ends the board stays on screen and a results panel comes in on top:

- A headline: "You win!", "<name> wins", "<A> and <B> tie", or for games that name a loser, "You lose" / "<name> loses". Some games write their own.
- Standings with places, faces and each player's result. Anyone who left shows "left".
- Under it, the setup-problem line again if the next round can't start.

What you tap depends on your role:

- **Everyone else:** **Play again** marks you as ready for another round. It then reads "Waiting for host…". Tap it again to take it back.
- **Host:** **Rematch** starts another round with the same game and settings. It shows how many people are ready, like "Rematch (3 ready)". It's disabled and reads "Can't start yet" if the room can't start. **Back to lobby** goes to the lobby instead, where you can change the game or settings.
- **Leave room** for anyone.

Rematch doesn't wait for everyone to be ready. The count is information, not a gate. The dealer rotates between rounds.

## Ending the party

When the night is done, the host taps **End party**, under the lobby or the results. It asks once, on the page: "End the party for everyone? You will see the recap."

Then the room closes. Nobody can start another game in it. Everyone sees the same recap:

- How many games you played, for how long, and the game you played most.
- Up to five awards, like **Biggest liar**, **Sharpest eye** or **Most suspicious**. They come from what happened in the games: lies nobody caught, bluffs called, votes against you. Some games feed awards (Cheat, Liar's Dice, Imposter, Nightfall, Fake Word, Bluff Definitions, Doodle Dash); every game counts toward **Champion of the night**.
- A tie names everyone in it, up to three people. One person usually gets one award, so the recap goes around the room.
- **Copy recap** (or **Share** on a phone) gives you a short text version for the group chat.

Chat still works. Anyone who opens the link later sees the recap too, until the room is cleaned up. If no game finished, there's no recap: the room just says the party is over.
