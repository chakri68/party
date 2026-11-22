# Sound Board (Step 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anyone in a room can tap a short sound on a board and everyone in the room hears it. There are two packs: `free` (in git, on both sites) and `memes` (party-games only, in R2). The repo gets a `pnpm sound` command, the host gets a "Sounds: on/off" switch, and each phone gets a "Sound board" switch.

**Architecture:**
- A new package `packages/sounds` holds the free clips (`free/*.mp3`) and their list (`sounds.json`). The pack's rules live in one plain-JS file (`check.mjs`). The repo command and the tests both use it.
- On the wire, sound ids are `<pack>:<id>` (`free:rise`, `memes:bruh`). Protocol v12 adds a `sound` message from client to server. The server relays it as `{ type: "sound", id, by }` to every seated connection, the sender too. The relay works like `emote`: no version bump, no storage write. The room checks free ids against the bundled list. For packs it cannot list (memes), it checks only the shape of the id, and only when `RoomHost.soundPacks` names that pack. A phone ignores any id it does not have.
- The Worker serves `GET /api/packs/memes` (the list) and `GET /api/packs/memes/<id>.mp3` from an R2 bucket bound as `MEMES`. Only party-games binds it. CouchParty and self-hosted copies get 404s. The stock `main.ts` passes `extraPacks: ["/api/packs/memes"]` to the shell. The product never does.
- On the phone, a `SoundBoard` controller fetches every file when the room view opens. It decodes them once the shared AudioContext exists, so a tap or a received sound never waits on the network. Clips play through `packages/audio`'s master gain, so they follow game volume and game sound off.

**Tech Stack:** TypeScript, Cloudflare Workers + Durable Objects (partyserver) + R2, Vite (`import.meta.glob`), Vitest, Node 22 script with ffmpeg/ffprobe and wrangler.

**Spec:** docs/superpowers/specs/2026-11-22-soundboard-design.md (this plan is section 6 item 1: sections 5.1, 5.2 and 5.3, the step-1 lines of section 7, and section 8. Steps 2 and 3 are not here.)

## Global Constraints

- Bump `PROTOCOL_VERSION` from 11 to 12, in Task 3 only. Shape changes: `RoomPublicState.sounds`; the client messages `sound` and `room-sounds`; the server message `sound`.
- The `sound` relay shape is `{ type: "sound"; id: string; by: string | null }`. `null` is kept for spec 5.5, so the room can send a sound itself later. Step 1 never sends `null`.
- Limits (spec 5.3): one sound per seat per 3 s (`SOUND_COOLDOWN_MS = 3000`). At most 3 in the room inside any 3 s (`ROOM_SOUND_LIMIT = { burst: 3, windowMs: 3000 }`). Anything over a limit is dropped without a word.
- The room never does file work inside `run()` and never reads R2. A `sound` message writes nothing to storage and sends no `update`.
- Meme clips and their list never enter git. Do not add a meme clip or a real meme list to the repo. Tests use made-up ids like `bruh` and made-up bytes. The command writes meme files only to a temp dir and R2. The product never sets `extraPacks` and has no `MEMES` binding.
- Files: mono `.mp3`, at most 3000 ms, loudness evened with one EBU R128 target for all (`loudnorm=I=-16:TP=-1.5:LRA=11`), 64 kbps, under 40 KB.
- No frame-time cost when nobody taps. Nothing runs per frame and nothing polls. The tile cooldown is a CSS animation plus one `setTimeout` per tap.
- Player copy: short plain sentences, basic words, no idioms or slang, easy for Indian readers of English as a second language. No emoji anywhere (UI, docs, tests, commit messages). Icons are SVG in `apps/web/src/brand.ts`. Exact copy: "Sounds", "Sound board", "Sounds: on", "Sounds: off", "Wait a moment before the next sound.", "Sounds are off for everyone.", "Sounds are off on this phone. Turn them on in Settings.", "No sounds yet."
- Shared code lands on `master` only. Nothing here touches `product` or `apps/product-*`.
- Docs change in the same task as the behaviour they describe.
- Tests: `pnpm vitest run <file>` for one file, `pnpm test` for all, `pnpm typecheck` for types. Runtime tests use `apps/server/test/harness.ts` (`World`, `join`, `send`, `roomOf`). Script tests go in `apps/server/test/` and import from `../../../scripts/*.mjs` with a `.d.mts` beside the script, as `deploy.test.ts` does.
- Commit trailer, exactly:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01KwNUn8AHWzbftW559ZRTih

## Plan decisions (small, made here)

- **Ids** are `<pack>:<id>`. Pack names match `[a-z][a-z0-9-]{0,15}`. Sound ids are kebab-case (`[a-z0-9]+(-[a-z0-9]+)*`, at most 32 characters). `host` is kept back for step 2, and the room refuses it now.
- **Messages:** `{ type: "sound"; id }` and `{ type: "room-sounds"; on: boolean }` (host only, in lobby, playing or results, like `lock-room`). The switch is room state (`RoomPublicState.sounds`), so it goes through `commit`. A repeat of the same value sends nothing.
- **Echo to the sender:** the sender hears their sound when the server sends it back, as with emotes. A dropped sound is then silent for everyone, the sender too.
- **A drop still costs the seat its turn:** the seat check runs (and records) before the room check. Then a room-cap drop never uses up a room slot.
- **Client cooldown:** `SOUND_COOLDOWN_MS + COOLDOWN_SLACK_MS` (250 ms). A tap that the tile allows is never dropped because of network jitter.
- **Board button:** in the room header, just before the emote button. It is a 2x2 tile icon (`sound-board`) with aria-label "Sounds". It shows once seated, in lobby, playing and results. When the host turns sounds off, it is hidden for everyone except the host.
- **Host switch:** the top row of the board panel, host only, so it works in every phase. When sounds are off, the host's panel shows the switch and "Sounds are off for everyone." and no tiles.
- **Cooldown on tiles:** after a tap, the grid gets a `cooling` class. Every tile dims and a thin bar under the grid shrinks over the cooldown (CSS `--cool` duration). A tap while it cools shows the toast "Wait a moment before the next sound." The panel stays open, like the emote bar.
- **Preload:** when the room view connects and **Sound board** is on (turning it on later starts the same load), it fetches the free list, then each `extraPacks` list in order, then every file's bytes. Each file is decoded once, as soon as `audio.context` exists (`audio.onContext`). A sound that arrives before its clip is decoded is skipped, never queued.
- **"Sound board"** is `FeedbackSettings.roomSounds` (default on, saved in `pg:feedback` with the other settings). In Settings it is greyed out while game **Sounds** is off, like Volume.
- **Memes in R2:** bucket `party-games-memes`, keys `memes/index.json` and `memes/<id>.mp3`. The index is `{ "sounds": [{ id, name, file, ms, source, v }] }`, where `v` is the first 10 hex of the mp3's sha256. The Worker turns it into `{ pack: "memes", sounds: [{ id, name, ms, url }] }`, with `url = /api/packs/memes/<id>.mp3?v=<v>`. Files get the long immutable cache. The list gets `public, max-age=60`.
- **`pnpm sound`:** `--pack` is optional. When it is missing and stdin is a TTY, the command asks (clack `select`). Otherwise it stops with "Say --pack free or --pack memes." `--local` targets `wrangler dev`'s local bucket instead of `--remote`. `--source` defaults to the input when the input is a URL, and is required otherwise. `--licence` is required for `free`. The cut is capped at 2.95 s, so mp3 padding never pushes a clip past 3000 ms.
- **Placeholder free pack:** 8 sounds made with ffmpeg's synthesisers and added through `pnpm sound add` itself: Rise, Drop, Boop, Ding, Whoosh, Buzz, Drum, Alarm. Source "made for this project", licence "CC0, made for this project". The user swaps in real CC0 clips later.

