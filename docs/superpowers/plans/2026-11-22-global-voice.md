# Global Voice (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everyone in a room can join one peer-to-peer voice call that lasts across every game switch, with listen-only, mute, turn off mic, deafen, per-player volume, "Mute for me", speaking dots, push-to-talk, reconnect, cleanup and local settings.

**Architecture:** The room server keeps the voice roster (stored in `RoomData`, sent only as an unversioned `voice-state` message, never through `commit`), relays `voice-signal` between two seats in voice without writing anything, and mints Cloudflare TURN credentials outside the `run()` queue. Each phone runs a `VoiceController` owned by `RoomView`, a `MeshTransport` (one `RTCPeerConnection` per peer, perfect negotiation, one `sendrecv` audio transceiver from the start) and a `Playback` graph on the shared `@games/audio` AudioContext. Voice rules go through one `VoiceRule` seam that is the "everyone" rule now, so phase 3 (host mute, soundboard, ducking) and phase 4 (`voicePolicy`) plug in without reshaping anything.

**Tech Stack:** TypeScript, vitest (node environment, no DOM), partyserver Durable Object, WebRTC, Web Audio.

**Spec:** `docs/superpowers/specs/2026-11-21-party-voice-design.md` (phase 2 = section 6 item 2.2). Phase 1 (lock, make host, restart, pause) is already on master; read the code, not the spec, for what exists.

## Global Constraints

- Bump `PROTOCOL_VERSION` in `packages/protocol/src/index.ts` from 10 to 11 (Task 1, once).
- Player-facing copy: short plain sentences, basic words, no idioms or slang (Indian ESL readers). No emoji anywhere (UI, docs, commit messages). Icons are SVG paths in `apps/web/src/brand.ts`. Use the spec section 8 lines verbatim: "Join voice", "Listen only", "Your mic is off", "Turn off mic", "Muted: your mic is still on. Tap Turn off mic to stop it.", "Mute for me", "Voice is full.", "Tap to turn on sound", "Tap to talk again."
- Latency over cleverness, but never at the cost of the game: no voice message bumps `stateVersion`, sends an `update`, or calls `commit`. `voice-join`, `voice-leave` and `voice-self-mute` do one `persist()` each (the roster is stored, spec 5.3). `voice-signal` writes nothing and is never stored or logged. The TURN fetch runs outside the `run()` queue with a timeout.
- Voice never breaks a game: every game works with the mic denied, with no `RTCPeerConnection`, with no `getUserMedia`, and with TURN down. Voice code catches its own errors and never throws into `RoomView`.
- No SDP, ICE candidate, TURN credential or voice roster detail goes to `logError`/`console`.
- Shared code on `master` only. Nothing in `apps/product-*`.
- Not in this phase: host mute, mute all, soundboard, ducking, `voicePolicy`/`voice-policy`, proximity, debug-panel stats. Leave the seams (named below) but no code for them.
- Implementers never open a browser. All client logic lives in modules that take their browser objects as injected dependencies, and is tested with fakes (`FakePeer`, fake `MediaStreamTrack`, fake AudioContext). DOM-only glue (rendering, `MutationObserver`) stays thin and is covered by the manual checklist at the end.
- Tests: `pnpm vitest run <path>` for one file, `pnpm test` for all, `pnpm typecheck` for types. Both must pass before every commit.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01KwNUn8AHWzbftW559ZRTih
  ```

## Review Focus

1. A seat leaves the room by a path other than `leave` (the lobby `startGame` drops `reconnecting` seats, end party, grace expiry mid-game, host Remove): it must leave voice and every phone must close its link to it. Test in Task 2: "a reconnecting seat dropped by Start leaves voice".
2. TURN API slow, down, returning junk, or secrets missing: the joiner still gets STUN-only `voice-ice`, and game messages sent while the fetch hangs are not delayed. Test in Task 3: "a hung TURN fetch does not hold up the room".
3. The same seat in two tabs, or a reload while in voice: the old tab drops its mic and links; the new tab joins with a new session and peers rebuild; answers meant for the old session are dropped. Tests in Task 4 ("signals for my old session are dropped") and Task 6 ("rejoin after welcome without me in the roster starts a new session").
4. Space pressed while typing in chat, while a game button has focus, or inside a Godot iframe: typing and button presses work as before; push-to-talk only fires on Space with nothing activatable focused, and is released on keyup, blur, tab hidden and game unmount. Tests in Task 6 (`ptt.test.ts`).
5. Mic denied, no WebRTC, or voice joined before the first tap (no AudioContext yet): game works, listen-only works, and sound starts after one tap with no rejoin. Tests in Task 5 ("streams attached before the context exists play once it does") and Task 6 ("no RTCPeerConnection: status unsupported, sends nothing").

---

## File Structure

| File | Responsibility |
|---|---|
| `AGENTS.md` | Fix the pause hook wording (Task 1 step 1). |
| `packages/protocol/src/index.ts` | Voice messages, `VoiceMember`, `IceServer`, `VOICE_CAP`, `RoomPublicState.voice`, `voice-full`, version 11. |
| `apps/server/src/voice.ts` (new) | Pure roster helpers and the `IceCache`. |
| `apps/server/src/turn.ts` (new) | Cloudflare credential fetch with timeout. |
| `apps/server/src/runtime.ts` | Voice cases, roster prune/broadcast, `RoomHost.turnCredentials`. |
| `apps/server/src/policy.ts`, `worker.ts` | `TURN_KEY_ID` / `TURN_KEY_TOKEN` on `ServerEnv`, host wiring. |
| `packages/webrtc/src/index.ts` | `VoiceTransport`, `VoiceRule`, `SignalData`, `globalRule`; replaces `PeerTransport`. |
| `packages/room-client/src/index.ts` | `voice-state`, `voice-signal`, `voice-ice` events. |
| `packages/audio/src/index.ts` | Public `context` and `onContext` on the shared manager. |
| `apps/web/src/voice/mesh.ts` (new) | `MeshTransport`. |
| `apps/web/src/voice/audio.ts` (new) | `Playback`, `Mic`, `nextSpeaking`. |
| `apps/web/src/voice/prefs.ts` (new) | Saved settings, per-room volumes and blocks. |
| `apps/web/src/voice/ptt.ts` (new) | Push-to-talk keys, frame watcher. |
| `apps/web/src/voice/voice.ts` (new) | `VoiceController`. |
| `apps/web/src/views/voice-bar.ts` (new) | Bar, panel, settings dialog, explainer; pure `voiceBarModel`. |
| `apps/web/src/views/room.ts` | Owns the controller; wiring and cleanup. |
| `apps/web/src/identity.ts` | Export the storage wrapper for `prefs.ts`. |
| `docs/games/rooms.md` | A "Voice" section for players. |

---

### Task 1: AGENTS.md fix and voice protocol

**Files:**
- Modify: `AGENTS.md` ("Adding a game: pause", item 1)
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/voice.test.ts` (new)

