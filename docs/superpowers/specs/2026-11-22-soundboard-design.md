# Soundboard, host sounds and signature sounds: design

Status: approved in conversation 2026-11-22.

## 1. Intent

Rooms get short, funny sounds, the way a Twitch stream lets viewers trigger effects. Players tap a sound and the whole room hears it. Hosts can make a room their own with sounds they upload. Later, each player can pick a signature sound that plays at their moments.

It is for a casual game night with friends (see the voice spec's "no anti-cheat" stance). Fun first, cheap to run, nothing that slows the games.

## 2. Goals, non-goals, anti-goals

Goals:
- A small board of default sounds anyone in a room can tap, heard by everyone in the room, in voice or not.
- Two packs: a `free` pack of free-to-use sounds (both sites) and a `memes` pack (party-games only).
- A repo command to add, list and remove default sounds.
- Hosts can upload up to 6 of their own sounds, saved to their account, shown on the board in rooms they create.
- Last: a signature sound per player, played when they join and when they win.

Non-goals:
- Sounds played through voice (WebRTC). Each phone plays its own copy of the file.
- Players (non-hosts) uploading sounds.
- A shared public sound library, search, or browsing other hosts' sounds.
- Moderation tooling beyond limits, type checks and the host's Remove.

Anti-goals (a failure even if it works):
- Meme-pack files reachable from couchpartygames.com (bundle or URL), or committed to the public `chakri68/party` repo.
- Sound spam that drowns the game or voice.
- Any frame-time cost in games when nobody taps a sound; any wait on the room's message queue for file work.
- Uploaded files reachable by people outside the rooms that use them.

## 3. Constraints

- AGENTS.md: shared code lands on `master`; CouchParty (`product` branch) adds only its own apps. The product imports `@games/web/shell` and the server's `createFetch` / `HostPolicy`, so everything shared plugs in through those seams.
- Player copy: short plain sentences, basic words, for ESL readers (Indian audience); no emoji; icons are SVG.
- Latency: a tap must sound on other phones as fast as a room message travels. Files are fetched and decoded before anyone taps (preload when the board's pack is known), not on tap.
- The room Durable Object never does file work inside `run()`. Uploads and file reads go straight to R2 from the Worker.
- Bump `PROTOCOL_VERSION` for new messages (11 today).
- Existing sound playback: `packages/audio` (shared AudioContext, `sounds/*.mp3`, unlock on first gesture, game sound volume). Reuse it.
- `ffmpeg`/`ffprobe` exist on the dev machine (for the repo command only; never on the server or phone).

## 4. Approaches

Delivery of a sound:
- **(Picked) A room message, each phone plays its own preloaded file.** Tiny, clear audio, works for people not in voice, no server audio work.
- Mix into the sender's voice stream. Rejected: only voice members hear, voice quality drops, the mic path gets more complex.

Pack split:
- **(Picked) Two packs, chosen by the user.** `free` everywhere, `memes` only on party-games. The command asks which pack.
- One pack everywhere. Rejected: a public product hosting film/TV/song clips invites takedowns.
- Memes on party-games only, no board on CouchParty. Rejected: CouchParty loses the feature.

Host sounds lifetime:
- **(Picked) Saved to the host's account, 6 slots.** On party-games the owner (owner key) is the only host; on CouchParty the signed-in account.
- Room-only, deleted when the party ends. Rejected by the user: hosts want their room to feel like theirs every time.

Upload processing:
- **(Picked) On the phone.** Decode with Web Audio, trim, even the loudness, encode small, then upload. The Worker cannot run ffmpeg.
- Server-side transcoding service. Rejected: cost and a new moving part.

## 5. Design

### 5.1 Default sounds (`packages/sounds`)

- A new package holds the `free` clips and their list, `sounds.json`: `{ id, name, file, ms, source, licence }`. Ids are short kebab-case and stable. They ship as Vite assets, like `packages/audio`'s sounds.
- Files: mono `.mp3`, at most 3 s, loudness evened (EBU R128, one target for all), small (aim under 40 KB).
- **The `memes` pack never enters git (user's call: the repo is public).** Its clips and its list (`memes/index.json`, same fields minus licence) live in a party-games-only R2 bucket (binding `MEMES`). The party-games Worker serves `GET /api/packs/memes` (the list) and `GET /api/packs/memes/<id>.mp3?v=` (long cache). The shell takes an option `extraPacks` (URLs of pack lists); party-games's `main.ts` sets it, the product never does and has no `MEMES` binding. Self-hosted copies (`scripts/host.mjs`) get only `free`.
- A test checks no `.mp3` under the repo other than `packages/audio` and `packages/sounds` free files listed in `sounds.json`, and that the product shell options never set `extraPacks`.
- The `free` pack starts with about 8 sounds from a clearly free source (CC0). Each entry records its source and licence in `sounds.json` (`source`, `licence`).

### 5.2 The repo command

- `pnpm sound add <file-or-url> --name "Bruh" --pack memes [--start 1.2] [--end 3.4] [--source <url>] [--licence <text>]`: downloads if it is a URL, trims (default: the first 3 s, or `--start`/`--end`), evens the loudness, encodes. For `free` it writes the file into `packages/sounds` and adds the entry (refuses without `--licence`). For `memes` it uploads the file and the updated `index.json` to the R2 bucket with `wrangler r2 object put` (remote), and writes nothing into the repo. Refuses if the result is longer than 3 s.
- `pnpm sound list [--pack ...]` and `pnpm sound remove <id>` (for memes, deletes from R2).
- Node script in the repo; uses `ffmpeg` from the PATH and says plainly if it is missing.

### 5.3 The board (step 1)

- A sound button in the room bar (next to the voice controls) opens a small grid: the room's sounds (defaults, then the host's, see 5.4). Each tile shows the name; a tap plays it for the room.
- Wire: client `{ type: "sound", id }`; server relays `{ type: "sound", id, by }` to every seat that is connected. The server checks the id is on the room's board, the host switch is on, and the rate limits; otherwise it drops it silently. It is not part of game state and does not bump the state version.
- Limits: 3 s cooldown per player (the server enforces it; the tile shows the cooldown); at most 3 sounds playing in the room at once (the server drops more inside a 3 s window).
- Host menu: "Sounds: on" / "Sounds: off" for the room. Off hides the board for everyone.
- Each phone: sounds follow the game sound volume, and turning game sound off silences room sounds too. A "Play sounds" switch in the room's sound settings dialog (`openSettings` in room.ts, reachable without voice) turns room sounds off just for this person. Saved per phone. (My call.)
- Sounds play over voice and game audio without ducking (ducking is a separate phase-3 item).

### 5.4 Host sounds (step 2)

- **Library owner.** `HostPolicy` gains `soundOwner(request, env): Promise<string | null>` (the library id for this request, or null). party-games: `"owner"` when the request carries the owner key. CouchParty: the signed-in account id, **only for Host Pass** (user's call). `canCreate`'s grant gains `library: string | null`, stored with the room, so the board in that room includes that library. Rules for CouchParty (my calls):
  - A room created by a signed-in Pass host gets their library at `claim`.
  - A room upgraded to Pass mid-party (`upgrade(hostKey)`) gets the upgrading account's library: the `upgrade` RPC gains a `library` argument. This is the one time a room's library changes after `claim`.
  - When a Pass lapses, saved sounds are kept. "My sounds" still opens, with the line "Get Host Pass to use these in your rooms." New rooms get no library. Nothing is deleted.
  - Signed-out or free-tier hosts see no "My sounds" and get only the default board.
- **Storage.** A new R2 bucket per site (binding `SOUNDS`). Keys `lib/<libraryId>/<slotId>.mp3` plus one `lib/<libraryId>/index.json` (slots: id, name, ms, version).
- **API** (Worker, outside the room DO):
  - `GET /api/sounds` (owner): the host's slots.
  - `PUT /api/sounds/<slot>` (owner): upload or replace; body is the processed mp3 plus name. Checks: owner, slot in 1..6, `audio/mpeg`, at most 64 KB, name 1..24 chars.
  - `PATCH` rename, `DELETE` remove.
  - `GET /api/rooms/<code>/sounds/<slot>?v=<version>`: the file, for people in that room. The room returns its library id; the Worker serves from R2 with a long cache keyed on version.
- **Access to files.** Someone needs the room code (and the room must exist and use that library) to fetch a file. That matches who can hear it anyway. No public listing.
- **Phone-side processing.** On upload: decode (`decodeAudioData`), take the chosen 3 s (a simple start picker with a preview), mono, even the loudness (RMS-based gain to the pack target, with a peak limit), encode to mp3 with a small bundled encoder loaded only on the "My sounds" screen. Show "This sound is too long. We will keep 3 seconds." and similar plain lines.
- **"My sounds" screen.** Reached from the home screen and the host menu, only for a library owner. 6 slots: add, rename, replace, remove, play.
- **Room board (my call).** The room records its library id at `claim` and never changes it. The Worker serves `GET /api/rooms/<code>/sounds`: it asks the room for its library id (a plain memory read, not queued), then returns the slot list from R2's `index.json`. The phone fetches this list when the board opens and preloads the files. The room accepts any `host:<1..6>` id for a room with a library and relays it; a phone ignores an id it does not have. The room never reads R2. A slot changed mid-party shows up on the next board open.
- **Account removal (CouchParty).** Deleting an account deletes its `lib/<id>/` keys. Product-only code.

### 5.5 Signature sounds (step 3, last)

- Each player picks one sound from the default packs in their seat settings. Saved per phone. (My call: not per library, so no account id reaches players.)
- Server-driven (my call): the phone sends its pick with `join`; the room stores it on the seat and plays it for the room when a new seat joins (not on reload or reconnect) and when they win a game (from the game's winners). Several winners play one after another, outside the room cap. Same host switch as the board. Steps 1 and 2 leave the `sound` relay shape so the room can also send one itself.
- Nothing before step 3 depends on it.

## 6. Delivery steps

1. Default board, two packs (incl. the `MEMES` bucket on party-games), repo command, host switch, per-phone switch. Ships alone.
2. Host sounds: `soundOwner`, R2, API, "My sounds", phone-side processing. Ships alone; needs the `SOUNDS` bucket on both workers.
3. Signature sounds.

Each step is its own plan and ship. The rest of phase 3 of the voice spec (host mute, mute all, ducking, polish) is a separate plan.

## 7. Acceptance tests

Automated:
- `sounds.json` entries valid: unique ids, files exist, `ms` at most 3000, `free` entries have a licence.
- Product build contains no `memes` file or id.
- Server: `sound` relayed to connected seats only; unknown id, host switch off, cooldown and room cap drop it; no state version change; `PROTOCOL_VERSION` bumped.
- Upload API: owner check, slot range, type and size checks, rename, delete; room file route refuses a room that does not use that library.
- Phone processing: output is mono, at most 3 s, under the size cap (unit test on a pure function over sample buffers).

Manual (phones):
- A tap on one phone sounds on the others within about a voice round-trip.
- Spam taps: cooldown shows, room never has more than 3 at once.
- iPhone with the silent switch on, and after a reload (audio unlock).
- Upload from a phone: a long clip is cut to 3 s and plays at an even volume.

## 8. Copy

Examples: "Sounds", "Play sounds", "Sounds: on", "Sounds: off", "My sounds", "Add a sound", "Replace", "Remove", "Name", "This sound is too long. We will keep 3 seconds.", "This file is not a sound we can use.", "Wait a moment before the next sound."

## 9. Left to the builder

Tile layout and icons; the exact loudness target; the mp3 encoder library (small, lazy-loaded); the start picker's look; cache headers; the exact place of the sound button in the bar.

## 10. Decisions after the builder check

- Meme files live in a private R2 bucket, never in git (user's call).
- "My sounds" on CouchParty is Host Pass only (user's call), with the rules in 5.4.
- The room list route, signature sounds being server-driven, and the "Play sounds" switch place are my calls, marked in place.