## Review Focus

1. **iPhone, before the first tap:** a phone that opened the room link gets sounds before any gesture has made the AudioContext. It must stay silent and throw nothing. After the first tap it must not play a burst of old sounds. It must play the next one. Pinned in Task 5: "a sound that comes before decode is skipped, not queued".
2. **Jitter at the cooldown edge:** a tap that lands exactly when the tile wakes up must not be dropped by the server. Pinned in Task 5: "the tile waits a little longer than the server".
3. **A broken or unsafe memes index** (hand-edited in R2: a bad id, ms 5000, no `v`, a URL to another host): the Worker drops the bad entries, and the phone drops anything that is not a same-origin path. Phones never fetch another host. Pinned in Task 4: "drops bad entries in the index", and in Task 5: "drops entries that are not safe".
4. **The host role moves while sounds are off:** the new host must see the switch and turn sounds back on, or the board is stuck off. Pinned in Task 3: "a new host can turn sounds back on".
5. **A spammer who reloads to beat the cooldown:** the per-seat and room limits sit in memory (`sendTimes`), keyed by seat id. A reload or a reconnect keeps the seat id, so the limit must still hold. (An eviction forgets the limits. That is fine, as it is for chat.) Pinned in Task 3: "a reconnect does not reset the cooldown".

---

### Task 1: The `packages/sounds` package

**Files:**
- Create: `packages/sounds/package.json`, `packages/sounds/tsconfig.json`, `packages/sounds/sounds.json`, `packages/sounds/check.mjs`, `packages/sounds/check.d.mts`, `packages/sounds/src/list.ts`, `packages/sounds/src/index.ts`
- Modify: `AGENTS.md` ("Where things live")
- Test: `packages/sounds/test/pack.test.ts`

**Interfaces:**
- Produces (`check.mjs`, typed in `check.d.mts`):
  - `SOUND_ID_RE: RegExp` = `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, `SOUND_ID_MAX = 32`, `MAX_SOUND_MS = 3000`, `SOUND_NAME_MAX = 24`.
  - `soundId(name: string): string`: lowercases, turns each run of non-`[a-z0-9]` into one `-`, trims dashes, and cuts at 32 with no trailing dash. It returns `""` when nothing is left.
  - `checkEntries(entries: unknown[], opts: { pack: "free" | "memes"; fileExists?: (file: string) => boolean }): string[]`: one plain line per problem, starting with the id (or `entry <n>`). The rules: unique ids that match `SOUND_ID_RE` and `SOUND_ID_MAX`; `name` 1..24 characters after trim, with no control characters; `file === \`${id}.mp3\``; `ms` an integer in 1..3000; `source` a non-empty string; for `free`, `licence` a non-empty string; for `memes`, `v` matches `/^[0-9a-f]{10}$/`; and `fileExists(file)` when it is given.
- Produces (`src/list.ts`, which is safe on the server: no Vite, no DOM): `interface FreeSound { id: string; name: string; file: string; ms: number; source: string; licence: string }`, `FREE_SOUNDS: readonly FreeSound[]` (from `../sounds.json`), `FREE_SOUND_IDS: ReadonlySet<string>`, and a re-export of `MAX_SOUND_MS` and `SOUND_NAME_MAX` from `../check.mjs`.
- Produces (`src/index.ts`, web only): everything in `list.ts`, plus `freeSoundUrl(file: string): string | null`. It uses `import.meta.glob<string>("../free/*.mp3", { eager: true, query: "?url", import: "default" })`, like `games/long-trail/client/scene/art.ts`.
- `package.json`: name `@games/sounds`. Exports: `"."` is `./src/index.ts`, `"./list"` is `./src/list.ts`, `"./check"` is `./check.mjs`. Add `typecheck` and `devDependencies: { "vite": "^8.3.0" }`. `tsconfig.json` is like `games/long-trail`'s (DOM lib, `types: ["vite/client"]`), plus `"resolveJsonModule": true`, and it includes `src` and `test`.
- `sounds.json` starts as `{ "sounds": [] }`, with a trailing newline. `free/` has no files until Task 2.

- [ ] **Step 1: Write the failing tests** in `pack.test.ts`:
  - "checkEntries accepts good entries": `checkEntries([{ id: "rise", name: "Rise", file: "rise.mp3", ms: 1200, source: "made for this project", licence: "CC0" }], { pack: "free" })` gives `[]`. The same entry for `memes`, with `v: "0123456789abcdef".slice(0, 10)` and no licence, also gives `[]`.
  - "checkEntries names each problem": each of the following gives exactly one problem, and the problem line contains the id: a duplicate id; the id `"Bad Id"`; `file: "other.mp3"`; `ms: 3001`; `ms: 0`; `ms: 1.5`; a free entry with no `licence`; a memes entry with `v: "xyz"`; `name: "x".repeat(25)`; and `fileExists: () => false`.
  - "soundId makes a kebab id": `"Bruh!"` gives `"bruh"`. `"Air Horn"` gives `"air-horn"`. `"  Wow  wow "` gives `"wow-wow"`. `"!!!"` gives `""`. A 40-letter name with spaces gives a result of at most 32 characters that does not end in `-`.
  - "sounds.json is valid": `checkEntries([...FREE_SOUNDS], { pack: "free", fileExists: (f) => existsSync(<pkg>/free/f) })` gives `[]`.
  - "every free file is listed and small": the set of `*.mp3` under `free/` (an empty set if the directory is missing) equals the set of `FREE_SOUNDS` files, and each file is at most `40 * 1024` bytes.
  - "no other .mp3 in the repo": run `git ls-files --cached --others --exclude-standard -- '*.mp3'` from the repo root (nested worktrees under `.claude/` are skipped). Every path is either `packages/audio/src/sounds/*.mp3` or `packages/sounds/free/<file>` for a listed file.
  - "freeSoundUrl knows only listed files": a string for each listed file, and `null` for `"nope.mp3"`.