**Interfaces:**
- Produces (all exported from `@games/protocol`):
  ```ts
  export const VOICE_CAP = 8;
  /** Raw length cap for one voice-signal message. An audio-only SDP is about 3 to 5 KB. */
  export const VOICE_SIGNAL_MAX_LENGTH = 6144;
  export type VoiceMode = "off" | "global" | "game";
  export interface VoiceMember { id: string; selfMuted: boolean; hostMuted: boolean }
  export interface IceServer { urls: string | string[]; username?: string; credential?: string }
  // RoomPublicState gains:  voice: { mode: VoiceMode };
  // ClientMessage gains:
  | { type: "voice-join"; muted: boolean }
  | { type: "voice-leave" }
  | { type: "voice-self-mute"; muted: boolean }
  | { type: "voice-signal"; to: string; session: string; data: unknown }
  | { type: "voice-ice-request" }
  // ServerMessage gains:
  | { type: "voice-state"; members: VoiceMember[] }
  | { type: "voice-signal"; from: string; session: string; data: unknown }
  | { type: "voice-ice"; iceServers: IceServer[]; expiresAt: number }
  // ErrorCode gains "voice-full" (not fatal).
  ```

- [ ] **Step 1: Fix AGENTS.md pause wording**

Replace item 1 of "Adding a game: pause" with:

> 1. Define `pause(state, paused, ctx)` on the definition. It gets the state, whether the room is pausing (`paused` is true) or resuming (false), and `ctx`. When pausing, note `ctx.now` in your state. When resuming, shift your own deadline fields by the time paused (`ctx.now` minus the time you noted), and clear the note. The room holds the timers and stops `ctx.now` while paused. See Nightfall's `pause`.

- [ ] **Step 2: Write the failing parse tests** in `packages/protocol/test/voice.test.ts`

```ts
const parse = (m: object) => parseClientMessage(JSON.stringify(m));
it("is version 11", () => expect(PROTOCOL_VERSION).toBe(11));
it("parses voice-join with its muted flag", () => {
  expect(parse({ type: "voice-join", muted: true })).toEqual({ type: "voice-join", muted: true });
  expect(parse({ type: "voice-join" })).toBeNull();
});
it("parses voice-leave and voice-ice-request with no fields", () => {
  expect(parse({ type: "voice-leave", x: 1 })).toEqual({ type: "voice-leave" });
  expect(parse({ type: "voice-ice-request" })).toEqual({ type: "voice-ice-request" });
});
it("parses voice-self-mute", () => {
  expect(parse({ type: "voice-self-mute", muted: false })).toEqual({ type: "voice-self-mute", muted: false });
  expect(parse({ type: "voice-self-mute", muted: "no" })).toBeNull();
});
it("parses voice-signal with an object payload", () => {
  const m = { type: "voice-signal", to: "abc", session: "s1", data: { kind: "ice", candidates: [] } };
  expect(parse(m)).toEqual(m);
  expect(parse({ ...m, data: "text" })).toBeNull();
  expect(parse({ ...m, session: "" })).toBeNull();
  expect(parse({ ...m, to: "x".repeat(65) })).toBeNull();
});
it("refuses a voice-signal over VOICE_SIGNAL_MAX_LENGTH", () => {
  const big = { type: "voice-signal", to: "abc", session: "s1", data: { sdp: "x".repeat(VOICE_SIGNAL_MAX_LENGTH) } };
  expect(parse(big)).toBeNull();
});
it("voice-full is not fatal", () => expect(FATAL_ERRORS.has("voice-full")).toBe(false));
```

- [ ] **Step 3: Run to see it fail**

Run: `pnpm vitest run packages/protocol/test/voice.test.ts`
Expected: FAIL (version is 10, voice types unknown).

- [ ] **Step 4: Implement in `packages/protocol/src/index.ts`**

Add the types and constants above. In `parseClientMessage`: `voice-join`/`voice-self-mute` need a boolean `muted`; `voice-signal` needs `isStr(to, 64)`, non-empty `isStr(session, 64)`, `isObj(data)`, and `raw.length <= VOICE_SIGNAL_MAX_LENGTH`; `voice-leave` and `voice-ice-request` join the no-field list. Add `voice: { mode: VoiceMode }` to `RoomPublicState` with a doc comment: "off" once the party has ended, "global" otherwise; "game" is for phase 4. Set `PROTOCOL_VERSION = 11`. In `runtime.ts` `publicState()`, add `voice: { mode: data.phase === "ended" ? "off" : "global" }` so the server still typechecks.

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm vitest run packages/protocol && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add AGENTS.md packages/protocol apps/server/src/runtime.ts
git commit -m "Protocol: voice messages, version 11; fix pause hook notes"
```

---

### Task 2: Server voice roster

**Files:**
- Create: `apps/server/src/voice.ts`
- Modify: `apps/server/src/runtime.ts`
- Modify: `apps/server/test/harness.ts` (count storage writes)
- Test: `apps/server/test/voice.test.ts` (new)

**Interfaces:**
- Consumes: Task 1 types.
- Produces in `apps/server/src/voice.ts`:
  ```ts
  /** Members whose seat is still here and still a person: drops missing, bot, "disconnected" and "left" seats, and everyone once the party has ended. Order kept. */
  export function pruneVoice(members: VoiceMember[], seats: { id: string; presence: Presence; bot?: true }[], phase: RoomPhase): VoiceMember[];
  ```
- `RoomData` gains `voice?: VoiceMember[]` (join order). `RoomRuntime` gains a private `lastVoiceSent: string | null` (JSON of the roster last broadcast; in memory) and `private flushVoice(): void` (prunes, and broadcasts `voice-state` to every seated live conn when the JSON changed).

Rules (spec 5.3):
- `voice-join {muted}`: phases lobby, playing, results (otherwise `wrong-phase`). Not a member and roster at `VOICE_CAP` → `error("voice-full", "Voice is full.")`. New member: `{ id, selfMuted: muted, hostMuted: false }`. Already a member: set `selfMuted = muted || hostMuted`. Then `persist()` and `flushVoice()`. (Task 3 adds the ICE reply.)
- `voice-leave`: remove if member, `persist()`, `flushVoice()`. Not a member: nothing.
- `voice-self-mute {muted}`: not a member → nothing. Unmute while `hostMuted` → `error("not-available", "The host muted you")`. Otherwise set, `persist()`, `flushVoice()`; no send if unchanged.
- `commit()` runs `data.voice = pruneVoice(...)` before `persist()`, and `flushVoice()` after the updates go out. That covers leave, remove, grace expiry, start-game drops and end party with no change at those call sites.
- `onJoin`: right after `welcome` and before the commit's snapshot, send that conn `{ type: "voice-state", members: data.voice ?? [] }`.
- A seat that is `reconnecting` stays in voice.

- [ ] **Step 1: Add a write counter to the harness**

`World.puts = 0`, incremented in `storage.put`. Nothing else changes.

- [ ] **Step 2: Write the failing tests** in `apps/server/test/voice.test.ts` (style of `host-controls.test.ts`: `World`, `join`, `send`, `roomOf`; games `{ toy: toyGame, plain: plainGame }`)

```ts
const members = (c: FakeConn) => c.last("voice-state")!.members;
it("a new seat gets voice-state right after welcome, before its update", ...);
  // inbox types: index of "voice-state" === index of "welcome" + 1, and < index of first "update"
