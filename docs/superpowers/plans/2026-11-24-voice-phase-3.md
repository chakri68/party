# Voice Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The host can mute one person or everyone in voice (and let them talk again), game sound and sound board clips get quieter while someone talks, the sound board gets its own volume, voice works better on phones (the screen stays on in voice), and the dev debug panel shows voice link stats.

**Architecture:** Host mute is one new client message, `host-mute`, handled on the server exactly like `voice-self-mute`: it changes the stored roster, does one `persist()` and one `flushVoice()`, and never commits. Each phone obeys its own roster entry (trust-based, spec 4). Ducking is one ramp on the `master` gain that `@games/audio` already owns, so every DOM game and every sound board clip is covered with no game change; the two places that do not play through `master` (Dominion's own AudioContext and Treasure Hunt's Godot frame) read a new `audio.gameVolume()`. Stats come from the existing `VoiceTransport.getStats()`.

**Tech Stack:** TypeScript, vitest (node environment, no DOM), partyserver Durable Object, WebRTC, Web Audio.

**Spec:** `docs/superpowers/specs/2026-11-21-party-voice-design.md`, phase 3 (section 6 item 3). Details in 5.3 (Host mute), 5.4 (Ducking, host actions), 5.7 (stats), 7 (tests), 8 (copy). Phases 1 and 2 and the sound board (soundboard plan, step 1) are on master: read the code, not the spec, for what exists. The sound board is not re-planned here.

## Global Constraints

- Bump `PROTOCOL_VERSION` in `packages/protocol/src/index.ts` from 12 to 13 (Task 1, once). No other task changes a wire shape.
- Player-facing copy: short plain sentences, basic words, no idioms or slang (Indian ESL readers). No emoji anywhere (UI, docs, commit messages). Icons are SVG paths in `apps/web/src/brand.ts`. Spec copy used verbatim: "The host muted you".
- New copy fixed by this plan (exact): "Mute", "Allow to talk", "Mute all", "Allow all to talk", "muted by host", "The host muted you.", "You can talk again. Tap the mic to talk.", "They are not in voice.", "You can't mute yourself here.", "Lower game sound when people talk", "Keep the screen on in voice", "Sound board volume".
- Host can never turn on anyone's mic: lifting a host mute clears only `hostMuted`; the person stays self-muted (spec 5.3).
- No voice message bumps `stateVersion`, sends an `update`, or calls `commit`. `host-mute` does one `persist()` and one `flushVoice()`.
- Voice never breaks a game: every new client path catches its own errors. No roster, SDP, ICE or stats detail goes to `logError`/`console`, and stats never leave the device (no endpoint).
- Phones first: lay out for 360x780. Every tap target is at least 40 px (44 px where phase 2 already used 44).
- Implementers never open a browser. Logic lives in pure functions or classes with injected browser objects, tested with the existing fakes: `apps/web/test/voice/fake-rtc.ts`, `fake-audio.ts`, `fake-store.ts`, and the fake context in `packages/audio/test/clip.test.ts`. DOM glue stays thin and is covered by the real-phone section at the end.
- Shared code on `master` only. Nothing in `apps/product-*`.
- Not in this phase: `voicePolicy` / `voice-policy`, sound board routing by `sendTo`, proximity, Blind Rally and Rally ducking (needs a Godot export; user: skip for now), voice stats outside dev builds.

## Decided by the user 2026-11-24

