# Lively recap: voice and table awards

## Why

The party recap only knows what happened inside games. A night with friends is also the talking, the sounds, the reactions, the rivalries. The user wants the recap to feel more lively: who talked most, who was loudest, and similar fun things. They handed over the choice of what to add.

## Goals

- Awards from room voice: who talked most, who talked over people, who talked on other people's turns, the biggest shout.
- Awards from the room itself: sound board plays, reactions, chat messages.
- Awards from the game log that we don't compute yet: win streaks and rivals.
- One "loudest moment of the night" line for the whole room.
- No audio is stored, sent to the server or analysed off the phone. Only "started talking" and "stopped talking" leave the phone.

## Non-goals (parked for later)

- Room votes at the end ("Funniest", "Best actor" picked by players).
- Live streak messages during the party.
- Voice tied to a game's own events (talking while people vote against you, quiet while lying). These need per-game hooks.
- Volume calibration between phones.

## Anti-goals

- It must not feel like being watched. Voice awards stay friendly and few: at most 3 "table" awards in a recap, next to the game awards.
- A player who never joined voice, or turned counting off, is never named in a voice award, and nothing suggests they were quiet.
- Room voice must never break or slow down because of this. Talk events never wait on the room and never bump the room version. Their storage writes are throttled (see Server counts).

## Constraints

- Voice is a peer-to-peer mesh. The server never hears audio. Each phone already decides "I am speaking" from its own mic level (`nextSpeaking` in `apps/web/src/voice/audio.ts`).
- Casual game night: trust the phone's reports (see the anti-cheat note in memory). Rate limits only stop floods.
- Copy: short, plain words, no idioms, no emoji. Easy for Indian readers.
- Shared work lands on `master`. Bump `PROTOCOL_VERSION`.
- The recap stays a pure function of the party log (`buildRecap`).

## Approaches

1. **Phones keep their own totals and send a summary at End party.** Simple, but a phone that left or reloaded loses everything. It also can't see overlaps (who talked over whom) or what the game was doing at the time.
2. **Phones send "talk on" / "talk off"; the server times and counts.** (Picked.) The server adds the time, so all phones share one clock. It knows who else is talking (overlaps) and the room's phase and who the game waits on (off-turn talk). Cost: one small message each time someone starts or stops talking.
3. **The server listens to audio.** Not possible with the mesh, and it goes against the privacy goal. Dropped.

The user handed over the how; approach 2 is my call.

## Design

### Wire

New client message: `voice-talk` with `{ on: true }` or `{ on: false, peak: number }`. `peak` is the highest mic level (0..1) in that burst, rounded to 2 places.

- The phone sends `on` when it starts talking and `off` when it stops. "Talking" here means: it is transmitting (the existing `talking` rule in `voice.ts`, so push-to-talk held or open mic, not muted) AND the speaking dot is lit (`nextSpeaking`). Holding push-to-talk in silence counts nothing.
- A setting in voice prefs, **Count my talk time for the recap**, on by default. `voice-join` carries it (`count: boolean`), and a new `voice-count { on }` message changes it while in voice. When off, the phone sends no `voice-talk`, the server ignores any it gets, and that seat's `voiceMs` stops. A seat that never had counting on is never scored for voice awards, including Quiet but strong.
- The server drops `voice-talk` from a seat that is not in the voice roster, or is muted. Rate limit about 30 per 10 s per seat.
- The server never sends talk events to other phones.

### Server counts

At `on`, the server records the start time (`host.now()`) and a snapshot of context: room phase, whether this seat is awaited by the game, the winners of the last finished game if the room is on results, and how many others are talking right now. At `off`, or when the seat leaves voice, disconnects, is muted, or the burst passes 2 minutes (the cap), the burst closes and is counted.

Per seat, in a new `party.table` part of `PartyLog`:

| Count | Meaning |
|---|---|
| `talkMs` | all talking time |
| `overTalks` | bursts started while someone else was already talking |
| `offTurnMs` | talking time while a game is playing, the game waits on at least one seat, and not on this one. Talk while nobody is awaited (reveals) does not count. |
| `winTalkMs` | talking time on the results screen of a game this seat won |
| `voiceMs` | time spent in room voice (join to leave) while counting is on |
| `peak` | highest peak seen, only from bursts of at least 1 second |
| `sounds` | sound board plays the room relayed |
| `reactions` | emotes plus chat reactions added. Taking a reaction back does not count and does not subtract. |
| `chats` | chat messages sent |

