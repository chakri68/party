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
| Opaque room id, short join code, share URL | 4-letter room code, `/r/<code>` links |
| Server-issued session token | `resumeToken` from `welcome`, stored per room in `identity.ts` |
| Reconnect and grace period | `GRACE_MS = 60_000`, presence `reconnecting` then `disconnected` |
| Host election | `ensureHost()` picks the oldest connected human seat |
| Kick | `remove-player` (mid-game only after grace runs out) |
| Return to lobby, end party, select/start game | all exist |
| Party chat, emotes | `chat`, `react`, `emote` messages |
| Typed, validated messages; version check | `packages/protocol` `parseClientMessage`, `PROTOCOL_VERSION` (now 9) |
| Private per-player state | `getPrivateState` per seat |
| Private relay to some players | `stream` with `StreamRelay.to` |

So this work adds voice and the missing host controls to that room. It does **not** add a new party server, a new protocol envelope, or a second room process.

## 3. Goals, non-goals, anti-goals

**Goals** (all from the user's spec):
- Global voice in the room that survives game switches with zero reconnects.
- Listen-only mode; clear mic permission explainer before the browser prompt.
- Overlay: who is in voice, who is speaking, mic, deafen, connection state, per-player volume, settings, leave voice. Compact in games, full panel in lobby.
- Settings: mic device, echo cancellation, noise suppression, auto gain, push-to-talk or open mic, per-player volume, game sound ducking, soundboard volume. Saved locally.
- Push-to-talk with all the release rules; hold-to-talk and tap-to-mute on phones.
- Host controls: lock room, kick, mute one or all, transfer host, restart, pause/resume where a game supports it, assign teams where a game uses teams. Destructive ones confirm first. Host can never turn on someone's mic.
- Game voice rules (spec section 8 table), enforced by the server where secrets are involved.
- Soundboard from bundled sounds.
- Proximity voice for games with positions (later phase).
- Recovery, privacy and abuse rules from spec sections 11 and 12.

**Non-goals** (from the spec): video, recording, transcription, background calling, public matchmaking, user-uploaded sounds, custom codecs, secret channels over peer-to-peer.

**Anti-goals** (failure even if it works):
- A game that breaks or slows down when voice is off or the mic is denied.
- Secret voice (wolf night chat) that an honest player's app plays to the wrong person.
- Any game switch that drops or renegotiates voice.
- Mic still captured after someone leaves voice or the room.

## 4. Approaches considered

**Voice transport**

1. **Peer-to-peer mesh for everything (chosen).** Every phone connects to every other phone in voice. Secret voice works by the sender's phone sending audio only to the people its private rule allows, and each phone refusing to play anyone it may not hear. A modified app cannot make someone else's phone send it audio, so a cheater cannot listen in; the only leak is a player choosing to leak, which they could do by phone anyway. This is a fun game night, not an anti-cheat setting, so that is enough (user's call). No media server, no voice bill.
2. **Mesh plus Cloudflare Realtime SFU for secret phases.** Server-enforced routing, but a paid service and a second transport to maintain, to stop a cheat this game night does not need to stop.
3. **LiveKit.** Same as 2 with a second vendor.

Pick: 1. Keep the `VoiceTransport` interface (spec section 7) so an SFU can be added later if rooms outgrow the mesh. Only `MeshTransport` is built now.

**Deviation from the user's spec, on purpose:** the spec says not to offer secret-role voice over mesh. The user decided (2026-11-21) that sender-side rules over mesh are fine for this game. Host mute is likewise trust-based and needs no warning label in the UI.

**TURN:** Cloudflare Realtime TURN. The Worker mints short-lived credentials from `TURN_KEY_ID` and `TURN_KEY_TOKEN` secrets.

**Party Web Worker (spec section 3):** not built. Room messages here are small JSON updates, and today's socket on the main thread does not show up in long tasks. Adding a worker would put a postMessage hop on every update for no gain, and it would add a second copy of room state. The spec's goal (keep heavy work off the main thread) still holds: voice meters are sampled at 8 Hz, no raw audio crosses threads, and the optional AudioWorklet is used only for level meters. If profiling later shows the socket costs frame time, move it then. (My call, for latency and simpler code.)

**Godot games:** keep the current same-origin iframe/bridge per game. Voice capture stays in the parent shell. Each Godot bridge gets one new call, `setGameVolume(0..1)`, for ducking.

## 5. Design

### 5.1 State (packages/protocol)

`SeatPublic` gains:
```ts
voice?: { joined: boolean; selfMuted: boolean; hostMuted: boolean };
```
`RoomPublicState` gains:
```ts
locked: boolean;
voice: { mode: "off" | "global" | "game" };
```
Speaking indicators are not room state. They are local, measured on each phone from the audio it actually plays.

Per-player voice rules (who I may hear, whether I may talk) go in a new private message, never in the public state, so roles do not leak:
```ts
{ type: "voice-policy"; revision: number; canTalk: boolean; hear: string[] /* seat ids */; label: string /* "Wolves only", plain copy */ }
```
Bump `PROTOCOL_VERSION` to 10.

### 5.2 Messages (added to the existing unions, validated in `parseClientMessage`)

Client to server: `voice-join`, `voice-leave`, `voice-self-mute {muted}`, `voice-signal {to, data}` (size capped, rate limited), `host-mute {playerId | "all", muted}`, `lock-room {locked}`, `transfer-host {playerId}`, `restart-game`, `pause-game {paused}`, `soundboard {soundId}`.

Server to client: `voice-signal {from, data}` (sent only to `to`), `voice-policy` (above), `voice-ice {iceServers, expiresAt}` (TURN credentials, on `voice-join` and before they expire), `soundboard {from, soundId}`.

Rules: actor is always the connection's seat; host-only checks reuse `hostOnly()`; signals go only to a seat that is in voice and allowed by the current policy; SDP and ICE are never stored or logged.

### 5.3 Server (apps/server)

- `RoomRuntime` keeps voice membership on seats and the room's `locked` flag in `RoomData` (stored, so it survives eviction).
- **Lock:** a locked room refuses new joins with a clear error ("The host locked this room."). Resume tokens of existing seats still work.
- **No ban** (user's call): Remove plus Lock room covers it. There is no account or device id to ban by.
- **Owner:** the room owner (owner key) can always join a locked room and can never be removed. Transfer host moves the host role, not ownership.
- **Transfer host:** immediate. The old host does not get it back on reconnect. Election after grace (`ensureHost`) is unchanged.
- **Host mute:** sets `hostMuted`. The muted person's app stops sending (trust-based, which is fine here). Host mute never unmutes anyone; only the person can unmute themselves, and only if `hostMuted` is false.
- **Restart:** return to lobby and start the same game with the same settings in one step.
- **Pause:** new optional `GameDefinition.pause?(state, paused, ctx)`. The runtime also holds the game's timers while paused. Only games that define it show the button. None need it on day one; the builder adds it to timed games where it is simple.
- **Teams:** no new team system. Games that already have teams keep their own settings UI. (The spec's "assign teams" is met by existing per-game settings.)
- **Game voice rules:** new optional `GameDefinition.voicePolicy?(state): GameVoicePolicy | null`:
  ```ts
  interface GameVoicePolicy {
    canTalk: string[];  // seat ids
    hears: Record<string, string[]>; // listener id -> speaker ids
    labels?: Record<string, string>; // listener id -> short plain text
  }
  ```
  The runtime calls it after every commit, compares with the last one, and sends each seat only its own `voice-policy` when it changes. Null means "everyone hears everyone". On game end, failure or return to lobby it resets to global.
- **Night and day switches:** peer connections stay up for the whole room. A rule change never renegotiates; each phone turns sending to a peer on or off with `RTCRtpSender.replaceTrack(track | null)` on that peer's connection, and turns playback of a peer on or off with its gain node. The server sends the new private rule at the same commit as the phase change.
- **Fail closed (on the phone):** when a phone gets a rule it cannot apply yet (peer not connected, error), it sends to nobody and plays nobody covered by that rule until it can. A phone with no rule for a running game with `voicePolicy` sends and plays nothing. After a reconnect the server re-sends the current rule before anything else voice-related.
- **Signal relay:** the server relays `voice-signal` only between two seats that are both in voice. It does not block signals by policy, because connections stay up across phases.
- **Cap:** voice cap 8 (one constant). The 9th person gets listen-only with "Voice is full." Nightfall plays best up to 10, so test 10 phones on the mesh and raise the cap if audio and heat hold up.
- **TURN credentials:** minted inside the room DO on `voice-join` through a new `RoomHost` method (it has no `fetch` today), so tests can fake Cloudflare's API. Secrets `TURN_KEY_ID`, `TURN_KEY_TOKEN` come from `ServerEnv`. Without them, voice uses STUN only and says nothing extra. No new public HTTP route.

### 5.4 Client (apps/web)

New folder `apps/web/src/voice/`:
- `transport.ts`: the `VoiceTransport` interface from the spec (`connect`, `setPublishing`, `applyPolicy`, `setRemoteGain`, `getStats`, `disconnect`).
- `mesh.ts`: one `RTCPeerConnection` per peer, perfect negotiation (polite = lower seat id), trickle ICE with queued candidates, ICE restart with backoff, rebuild on failure.
- `audio.ts`: getUserMedia on a user tap with the three processing constraints; device switch through `replaceTrack`; one playback path per stream (Web Audio graph with a gain node per player, so per-player volume and deafen work); "Tap to turn on sound" button when the AudioContext is suspended; level meters at 8 Hz with hysteresis.
- `voice.ts`: the controller owned by RoomView. Lives as long as RoomView, so game switches never touch it. Effective talking = joined AND not self-muted AND not host-muted AND policy `canTalk` AND transport up. Deafen is local only.
- `prefs.ts`: saved settings in localStorage (same wrapper style as `identity.ts`).

UI in `views/`:
- `voice-bar.ts`: compact bar in games (mic, deafen, who is speaking, connection dot). Full panel in lobby and results with the player list, volumes and settings.
- Host actions go in the existing player menu in the lobby: Mute, Make host, Remove, plus a "Mute all" and "Lock room" toggle. Remove and Make host ask "Are you sure?" first.
- Push-to-talk: hold Space on desktop (ignored while typing in an input), hold the mic button on phones; releases on keyup, blur, `visibilitychange`, and game unmount.
- Ducking: while anyone is speaking, the shell lowers game sound (DOM games through a shared `gameVolume` signal the game views read; Godot through `setGameVolume`), and restores it smoothly.
- Soundboard: a small set of bundled sounds (SVG icons, no emoji). Sending is rate limited on the server (one per 3 s per person); each listener plays it locally and can turn it off. When a game voice rule is on, soundboard goes only to people the sender can talk to.

### 5.5 Game voice rules (first set)

| Game here | Spec game | Rule |
|---|---|---|
| pass-the-bomb, bluff, and every game without `voicePolicy` | Pass the Bomb / Bluff Definitions | global |
| nightfall, short-night | Werewolf | day: living players talk and hear each other; dead players hear the living but cannot talk to them, and talk only with other dead players. Night: wolves hear each other (Nightfall: the whole `night` phase; Short Night: only during the wolf step of `NIGHT_ORDER`); every other living player hears nobody; dead players keep their own channel. (My call: only wolves "meet" at night in both games, so they are the "eligible roles"; dead hearing the living is the usual party rule.) |
| imposter | Imposter | branches on mode. `clues` mode: muted for all during `clues` (typed clues), global during `discuss` and the vote. `spoken` mode: global during `talk` and the vote. |
| dont-say-it | Taboo | global: everyone hears the clue-giver, as at a real table (my call; the spec allows "global audience"). Spoken banned words are on trust. |
| blind-rally | Blind Driving | during countdown and racing, each car's Driver and Navigator hear each other; spares hear everyone and talk to each other (spectator channel); global in other phases. (My call: spares as the spectator channel.) |
| wilds | The Wilds | global |
| treasure-hunt, long-trail (later) | Horror / exploration | proximity: client-side volume by distance, not a secret |

The builder confirms each game's real phase names in code and writes the policy to match; this table is the intent.

### 5.6 Recovery

- Page reload: voice rejoins automatically if it was on (saved pref) but the browser needs a tap for the mic; until then the person is listen-only and sees "Tap to talk again."
- Socket drop: peer connections keep playing while the socket reconnects. Policy updates resume on reconnect (server re-sends `voice-policy`).
- Duplicate tab: unchanged. The room already closes the older tab ("This room is open in another tab."), so voice ends there with its normal cleanup and starts in the newer tab after a tap.
- Leave voice, leave room, end party: stop all tracks, close all peer connections, close the AudioContext.

### 5.7 Privacy

No recording, no transcription, no audio on our servers (TURN only relays it, encrypted). No logging of SDP, ICE candidates, TURN credentials or policies. Optional setting "Hide my network address" forces TURN relay (relay-only ICE). Aggregate stats only (RTT, loss, relay or not), sampled, never per person off the device.

## 6. Delivery phases (match spec section 14)

1. Host controls that do not need voice: lock, transfer host, restart, pause hook. Ships alone.
2. Global mesh voice: TURN, join/leave, listen-only, mute, deafen, volumes, speaking dots, push-to-talk, reconnect, cleanup, settings.
3. Host mute (cooperative), mute all, soundboard, ducking, phone polish, stats sampling.
4. `voicePolicy` for nightfall, short-night, blind-rally and imposter, with the on-phone fail-closed rules.
5. Proximity voice for position games; more polish.

Each phase is its own plan and its own ship.

## 7. Acceptance tests (spec section 15, adapted)

Automated (vitest, existing runtime test harness):
- Voice messages: validation, host-only checks, signal only reaches its target, locked joins refused (owner still allowed), transfer host is not undone by reconnect.
- `voicePolicy` diffing: each seat gets only its own policy; no role names or other seats' hear lists in public state or in another seat's message.
- Phone side (unit test on the voice controller with fake peer connections): a night rule turns sending off to non-wolves without renegotiation; a rule it cannot apply sends and plays nothing.
- Game switch: no `voice-*` renegotiation messages sent for a switch between any two games, including into and out of Nightfall.

Manual (phones, documented as a checklist in the plan):
- Six browsers in voice, switch three games, no drop.
- Mic denied: game works, listen-only works.
- TURN-only mode gives audio.
- iOS Safari and Android Chrome: autoplay unlock, background and return, device removal.
- Repeated game switching for 20 minutes: no growth in tracks, audio elements or memory.

## 8. Copy

All new text follows AGENTS.md: short plain sentences, basic words, no idioms, no emoji. Examples: "Join voice", "Listen only", "Your mic is off", "The host muted you", "Voice is full", "Voice is paused for this part", "Tap to turn on sound".

## 9. Left to the builder

- Exact UI layout of the bar and panel (follow existing room styles).
- Which bundled soundboard sounds (5 to 8, short, free to use).
- Backoff numbers for ICE restart.
- Whether the 8 Hz meter uses an AudioWorklet or `AnalyserNode` (pick the simpler unless it costs frame time).
- Which timed games get `pause` first.
