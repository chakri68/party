# Party Voice and Host Controls: Design

**Date:** 2026-11-21
**Source:** `party-system-spec.md` (the user's spec). Features are kept as written there. This document changes only how they are built, so they fit this codebase.
**Sites:** party-games.chakri.me (master) and couchpartygames.com (product). Shared code lands on master.

## 1. Intent

Friends in a room should be able to talk while they play, without a separate call app, and keep talking as the host moves from game to game. Some games (Nightfall, Short Night, Blind Rally, Dont Say It) get rules about who can hear whom, so voice becomes part of the game, not just a call next to it. Voice is always optional: every game stays fully playable with no microphone.

## 2. What already exists (spec section 14, step 1 is mostly done)

| Spec asks for | Here today |
|---|---|
| Persistent party shell across lobby, playing, results | `apps/web/src/views/room.ts` (RoomView) stays mounted; only the game view inside it is swapped |
| Authoritative room, one process | `RoomRuntime` in `apps/server/src/runtime.ts`, a Durable Object through partyserver (not PartyKit), hibernation on |
| Opaque room id, short join code, share URL | 4-letter room code, `/room/<code>` links |
| Server-issued session token | `resumeToken` from `welcome`, stored per room in `identity.ts` |
| Reconnect and grace period | `GRACE_MS = 60_000`, presence `reconnecting` then `disconnected` |
| Host election | `ensureHost()` keeps the host through their grace, then picks the oldest connected human seat |
| Kick | `remove-player` (mid-game only after grace runs out); in the lobby it is a per-seat X button |
| Return to lobby, end party, select/start game | all exist |
| Party chat, emotes | `chat`, `react`, `emote` messages |
| Typed, validated messages; version check | `packages/protocol` `parseClientMessage`, `PROTOCOL_VERSION` (now 9), `MAX_MESSAGE_LENGTH` 8192 |
| Private per-player state | `getPrivateState` per seat |
| Private relay to some players | `stream` with `StreamRelay.to` |
| Game sound | `@games/audio`: the one AudioContext, unlocked on any tap, with a `master` gain |
| Transport interface | `packages/webrtc`: a stub `PeerTransport`, unused |

So this work adds voice and the missing host controls to that room. It does **not** add a new party server, a new protocol envelope, or a second room process.

## 3. Goals, non-goals, anti-goals

**Goals** (all from the user's spec):
- Global voice in the room that survives game switches with zero reconnects.
- Listen-only mode; clear mic permission explainer before the browser prompt.
- Overlay: who is in voice, who is speaking, mic, deafen, connection state, per-player volume, settings, leave voice. Compact in games, full panel in lobby. Keyboard accessible, touch-friendly, and no overlay input leaks into games.
- Settings: mic device, output device (where supported), echo cancellation, noise suppression, auto gain, push-to-talk or open mic, "deafen also mutes", per-player volume, game sound ducking, soundboard volume. Saved locally.
- A separate "Turn off mic" action that releases the microphone, plus a short note that the mic stays on while only muted.
- Local block: "Mute for me" on any person, independent of the host.
- Push-to-talk with all the release rules; hold-to-talk and tap-to-mute on phones.
- Host controls: lock room, kick, mute one or all, transfer host, restart, pause/resume where a game supports it, assign teams where a game uses teams. Destructive ones confirm first. Host can never turn on someone's mic.
- Game voice rules (spec section 8 table), applied by each phone's sender-side rules (see section 4).
- Soundboard from bundled sounds.
- Proximity voice for games with positions (later phase).
- Recovery, privacy and abuse rules from spec sections 11 and 12.

**Non-goals** (from the spec): video, recording, transcription, background calling, public matchmaking, user-uploaded sounds, custom codecs, secret channels over peer-to-peer. No Ban (user's call).

**Anti-goals** (failure even if it works):
- A game that breaks or slows down when voice is off or the mic is denied.
- Voice traffic that slows the room's game updates.
- Secret voice (wolf night chat) that an honest player's app sends or plays to the wrong person.
- Any game switch that drops or renegotiates voice.
- Mic still captured after someone leaves voice, turns off the mic, or leaves the room.

## 4. Approaches considered

**Voice transport**

1. **Peer-to-peer mesh for everything (chosen, user's call).** Every phone connects to every other phone in voice. Secret voice works by the sender's phone sending audio only to the people its private rule allows, and each phone refusing to play anyone it may not hear. A modified app cannot make someone else's phone send it audio, so a cheater cannot listen in; the only leak is a player choosing to leak, which they could do by phone anyway. This is a fun game night, not an anti-cheat setting, so that is enough (user's call). No media server, no voice bill.
2. **Mesh plus Cloudflare Realtime SFU for secret phases.** Server-enforced routing, but a paid service and a second transport to maintain, to stop a cheat this game night does not need to stop.
3. **LiveKit.** Same as 2 with a second vendor.

Pick: 1. Keep the `VoiceTransport` interface (spec section 7) so an SFU can be added later if rooms outgrow the mesh. Only `MeshTransport` is built now. `VoiceTransport` replaces the stub `PeerTransport` in `packages/webrtc`, so there is one interface only (my call).

**Deviation from the user's spec, on purpose:** the spec says not to offer secret-role voice over mesh. The user decided (2026-11-21) that sender-side rules over mesh are fine for this game (user's call). Host mute is likewise trust-based and needs no warning label in the UI (user's call).

**TURN:** Cloudflare Realtime TURN. The room mints short-lived credentials from `TURN_KEY_ID` and `TURN_KEY_TOKEN` secrets (see 5.3).

**Party Web Worker (spec section 3):** not built. Room messages here are small JSON updates, and today's socket on the main thread does not show up in long tasks. Adding a worker would put a postMessage hop on every update for no gain, and it would add a second copy of room state. The spec's goal (keep heavy work off the main thread) still holds: voice meters are sampled at 8 Hz, no raw audio crosses threads, and the optional AudioWorklet is used only for level meters. If profiling later shows the socket costs frame time, move it then. (My call, for latency and simpler code.)

**Godot games:** keep the current same-origin iframe/bridge per game. Voice capture stays in the parent shell. Each Godot bridge gets one new call, `setGameVolume(0..1)`, for ducking. This needs new Godot exports. The Blind Rally export is not in git: the builder rebuilds it from the source in the repo, or skips ducking for it (my call).

## 5. Design

### 5.1 State (packages/protocol)

`RoomPublicState` gains:
```ts
locked: boolean;   // phase 1
paused: boolean;   // phase 1
voice: { mode: "off" | "global" | "game" };   // phase 2; "game" once a running game has voicePolicy
```

Voice membership is **not** in `SeatPublic` and does not go through `commit` (my call). Joining, leaving and muting would otherwise each bump the state version, write storage, rebuild every seat's private state, update the game view and animate the lobby. Instead the server sends an unversioned message, like chat, with the full voice roster whenever it changes:
```ts
{ type: "voice-state"; members: { id: string; selfMuted: boolean; hostMuted: boolean }[] }
```
It also goes to a seat right after its `welcome`. Push-to-talk is local only and is never sent.

Speaking indicators are not room state. They are local, measured on each phone from the audio it actually plays.

Per-player voice rules go in a new private message, never in the public state, so roles do not leak:
```ts
{
  type: "voice-policy";
  revision: number;
  canTalk: boolean;
  hear: string[];    // seat ids I may play
  sendTo: string[];  // seat ids my phone may send to
  label: string;     // "Wolves only", plain copy
}
```
`sendTo` is what makes sender-side rules work. It cannot be worked out from `hear`, because edges are one-way (the dead hear the living, the living do not hear the dead).

Bump `PROTOCOL_VERSION` in every phase that changes shape (my call, per AGENTS.md): phase 1 goes to 10, and each later phase that adds messages or fields bumps again.

### 5.2 Messages (added to the existing unions, validated in `parseClientMessage`)

Client to server: `voice-join`, `voice-leave`, `voice-self-mute {muted}`, `voice-signal {to, session, data}`, `voice-ice-request`, `host-mute {playerId | "all", muted}`, `lock-room {locked}`, `transfer-host {playerId}`, `restart-game`, `pause-game {paused}`, `soundboard {soundId}`.

Server to client: `voice-state` (above), `voice-signal {from, session, data}` (sent only to `to`), `voice-policy` (above), `voice-ice {iceServers, expiresAt}` (TURN credentials), `soundboard {from, soundId}`.

Rules:
- The actor is always the connection's seat. Host-only checks reuse `hostOnly()`.
- `voice-signal` is capped in size, well under `MAX_MESSAGE_LENGTH` (an audio-only SDP is about 3 to 5 KB). It goes only to a seat that is in voice.
- Signal rate limit: 20 messages a second, burst of 60, per seat (my call; the builder may tune it). Phones batch ICE candidates per peer (about every 100 ms) so the burst at join fits.
- `session` is the sender's voice session id (see 5.4). The server passes it through and does not check it.
- SDP and ICE are never stored or logged.
- New error code `room-locked`, fatal, with copy in `FATAL_COPY`: "The host locked this room."

### 5.3 Server (apps/server)

- `RoomRuntime` keeps the room's `locked` and pause data in `RoomData` (stored, so they survive eviction). Voice membership is kept per seat in `RoomData` too, but is sent only through `voice-state`.
- **Voice membership lifetime:** a seat stays in voice while `reconnecting`. It leaves voice on `voice-leave`, `leave`, removal, grace expiry and end party. Each of these sends a new `voice-state`.
- **Lock:** a locked room refuses new joins with `room-locked`. Resume tokens of existing seats still work. The room also remembers, for its whole life, the tokens of seats that the lobby grace timer removed (not ones removed by the host or that chose to leave), and lets those back in (my call; otherwise a friend whose phone slept for a minute in the lobby is locked out). The lock check comes before the "a computer gives up its seat" step.
- **No ban** (user's call): Remove plus Lock room covers it. There is no account or device id to ban by.
- **Owner:** the room owner (owner key) can always join a locked room and can never be removed. Owner status stays hidden, as it is today. A Remove on the owner gets the generic "You can't remove them." and the UI does not hide the button.
- **Transfer host:** immediate, to a connected human seat that is not the host. Never to a computer. The old host does not get it back on reconnect (already true of `ensureHost`). Election after grace (`ensureHost`) is unchanged.
- **Host mute:** sets `hostMuted` and also sets `selfMuted`. The muted person's app stops sending (trust-based, which is fine here). Lifting a host mute clears only `hostMuted`, so the person stays self-muted. Only the person can unmute themselves, and only if `hostMuted` is false. "Mute all" mutes everyone in voice except the host at that moment. People who join voice later are not muted (my call).
- **Restart:** only in the `playing` phase (results already has Start). Before ending anything, the server checks what `startGame` would refuse over: owner here, head count, `setupProblem`. If one fails, it sends the error and the game keeps going. Then it ends the game with no recap entry (as `endGameToLobby` does today) and starts the same game with the same settings in one step. Unlike a normal start, it keeps `reconnecting` seats; only `disconnected` and `left` seats are dropped. The client asks "Restart this game for everyone?" first.
- **Pause:** new optional `GameDefinition.pause?(state, paused, ctx): GameTransition`.
  - Host only, in `playing`, only for games that define `pause`.
  - On pause, the runtime stores each game and bot timer as time remaining and clears it. Grace and cleanup timers keep running. On resume, it sets them again at now plus remaining.
  - The game shifts its own deadline fields (such as Nightfall's `deadline`) inside the hook, by the paused time.
  - While paused, `game-action`, `stream`, `skip-turn` and `nudge` are refused with "The game is paused." Bots do not move.
  - On resume, `awaitingSince` is moved forward by the paused time.
  - `paused` is in `RoomPublicState`. If the host changes while paused, the new host can resume. Return to lobby and end party clear the pause.
  - Phase 1 ships pause on exactly one game: Nightfall (my call; it has deadlines). Other timed games add it later.
- **Teams:** no new team system. Games that already have teams keep their own team setup. (The spec's "assign teams" is met by those.)
- **Game voice rules:** new optional `GameDefinition.voicePolicy?(state): GameVoicePolicy | null`:
  ```ts
  interface GameVoicePolicy {
    canTalk: string[];  // seat ids
    hears: Record<string, string[]>; // listener id -> speaker ids
    labels?: Record<string, string>; // listener id -> short plain text
  }
  ```
  An edge A to B is allowed only if A is in `canTalk` and A is in `hears[B]`. The server works out each seat's `sendTo` by inverting `hears`. Seats the policy does not name hear nobody and talk to nobody.
  The runtime works out the policy in every commit, before sending updates. For each seat whose rule changed, it sends that seat's `voice-policy` just before its `update`, in the same commit. While mode is `game`, every seat always has an explicit rule: null expands to "everyone hears everyone" and is sent as a full list, so a phone can tell "global" from "no rule yet". On game end, failure or return to lobby it resets to global.
- **Night and day switches:** peer connections stay up for the whole room. A rule change never renegotiates. Each phone turns sending to a peer on or off with `RTCRtpSender.replaceTrack(track | null)` on that peer's connection, and turns playback of a peer on or off with its gain node. It applies removals before additions.
- **Fail closed (on the phone):** when a phone gets a rule it cannot apply yet (peer not connected, error), it sends to nobody and plays nobody covered by that rule until it can. A phone with no rule while mode is `game` sends and plays nothing. After a reconnect the server sends the current rule before the snapshot.
- **Signal relay:** the server relays `voice-signal` only between two seats that are both in voice. It does not block signals by policy, because connections stay up across phases. Relays never write storage.
- **Cap:** voice cap 8 (one constant). It counts everyone in voice, talking or listening, because a listener still costs every talker one more stream. The 9th person gets "Voice is full." and no voice at all. Nightfall plays best up to 10, so test 10 phones on the mesh and raise the cap if audio and heat hold up. (Cap 8: user's call.)
- **TURN credentials:** minted through a new `RoomHost` method (it has no `fetch` today), so tests can fake Cloudflare's API. The fetch runs **outside** the `run()` queue, with a timeout, so it never holds up game actions (my call). Credentials are cached per room with a long TTL (hours) and handed out on `voice-join`. A phone sends `voice-ice-request` before an ICE restart if its credentials are near expiry; there is no server timer for it. Secrets `TURN_KEY_ID`, `TURN_KEY_TOKEN` come from `ServerEnv`. Without them, voice uses STUN only and says nothing extra. No new public HTTP route.

### 5.4 Client (apps/web)

New folder `apps/web/src/voice/`:
- `transport.ts`: the `VoiceTransport` interface from the spec (`connect`, `setPublishing`, `applyPolicy`, `setRemoteGain`, `getStats`, `disconnect`).
- `mesh.ts`: one `RTCPeerConnection` per peer.
  - Every connection negotiates one `sendrecv` audio transceiver from the start, with a null track if there is no mic yet. Going from listen-only to talking, or from muted to unmuted, is then `replaceTrack`, never renegotiation.
  - Perfect negotiation (polite = lower seat id), trickle ICE with queued candidates sent in batches, ICE restart with backoff, rebuild on failure.
  - Each voice-join makes a new random voice session id, and every signal carries it. A phone keys its connections by (seat id, session id). A signal with a new session id from a peer means "start over": close the old connection to that peer and build a new one. Signals with an old session id are dropped. This covers reload, duplicate tab and rebuild.
  - A phone closes its connection to any seat that is no longer in `voice-state` or in the room.
- `audio.ts`:
  - getUserMedia on a user tap with the three processing constraints; device switch through `replaceTrack` on every sender that has a track (on iOS, stop the old track first).
  - Playback uses the AudioContext that `@games/audio` already owns (unlocked on any tap), not a second one. Each remote stream goes through a gain node per player, so per-player volume, "Mute for me" and deafen work. Each remote stream is also attached to a muted `<audio>` element, which Chrome needs before Web Audio gets any sound. The shared context is never closed when someone leaves voice.
  - Output device: `setSinkId` where the browser has it, otherwise the setting is hidden.
  - A "Tap to turn on sound" button when the context is `suspended`, or `interrupted` on Safari (after a call or the lock screen).
  - Level meters at 8 Hz with hysteresis.
  - Watch the mic track's `ended` and `mute` events (iOS in the background) and ask for a tap to get it back.
- `voice.ts`: the controller owned by RoomView. Lives as long as RoomView, so game switches never touch it. Effective talking = joined AND not self-muted AND not host-muted AND policy `canTalk` AND transport up AND (open mic OR push-to-talk held). Deafen is local only, unless "deafen also mutes" is on.
- `prefs.ts`: saved settings in localStorage (same wrapper style as `identity.ts`), including "Mute for me" per person, saved for the room.

UI in `views/`:
- `voice-bar.ts`: compact bar in games (mic, deafen, who is speaking, connection dot). Full panel in lobby and results with the player list, volumes and settings. Everything works by keyboard and by touch, and keys pressed in the bar never reach the game.
- "Turn off mic" in the panel stops the mic track (the browser's mic light goes off). Near the mute button, a short note: "Muted: your mic is still on. Tap Turn off mic to stop it."
- Host actions: today the lobby has only an X per seat. It becomes a small per-seat host menu: Mute, Make host, Remove. Plus "Mute all" and a "Lock room" toggle in the lobby. In a game, host mute goes next to End game in `renderControls`, with Restart and Pause (for games that support it). Remove, Make host and Restart ask "Are you sure?" first.
- Everyone gets "Mute for me" on each person in the panel.
- Push-to-talk: hold Space on desktop (ignored while typing in an input), hold the mic button on phones; releases on keyup, blur, `visibilitychange`, and game unmount. When a Godot iframe has focus, the key is caught on the iframe's window as well, the way Treasure Hunt catches M, and is not passed to the game.
- Ducking: while anyone is speaking, the shell lowers game sound and restores it smoothly. DOM games all play through `@games/audio`, so this is a ramp on its `master` gain (no per-game change). Godot games use `setGameVolume`.
- Soundboard: a small set of bundled sounds (SVG icons, no emoji). Sending is rate limited on the server (one per 3 s per person); each listener plays it locally and can turn it off. When a game voice rule is on, soundboard goes only to the sender's `sendTo`.
- Voice stops (tracks stopped, connections closed) on leave voice, leave room, end party, any fatal close (`removed`, `replaced-by-new-connection`, `room-locked` and the rest), and `RoomView.destroy`.

### 5.5 Game voice rules (first set)

| Game here | Spec game | Rule |
|---|---|---|
| pass-the-bomb, bluff, and every game without `voicePolicy` | Pass the Bomb / Bluff Definitions | global |
| nightfall | Werewolf | `reveal`, `day`, `vote`, `runoff`: living players talk and hear each other; dead players hear the living but cannot talk to them, and talk only with other dead players. `night` (the whole phase): wolves hear each other; every other living player hears nobody; dead players keep their own channel. (My call: only wolves "meet" at night, so they are the "eligible roles"; dead hearing the living is the usual party rule.) |
| short-night | Werewolf | Short Night has no dead players. Night: only during the wolf step of `NIGHT_ORDER`, wolves hear each other and everyone else hears nobody; nobody talks in the other night steps. Other phases: global. (My call.) |
| imposter | Imposter | branches on mode. `clues` mode: muted for all during `clues` (typed clues), global during `discuss` and the vote. `spoken` mode: global during `talk` and the vote. A game setting "Silence while giving clues" (phase 4, default off) makes the `clues` silence optional, as the spec says. |
| dont-say-it | Taboo | global: everyone hears the clue-giver, as at a real table (my call; the spec allows "global audience"). Spoken banned words are on trust. |
| blind-rally | Blind Driving | during countdown and racing, each car's Driver and Navigator hear each other; spares (including late joiners with no role) hear everyone and talk to each other (spectator channel); global in other phases. (My call: spares as the spectator channel.) |
| rally | Blind Driving, one per car | during countdown and racing, each solo driver hears and talks with the spares only; global in other phases. |
| wilds | The Wilds | global. A game setting "Team voice" (phase 4, default off) adds the spec's optional private team channels. |
| treasure-hunt, long-trail (later) | Horror / exploration | proximity: client-side volume by distance, not a secret |

The builder confirms each game's real phase names in code and writes the policy to match; this table is the intent.

### 5.6 Recovery

- Page reload: voice rejoins automatically if it was on (saved pref), with a new session id. Playback is what needs a tap: until the first tap, the shared AudioContext is suspended and the person hears nothing. The mic can often come back without a tap if permission was already given (check the Permissions API where it exists). If it can't, the person is listen-only and sees "Tap to talk again." One tap does both.
- Socket drop: peer connections keep playing while the socket reconnects. On reconnect the server sends `voice-state` and the current `voice-policy` before the snapshot.
- Duplicate tab: the room already closes the older tab ("This room is open in another tab."). Voice ends there with its normal cleanup. The newer tab joins voice with a new session id, so peers rebuild their connections to it.
- Leave voice, leave room, end party, fatal close: stop all tracks and close all peer connections. The shared AudioContext stays.

### 5.7 Privacy

No recording, no transcription, no audio on our servers (TURN only relays it, encrypted). No logging of SDP, ICE candidates, TURN credentials or policies. Optional setting "Hide my network address" forces TURN relay (relay-only ICE). It is disabled when the room has no TURN. Stats (RTT, loss, relay or not) are sampled and stay on the device: they show in the existing debug panel (`apps/web/src/debug.ts`), with no endpoint (my call).

## 6. Delivery phases (match spec section 14)

1. Host controls that do not need voice: lock, transfer host, restart, pause (with Nightfall as its one game). Ships alone.
2. Global mesh voice:
   1. **Audio spike first:** a throwaway test page on real phones (Android Chrome, iOS Safari) checking the audio path: remote stream into the shared AudioContext with the muted `<audio>` element, per-player gain, autoplay unlock, and echo on speakerphone with Chrome's echo cancellation. Results go into the phase 2 plan before any real code.
   2. TURN, join/leave, listen-only, mute, turn off mic, deafen, volumes, "Mute for me", speaking dots, push-to-talk, reconnect, cleanup, settings, output device.
3. Host mute (cooperative), mute all, soundboard, ducking, phone polish, stats in the debug panel.
4. `voicePolicy` for nightfall, short-night, blind-rally, rally and imposter, with the on-phone fail-closed rules; the Imposter and Wilds voice settings.
5. Proximity voice for position games; more polish.

Each phase is its own plan and its own ship.

## 7. Acceptance tests (spec section 15, adapted)

Automated (vitest, existing runtime test harness):
- Voice messages: validation, host-only checks, signal only reaches its target, signal rate limit, locked joins refused (owner and grace-removed seats still allowed), transfer host is not undone by reconnect.
- Voice state: joining, leaving or muting sends `voice-state` and no `update`, and does not change the state version.
- Host mute: lifting it leaves the person self-muted.
- Restart: refused before ending when it could not start; keeps `reconnecting` seats; no recap entry.
- Pause: timers held and restored by time remaining; actions refused while paused; Nightfall's deadline shifted.
- `voicePolicy` diffing: each seat gets only its own policy, before its `update`; `sendTo` is the inverse of `hears`; null is sent as a full list while mode is `game`; no role names or other seats' lists in public state or in another seat's message.
- Phone side (unit test on the voice controller with fake peer connections): a night rule turns sending off to non-wolves without renegotiation; a rule it cannot apply sends and plays nothing; removals applied before additions; a new session id rebuilds the connection; simultaneous offers settle; candidates that arrive before the remote description are queued and applied in order.
- Game switch: no `voice-*` renegotiation messages sent for a switch between any two games, including into and out of Nightfall.

Manual (phones, documented as a checklist in the plan):
- Six browsers in voice, switch three games, no drop.
- Mic denied: game works, listen-only works.
- TURN-only mode gives audio.
- iOS Safari and Android Chrome: autoplay unlock, background and return, device removal, speakerphone echo.
- Repeated game switching for 20 minutes: no growth in tracks, audio elements or memory.
- Game frame times and long tasks with voice off and with the full voice cap on.

## 8. Copy

All new text follows AGENTS.md: short plain sentences, basic words, no idioms, no emoji. Examples: "Join voice", "Listen only", "Your mic is off", "Turn off mic", "Muted: your mic is still on.", "Mute for me", "The host muted you", "Voice is full.", "Voice is paused for this part", "Tap to turn on sound", "Tap to talk again.", "The host locked this room.", "The game is paused.", "Restart this game for everyone?"

## 9. Left to the builder

- Exact UI layout of the bar, panel and per-seat host menu (follow existing room styles).
- Which bundled soundboard sounds (5 to 8, short, free to use).
- Backoff numbers for ICE restart, and tuning the signal rate limit.
- Whether the 8 Hz meter uses an AudioWorklet or `AnalyserNode` (pick the simpler unless it costs frame time).
- Which timed games get `pause` after Nightfall.
- TURN credential TTL (hours) and the near-expiry margin.
