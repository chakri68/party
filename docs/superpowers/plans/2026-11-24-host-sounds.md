# Host Sounds (Sound Board Step 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A host keeps up to 6 of their own sounds, saved to their account in R2. The sounds show on the sound board, after the default ones, in every room the host makes. The host makes them on the phone: pick a file, choose 3 seconds, and the phone evens the loudness and encodes a small mp3 before upload.

**Architecture:**
- `HostPolicy` gets an optional `soundOwner(request, env)`. It names the library (`"owner"` on party-games, the account id on CouchParty). The grant from `canCreate` carries `library`, the room stores it at `claim`, and the room never reads R2. Its public state says only `hostSounds: boolean`. The library id never reaches a phone.
- The Worker (not the room DO) serves the owner API `/api/sounds[/<slot>]` and the room routes `/api/rooms/<code>/sounds[/<slot>]`, straight from an R2 bucket bound as `SOUNDS`. For a room route it asks the room DO for its library id with an RPC that reads memory and skips the room's queue.
- The room relays `host:<1..6>` ids, the same way it relays `free:` ids, when it has a library. A phone ignores an id it has no clip for.
- On the phone, the board fetches the room's host list when the room says `hostSounds`, and again each time the panel opens. It fetches only files whose `?v=` changed. "My sounds" is a lazy-loaded full-screen dialog, opened from home and from the Room menu. It is the only code that loads the mp3 encoder.

**Tech Stack:** TypeScript, Cloudflare Workers + Durable Objects (partyserver 0.5.10) + R2, Vite (dynamic `import()` for the lazy chunk), Vitest, Web Audio (`OfflineAudioContext.decodeAudioData`), `wasm-media-encoders@0.7.0` (LAME compiled to WebAssembly).

**Spec:** docs/superpowers/specs/2026-11-22-soundboard-design.md. This plan covers section 6 item 2: section 5.4, the step-2 lines of section 7 (the upload API and phone processing), and the step-2 copy in section 8. Step 1 shipped as docs/superpowers/plans/2026-11-22-soundboard.md. Step 3 (signature sounds) is not here.

## Global Constraints

- Bump `PROTOCOL_VERSION` from 12 to 13, in Task 2 only. The one wire change is `RoomPublicState.hostSounds: boolean`. The `sound` messages keep their shape. `host:3` already passes `isSoundId`.
- Limits (spec 5.4): 6 slots, ids `"1"`..`"6"`. A file of at most 64 KB (`65536` bytes), `audio/mpeg`. A name of 1..24 characters after trim, with no control characters. At most 3000 ms. The server measures the length from the mp3 frames and does not trust the phone.
- R2 keys (spec 5.4): `lib/<libraryId>/<slot>.mp3` and `lib/<libraryId>/index.json`. The index is `{ "slots": [{ "id", "name", "ms", "v" }] }`, where `v` is the first 10 hex characters of the sha256 of the mp3 bytes.
- The room never does file work inside `run()` and never reads R2. `library()` is a memory read with no queue.
- The library id is never in `getPublicState`, `RoomPublicState`, a server message or a URL a phone sees. Room routes use the room code.
- No wrangler command against Cloudflare from any task. Tests use fake buckets. `pnpm dev` uses wrangler's local R2. The user creates the buckets at ship time (see Ship).
- Player copy: short plain sentences and basic words. No idioms or slang. Easy for Indian readers who read English as a second language. No emoji anywhere (UI, docs, tests, commit messages). Icons are SVG in `apps/web/src/brand.ts`. Exact copy is in the tasks. These come from the spec: "My sounds", "Add a sound", "Replace", "Remove", "Name", "This sound is too long. We will keep 3 seconds.", "This file is not a sound we can use.", "Get Host Pass to use these in your rooms."
- Phones first: lay out at 360x780 first. Every tap target is at least 40 px high (44 px for tiles and slot buttons, as in step 1).
- Another builder is changing `apps/web/src/style.css` and game client files on this branch. Put new styles in `apps/web/src/views/my-sounds.css`, imported by the lazy module. Add only a few `.sound-*` lines to `style.css`, next to the step-1 `.sound-*` rules, if any are needed.
- Shared code lands on `master`. Only Task 9 touches the `product` branch (`apps/product-*`).
- Docs change in the same task as the behaviour they describe.
- Tests: `pnpm vitest run <file>` for one file, `pnpm test` for all, `pnpm typecheck` for types. Runtime tests use `apps/server/test/harness.ts` (`World`, `join`, `send`, `roomOf`). Worker tests call `createFetch` with fakes, as `policy.test.ts` and `packs.test.ts` do.
- Commit trailer, exactly:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01KwNUn8AHWzbftW559ZRTih

## Plan decisions (small, made here)

- **Encoder: `wasm-media-encoders@0.7.0`**, pinned exactly. Nothing that encodes mp3 is in the lockfile today. Why this one: the wrapper is MIT, it is small (about 65 KB gzipped for the mp3 wasm), it is fast on low-end phones (WebAssembly, not JS), it runs in Node too (so Vitest can test the real output), and it has a plain API (`createMp3Encoder()`, `configure`, `encode`, `finalize`). The other choices: `@breezystack/lamejs@1.2.7` (LGPL-3.0, pure JS, slower, last released 2023) and `lamejs@1.2.1` (LGPL-3.0, last released 2022). No permissively licensed mp3 encoder exists: they are all LAME or shine. So the LAME code inside the wasm is LGPL-2.0. It ships as its own lazy file that a person could swap, which is how LGPL asks for it. The user approved this for both sites on 2026-11-24. Its last release was 2024-05. mp3 encoding does not change, so that is fine.
- **`soundOwner` returns `{ library, active }`, not `string | null`** (a change from spec 5.4). `active: false` is a CouchParty host whose Pass has lapsed: "My sounds" opens with "Get Host Pass to use these in your rooms." and "Get Host Pass to add sounds.", and the server refuses PUT for that library. The method is optional on `HostPolicy`. Without it, nobody owns a library and host sounds are off.
- **`RoomGrant.library?: string | null`** is optional (absent means null), so the product branch still compiles at the merge before Task 9.
- **No `SOUNDS` binding means no host sounds.** `createFetch` sets `library: null` on the grant when `env.SOUNDS` is missing, and every sounds route returns 404. A self-hosted copy (`scripts/host.mjs` already drops `r2_buckets`) gets only the free pack.
- **Upload body:** `PUT /api/sounds/<slot>?name=<urlencoded>` with the raw mp3 as the body and `content-type: audio/mpeg`. Rename: `PATCH /api/sounds/<slot>` with JSON `{ name }`. Every write answers with the new list, so the phone does not need a second GET.
- **Writes and cross-site requests:** a write whose `Origin` header is set and is not the request's own origin gets a 403. PUT and PATCH need a content type that a plain form cannot send, and there are no CORS headers. This matters for CouchParty's cookies.
- **Index races:** write the file first, then the index. Write the index with `onlyIf: { etagMatches }` when the index exists. If R2 refuses, read it again and retry, up to 3 tries in all, then answer 409 "Could not save. Try again." DELETE writes the index first, then removes the file.
- **Caching:** owner and room file routes send `cache-control: private, max-age=31536000, immutable`, keyed on `?v=`. List routes send `no-store`. Files always send `x-content-type-options: nosniff`.
- **Phone processing:** decode with `new OfflineAudioContext(1, 1, 48000).decodeAudioData(bytes)`, so the clip is always at 48 kHz. Then mix to mono and cut at most 2.9 s, because the encoder adds about 50 ms of padding and the server's limit is 3000 ms. Then set the RMS to -16 dBFS, but keep the peak at or below -1.5 dBFS and the gain at or below +24 dB. A clip with RMS under 1e-4 is left as it is. Encode at 64 kbps CBR, mono, 48 kHz: about 24 KB for 2.9 s. The phone refuses a file over 4 MB before decoding it, because a long song decodes to hundreds of MB and can crash a phone.
- **Start picker:** a range input (step 0.1 s) shows only when the decoded file is longer than 2.9 s, with the line "This sound is too long. We will keep 3 seconds." and the label "Starts at 1.2 seconds". **Play** plays the cut as it will be saved.
- **Board order:** free sounds, then the extra packs, then the host's sounds in slot order. The host's sounds get no heading. Each tile shows its name.
- **When the board fetches the host list:** on the first room update with `hostSounds: true`, each time the panel opens, and when the in-room My sounds dialog closes. It does this only while **Sound board** is on. A call that comes while a fetch is running is folded into one more fetch after it.
- **Who sees "My sounds":** the shell asks `GET /api/sounds` once per page load, with `shellConfig().soundsAuth()` headers. The answer 200 means yes. The shell does not ask when `soundsAuth()` gives `null`. The stock default gives the owner key as a bearer token, or `null` without one. CouchParty passes `() => ({})`, because its cookie goes with a same-origin fetch. The home page shows a **My sounds** button under Create. The Room menu shows **My sounds** to the host when this phone owns sounds.
- **Lapsed Pass (CouchParty), decided by the user:** list, play, rename and remove still work. Add and replace need an active Pass: the server refuses PUT for a lapsed library, and the My sounds screen hides **Add a sound** and **Replace** and shows "Get Host Pass to add sounds." New rooms do not get the library.
- **The library id format:** `/^[A-Za-z0-9_-]{1,64}$/`. `"owner"` and CouchParty's `newId()` (base64url, 24 characters) both match. A soundOwner answer that does not match is treated as null.

