# In-game focus mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the `playing` phase, the room's controls shrink to one slim header row plus a "..." Room menu, so the game gets the screen.

**Architecture:** Two pure models carry the decisions and are unit tested: `voiceBarModel` gains the in-game compact behaviour, and a new `roomMenuItems` lists the menu. `RoomView` (DOM glue in `apps/web/src/views/room.ts`) renders the slim header and the menu from them; `VoiceBar` exposes a header mic. Lobby and results are unchanged.

**Tech Stack:** TypeScript, plain DOM via `h()` from `@games/ui`, Vitest, CSS in `apps/web/src/style.css`.

**Spec:** `docs/superpowers/specs/2026-11-22-focus-mode-design.md`

## Global Constraints

- No behaviour changes, only layout (user's rule): every control does exactly what it does today, from a new place.
- Only the `playing` phase changes. Lobby, results, recap, chat panel, emote floats, sound board contents and game views stay as they are.
- In a game the header row is: room code, signal, then (right side) the mic only when in voice, chat, and the "..." button with aria-label "Room menu". No brand logo or wordmark in a game.
- Menu order: Sound board (only when `soundBoardModel(...).button`), Reactions, Join voice (out of voice, voice supported) or Voice (in voice), Sound and vibration settings, host only: Pause/Resume (pausable games), Restart, End game, then Home (a link to `shellConfig().brand.homeHref`, exactly what the header logo does today).
- Host actions keep today's confirms and messages: `pause-game {paused}`, `confirm("Restart this game for everyone?")` then `restart-game`, `confirm("End this game for everyone? Everyone goes back to the lobby.")` then `return-to-lobby`.
- Turn controls above the game keep only: the lost-connection line, "The game is paused.", Remind X, Skip X's turn, Remove X.
- "Tap to turn on sound" / "Tap to talk again." still show as a row under the header in a game when needed.
- Header fits a 360 px wide phone with every item present (host, in voice, board on).
- Player copy: short plain sentences for ESL readers. No emoji. SVG icons only.
- Space push-to-talk and Godot frame handling unchanged.

## Review Focus

1. Phase change while the menu or a panel opened from it is open (game ends, results appear): the menu closes, nothing floats over the new screen. Task 2 test: menu items for `results`/`lobby` are empty, and RoomView closes the menu dialog on phase change.
2. Voice status changes while in a game (joined then voice full, unsupported, leave): the header mic disappears and Join voice comes back in the menu. Task 1 test.
3. Push-to-talk hold on the header mic: holding must still talk, and a re-render must not swap the button under the finger. Task 1: the header mic is the same `this.mic` element moved, not a copy.
4. Host hands over host mid-game: host items appear for the new host and leave the old one. Task 2 test.
5. A game that is not pausable: no Pause item. Task 2 test.

---

### Task 1: Voice in a game: header mic, no voice row

**Files:**
- Modify: `apps/web/src/views/voice-bar.ts`
- Test: `apps/web/test/voice-bar.test.ts`

**Interfaces:**
- Produces: `BarModel.show` gains `"header"`: `voiceBarModel(v, "playing")` returns `"header"` when joined, `"hidden"` when not joined (any status). Other phases unchanged.
- Produces: `BarModel.micName: string`: the mic button's accessible name. In a game it folds the note in, e.g. muted gives `"Unmute. Muted: your mic is still on."`; no note gives the plain label.
- Produces on `VoiceBar`: `readonly headerMic: HTMLElement` (a wrapper holding the existing mic button and a small speaking/connection dot; RoomView places it in the header); `startJoin(): Promise<void>` made public (menu "Join voice"); `openPanel()` works in a game and the panel then also holds Hear no one and Voice settings (moved buttons, not copies), next to Turn off mic and Leave voice.
- Produces: `voiceMenuItem(v: VoiceView): "join" | "voice" | null`, exported from voice-bar.ts: `"voice"` when joined, `"join"` when not joined and status is not `unsupported`/`full`, else null.

- [ ] **Step 1: Write the failing tests** in `voice-bar.test.ts` (update the old in-game expectations at lines ~43, 48, 64, 76):
  - `in a game, out of voice: no row` — `voiceBarModel(view(), "playing").show === "hidden"`, same for `status: "full"` and `"unsupported"`.
  - `in a game, in voice: header mic` — `voiceBarModel(view({ status: "on", mic: "on" }), "playing").show === "header"`, `note === null`, `keepNoteRow === false`.
  - `in a game, the note goes in the mic name` — muted: `micName === "Unmute. Muted: your mic is still on."`; `mic: "on"`, mode toggle: `micName === "Mute"`.
  - `tap prompts still show in a game` — `status: "on", mic: "lost", needsSoundTap: true` in `"playing"`: `tapSound === true`, `show === "header"`.
  - `lobby is unchanged` — keep the existing lobby/results tests passing as they are.
  - `voiceMenuItem` — `{status:"off"}` -> `"join"`, `{status:"on"}` -> `"voice"`, `{status:"joining"}` -> `"voice"`, `{status:"full"}` -> null, `{status:"unsupported"}` -> null.
- [ ] **Step 2: Run** `pnpm vitest run apps/web/test/voice-bar.test.ts` from the repo root. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** In `sync()`, for `show === "header"`: the bar element shows only when `taps` is visible; `controls`, `note`, `join`, `peopleButton` hidden; set the mic's `aria-label` from `micName`. Move `this.mic` into `headerMic` while `phase === "playing"` and back into `controls` otherwise (same node, so a held press survives). In `openPanel` for a game, put `deafen` and `settingsButton` into the panel's action row; return them to `controls` when the dialog closes. The `openPanel` guard accepts `show === "header"` too.
- [ ] **Step 4: Run** the test file again, then `pnpm -r typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `Voice bar: header mic in games`.

### Task 2: Room menu and slim in-game header

**Files:**
- Create: `apps/web/src/views/room-menu.ts`
- Modify: `apps/web/src/views/room.ts` (`renderHeader`, `renderControls`, menu dialog), `apps/web/src/views/emotes.ts`, `apps/web/src/views/sound-board.ts` (only to let the panel open with the header button hidden), `apps/web/src/style.css`, `docs/games/rooms.md`
- Test: `apps/web/test/room-menu.test.ts`

**Interfaces:**
- Consumes: Task 1 `voiceMenuItem`, `VoiceBar.headerMic`, `VoiceBar.startJoin()`, `VoiceBar.openPanel()`; existing `Emotes.toggle(open)`, `SoundBoardView.toggle(open)`, `soundBoardModel(...).button`.
- Produces: `type RoomMenuItem = "sounds" | "reactions" | "join-voice" | "voice" | "settings" | "pause" | "resume" | "restart" | "end-game" | "home"` and `roomMenuItems(room: RoomPublicState, me: string, o: { board: boolean; voice: "join" | "voice" | null; pausable: boolean }): RoomMenuItem[]` in `room-menu.ts`, plus `ROOM_MENU_LABELS: Record<RoomMenuItem, string>` with: "Sound board", "Reactions", "Join voice", "Voice", "Sound and vibration", "Pause", "Resume", "Restart", "End game", "Home".

- [ ] **Step 1: Write the failing tests** in `room-menu.test.ts`:
  - `player menu in a game` — non-host, board true, voice "join": `["sounds","reactions","join-voice","settings","home"]`.
  - `host menu, pausable, paused` — host, `room.paused = true`, board true, voice "voice", pausable true: `["sounds","reactions","voice","settings","resume","restart","end-game","home"]`.
  - `no pause for a game without it` — host, pausable false: contains `"restart"`, not `"pause"`/`"resume"`.
  - `no board, no voice` — board false, voice null: `["reactions","settings","home"]`.
  - `host handover` — the same room with `hostId` changed from me to someone else drops `restart` and `end-game`.
  - `empty outside a game` — `phase: "lobby"` and `"results"` give `[]`.
- [ ] **Step 2: Run** `pnpm vitest run apps/web/test/room-menu.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `roomMenuItems`** per the Global Constraints order.
- [ ] **Step 4: Wire RoomView.** In `playing` with a seat: `renderHeader` renders room code, signal, `voiceBar.headerMic` (only when the model shows `"header"`), chat button, and a `.icon-btn` "Room menu" button (icon `more`); the brand, settings icon, board and emote buttons are not shown (their wraps stay in the DOM so their panels can open; hide only the buttons). The menu opens as a dialog list like the seat menu (`dialog-list`), each item a button that closes the menu then acts (board: `soundView.toggle(true)`; reactions: `emotes.toggle(true)`; join-voice: `voiceBar.startJoin()`; voice: `voiceBar.openPanel()`; settings: `openSettings()`; host items as in the constraints; home: an `<a href={homeHref}>` styled as a list item, same as the logo link). Close the menu dialog on any phase change. `renderControls` drops Pause/Resume, Restart and End game. Re-render the header when voice show changes (subscribe as the bar does) so the mic appears and goes.
- [ ] **Step 5: CSS.** The board and emote panels anchor under the header's right edge in a game. Check the 360 px header: measure in a Vitest-free way by reasoning on widths, and keep every in-game header item at the existing `.icon-btn` size with the existing 8 px gap under 400 px.
- [ ] **Step 6: Docs.** `docs/games/rooms.md`: say that in a game the room's buttons are in the menu (the three dots at the top right): sound board, reactions, voice, sound settings, and for the host Pause, Restart and End game. Fix the "Mid-game" host line (~75), the Sound board line (~133, "in the header" becomes "in the menu during a game"), and the voice lines (~155, ~165): in a game Join voice is in the menu, and once in voice the mic button is at the top; the menu's Voice item shows everyone in voice, Hear no one and voice settings.
- [ ] **Step 7: Run** `pnpm -r typecheck` and `pnpm vitest run apps/web`. Expected: PASS.
- [ ] **Step 8: Commit** `Room: in-game focus mode with a room menu`.