1. Blind Rally and Rally (Godot) ducking: skip for now.
2. Keep the screen on while in voice: yes. Build the wake lock, with a saved setting to turn it off. Release it on leaving voice or when the page hides; take it again on return (Task 6).
3. Voice stats stay dev only, as the spec says (Task 7).
4. My own talking does not lower my game sound (Task 4).
5. Sound board volume: yes, a separate saved "Sound board volume" setting. It changes board clips only and sits with the other sound settings (Task 8).
6. The user tests on real phones after ship; there is no preview step. The real-phone list at the end is a post-ship checklist.
- Tests: `pnpm vitest run <path>` for one file, `pnpm test` for all, `pnpm typecheck` for types. Both pass before every commit.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01KwNUn8AHWzbftW559ZRTih
  ```

## Review Focus

1. A host-muted person reloads, reconnects, or is in push-to-talk and holding the button when the mute lands: sending stops at once and stays stopped; after the host lifts it they still send nothing until they tap Unmute. Today the phone keeps its own `selfMuted` and ignores the roster's, so a lift would start sending again. Tests in Task 2: "host mute stops sending at once, even mid push-to-talk", "host mute lifted: stays muted until Unmute", "host-muted on reload: stays muted after the lift".
2. The host role moves to a host-muted person (Make host, or the old host's grace runs out): the new host must not be stuck host-muted, with nobody able to lift it. Test in Task 1: "the host is never host-muted after Make host or a new host".
3. Ducking gets stuck low: the speaker leaves voice, I leave voice, I deafen, I "Mute for me" the speaker, the party ends, or the game switches while ducked. Game sound must come back to full. Tests in Task 4 (`duckLevel` cases) and "volume change while ducked keeps the duck, duck(1) restores it".
4. The host is not in voice, or nobody else is: "Mute all" must not show when there is no one to mute, and a host who never joined voice can still mute from the menu and seat menu. Tests in Task 3: `muteAllAction` cases.
5. A new game view mounts while ducked (Treasure Hunt's Godot frame, Dominion's own context): it must start at the ducked volume, not full, and follow the next change at once, not a second later. Tests in Task 5: "ready sends the ducked volume", "a duck change is sent at once".

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/protocol/src/index.ts` | `host-mute` message, version 13. |
| `apps/server/src/voice.ts` | `pruneVoice` also clears the host's own host mute. |
| `apps/server/src/runtime.ts` | `host-mute` case. |
| `apps/web/src/voice/voice.ts` | Obey the roster's host mute; toasts; PTT buzz; `stats()`. |
| `apps/web/src/voice/prefs.ts` | `duck` and `keepScreenOn` settings. |
| `apps/web/src/voice/duck.ts` (new) | `duckLevel`: how loud game sound should be now. |
| `apps/web/src/voice/wake.ts` (new) | Screen wake lock while in voice. |
| `apps/web/src/voice/stats.ts` (new) | `voiceStatsLines` for the debug panel. |
| `apps/web/src/views/voice-bar.ts` | Host-muted note, per-person host button, duck checkbox, row layout. |
| `apps/web/src/views/host-menu.ts` | `mute` / `allow-talk` seat actions, `muteAllAction`. |
| `apps/web/src/views/room-menu.ts` | `mute-all` / `allow-all` items. |
| `apps/web/src/views/room.ts` | Wiring: deps, menu items, duck, wake lock, debug; "Sound board volume" in the Sound and vibration dialog. |
| `apps/web/src/debug.ts` | A "Voice" section. |
| `apps/web/src/style.css` | 40 px hit areas at phone width, panel rows. |
| `packages/audio/src/index.ts` | `duck`, `gameVolume`, `onGameVolume`, `DUCK_*`; `boardVolume` setting for clips. |
| `games/treasure-hunt/client/view.ts` | `SoundFeed` sends the ducked volume. |
| `games/dominion/client/sound.ts` | Its own output gain follows `gameVolume`. |
| `docs/games/rooms.md` | Host mute, Mute all, ducking and screen settings, sound board volume. |

---

### Task 1: Host mute on the wire and the server

**Files:**
- Modify: `packages/protocol/src/index.ts`
- Modify: `apps/server/src/voice.ts`, `apps/server/src/runtime.ts` (voice cases near `voice-self-mute`, about line 841; `commit` and `flushVoice` call `pruneVoice`)
- Test: `packages/protocol/test/voice.test.ts`, `apps/server/test/voice.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // ClientMessage gains:
  | { type: "host-mute"; playerId: string; muted: boolean }  // playerId: a seat id, or "all"
  export const PROTOCOL_VERSION = 13;
  // apps/server/src/voice.ts
  export function pruneVoice(members: VoiceMember[], seats: {...}[], phase: RoomPhase, hostId: string | null): VoiceMember[];
  ```
  No new server message: the result goes out in `voice-state`, whose `VoiceMember.hostMuted` already exists.

Server rules for `host-mute`:
- `hostOnly()`, phases `lobby`, `playing`, `results`. The host need not be in voice.
- `"all"` with `muted: true`: every member except the sender gets `hostMuted = true` and `selfMuted = true`. `"all"` with `muted: false`: every member gets `hostMuted = false` (selfMuted untouched). People who join later are not muted (spec 5.3).
- A seat id: not in the roster gives error `not-available`, "They are not in voice."; the sender's own id gives `not-available`, "You can't mute yourself here." (the host uses their own mic button). Otherwise as above for that one member.
- Nothing changed: return with no persist and no send. Changed: one `persist()`, then `flushVoice()`.
- `pruneVoice(..., hostId)`: the member whose id is `hostId` comes back with `hostMuted: false` (a copy, not a mutation). Pass `data.hostId` at both call sites. This covers Make host and `ensureHost` with no extra code.