- [ ] **Step 2: Run and check it fails.** Run: `pnpm vitest run packages/sounds/test/pack.test.ts`. Expected: FAIL (the module is not found).
- [ ] **Step 3: Create the package** as in Interfaces, then run `pnpm install` so the workspace link exists.
- [ ] **Step 4: AGENTS.md**, under "Where things live", after `packages/protocol`, add: "- `packages/sounds`: the free sound board pack: `sounds.json` plus `free/*.mp3`, CC0 only. Change it with `pnpm sound` (`scripts/sound.mjs`). The memes pack never enters git. It lives in the party-games R2 bucket `party-games-memes`."
- [ ] **Step 5: Run and check it passes.** Run the Step 2 command, then `pnpm typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** "Sounds: the free pack package".

### Task 2: The `pnpm sound` command and the placeholder free pack

**Files:**
- Create: `scripts/sound.mjs`, `scripts/sound.d.mts`
- Modify: `package.json` (root: `"sound": "node scripts/sound.mjs"`)
- Create (generated by the command): `packages/sounds/free/{rise,drop,boop,ding,whoosh,buzz,drum,alarm}.mp3`, and `packages/sounds/sounds.json` gets their entries
- Test: `apps/server/test/sound-command.test.ts`

**Interfaces:**
- Consumes: `soundId`, `checkEntries`, `MAX_SOUND_MS` from `packages/sounds/check.mjs` (a relative import).
- Produces (`scripts/sound.mjs`, typed in `sound.d.mts`):
  - `type Pack = "free" | "memes"`.
  - `type SoundCommand = { cmd: "add"; input: string; name: string; pack?: Pack; start?: number; end?: number; source?: string; licence?: string; local: boolean } | { cmd: "list"; pack?: Pack; local: boolean } | { cmd: "remove"; id: string; pack?: Pack; local: boolean } | { cmd: "help" }`.
  - `parseSoundArgs(argv: string[]): SoundCommand`. It uses `node:util` `parseArgs`. It throws `Error` with a plain message: "add needs a file or a link.", "add needs --name.", "--pack is free or memes.", "--start and --end are seconds, like 1.5.", "remove needs a sound id." With no args, or with `-h`, it gives `{ cmd: "help" }`.
  - `MAX_CUT_S = 2.95`. `cutWindow(start?: number, end?: number): { start: number; duration: number }`. The defaults are start 0 and duration `MAX_CUT_S`. It throws "--end must be after --start." when end <= start. It throws `That is ${(end - start).toFixed(1)} seconds. A sound can be 3 seconds at most.` when end - start > 3. Otherwise duration is `min(end - start, MAX_CUT_S)`.
  - `LOUDNESS = "loudnorm=I=-16:TP=-1.5:LRA=11"`. `ffmpegArgs(input: string, output: string, cut: { start: number; duration: number }): string[]` gives `-hide_banner -loglevel error -y -ss <start> -t <duration> -i <input> -ac 1 -ar 44100 -af <LOUDNESS> -c:a libmp3lame -b:a 64k <output>`.
  - `withEntry<T extends { id: string }>(list: T[], entry: T): T[]`. It throws `There is already a sound called ${id}.` `withoutEntry<T extends { id: string }>(list: T[], id: string): T[]`. It throws `There is no sound called ${id}.` Neither one changes its input.
  - `MEMES_BUCKET = "party-games-memes"`, `MEMES_PREFIX = "memes/"`.
  - `interface SoundIO { root: string; run(cmd: string, args: string[], opts?: { cwd?: string }): { status: number | null; stdout: string; stderr: string }; readFile(path: string): Uint8Array; writeFile(path: string, data: string | Uint8Array): void; remove(path: string): void; exists(path: string): boolean; tempDir(): string; download(url: string, to: string): Promise<void>; askPack(): Promise<Pack>; log(line: string): void }`. Wrangler is `io.run("wrangler", [...])`. The real IO turns that into `process.execPath apps/server/node_modules/wrangler/bin/wrangler.js ...` with `cwd: apps/server`, as `godot-upload.mjs` does.
  - `runSound(cmd: SoundCommand, io: SoundIO): Promise<void>`. The flow for `add`, in order: pick the pack (`cmd.pack ?? await io.askPack()`); check the source and licence; get the id from `soundId(name)` ("Pick a name with letters or numbers." if it is empty); check that ffmpeg is there (`run("ffmpeg", ["-version"])` with a status other than 0 gives "ffmpeg is not installed. Install it (it gives ffmpeg and ffprobe) and try again."); load the list; `withEntry` as an early duplicate check; download the input if it is a URL, or check that it exists; run ffmpeg into `tempDir()`; read the length with `ffprobe -v error -show_entries format=duration -of csv=p=0`, as `ms = round(s * 1000)` ("The sound is 3.2 seconds. A sound can be 3 seconds at most." when it is over `MAX_SOUND_MS`); run `checkEntries` on the new entry; then write. For free: `packages/sounds/free/<id>.mp3`, then `sounds.json` (`JSON.stringify({ sounds }, null, 2) + "\n"`). For memes: `v` = sha256(bytes) hex, first 10. Put `memes/<id>.mp3` (`--content-type audio/mpeg`) first, then `memes/index.json` (`--content-type application/json`, written to the temp dir first), each with `--remote` or `--local`. The memes list is read with `r2 object get <bucket>/memes/index.json --pipe`. A failure whose stderr matches `/specified key does not exist/i` means an empty list. Any other failure stops the command. `remove` for memes puts the index without the entry first, then deletes the mp3. `list` prints one line per sound: pack, id, name, seconds.
  - An `isMain()` guard (copy it from `deploy.mjs`) runs `runSound(parseSoundArgs(process.argv.slice(2)), realIO())`. A thrown message goes to stderr in plain words, with exit code 1.

- [ ] **Step 1: Write the failing tests** in `sound-command.test.ts`. They use a fake `SoundIO` that records `run` calls and `writeFile` paths. Its fake ffprobe prints `"1.2\n"` unless a test sets something else. `root` is `/repo` and `tempDir()` is `/tmp/s`.
  - "parses add with every flag": `["add", "a.wav", "--name", "Rise", "--pack", "free", "--start", "0.5", "--end", "2", "--source", "x", "--licence", "CC0", "--local"]` gives the full `add` object, with `start: 0.5`, `end: 2` and `local: true`.
  - "refuses bad args", with the exact messages listed in Interfaces: no input, no `--name`, `--pack wav`, `--start abc`, `remove` with no id.
  - "cutWindow": `cutWindow()` gives `{ start: 0, duration: 2.95 }`. `cutWindow(1, 2.5)` gives `{ start: 1, duration: 1.5 }`. `cutWindow(1, 4)` gives `{ start: 1, duration: 2.95 }`. `cutWindow(1, 5)` throws "That is 4.0 seconds. A sound can be 3 seconds at most." `cutWindow(2, 2)` throws "--end must be after --start."
  - "ffmpeg makes mono, loudness-evened 64k mp3": the args contain, in order, `"-ac", "1"`, `"-af", LOUDNESS`, `"-b:a", "64k"`, and `"-t", "2.95"` for the default cut.
  - "withEntry and withoutEntry refuse and do not change the list".
  - "free add writes the file and the list, and never calls wrangler": the writes are exactly `/repo/packages/sounds/free/rise.mp3`, then `/repo/packages/sounds/sounds.json`. The JSON has `{ id: "rise", name: "Rise", file: "rise.mp3", ms: 1200, source: "x", licence: "CC0" }`. No `run` call has `cmd === "wrangler"`.
  - "free add needs a licence": it throws "A free sound needs --licence." before any `run` call.
  - "memes add uploads and writes nothing in the repo": the wrangler calls, in order, are `r2 object get party-games-memes/memes/index.json --pipe --remote` (fake stderr "The specified key does not exist."), then `r2 object put party-games-memes/memes/bruh.mp3 --file /tmp/s/bruh.mp3 --content-type audio/mpeg --remote`, then `r2 object put party-games-memes/memes/index.json ...`. No `writeFile` path starts with `/repo`. The uploaded index entry has a 10-hex `v`.
  - "memes add with --local uses --local": no call contains `--remote`.
  - "a wrangler error that is not 'missing' stops the add": stderr "Authentication error" throws, and no put follows.
  - "refuses a result over 3 seconds": with ffprobe `"3.2"`, it throws "The sound is 3.2 seconds. A sound can be 3 seconds at most." Nothing is written or uploaded.
  - "says when ffmpeg is missing": a status of `null` for `ffmpeg -version` throws the ffmpeg message.
  - "memes remove writes the index first, then deletes the file".
  - "asks for the pack when --pack is missing": `askPack` is called once and its answer is used.
- [ ] **Step 2: Run and check it fails.** Run: `pnpm vitest run apps/server/test/sound-command.test.ts`. Expected: FAIL (the module is not found).
- [ ] **Step 3: Implement `scripts/sound.mjs` and `scripts/sound.d.mts`**, as in Interfaces, and add the root `sound` script. `realIO().askPack` uses `@clack/prompts` `select` (a root dependency already), with options "free: both sites, CC0 only" and "memes: party-games only, kept in R2". When `!process.stdin.isTTY`, it throws "Say --pack free or --pack memes."
- [ ] **Step 4: Run and check it passes.** Run the Step 2 command. Expected: PASS.
- [ ] **Step 5: Make the 8 placeholder sounds** in a scratch dir outside the repo (for example `$(mktemp -d)`). Each one uses ffmpeg's synthesisers:
  - rise: `-f lavfi -i "aevalsrc=sin(2*PI*(300*t+450*t*t)):s=44100:d=1.2"`
  - drop: `-f lavfi -i "aevalsrc=sin(2*PI*(1200*t-400*t*t)):s=44100:d=1.2"`
  - boop: `-f lavfi -i "sine=f=440:d=0.25" -af "afade=t=out:st=0.1:d=0.15"`
  - ding: `-f lavfi -i "sine=f=1320:d=1.5" -af "afade=t=out:st=0.05:d=1.4"`
  - whoosh: `-f lavfi -i "anoisesrc=d=0.8:c=pink:a=0.5" -af "afade=t=in:d=0.3,afade=t=out:st=0.4:d=0.4"`
  - buzz: `-f lavfi -i "sine=f=110:d=0.7" -af "aeval=sgn(val(0))*0.4"`
  - drum: `-f lavfi -i "aevalsrc=sin(2*PI*(90*t-60*t*t))*exp(-8*t):s=44100:d=0.5"`
  - alarm: `-f lavfi -i "aevalsrc=0.6*sin(2*PI*880*t)*lt(mod(t\,0.5)\,0.25)+0.6*sin(2*PI*660*t)*gte(mod(t\,0.5)\,0.25):s=44100:d=2"`

  Then, for each one: `pnpm sound add <dir>/<id>.wav --pack free --name <Name> --source "made for this project" --licence "CC0, made for this project"`. Expected: 8 "Added" lines, 8 files under `packages/sounds/free/`, each under 40 KB.
- [ ] **Step 6: Run the pack tests and the script tests.** Run: `pnpm vitest run packages/sounds/test/pack.test.ts apps/server/test/sound-command.test.ts`, then `pnpm sound list --pack free`. Expected: PASS, and 8 lines listed.
- [ ] **Step 7: Commit** "Sounds: pnpm sound and 8 placeholder free sounds".

### Task 3: Protocol v12 and the room relay and host switch (server)

**Files:**
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/test/voice.test.ts` (delete the `it("is version 11")` line only)
- Create: `apps/server/src/sounds.ts`
- Modify: `apps/server/package.json` (add `"@games/sounds": "workspace:*"`, then `pnpm install`)
- Modify: `apps/server/src/runtime.ts` (`RoomHost`, `RoomData`, `onSeatedMessage`, `publicState`, a new `relaySound`)
- Modify: `apps/server/test/harness.ts` (`World.soundPacks`)
- Modify: `packages/room-client/src/index.ts` (the `sound` event)
- Test: `packages/protocol/test/sound.test.ts` (new), `apps/server/test/sounds.test.ts` (new), `packages/room-client/test/voice-events.test.ts` (a new `describe`)