Room level: `loudest: { count, gameId | null } | null`, the most people talking at the same moment, and which game was on (null for lobby or results). Keep the first time the highest count was reached.

Open bursts and open voice sessions live in memory only. Closed counts go into `data.party.table`. The room hibernates (`hibernate: true` in `worker.ts`), so in-memory counts would be lost on a quiet stretch. So: when a burst closes, persist with `this.persist()` (no version bump, no update, like the drawing `stream` case), but at most once every 30 s per room. A pending write goes out with the next normal save or the next allowed one. Losing the last 30 s and any open burst on hibernation is fine. *(Builder call: throttled persist.)* Computer players are never counted. Names go into `party.names` like they do for games.

These counts never go into the room state that phones get. They only show up in the recap.

### Recap

`buildRecap` gets two new outputs, and the game awards stay as they are.

**New game-log awards**, at the end of the main list, so the 5-award cap (`MAX_AWARDS`) still lets current game awards go first. *(Builder call.)*

- **On a roll**: longest run of wins in a row, over the games that player was dealt into, at least 3. "Won 4 games in a row."
- **Rivals**: two players who each beat the other at least 2 times, in games both played (one a winner, the other not). Highest smaller count wins. `who` is both names. "Beat each other 3 times each." (Exact line when the counts differ: "Beat each other 3 and 2 times.")

**Table awards** (`recap.table`, at most 3, its own section "Around the table"). Same spread rule as the main list: someone who already has an award gives way to someone close behind without one, counting both lists. "Close behind" becomes a per-rule setting: counts keep `top - 1`; times (`talkMs`, `offTurnMs`, `winTalkMs`) use within 10% of top; `peak` uses within 0.05. *(Builder call.)* At most 2 of the 3 table awards may be voice awards (chatty, overtalk, backseat, shout, speech, quiet), so a room award (DJ, excited, messages) can show when one qualifies. *(Builder call.)* In this order:

| id | Title | Score | Min | Line |
|---|---|---|---|---|
| chatty | Most talkative | talkMs | 3 min | "Talked for 14 minutes." |
| overtalk | Talks over people | overTalks | 8 | "Started talking over someone 23 times." |
| backseat | Backseat player | offTurnMs | 2 min | "Talked for 9 minutes on other people's turns." |
| dj | DJ of the night | sounds | 10 | "Played 31 sounds." |
| shout | Biggest shout | peak | (talkMs at least 1 min) | "Had the loudest shout of the night." |
| speech | Victory speech | winTalkMs | 30 s | "Talked the most after winning." |
| hype | Most excited | reactions | 10 | "Sent 40 reactions." |
| typist | Most messages | chats | 15 | "Sent 52 chat messages." |
| quiet | Quiet but strong | lowest talkMs among seats with voiceMs at least 15 min and at least 2 wins | — | "Said the least, and still won 3 games." |

Minutes in lines round down, and never show 0 (a minimum keeps that from happening).

**Loudest moment** (`recap.moment`), when `loudest.count` is at least 3: the shell writes "Loudest moment: 5 people talking at once, in Overheat." or "... in the lobby." when `gameId` is null.

The text copy (Copy recap / Share), the recap screen, and the recap picture (`recap-image.ts`) all show the new section and line, in the same order. The picture must still fit its fixed size; shrink spacing or drop the moment line from the picture if it can't fit.

A night with no finished game still has no recap, as today, even if people talked. *(Builder call.)*

### Docs

`docs/games/rooms.md`, recap part: name the new awards, say what voice counting measures ("only how long you talk, never what you say"), and where to turn it off.

## Left to the builder

- Exact names of the new fields and types, as long as old stored rooms load (all new fields optional, `??=` like `party`).
- How the client gets `peak` from the existing meter.
- Picture layout details.
- Test layout, following the existing recap and runtime tests.