it("joining sends voice-state to everyone and no update", async () => {
  const v = a.last("update")!.stateVersion; const n = b.of("update").length;
  await send(room, a, { type: "voice-join", muted: false });
  expect(members(b)).toEqual([{ id: idOf(a), selfMuted: false, hostMuted: false }]);
  expect(b.of("update")).toHaveLength(n);
  expect(a.last("update")!.stateVersion).toBe(v);
});
it("listen only joins muted", ...);           // muted: true -> selfMuted true
it("leave and self-mute each send voice-state", ...);
it("a repeated self-mute sends nothing", ...);
it("the ninth person gets Voice is full.", async () => {
  // 9 seats join voice; 9th: last error { code: "voice-full", message: "Voice is full.", fatal: false }
  // roster length 8; 9th not closed
});
it("refuses voice-join after the party ended", ...);   // wrong-phase, and roster empty
it("keeps a reconnecting seat in voice", ...);
it("drops a seat from voice when lobby grace runs out", ...);   // tick GRACE_MS: voice-state without it
it("drops a disconnected seat from voice mid-game", ...);
it("a reconnecting seat dropped by Start leaves voice", async () => {
  // b joins voice, disconnects; a starts the game: members(a) no longer has b
});
it("leave, Remove and End party empty the roster for them", ...);
it("switching games sends no voice messages", async () => {
  // a, b in voice; count voice-* messages; start toy, return-to-lobby, select plain, start, end -> count unchanged
});
it("roomOf(a).voice.mode is global, and off once the party ends", ...);
it("one storage write per roster change", ...);  // world.puts before/after voice-join === +1
```

- [ ] **Step 3: Run to see it fail**

Run: `pnpm vitest run apps/server/test/voice.test.ts`
Expected: FAIL (unknown cases, no voice-state).

- [ ] **Step 4: Implement `pruneVoice` and the runtime cases** as listed above. Bots can never be members (`pruneVoice` drops them, and `voice-join` is only reachable by a seated conn).

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run apps/server && pnpm typecheck`
Expected: PASS, all older runtime tests too.

- [ ] **Step 6: Commit**

```bash
git add apps/server
git commit -m "Room: voice roster, sent outside room updates"
```

---

### Task 3: Signal relay and TURN credentials

**Files:**
- Create: `apps/server/src/turn.ts`
- Modify: `apps/server/src/voice.ts`, `runtime.ts`, `policy.ts`, `worker.ts`, `env.d.ts` (comment only)
- Test: `apps/server/test/voice.test.ts` (extend), `apps/server/test/turn.test.ts` (new)

**Interfaces:**
- Consumes: Task 2 roster.
- Produces:
  ```ts
  // runtime.ts, RoomHost:
  /** Mints TURN servers for `ttlSeconds`. Absent: STUN only. Null or a throw: STUN only this time. */
  turnCredentials?(ttlSeconds: number): Promise<IceServer[] | null>;

  // voice.ts:
  export const VOICE_SIGNAL_LIMIT = { burst: 60, windowMs: 3_000 }; // about 20 a second, burst 60
  export const ICE_REQUEST_LIMIT = { burst: 3, windowMs: 60_000 };
  export const TURN_TTL_S = 4 * 60 * 60;
  /** A cached credential this close to expiry is fetched again. */
  export const ICE_REUSE_MARGIN_MS = 30 * 60_000;
  /** After a failed fetch, hand out STUN only for this long before trying again. */
  export const ICE_FAIL_BACKOFF_MS = 60_000;
  export const STUN_ONLY: IceServer[] = [{ urls: "stun:stun.cloudflare.com:3478" }];
  export class IceCache {
    constructor(mint: ((ttlSeconds: number) => Promise<IceServer[] | null>) | undefined, now: () => number);
    /** Cached if it has more than ICE_REUSE_MARGIN_MS left; one fetch in flight at a time, shared by callers. Never rejects. */
    get(): Promise<{ iceServers: IceServer[]; expiresAt: number }>;
  }

  // turn.ts:
  export const TURN_FETCH_TIMEOUT_MS = 3_000;
  /** Undefined unless both secrets are set. */
  export function turnMinter(env: { TURN_KEY_ID?: string; TURN_KEY_TOKEN?: string }, fetchFn?: typeof fetch): ((ttlSeconds: number) => Promise<IceServer[] | null>) | undefined;
  ```
- `ServerEnv` gains `TURN_KEY_ID?: string; TURN_KEY_TOKEN?: string`. `RoomBase.runtime` sets `turnCredentials: turnMinter(env)` (omitted when undefined).