**Interfaces:**
- Consumes: `FREE_SOUND_IDS` from `@games/sounds/list` (Task 1).
- Produces (protocol):
  - `PROTOCOL_VERSION = 12`.
  - `SOUND_COOLDOWN_MS = 3000` ("One seat: one sound per this long. The tile shows it."). `ROOM_SOUND_LIMIT = { burst: 3, windowMs: 3000 }` ("The whole room: at most this many sounds in the window."). `SOUND_ID_MAX_LENGTH = 48`.
  - `isSoundId(v: unknown): v is string`: a string of at most 48 characters that matches `/^[a-z][a-z0-9-]{0,15}:[a-z0-9]+(?:-[a-z0-9]+)*$/`.
  - `RoomPublicState.sounds: boolean` ("The host's switch for the sound board. Off: the room drops every sound.").
  - `ClientMessage` gains `{ type: "sound"; id: string }` ("Plays a board sound for the room. Dropped without a word when not allowed.") and `{ type: "room-sounds"; on: boolean }` ("Host only, in the lobby, playing or results: the sound board on or off for everyone.").
  - `ServerMessage` gains `{ type: "sound"; id: string; by: string | null }` ("A board sound, for every seated connection, the sender too. `by` is null when the room sends one itself.").
  - `parseClientMessage`: `sound` needs `isSoundId(m.id)`. `room-sounds` needs a boolean `on`. Extra fields are dropped.
- Produces (server):
  - `apps/server/src/sounds.ts`: `onBoard(id: string, extraPacks: readonly string[]): boolean`. A `free:<x>` id is on the board when `FREE_SOUND_IDS.has(x)`. Any other `<pack>:<x>` is on the board when `extraPacks.includes(pack)` and the pack is not `free` or `host`. The caller has already checked the shape of the id.
  - `RoomHost.soundPacks?: readonly string[]` ("Packs besides free whose ids the room relays by shape. Their lists live outside the room. Absent: free only.").
  - `RoomData.soundsOff?: true` (optional: rooms stored before it have sounds on).
  - `private relaySound(id: string, by: string | null): void`: sends `{ type: "sound", id, by }` to each `liveConns()` entry that has a `state?.playerId`. Step 3 calls it with `null`.
  - `World.soundPacks: string[] = []`, passed through `host()`.
- Produces (room-client): `RoomClientEvents.sound: { id: string; by: string | null }`, and `case "sound": this.emit("sound", msg)`.

- [ ] **Step 1: Write the failing protocol tests** in `sound.test.ts`:
  - "is version 12": `expect(PROTOCOL_VERSION).toBe(12)`.
  - "parses sound": `{ type: "sound", id: "free:rise", x: 1 }` gives `{ type: "sound", id: "free:rise" }`. Each of these ids gives `null`: `"rise"`, `"Free:rise"`, `"free:"`, `":rise"`, `"free:Rise"`, `"free:a--b"`, `"a".repeat(17) + ":x"`, a 49-character id, and `7`.
  - "parses room-sounds": `{ type: "room-sounds", on: false }` parses. `on: "no"` and a missing `on` give `null`.