## Review Focus

1. **A big or odd input file** (a 6-minute song, a phone video, a 96 kHz wav, a file with no audio track, a renamed .txt): the phone must not hang or crash. It refuses a file over 4 MB before decoding, with "This file is too big. Pick a file under 4 MB.", and gives "This file is not a sound we can use." when decoding fails. Pinned in Task 6: "checkInput refuses a file over 4 MB" and "prepareClip of a long input still gives at most 2.9 s". Manual: the checklist.
2. **A slot replaced mid-party:** phones that already have the old clip must play the new one after the next panel open, and must not fetch files that did not change. Pinned in Task 5: "loadHost again fetches only changed files and drops removed slots".
3. **A guessed room code used to read files:** the room routes serve only the library that this room stored at claim. A room with no library is a 404. The slot is strictly `1..6`. Pinned in Task 4: "the file route refuses a room that does not use that library" and "a bad code never wakes a room".
4. **Silent, very quiet or clipping clips:** no NaN, no blast of noise from a near-silent clip, no clip over the peak. Pinned in Task 6: "a silent clip stays silent", "gain is at most +24 dB", "never goes over the peak limit".
5. **Two tabs saving at once** (the host edits on phone and laptop): neither save may wipe the other slot. Pinned in Task 3: "a race on the index retries and keeps both slots".

---

### Task 1: Shared rules for host sounds (`packages/sounds`)

**Files:**
- Create: `packages/sounds/mp3.mjs`, `packages/sounds/mp3.d.mts`, `packages/sounds/test/mp3-fixture.ts`
- Modify: `packages/sounds/check.mjs`, `packages/sounds/check.d.mts`, `packages/sounds/package.json` (exports `"./mp3": "./mp3.mjs"`)
- Test: `packages/sounds/test/mp3.test.ts` (new), `packages/sounds/test/pack.test.ts` (one new `it`)

**Interfaces:**
- Produces (`check.mjs`, typed in `check.d.mts`):
  - `HOST_PACK = "host"`, `HOST_SLOTS = 6`, `HOST_SOUND_MAX_BYTES = 65536`.
  - `isHostSlot(v: unknown): v is string`: exactly `"1"`..`"6"` (no `"01"`, no `" 1"`).
  - `cleanSoundName(v: unknown): string | null`: the trimmed name when it is a string of 1..`SOUND_NAME_MAX` characters with no control characters, and `null` otherwise. `checkEntries` uses it for its name rule, with no change to its messages.
- Produces (`mp3.mjs`, plain JS with no imports, typed in `mp3.d.mts`):
  - `readMp3(bytes: Uint8Array): { ms: number; mono: boolean; sampleRate: number; frames: number } | null`. This is the algorithm, because the tests do not pin it fully:
    1. If the bytes start with `"ID3"`, skip `10 + synchsafe(bytes[6..9])` bytes (plus 10 more when footer flag `bytes[5] & 0x10` is set).
    2. Walk the frames from there. Each header is 4 bytes. The sync is `b0 === 0xff && (b1 & 0xe0) === 0xe0`. The version is `(b1 >> 3) & 3` (3 is MPEG1, 2 is MPEG2, 0 is MPEG2.5, 1 is bad). The layer must be III (`(b1 >> 1) & 3 === 1`). The bitrate index is `b2 >> 4` (0 and 15 are bad). The rate index is `(b2 >> 2) & 3` (3 is bad). The padding is `(b2 >> 1) & 1`. The channel mode is `b3 >> 6` (3 is mono).
    3. The frame length is `floor(144000 * kbps / rate) + pad` for MPEG1, and `floor(72000 * kbps / rate) + pad` otherwise. The samples per frame are 1152 for MPEG1 and 576 otherwise. Use the standard layer III bitrate tables (V1 and V2) and rate tables.
    4. Stop at the end of the bytes, at `"TAG"` (ID3v1), or at the first header that is not valid. A frame cut off by the end still counts.
    5. Return `null` when there is no frame. Otherwise `ms = round(sum(samples) / rate * 1000)`. `mono` and `sampleRate` come from the first frame.