- [ ] **Step 1: Write the failing tests**

`packages/protocol/test/voice.test.ts`:
```ts
it("is version 13", () => expect(PROTOCOL_VERSION).toBe(13));
it("parses host-mute for one seat and for all", () => {
  expect(parse({ type: "host-mute", playerId: "p2", muted: true })).toEqual({ type: "host-mute", playerId: "p2", muted: true });
  expect(parse({ type: "host-mute", playerId: "all", muted: false })).toEqual({ type: "host-mute", playerId: "all", muted: false });
  expect(parse({ type: "host-mute", playerId: "", muted: true })).toBeNull();
  expect(parse({ type: "host-mute", playerId: "p2" })).toBeNull();
  expect(parse({ type: "host-mute", playerId: "x".repeat(65), muted: true })).toBeNull();
});
```

`apps/server/test/voice.test.ts` (use the file's existing room and `members()` helpers):
```ts
it("host-mute mutes one member: hostMuted and selfMuted, voice-state only, same version", ...);
  // expect members(b) entry for c to be { id: c, selfMuted: true, hostMuted: true }; no "update" sent; stateVersion unchanged
it("lifting a host mute leaves the person self-muted", ...);
  // after { muted: false }: { selfMuted: true, hostMuted: false }; then c's voice-self-mute false is accepted
it("mute all mutes everyone in voice but the host; a later joiner is not muted", ...);
it("allow all clears hostMuted for everyone and leaves them self-muted", ...);
it("host-mute from a non-host changes nothing", ...);
it("host-mute of someone not in voice says They are not in voice.", ...);
it("the host is never host-muted after Make host or a new host", ...);
  // host mutes c, then transfer-host to c: c's entry has hostMuted false, selfMuted true
it("host-mute with nothing to change sends no voice-state", ...);
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm vitest run packages/protocol/test/voice.test.ts apps/server/test/voice.test.ts`
Expected: FAIL (version is 12, `host-mute` unknown).

- [ ] **Step 3: Implement** the message, its parse (`isStr(playerId, 64)`, non-empty, boolean `muted`), the version, the `host-mute` case and `pruneVoice`'s `hostId`. Update the existing `pruneVoice` unit tests for the new parameter.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm vitest run packages/protocol apps/server && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol apps/server
git commit -m "Voice: host mute and mute all on the server"
```

---

### Task 2: The phone obeys a host mute

**Files:**
- Modify: `apps/web/src/voice/voice.ts`, `apps/web/src/views/room.ts` (`startVoice`, the `VoiceController` deps)
- Test: `apps/web/test/voice/voice.test.ts` (its `setup()` gets a `toasts: string[]` fake)

**Interfaces:**
- Consumes: `VoiceMember.hostMuted` from `voice-state` (Task 1).
- Produces: `VoiceDeps.toast(text: string): void`. Room wires it to its existing toast.

Rules (in `onVoiceState`, comparing my entry before and after):
- While my entry has `hostMuted: true`, the controller's own `selfMuted` is true. It sends nothing for this (the server already set it), saves the mic choice as "muted" (or keeps "off" if the mic is off), and calls `syncPublishing()`. So the lift leaves it muted, and a reload while host-muted stays muted after the lift.
- false to true: `toast("The host muted you.")`. true to false: `toast("You can talk again. Tap the mic to talk.")`. No toast for other members' changes, and none for the first roster after a welcome when nothing changed for me.
- `setMuted(false)` and `setPtt(true)` while host-muted: `toast("The host muted you.")`, nothing sent, nothing published. (Today they return without a word.)

- [ ] **Step 1: Write the failing tests**

```ts
it("host mute stops sending at once, even mid push-to-talk", ...);
  // ptt mode, setPtt(true), publishing the track; roster with me hostMuted -> setPublishing(null) called, view().mic === "muted"
it("host mute lifted: stays muted until Unmute", ...);
  // roster me { selfMuted: true, hostMuted: true } then { selfMuted: true, hostMuted: false }: still publishing null; setMuted(false) then publishes and sends voice-self-mute false
it("host-muted on reload: stays muted after the lift", ...);
it("unmute while host-muted toasts The host muted you. and sends nothing", ...);
it("toasts once on host mute and once on the lift, not for other members", ...);
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm vitest run apps/web/test/voice/voice.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** the roster rule, the toasts and the `toast` dep.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm vitest run apps/web && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/voice/voice.ts apps/web/src/views/room.ts apps/web/test/voice
git commit -m "Voice: the phone keeps a host mute and says so"
```

---

### Task 3: Host mute buttons

**Files:**
- Modify: `apps/web/src/views/host-menu.ts`, `apps/web/src/views/room-menu.ts`, `apps/web/src/views/voice-bar.ts`, `apps/web/src/views/room.ts` (`seatControl`, the room menu builder), `apps/web/src/style.css`
- Modify: `docs/games/rooms.md` ("What only the host can do" and "Voice")
- Test: `apps/web/test/host-menu.test.ts`, `apps/web/test/room-menu.test.ts`, `apps/web/test/voice-bar.test.ts`

**Interfaces:**
- Consumes: `host-mute` (Task 1); `VoiceView.members` (the roster is kept even when this phone is not in voice).
- Produces:
  ```ts
  // host-menu.ts
  export type SeatActionKind = "mute" | "allow-talk" | "make-host" | "remove";
  export function seatActions(room: RoomPublicState, me: string, seat: SeatPublic, voice?: { hostMuted: boolean } | null): SeatAction[];
  export function seatActionMessage(kind: SeatActionKind, seat: SeatPublic): ClientMessage;  // mute / allow-talk -> host-mute
  export function muteAllAction(room: RoomPublicState, me: string, members: { id: string; hostMuted: boolean }[]): "mute-all" | "allow-all" | null;
  // room-menu.ts: RoomMenuItem gains "mute-all" | "allow-all"; labels "Mute all", "Allow all to talk".
  // roomMenuItems(room, me, o: { ...; muteAll?: "mute-all" | "allow-all" | null })
  // voice-bar.ts
  export function hostVoiceAction(m: VoiceMemberView, isHost: boolean): { label: "Mute" | "Allow to talk"; message: ClientMessage } | null;
  // VoiceBar constructor gains a 4th argument: host: { isHost(): boolean; send(msg: ClientMessage): void }
  ```

Rules:
- `seatActions`: host only, never on self, only when `voice` is given (the seat is in voice). "Mute" when not host-muted, "Allow to talk" when host-muted. They come first, no confirm, not danger. Computers are never in voice.
- `muteAllAction`: null unless I am host and at least one other member is in voice. "mute-all" while any other member is not host-muted, else "allow-all". In `roomMenuItems` the item goes right after the voice item, on lobby, playing and results, host only. No confirm (one tap undoes it).
- `hostVoiceAction`: null for self or when not host. In the Voice panel row, the button sits next to "Mute for me".
- Panel row state: "muted by host" when `hostMuted`, else "muted" as today.
- `voiceBarModel`: when my own member is host-muted, the note is "The host muted you." (before "Muted: your mic is still on."), so the mic button's name says it.

- [ ] **Step 1: Write the failing tests**

```ts
// host-menu.test.ts
it("a seat in voice gets Mute first, with no question", ...);
it("a host-muted seat gets Allow to talk", ...);
it("no voice actions without a voice entry, for myself, or for a non-host", ...);
it("mute and allow-talk send host-mute", () => {
  expect(seatActionMessage("mute", seat)).toEqual({ type: "host-mute", playerId: seat.id, muted: true });
  expect(seatActionMessage("allow-talk", seat)).toEqual({ type: "host-mute", playerId: seat.id, muted: false });
});
it("muteAllAction: null with nobody else in voice or when not host", ...);
it("muteAllAction: mute-all while anyone is not host-muted, then allow-all", ...);
// room-menu.test.ts
it("lists Mute all after the voice item for the host in lobby, game and results", ...);
it("no Mute all when muteAll is null or the party has ended", ...);
// voice-bar.test.ts
it("host-muted shows The host muted you.", ...);
it("hostVoiceAction: Mute, Allow to talk, null for self and for others", ...);
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm vitest run apps/web/test/host-menu.test.ts apps/web/test/room-menu.test.ts apps/web/test/voice-bar.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** the functions, the panel row button (`Row.host: HTMLButtonElement | null`, hidden when the action is null, updated in `syncRow`), and the `room.ts` wiring: pass the seat's voice entry to `seatActions` (both the menu and its `still()` check), pass `muteAllAction(...)` to `roomMenuItems`, send `{ type: "host-mute", playerId: "all", muted }` for the two items.

- [ ] **Step 4: Write the docs** in `docs/games/rooms.md`. In "What only the host can do": the host can **Mute** a person in voice from the dots next to them or from the Voice panel, or use **Mute all** in the menu. **Allow to talk** and **Allow all to talk** undo it. The person stays muted until they tap the mic. The host can never turn on anyone's mic. People who join voice later are not muted. In "Voice": a person the host muted sees "The host muted you." and cannot unmute until the host allows it.

- [ ] **Step 5: Run everything**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web docs/games/rooms.md
git commit -m "Room: host Mute, Mute all and Allow to talk"
```

---

### Task 4: Ducking

**Files:**
- Modify: `packages/audio/src/index.ts` (`Feedback`)
- Create: `apps/web/src/voice/duck.ts`
- Modify: `apps/web/src/voice/prefs.ts`, `apps/web/src/views/voice-bar.ts` (settings dialog), `apps/web/src/views/room.ts`
- Modify: `docs/games/rooms.md` ("Voice" settings paragraph)
- Test: `packages/audio/test/duck.test.ts` (new; copy the fake context from `clip.test.ts` and give its gain `setTargetAtTime` and `cancelScheduledValues` spies), `apps/web/test/voice/duck.test.ts` (new), `apps/web/test/voice/prefs.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // @games/audio
  export const DUCK_GAIN = 0.35;        // about -9 dB
  export const DUCK_ATTACK_S = 0.05;    // setTargetAtTime time constant going down
  export const DUCK_RELEASE_S = 0.25;   // going back up
  class Feedback {
    /** 0..1, 1 = no duck. Ramps master to volume x 0.9 x level. Safe before unlock: applied when the context is made. */
    duck(level: number): void;
    /** settings.volume x the duck level. For game audio that does not go through master. */
    gameVolume(): number;
    /** Called on every duck change and every update(). Returns an unsubscribe. */
    onGameVolume(fn: () => void): () => void;
  }
  // apps/web/src/voice/duck.ts
  export function duckLevel(v: VoiceView, on: boolean): number;
  // VoicePrefs gains duck: boolean, default true
  ```

Rules:
- `duckLevel` is `DUCK_GAIN` when `on`, `v.status === "on"`, `!v.deafened`, and some member is `!self && speaking && !blocked`; else 1. My own voice does not duck (user, 2026-11-24). Speaking already has hysteresis (`SPEAK_HOLD_TICKS`), so no extra hold here. In element playback mode there are no levels, so no ducking: accepted.
- `applyVolume()` (on `update`) cancels scheduled values and sets `volume x 0.9 x duck` at once, so a volume change while ducked keeps the duck. A gain without `setTargetAtTime` (old fakes) gets `.value`.
- Sound board clips and all DOM game sound go through `master`, so they duck with no change.
- `room.ts`: in the voice subscription it already has, call `audio.duck(duckLevel(voice.view(), voice.settings().duck))`; in `destroy()` call `audio.duck(1)`. Calling with the same level is a no-op, so 8 Hz notifies are cheap.
- Settings dialog: a checkbox "Lower game sound when people talk", bound to `duck`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/audio/test/duck.test.ts
it("duck ramps master to volume x 0.9 x level with the attack constant", ...);
  // volume 0.7: setTargetAtTime(0.7 * 0.9 * 0.35, currentTime, DUCK_ATTACK_S)
it("duck back to 1 uses the release constant", ...);
it("volume change while ducked keeps the duck, duck(1) restores it", ...);
it("duck before unlock applies once the context is made", ...);
it("gameVolume and onGameVolume follow duck and update", ...);
it("the same level twice does nothing", ...);
// apps/web/test/voice/duck.test.ts
it("ducks while someone else speaks", () => expect(duckLevel(view({ members: [me, other({ speaking: true })] }), true)).toBe(DUCK_GAIN));
it("my own voice does not duck", ...);
it("a person I muted for me does not duck", ...);
it("deafened, out of voice, or off in settings: no duck", ...);
// prefs.test.ts
it("saved prefs without duck read as on", ...);
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm vitest run packages/audio apps/web/test/voice/duck.test.ts apps/web/test/voice/prefs.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** the `Feedback` methods, `duck.ts`, the pref, the checkbox and the wiring.

- [ ] **Step 4: Docs.** Add "lower game sound when people talk (on at first)" to the Voice settings list, and one line: while someone talks, game sound and sound board sounds get quieter, then come back.

- [ ] **Step 5: Run everything**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/audio apps/web docs/games/rooms.md
git commit -m "Voice: game sound gets quieter while people talk"
```

---

### Task 5: Ducking for game audio outside master

**Files:**
- Modify: `games/treasure-hunt/client/view.ts` (`SoundFeed`, and where `TreasureHuntView` builds it)
- Modify: `games/dominion/client/sound.ts` (`wake()`, the `out` gain)
- Test: `games/treasure-hunt/test/sound-feed.test.ts`, `games/dominion/test/sound.test.ts` (new; stub `AudioContext` with `vi.stubGlobal`)

**Interfaces:**
- Consumes: `audio.gameVolume()`, `audio.onGameVolume()`, `DUCK_ATTACK_S`, `DUCK_RELEASE_S` (Task 4).
- Produces:
  ```ts
  // SoundFeed gains an optional change source and a destroy
  constructor(send: (calls: BridgeCall[]) => void, read: () => { sound: boolean; volume: number }, onChange?: (fn: () => void) => () => void);
  destroy(): void;
  ```

Rules:
- Treasure Hunt: the view passes `read = () => ({ sound: audio.settings.sound, volume: audio.gameVolume() })` and `onChange = (fn) => audio.onGameVolume(fn)`. `SoundFeed` calls `poll()` on each change; the 1 s interval stays as a fallback. The Godot side already sets the bus volume from `sound({muted, volume})` (`hunt_audio.gd` `set_sound`), so no new export. The change is a step, not a ramp (real-phone check 6). The view calls `soundFeed.destroy()` where it clears `soundTicker`.
- Dominion: `out.gain` starts at `audio.gameVolume() * 0.8` and, on `onGameVolume`, moves there with `setTargetAtTime` (attack constant going down, release going up). Unsubscribe when the sound object is dropped.
- Blind Rally and Rally: skipped for now (user, 2026-11-24).

- [ ] **Step 1: Write the failing tests**

```ts
// sound-feed.test.ts
it("ready sends the ducked volume", ...);       // read returns volume 0.245: first call is sound({ muted: false, volume: 0.245 })
it("a duck change is sent at once", ...);       // fire onChange after ready: a second sound call, no timer needed
it("destroy stops listening", ...);
// dominion sound.test.ts
it("the output gain follows gameVolume, ducked and back", ...);
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm vitest run games/treasure-hunt/test/sound-feed.test.ts games/dominion/test/sound.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** both.

- [ ] **Step 4: Run everything**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add games/treasure-hunt games/dominion
git commit -m "Games: Treasure Hunt and Dominion sound get quieter while people talk"
```

---

### Task 6: Phone polish

**Files:**
- Modify: `apps/web/src/style.css` (the `@media (max-width: 400px)` header rule near line 209; the `.voice-person` rules near line 773)
- Modify: `apps/web/src/voice/voice.ts`, `apps/web/src/voice/prefs.ts`, `apps/web/src/views/voice-bar.ts` (settings dialog), `apps/web/src/views/room.ts`
- Create: `apps/web/src/voice/wake.ts`
- Test: `apps/web/test/voice/voice.test.ts`, `apps/web/test/voice/wake.test.ts` (new), `apps/web/test/voice/prefs.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // voice.ts
  export const PTT_BUZZ_MS = 12;
  // VoiceDeps gains buzz(ms: number): void   (room: (ms) => audio.buzz(ms), which follows the haptics setting)
  // wake.ts
  export interface WakeSentinel { release(): Promise<void>; addEventListener(type: "release", fn: () => void): void }
  export interface WakeDeps {
    request: (() => Promise<WakeSentinel>) | null;   // navigator.wakeLock?.request("screen"), null when missing
    visible(): boolean;
    onVisibility(fn: () => void): () => void;
  }
  export class VoiceWakeLock { constructor(deps: WakeDeps); set(want: boolean): void; destroy(): void }
  // prefs.ts: VoicePrefs gains keepScreenOn: boolean, default true
  ```

Rules:
- Header at 360 px: the 36 px visual size of header buttons stays (seven buttons must fit in 328 px), but each gets a 40 px hit area: `position: relative` and an `::after` with `inset: -2px`. The gap between header buttons must stay at least 4 px so hit areas never overlap.
- Voice panel row at 360 px: line one is the dot, name (ellipsis) and state; line two is the volume slider (`flex: 1 1 140px`), the host button and "Mute for me". Every button 44 px tall.
- Push-to-talk: `setPtt(true)` from not held calls `buzz(PTT_BUZZ_MS)` once; release does not buzz; no buzz while host-muted (the toast says it instead).
- Wake lock (user, 2026-11-24): `room.ts` calls `wake.set(view.status === "on" && voice.settings().keepScreenOn)` in the voice subscription and `wake.destroy()` in `destroy()`. Held only while wanted and visible; released on leaving voice, on the setting turned off, and when the page hides; taken again when the page comes back (the browser drops it on hide anyway). A refused request is not retried until the next visible or `set(true)`. Never throws.
- Voice settings dialog: a checkbox "Keep the screen on in voice", bound to `keepScreenOn` (on at first; it costs battery, so it can be turned off).

- [ ] **Step 1: Write the failing tests**

```ts
// voice.test.ts
it("push-to-talk press buzzes once; release does not", ...);
// wake.test.ts
it("held while in voice and visible", ...);
it("released on set(false) and on destroy", ...);
it("released when the page hides, asked again when it comes back", ...);
// prefs.test.ts
it("saved prefs without keepScreenOn read as on", ...);
it("no wakeLock API: does nothing", ...);
it("a refused request does not throw or loop", ...);
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm vitest run apps/web/test/voice`
Expected: FAIL.

- [ ] **Step 3: Implement** the buzz, the wake lock and its wiring, and the CSS.

- [ ] **Step 4: Docs.** One line in "Voice": while you are in voice, the screen stays on; turn this off in voice settings with "Keep the screen on in voice".

- [ ] **Step 5: Run everything**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: PASS, and the build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/web docs/games/rooms.md
git commit -m "Voice: phone polish, screen stays on in voice"
```

---

### Task 7: Voice stats in the debug panel

**Files:**
- Create: `apps/web/src/voice/stats.ts`
- Modify: `apps/web/src/voice/voice.ts`, `apps/web/src/debug.ts`, `apps/web/src/views/room.ts` (the `attachDebug` call, about line 438)
- Test: `apps/web/test/voice/stats.test.ts` (new), `apps/web/test/voice/voice.test.ts`

**Interfaces:**
- Consumes: `VoiceTransport.getStats(): Promise<VoicePeerStats[]>` (exists; `rttMs`, `packetsLost`, `relayed`).
- Produces:
  ```ts
  // voice.ts
  stats(): Promise<VoicePeerStats[]>;   // [] when not joined or not up; never rejects
  // stats.ts
  export function voiceStatsLines(v: VoiceView, stats: VoicePeerStats[], nameOf: (id: string) => string): string[];
  // debug.ts
  export function attachDebug(client: RoomClient, getLast: () => RoomUpdate | null, voice?: { view(): VoiceView; stats(): Promise<VoicePeerStats[]>; nameOf(id: string): string }): {...};
  ```

Rules:
- Line one: `voice: on · mic: muted · talking: no · relay server: yes` (status, `mic`, `talking`, `hasTurn`). Then one line per peer, in roster order: `Asha: connected · rtt 43 ms · lost 7 · relay yes`, with `-` for null values and the link state from the view.
- The panel's "Voice" section refreshes every 2 s only while the panel is open; the interval stops on hide and on detach. Dev only, as today: no endpoint, nothing logged.

- [ ] **Step 1: Write the failing tests**

```ts
it("voiceStatsLines: a header line, then one line per peer with - for nulls", () => {
  expect(voiceStatsLines(view, [{ peerId: "b", rttMs: 43, packetsLost: 7, relayed: true }], (id) => (id === "b" ? "Asha" : id)))
    .toEqual(["voice: on · mic: on · talking: yes · relay server: no", "Asha: connected · rtt 43 ms · lost 7 · relay yes"]);
});
it("a peer with no stats yet shows dashes", ...);
it("stats is empty out of voice and never rejects", ...);   // voice.test.ts, a transport whose getStats rejects
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm vitest run apps/web/test/voice`
Expected: FAIL.

- [ ] **Step 3: Implement** `stats()`, `voiceStatsLines`, the debug section and the wiring.

- [ ] **Step 4: Run everything**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "Debug: voice link stats"
```

---

### Task 8: Sound board volume

**Files:**
- Modify: `packages/audio/src/index.ts` (`FeedbackSettings`, `DEFAULTS`, `playClip`)
- Modify: `apps/web/src/views/room.ts` (`openSettings`, about line 1493)
- Modify: `docs/games/rooms.md` ("Sound board" and "Sound and vibration")
- Test: `packages/audio/test/clip.test.ts`

**Interfaces:**
- Produces: `FeedbackSettings.boardVolume: number` (0..1, default 1). Saved with the other feedback settings under `pg:feedback`; old saved settings without it read as 1 (the existing `{ ...DEFAULTS, ...saved }` load does this; a non-number or out-of-range value is clamped to 0..1).

Rules (user, 2026-11-24):
- `playClip` plays `source -> clip gain (boardVolume) -> master`. So board clips follow `boardVolume`, the main Volume and the duck; game sounds (`play`, `ambient`) and voice do not change. `boardVolume` 0 plays nothing audible but still returns true (the clip was "played").
- In the Sound and vibration dialog, a slider "Sound board volume" right after the "Sound board" checkbox, 0 to 1, step 0.05, `aria-label` "Sound board volume". It is greyed out when Sounds is off or Sound board is off. On change it calls `audio.update({ boardVolume })`. It needs no test tone: a board clip may not be decoded yet.

- [ ] **Step 1: Write the failing tests** in `clip.test.ts`

```ts
it("a clip goes through its own gain set to boardVolume, then master", ...);
  // update({ boardVolume: 0.4 }); playClip(buf): source connects to a gain with value 0.4, which connects to master
it("game sounds do not use boardVolume", ...);     // play("card-place") with boardVolume 0.4: no 0.4 gain made
it("old saved settings without boardVolume read as 1; bad values are clamped", ...);
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm vitest run packages/audio`
Expected: FAIL.

- [ ] **Step 3: Implement** the setting, the clip gain and the slider.

- [ ] **Step 4: Docs.** "Sound and vibration" list gains **Sound board volume**: how loud board sounds are on this phone, greyed out when Sounds or Sound board is off. "Sound board" says sounds follow your volume and the sound board volume.

- [ ] **Step 5: Run everything**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/audio apps/web/src/views/room.ts docs/games/rooms.md
git commit -m "Sound board: its own volume setting"
```

---

## Real-phone checks after ship (for the user; implementers do not run these)

The user runs these on real phones after ship; there is no preview step. Use at least one iOS Safari and one Android Chrome. Voice stats are in the dev debug panel only (check 14 is on a desktop dev build).

1. Host mute: the muted phone's sound stops reaching others within a second, the toast shows, the mic button says it. Allow to talk: still muted until they tap. Mute all, then a new person joins voice: they are not muted.
2. Host mute while the person holds the push-to-talk button: their voice stops at once.
3. Make host to a host-muted person: they can talk again by tapping the mic, and can mute others.
4. Ducking feel (DOM game, for example Pass the Bomb with its tick and boom): game sound drops when someone talks, comes back about a second after they stop, and does not pump up and down between words. If it does, tune `DUCK_GAIN`, `DUCK_RELEASE_S` or `SPEAK_HOLD_TICKS`.
5. Ducking with sound board clips: a clip played while someone talks is quieter, and the voice stays clear.
6. Treasure Hunt: the step down in volume does not click or sound broken. Dominion music ducks and comes back smoothly.
7. Speakerphone on two phones in one room, game sound on: does ducking reduce echo or game sound picked up by the other mic? Note the result.
8. iOS Safari: game sound and voice together after the mic turns on (iOS may switch to a quieter call route). Note the volume level of both with ducking on and off.
9. Autoplay: reload in voice while a game is on. "Tap to turn on sound" brings voice and game sound back, and ducking still works after the tap.
10. Header at 360 px wide (and on a real small phone): every header button is easy to hit, no button covers another, and the row does not wrap or scroll.
11. Voice panel at 360x780 with 8 people: rows read well, the slider is easy to drag, no side scroll.
12. Push-to-talk buzz on Android (iOS Safari has no vibration: nothing should break).
13. Wake lock: in voice, the screen stays on; after leaving voice, or with "Keep the screen on in voice" off, it locks as usual; after switching apps and back, it stays on again. Battery over a 30-minute session.
14. Debug stats on a desktop dev build with two tabs: rtt, loss and relay look right; with "Hide my network address" relay says yes.
15. Sound board volume: low board volume makes board clips quiet while game sounds and voice stay the same; it is still set after a reload.

---

## Self-review notes

- Spec coverage: host mute and its rules (5.3) in Tasks 1 to 3; mute all and later joiners in Task 1; "Host can never turn on someone's mic" in Tasks 1 and 2; host mute in a game (5.4 said next to End game; End game now lives in the room menu, so Mute all goes there and per-person Mute goes in the Voice panel and seat menu) in Task 3; ducking for DOM games, sound board clips and Godot (5.4) in Tasks 4 and 5, with Blind Rally and Rally skipped as the spec allows (section 4, "or skips ducking for it") and the user chose; the "game sound ducking" setting (3) in Task 4; phone polish and the wake lock in Task 6; debug stats (5.7) in Task 7; "soundboard volume" (3) in Task 8; acceptance test "lifting it leaves the person self-muted" (7) in Tasks 1 and 2.
- Found while reading: the phone ignores the roster's `selfMuted`, so before Task 2 a host lift would start sending again. Dominion has its own AudioContext, so the spec's "DOM games all play through `@games/audio`" is not quite true; Task 5 covers it.