- [ ] **Step 2: Write the failing server tests** in `sounds.test.ts`. `onBoard` tests use `const FREE = [...FREE_SOUND_IDS][0]!`:
  - "onBoard": `free:${FREE}` is `true`. `free:nope` is `false`. `memes:bruh` is `false` with `[]` and `true` with `["memes"]`. `host:1` is `false` even with `["host"]`. `free:${FREE}` stays `true` with `["free"]`.
  - `describe("sound board")`. It uses the toy games from `bot-toy.ts`, as `voice.test.ts` does: host `a`, plus `b` and `c`, and `const sound = (cn, id = \`free:${FREE}\`) => send(room, cn, { type: "sound", id })`.
    - "relays to every seated connection, the sender too": after `sound(a)`, both `a.last("sound")` and `b.last("sound")` equal `{ type: "sound", id: \`free:${FREE}\`, by: idOf(a) }`. A connection that only sent `hello` gets none.
    - "is not room state": `stateVersion`, the update count and `world.puts` do not change after a relay.
    - "drops an id not on the board": `free:nope` and `memes:bruh` reach nobody. Then with `world.soundPacks = ["memes"]` set before `world.runtime(...)`, `memes:bruh` is relayed.
    - "one sound per seat every 3 seconds": two taps relay once. After `tick(SOUND_COOLDOWN_MS - 1)` a tap is dropped. After `tick(1)` a tap is relayed. `a.of("error")` does not grow.
    - "at most 3 in the room inside 3 seconds": with 4 seats each tapping at the same clock, exactly 3 relays. After `tick(ROOM_SOUND_LIMIT.windowMs)`, the fourth seat's tap is relayed.
    - "a reconnect does not reset the cooldown": `a` taps, disconnects, rejoins with its token, and taps again inside 3 s. Only one relay.
    - "sounds off": `b` sends `room-sounds false` and gets `not-host`. `a` sends it, and `roomOf(b).sounds` is `false` after exactly one update. Then a tap reaches nobody. A repeat `false` sends no update. `on: true` brings relays back.
    - "a new host can turn sounds back on": `a` turns sounds off, then `transfer-host b`, then `b` sends `room-sounds true`, and `roomOf(c).sounds` is `true`.
    - "starts on": a fresh claimed room has `roomOf(a).sounds === true`.
    - "works in a game": after `start-game`, a tap is relayed.
    - "an ended room drops sounds and refuses the switch": after `end-party`, a tap reaches nobody, and `room-sounds` gets `wrong-phase`.
- [ ] **Step 3: Write the failing room-client test** in `voice-events.test.ts`, `describe("RoomClient sound events")`: the socket receives `{ type: "sound", id: "free:rise", by: "p2" }`, and `client.on("sound")` gets exactly that.
- [ ] **Step 4: Run and check they fail.** Run: `pnpm vitest run packages/protocol/test apps/server/test/sounds.test.ts packages/room-client/test`. Expected: FAIL.
- [ ] **Step 5: Implement the protocol changes** in Interfaces, and delete `it("is version 11")` from `voice.test.ts`.
- [ ] **Step 6: Implement the runtime.**
  - `sound`: return at once when `data.phase === "ended"`, when `data.soundsOff`, or when `!onBoard(msg.id, this.host.soundPacks ?? [])`. Then `allow("sound", seat.id, { burst: 1, windowMs: SOUND_COOLDOWN_MS })`, then `allow("sound-room", "*", ROOM_SOUND_LIMIT)` (in this order: see the plan decisions). Then `relaySound(msg.id, seat.id)`. No `persist`, no `commit`.
  - `room-sounds`: `hostOnly()` and `inPhase("lobby", "playing", "results")`. Return when `!data.soundsOff === msg.on`. Otherwise set `data.soundsOff = true`, or delete it, and `commit([])`.
  - `publicState`: `sounds: !data.soundsOff`.
  - The harness: `soundPacks` on `World`, passed in `host()`.
- [ ] **Step 7: Implement the room-client event.**
- [ ] **Step 8: Run and check they pass.** Run the Step 4 command, then `pnpm test` and `pnpm typecheck`. Expected: PASS. If a web file builds a full `RoomPublicState` literal, `typecheck` names it. Add `sounds: true` there.
- [ ] **Step 9: Commit** "Room: protocol v12, sound relay and host switch".

### Task 4: The memes pack route and the `MEMES` bucket (Worker)