- Produces (`test/mp3-fixture.ts`, tests only): `fakeMp3(opts?: { frames?: number; mono?: boolean; id3?: boolean; mpeg2?: boolean }): Uint8Array`. It builds valid frame headers with zero bodies: MPEG1, 64 kbps, 48 kHz (`0xff 0xfb 0x54` and then `0xc4` for mono or `0x04` for stereo), each 192 bytes long and 24 ms. With `mpeg2`, it uses 24 kHz, 32 kbps frames of 576 samples. The defaults are 100 frames (2400 ms), mono and no ID3. Tests make their mp3 bytes with this, so no `.mp3` file enters git (step 1's "no other .mp3 in the repo" test still holds).

- [ ] **Step 1: Write the failing tests** in `mp3.test.ts`:
  - "reads mono 48 kHz frames": `readMp3(fakeMp3())` gives `{ ms: 2400, mono: true, sampleRate: 48000, frames: 100 }`.
  - "sees stereo": `fakeMp3({ mono: false })` gives `mono: false`.
  - "skips an ID3v2 tag": `fakeMp3({ id3: true })` gives `frames: 100`.
  - "MPEG2 frames are 576 samples": `fakeMp3({ mpeg2: true, frames: 50 })` gives `ms: 1200`.
  - "stops at ID3v1 and at junk": 100 frames plus `"TAG"` and 125 bytes gives 100 frames. 100 frames plus 50 random bytes gives 100 frames.
  - "is null for bytes that are not mp3": `new Uint8Array()`, the 12-byte `"RIFF....WAVE"` header, 1000 zero bytes, and a header with layer II (`b1 = 0xfd`).
  - "a 3.1 s file reads over the limit": `fakeMp3({ frames: 130 })` gives `ms: 3120`.
- [ ] **Step 2: Add to `pack.test.ts`**: "host slot and name rules". `isHostSlot`: `"1"` and `"6"` are true. `"0"`, `"7"`, `"01"`, `1` and `"a"` are false. `cleanSoundName`: `"  Bruh "` gives `"Bruh"`. `""`, `"   "`, `"x".repeat(25)`, `"a\u0007b"` and `7` give `null`. The step-1 `checkEntries` tests still pass unchanged.
- [ ] **Step 3: Run and check it fails.** Run: `pnpm vitest run packages/sounds/test`. Expected: FAIL (`mp3.mjs` is not found, `isHostSlot` is not exported).
- [ ] **Step 4: Implement** `mp3.mjs`, `mp3.d.mts`, the `check.mjs` additions, the export and the fixture, as in Interfaces.
- [ ] **Step 5: Run and check it passes.** Run the Step 3 command, then `pnpm typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** "Sounds: mp3 reader and host sound rules".

### Task 2: Protocol v13 and the room's library (server)

**Files:**
- Modify: `packages/protocol/src/index.ts` (`PROTOCOL_VERSION`, `RoomPublicState.hostSounds`)
- Modify: `packages/protocol/test/sound.test.ts` (the version test: 12 becomes 13)
- Modify: `apps/server/src/sounds.ts` (`onBoard`), `apps/server/src/runtime.ts` (`RoomGrant`, `RoomData`, `claim`, `upgrade`, `library`, the `sound` case, `publicState`), `apps/server/src/worker.ts` (`RoomBase.library`, `RoomBase.upgrade`, `RoomStub`)
- Modify: `apps/web/test/sound-board.test.ts` and any other full `RoomPublicState` literal that `typecheck` names (add `hostSounds: false`)
- Test: `apps/server/test/sounds.test.ts` (extend), `apps/server/test/tier.test.ts` (extend)

**Interfaces:**
- Consumes: `isHostSlot`, `HOST_PACK` from `@games/sounds/check` (Task 1).
- Produces (protocol): `PROTOCOL_VERSION = 13`. `RoomPublicState.hostSounds: boolean` ("The room has the host's own sounds: fetch `/api/rooms/<code>/sounds` for them. Never says whose.").
- Produces (server):
  - `onBoard(id: string, extraPacks: readonly string[], hostSounds: boolean): boolean`. A `host:<x>` id is on the board when `hostSounds && isHostSlot(x)`. `host` is never taken from `extraPacks`. The other rules are the same as before.
  - `RoomGrant.library?: string | null` ("The host's sound library, for this room's board. Absent or null: no host sounds.").
  - `RoomData.library?: string` (optional: rooms stored before it have none). `claim` stores it only when it is a non-empty string.
  - `RoomRuntime.library(): string | null`. A plain read of `this.data?.library ?? null`. It does not go through `run()`.
  - `RoomRuntime.upgrade(library?: string | null): Promise<void>`. In the same free-to-pass step it sets `data.library` when `library` is a non-empty string and the room has none. It changes nothing on a room that is already pass.
  - `publicState`: `hostSounds: !!data.library`.
  - `RoomBase.library(): Promise<string | null>` (RPC) returns `this.runtime.library()`. partyserver's `getServerByName` awaits `onStart`, so the room is loaded.
  - `RoomBase.upgrade(hostKey: string, library?: string | null): Promise<boolean>`. It passes `library` on only when `(this.env as ServerEnv).SOUNDS` is bound.
  - `RoomStub.library?(): Promise<string | null>` (optional, so test fakes that only `claim` still fit).
  - The `sound` case calls `onBoard(msg.id, this.host.soundPacks ?? [], !!data.library)`.

- [ ] **Step 1: Update the protocol test**: "is version 13".
- [ ] **Step 2: Write the failing server tests** in `sounds.test.ts`:
  - "onBoard host ids": `host:1` and `host:6` are true with `hostSounds` true. `host:7`, `host:0` and `host:a` are false. `host:1` is false with `hostSounds` false, even with `["host"]`. The step-1 cases pass `false` and keep their answers.
  - `describe("host sounds")`. Claim with `room.claim({ tier: "pass", hostKey: null, library: "lib-secret-1" })` before anyone joins.
    - "relays host slots in a room with a library": `host:3` reaches `a` and `b` with `by: idOf(a)`. `host:7` reaches nobody.
    - "a room without a library drops host ids": a default `claim()`, then `host:1` reaches nobody, and `roomOf(a).hostSounds` is `false`.
    - "hostSounds is in the state, the library id is not": `roomOf(a).hostSounds` is `true`, and `JSON.stringify` of every message any connection got does not contain `"lib-secret-1"`.
    - "library() is a plain read": `room.library()` gives the string `"lib-secret-1"` (not a promise) while a `send` is still waiting (start a `send` without `await`, then read).
    - "host sounds share the cooldown and the room cap": `free:<x>` then `host:1` from one seat inside 3 s relays once.
- [ ] **Step 3: Write the failing tier tests** in `tier.test.ts`:
  - "upgrade with a library gives a free room host sounds": `claim({ tier: "free", hostKey: "hk" })`, then `upgrade("acct-9")`. After exactly one more update, `hostSounds` is `true`, and `library()` is `"acct-9"`.
  - "upgrade never changes a library": a room claimed with `library: "a"` and tier free, then `upgrade("b")`, gives `library()` `"a"`. A pass room's `upgrade("b")` sends no update and keeps its library.
- [ ] **Step 4: Run and check they fail.** Run: `pnpm vitest run packages/protocol/test apps/server/test/sounds.test.ts apps/server/test/tier.test.ts`. Expected: FAIL.
- [ ] **Step 5: Implement** the protocol bump, `onBoard`, the runtime and the `RoomBase` changes, as in Interfaces.
- [ ] **Step 6: Run and check they pass.** Run the Step 4 command, then `pnpm test` and `pnpm typecheck`. Add `hostSounds: false` wherever `typecheck` names a full `RoomPublicState` literal. Expected: PASS.
- [ ] **Step 7: Commit** "Room: protocol v13, the room's sound library".

### Task 3: The owner API, `soundOwner` and the `SOUNDS` bucket (Worker)

**Files:**
- Create: `apps/server/src/host-sounds.ts`
- Modify: `apps/server/src/policy.ts` (`SoundOwner`, `HostPolicy.soundOwner`, `ownerKeyPolicy`, `ServerEnv extends ..., SoundsEnv`)
- Modify: `apps/server/src/worker.ts` (route `serveMySounds` before `serveGodot`)
- Modify: `apps/server/wrangler.jsonc` (`r2_buckets`), `apps/server/worker-configuration.d.ts` (regenerated)
- Modify: `AGENTS.md` ("Where things live": add the host sounds line)
- Test: `apps/server/test/host-sounds.test.ts` (new), `apps/server/test/policy.test.ts` (extend)

**Interfaces:**
- Consumes: `readMp3` from `@games/sounds/mp3`, and `isHostSlot`, `cleanSoundName`, `HOST_SOUND_MAX_BYTES`, `MAX_SOUND_MS` from `@games/sounds/check` (Task 1).
- Produces (`policy.ts`):
  - `interface SoundOwner { library: string; active: boolean }` ("`active` false: the list opens, rename and remove work, PUT is refused, and new rooms do not get it.").
  - `HostPolicy.soundOwner?(request: Request, env: ServerEnv): Promise<SoundOwner | null>`.
  - `ownerKeyPolicy.soundOwner`: a bearer token that `isOwnerKey` accepts gives `{ library: "owner", active: true }`. Otherwise it gives `null`. `ownerKeyPolicy.canCreate`'s grant gains `library: "owner"`.
- Produces (`host-sounds.ts`):
  - `type SoundsBucket = Pick<R2Bucket, "get" | "put" | "delete" | "head">`. `interface SoundsEnv { SOUNDS?: SoundsBucket }`.
  - `LIBRARY_ID_RE = /^[A-Za-z0-9_-]{1,64}$/`. `libKey(library: string, slot: string): string` gives `lib/<library>/<slot>.mp3`. `indexKey(library: string): string` gives `lib/<library>/index.json`.
  - `interface HostSlot { id: string; name: string; ms: number; v: string }`.
  - `readIndex(bucket: SoundsBucket, library: string): Promise<{ slots: HostSlot[]; etag: string | null }>`. A missing index, or one that is not JSON, gives `{ slots: [], etag }`. An entry is kept only when `isHostSlot(id)`, `cleanSoundName(name)`, `ms` is an integer in 1..3000, and `v` is 10 hex characters. Repeated ids keep the first copy. The result is sorted by id.
  - `interface SoundSlotBody { id: string; name: string; ms: number; url: string }`. `interface MySoundsBody { active: boolean; slots: SoundSlotBody[] }`. Here `url` is `/api/sounds/<id>?v=<v>`.
  - `serveMySounds(request: Request, env: ServerEnv, policy: HostPolicy): Promise<Response | null>`. It gives `null` for paths other than `/api/sounds` and `/api/sounds/<x>`. Routes and answers, in check order:
    - 404 when there is no `SOUNDS` binding or no `policy.soundOwner`.
    - 403 `{ error: "Only the host can change these sounds." }` when `soundOwner` gives `null`, or a library that fails `LIBRARY_ID_RE`, or (for writes) an `Origin` header that is not the request's origin.
    - `GET /api/sounds`: 200 `MySoundsBody`, `cache-control: no-store`.
    - `<x>` that fails `isHostSlot`: 404.
    - `GET /api/sounds/<slot>`: the file, as `audio/mpeg`, with `private, max-age=31536000, immutable`, `etag` and `nosniff`. 404 when the slot is empty.
    - `PUT /api/sounds/<slot>?name=`: the checks run in this order. `content-type` must be `audio/mpeg`, or the answer is 415 "This file is not a sound we can use.". `content-length` over the cap, or a body that grows past `HOST_SOUND_MAX_BYTES` while it is read, gives 413 "This sound file is too big.". `cleanSoundName(name)` null gives 400 "A name has 1 to 24 letters.". `readMp3` null gives 415 (the same line as above). `active: false` gives 403 "Get Host Pass to add sounds." (checked right after the owner check, before the body is read). `ms > MAX_SOUND_MS` gives 422 "This sound is too long. A sound can be 3 seconds at most.". Then put the file (`httpMetadata.contentType = "audio/mpeg"`), then the index, using the race rule. The answer is 200 `MySoundsBody`.
    - `PATCH /api/sounds/<slot>` with JSON `{ name }`: a bad name gives 400 (the same line). An empty slot gives 404 "There is no sound here.". Only the index changes, and `v` stays the same. The answer is 200 `MySoundsBody`.
    - `DELETE /api/sounds/<slot>`: the index without the slot first, then delete the file. An empty slot also gets 200. The answer is 200 `MySoundsBody`.
    - Any other method: 405 with `allow: GET, PUT, PATCH, DELETE` (or `allow: GET` on `/api/sounds`).
    - Errors are JSON `{ error }` through `json()` from `policy.ts`.
  - `readCapped(body: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array | null>`: `null` once it reads more than `max` bytes.
- `wrangler.jsonc`: add `{ "binding": "SOUNDS", "bucket_name": "party-games-sounds" }` with the comment "SOUNDS: each host's own sounds (lib/<library>/...). Without it there are no host sounds, and /api/sounds is a 404."
- `AGENTS.md`, under `packages/sounds`: "Host sounds (step 2) live in the R2 bucket bound as `SOUNDS`, keyed `lib/<library>/`. The Worker serves them (`apps/server/src/host-sounds.ts`). The room only stores which library it uses."

- [ ] **Step 1: Write the failing tests** in `host-sounds.test.ts`. Use a fake bucket backed by a `Map`. `put` honours `onlyIf.etagMatches` and gives `null` when it does not match. Each put gets a new `httpEtag`. A test switch makes the next index put fail once. Requests carry `authorization: Bearer <OWNER_KEY>` and `env = { OWNER_KEY, SOUNDS: bucket }`. Call `serveMySounds(req, env, ownerKeyPolicy)` directly. One case goes through `createFetch`.
  - "lists an empty library": GET gives 200, `{ active: true, slots: [] }` and `no-store`.
  - "refuses anyone but the owner": no auth, a wrong key, and a policy with no `soundOwner` give 403, 403 and 404. With no `SOUNDS`, every route gives 404.
  - "saves a sound": `PUT /api/sounds/3?name=%20Bruh%20` with `fakeMp3()` gives 200. The bucket has `lib/owner/3.mp3` with the same bytes. The index slot is `{ id: "3", name: "Bruh", ms: 2400, v: <10 hex> }`, and the body slot `url` is `/api/sounds/3?v=<v>`.
  - "checks the slot, type, size, name and length": slots `0`, `7` and `a` give 404. `content-type: audio/wav` gives 415. 65537 bytes gives 413, both with a true `content-length` and with none (a stream). `name=` and a 25-character name give 400. `fakeMp3({ frames: 130 })` gives 422. 1000 zero bytes give 415. After all of these, nothing is written.
  - "replace changes v, rename keeps it": a second PUT with other bytes changes `v`. A PATCH `{ name: "Wow" }` keeps `v` and changes the name. A PATCH on an empty slot gives 404.
  - "remove takes the slot and the file": DELETE gives 200. The slot is gone, and so is `lib/owner/3.mp3`. A second DELETE also gives 200.
  - "a lapsed library can rename and remove but not save": a test policy giving `{ library: "owner", active: false }`. GET lists with `active: false`. PATCH and DELETE give 200. PUT gives 403 `{ error: "Get Host Pass to add sounds." }`, and nothing is written.
  - "serves the owner's own file": GET `/api/sounds/3?v=x` gives 200, `audio/mpeg`, the private immutable cache and `nosniff`. An empty slot gives 404.
  - "a race on the index retries and keeps both slots": slot 1 is saved. The next index put is made to fail once, and slot 2 is saved. Both slots are in the index. With the put failing 3 times, the answer is 409 "Could not save. Try again.".
  - "a bad index in R2 is cleaned on read": an index with id `"9"`, `ms: 5000`, a 30-character name and a repeated `"1"` lists only the first good `"1"`.
  - "two libraries do not mix": a test policy whose `soundOwner` reads the library from a header. Library `a` saves slot 1, and library `b` lists `[]`.
  - "a library id with odd characters is refused": `soundOwner` giving `"../x"` gets 403.
  - "a write from another site is refused": PUT with `origin: https://evil.test` gets 403. The same origin, or no origin header, is allowed.
  - "createFetch routes it": `createFetch({ policy: ownerKeyPolicy, brand: "x" })` lists the library.
- [ ] **Step 2: Extend `policy.test.ts`**: "ownerKeyPolicy names the owner's library". The owner key gives `{ library: "owner", active: true }`, and no key gives `null`. `canCreate`'s grant has `library: "owner"`.
- [ ] **Step 3: Run and check it fails.** Run: `pnpm vitest run apps/server/test/host-sounds.test.ts apps/server/test/policy.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** `host-sounds.ts`, the policy changes and the route in `createFetch`, as in Interfaces. Import only `@games/sounds/check` and `@games/sounds/mp3` in the Worker, never `@games/sounds`.
- [ ] **Step 5: Add the binding and regenerate the types.** Edit `wrangler.jsonc`, then run `pnpm --filter @games/server types`. Expected: `worker-configuration.d.ts` gains `SOUNDS: R2Bucket;`. Keep only that line if the regenerate changes others. Update `AGENTS.md`.
- [ ] **Step 6: Run and check it passes.** Run the Step 3 command, `pnpm test`, `pnpm typecheck`, and `pnpm --filter @games/server exec wrangler deploy --dry-run` (a local build only; it does not contact Cloudflare). Expected: PASS, and the dry run lists the `SOUNDS` binding.
- [ ] **Step 7: Commit** "Worker: host sounds API and SOUNDS bucket".

### Task 4: The room's sound routes and the grant's library (Worker)

**Files:**
- Modify: `apps/server/src/host-sounds.ts` (`serveRoomSounds`), `apps/server/src/worker.ts` (`createFetch`: route it, and drop the library when there is no `SOUNDS`)
- Test: `apps/server/test/host-sounds.test.ts` (a new `describe`), `apps/server/test/policy.test.ts` (extend)

**Interfaces:**
- Consumes: `readIndex`, `libKey`, `LIBRARY_ID_RE` (Task 3). `RoomStub.library` (Task 2).
- Produces:
  - `interface RoomSoundsBody { pack: "host"; sounds: SoundSlotBody[] }`. Here `url` is `/api/rooms/<CODE>/sounds/<id>?v=<v>`, with the code in upper case.
  - `serveRoomSounds(request: Request, env: ServerEnv, libraryOf: (code: string) => Promise<string | null>): Promise<Response | null>`. It handles `/api/rooms/<code>/sounds` and `/api/rooms/<code>/sounds/<x>` and gives `null` for every other path (so `POST /api/rooms` and CouchParty's `/upgrade` are untouched). It answers 405 with `allow: GET` for other methods. It answers 404 for: no `SOUNDS`, a code that fails `isValidRoomCode(code.toUpperCase())` (without calling `libraryOf`), a `null` or bad library, a bad slot, or an empty slot. The list gets 200 `RoomSoundsBody` with `no-store`. A file gets `audio/mpeg`, the private immutable cache, `etag` and `nosniff`.
  - `createFetch`: route `serveRoomSounds(request, env, async (code) => (await getRoom(env, code)).library?.() ?? null)` before `serveMySounds`. In `POST /api/rooms`, the grant passed to `claim` is `env.SOUNDS ? decision.grant : { ...decision.grant, library: null }`.

- [ ] **Step 1: Write the failing tests**, `describe("room routes")`. Save slots 1 and 3 into library `owner` with the Task 3 API first. `libraryOf` is a `vi.fn` giving `"owner"`.
  - "lists the room's host sounds": `/api/rooms/k7dx/sounds` gives 200, `no-store` and `{ pack: "host", sounds: [slot 1, slot 3] }`, with urls `/api/rooms/K7DX/sounds/1?v=...`. `libraryOf` was called with `"K7DX"`.
  - "serves a slot's file": 200 with the same bytes, `audio/mpeg`, the private immutable cache and `nosniff`.
  - "the file route refuses a room that does not use that library": with `libraryOf` giving `"other"`, the list is `[]` and the file is 404. With `null`, both are 404.
  - "a bad code never wakes a room": `/api/rooms/K7/sounds` and `/api/rooms/K7DX!/sounds` give 404, and `libraryOf` was not called.
  - "is a 404 for a bad or empty slot, and a 405 for writes": `/sounds/7`, `/sounds/2` and `/sounds/1.mp3` give 404. A PUT gives 405.
  - "leaves other room paths alone": `POST /api/rooms` and `/api/rooms/K7DX/upgrade` give `null`.
  - "no phone ever sees the library id": the list body and every header do not contain `"owner"`.
- [ ] **Step 2: Extend `policy.test.ts`**: "the grant keeps its library only with SOUNDS". The fake `getRoom().claim` records its grant. With `SOUNDS` it gets `library: "owner"`. Without it, it gets `library: null`.
- [ ] **Step 3: Run and check it fails.** Run: `pnpm vitest run apps/server/test/host-sounds.test.ts apps/server/test/policy.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** `serveRoomSounds` and the two `createFetch` changes.
- [ ] **Step 5: Run and check it passes.** Run the Step 3 command, then `pnpm test` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** "Worker: room sound routes".

### Task 5: Host sounds on the room board (phone)

**Files:**
- Modify: `apps/web/src/sounds/packs.ts` (`parseHostList`, export `isSameOriginPath`), `apps/web/src/sounds/board.ts` (`loadHost`, base and host lists), `apps/web/src/views/sound-board.ts` (`onOpen`), `apps/web/src/views/room.ts` (wiring)
- Modify: `docs/games/rooms.md` ("Sound board": one line)
- Test: `apps/web/test/sounds/packs.test.ts`, `apps/web/test/sounds/board.test.ts`, `apps/web/test/sound-board.test.ts` (extend each)

**Interfaces:**
- Consumes: `RoomPublicState.hostSounds` (Task 2). `RoomSoundsBody` shape (Task 4). `HOST_PACK`, `isHostSlot` from `@games/sounds/check`.
- Produces (`packs.ts`):
  - `hostSoundsUrl(code: string): string` gives `/api/rooms/${code}/sounds`.
  - `parseHostList(body: unknown, listUrl: string): BoardSound[]`. `pack` must be `"host"`. Each entry needs `isHostSlot(id)`, a name of 1..24 characters after trim, `ms` an integer in 1..3000, and a `url` that passes `isSameOriginPath` and starts with `${listUrl}/`. The ids become `host:<id>`. Repeated ids are dropped. It keeps at most `HOST_SLOTS`. Bad input gives `[]`.
- Produces (`board.ts`):
  - The list is always `[...base, ...host]`. `load()` (step 1) sets `base`. `loadHost` sets `host`. `list()`, `tap` and `receive` are unchanged for callers.
  - `loadHost(listUrl: string): Promise<void>`. It fetches the list through `deps.getJson` (a failure keeps the old host list), sets `host`, and tells listeners. It drops the clips and the waiting bytes of host ids no longer listed. It fetches bytes only for an id whose `url` differs from the one it last fetched for that id. Those bytes go through the same decode queue, and a new clip replaces the old one only once it is decoded. A call while one is running gives a promise for one more run after it (never more than one waiting). Nothing happens after `destroy()`.
- Produces (`sound-board.ts`): `SoundBoardViewOptions.onOpen?(): void`, called each time the panel opens.
- `room.ts`:
  - `const refreshHost = () => { if (this.last?.room.hostSounds && audio.settings.roomSounds) void board.loadHost(hostSoundsUrl(code)); }`.
  - Call it from the `update` handler when `hostSounds` goes from false (or no state yet) to true, from `onOpen`, and from the **Sound board** setting when it is turned on.
  - Keep it on `this` as `refreshHostSounds` for Task 8.
- `docs/games/rooms.md`, "Sound board": "- After the free sounds come the host's own sounds, when the host has made some in **My sounds**."

- [ ] **Step 1: Write the failing pack tests**:
  - "parseHostList keeps host slots": a body with slot 3 under `/api/rooms/K7DX/sounds` gives `[{ id: "host:3", name, ms, url }]`.
  - "parseHostList drops what is not safe": `pack: "memes"`; id `"7"`; a url under `/api/rooms/ZZZZ/sounds/`; `https://x.test/a`; `//x.test/a`; `ms: 3001`; a 25-character name; a repeated id; and 8 good-looking entries (keeps 6). `null` gives `[]`.
- [ ] **Step 2: Write the failing board tests** (step 1's fake deps, plus `getJson` that serves a host list a test can change):
  - "host sounds come after the others": after `load(["/p"])` and `loadHost(L)`, `list()` is the free ids, then `memes:` ids, then `host:1`, `host:3`. This holds when `loadHost` resolves before the extra packs do, too.
  - "loadHost again fetches only changed files and drops removed slots": the first `loadHost` fetches 2 files. Then slot 1 gets a new `v` and slot 3 goes away, and a second `loadHost` fetches exactly 1 file (slot 1's new url). `receive("host:3")` gives `false`. After decode, `receive("host:1")` plays the new clip.
  - "the old clip plays until the new one is decoded": between the second `loadHost` and the decode, `receive("host:1")` plays the old clip.
  - "a failed host list keeps the old one": `getJson` rejects, and `list()` is unchanged.
  - "calls while loading fold into one more": three `loadHost` calls while the first is in flight give `getJson` calls of exactly 2.
  - "tap sends a host id": `tap("host:1")` gives `"sent"`.
- [ ] **Step 3: Write the failing view test** in `sound-board.test.ts`: "host tiles follow the others". `soundBoardModel(room({ ..., hostSounds: true }), ...)` with free and host sounds gives tiles in list order. (The model needs no change. This pins the order through the view.)
- [ ] **Step 4: Run and check they fail.** Run: `pnpm vitest run apps/web/test/sounds apps/web/test/sound-board.test.ts`. Expected: FAIL.
- [ ] **Step 5: Implement** `packs.ts`, `board.ts`, `onOpen` and the `room.ts` wiring, as in Interfaces. Update the docs line.
- [ ] **Step 6: Run and check they pass.** Run the Step 4 command, then `pnpm test` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 7: Commit** "Room: host sounds on the sound board".

### Task 6: Phone-side processing and the lazy mp3 encoder

**Files:**
- Create: `apps/web/src/sounds/process.ts` (pure), `apps/web/src/sounds/encode.ts` (decode and encode, browser and Node)
- Modify: `apps/web/package.json` (`"wasm-media-encoders": "0.7.0"` exactly, `"@games/sounds"` is already there; then `pnpm install`)
- Test: `apps/web/test/sounds/process.test.ts` (new), `apps/web/test/sounds/lazy.test.ts` (new)

**Interfaces:**
- Consumes: `readMp3` from `@games/sounds/mp3`, `HOST_SOUND_MAX_BYTES` and `MAX_SOUND_MS` from `@games/sounds/check` (tests only for `readMp3`).
- Produces (`process.ts`, no DOM and no encoder import):
  - `SAMPLE_RATE = 48000`, `HOST_CUT_S = 2.9`, `MAX_INPUT_BYTES = 4 * 1024 * 1024`, `TARGET_RMS_DB = -16`, `PEAK_DB = -1.5`, `MAX_GAIN_DB = 24`, `SILENT_RMS = 1e-4`.
  - Copy constants: `TOO_LONG = "This sound is too long. We will keep 3 seconds."`, `NOT_A_SOUND = "This file is not a sound we can use."`, `TOO_BIG = "This file is too big. Pick a file under 4 MB."`.
  - `checkInput(file: { size: number }): string | null`: gives `TOO_BIG` over `MAX_INPUT_BYTES`, `NOT_A_SOUND` for size 0, and `null` otherwise.
  - `toMono(channels: readonly Float32Array[]): Float32Array`: the mean of the channels, sample by sample (shortest length).
  - `clipWindow(lengthS: number, startS: number): { start: number; duration: number; cut: boolean }`. `cut` is `lengthS > HOST_CUT_S`. `start` is clamped to `0..max(0, lengthS - HOST_CUT_S)` and rounded to 0.1 s. `duration` is `min(lengthS, HOST_CUT_S)`.
  - `evenLoudness(samples: Float32Array): Float32Array`: a new array. `gain = min(10^((TARGET_RMS_DB - rmsDb)/20), 10^(PEAK_DB/20) / peak, 10^(MAX_GAIN_DB/20))`. When the RMS is below `SILENT_RMS`, the gain is 1.
  - `interface PreparedClip { samples: Float32Array; sampleRate: number; ms: number; cut: boolean }`.
  - `prepareClip(input: { channels: readonly Float32Array[]; sampleRate: number }, startS: number): PreparedClip`: mono, then `clipWindow`, then `evenLoudness`. `ms = round(samples.length / sampleRate * 1000)`.
  - `defaultName(fileName: string): string`: drops the last extension, turns `_` and `-` runs into spaces, trims, and cuts at 24 characters. `"air_horn-2.mp3"` gives `"air horn 2"`.
- Produces (`encode.ts`, the only importer of `wasm-media-encoders`):
  - `decodeFile(bytes: ArrayBuffer): Promise<{ channels: Float32Array[]; sampleRate: number } | null>`. It uses `new OfflineAudioContext(1, 1, SAMPLE_RATE).decodeAudioData(bytes)` and copies each channel. Any throw or rejection gives `null`.
  - `encodeMp3(clip: PreparedClip): Promise<Uint8Array>`. It calls `createMp3Encoder()` (the build with the wasm inlined, so no extra URL), then `configure({ channels: 1, sampleRate: clip.sampleRate, bitrate: 64 })`. It encodes in chunks of 4608 samples, copies each output view (`slice()`, since the encoder reuses its memory), then `finalize()`, then joins the chunks. Check the 0.7.0 README for the option names. If `bitrate` is not offered for mp3, use the nearest CBR or VBR option that keeps the Step 1 size test true.

- [ ] **Step 1: Write the failing tests** in `process.test.ts` (make the sample buffers with `Float32Array` sines and noise in the test):
  - "checkInput refuses a file over 4 MB": 0 gives `NOT_A_SOUND`. `4 * 1024 * 1024 + 1` gives `TOO_BIG`. 1000 gives `null`.
  - "toMono averages the channels": `[1, 1]` and `[0, -1]` give `[0.5, 0]`.
  - "clipWindow": `(10, 4)` gives `{ start: 4, duration: 2.9, cut: true }`. `(10, 9.5)` gives start `7.1`. `(2, 1)` gives `{ start: 0, duration: 2, cut: false }`. `(10, -3)` gives start 0.
  - "prepareClip keeps at most 2.9 s from the start picked": 10 s of stereo at 48 kHz, start 4. The length is `2.9 * 48000`, `sampleRate` is 48000, `ms` is 2900, `cut` is `true`. The first sample matches the gain times the mean of the input at `4 * 48000`.
  - "prepareClip of a long input still gives at most 2.9 s": 30 s of mono at 48000 gives `ms <= 2900`.
  - "evenLoudness lifts a quiet clip to the target": a sine with RMS -40 dBFS comes out within 0.5 dB of -16 dBFS RMS, or at `MAX_GAIN_DB`, whichever is lower.
  - "never goes over the peak limit": a square wave at 0.99 comes out with peak at most `10^(-1.5/20)` + 1e-6.
  - "gain is at most +24 dB": RMS -60 dBFS noise comes out within 0.5 dB of -36 dBFS.
  - "a silent clip stays silent": zeros stay zeros, and no value is NaN.
  - "defaultName": `"air_horn-2.mp3"` gives `"air horn 2"`. `"a".repeat(40) + ".wav"` gives 24 characters. `".mp3"` gives `""`.
  - "the real encoder makes a mono mp3 under the caps": `encodeMp3(prepareClip(<10 s sine at 48 kHz>, 0))`. Its bytes length is at most `HOST_SOUND_MAX_BYTES`, and `readMp3(bytes)` gives `mono: true`, `sampleRate: 48000` and `ms <= MAX_SOUND_MS`. This is spec section 7's "output is mono, at most 3 s, under the size cap".
- [ ] **Step 2: Write the failing guard test** in `lazy.test.ts`: "the encoder loads only with My sounds". `import.meta.glob("../../src/**/*.ts", { query: "?raw", import: "default", eager: true })`. The files whose text has `from "wasm-media-encoders"` (or `import("wasm-media-encoders")`) are exactly `../../src/sounds/encode.ts`. The files that import `encode.ts` statically are exactly `../../src/views/my-sounds.ts`. No file imports `views/my-sounds.ts` statically. Only `import("./my-sounds.ts")` (or `"./views/my-sounds.ts"`) is allowed. (This fails until Task 8 adds `my-sounds.ts`. Write it here, mark the last two checks `it.todo`, and turn them on in Task 8.)
- [ ] **Step 3: Run and check they fail.** Run: `pnpm vitest run apps/web/test/sounds/process.test.ts apps/web/test/sounds/lazy.test.ts`. Expected: FAIL.
- [ ] **Step 4: Add the dependency and implement** `process.ts` and `encode.ts`. At the top of `encode.ts`, add a comment: "The mp3 encoder is LAME (LGPL-2.0) built to WebAssembly by wasm-media-encoders (MIT). It loads only in its own lazy chunk."
- [ ] **Step 5: Run and check they pass.** Run the Step 3 command, then `pnpm typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** "Web: phone-side sound processing and the lazy mp3 encoder".

### Task 7: The library client and the shell's `soundsAuth`

**Files:**
- Create: `apps/web/src/sounds/library.ts`
- Modify: `apps/web/src/shell.ts` (`ShellOptions.soundsAuth`, defaults)
- Test: `apps/web/test/sounds/library.test.ts` (new), `apps/web/test/shell.test.ts` (extend)

**Interfaces:**
- Consumes: the `MySoundsBody` shape (Task 3). `isHostSlot`, `HOST_SLOTS` from `@games/sounds/check`. `isSameOriginPath` (Task 5).
- Produces (`shell.ts`): `ShellOptions.soundsAuth?: () => Record<string, string> | null` ("Headers for the host's own sounds API, or null when this phone cannot have any. Default: the owner key as a bearer token, or null without one. A host app with a sign-in cookie passes `() => ({})`."). The default reads `getOwnerKey()` at call time.
- Produces (`library.ts`):
  - `interface LibrarySlot { id: string; name: string; ms: number; url: string }`. `interface Library { active: boolean; slots: LibrarySlot[] }`.
  - `type LibraryResult = { ok: true; library: Library } | { ok: false; error: string }`.
  - `SAVE_FAILED = "Could not save. Try again."`.
  - `parseLibrary(body: unknown): Library | null`. It needs a boolean `active`. Slots are kept only with `isHostSlot(id)`, a good name and ms, and a same-origin `url` that starts with `/api/sounds/`. The result is sorted by id, with at most 6.
  - `class LibraryApi`, with these members:
    - `constructor(deps: { fetch: typeof fetch; headers: () => Record<string, string> | null })`.
    - `get(): Promise<Library | null>`. `null` when `headers()` is null (no fetch then), when the answer is not 200, or on a network failure.
    - `save(slot: string, bytes: Uint8Array, name: string): Promise<LibraryResult>`. A PUT to `/api/sounds/${slot}?name=${encodeURIComponent(name)}`, with `content-type: audio/mpeg`.
    - `rename(slot: string, name: string): Promise<LibraryResult>`. A PATCH with JSON.
    - `remove(slot: string): Promise<LibraryResult>`.
    - `bytes(url: string): Promise<ArrayBuffer | null>`, with the auth headers.
    - A write's error is the server's `{ error }` when there is one, else `SAVE_FAILED`.
  - `hasMySounds(api?: LibraryApi): Promise<boolean>`. It is memoised per page load and keyed on `JSON.stringify(headers())`. It gives true only when `get()` gives a library. `mySoundsApi(): LibraryApi` builds one from `fetch` and `shellConfig().soundsAuth`.

- [ ] **Step 1: Write the failing tests** in `library.test.ts` (a fake `fetch` that records calls):
  - "get sends the auth headers and parses the list": the request has `authorization: Bearer k`. The slots come back sorted.
  - "get asks nothing without auth": `headers: () => null` gives `null`, with 0 fetch calls.
  - "parseLibrary drops what is not safe": slot `"7"`, a url `/api/rooms/K7DX/sounds/1`, `//x.test`, `ms: 0`, and a missing `active` (which gives `null`).
  - "save sends the mp3 with its name": the method is PUT, the url is `/api/sounds/3?name=Air%20horn`, the content type is `audio/mpeg`, and the body is those bytes. A 200 gives `{ ok: true, library }`.
  - "a refused write gives the server's words": 422 `{ error: "This sound is too long. A sound can be 3 seconds at most." }` gives that error. A network throw gives `SAVE_FAILED`.
  - "hasMySounds asks once": two calls make 1 fetch. A 403 gives `false`.
- [ ] **Step 2: Extend `shell.test.ts`**: "soundsAuth defaults to the owner key". With no key it gives `null`. After the owner key is set it gives `{ authorization: "Bearer <key>" }`. A passed `() => ({})` is kept.
- [ ] **Step 3: Run and check they fail.** Run: `pnpm vitest run apps/web/test/sounds/library.test.ts apps/web/test/shell.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** `library.ts` and the shell option.
- [ ] **Step 5: Run and check they pass.** Run the Step 3 command, then `pnpm typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** "Web: host sound library client and soundsAuth".

### Task 8: The "My sounds" screen, its two entries, and docs

**Files:**
- Create: `apps/web/src/views/my-sounds-model.ts` (pure), `apps/web/src/views/my-sounds.ts` (DOM, lazy), `apps/web/src/views/my-sounds.css`
- Modify: `apps/web/src/views/home.ts` (`HomePart "my-sounds"`, `homeParts`, the button), `apps/web/src/views/room-menu.ts` (`"my-sounds"` item), `apps/web/src/views/room.ts` (menu action), `apps/web/src/brand.ts` (only if a new icon is used; text buttons are fine)
- Modify: `docs/games/rooms.md`
- Test: `apps/web/test/my-sounds.test.ts` (new), `apps/web/test/home-setup.test.ts`, `apps/web/test/room-menu.test.ts`, `apps/web/test/sounds/lazy.test.ts` (turn on the todos)

**Interfaces:**
- Consumes: `LibraryApi`, `Library`, `mySoundsApi`, `hasMySounds` (Task 7). `checkInput`, `prepareClip`, `clipWindow`, `defaultName`, `TOO_LONG`, `NOT_A_SOUND`, `HOST_CUT_S` (Task 6). `decodeFile`, `encodeMp3` (Task 6). `audio.unlock`, `audio.context`, `audio.playClip` from `@games/audio`. `cleanSoundName` from `@games/sounds/check`. `RoomView.refreshHostSounds` (Task 5).
- Produces (`my-sounds-model.ts`):
  - `MY_SOUNDS_COPY = { title: "My sounds", intro: "Your sounds play on the sound board in rooms you make. You can keep 6.", lapsed: "Get Host Pass to use these in your rooms.", lapsedAdd: "Get Host Pass to add sounds.", add: "Add a sound", play: "Play", rename: "Rename", replace: "Replace", remove: "Remove", removeAsk: "Remove this sound?", name: "Name", noName: "Give it a name.", save: "Save", saving: "Saving...", cancel: "Cancel", close: "Close", loadFailed: "Could not load your sounds. Try again." }`.
  - `type SlotAction = "add" | "play" | "rename" | "replace" | "remove"`.
  - `interface SlotRow { id: string; name: string | null; seconds: string | null; actions: SlotAction[] }`, where `seconds` is like `"2.4 s"`.
  - `mySoundsModel(lib: Library): { notes: string[]; rows: SlotRow[] }`. There are always 6 rows, ids `"1"`..`"6"`. With an active library: an empty row has `actions: ["add"]`, and a filled row has `["play", "rename", "replace", "remove"]`. With `!lib.active`: an empty row has `actions: []`, a filled row has `["play", "rename", "remove"]`, and `notes` is `[lapsed, lapsedAdd]`. Otherwise `notes` is `[]`.
  - `startLabel(startS: number): string` gives `` `Starts at ${startS.toFixed(1)} seconds` ``.
- Produces (`my-sounds.ts`):
  - `openMySounds(opts: { api: LibraryApi; onClose?(): void }): void`. It opens a full-screen `<dialog class="dialog my-sounds">` (aria-label "My sounds") and imports `./my-sounds.css`. It shows `loadFailed` with a **Close** button when `api.get()` gives `null`.
  - The add/replace flow: a hidden `<input type="file" accept="audio/*">`. Then `checkInput`, then read the bytes, then `decodeFile` (`null` shows `NOT_A_SOUND`). Then an edit panel with the **Name** field (default `defaultName(file.name)`), the start slider and `TOO_LONG` line when `clipWindow(...).cut`, and **Play**, **Save** and **Cancel**. **Save** checks `cleanSoundName` (`noName`), shows `saving` with the button disabled, calls `encodeMp3(prepareClip(...))` and then `api.save`, then shows the new list or the error line.
  - **Play** on a saved slot fetches through `api.bytes(url)`. It calls `audio.unlock()` on the tap, then decodes on `audio.context` and plays with `audio.playClip`.
  - **Rename** puts an inline Name field with **Save** and **Cancel** in the row. **Remove** shows `removeAsk` in the row with **Remove** (danger) and **Cancel**.
  - Escape and **Close** close the dialog and call `onClose`.
- `my-sounds.css`: rows stack at 360 px. A filled row is the name and seconds on top, then a 4-button row. Every button is at least 44 px high. The slider's thumb area is at least 40 px high. Under `prefers-reduced-motion` nothing moves.
- `home.ts`: `homeParts(isOwner: boolean, pitch: boolean, mySounds = false)` puts `"my-sounds"` right after `"create"` when `mySounds` is true. The part is a secondary button **My sounds** that calls `void import("./my-sounds.ts").then((m) => m.openMySounds({ api: mySoundsApi() }))`. `HomeView` calls `hasMySounds()` once in its constructor and re-renders when it gives true.
- `room-menu.ts`: `RoomMenuItem` gains `"my-sounds"`, label "My sounds". `roomMenuItems(..., o: { ...; mySounds?: boolean })` puts it right after `"settings"`, only for the host, only when `o.mySounds`, and never in `ended` (the early return stays).
- `room.ts`: on connect, start `hasMySounds()` and keep the answer in a field. Pass `mySounds` into `roomMenuItems`. The action does the same lazy import with `onClose: () => this.refreshHostSounds()`.
- `docs/games/rooms.md`:
  - The header paragraph: the menu also has **My sounds** for a host who has their own sound list.
  - A new `## My sounds` section after "Sound board": "**My sounds** is on the home page and in the menu, for a host who can keep their own sounds. You can keep 6. Tap **Add a sound** and pick a sound file from your phone. If it is longer than 3 seconds, we keep 3 seconds: move the slider to pick where they start, and tap **Play** to hear it. Give it a name and tap **Save**. Your phone makes the sound the same loudness as the others. Each sound has **Play**, **Rename**, **Replace** and **Remove**. Your sounds come after the free sounds on the sound board in every room you make. If you change one during a party, the others get it the next time they open the sound board. A file must be under 4 MB." On CouchParty (one line): "On CouchParty, My sounds needs Host Pass. If your Pass ends, your sounds are kept. You can still play, rename and remove them, but you cannot add new ones, and new rooms do not get them."

- [ ] **Step 1: Write the failing tests**:
  - `my-sounds.test.ts`, "six rows, add on empty ones": a library with slot 2 gives 6 rows, row 2 has `["play", "rename", "replace", "remove"]` and seconds `"2.4 s"`, and the others are `["add"]`.
  - "a lapsed library: no add or replace, two lines": `active: false` with slot 2 gives row 2 `["play", "rename", "remove"]`, the other rows `[]`, and `notes` equal to `["Get Host Pass to use these in your rooms.", "Get Host Pass to add sounds."]`. `active: true` gives `notes` `[]`.
  - "startLabel": `1.26` gives `"Starts at 1.3 seconds"`, and `0` gives `"Starts at 0.0 seconds"`.
  - "the copy is plain": every `MY_SOUNDS_COPY` value has no emoji and is at most 80 characters.
  - `home-setup.test.ts`, "My sounds follows Create for an owner who has sounds": `homeParts(true, false, true)` has `"my-sounds"` right after `"create"`. `homeParts(true, false)` and `homeParts(false, true, true)` have none. (A guest has no create, so no sounds.)
  - `room-menu.test.ts`, "My sounds for the host who owns sounds": a host in the lobby with `mySounds: true` gets `"my-sounds"` right after `"settings"`. A guest with `mySounds: true` does not. `ended` gives `["settings", "home"]`.
  - `lazy.test.ts`: turn on the two Task 6 todos.
- [ ] **Step 2: Run and check they fail.** Run: `pnpm vitest run apps/web/test/my-sounds.test.ts apps/web/test/home-setup.test.ts apps/web/test/room-menu.test.ts apps/web/test/sounds/lazy.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the model, the dialog, the CSS, the home part and the menu item, as in Interfaces. Update the docs.
- [ ] **Step 4: Run and check they pass.** Run the Step 2 command, `pnpm test`, `pnpm typecheck` and `pnpm build`. Expected: PASS. In `apps/web/dist/assets/`, `wasm-media-encoders` code (search for `lame` or `wasm`) is only in a chunk that the entry chunk does not import statically.
- [ ] **Step 5: Check in a browser** at 360x780. Run `pnpm dev` (local R2) and unlock with the owner key `dev`. **My sounds** shows on home. Add a long clip: the slider and the "too long" line show. **Play** plays the cut, and **Save** saves it. Create a room and open it in a second tab: the host tile is on the board, and a tap is heard in both tabs. Rename it in the room's **My sounds**. The second tab shows the new name the next time the board opens. A guest tab shows no **My sounds** in the menu.
- [ ] **Step 6: Commit** "Web: My sounds screen, home and menu entries".

### Task 9 (product branch): CouchParty host sounds

Run this only after `master` (Tasks 1 to 8) is merged into `product`. Work on the `product` branch, in `apps/product-*` only.

**Files:**
- Create: `apps/product-server/src/sounds.ts`
- Modify: `apps/product-server/src/rooms.ts` (`productPolicy.soundOwner`, the `canCreate` grant's `library`, `handleUpgrade` and the `UpgradeDeps.getRoom` type), `apps/product-server/src/auth.ts` (`DELETE /api/account`), `apps/product-server/wrangler.jsonc` (`r2_buckets`), the product's generated `worker-configuration.d.ts`
- Modify: `apps/product-web/src/play.ts` (`soundsAuth: () => ({})`)
- Test: `apps/product-server/test/sounds.test.ts` (new), `apps/product-server/test/rooms.test.ts`, `apps/product-server/test/auth.test.ts` (extend)

**Interfaces:**
- Consumes: `SoundOwner`, `HostPolicy.soundOwner`, `indexKey`, `LIBRARY_ID_RE` and `SoundsBucket` from `@games/server` (Tasks 3 and 4). `RoomBase.upgrade(hostKey, library)` (Task 2). `userWithTier` (existing).
- Produces:
  - `productSoundOwner(request: Request, env: ProductEnv, now: number): Promise<SoundOwner | null>`. A signed-in Pass user gives `{ library: user.id, active: true }`. A signed-in user without a Pass gives `{ library: user.id, active: false }` only when `env.SOUNDS.head(indexKey(user.id))` finds an index. Everyone else gives `null`.
  - `productPolicy(...).soundOwner = (req, env) => productSoundOwner(req, env as ProductEnv, deps.now())`. The Pass grant gains `library: user.id`, and the free grant gains `library: null`.
  - `handleUpgrade` calls `room.upgrade(body.hostKey, user.id)`. `UpgradeDeps.getRoom`'s type becomes `{ upgrade(hostKey: string, library?: string | null): Promise<boolean> }`.
  - `deleteLibrary(bucket: Pick<R2Bucket, "list" | "delete">, library: string): Promise<void>`. It lists `lib/<library>/` (following the cursor) and deletes those keys. `DELETE /api/account` calls it before the database batch. If it throws, the answer is 503 `{ error: "Could not delete your account. Try again." }` and nothing is removed from the database.
  - `wrangler.jsonc`: `{ "binding": "SOUNDS", "bucket_name": "couchparty-sounds" }` next to `BLIND_RALLY_GODOT`. Then `pnpm --filter @games/product-server types`.

- [ ] **Step 1: Write the failing tests**:
  - `sounds.test.ts`, "soundOwner": a Pass user gives `{ library: <id>, active: true }`. A free user with an index gives `active: false`. A free user with no index, and no cookie, give `null`.
  - "a lapsed host can open, rename and remove, but not add": the shared `serveMySounds` with `productPolicy` lists the saved slots with `active: false`. PATCH and DELETE work. PUT gives 403 "Get Host Pass to add sounds.".
  - `rooms.test.ts`, "a Pass room gets the host's library, a free room none": the fake `getRoom().claim` records the grants (`library: <user id>`, then `null`). Fix the existing fakes as `typecheck` asks.
  - `rooms.test.ts`, "upgrade passes the account's library": the fake `upgrade` gets `(hostKey, <user id>)`.
  - `auth.test.ts`, "deleting an account deletes its sounds": the keys under `lib/<id>/` are gone, and other libraries' keys stay. "a sounds delete failure keeps the account": the fake `delete` throws, the answer is 503, and the user row is still there.
- [ ] **Step 2: Run and check they fail.** Run: `pnpm vitest run apps/product-server/test`. Expected: FAIL.
- [ ] **Step 3: Implement** as in Interfaces. Add the binding, regenerate the types, and set `soundsAuth` in `play.ts`.
- [ ] **Step 4: Run and check they pass.** Run `pnpm test`, `pnpm typecheck` and `pnpm --filter @games/product-server exec wrangler deploy --dry-run` (local only). Expected: PASS, and the dry run lists `SOUNDS`.
- [ ] **Step 5: Commit** on `product`: "CouchParty: host sounds for Host Pass".

---

## Ship (not code; the user runs or approves these)

1. Create the party-games bucket: `party-games-sounds` (binding `SOUNDS` in `apps/server/wrangler.jsonc`). The user runs `pnpm --filter @games/server exec wrangler r2 bucket create party-games-sounds`, or approves it.
2. `pnpm deploy` for party-games. Check: **My sounds** on home with the owner key, a saved sound plays in a new room, and `/api/rooms/<code>/sounds` for a made-up code is a 404.
3. Merge `master` into `product` and do Task 9. Create `couchparty-sounds` (the user runs or approves `wrangler r2 bucket create couchparty-sounds` from `apps/product-server`). Deploy CouchParty.
4. Rooms made before this deploy have no library, so their phones show no host sounds. That is expected.

## Manual phone checklist

- [ ] Upload from a phone (Android Chrome and iPhone Safari): a long clip is cut to 3 seconds, the slider picks the start, and the saved sound plays at the same loudness as the free ones.
- [ ] Pick a 6-minute song over 4 MB: you see "This file is too big. Pick a file under 4 MB." straight away. Pick a PDF renamed to .mp3: you see "This file is not a sound we can use."
- [ ] A host tile tap on one phone sounds on the others within about a voice round-trip.
- [ ] Replace a slot mid-party: the other phones play the new sound after they next open the board.
- [ ] iPhone with the silent switch on: **Play** in My sounds and host tiles in the room behave like the free tiles.
- [ ] CouchParty: a free account sees no **My sounds**. A Pass account does. After the Pass ends (staging, by hand), **My sounds** opens with "Get Host Pass to use these in your rooms." and "Get Host Pass to add sounds.", shows no **Add a sound** or **Replace**, Rename and Remove still work, and a new room has no host tiles.
- [ ] CouchParty: delete a test account that has sounds. Its `lib/<id>/` keys are gone from `couchparty-sounds`.

## Self-review

- Spec coverage: 5.4 "Library owner" is Tasks 2, 3, 4 and 9 (`soundOwner`, `library` in the grant, stored at `claim`, `upgrade` with a library, the lapsed-Pass rules, signed-out and free hosts get nothing). "Storage" is Task 3 (the keys and the index). "API" is Tasks 3 and 4 (GET, PUT, PATCH, DELETE, the room file and list routes, the version cache). "Access to files" is Task 4 (the room code plus the room's own library, no public listing). "Phone-side processing" is Task 6 (decode, a 3 s start picker, mono, even loudness with a peak limit, the lazy encoder, the plain lines). "My sounds screen" is Task 8 (home and menu, 6 slots: add, rename, replace, remove, play). "Room board" is Tasks 2 and 5 (the library fixed at claim, the memory read, the list on open, host ids relayed, unknown ids ignored, changes on the next open). "Account removal" is Task 9. Section 7, step 2: the upload API tests are in Task 3. "The room file route refuses a room that does not use that library" is in Task 4. The phone processing unit test is in Task 6. The manual upload check is in the checklist. Section 8's copy is used exactly.
- Changes from the spec, on purpose: `soundOwner` gives `{ library, active }` instead of `string | null` (the lapsed line needs it), and `RoomGrant.library` is optional. Both are listed under Plan decisions.
- Names checked across tasks: `isHostSlot`, `cleanSoundName`, `HOST_SLOTS`, `HOST_SOUND_MAX_BYTES`, `readMp3`, `fakeMp3`, `onBoard(id, extraPacks, hostSounds)`, `RoomGrant.library`, `RoomData.library`, `library()`, `upgrade(hostKey, library)`, `hostSounds`, `SoundOwner`, `soundOwner`, `SoundsEnv`, `SoundsBucket`, `libKey`, `indexKey`, `readIndex`, `serveMySounds`, `serveRoomSounds`, `MySoundsBody`, `RoomSoundsBody`, `SoundSlotBody`, `hostSoundsUrl`, `parseHostList`, `loadHost`, `refreshHostSounds`, `prepareClip`, `clipWindow`, `evenLoudness`, `checkInput`, `decodeFile`, `encodeMp3`, `LibraryApi`, `parseLibrary`, `hasMySounds`, `mySoundsApi`, `soundsAuth`, `mySoundsModel`, `openMySounds`, `productSoundOwner`, `deleteLibrary`.
- Proportion: signatures, rules and test assertions. Bodies appear only for `readMp3`'s frame walk and the gain formula.

## Decided by the user 2026-11-24

1. **LGPL encoder:** fine on both sites. Keep `wasm-media-encoders@0.7.0`, with LAME (LGPL-2.0) in its own lazy file.
2. **Lapsed Pass:** view, play, rename and remove only. Adding or replacing needs an active Pass. The server refuses PUT for a lapsed library with "Get Host Pass to add sounds.", and the My sounds screen hides **Add a sound** and **Replace** and shows that line (Tasks 3, 8 and 9).
