# Nightfall

Wolves in the village. Every night someone's taken, every day someone's voted out, until one side's gone. 5–12 players.

## The short version

- Everyone gets a secret card. Most are village. A few are Wolves, and the Wolves know each other.
- Night: the Wolves take someone. The Watcher and Keeper do their jobs. Dawn: you hear who was taken and which team they were on, never their card.
- Day: talk, then vote someone out. Their team is announced.
- Repeat. The village wins when no Wolves are left. The Wolves win once they're at least as many as everyone else alive.

## How it plays

1. **Your card (30 s).** Tap the card to see your role and your team. Wolves also see the other Wolves. Tap **Got it**. The first night starts when everyone has, or at 30 seconds.
2. **Night (20, 30 or 45 s, the host's pick).** Every living player picks someone on their phone and taps **Confirm**. Every night runs its full time. See below for why everyone picks.
3. **Dawn.** The village hears who was taken (or that nobody was) and which team they were on. Never their card.
4. **Day (the Talking time).** "Talk it out." Claim what you like; Wolves lie. The host can tap **Vote now** to end it early.
5. **Vote (30 s).** Everyone alive votes for someone else, or **Skip**. You can change your vote until the clock runs out or everyone's in. The screen shows "x of y in".
6. **Runoff (20 s).** If two or more players tie for the most votes, only they are on the ballot (plus Skip). Still tied: nobody goes.
7. **Verdict.** The player with the most votes is out and their team is announced. If nobody got a vote, or the runoff is still tied, nobody goes.
8. Night falls again, and it continues until a side wins.

## Night screens look the same for everyone

If your phone only asked you to pick when you had a job, it'd give you away. So it doesn't.

- **Every living player picks someone every night**, whatever their card. The headline is "Night. Everyone picks one player.", the list is every living player (you included), and **Confirm** works the same on every phone.
- **Only the Wolves', the Watcher's and the Keeper's picks count.** Everyone else's pick is kept on their phone and never goes anywhere. A Villager's tap and a Watcher's tap look identical.
- **A pick the card can't make is quietly treated as no pick.** A Wolf picking another Wolf, a Watcher picking themselves, or a Keeper repeating last night's shelter all get the same "Locked in" as any other pick. The server doesn't refuse it, so nobody's screen differs. On the card it shows as "Your pick tonight didn't work for your card: it counts for nobody."
- **Night never ends early.** It runs its full time even after everyone's confirmed.
- **Same sound and buzz at nightfall on every phone.**
- **A reload doesn't unlock you.** Your confirmed pick is kept in the browser tab, so a refresh doesn't let you change it.
- **What you learn goes on your face-down card**, not the main screen.

In the code: `games/nightfall/client/view.ts` (`press`, `renderPanel`) puts every living player through the same pick-and-confirm, and only sends the pick when your card acts. `games/nightfall/server/game.ts` (`targetsFor`, the `pick` action) turns an unusable pick into no pick instead of refusing it, and runs the night to its deadline.

## Roles

### Wolf

- **Team:** Wolves.
- **Does:** each night, picks a non-Wolf. The Wolves' most-picked player is taken. A tie between picks is settled by a coin the server flips. If no Wolf picks, nobody's taken.
- **Learns:** who the other Wolves are, and (on the card, during night) what the other Wolves have picked so far. If you're the only Wolf, the card says so.

### Watcher

- **Team:** Village. Unique.
- **Does:** each night, picks a player other than themselves.
- **Learns:** at dawn, whether they're a Wolf. Every reading from every night stays on the card ("Night 2: Ben is not a Wolf").

### Keeper

- **Team:** Village. Unique.
- **Does:** each night, shelters one player, themselves included. Never the same player two nights running. The card reminds you who you sheltered last night.
- **Learns:** nothing new. If the Wolves went for the person you sheltered, nobody's taken, and the village isn't told why.

### Villager

- **Team:** Village. Up to 11 in a deck.
- **Does:** no night power. Talk, listen, vote.
- **Learns:** nothing.

Order inside a night: shelter, then attack, then reading. A sheltered player isn't taken.

## Winning and scoring

No scores. The game ends when a side wins:

- **Village wins** when no Wolves are left alive.
- **Wolves win** once they're at least as many as everyone else alive.

The check runs at dawn and after every verdict. The end screen shows every card, every night (who the Wolves picked, who was sheltered, who the Watcher read) and every day (who voted for whom).

## Settings

Host picks these in the lobby.

| Setting | Options | What it changes |
| --- | --- | --- |
| Roles | **Standard** (default), Beginner, Full, Custom | The deck. The hint lists it, such as "2 Wolf, 1 Watcher, 4 Villager", or says what's wrong with it. |
| Talking time | 1, **2** (default), 3, 4, 5 min | How long each day's talk lasts. |
| Night | 20 s, **30 s** (default), 45 s | How long each night runs. |

**Presets** scale to the head count. Wolves are 1 at 5–6 players, 2 at 7–9, and 3 at 10–12. Extras fit in order, and Villagers fill what's left.

| Preset | Extras |
| --- | --- |
| Beginner | None. Wolves and Villagers. |
| Standard | Watcher |
| Full | Watcher, Keeper |

**Custom** adds a count row per role. Picking Custom starts you from the current preset's deck. Counts go from 0 to a role's maximum: Wolf 5, Villager 11, Watcher and Keeper 1. The deck must:

- add up to exactly the number of players ("Need exactly 7 role cards (have 6)");
- hold at least one Wolf and at least one Village card;
- leave at least two non-Wolf cards, and Wolves must be fewer than everyone else ("Wolves must be fewer than everyone else").

With fewer than 5 players in the room, the hint just lists the deck. The host can't start while the deck has a problem.

## On your screen

- **Your card.** Face down. Tap to reveal, tap to hide. It hides itself the moment you switch tabs or apps. It shows your role, your team, a one-line description, and what only you know (the pack, readings, last shelter, tonight's pick).
- **Round label.** "Night 2" or "Day 2" along the top, with the timer. The last 5 seconds of a vote or runoff tick out loud.
- **News.** By day, the dawn's news. By night, the last verdict.
- **So far.** The public record of each night's casualty and each day's votes by name.
- **The table.** Everyone, with those who are out marked "out" and their team.
- **If you're out.** "You're out. Keep what you know to yourself." You still watch, and you can't act. The host, if out, can still tap **Vote now**.
- **Sounds and buzzes** mark nightfall, dawn (a buzz if it's you), the vote opening, the verdict and the end.

## When things go sideways

- **Someone's connection drops.** They don't hold up the reveal or the ballots. If nobody's connected, the clock decides.
- **Someone leaves.** A leaver is nobody's pick and nobody's vote from that moment, and votes for them go back to their voters. Picks aimed at them are dropped, so those pickers choose again. They come off both sides' counts at the next phase.
- **A side is left with nobody because of leavers.** The game ends with no winner: "A side left the game."
- **A runoff is down to one candidate.** It closes at once and nobody goes.
- **A timer runs out.** Reveal: night starts. Night: dawn, with whatever picks were made. Day: the vote opens. Vote: it counts what's in. A missing vote just doesn't count. A host stuck at the reveal gets a **Skip** button for anyone still looking.
- **Rematch.** Non-hosts tap **Play again**; the host taps **Rematch** or **Back to lobby**. Roles are dealt fresh.

## Tips

- The Keeper can't repeat a shelter, so a player who was sheltered last night is exposed tonight.
- A dawn with nobody taken means the Wolves didn't pick, or the Keeper guessed right.
- Out players' teams are public. Count Wolves and everyone else: parity ends it.