Cloudflare API (from https://developers.cloudflare.com/realtime/turn/generate-credentials/): `POST https://rtc.live.cloudflare.com/v1/turn/keys/${TURN_KEY_ID}/credentials/generate-ice-servers`, headers `Authorization: Bearer ${TURN_KEY_TOKEN}` and `Content-Type: application/json`, body `{"ttl": <seconds>}`. Success is `201` with `{ "iceServers": [ { "urls": [...] }, { "urls": [...], "username": "...", "credential": "..." } ] }`. The docs warn that port 53 URLs time out in browsers, so drop every URL matching `/:53(\?|$)/` and any entry left with no URLs. Use `AbortSignal.timeout(TURN_FETCH_TIMEOUT_MS)`. Any non-2xx, timeout, bad JSON or no `iceServers` array → `null`. Never log the response body or credentials.

Rules:
- `voice-signal`: sender and `to` must both be in the roster, `to !== sender`, and `allow("signal", seat.id, VOICE_SIGNAL_LIMIT)`. Otherwise drop with no reply (like `stream`). Send `{ type: "voice-signal", from: seat.id, session, data }` to every live conn of `to`. No `persist`, no log.
- After a `voice-join` is accepted (Task 2), call `void this.sendIce(conn, seat.id)` and do not await it. `sendIce` awaits `iceCache.get()` and then sends `voice-ice` only if that conn is still live, still that seat, and the seat is still in voice. It never touches `run()`, `persist` or `commit`.
- `voice-ice-request`: member only, `allow("ice", seat.id, ICE_REQUEST_LIMIT)`, then the same `sendIce`. Not a member or over the limit: drop.
- The `IceCache` lives in memory on the runtime. After an eviction it starts empty again, which is fine.

- [ ] **Step 1: Write the failing tests**

`apps/server/test/voice.test.ts` (World gets an optional `turn?: (ttl: number) => Promise<IceServer[] | null>` passed as `turnCredentials`):
```ts
it("a signal reaches only its target", ...);           // a,b,c in voice; a->b: b has voice-signal {from: a, session, data}; c has none
it("drops a signal to or from a seat not in voice", ...);
it("drops signals past the rate limit", async () => {
  // 70 signals a->b at one clock time: b gets 60; after world.clock += 3000, the next one arrives
});
it("relaying a signal writes nothing", ...);            // world.puts unchanged
it("joining voice with no TURN gives STUN only", async () => {
  await send(room, a, { type: "voice-join", muted: false }); await flushPromises();
  expect(a.last("voice-ice")).toEqual({ type: "voice-ice", iceServers: STUN_ONLY, expiresAt: world.clock + TURN_TTL_S * 1000 });
});
it("hands out TURN servers and fetches once for the room", ...);   // fake counts calls: 1 after two joins
it("fetches again when the cached ones are near expiry", ...);     // clock += TURN_TTL_S*1000 - ICE_REUSE_MARGIN_MS + 1; voice-ice-request -> 2 calls
it("a failed TURN fetch gives STUN only, and waits a minute to retry", ...);
it("a hung TURN fetch does not hold up the room", async () => {
  world.turn = () => new Promise(() => {});  // never settles
  await send(room, a, { type: "voice-join", muted: false });
  await send(room, a, { type: "ready", ready: true });
  expect(roomOf(b).seats.find((s) => s.id === idOf(a))!.ready).toBe(true);
});
it("no voice-ice for a seat that left voice before the fetch came back", ...);
```
`apps/server/test/turn.test.ts`:
```ts
it("is undefined without both secrets", ...);
it("posts the TTL to the Cloudflare URL with the bearer token", async () => {
  // fake fetch records (url, init): url === "https://rtc.live.cloudflare.com/v1/turn/keys/kid/credentials/generate-ice-servers",
  // init.method "POST", headers Authorization "Bearer tok", body JSON {ttl: 14400}
});
it("drops port 53 URLs", ...);   // "turn:turn.cloudflare.com:53?transport=udp" removed, others kept
it("gives null on a non-2xx, bad JSON or a thrown fetch", ...);
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm vitest run apps/server/test/voice.test.ts apps/server/test/turn.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** `turn.ts`, `IceCache`, the runtime cases and `sendIce`, the `ServerEnv` fields and the worker wiring.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run apps/server && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "Room: relay voice signals and hand out TURN servers"
```

---

### Task 4: Voice transport interface and mesh

**Files:**
- Modify: `packages/webrtc/src/index.ts` (replace `PeerTransport`), `packages/webrtc/tsconfig.json` (lib `["ES2023", "DOM"]`, include `test`)
- Create: `apps/web/src/voice/mesh.ts`
- Create: `apps/web/test/voice/fake-rtc.ts`
- Modify: `apps/web/package.json` (add `"@games/webrtc": "workspace:*"`, then `pnpm install`)
- Test: `packages/webrtc/test/rule.test.ts`, `apps/web/test/voice/mesh.test.ts`

**Interfaces:**
- Produces in `@games/webrtc` (the only transport interface; `PeerTransport` goes):
  ```ts
  /** One seat's voice rule. Phase 4 gets these from the server; now everyone gets globalRule. */
  export interface VoiceRule { canTalk: boolean; hear: string[]; sendTo: string[]; label: string }
  /** Everyone in voice hears and talks to everyone. label "". */
  export function globalRule(selfId: string, memberIds: string[]): VoiceRule;
  export type LinkState = "connecting" | "connected" | "reconnecting" | "closed";
  /** Rides inside voice-signal's opaque data. toSession: the recipient's link session the sender is bound to, null before it knows. */
  export type SignalData =
    | { kind: "sdp"; toSession: string | null; description: { type: RTCSdpType; sdp?: string } }
    | { kind: "ice"; toSession: string | null; candidates: RTCIceCandidateInit[] };
  export interface VoicePeerStats { peerId: string; rttMs: number | null; packetsLost: number | null; relayed: boolean | null }
  export interface VoiceConnectOptions { selfId: string; session: string; iceServers: RTCIceServer[]; iceExpiresAt: number; relayOnly: boolean }
  export interface VoiceTransport {
    connect(opts: VoiceConnectOptions): void;
    /** The other seats in voice now. Opens links to new ones, closes links to gone ones. */
    setPeers(peerIds: string[]): void;
    handleSignal(from: string, session: string, data: unknown): void;
    setIceServers(servers: RTCIceServer[], expiresAt: number): void;
    /** The track to send, or null to send nothing. Always replaceTrack, never renegotiation. */
    setPublishing(track: MediaStreamTrack | null): Promise<void>;
    /** Sends only to rule.sendTo and plays only rule.hear. Removals before additions. Fail closed for peers not connected yet. */
    applyPolicy(rule: VoiceRule): void;
    setRemoteGain(peerId: string, gain: number): void;
    getStats(): Promise<VoicePeerStats[]>;
    disconnect(): void;
  }
  ```
- Produces in `apps/web/src/voice/mesh.ts`:
  ```ts
  /** The bits of RTCPeerConnection the mesh uses. FakePeer implements the same. */
  export type PeerLike = Pick<RTCPeerConnection, "signalingState" | "connectionState" | "localDescription" | "remoteDescription"
    | "addTransceiver" | "setLocalDescription" | "setRemoteDescription" | "addIceCandidate" | "restartIce" | "setConfiguration"
    | "getStats" | "close" | "onnegotiationneeded" | "onicecandidate" | "ontrack" | "onconnectionstatechange">;
  /** What the mesh plays into (Task 5's Playback has these). */
  export interface PlaybackSink { attach(peerId: string, stream: MediaStream): void; detach(peerId: string): void; setGain(peerId: string, gain: number): void; setAllowed(peerId: string, allowed: boolean): void }
  export interface MeshDeps {
    createPeer(config: RTCConfiguration): PeerLike;
    sendSignal(to: string, session: string, data: SignalData): void;
    playback: PlaybackSink;
    onLinkState(peerId: string, state: LinkState): void;
    /** Sends voice-ice-request; resolves on the next voice-ice, or after 3 s. */
    refreshIce(): Promise<void>;
    clock: { now(): number; setTimeout(fn: () => void, ms: number): number; clearTimeout(id: number): void };
  }
  export const CANDIDATE_BATCH_MS = 100;
  export const RESTART_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000];
  /** "disconnected" this long counts as failed. */
  export const DISCONNECTED_GRACE_MS = 3_000;
  /** Ask for new ICE servers before a restart when they expire within this. */
  export const ICE_NEAR_EXPIRY_MS = 10 * 60_000;
  export class MeshTransport implements VoiceTransport { constructor(deps: MeshDeps) }
  ```

Behaviour (spec 5.4):
- One link per peer. On open: `createPeer({ iceServers, iceTransportPolicy: relayOnly ? "relay" : "all" })`, then `addTransceiver("audio", { direction: "sendrecv" })` with no track. Keep the transceiver's sender. Never add or remove transceivers again.
- Perfect negotiation: polite = my seat id sorts before the peer's (`selfId < peerId`). `onnegotiationneeded` → `setLocalDescription()` and send `sdp`. On an incoming offer during my own offer (`makingOffer || signalingState !== "stable"`): impolite ignores it, polite calls `setRemoteDescription(offer)` (implicit rollback), then `setLocalDescription()` and sends the answer.
- Candidates: outgoing ones gather per peer and go out as one `ice` signal every `CANDIDATE_BATCH_MS`. Incoming ones that come before `remoteDescription` wait in a queue and are added in arrival order right after it is set. An ignored offer's candidates are dropped.
- Sessions: my link session to a peer is `${session}.${rebuilds}`, and every signal I send for that link carries it. Each link remembers the peer's session (null until the first signal) and the sessions it has retired. An incoming signal with `toSession` set and not equal to my current link session is dropped. One from a retired session is dropped. One with a new session when the link already has one means start over: close the link (`playback.detach`), open a new one bound to the new session, then handle the signal.
- Failure: `connectionState` "failed", or "disconnected" for `DISCONNECTED_GRACE_MS`, means restart. Before each restart, if `iceExpiresAt - now < ICE_NEAR_EXPIRY_MS`, await `refreshIce()` (Task 6 then calls `setIceServers`, which does `setConfiguration` on every link). Then `restartIce()`. Wait `RESTART_BACKOFF_MS[i]` between tries. After the last one, rebuild: `rebuilds++`, close, open a fresh link. Report `onLinkState` at each step.
- `ontrack` → `playback.attach(peerId, streams[0])`. A link that closes → `playback.detach(peerId)`.
- Policy: keep the latest rule. For each link, `send = rule.canTalk && rule.sendTo.includes(peer) && connected`, `play = rule.hear.includes(peer) && connected`. First every `replaceTrack(null)` and `setAllowed(peer, false)` that turns something off, then the ones that turn something on. Re-run when a link connects, when `setPublishing` changes the track, and on every `applyPolicy`. A link that is not connected sends `null` and plays nothing.
- `disconnect()`: clear timers, close every link, detach every stream. Ignore everything afterwards.

- [ ] **Step 1: Write `globalRule` test** (`packages/webrtc/test/rule.test.ts`): `globalRule("a", ["a","b","c"])` equals `{ canTalk: true, hear: ["b","c"], sendTo: ["b","c"], label: "" }`.

- [ ] **Step 2: Write the fake** `apps/web/test/voice/fake-rtc.ts`:
  - `FakePeer` implements `PeerLike`. `addTransceiver` queues one `negotiationneeded` (microtask). `setLocalDescription()` makes an offer in `stable` or an answer in `have-remote-offer`, with sdp `"<kind>:<peer#>:<n>"`, and counts offers in `offers`. `setRemoteDescription(offer)` in `have-local-offer` does an implicit rollback. `addIceCandidate` throws if `remoteDescription` is null and records adds in `added`. `restartIce()` queues `negotiationneeded` and sets `restarts++`. The test sets `connectionState` with `fakeState(pc, s)`, which fires `onconnectionstatechange`. Once both sides are `stable` with both descriptions set, the pair goes "connected" and each fires `ontrack` with a `FakeStream`. The sender records `replaceTrack` calls in a shared `log` array, in order.
  - `FakeNet` links two or more `MeshTransport`s. `sendSignal` goes to the target's `handleSignal` through a JSON round trip, after a microtask. `net.hold()` and `net.release()` let a test reorder or delay messages.
  - `FakeClock` with `advance(ms)`. `FakePlayback` records calls.

- [ ] **Step 3: Write the failing mesh tests** (`apps/web/test/voice/mesh.test.ts`):
```ts
it("two peers connect and each plays the other", ...);  // both links "connected"; playback.attach called once per side
it("simultaneous offers settle with the lower id polite", ...);  // both setPeers at once; both connected; impolite side's pc saw no rollback
it("candidates before the remote description are queued and added in order", ...);
it("sends candidates in batches every 100 ms", ...);     // 3 candidates in 50 ms -> one "ice" signal with 3
it("publishing is replaceTrack on each sender, with no new offer", async () => {
  // after connect: offers count n; setPublishing(track) -> each sender's last replaceTrack is track; offers still n
});
it("a rule turns sending and playing off and on without renegotiation, removals first", async () => {
  // 3 peers b,c,d; applyPolicy({canTalk:true, hear:["b"], sendTo:["b","c"]}) after a rule with d only:
  // log shows replaceTrack(null) for d and setAllowed(d,false) before replaceTrack(track) for b,c; offers unchanged
});
it("fails closed for a peer that is not connected yet", ...);   // rule names b before connect: no track sent, setAllowed(b,true) only after "connected"
it("a new session from a peer rebuilds the link and drops the old session's signals", ...);
it("signals for my old session are dropped", ...);   // a rebuilds (new link session); a late answer with toSession = old is ignored, no throw
it("closes the link to a peer that left voice", ...); // setPeers without b -> pc.close, playback.detach(b)
it("restarts ICE with backoff, then rebuilds with a new link session", ...); // failed -> restarts at 1,2,4,8 s, then a new FakePeer with session "s.1"
it("asks for new ICE servers before a restart near expiry", ...);
it("relay only sets iceTransportPolicy relay", ...);
it("disconnect closes every link and detaches every stream", ...);
```

- [ ] **Step 4: Run to see them fail**

Run: `pnpm vitest run apps/web/test/voice/mesh.test.ts packages/webrtc`
Expected: FAIL.

- [ ] **Step 5: Implement** `@games/webrtc` and `MeshTransport` as above. Catch every promise inside the mesh. A failed `setRemoteDescription` or `addIceCandidate` counts as a failed link (restart path), never a throw.

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm vitest run apps/web/test/voice packages/webrtc && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/webrtc apps/web/src/voice/mesh.ts apps/web/test/voice apps/web/package.json pnpm-lock.yaml
git commit -m "Voice: transport interface and peer-to-peer mesh"
```

---

### Task 5: Audio playback, mic and speaking levels

**Spike not run (user's call, 2026-11-22: phones get tested at the end). Ruling: build the spec's path, (a) Web Audio graph on the shared context with a per-player GainNode, (b) plus a muted `<audio>` element per remote stream, (c) output device via `AudioContext.setSinkId` when present, else per-element `setSinkId`, else hidden, (d) all three processing constraints on, (e) `sendrecv` transceiver with a null track filled by `replaceTrack`. Keep every one of these choices inside `apps/web/src/voice/audio.ts` (and (e) inside `mesh.ts`) behind one exported `PLAYBACK` constant object with a documented element-only fallback (`mode: "element"`: unmuted `<audio>`, `element.volume` for gain), tested both ways, so the phone test can flip it with a one-line change.**

**Files:**
- Modify: `packages/audio/src/index.ts`
- Create: `apps/web/src/voice/audio.ts`
- Test: `apps/web/test/voice/audio.test.ts`, `apps/web/test/voice/fake-audio.ts`

**Interfaces:**
- Consumes: `PlaybackSink` (Task 4).
- Produces in `@games/audio` (on the `Feedback` manager):
  ```ts
  /** The one AudioContext, once a tap made it. Voice plays here too; never closed. */
  get context(): AudioContext | null;
  /** Called with the context when it is made, and on every statechange after. Returns an unsubscribe. */
  onContext(fn: (ctx: AudioContext) => void): () => void;
  ```
  Voice does not go through `master` (that is game sound, and phase 3 ducks it).
- Produces in `apps/web/src/voice/audio.ts`:
  ```ts
  export interface AudioEnv {
    context(): AudioContext | null;
    onContext(fn: (ctx: AudioContext) => void): () => void;
    /** A detached, muted <audio> element. Chrome gives Web Audio no sound from a remote stream without one. */
    createElement(): { srcObject: MediaStream | null; muted: boolean; play(): Promise<void> };
  }
  export class Playback implements PlaybackSink {
    constructor(env: AudioEnv);
    attach(peerId: string, stream: MediaStream): void;
    detach(peerId: string): void;
    setGain(peerId: string, gain: number): void;   // user volume, 0..1.5, default 1
    setAllowed(peerId: string, allowed: boolean): void; // the rule; default false
    setDeafened(deafened: boolean): void;
    /** Effective gain = allowed && !deafened ? gain : 0. Blocked ("Mute for me") is gain 0, set by the controller. */
    /** Level 0..1 per peer, after its gain, for the speaking dots. */
    levels(): Map<string, number>;
    /** True when the context is missing, "suspended" or "interrupted": show "Tap to turn on sound". */
    get needsTap(): boolean;
    get canPickOutput(): boolean;            // "setSinkId" in the context
    setOutput(deviceId: string | null): Promise<boolean>;
    onChange(fn: () => void): () => void;     // needsTap changes
    destroy(): void;                          // disconnects nodes, drops elements; never closes the context
  }
  export interface MicPrefs { deviceId: string | null; echoCancellation: boolean; noiseSuppression: boolean; autoGainControl: boolean }
  export type MicResult = { ok: true; track: MediaStreamTrack } | { ok: false; reason: "denied" | "unavailable" };
  export class Mic {
    constructor(getUserMedia: ((c: MediaStreamConstraints) => Promise<MediaStream>) | null, isIOS: boolean);
    start(prefs: MicPrefs): Promise<MicResult>;
    /** New device or new processing: a new track. On iOS the old one stops first. The caller passes it to setPublishing. */
    restart(prefs: MicPrefs): Promise<MicResult>;
    get track(): MediaStreamTrack | null;
    /** The track ended or went muted (iOS in the background, device pulled). */
    onLost(fn: () => void): () => void;
    level(): number;                          // own mic, for my own dot
    stop(): void;                             // track.stop(); the browser's mic light goes off
  }
  export interface SpeakState { speaking: boolean; quietTicks: number }
  export const SPEAK_ON = 0.05, SPEAK_OFF = 0.03, SPEAK_HOLD_TICKS = 3, METER_HZ = 8;
  /** Hysteresis: on at >= SPEAK_ON; off only after SPEAK_HOLD_TICKS ticks in a row below SPEAK_OFF. */
  export function nextSpeaking(prev: SpeakState, level: number): SpeakState;
  ```
- Graph per peer: `MediaStreamSource(stream) -> GainNode -> AnalyserNode` and `GainNode -> voiceOut -> ctx.destination`, where `voiceOut` is one GainNode made per context. The level is the RMS of `getFloatTimeDomainData` from an `AnalyserNode` with `fftSize` 256 (simpler than an AudioWorklet). A stream attached before the context exists gets its element now and its graph in the `onContext` callback.

- [ ] **Step 1: Write the fake** `fake-audio.ts`: `FakeContext` with `state`, `createGain`, `createMediaStreamSource`, `createAnalyser` (level set by the test), `destination`, `setSinkId?`. Nodes record `connect` and `disconnect`. Also `FakeTrack` with `stop()`, `readyState`, and `dispatch("ended" | "mute")`.

- [ ] **Step 2: Write the failing tests**
```ts
it("each stream gets a muted element and a gain node into the shared context", ...);
it("streams attached before the context exists play once it does", ...);  // env.context() null; attach; fire onContext(ctx) -> graph built, element.muted true
it("effective gain is zero unless allowed and not deafened", ...);
it("detach disconnects the nodes and never closes the context", ...);
it("needsTap is true while suspended or interrupted", ...);
it("hides output choice without setSinkId", ...);
it("mic asks with the three processing settings and the device", ...); // constraints.audio == {deviceId:{exact:"d1"}, echoCancellation:true, noiseSuppression:true, autoGainControl:true}
it("mic denied gives reason denied; no getUserMedia gives unavailable", ...); // NotAllowedError -> denied
it("restart on iOS stops the old track before asking again", ...);
it("an ended or muted track fires onLost", ...);
it("stop stops the track", ...);
it("nextSpeaking turns on at once and off after three quiet ticks", () => {
  let s = { speaking: false, quietTicks: 0 };
  s = nextSpeaking(s, 0.06); expect(s.speaking).toBe(true);
  s = nextSpeaking(s, 0.04); expect(s.speaking).toBe(true);    // between thresholds: stays
  s = nextSpeaking(s, 0.01); s = nextSpeaking(s, 0.01); expect(s.speaking).toBe(true);
  s = nextSpeaking(s, 0.01); expect(s.speaking).toBe(false);
});
```

- [ ] **Step 3: Run to see them fail**

Run: `pnpm vitest run apps/web/test/voice/audio.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement** the `@games/audio` accessors (fire `onContext` after `unlock` makes the context, and on its `statechange`) and `audio.ts`.

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm vitest run apps/web/test/voice && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/audio apps/web/src/voice/audio.ts apps/web/test/voice
git commit -m "Voice: playback on the shared audio context, mic, speaking levels"
```

---

### Task 6: Voice controller, prefs and push-to-talk

**Files:**
- Modify: `apps/web/src/identity.ts` (export `readLocal(k)` / `writeLocal(k, v)`, the existing `read`/`write`)
- Modify: `packages/room-client/src/index.ts` (events)
- Create: `apps/web/src/voice/prefs.ts`, `apps/web/src/voice/ptt.ts`, `apps/web/src/voice/voice.ts`
- Test: `apps/web/test/voice/prefs.test.ts`, `ptt.test.ts`, `voice.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 4, 5.
- Produces in `@games/room-client`, `RoomClientEvents`:
  ```ts
  "voice-state": { members: VoiceMember[] };
  "voice-signal": { from: string; session: string; data: unknown };
  "voice-ice": { iceServers: IceServer[]; expiresAt: number };
  ```
  Dispatched in `handle()` like `chat`.
- Produces in `prefs.ts`:
  ```ts
  export interface VoicePrefs { micDeviceId: string | null; outputDeviceId: string | null; echoCancellation: boolean;
    noiseSuppression: boolean; autoGainControl: boolean; mode: "open" | "ptt"; deafenAlsoMutes: boolean; relayOnly: boolean }
  export const DEFAULT_VOICE_PREFS: VoicePrefs; // null, null, true, true, true, "open", false, false
  export interface RoomVoice { on: boolean; volumes: Record<string, number>; blocked: string[] }
  export interface KeyValue { read(k: string): string | null; write(k: string, v: string | null): void }
  export function voicePrefs(store?: KeyValue): { get(): VoicePrefs; set(patch: Partial<VoicePrefs>): VoicePrefs;
    room(code: string): RoomVoice; setRoom(code: string, patch: Partial<RoomVoice>): RoomVoice };
  ```
  Keys `voice` and `voice-room:<code>`, JSON. Bad JSON gives the defaults. Keep the 10 most recently written rooms (`voice-rooms` index) and drop older ones. The default store is `identity.ts`'s wrapper.
- Produces in `ptt.ts`:
  ```ts
  /** Space, not a repeat, not while typing, not on something Space presses (button, a[href], select, summary, checkbox, radio, [role=button], [tabindex]). */
  export function isPttKey(e: { key: string; repeat?: boolean; target: unknown }): boolean;
  export class PushToTalk {
    constructor(onHeld: (held: boolean) => void);
    enabled: boolean;                 // true only in "ptt" mode
    /** keydown and keyup in capture on that window; a PTT key gets preventDefault and stopImmediatePropagation, so the game never sees it. blur releases. */
    attach(target: EventTarget): () => void;
    /** Attaches to every same-origin iframe under root, now and as they come, and again on each iframe load. DOM glue, not unit tested. */
    watchFrames(root: Element): () => void;
    press(): void; release(): void;   // the mic button (pointerdown / pointerup, pointercancel, pointerleave)
    destroy(): void;
  }
  ```
  `typing` is the same test as in `apps/web/src/keyboard.ts`. Move it to an exported `isTyping(el)` there and use it from both places.
- Produces in `voice.ts`:
  ```ts
  export type VoiceStatus = "off" | "joining" | "on" | "full" | "unsupported";
  export type MicState = "on" | "muted" | "off" | "denied" | "lost";
  export interface VoiceMemberView { id: string; selfMuted: boolean; hostMuted: boolean; speaking: boolean; volume: number; blocked: boolean; link: LinkState | null }
  export interface VoiceView { status: VoiceStatus; mic: MicState; talking: boolean; deafened: boolean; pttHeld: boolean;
    mode: "open" | "ptt"; members: VoiceMemberView[]; needsSoundTap: boolean; needsMicTap: boolean; hasTurn: boolean; canPickOutput: boolean }
  export interface VoiceDeps {
    code: string; send(msg: ClientMessage): void; selfId(): string | null;
    rtcSupported: boolean;
    createTransport(deps: Omit<MeshDeps, "createPeer" | "clock">): VoiceTransport;
    mic: Mic; playback: Playback; prefs: ReturnType<typeof voicePrefs>;
    micPermission(): Promise<"granted" | "denied" | "prompt" | "unknown">;
    newSession(): string; clock: MeshDeps["clock"];
  }
  /** Talking = joined and not self-muted and not host-muted and rule.canTalk and transport up and (open mic or PTT held) and a live mic track. */
  export function shouldPublish(s: { joined: boolean; selfMuted: boolean; hostMuted: boolean; canTalk: boolean; up: boolean; mode: "open" | "ptt"; pttHeld: boolean; micLive: boolean }): boolean;
  export class VoiceController {
    constructor(deps: VoiceDeps);
    onWelcome(): void; onVoiceState(members: VoiceMember[]): void; onSignal(from: string, session: string, data: unknown): void;
    onIce(iceServers: IceServer[], expiresAt: number): void; onError(code: ErrorCode): void; onRoom(room: RoomPublicState): void;
    join(withMic: boolean): Promise<void>; leave(): void;
    setMuted(muted: boolean): void; turnOffMic(): void; turnOnMic(): Promise<void>;
    setDeafened(deafened: boolean): void; setVolume(id: string, v: number): void; setBlocked(id: string, blocked: boolean): void;
    setPtt(held: boolean): void; updatePrefs(patch: Partial<VoicePrefs>): Promise<void>;
    view(): VoiceView; subscribe(fn: () => void): () => void;
    /** Leave room, end party, fatal close, RoomView.destroy: tracks stopped, links closed, nothing sent. */
    stop(): void;
  }
  ```

Behaviour:
- `rtcSupported` false: status "unsupported", every call does nothing, nothing is sent.
- `join(withMic)`: a new session, status "joining". If `withMic`, `mic.start`: denied or unavailable gives mic "denied" and joins listen only. Send `voice-join { muted: !track }` and save `room(code).on = true`. Signals that arrive before the first `voice-ice` wait in a queue (at most 200, oldest dropped). The first `voice-ice` calls `transport.connect({ ..., relayOnly: prefs.relayOnly && hasTurn })`, then replays the queue. Later `voice-ice` calls `setIceServers`. `hasTurn` = some URL starts with `turn:` or `turns:`.
- `onVoiceState`: remember the roster. If I am in it: status "on", `transport.setPeers(others)`, `applyPolicy(this.rule())`, apply gains. `rule()` returns `globalRule(selfId, ids)`. This is the one seam phase 4 replaces when `room.voice.mode === "game"`. If I am not in it while joined, and a `welcome` came since the last roster (a reconnect after the seat was dropped): stop the transport and `join` again with a new session, keeping the mic. Otherwise (someone else's change) nothing.
- `onError("voice-full")`: status "full", stop the mic and the transport, save `on = false`.
- `leave()`: send `voice-leave`, stop, save `on = false`. `stop()`: the same with nothing sent, and keep `on` (a reload rejoins).
- Reload: on the first `onWelcome` with `room(code).on` true, auto-join. If `micPermission()` is "granted", join with the mic. Otherwise join listen only with `needsMicTap` true ("Tap to talk again."). The next `turnOnMic()` clears it.
- `onRoom`: phase "ended" calls `stop()`. Anything else (game switch, results, restart) does nothing to voice. A test pins this.
- Publishing: after every input change, recompute `shouldPublish` and call `transport.setPublishing(track or null)` only when it changed. `setMuted` sends `voice-self-mute` (refused while host-muted, which is phase 3's state, read from the roster). `turnOffMic()`: `mic.stop()`, mic "off", send `voice-self-mute { muted: true }`. `mic.onLost`: mic "lost", `needsMicTap`, publish null.
- Deafen: `playback.setDeafened`. With `deafenAlsoMutes`, deafening also mutes, and undeafening puts back the mute state from before.
- Gains: `playback.setGain(id, blocked ? 0 : volume)` from `prefs.room(code)`. Volume is 0..1.5, default 1. Blocking and volume are saved per room by seat id.
- Speaking: an 8 Hz meter tick (`clock.setTimeout` loop, only while status "on") runs `nextSpeaking` per peer from `playback.levels()`, and for me from `mic.level()` while talking. It notifies subscribers only when a dot changes.
- `updatePrefs`: save. A device or processing change while the mic is on calls `mic.restart` and then `setPublishing`. A mode change shows in `view().mode`. RoomView owns the `PushToTalk`, sets `ptt.enabled = view().mode === "ptt"` in its subscriber, and passes `onHeld` to `setPtt`. An output change calls `playback.setOutput`. A `relayOnly` change rebuilds the transport (`stop` the transport, `join` again).
- Every handler catches its own errors. Voice must never throw into `RoomView`.

- [ ] **Step 1: Write the failing tests**

`prefs.test.ts`: the defaults on an empty or bad store; `set` merges and saves; `room()` per code; only 10 rooms kept.

`ptt.test.ts` (call the attached listener with plain objects, or dispatch `Event`s with `key` set on a Node `EventTarget`):
```ts
it("Space with nothing focused is push-to-talk", ...);
it("ignores Space while typing in an input or textarea", ...);
it("ignores Space on a button or a [tabindex] cell", ...);
it("ignores key repeat", ...);
it("does nothing while not enabled", ...);
it("holds on keydown, releases on keyup", ...);
it("stops the key reaching the game", ...);   // preventDefault and stopImmediatePropagation called
it("releases on blur and when the tab is hidden", ...);
it("the mic button holds on press and releases on release", ...);
```

`voice.test.ts` (fake transport recording calls; the Task 5 fakes for mic and playback):
```ts
it("shouldPublish needs every condition", ...);   // a table: each false input alone makes it false
it("no RTCPeerConnection: status unsupported, sends nothing", ...);
it("join with mic sends voice-join muted false", ...);
it("mic denied joins listen only with mic denied", ...);
it("queues signals until the first voice-ice, then connects and replays them", ...);
it("voice-full stops the mic and shows full", ...);
it("leave sends voice-leave, stops the mic, closes links", ...);
it("stop closes everything and sends nothing", ...);
it("turn off mic stops the track and sends self-mute", ...);
it("push-to-talk publishes only while held", ...);
it("deafen with deafenAlsoMutes mutes, and undeafen puts back the old state", ...);
it("Mute for me and volume are saved for this room", ...);
it("a game switch or restart touches nothing", ...);   // onRoom with a new gameId, phase, roundNumber: no transport calls, no sends
it("the ended phase stops voice", ...);
it("rejoin after welcome without me in the roster starts a new session", ...);
it("a welcome with me still in the roster keeps the links", ...);
it("reload rejoins: with the mic if allowed, otherwise listen only and Tap to talk again", ...);
it("a lost mic track asks for a tap and stops sending", ...);
it("relay only is used only when the servers include TURN", ...);
it("speaking dots follow levels at 8 Hz", ...);
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm vitest run apps/web/test/voice`
Expected: FAIL.

- [ ] **Step 3: Implement** the room-client events, `prefs.ts`, `ptt.ts`, `voice.ts` and the `isTyping` export.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm vitest run apps/web packages/room-client && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/voice apps/web/src/identity.ts apps/web/src/keyboard.ts apps/web/test/voice packages/room-client
git commit -m "Voice: controller, saved settings and push-to-talk"
```

---

### Task 7: Voice bar, panel and room wiring

**Files:**
- Create: `apps/web/src/views/voice-bar.ts`
- Modify: `apps/web/src/views/room.ts`, `apps/web/src/brand.ts`, `apps/web/src/style.css`
- Modify: `docs/games/rooms.md` (new "Voice" section after "Sound and vibration")
- Test: `apps/web/test/voice-bar.test.ts`

**Interfaces:**
- Consumes: `VoiceController`, `VoiceView`, `PushToTalk` (Task 6).
- Produces:
  ```ts
  export interface BarModel {
    show: "hidden" | "join" | "bar";
    micButton: { label: string; pressed: boolean; hold: boolean };  // hold: PTT mode, hold to talk
    note: string | null;          // one line under the controls
    tapSound: boolean; tapMic: boolean;
    speakingIds: string[];
  }
  export function voiceBarModel(v: VoiceView, phase: RoomPhase): BarModel;
  export class VoiceBar { constructor(voice: VoiceController, ptt: PushToTalk, nameOf: (id: string) => string); readonly el: HTMLElement; render(phase: RoomPhase): void; openPanel(): void; destroy(): void }
  ```
- New icons in `brand.ts` (24x24 line paths, same `STROKE` style): `mic`, `mic-off`, `headphones`, `headphones-off`, `settings`.

Copy (exact):
- Join button: "Join voice". Explainer dialog title "Join voice", lines "Talk with the room while you play." / "Your phone will ask to use the mic." / "No one records your voice.", buttons "Turn on mic" and "Listen only". Skip it when `micPermission()` is "granted".
- Notes, in priority order: unsupported "Voice does not work in this browser."; full "Voice is full."; denied or off "Your mic is off"; muted with a live track "Muted: your mic is still on. Tap Turn off mic to stop it."; joining "Connecting voice..." (three dots, ASCII); ptt and not held: phone "Hold to talk", desktop "Hold Space to talk".
- Buttons: "Tap to turn on sound" (calls `audio.unlock()`), "Tap to talk again." (calls `turnOnMic()`), "Turn off mic", "Leave voice". Deafen toggle aria-label "Hear no one" / "Hear everyone".
- Per person in the panel: a volume slider (aria-label "Volume for <name>") and a "Mute for me" / "Unmute for me" toggle. A link that is "reconnecting" shows "Trying to connect...".
- Settings dialog "Voice settings": "Mic" (select of `audioinput` devices), "Speaker" (select of `audiooutput`, only when `canPickOutput`), "Remove echo", "Remove background noise", "Keep my volume even", "Push to talk", "Hear no one also mutes my mic", "Hide my network address" (disabled with "Needs a relay server." when `!hasTurn`). "The settings stay on your device."

Layout (spec 5.4): a compact bar in `playing` (mic, deafen, speaking dots, a connection dot); the full panel with the player list in `lobby` and `results`. Keydown in the bar and panel calls `stopPropagation`, so no key reaches the game. Every control is a real `<button>`, `<input>` or `<select>`, usable by keyboard and by touch (44 px targets).

RoomView wiring (`room.ts`):
- `connect()` builds the controller once per RoomView, with real deps: `rtcSupported = typeof RTCPeerConnection !== "undefined" && !!navigator.mediaDevices?.getUserMedia`, a `MeshTransport` over `new RTCPeerConnection(config)`, `Playback` over `audio.context` / `audio.onContext` / `document.createElement("audio")`, `Mic` with `navigator.mediaDevices.getUserMedia`, `micPermission` from `navigator.permissions?.query({ name: "microphone" })` (catch gives "unknown"), and `newSession = crypto.randomUUID().slice(0, 12)`.
- Client events go to the controller: `welcome` to `onWelcome`, `voice-state`, `voice-signal`, `voice-ice`, `error` (`onError(code)` before the toast; for `voice-full` the toast says "Voice is full."), `update` to `onRoom(u.room)`, `fatal` to `stop()`.
- `leave()` calls `voice.stop()` before closing the client. `destroy()` calls `voice.stop()`, `ptt.destroy()` and `bar.destroy()`. `dropGameView()` calls `ptt.release()`. `ptt.attach(window)` plus `ptt.watchFrames(this.gameHost)`, so Godot iframes (Treasure Hunt, Blind Rally) catch Space too, with no change to their bridges.
- The bar sits in `this.root` above the body, outside `gameHost`, so game swaps never re-render or move it.

- [ ] **Step 1: Write the failing model tests** (`voice-bar.test.ts`)
```ts
it("hidden when the party has ended", ...);
it("shows Join voice when off", ...);
it("unsupported shows the browser note and no join", ...);
it("muted with a live mic shows the still-on note", () => {
  expect(voiceBarModel(view({ status: "on", mic: "muted" }), "lobby").note).toBe("Muted: your mic is still on. Tap Turn off mic to stop it.");
});
it("mic off or denied shows Your mic is off", ...);
it("full shows Voice is full.", ...);
it("push-to-talk makes the mic a hold button", ...);
it("asks for a tap for sound and for the mic", ...);
it("lists who is speaking", ...);
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm vitest run apps/web/test/voice-bar.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** `voiceBarModel`, `VoiceBar`, the icons, the CSS (follow the room's existing classes and tokens), and the `room.ts` wiring.

- [ ] **Step 4: Write the docs** in `docs/games/rooms.md` under "## Voice". Say how to join, listen only, mute against turning off the mic, hearing no one, volume and "Mute for me" (only for you), push-to-talk (Space, or hold the mic button), that voice stays on between games, the 8-person cap, that the settings stay on the device, and that no one records voice. Use the same plain copy.

- [ ] **Step 5: Run everything**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: PASS, and the build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/web docs/games/rooms.md
git commit -m "Shell: voice bar, panel and settings"
```

---

## Manual phone checklist (for the user; implementers do not run this)

Deploy a preview with `TURN_KEY_ID` and `TURN_KEY_TOKEN` set (`wrangler secret put`).

1. Six browsers (at least one iOS Safari and one Android Chrome) join voice. Everyone hears everyone. Switch three games, including into and out of Nightfall, Treasure Hunt and Blind Rally: no drop, no gap.
2. Deny the mic on one phone: the game works and listen-only works. The bar says "Your mic is off".
3. "Hide my network address" on two phones: audio still flows (TURN only). Without the secrets: voice works on the same Wi-Fi, and nothing extra is shown.
4. Autoplay: reload while in voice. Voice comes back, "Tap to turn on sound" shows, and one tap brings sound. Where the mic was allowed, talking comes back with no tap. Otherwise "Tap to talk again." shows.
5. Lock the phone or switch apps for 30 s, then come back: sound and mic come back, or ask for a tap. Pull out a headset: the mic is lost, then comes back with a tap.
6. Speakerphone on two phones in one room: echo level with the default processing. Note the result for the spike follow-up.
7. Mute: the mic light stays on. Turn off mic: the browser's mic light goes off. Leave voice, leave room, end party: the mic light goes off every time.
8. Push-to-talk: hold Space on desktop, including with focus inside the Treasure Hunt and Blind Rally Godot frames. The game does not react to Space. Typing a space in chat does not talk. Hold the mic button on a phone. Switch tabs while holding: it stops.
9. Per-player volume and "Mute for me" on one person: only you stop hearing them, and it is still set after a reload.
10. Output device: pick a speaker on desktop Chrome. The setting is hidden on iOS.
11. Open the room in a second tab: the old tab's mic light goes off, and the new tab's voice reaches everyone.
12. Nine people: the ninth gets "Voice is full." Try ten phones in a Nightfall game at the cap. Note heat and audio.
13. Switch games again and again for 20 minutes: no growth in `<audio>` elements, tracks or memory (`chrome://webrtc-internals`, the Performance monitor).
14. Game frame times and long tasks with voice off, and with 8 in voice (Performance panel).