**Files:**
- Create: `apps/server/src/packs.ts`
- Modify: `apps/server/src/policy.ts` (`ServerEnv extends GodotEnv, PacksEnv`)
- Modify: `apps/server/src/worker.ts` (`createFetch` routes, the `RoomBase` host's `soundPacks`)
- Modify: `apps/server/wrangler.jsonc` (`r2_buckets`), `apps/server/worker-configuration.d.ts` (regenerated)
- Test: `apps/server/test/packs.test.ts` (new)

**Interfaces:**
- Consumes: `IMMUTABLE` from `./godot.ts`. `RoomHost.soundPacks` from Task 3.
- Produces:
  - `type PackBucket = Pick<R2Bucket, "get">`. `interface PacksEnv { MEMES?: PackBucket }`. `MEMES_PREFIX = "memes/"`.
  - `packListBody(index: unknown): { pack: "memes"; sounds: { id: string; name: string; ms: number; url: string }[] }`. It keeps only the entries that pass `checkEntries([entry], { pack: "memes" })` (from `@games/sounds/check`), in order, with the first copy of a repeated id kept. `url` is `` `/api/packs/memes/${id}.mp3?v=${v}` ``.
  - `servePacks(request: Request, env: PacksEnv): Promise<Response | null>`. It returns `null` outside `/api/packs/`. On `/api/packs/memes` it reads `memes/index.json` and answers with the JSON of `packListBody`, `content-type: application/json` and `cache-control: public, max-age=60`. On `/api/packs/memes/<id>.mp3`, where `<id>` matches `SOUND_ID_RE`, it serves `memes/<id>.mp3` with `content-type: audio/mpeg`, `cache-control: IMMUTABLE`, `etag` and `x-content-type-options: nosniff`. It answers 404 for: no `MEMES` binding, a missing object, an index that is not JSON, a bad id, or any other path under `/api/packs/`. It answers 405 with `allow: GET` for any method but GET.
  - `soundPacksFor(env: PacksEnv): string[]` gives `["memes"]` when `MEMES` is bound, and `[]` otherwise.
  - `createFetch`: `const packs = await servePacks(request, env); if (packs) return packs;` goes right before `serveGodot`. `RoomBase.runtime`'s host gets `soundPacks: soundPacksFor(this.env as ServerEnv)`. The product's `Room extends RoomBase` gets `[]` with no code change.
  - `wrangler.jsonc`: add `{ "binding": "MEMES", "bucket_name": "party-games-memes" }` to `r2_buckets`, with a comment: "The memes sound pack (party-games only, never in git). `pnpm sound add --pack memes` fills it. CouchParty and self-hosted copies have no MEMES, so /api/packs/memes is a 404 there." `/api/*` is already in `run_worker_first`. `scripts/host.mjs` already deletes `r2_buckets` for self-hosting, so leave it alone.

- [ ] **Step 1: Write the failing tests** in `packs.test.ts`. Use a small fake bucket with only `get(key)`, which returns `{ body, httpEtag, text() }` or `null` (see `godot.test.ts` for the shape). The index has `bruh` (good, `v: "0123456789"`), plus bad entries.
  - "lists the memes pack": 200, `content-type` `application/json`, `cache-control` `public, max-age=60`. The body equals `{ pack: "memes", sounds: [{ id: "bruh", name: "Bruh", ms: 1200, url: "/api/packs/memes/bruh.mp3?v=0123456789" }] }`.
  - "drops bad entries in the index": entries with id `"../x"`, `ms: 5000`, no `v`, and a second `bruh` are all left out. An index that is not JSON gives 404.
  - "serves a file with a long cache": `/api/packs/memes/bruh.mp3?v=0123456789` gives 200, `audio/mpeg`, `IMMUTABLE`, `nosniff`, and the same bytes.
  - "is a 404 without the MEMES binding": both routes, with `env = {}` (CouchParty, self-hosted).
  - "is a 404 for a bad id, a missing file or another path": `/api/packs/memes/BRUH.mp3`, `/api/packs/memes/..%2Fx.mp3`, `/api/packs/memes/nope.mp3`, `/api/packs/free`, `/api/packs/memes/bruh.ogg`.
  - "is a 405 for other methods": POST gives 405 with `allow: GET`.
  - "leaves other paths alone": `/api/rooms` gives `null`.
  - "createFetch routes it": `createFetch({ policy: ownerKeyPolicy, brand: "x" })` with `{ MEMES: bucket } as ServerEnv` lists the pack. This is the same setup as `policy.test.ts`.
  - "soundPacksFor": `{}` gives `[]`. `{ MEMES: bucket }` gives `["memes"]`.
- [ ] **Step 2: Run and check it fails.** Run: `pnpm vitest run apps/server/test/packs.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `packs.ts`, `ServerEnv`, the `createFetch` route and `RoomBase` `soundPacks`.** Add `"@games/sounds"` imports only through `@games/sounds/check` and `@games/sounds/list`, never `@games/sounds`, because the Worker cannot run `import.meta.glob`.
- [ ] **Step 4: Add the binding and regenerate the types.** Edit `wrangler.jsonc`, then run `pnpm --filter @games/server types`. Expected: `worker-configuration.d.ts` gains `MEMES: R2Bucket;`. If the regenerate also changes unrelated lines, keep only the `MEMES` line.
- [ ] **Step 5: Run and check it passes.** Run the Step 2 command, `pnpm test`, `pnpm typecheck`, and `pnpm --filter @games/server exec wrangler deploy --dry-run`. Expected: PASS, and the dry run lists the `MEMES` R2 binding.
- [ ] **Step 6: Commit** "Worker: memes pack route and MEMES bucket".

### Task 5: Playback, packs and the board controller (phone)

**Files:**
- Modify: `packages/audio/src/index.ts` (`FeedbackSettings`, export `Feedback`, `decode`, `playClip`)
- Create: `apps/web/src/sounds/packs.ts`, `apps/web/src/sounds/board.ts`
- Modify: `apps/web/package.json` (`"@games/sounds": "workspace:*"`, then `pnpm install`)
- Modify: `apps/web/src/shell.ts` (`ShellOptions.extraPacks`, defaults), `apps/web/src/main.ts`
- Test: `packages/audio/test/clip.test.ts` (new), `apps/web/test/sounds/packs.test.ts` (new), `apps/web/test/sounds/board.test.ts` (new)

**Interfaces:**
- Consumes: `FREE_SOUNDS` and `freeSoundUrl` from `@games/sounds`. `SOUND_COOLDOWN_MS`, `ClientMessage` and `isSoundId` from `@games/protocol`.
- Produces (audio):
  - `FeedbackSettings.roomSounds: boolean` ("Sound board sounds on this phone. Game sound off silences them too."). `DEFAULTS.roomSounds = true`.
  - `export class Feedback` (it was not exported before; `audio` stays the one instance).
  - `decode(bytes: ArrayBuffer): Promise<AudioBuffer | null>` gives `null` with no context, or when `decodeAudioData` rejects or throws.
  - `playClip(clip: AudioBuffer): boolean`. Returns `false`, and makes no node, when game sound is off, before unlock, or when the context is not `"running"`. Otherwise it plays one buffer source into `master` (so it follows the volume) at `currentTime + 0.005`, with no pitch change, and returns `true`.
- Produces (`apps/web/src/sounds/packs.ts`):
  - `interface BoardSound { id: string; name: string; ms: number; url: string }`, where `id` is the wire id (`free:rise`).
  - `MAX_PACK_SOUNDS = 60`.
  - `freeBoard(): BoardSound[]`: `FREE_SOUNDS` in order, ids prefixed with `free:`. Entries with no `freeSoundUrl` are skipped.
  - `parsePackList(body: unknown): BoardSound[]`. Bad input gives `[]`. `pack` must match `[a-z][a-z0-9-]{0,15}` and must not be `free` or `host`. An entry is kept only when `isSoundId(\`${pack}:${id}\`)` is true, `name` is a string of 1..24 characters after trim, `ms` is an integer in 1..3000, and `url` starts with `/` but not with `//`. Repeated ids are dropped, and the first `MAX_PACK_SOUNDS` are kept.
  - `loadExtraPacks(urls: readonly string[], getJson: (url: string) => Promise<unknown>): Promise<BoardSound[]>`: all the packs in `urls` order. A pack whose `getJson` rejects or gives `null` is skipped.
- Produces (`apps/web/src/sounds/board.ts`):
  - `COOLDOWN_SLACK_MS = 250`.
  - `interface SoundBoardDeps<Clip> { getJson(url: string): Promise<unknown>; getBytes(url: string): Promise<ArrayBuffer | null>; decode(bytes: ArrayBuffer): Promise<Clip | null>; play(clip: Clip): boolean; ready(): boolean; onReady(fn: () => void): () => void; enabled(): boolean; send(msg: ClientMessage): void; now(): number }`.
  - `class SoundBoard<Clip>`, with these members:
    - `constructor(deps: SoundBoardDeps<Clip>)` subscribes `onReady`.
    - `list(): readonly BoardSound[]`.
    - `onChange(fn: () => void): () => void`.
    - `load(extraPacks: readonly string[]): Promise<void>` sets the free board at once and tells listeners. Then it adds the extra packs and tells listeners again. Then it fetches every file's bytes. Each set of bytes is decoded once, when `ready()` is true or at the next `onReady`.
    - `tap(id: string): "sent" | "cooling" | "unknown"`. `sent` means it sent `{ type: "sound", id }` and the cooldown runs until `now() + SOUND_COOLDOWN_MS + COOLDOWN_SLACK_MS`.
    - `coolingMs(): number` is 0 when it is not cooling.
    - `receive(id: string): boolean` plays the decoded clip only when `enabled()`, and returns whether it played.
    - `destroy(): void`.
- Produces (shell): `ShellOptions.extraPacks?: string[]` ("URLs of extra sound pack lists, after the free pack. The stock app sets the memes pack. A host app leaves it out."). `defaults.extraPacks = []`. `main.ts` is `startShell({ extraPacks: ["/api/packs/memes"] })`.

- [ ] **Step 1: Write the failing audio tests** in `clip.test.ts`. Stub `globalThis.AudioContext` with a small fake class: `state`, `currentTime`, `destination`, `createGain`, `createBufferSource` (it records its `connect` targets and `start` calls), `decodeAudioData`, `resume`, and `addEventListener`. Also stub `fetch` to reject, so `unlock()`'s sample loading stays quiet. Use `vi.stubGlobal` and `vi.unstubAllGlobals`.
  - "roomSounds is on by default": `new Feedback().settings.roomSounds` is `true`.
  - "playClip plays through the game volume once unlocked": after `unlock()`, `playClip(buf)` gives `true`. The one source connects to the master gain (the gain whose value is `volume * 0.9`), and `start` was called once.
  - "playClip is silent before unlock, with game sound off, or while suspended": each case gives `false` and makes no source.
  - "decode gives null without a context or on a bad file".
- [ ] **Step 2: Write the failing pack tests** in `apps/web/test/sounds/packs.test.ts`:
  - "freeBoard lists every free sound": its length equals `FREE_SOUNDS.length`, every id starts with `free:`, and every `url` is a string.
  - "parsePackList keeps good entries with pack ids": `{ pack: "memes", sounds: [{ id: "bruh", name: "Bruh", ms: 1200, url: "/api/packs/memes/bruh.mp3?v=0123456789" }] }` gives one sound, with id `memes:bruh`.
  - "parsePackList drops entries that are not safe": the url `https://x.test/a.mp3`; the url `//x.test/a.mp3`; the id `"Bad"`; `ms: 0` and `ms: 3001`; a 25-character name; a repeated id; and a pack named `free` (which gives `[]`). Also `null` and `"text"` give `[]`.
  - "parsePackList keeps at most MAX_PACK_SOUNDS".
  - "loadExtraPacks keeps the order and skips a pack that fails".
  - "the shell has no extra packs by default": `configure({})`, then `shellConfig().extraPacks` equals `[]`.
  - "only the stock main.ts sets extra packs": `import.meta.glob("../../src/**/*.ts", { query: "?raw", import: "default", eager: true })`. The keys whose text matches `/extraPacks:\s*\[\s*["'\`]/` are exactly `["../../src/main.ts"]`. (On master this is as far as a test can go. The product's `play.ts` lives on the `product` branch. A matching check there belongs to that branch, and is listed under Ship.)
- [ ] **Step 3: Write the failing board tests** in `apps/web/test/sounds/board.test.ts`. The fake deps have a hand-moved clock and a `ready` flag with a list of `onReady` callbacks. `getJson` serves one extra pack. `getBytes` gives an `ArrayBuffer` per url. `decode` counts its calls and gives `{ url }`. `play` records its clips.
  - "loads free first, then the extra packs, and tells listeners": after `load(["/p"])`, `list()` is all `free:` ids followed by the `memes:` ids. `onChange` fired at least twice.
  - "fetches every file at load and decodes only once there is a context": while `ready` is false, decode count 0. After `ready = true` and the callbacks fire, the decode count equals the sound count. Firing again gives no new decodes.
  - "tap sends and starts the cooldown": `tap("free:rise")` gives `"sent"`, and `send` got `{ type: "sound", id: "free:rise" }`. A second tap gives `"cooling"`, with no second send.
  - "the tile waits a little longer than the server": right after a tap, `coolingMs()` is `SOUND_COOLDOWN_MS + COOLDOWN_SLACK_MS`. After the clock moves by that much, `coolingMs()` is 0 and `tap` gives `"sent"`.
  - "tap on an unknown id sends nothing": it gives `"unknown"`.
  - "receive plays a decoded clip": it gives `true`, and `play` got that clip.
  - "receive is silent when Sound board is off, or for an unknown id": it gives `false`.
  - "a sound that comes before decode is skipped, not queued": `receive` before `ready` gives `false`. After decode, `play` has 0 calls. A new `receive` plays.
  - "a failed fetch or decode leaves only that sound silent".
  - "destroy stops listening for the context".
- [ ] **Step 4: Run and check they fail.** Run: `pnpm vitest run packages/audio/test apps/web/test/sounds`. Expected: FAIL.
- [ ] **Step 5: Implement the audio changes, `packs.ts`, `board.ts`, the shell option and `main.ts`**, as in Interfaces.
- [ ] **Step 6: Run and check they pass.** Run the Step 4 command, plus `pnpm vitest run apps/web/test/shell.test.ts`, then `pnpm test` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 7: Commit** "Web: sound packs, board controller and clip playback".

### Task 6: The board in the room, the two switches, and docs

**Files:**
- Create: `apps/web/src/views/sound-board.ts`
- Modify: `apps/web/src/brand.ts` (the `sound-board` icon), `apps/web/src/views/room.ts` (`connect`, `renderHeader`, the `update` and `fatal` handlers, `destroy`, `openSettings`), `apps/web/src/style.css`
- Modify: `docs/games/rooms.md`
- Test: `apps/web/test/sound-board.test.ts` (new)

**Interfaces:**
- Consumes: Task 5's `SoundBoard`, `BoardSound` and `audio.settings.roomSounds`. Task 3's `RoomPublicState.sounds`, the `room-sounds` message and the client `sound` event.
- Produces:
  - `interface BoardModel { button: boolean; hostSwitch: { label: "Sounds: on" | "Sounds: off"; pressed: boolean; message: ClientMessage } | null; tiles: { id: string; name: string }[]; note: string | null }`.
  - `soundBoardModel(room: RoomPublicState, me: string, sounds: readonly BoardSound[], playHere: boolean): BoardModel`. `button` is `phase !== "ended" && (room.sounds || isHost)`. `hostSwitch` is shown to the host only: `pressed = room.sounds`, and `message = { type: "room-sounds", on: !room.sounds }`. `tiles` is empty when sounds are off. `note`, first match wins: sounds off and host gives "Sounds are off for everyone."; `!playHere` gives "Sounds are off on this phone. Turn them on in Settings."; no sounds gives "No sounds yet."; otherwise `null`.
  - `class SoundBoardView`, with these members:
    - `readonly wrap: HTMLElement`, a `span.sound-wrap` that holds the header button (`icon-btn`, aria-label "Sounds", `aria-expanded`) and a popover `div.sound-board` (`role="group"`, aria-label "Sounds", `hidden`) with the switch row, the note, `div.sound-tiles` and `div.sound-cool`.
    - `constructor(board: Pick<SoundBoard<unknown>, "list" | "onChange" | "tap" | "coolingMs">, opts: { send(msg: ClientMessage): void; toast(text: string): void; playHere(): boolean })`. These four members do not use `Clip`, so a `SoundBoard<AudioBuffer>` fits.
    - `render(room: RoomPublicState | null, me: string | null): void`. `null` hides everything.
    - `destroy(): void`.
    - A tile tap calls `board.tap(id)`. On `"cooling"` it calls `toast("Wait a moment before the next sound.")`. On `"sent"` it adds the `cooling` class, sets `--cool: <coolingMs>ms` on the grid, and removes the class in one `setTimeout`. Escape and a pointerdown outside close the panel, as in `Emotes`. Rebuild the tiles only when `board.onChange` fires or the list of tile ids changes.
  - `brand.ts`: `"sound-board"` is a 2x2 grid of rounded squares, for example `<rect x="4" y="4" width="7" height="7" rx="2"/>` four times, at (4,4), (13,4), (4,13) and (13,13).

- [ ] **Step 1: Write the failing model tests** in `sound-board.test.ts`. Build the room as `({ hostId, phase, sounds }) as RoomPublicState`, as `host-menu.test.ts` does.
  - "no button once the party has ended": for both the host and a guest.
  - "everyone has the button while sounds are on, and only the host when they are off".
  - "the host gets the switch": with sounds on, the label is "Sounds: on", `pressed` is true, and the message is `{ type: "room-sounds", on: false }`. With sounds off, the label is "Sounds: off", `pressed` is false, and `on` is true. A guest gets `null`.
  - "no tiles while sounds are off": also for the host.
  - "notes": the exact strings above, in the order given.
- [ ] **Step 2: Run and check it fails.** Run: `pnpm vitest run apps/web/test/sound-board.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `sound-board.ts`, the icon and the CSS.** The CSS goes next to `.emote-wrap`. Use `.sound-wrap`, and `.sound-board` positioned like `.emote-bar`. `.sound-tiles` is a 3-column grid with tiles at least 44 px high and a scroll at about 60vh. `.sound-tiles.cooling button` gets `opacity: .45`. `.sound-cool` is a 3 px bar that runs `scaleX(1 -> 0)` over `var(--cool)` while cooling, and does not move under `prefers-reduced-motion: reduce`.
- [ ] **Step 4: Wire it in `room.ts`.**
  - In `connect()`, after the emotes block: build `SoundBoard<AudioBuffer>`. Its deps: `getJson` and `getBytes` through `fetch` (with `res.ok` checks and `catch` giving `null`); `decode` through `audio.decode`; `play` through `audio.playClip`; `ready` is `() => !!audio.context`; `onReady` is `audio.onContext`; `enabled` is `() => audio.settings.roomSounds`; `send` goes through `client.send`; and `now` is `Date.now`. Then call `void board.load(shellConfig().extraPacks)`. Build the `SoundBoardView` with `toast: (t) => this.showToast(t)` and `playHere: () => audio.settings.roomSounds`. Add `client.on("sound", ({ id }) => board.receive(id))`.
  - In `renderHeader`, the seated group becomes `[this.soundView?.wrap, this.emotes?.wrap, this.chat?.button]`.
  - In the `update` handler, call `this.soundView?.render(u.room, client.playerId)`. In the `fatal` handler, call `render(null, null)`. In `destroy()`, destroy both the view and the board.
  - In `openSettings`, after Volume, add `h("label", {}, "Sound board", roomSounds)`. It is a checkbox bound to `audio.update({ roomSounds })`, greyed out while game Sounds is off (the same handler as `volume.disabled`). A change also calls `this.soundView?.render(this.last?.room ?? null, this.client?.playerId ?? null)`, so the board's note updates.
- [ ] **Step 5: Docs.** In `docs/games/rooms.md`:
  - Header line: "The header, always there, has the room code, a sound button, a sound board button, an emoji button and a chat button."
  - "What only the host can do" gets: "- **Sounds: off** at the top of the sound board turns the board off for everyone. Only the host still sees the board button, to turn it on again."
  - "Sound and vibration" gets: "- **Sound board**: sound board sounds on this phone. Greyed out when Sounds is off."
  - A new `## Sounds` section, after "Emotes": the board button (four squares) opens **Sounds**, a grid of short sounds. Tap one and everyone in the room hears it, in voice or not. You can tap one sound every 3 seconds. The tiles go dim until you can tap again, and an early tap says "Wait a moment before the next sound." The room plays at most 3 sounds in any 3 seconds, and the rest are skipped. Sounds follow your volume. If Sounds is off in Settings, you hear none. **Sound board** turns off only board sounds, on this phone. A self-hosted copy has only the free sounds.
- [ ] **Step 6: Run and check it passes.** Run the Step 2 command, `pnpm test`, `pnpm typecheck` and `pnpm build`. Expected: PASS. `apps/web/dist/assets/` has the 8 free sounds (or they are inlined), and nothing named after a meme.
- [ ] **Step 7: Check in a browser.** Run `pnpm dev` and open two tabs of one room. A tap in one is heard in both. A second tap within 3 s shows the toast. The host's **Sounds: off** hides the button in the guest tab. **Sound board** off silences only that tab. The memes list is a 404 locally (empty bucket), and the board still shows the free pack. To test memes locally, run `pnpm sound add <file> --pack memes --name Test --source x --local`, restart `pnpm dev`, and check that the tile appears.
- [ ] **Step 8: Commit** "Room: sound board, host switch and Sound board".

---

## Ship (not code; the user runs these)

1. Create the bucket once: `pnpm --filter @games/server exec wrangler r2 bucket create party-games-memes`.
2. Add meme clips: `pnpm sound add <file-or-url> --pack memes --name "..." [--start s --end s] [--source <url>]`. Check them with `pnpm sound list --pack memes`.
3. Replace the placeholder free sounds with real CC0 clips when ready: `pnpm sound remove <id> --pack free`, then `pnpm sound add <url> --pack free --name ... --licence "CC0 ..."`. Commit.
4. `pnpm deploy`.
5. Merge `master` into `product`. Run the product tests and typecheck. Do not add a `MEMES` binding there. Optional, on `product`: a test in `apps/product-web` that `play.ts` never says `extraPacks`. This is the half of the spec's "product never sets extraPacks" check that master cannot hold.

## Manual phone checklist

- [ ] A tap on one phone sounds on the others within about a voice round-trip, both in voice and out of it.
- [ ] Spam taps on two phones: the tiles dim, the toast shows, and the room never plays more than 3 at once.
- [ ] iPhone with the silent switch on, then after a reload: the first tap anywhere turns sound on, and no old sounds play in a burst.
- [ ] Game sound off in Settings silences board sounds. **Sound board** off silences only that phone. Volume changes board sounds too.
- [ ] Host **Sounds: off**: the guests lose the button. A new host (after Make host) can turn it back on.
- [ ] CouchParty staging after the product merge: the board shows only the free sounds, and `/api/packs/memes` is a 404.

## Self-review

- Spec coverage: 5.1 is Tasks 1, 4 and 5 (the package, the R2 route, `extraPacks`, the mp3 guard, the master half of the product check). 5.2 is Task 2. 5.3 is Tasks 3, 5 and 6 (the relay, the limits, the switches, the cooldown on tiles, playback through game volume, no ducking). 5.5's relay shape is pinned by `by: string | null` and `relaySound`. The section 7 automated tests for step 1 are in Tasks 1, 3 and 4. The upload and phone-processing tests in section 7 belong to step 2 and are left out.
- Names checked across tasks: `onBoard`, `soundPacks`, `soundPacksFor`, `relaySound`, `SOUND_COOLDOWN_MS`, `ROOM_SOUND_LIMIT`, `isSoundId`, `BoardSound`, `SoundBoard`, `COOLDOWN_SLACK_MS`, `soundBoardModel`, `SoundBoardView`, `roomSounds`, `playClip`, `decode`, `extraPacks`, `checkEntries`, `soundId`.
