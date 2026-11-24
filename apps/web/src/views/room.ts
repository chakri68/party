import { audio } from "@games/audio";
import {
  isValidRoomCode,
  normalizeName,
  normalizeRoomCode,
  NUDGE_AFTER_MS,
  SKIP_AFTER_MS,
  type RoomPhase,
  type RoomPublicState,
} from "@games/protocol";
import { RoomClient, type RoomUpdate } from "@games/room-client";
import { avatar, botTag, cancelConfirm, closeOnBackdrop, confirmDialog, h, openDialog, replaceChildren, seatName, type ConfirmOptions, type GameView, updateConfirm, type View } from "@games/ui";
import { brandMark, icon } from "../brand.ts";
import { GAME_SECTIONS, games } from "../games.ts";
import { getIdentity, getResumeToken, setDisplayName, setResumeToken } from "../identity.ts";
import { appTitle, navigate } from "../router.ts";
import { shellConfig } from "../shell.ts";
import { signalMeter } from "../signal.ts";
import { canTransition, transition } from "../transition.ts";
import { RoomChat } from "./chat.ts";
import { resultHeadline } from "./headline.ts";
import { closedView, recapView } from "./recap.ts";
import { TurnSignal } from "./turn.ts";
import { Emotes } from "./emotes.ts";
import { SoundBoardView } from "./sound-board.ts";
import { SoundBoard } from "../sounds/board.ts";
import { fetchListJson, hostSoundsUrl } from "../sounds/packs.ts";
import { hasMySounds, mySoundsApi } from "../sounds/library.ts";
import { MY_SOUNDS_COPY } from "./my-sounds-model.ts";
import { identityField, nameInput } from "./home.ts";
import { leaveQuestion, seatActionMessage, seatActions } from "./host-menu.ts";
import { lobbyAction, settingsSummary, settingsWarnings, watchBarHeight } from "./lobby.ts";
import { slimHeader } from "./focus.ts";
import { lockGame } from "./pause.ts";
import { ROOM_MENU_LABELS, roomMenuItems, type RoomMenuItem } from "./room-menu.ts";
import { VoiceBar, voiceMenuItem } from "./voice-bar.ts";
import { Mic, Playback, type VoiceElement } from "../voice/audio.ts";
import { MeshTransport } from "../voice/mesh.ts";
import { voicePrefs } from "../voice/prefs.ts";
import { PushToTalk } from "../voice/ptt.ts";
import { VoiceController } from "../voice/voice.ts";

const STUCK_AFTER_MS = 15_000;

const FATAL_COPY: Record<string, string> = {
  "room-not-found": "This room does not exist. Maybe everyone left, so the room closed.",
  "room-full": "This room is full.",
  "game-in-progress": "A game is already going on. You can join after this round.",
  "replaced-by-new-connection": "This room is open in another tab.",
  "protocol-mismatch": "There is a new version. Refresh the page to keep playing.",
  "room-locked": "The host locked this room.",
  removed: "The host removed you from this room.",
};

/**
 * replaceChildren, except children already in place stay put. Moving an
 * element through the DOM resets its scroll (and a game's chat log with it)
 * even when it lands right back where it was.
 */
function arrange(parent: Element, ...nodes: (Node | null)[]): void {
  const want = nodes.filter((n): n is Node => n !== null);
  for (const child of [...parent.childNodes]) if (!want.includes(child)) child.remove();
  let at = parent.firstChild;
  for (const node of want) {
    if (node === at) at = at.nextSibling;
    else parent.insertBefore(node, at);
  }
}

/** The room's own screens: moving between two of them scrolls to the top. */
const ROOM_SCREENS = new Set<string | null>(["lobby", "playing", "results", "ended"]);

/** How many players back each game, from the seats still here. */
function suggestionCounts(room: RoomPublicState): Map<string, number> {
  const counts = new Map<string, number>();
  for (const s of room.seats) {
    if (s.suggestion && s.presence !== "left") counts.set(s.suggestion, (counts.get(s.suggestion) ?? 0) + 1);
  }
  return counts;
}

function wantLabel(n: number): string {
  return n === 1 ? "1 wants this" : `${n} want this`;
}

/**
 * The game's word on why this table can't start (a role deck one card short).
 * It explains a disabled Start, so it sits where the host is looking. In the
 * lobby the host reads it in the Start bar instead.
 */
function setupProblem(room: RoomPublicState, style?: string): HTMLElement | null {
  return room.setupProblem ? h("p", { class: "setting-problem", role: "status", style }, room.setupProblem) : null;
}

export class RoomView implements View {
  private code: string;
  private root = h("main", { class: "room" });
  private header = h("header", { class: "room-header" });
  /**
   * The header's rebuilt parts, around the voice mic (on a room screen, in voice).
   * The mic sits between them and is never re-inserted, so a held talk press
   * survives a header update. Both parts are `display: contents`: their
   * children lay out as the header's own.
   */
  private headerStart = h("span", { class: "header-part" });
  private headerEnd = h("span", { class: "header-part header-end" });
  /** The phase the header and voice bar show; it trails the room on the results delay. */
  private shownPhase: RoomPhase | null = null;
  /** Stops the lobby bar's height watch (lobby.ts). */
  private stopLobbyBar: (() => void) | null = null;
  private menuDialog: HTMLDialogElement | null = null;
  /** Kept, not rebuilt: panels opened from the menu hand focus back to it. */
  private menuButton = h("button", { type: "button", class: "icon-btn room-menu-button", "aria-label": "Room menu", "aria-haspopup": "dialog", onclick: () => this.openMenu() }, icon("more"));
  private body = h("div", { class: "room-body" });
  private toast = h("div", { class: "toast", role: "alert" });

  private client: RoomClient | null = null;
  private last: RoomUpdate | null = null;
  /** Keeps an open game list in step with the room while it's up. */
  private refreshGameList: ((room: RoomPublicState) => void) | null = null;
  private gameView: GameView | null = null;
  private gameViewFor: string | null = null;
  /** The view has had its first update, so stream data has something to land on. */
  private gameViewFed = false;
  /** Stream data that beat that first update: the view's code loads lazily. */
  private streamBacklog: { from: string; data: unknown }[] = [];
  private gameHost = h("div", { class: "game-host" });
  private controls = h("div", { class: "turn-controls", "aria-live": "polite" });
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  /** Re-checks the nudge/skip thresholds while a game runs (§12.2). */
  private ticker: ReturnType<typeof setInterval> | undefined;
  /** Fires if we've been trying to reconnect for too long (§36). */
  private stuckTimer: ReturnType<typeof setTimeout> | undefined;
  private stuck = false;
  private detachDebug: (() => void) | null = null;
  /** The dev panel's bug button, once loaded: the header's last item. */
  private debugToggle: HTMLElement | null = null;
  /** Which screen the body shows, so we know when a change deserves motion. */
  private screen: string | null = null;
  private chat: RoomChat | null = null;
  private signal = signalMeter();
  private turn = new TurnSignal(
    () => `${this.code} · ${appTitle()}`,
    // A screen change about to land counts as in view: show() is about to
    // scroll to the top, but the turn is worked out before that.
    () => this.screen !== this.last?.room.phase || this.header.getBoundingClientRect().bottom > 0,
  );
  /** What the game said about whose turn it is; `undefined` until it says anything. */
  private gameTurn: string | null | undefined = undefined;
  private emotes: Emotes | null = null;
  private board: SoundBoard<AudioBuffer> | null = null;
  private soundView: SoundBoardView | null = null;
  /** Lists the host's sounds again, when the room has some and Sound board is on here. */
  refreshHostSounds: () => void = () => {};
  /** This phone owns a sound library, so the host gets My sounds in the menu. */
  private mySounds = false;
  private gone = false;
  /** Closes an open My sounds dialog. */
  private closeMySounds: (() => void) | null = null;
  /** Room voice: built once per RoomView, so game switches never touch it. */
  private voice: VoiceController | null = null;
  private playback: Playback | null = null;
  private ptt: PushToTalk | null = null;
  private voiceBar: VoiceBar | null = null;
  private unwatchFrames: (() => void) | null = null;

  constructor(params: Record<string, string>) {
    this.code = normalizeRoomCode(params.code ?? "");
  }

  mount(container: HTMLElement) {
    this.header.append(this.headerStart, this.headerEnd);
    this.root.append(this.header, this.body, this.toast, this.pauseNote);
    this.turn.mount(this.root);
    container.append(this.root);

    if (!isValidRoomCode(this.code)) return this.showMessage("That isn't a room code.");
    if (this.code !== location.pathname.split("/")[2]) {
      // Tidy lower-case links to the canonical URL.
      history.replaceState(null, "", location.pathname.replace(/[^/]+$/, this.code) + location.search);
    }
    document.title = `${this.code} · ${appTitle()}`;
    this.renderHeader();
    if (getIdentity().displayName) this.connect();
    else this.askName();
  }

  update() {}

  destroy() {
    clearTimeout(this.toastTimer);
    clearTimeout(this.stuckTimer);
    clearInterval(this.ticker);
    this.detachDebug?.();
    this.menuDialog?.close();
    this.gone = true;
    // Before the board goes: closing calls refreshHostSounds.
    this.closeMySounds?.();
    cancelConfirm();
    this.voice?.stop();
    this.unwatchFrames?.();
    this.stopLobbyBar?.();
    this.ptt?.destroy();
    this.voiceBar?.destroy();
    this.playback?.destroy();
    this.chat?.destroy();
    this.emotes?.destroy();
    this.soundView?.destroy();
    this.board?.destroy();
    this.client?.close();
    this.gameView?.destroy();
    this.turn.destroy();
    this.root.remove();
  }

  /**
   * Every body swap goes through here. A new screen gets a view transition;
   * the lobby also animates its own updates (only named blocks move). The
   * first screen doesn't: it's already inside the router's page transition.
   */
  private show(screen: string, body: () => void | Promise<void>) {
    const was = this.screen;
    // Stopped inside the swap, so a queued lobby swap that runs first cannot leave a watcher on a detached bar.
    const update =
      screen === "lobby"
        ? body
        : () => {
            this.stopLobbyBar?.();
            this.stopLobbyBar = null;
            return body();
          };
    const first = was === null;
    const kind = screen !== was ? "phase" : screen === "lobby" ? "lobby" : null;
    this.screen = screen;
    if (first || !kind) return void update();
    // A new room screen opens at its top (the game's header, phase and timer),
    // not at the old one's scroll. Only between room screens: back from a
    // reconnect or "connecting" keeps the place. Inside the swap, so the
    // transition's "after" picture is the top. Same-screen updates keep the scroll.
    const toTop = kind === "phase" && ROOM_SCREENS.has(was) && ROOM_SCREENS.has(screen);
    transition(kind, toTop ? () => (scrollTo({ top: 0, behavior: "instant" }), update()) : update);
  }

  /** The round on screen, so a restart (same screen, new round) opens at the top too. */
  private shownRound: number | null = null;

  // ---- connection ---------------------------------------------------------

  private askName() {
    const input = nameInput("");
    const form = h(
      "form",
      { class: "ask-name" },
      h("h2", {}, `Joining ${this.code}`),
      identityField(input),
      h("button", { type: "submit", class: "primary" }, "Join"),
    );
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const n = normalizeName(input.value);
      if (!n) return input.focus();
      setDisplayName(n);
      this.connect();
    });
    this.show("ask-name", () => replaceChildren(this.body, form));
    input.focus();
  }

  /**
   * Voice for this RoomView, before the client's first welcome or voice-state.
   * Voice code catches its own errors; this only builds browser objects.
   */
  private startVoice() {
    if (this.voice) return;
    const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    const rtcSupported = typeof RTCPeerConnection !== "undefined" && !!media?.getUserMedia;
    const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    const clock = {
      now: () => Date.now(),
      setTimeout: (fn: () => void, ms: number) => window.setTimeout(fn, ms),
      clearTimeout: (id: number) => window.clearTimeout(id),
    };
    const playback = new Playback({
      context: () => audio.context,
      onContext: (fn) => audio.onContext(fn),
      createElement: () => document.createElement("audio") as VoiceElement,
      unlock: () => audio.unlock(),
    });
    const voice = new VoiceController({
      code: this.code,
      send: (msg) => this.client?.send(msg),
      selfId: () => this.client?.playerId ?? null,
      rtcSupported,
      createTransport: (deps) => new MeshTransport({ ...deps, createPeer: (config) => new RTCPeerConnection(config), clock }),
      mic: new Mic(rtcSupported ? (c) => media!.getUserMedia(c) : null, isIOS, { context: () => audio.context }),
      playback,
      prefs: voicePrefs(),
      micPermission: async () => {
        try {
          const status = await navigator.permissions?.query({ name: "microphone" as PermissionName });
          return status?.state ?? "unknown";
        } catch {
          return "unknown";
        }
      },
      newSession: () => crypto.randomUUID().slice(0, 12),
      clock,
      toast: (text) => this.showToast(text),
    });
    const ptt = new PushToTalk((held) => voice.setPtt(held));
    ptt.attach(window);
    // Godot frames (Treasure Hunt, Blind Rally) catch Space too, with no change to their bridges.
    this.unwatchFrames = ptt.watchFrames(this.gameHost);
    const bar = new VoiceBar(voice, ptt, (id) => (this.last ? seatName(this.last.room, id) : "Someone"));
    // Above the body and outside the game host: game swaps never move it.
    this.header.after(bar.el);
    // Once, in its own slot: renderHeader rebuilds only the parts around it.
    this.headerStart.after(bar.headerMic);
    this.playback = playback;
    this.voice = voice;
    this.ptt = ptt;
    this.voiceBar = bar;
  }

  private connect() {
    void hasMySounds().then((yes) => (this.mySounds = yes));
    const me = getIdentity();
    this.show("connecting", () => replaceChildren(this.body, h("p", { class: "muted center" }, "Connecting…")));
    this.startVoice();
    const voice = this.voice!;
    const client = new RoomClient({
      code: this.code,
      name: me.displayName,
      avatarSeed: me.avatarSeed,
      getResumeToken: () => getResumeToken(this.code),
      getOwnerKey: () => shellConfig().hostKeyFor(this.code),
    });
    this.client = client;

    const chat = new RoomChat({
      send: (text) => client.send({ type: "chat", text }),
      react: (messageId, emoji) => client.send({ type: "react", messageId, emoji }),
      me: () => client.playerId,
      nameOf: (id) => (this.last ? seatName(this.last.room, id) : "Someone"),
      peek: (m) => this.showToast(`${m.name}: ${m.text}`),
    });
    this.chat = chat;
    this.root.append(chat.panel);
    client.on("chat", ({ messages, replace }) => chat.receive(messages, replace));

    const emotes = new Emotes({
      send: (emoji) => client.send({ type: "emote", emoji }),
      me: () => client.playerId,
      nameOf: (id) => (this.last ? seatName(this.last.room, id) : "Someone"),
    });
    this.emotes = emotes;
    this.root.append(emotes.layer);
    client.on("emote", ({ from, emoji }) => emotes.show(from, emoji));

    const board = new SoundBoard<AudioBuffer>({
      // A 404 gives null; offline or a 5xx rejects, and the board keeps what it has.
      getJson: (url) => fetchListJson(url),
      getBytes: (url) => fetch(url).then((res) => (res.ok ? res.arrayBuffer() : null)).catch(() => null),
      decode: (bytes) => audio.decode(bytes),
      play: (clip) => audio.playClip(clip),
      // Never unlock here: the first tap anywhere does that.
      ready: () => !!audio.context,
      onReady: (fn) => audio.onContext(fn),
      enabled: () => audio.settings.roomSounds,
      send: (msg) => client.send(msg),
      now: Date.now,
    });
    this.board = board;
    // Sound board off: fetch nothing. Turning it on in Settings starts the load.
    if (audio.settings.roomSounds) void board.load(shellConfig().extraPacks);
    const code = this.code;
    const refreshHost = () => {
      const room = this.last?.room;
      if (room?.hostSounds && room.sounds && audio.settings.roomSounds) void board.loadHost(hostSoundsUrl(code));
    };
    this.refreshHostSounds = refreshHost;
    this.soundView = new SoundBoardView(board, {
      send: (msg) => client.send(msg),
      toast: (t) => this.showToast(t),
      playHere: () => audio.settings.sound && audio.settings.roomSounds,
      onOpen: refreshHost,
    });
    client.on("sound", ({ id }) => board.receive(id));

    client.on("latency", (ms) => this.signal.set(ms));
    client.on("status", (status) => {
      this.renderHeader();
      if (status === "open") {
        clearTimeout(this.stuckTimer);
        this.stuckTimer = undefined;
        if (this.stuck) {
          this.stuck = false;
          this.render();
        }
      } else if (status !== "closed") {
        this.stuckTimer ??= setTimeout(() => this.showStuck(), STUCK_AFTER_MS);
      }
    });
    client.on("welcome", ({ resumeToken }) => {
      setResumeToken(this.code, resumeToken);
      this.renderHeader();
      voice.onWelcome();
    });
    client.on("voice-state", ({ members }) => voice.onVoiceState(members));
    client.on("voice-signal", ({ from, session, data }) => voice.onSignal(from, session, data));
    client.on("voice-ice", ({ iceServers, expiresAt }) => voice.onIce(iceServers, expiresAt));
    client.on("update", (u) => {
      const prev = this.last;
      this.last = u;
      // A snapshot already has everything the backlog would add.
      if (u.snapshot) this.streamBacklog = [];
      if (prev && prev.room.hostId !== client.playerId && u.room.hostId === client.playerId) {
        this.showToast("You're the host now.");
      } else if (prev?.room.phase === "playing" && u.room.phase === "lobby" && u.room.hostId !== client.playerId) {
        this.showToast(`${seatName(u.room, u.room.hostId)} ended the game.`);
      } else if (prev && u.room.hostId === client.playerId) {
        // The host hears about new suggestions; everyone else sees the counts.
        const fresh = u.room.seats.filter((s) =>
          s.id !== client.playerId && s.suggestion && s.suggestion !== prev.room.seats.find((p) => p.id === s.id)?.suggestion);
        const last = fresh.at(-1);
        if (last?.suggestion) this.showToast(`${last.name} wants ${games[last.suggestion]?.manifest.name ?? last.suggestion}.`);
      }
      // A restart keeps the phase and bumps the round: the game view starts fresh.
      if (prev?.room.phase === "playing" && u.room.phase === "playing" && prev.room.roundNumber !== u.room.roundNumber) {
        this.dropGameView();
        if (u.room.hostId !== client.playerId) this.showToast(`${seatName(u.room, u.room.hostId)} restarted the game.`);
      }
      // The menu was built for that phase and host: it goes, so it never sits over a new screen.
      if (prev && (prev.room.phase !== u.room.phase || (prev.room.hostId === client.playerId) !== (u.room.hostId === client.playerId))) {
        this.menuDialog?.close();
      }
      voice.onRoom(u.room);
      // The host's sounds came, or the host turned room sounds back on.
      if (u.room.hostSounds && u.room.sounds && !(prev?.room.hostSounds && prev.room.sounds)) refreshHost();
      this.soundView?.render(u.room, client.playerId);
      this.render();
      this.refreshGameList?.(u.room);
    });
    client.on("stream", (m) => {
      if (this.gameView && this.gameViewFed) this.gameView.stream?.(m.from, m.data);
      else if (this.last?.room.phase === "playing") this.streamBacklog.push(m);
    });
    client.on("rejected", ({ clientActionId, message, code }) => this.gameView?.rejected(clientActionId, message, code));
    client.on("error", ({ code, message }) => {
      voice.onError(code);
      this.showToast(code === "voice-full" ? "Voice is full." : message);
    });
    client.on("nudged", ({ byPlayerId }) => {
      const room = this.last?.room;
      this.showToast(`${room ? seatName(room, byPlayerId) : "Someone"} reminded you. It's your turn!`);
      audio.play("nudge");
      navigator.vibrate?.([80, 60, 80]);
    });
    client.on("fatal", ({ code, message }) => {
      // Another tab took over, removed, locked out: the mic goes off here.
      voice.stop();
      this.setPhase(null);
      this.soundView?.render(null, null);
      // A seat that no longer exists isn't worth resuming.
      if (code === "room-not-found" || code === "removed") setResumeToken(this.code, null);
      if (code === "room-not-found") return this.showClosed(FATAL_COPY[code]!);
      this.showMessage(FATAL_COPY[code] ?? message, code);
    });

    // Dev-only panel (§41). The DEV check is static, so production builds drop
    // the import entirely.
    if (import.meta.env.DEV) {
      void import("../debug.ts").then((m) => {
        if (this.client !== client) return;
        const debug = m.attachDebug(client, () => this.last);
        this.debugToggle = debug.toggle;
        this.detachDebug = debug.detach;
        this.renderHeader();
      });
    }
  }

  private showStuck() {
    this.stuck = true;
    // Its host items no longer reach the room.
    this.menuDialog?.close();
    cancelConfirm();
    const screen = h(
      "section",
      { class: "message" },
      h("p", {}, "Could not connect to the room again."),
      h("p", { class: "muted" }, "Still trying. Your seat is saved for one minute."),
      h("button", { type: "button", class: "primary", onclick: () => this.client?.reconnect() }, "Try again"),
      h("button", {
        type: "button",
        onclick: () => {
          // Leaving on purpose: voice is saved as off for this room.
          this.voice?.leave();
          this.client?.close();
          setResumeToken(this.code, null);
          navigate("/");
        },
      }, "Leave room"),
    );
    // Drop the game inside the swap, so the snapshot we animate from still has it.
    this.chat?.toggle(false);
    this.show("stuck", () => {
      this.dropGameView();
      replaceChildren(this.body, screen);
    });
  }

  /**
   * Asks in the page (see `confirmDialog`). True only for a yes while the
   * question still applies: `valid` is checked on every room update (a no
   * closes the question) and again on the yes. `retext`, if given, words the
   * question again on each update, so a detail (a name) stays true in place.
   */
  private async ask(text: string, opts: ConfirmOptions, valid: () => boolean, retext?: () => string | null): Promise<boolean> {
    const answer = confirmDialog(text, opts);
    const asking = { valid, retext };
    this.asking = asking;
    const yes = await answer;
    if (this.asking === asking) this.asking = null;
    return yes && valid();
  }

  /** The room's open question, if it asked one: its check and its rewording. */
  private asking: { valid: () => boolean; retext?: () => string | null } | null = null;

  private async leave() {
    const room = this.last?.room;
    const me = this.client?.playerId;
    if (!room || !me) return;
    const question = leaveQuestion(room, me);
    // Same screen, same role: the question still holds. Who gets the host role can change while it's open; the words follow.
    const still = () => this.last?.room.phase === room.phase && (this.last.room.hostId === me) === (room.hostId === me);
    const retext = () => (this.last ? leaveQuestion(this.last.room, me) : null);
    if (question && !(await this.ask(question, { ok: "Leave", danger: true }, still, retext))) {
      return;
    }
    // Leaving on purpose: voice is saved as off for this room.
    this.voice?.leave();
    this.client?.send({ type: "leave" });
    this.client?.close();
    setResumeToken(this.code, null);
    navigate("/");
  }

  // ---- rendering ----------------------------------------------------------

  /**
   * The header's two looks. On a room screen (lobby, game, results, party over; seated):
   * one slim row, the room code and signal on the left; the mic (in voice,
   * its own slot), the sound board (when it shows), reactions, chat and the
   * Room menu on the right. Otherwise (before a seat, a fatal message):
   * the brand, the room code and the room buttons.
   */
  private renderHeader() {
    const status = this.client?.status;
    const seated = !!this.client?.playerId && status !== "closed";
    const focus = seated && slimHeader(this.shownPhase);
    this.header.classList.toggle("focus", focus);
    const conn = status === "reconnecting" || status === "connecting"
      ? h("span", { class: "conn" }, status === "connecting" ? "connecting…" : "reconnecting…")
      : null;
    const code = h("span", { class: "room-code", "aria-label": `Room ${this.code.split("").join(" ")}` }, this.code);
    const signal = status === "open" ? this.signal.el : null;
    if (focus) {
      replaceChildren(this.headerStart, code, signal, conn);
      replaceChildren(
        this.headerEnd,
        this.soundView?.wrap,
        this.emotes?.wrap,
        this.chat?.button,
        this.menuButton,
        this.debugToggle,
      );
      return;
    }
    replaceChildren(
      this.headerStart,
      h(
        "a",
        { href: shellConfig().brand.homeHref, class: "brand", "aria-label": shellConfig().brand.label },
        brandMark(),
        h("span", {}, shellConfig().brand.wordmark, h("span", { class: "dot" }, ".")),
      ),
      code,
      signal,
      h("button", { type: "button", class: "icon-btn", "aria-label": "Sound and vibration settings", onclick: () => this.openSettings() }, icon(audio.settings.sound ? "sound-on" : "sound-off")),
      // Once seated: before that there's nobody to talk as.
      seated ? [this.soundView?.wrap, this.emotes?.wrap, this.chat?.button] : null,
      conn,
      this.debugToggle,
    );
    replaceChildren(this.headerEnd);
  }

  /**
   * The screen now shows this phase: the voice bar and the header follow it.
   * Called inside the screen swap, so a view transition's pictures agree.
   */
  private setPhase(phase: RoomPhase | null) {
    const was = this.shownPhase;
    this.shownPhase = phase;
    this.voiceBar?.render(phase);
    if (was === phase) return;
    this.menuDialog?.close();
    // A question about the old screen (the game's own too) no longer applies.
    cancelConfirm();
    // Into or out of the slim header the reaction bar's anchor moves: it closes, like the sound board does on any phase change.
    if (slimHeader(was) !== slimHeader(phase)) this.emotes?.toggle(false);
    this.renderHeader();
  }

  /**
   * The Room menu (on a room screen): the room's own buttons, each doing
   * exactly what it did in the old header. What it lists is `roomMenuItems` (tested).
   */
  private openMenu() {
    const u = this.last;
    const client = this.client;
    const me = client?.playerId;
    if (!u || !client || !me || this.menuDialog) return;
    const room = u.room;
    // The menu follows the screen: just after the last move the room is on
    // results but the game is still shown. The host items need a running game.
    const items = roomMenuItems({ ...room, phase: this.shownPhase ?? room.phase }, me, {
      voice: this.voice ? voiceMenuItem(this.voice.view()) : null,
      pausable: !!games[room.gameId]?.manifest.pausable,
      // Only while the game runs and the room can hear us: elsewhere they would do nothing.
      hostActions: room.phase === "playing" && !this.stuck,
      mySounds: this.mySounds,
    });
    if (!items.length) return;
    const hostInGame = () => this.last?.room.phase === "playing" && this.last.room.hostId === me;
    const act: Record<RoomMenuItem, () => void> = {
      "join-voice": () => void this.voiceBar?.startJoin(),
      voice: () => this.voiceBar?.openPanel(),
      settings: () => this.openSettings(),
      // The dialog and its mp3 encoder load only when asked for.
      "my-sounds": () =>
        void import("./my-sounds.ts")
          .then((m) => {
            if (this.gone) return;
            this.closeMySounds = m.openMySounds({
              api: mySoundsApi(),
              onClose: () => {
                this.closeMySounds = null;
                this.refreshHostSounds();
              },
            });
          })
          .catch(() => this.showToast(MY_SOUNDS_COPY.loadFailed)),
      pause: () => client.send({ type: "pause-game", paused: true }),
      resume: () => client.send({ type: "pause-game", paused: false }),
      restart: () =>
        void this.ask("Restart this game for everyone?", { ok: "Restart", danger: true }, hostInGame).then((yes) => yes && client.send({ type: "restart-game" })),
      // The escape hatch for a game that's gone stale: everyone back to the lobby.
      "end-game": () =>
        void this.ask("End this game for everyone? Everyone goes back to the lobby.", { ok: "End game", danger: true }, hostInGame)
          .then((yes) => yes && client.send({ type: "return-to-lobby" })),
      home: () => {},
      "no-voice": () => {},
    };
    const dlg = h(
      "dialog",
      { class: "dialog room-menu", "aria-label": "Room menu" },
      h("h2", {}, "Room menu"),
      h(
        "div",
        { class: "dialog-list" },
        items.map((item) =>
          item === "no-voice"
            // Not a button: it says why there is no Join voice.
            ? h("p", { class: "muted room-menu-note" }, ROOM_MENU_LABELS["no-voice"])
            : item === "home"
            // The same link as the header logo (party over). The menu closes; the link goes on.
            ? h("a", { href: shellConfig().brand.homeHref, class: "dialog-link", onclick: () => dlg.close() }, ROOM_MENU_LABELS.home)
            : h("button", {
                type: "button",
                class: item === "end-game" ? "danger" : "",
                onclick: () => {
                  dlg.close();
                  act[item]();
                },
              }, ROOM_MENU_LABELS[item]),
        ),
      ),
      h("form", { method: "dialog" }, h("button", {}, "Close")),
    ) as HTMLDialogElement;
    this.menuDialog = dlg;
    dlg.addEventListener("close", () => {
      if (this.menuDialog === dlg) this.menuDialog = null;
      dlg.remove();
    });
    closeOnBackdrop(dlg);
    document.body.append(dlg);
    dlg.showModal();
  }

  private render() {
    const u = this.last;
    const me = this.client?.playerId;
    if (this.asking && !this.asking.valid()) cancelConfirm();
    else if (this.asking?.retext) {
      const text = this.asking.retext();
      if (text) updateConfirm(text);
    }
    if (!u || !me || this.stuck) return;
    const room = u.room;
    if (room.phase === "playing") {
      // A restart: the same game screen, a new round. Before the turn pill's check.
      if (this.screen === "playing" && this.shownRound !== null && this.shownRound !== room.roundNumber) {
        scrollTo({ top: 0, behavior: "instant" });
      }
      this.shownRound = room.roundNumber;
    }
    this.renderTurn();
    this.renderPause();

    const ownChat = room.phase === "playing" && !!games[room.gameId]?.manifest.ownChat;
    this.chat?.lock(ownChat ? "Chat is off for this game" : null);

    if (room.phase === "playing") {
      this.ticker ??= setInterval(() => this.renderControls(), 1000);
    } else {
      clearInterval(this.ticker);
      this.ticker = undefined;
    }

    if (room.phase === "ended") return this.showEnded(room, me);
    this.endedShown = null;

    if (room.phase === "lobby") {
      const lobby = this.lobby(room, me);
      // The voice bar changes inside the swap, so the transition's pictures agree.
      this.show("lobby", () => {
        this.dropGameView();
        replaceChildren(this.body, lobby);
        // Here, not when built: a tap on the old fold during the transition still counts.
        const fold = lobby.querySelector<HTMLDetailsElement>(".settings-fold");
        if (fold) fold.open = this.settingsOpen ?? false;
        // Toasts on phones rise above the Start bar (style.css).
        const bar = lobby.querySelector<HTMLElement>(".lobby-actions");
        this.stopLobbyBar?.();
        this.stopLobbyBar = bar ? watchBarHeight(bar, this.root) : null;
        this.setPhase("lobby");
      });
      return;
    }

    // playing / results: the game view stays mounted so the final board is visible.
    const props = { room, game: room.game, private: u.private, playerId: me, events: u.events, snapshot: u.snapshot, stream: u.stream };
    this.renderControls();

    // Game just ended: let the winning move land, then bring the results in.
    // Otherwise the panel shoves the table down mid-flight.
    if (room.phase === "results" && this.screen === "playing" && this.gameView && !u.snapshot) {
      const view = this.gameView;
      view.update(props);
      void (view.whenIdle?.() ?? Promise.resolve()).then(() => {
        const latest = this.last;
        if (!latest || latest.room.phase !== "results" || this.screen !== "playing") return;
        const panel = this.results(latest.room, me, !canTransition());
        this.show("results", () => {
          arrange(this.body, panel, this.controls, this.gameHost);
          this.setPhase("results");
        });
      });
      return;
    }

    // The panel pops in by itself only when it's new and no view transition
    // brings it in; otherwise it would rise twice, or again on every update.
    const arriving = this.screen !== null && this.screen !== "results" && !canTransition();
    const panel = room.phase === "results" ? this.results(room, me, arriving) : null;
    this.show(room.phase, async () => {
      arrange(this.body, panel, this.controls, this.gameHost);
      this.setPhase(room.phase);
      // Awaited so the transition's "after" picture has the game in it.
      const view = await this.ensureGameView(room.gameId);
      if (view && this.last === u) {
        view.update(props);
        // A view that mounted during a pause goes under the cover now, not at the next render.
        lockGame(this.gameHost, this.pauseCover?.el ?? null);
        this.gameViewFed = true;
        const backlog = this.streamBacklog;
        this.streamBacklog = [];
        for (const m of backlog) view.stream?.(m.from, m.data);
      }
    });
  }

  /** Mid-load, so a second update doesn't start a second load (and a second view). */
  private gameViewLoading: Promise<GameView | null> | null = null;

  private ensureGameView(gameId: string): Promise<GameView | null> {
    if (this.gameViewFor === gameId) {
      if (this.gameView) return Promise.resolve(this.gameView);
      if (this.gameViewLoading) return this.gameViewLoading;
    }
    this.dropGameView();
    this.gameViewFor = gameId;
    const entry = games[gameId];
    if (!entry) return Promise.resolve(null);
    // A game that jumps or buzzes on Space keeps it; the mic button still holds to talk.
    this.voiceBar?.setSpaceKey(!entry.manifest.usesSpace);
    const loading = entry.loadClient().then((mod) => {
      // Navigated away, or dropped for another game, mid-load.
      if (this.gameViewLoading !== loading || !this.client) return null;
      this.gameViewLoading = null;
      const client = this.client;
      // A view that's been dropped for another game doesn't get a say.
      let view: GameView | null = null;
      view = this.gameView = mod.createView({
        act: (action) => client.act(action),
        stream: (data) => client.stream(data),
        serverNow: () => client.serverNow(),
        setTurn: (label) => {
          if (view && this.gameView !== view) return;
          this.gameTurn = label;
          this.renderTurn();
        },
      });
      this.gameView.mount(this.gameHost);
      return this.gameView;
    });
    this.gameViewLoading = loading;
    return loading;
  }

  private dropGameView() {
    this.ptt?.release();
    this.voiceBar?.setSpaceKey(true);
    this.gameView?.destroy();
    this.gameView = null;
    this.gameViewFor = null;
    this.gameViewLoading = null;
    this.gameViewFed = false;
    this.streamBacklog = [];
    this.gameTurn = undefined;
    this.renderTurn();
  }

  /**
   * Is it on me? The game's word if it's given one; otherwise, the room's
   * waiting on me and not on everyone. A whole table voting at once isn't
   * anybody's turn, but being the last one they're waiting on is.
   */
  private renderTurn() {
    const room = this.last?.room;
    const me = this.client?.playerId;
    if (!room || !me || room.phase !== "playing" || room.paused) return this.turn.set(null);
    if (this.gameTurn !== undefined) return this.turn.set(this.gameTurn);
    const waiting = room.awaitingPlayerIds;
    const mine = waiting.includes(me) && waiting.length < room.seats.length;
    this.turn.set(mine ? (waiting.length === 1 ? "Your turn" : "Your move") : null);
  }

  /** The pause cover, while one shows, and whether it has the host's Resume. */
  private pauseCover: { el: HTMLElement; host: boolean } | null = null;
  /** Says the pause out loud: always mounted, filled on pause, emptied on resume. */
  private pauseNote = h("span", { class: "sr-only", role: "status" });

  /**
   * While the host has paused the game, a cover over the game: the board dims
   * so its timer plainly stands still, and a card says why. The host's card has
   * Resume (the same as the menu's). Built only when that changes, so the
   * once-a-second redraw never steals focus from the button.
   */
  private renderPause() {
    const room = this.last?.room;
    const me = this.client?.playerId;
    if (!room || !me || room.phase !== "playing" || !room.paused) {
      if (this.pauseCover) {
        this.pauseCover.el.remove();
        this.pauseCover = null;
        lockGame(this.gameHost, null);
        this.pauseNote.textContent = "";
      }
      return;
    }
    // render() never runs while stuck, so this is the menu's rule too.
    const host = room.hostId === me;
    if (this.pauseCover?.host !== host) {
      this.pauseCover?.el.remove();
      const title = host ? "You paused the game" : "Paused by the host";
      const line = host ? "The timer is stopped. Nobody can play." : "The timer is stopped. Wait for the host to start it again.";
      const el = h(
        "div",
        { class: "pause-cover" },
        h(
          "div",
          { class: "pause-card" },
          h("h2", {}, title),
          h("p", { class: "muted" }, line),
          host ? h("button", { type: "button", class: "primary", onclick: () => this.client?.send({ type: "pause-game", paused: false }) }, "Resume") : null,
        ),
      );
      this.pauseCover = { el, host };
      // The live region was mounted empty, so this text is announced.
      this.pauseNote.textContent = `${title}. ${line}`;
    }
    if (this.pauseCover.el.parentNode !== this.gameHost) this.gameHost.append(this.pauseCover.el);
    // Keyboard and screen readers can't reach the game under the cover either.
    lockGame(this.gameHost, this.pauseCover.el);
  }

  /**
   * Room-level turn controls (§12). They live in the shell, not the game, since
   * any turn-based game gets them for free.
   */
  private renderControls() {
    const u = this.last;
    const client = this.client;
    const me = client?.playerId;
    if (!u || !client || !me || u.room.phase !== "playing") return replaceChildren(this.controls);

    const room = u.room;
    const isHost = room.hostId === me;
    const target = room.seats.find((s) => s.id === room.awaitingPlayerIds[0]);
    const elapsed = room.awaitingSince === null ? 0 : Date.now() + client.clockOffset - room.awaitingSince;
    const dropped = target && target.presence !== "connected";
    const items: (Node | null)[] = [];

    if (target && dropped) {
      items.push(
        h("p", { class: "muted" }, target.presence === "disconnected"
          ? `${target.name} is disconnected. The game will wait for them.`
          : `${target.name} lost connection. Waiting for them to come back…`),
      );
    }
    if (!room.paused && target && target.id !== me && !target.bot && !dropped && elapsed >= NUDGE_AFTER_MS) {
      items.push(
        h("button", {
          type: "button",
          onclick: () => {
            client.send({ type: "nudge" });
            this.showToast(`Reminded ${target.name}.`);
          },
        }, `Remind ${target.name}`),
      );
    }
    if (!room.paused && isHost && target && target.id !== me && (dropped || elapsed >= SKIP_AFTER_MS)) {
      items.push(
        h("button", { type: "button", onclick: () => client.send({ type: "skip-turn", playerId: target.id }) }, `Skip ${target.name}'s turn`),
      );
    }
    if (isHost) {
      for (const s of room.seats.filter((s) => s.presence === "disconnected")) {
        items.push(
          h("button", {
            type: "button",
            class: "danger",
            onclick: () => {
              const still = () => {
                const now = this.last?.room;
                return now?.phase === "playing" && now.hostId === me && now.seats.some((x) => x.id === s.id && x.presence === "disconnected");
              };
              void this.ask(`Remove ${s.name}? They will be out for the rest of this round.`, { ok: "Remove", danger: true }, still)
                .then((yes) => yes && client.send({ type: "remove-player", playerId: s.id }));
            },
          }, `Remove ${s.name}`),
        );
      }
    }
    replaceChildren(this.controls, items);
  }

  private lobby(room: RoomPublicState, me: string) {
    const entry = games[room.gameId];
    const isHost = room.hostId === me;
    const mySeat = room.seats.find((s) => s.id === me);
    const seats = room.seats.filter((s) => s.presence !== "left");
    const connected = seats.filter((s) => s.presence === "connected").length;
    const min = entry?.manifest.minPlayers ?? 2;
    // The room's cap, not the game's: a free room seats fewer than some games allow.
    const max = room.maxSeats || (entry?.manifest.maxPlayers ?? 8);
    const url = `${location.origin}/room/${room.code}`;
    const botGame = room.botGameIds.includes(room.gameId);
    const canAddBot = isHost && botGame;
    const botBlocked = seats.some((s) => s.bot) && !botGame;

    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    const canShare = !!nav.share && matchMedia("(pointer: coarse)").matches;
    const copyLabel = canShare ? "Share invite" : "Copy link";
    const share = h("button", { type: "button", class: "primary" }, copyLabel);
    share.addEventListener("click", async () => {
      try {
        if (canShare) {
          await nav.share!({ title: "Join my game", text: `Join room ${room.code}`, url });
        } else {
          await navigator.clipboard.writeText(url);
          share.replaceChildren(icon("check"), "Copied");
          setTimeout(() => (share.textContent = copyLabel), 1500);
        }
      } catch {
        // Share sheet dismissed, or clipboard blocked: the link is on screen anyway.
      }
    });

    const rules = entry
      ? h("button", {
          type: "button",
          class: "link",
          onclick: () => openDialog(`How to play ${entry.manifest.name}`, h("ul", { class: "rules" }, entry.rules.map((r) => h("li", {}, r)))),
        }, "Rules")
      : null;

    // Named blocks move smoothly when the lobby updates (someone joins, the
    // game changes) instead of the page jumping. Only a name-to-be: CSS
    // applies it during lobby transitions alone, so page changes still move
    // the lobby as one piece. Names must be page-unique.
    const vt = (name: string) => `--vt: ${name}`;

    const action = lobbyAction({
      isHost,
      ready: !!mySeat?.ready,
      connected,
      min,
      canStart: room.canStart,
      setupProblem: room.setupProblem ?? null,
      botBlocked,
      hostName: seatName(room, room.hostId),
    });

    return h(
      "section",
      { class: "lobby" },
      h(
        "div",
        { class: "invite", style: vt("lobby-invite") },
        h("span", { class: "muted" }, "Room code"),
        h("strong", { class: "big-code", "aria-label": room.code.split("").join(" ") }, room.code),
        h("span", { class: "invite-url" }, url.replace(/^https?:\/\//, "")),
        share,
        room.locked ? h("p", { class: "muted", role: "status" }, "The room is locked. New players can't join.") : null,
      ),
      h("h3", { class: "seats-title", style: vt("lobby-seats-title") }, `Players `, h("span", { class: "muted" }, `${seats.length}/${max}`)),
      h(
        "ul",
        { class: "seats" },
        seats.map((s) =>
          h(
            "li",
            { class: s.presence !== "connected" ? "away" : "", style: vt(`seat-${s.id}`) },
            avatar(s.name, s.avatarSeed),
            h("span", { class: "name" }, s.name, s.id === me ? h("span", { class: "muted" }, " (you)") : null),
            s.id === room.hostId ? h("span", { class: "tag" }, "host") : null,
            botTag(s),
            // The host starts the game, so their own ready flag means nothing here.
            s.bot || (s.id === room.hostId && s.presence === "connected")
              ? null
              : h("span", { class: `ready ${s.ready ? "yes" : ""}` }, s.presence !== "connected" ? "reconnecting…" : s.ready ? ["ready", icon("check")] : "not ready"),
            this.seatControl(room, me, s),
          ),
        ),
        // Empty seats up to the minimum make "how many more?" obvious at a glance.
        Array.from({ length: Math.max(0, min - seats.length) }, (_, i) =>
          h("li", { class: "empty", style: vt(`seat-empty-${i}`) }, h("span", { class: "avatar avatar-md ghost", "aria-hidden": "true" }), h("span", { class: "muted" }, "Waiting for a player…")),
        ),
      ),
      h(
        "div",
        { class: "game-card", style: vt("lobby-game") },
        brandMark("mark game-icon"),
        h("div", { class: "game-card-text" }, h("h2", {}, entry?.manifest.name ?? room.gameId), entry ? h("p", { class: "muted" }, entry.manifest.description) : null),
        h(
          "div",
          { class: "game-card-links" },
          Object.keys(games).length > 1
            ? h("button", { type: "button", class: "link", onclick: () => this.openGameList() }, isHost ? "Change" : "See all games")
            : null,
          rules,
        ),
        this.suggestionLine(room, me, isHost),
      ),
      // The deal skips seats that aren't connected, and so does the server's
      // setupProblem: hints built for the same count agree with its line.
      this.gameSettings(room, isHost, connected, vt("lobby-settings")),
      isHost ? null : setupProblem(room, vt("lobby-setup-problem")),
      isHost
        ? h("button", {
            type: "button",
            class: "lock-room", style: vt("lobby-lock"),
            "aria-pressed": String(room.locked),
            onclick: () => this.client?.send({ type: "lock-room", locked: !room.locked }),
          }, room.locked ? "Unlock room" : "Lock room")
        : null,
      canAddBot
        ? h(
            "div",
            { class: "add-bot", style: vt("lobby-add-bot") },
            h("button", { type: "button", disabled: seats.length >= max, onclick: () => this.client?.send({ type: "add-bot" }) }, "Add computer"),
            h("p", { class: "muted" }, "Computers play by the same rules. They only see their own cards."),
          )
        : null,
      // On phones this sticks to the bottom of the screen (style.css).
      h(
        "div",
        { class: "actions lobby-actions", style: vt("lobby-actions") },
        action.kind === "start"
          ? h("button", { type: "button", class: "primary", disabled: action.disabled, onclick: () => this.client?.send({ type: "start-game" }) }, action.label)
          : h(
              "button",
              { type: "button", class: action.primary ? "primary" : "", "aria-pressed": String(action.pressed), onclick: () => this.client?.send({ type: "ready", ready: !action.pressed }) },
              action.label,
            ),
        action.note ? h("p", { class: action.kind === "start" ? "start-blocked" : "muted waiting" }, action.note) : null,
      ),
      h("button", { type: "button", class: "link", style: vt("lobby-leave"), onclick: () => void this.leave() }, "Leave room"),
      isHost ? this.endPartyControl(vt("lobby-end-party")) : null,
    );
  }

  /**
   * The top pick for the host (tap to choose it), or your own pick for
   * everyone else (tap to take it back). Nothing when nobody has suggested.
   */
  private suggestionLine(room: RoomPublicState, me: string, isHost: boolean): HTMLElement | null {
    const nameOf = (id: string) => games[id]?.manifest.name ?? id;
    if (!isHost) {
      const mine = room.seats.find((s) => s.id === me)?.suggestion;
      if (!mine) return null;
      return h(
        "p",
        { class: "suggestion-line" },
        `You suggested ${nameOf(mine)}.`,
        h("button", { type: "button", class: "link", onclick: () => this.client?.send({ type: "suggest-game", gameId: null }) }, "Undo"),
      );
    }
    let top: [string, number] | null = null;
    for (const [id, n] of suggestionCounts(room)) {
      if (id !== room.gameId && games[id] && (!top || n > top[1])) top = [id, n];
    }
    if (!top) return null;
    const [id, n] = top;
    const who = n === 1 ? room.seats.find((s) => s.suggestion === id)!.name : `${n} players`;
    const locked = room.lockedGameIds.includes(id);
    return h(
      "p",
      { class: "suggestion-line" },
      icon("thumbs-up"),
      `${who} ${n === 1 ? "wants" : "want"} ${nameOf(id)}.`,
      h("button", {
        type: "button",
        class: "link",
        onclick: () => locked ? shellConfig().onLockedGame(id, this.code) : this.client?.send({ type: "select-game", gameId: id }),
      }, locked ? "Unlock" : "Play it"),
    );
  }

  /** A computer keeps a plain X. A person gets the dots, which open the host's menu. */
  private seatControl(room: RoomPublicState, me: string, s: RoomPublicState["seats"][number]) {
    const actions = seatActions(room, me, s);
    if (!actions.length) return null;
    const send = (kind: (typeof actions)[number]["kind"]) => this.client?.send(seatActionMessage(kind, s));
    if (s.bot) {
      return h("button", { type: "button", class: "kick bot-kick", "aria-label": `Remove ${s.name}`, onclick: () => send("remove") }, icon("close"));
    }
    return h("button", {
      type: "button",
      class: "kick seat-menu-button",
      "aria-label": `Actions for ${s.name}`,
      onclick: () => {
        const dlg = h(
          "dialog",
          { class: "dialog seat-menu", "aria-label": s.name },
          h("h2", {}, s.name),
          h(
            "div",
            { class: "dialog-list" },
            actions.map((a) =>
              h("button", {
                type: "button",
                class: a.danger ? "danger" : "",
                onclick: () => {
                  dlg.close();
                  if (!a.confirm) return send(a.kind);
                  // Still on offer: the player hasn't left, I'm still host.
                  const still = () => {
                    const now = this.last?.room;
                    const seat = now?.seats.find((x) => x.id === s.id);
                    return !!now && !!seat && seatActions(now, me, seat).some((x) => x.kind === a.kind);
                  };
                  void this.ask(a.confirm, { ok: a.label, danger: a.danger }, still).then((yes) => yes && send(a.kind));
                },
              }, a.label),
            ),
          ),
          h("form", { method: "dialog" }, h("button", {}, "Cancel")),
        ) as HTMLDialogElement;
        dlg.addEventListener("close", () => dlg.remove());
        closeOnBackdrop(dlg);
        document.body.append(dlg);
        dlg.showModal();
      },
    }, icon("more"));
  }

  /**
   * Everyone can open the game list. The host picks from it; everyone else
   * reads the rules and suggests. Built to grow: games sit under section
   * headings, a search box shows up once there are enough games to need one,
   * and games that can't seat everyone here say so instead of failing at
   * "Start game". Counts and buttons follow the room while it's open.
   */
  private openGameList() {
    const room0 = this.last?.room;
    const me = this.client?.playerId;
    if (!room0 || !me) return;
    const isHost = room0.hostId === me;
    const all = Object.entries(games);
    const search = all.length > 6
      ? h("input", { type: "search", class: "game-search", placeholder: "Search games", "aria-label": "Search games", autocomplete: "off" })
      : null;
    const empty = h("p", { class: "muted center", hidden: true }, "No games match.");
    const refreshers: ((room: RoomPublicState) => void)[] = [];

    const rows = all.map(([id, entry]) => {
      const { name, description, minPlayers, maxPlayers, bestMinPlayers, bestMaxPlayers } = entry.manifest;
      const range = minPlayers === maxPlayers ? `${minPlayers} players` : `${minPlayers}–${maxPlayers} players`;
      // Only the host's rows pick, so only theirs are buttons.
      const option: HTMLElement = isHost ? h("button", { type: "button", class: "game-option" }) : h("div", { class: "game-option" });
      const meta = h("span", { class: "game-option-meta" });
      const want = h("span", { class: "game-option-want" });
      const nameLine = h("span", { class: "game-option-name" });
      const suggest = isHost ? null : h("button", { type: "button", class: "small" });
      const rulesBtn = h("button", {
        type: "button",
        class: "link small",
        "aria-label": `Rules for ${name}`,
        onclick: () => openDialog(`How to play ${name}`, h("p", { class: "muted" }, description), h("ul", { class: "rules" }, entry.rules.map((r) => h("li", {}, r)))),
      }, "Rules");

      let shownWants = Infinity; // no bounce on the first fill
      const refresh = (room: RoomPublicState) => {
        const players = room.seats.filter((s) => s.presence !== "left").length;
        const current = id === room.gameId;
        const locked = room.lockedGameIds.includes(id);
        const tooMany = players > maxPlayers;
        const best = bestMinPlayers !== undefined && bestMaxPlayers !== undefined && players >= bestMinPlayers && players <= bestMaxPlayers;
        option.classList.toggle("best", best);
        const n = suggestionCounts(room).get(id) ?? 0;
        option.classList.toggle("locked", locked);
        if (current) option.setAttribute("aria-current", "true");
        else option.removeAttribute("aria-current");
        // The host's rows disable when the game can't seat everyone.
        const botBlock = isHost && !current && !locked && !room.botGameIds.includes(id) && room.seats.some((s) => s.bot && s.presence !== "left");
        if (option instanceof HTMLButtonElement) option.disabled = (tooMany && !current && !locked) || botBlock;
        replaceChildren(nameLine, [
          name,
          current ? h("span", { class: "tag" }, "current") : null,
          locked ? h("span", { class: "tag" }, "Host Pass") : null,
          best ? h("span", { class: "tag best" }, icon("star"), `Best for ${players}`) : null,
        ]);
        meta.className = `game-option-meta${tooMany || botBlock ? " warn" : ""}`;
        meta.textContent = botBlock ? "Remove computers to play this" : tooMany ? `Up to ${maxPlayers} players, you have ${players}` : range;
        replaceChildren(want, n ? [icon("thumbs-up"), wantLabel(n)] : []);
        want.hidden = !n;
        // Someone just suggested it: the count gives a little bounce.
        if (n > shownWants && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
          want.animate([{ transform: "scale(1)" }, { transform: "scale(1.18)" }, { transform: "scale(1)" }], { duration: 320, easing: "cubic-bezier(.2, .9, .3, 1.4)" });
        }
        shownWants = n;
        if (suggest) {
          const mine = room.seats.find((s) => s.id === me)?.suggestion === id;
          replaceChildren(suggest, [mine ? icon("check") : null, mine ? "Suggested" : locked ? "Ask host to unlock" : "Suggest", h("span", { class: "sr-only" }, ` ${name}`)]);
          suggest.setAttribute("aria-pressed", String(mine));
          suggest.hidden = current;
          suggest.onclick = () => this.client?.send({ type: "suggest-game", gameId: mine ? null : id });
        }
      };
      refreshers.push(refresh);
      refresh(room0);

      if (isHost) {
        option.onclick = () => {
          const room = this.last?.room ?? room0;
          if (room.lockedGameIds.includes(id)) {
            dlg.close();
            shellConfig().onLockedGame(id, this.code);
            return;
          }
          if (id !== room.gameId) this.client?.send({ type: "select-game", gameId: id });
          dlg.close();
        };
      }
      option.append(
        h("span", { class: "game-option-text" }, nameLine, h("span", { class: "muted game-option-desc" }, description), meta, want),
      );
      const row = h("li", { class: "game-row" }, option, h("div", { class: "game-option-actions" }, rulesBtn, suggest));
      return { row, section: entry.section, text: `${name} ${description}`.toLowerCase() };
    });

    // Sections with no games in this build (Racing without its flag) don't show.
    const sections = GAME_SECTIONS.map(({ id, label }) => {
      const mine = rows.filter((r) => r.section === id);
      const el = h(
        "section",
        { class: "game-section", "aria-labelledby": `game-section-${id}` },
        h("h3", { id: `game-section-${id}` }, label),
        h("ul", { class: "game-options" }, mine.map((r) => r.row)),
      );
      return { el, rows: mine };
    }).filter((s) => s.rows.length);
    // Entrance stagger (style.css), counted top to bottom as they show.
    sections.flatMap((s) => s.rows).forEach((r, i) => r.row.style.setProperty("--i", String(i)));

    search?.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      for (const r of rows) r.row.hidden = !!q && !r.text.includes(q);
      // A heading with nothing under it goes too.
      for (const s of sections) s.el.hidden = s.rows.every((r) => r.row.hidden);
      empty.hidden = sections.some((s) => !s.el.hidden);
    });

    const removeBots = h("button", { type: "button", class: "small", onclick: () => this.client?.send({ type: "remove-bots" }) }, "Remove computers");
    const syncRemoveBots = (room: RoomPublicState) => {
      removeBots.hidden = !(isHost && room.seats.some((s) => s.bot && s.presence !== "left"));
    };
    syncRemoveBots(room0);
    refreshers.push(syncRemoveBots);

    const dlg = h(
      "dialog",
      { class: "dialog game-list", "aria-label": isHost ? "Choose a game" : "All games" },
      h("h2", {}, isHost ? "Choose a game" : "All games"),
      removeBots,
      isHost ? null : h("p", { class: "muted" }, "The host picks the game. Suggest the one you want."),
      search,
      sections.map((s) => s.el),
      empty,
      h("form", { method: "dialog" }, h("button", {}, "Close")),
    );
    this.refreshGameList = (room) => {
      // A new host, or the game started: this list is out of date, so it goes.
      if (room.phase !== "lobby" || (room.hostId === me) !== isHost) return dlg.close();
      for (const r of refreshers) r(room);
    };
    dlg.addEventListener("close", () => {
      this.refreshGameList = null;
      dlg.remove();
    });
    closeOnBackdrop(dlg);
    document.body.append(dlg);
    dlg.showModal();
    // Start on the current game, not the search box: on phones that'd pop the keyboard.
    (dlg.querySelector<HTMLButtonElement>('button.game-option[aria-current="true"]') ?? dlg.querySelector<HTMLButtonElement>(".game-option-actions button"))?.focus();
  }

  /**
   * The game's own settings, from its field descriptions, in a fold headed by
   * a one-line summary. The host edits them; everyone else reads them.
   * Warnings stay in sight while the fold is shut. The fold's open state is
   * applied after the lobby is on screen (see render).
   */
  private gameSettings(room: RoomPublicState, isHost: boolean, players: number, style?: string) {
    const fields = games[room.gameId]?.settingFields(room.settings, players) ?? [];
    if (!fields.length) return null;
    this.settingsOpen ??= matchMedia("(min-width: 600px)").matches;
    // The setup problem has its own line (the Start bar, or under the settings): say it once.
    const warnings = settingsWarnings(fields.filter((f) => f.hint !== room.setupProblem));
    const fold = h(
      "details",
      { class: "settings-fold" },
      h(
        "summary",
        {},
        h("span", { class: "settings-fold-title" }, "Settings"),
        h("span", { class: "settings-summary" }, settingsSummary(fields)),
      ),
      h(
        "div",
        { class: "game-settings" },
        fields.map((f) => {
          const id = `setting-${f.key}`;
          const value = isHost
            ? (() => {
                const select = h(
                  "select",
                  { id },
                  f.options.map((o, i) => h("option", { value: i, selected: i === f.selected }, o.label)),
                );
                select.addEventListener("change", () => {
                  const patch = f.options[Number(select.value)]?.patch;
                  if (patch) this.client?.send({ type: "update-settings", settings: patch });
                });
                return select;
              })()
            : h("span", { class: "setting-value" }, f.options[f.selected]?.label ?? "");
          return h(
            "div",
            { class: "setting" },
            // A label points at a control; a guest's row has none to point at.
            isHost ? h("label", { for: id }, f.label) : h("span", { class: "setting-name" }, f.label),
            value,
            f.hint ? h("span", { class: `muted setting-hint${f.warn ? " warn" : ""}` }, f.hint) : null,
          );
        }),
      ),
    ) as HTMLDetailsElement;
    fold.addEventListener("toggle", () => {
      // A fold that was swapped out by a redraw has nothing to say.
      if (fold.isConnected) this.settingsOpen = fold.open;
    });
    return h(
      "div",
      { class: "lobby-settings", style },
      fold,
      warnings.length ? h("ul", { class: "settings-warnings" }, warnings.map((w) => h("li", {}, w))) : null,
    );
  }

  private results(room: RoomPublicState, me: string, pop: boolean) {
    const result = room.result;
    const isHost = room.hostId === me;
    const mySeat = room.seats.find((s) => s.id === me);
    // A game with a loser headlines them; everyone else simply got away.
    const loser = result?.loserIds?.[0];
    const winner = loser ? undefined : result?.winnerIds[0];
    const readyCount = room.seats.filter((s) => s.ready).length;
    // Seatless participants (computer players) bring their own names.
    const nameOf = (id: string) => result?.names?.[id] ?? seatName(room, id);
    const featured = room.seats.find((s) => s.id === (loser ?? winner));
    const won = loser ? loser !== me && !!result?.winnerIds.includes(me) : !!result?.winnerIds.includes(me);
    // A shared win names everyone in it, you first if you're one.
    const headline = resultHeadline(result, me, nameOf);

    return h(
      "section",
      { class: `results${won ? " won" : ""}${pop ? " pop" : ""}` },
      featured ? h("div", { class: loser ? "loser-badge" : "winner-badge" }, avatar(featured.name, featured.avatarSeed)) : null,
      h("h2", {}, headline),
      h(
        "ol",
        { class: "standings" },
        (result?.standings ?? []).map((s, i) => {
          const seat = room.seats.find((x) => x.id === s.playerId);
          return h(
            "li",
            { class: s.playerId === me ? "me" : "" },
            h("span", { class: "place" }, result?.unranked ? "" : String(i + 1)),
            seat ? avatar(seat.name, seat.avatarSeed, "sm") : null,
            h("span", { class: "name" }, s.playerId === me ? "You" : nameOf(s.playerId)),
            h("span", { class: "muted" }, seat?.presence === "left" ? "left" : s.label ?? (s.value === 0 ? "out!" : `${s.value} ${s.value === 1 ? "card" : "cards"} left`)),
          );
        }),
      ),
      setupProblem(room),
      h(
        "div",
        { class: "actions" },
        isHost
          ? [
              h(
                "button",
                { type: "button", class: "primary", disabled: !room.canStart || !!room.setupProblem, onclick: () => this.client?.send({ type: "start-game" }) },
                room.canStart ? `Play again${readyCount ? ` (${readyCount} ready)` : ""}` : "Can't start yet",
              ),
              h("button", { type: "button", onclick: () => this.client?.send({ type: "return-to-lobby" }) }, "Back to lobby"),
            ]
          : h(
              "button",
              { type: "button", class: mySeat?.ready ? "" : "primary", "aria-pressed": String(!!mySeat?.ready), onclick: () => this.client?.send({ type: "ready", ready: !mySeat?.ready }) },
              mySeat?.ready ? "Waiting for the host…" : "Play again",
            ),
        h("button", { type: "button", class: "link", onclick: () => void this.leave() }, "Leave room"),
        isHost ? this.endPartyControl() : null,
      ),
    );
  }

  /** The host's way to close the night. Asks first, in a dialog, so the question shows on any screen size. */
  private endPartyControl(style?: string): HTMLElement {
    const ask = () => {
      const me = this.client?.playerId;
      const still = () => this.last?.room.hostId === me && this.last?.room.phase !== "ended";
      void this.ask("End the party for everyone? You will see the recap.", { ok: "End party", danger: true }, still)
        .then((yes) => yes && this.client?.send({ type: "end-party" }));
    };
    return h("div", { class: "end-party", style }, h("button", { type: "button", class: "link", onclick: ask }, "End party"));
  }

  /** What `showEnded` last drew, so a seat joining doesn't replay the cards. */
  private endedShown: string | null = null;
  /** The host's settings fold. Null until first shown: then open on wide screens, shut on phones. Kept across redraws. */
  private settingsOpen: boolean | null = null;

  private showEnded(room: RoomPublicState, me: string) {
    const isHost = room.hostId === me;
    const key = JSON.stringify([room.recap, isHost]);
    if (this.endedShown === key) return;
    this.endedShown = key;
    const config = shellConfig();
    const home = () => navigate("/");
    const screen = room.recap
      ? recapView({
          recap: room.recap,
          isHost,
          appTitle: config.appTitle,
          gameName: (id) => games[id]?.manifest.name ?? id,
          partyOver: config.partyOver,
          home,
        })
      : closedView("This party is over.", isHost, config.partyOver, home);
    this.show("ended", () => {
      this.dropGameView();
      replaceChildren(this.body, screen);
      this.setPhase("ended");
    });
  }

  /** The room's gone (cleaned up, or never was): nothing to rejoin, so the host app gets its say. */
  private showClosed(message: string) {
    this.chat?.toggle(false);
    const screen = closedView(message, false, shellConfig().partyOver, () => navigate("/"));
    this.show("message", () => {
      this.dropGameView();
      replaceChildren(this.body, screen);
    });
  }

  private showMessage(message: string, code?: string) {
    this.chat?.toggle(false);
    const screen = h(
      "section",
      { class: "message" },
      h("p", {}, message),
      code === "replaced-by-new-connection"
        ? h("button", { type: "button", class: "primary", onclick: () => (this.voice?.resumeAfterTakeover(), this.client?.reconnect(), this.show("connecting", () => replaceChildren(this.body, h("p", { class: "muted center" }, "Connecting…")))) }, "Use here")
        : null,
      code === "protocol-mismatch"
        ? h("button", { type: "button", class: "primary", onclick: () => location.reload() }, "Refresh")
        : null,
      h("button", { type: "button", onclick: () => navigate("/") }, "Home"),
    );
    this.show("message", () => {
      this.dropGameView();
      replaceChildren(this.body, screen);
    });
  }

  private openSettings() {
    const sound = h("input", { type: "checkbox", checked: audio.settings.sound });
    const volume = h("input", { type: "range", min: 0, max: 1, step: 0.05, value: audio.settings.volume, "aria-label": "Volume" });
    const roomSounds = h("input", { type: "checkbox", checked: audio.settings.roomSounds });
    const haptics = h("input", { type: "checkbox", checked: audio.settings.haptics });
    sound.addEventListener("change", () => {
      audio.update({ sound: sound.checked });
      volume.disabled = roomSounds.disabled = !sound.checked;
      if (sound.checked) audio.play("card-place");
      this.renderHeader();
      this.soundView?.render(this.last?.room ?? null, this.client?.playerId ?? null);
    });
    volume.disabled = roomSounds.disabled = !audio.settings.sound;
    roomSounds.addEventListener("change", () => {
      audio.update({ roomSounds: roomSounds.checked });
      if (roomSounds.checked) {
        void this.board?.load(shellConfig().extraPacks);
        this.refreshHostSounds();
      }
      this.soundView?.render(this.last?.room ?? null, this.client?.playerId ?? null);
    });
    volume.addEventListener("change", () => {
      audio.update({ volume: Number(volume.value) });
      audio.play("card-place"); // hear what you picked
    });
    haptics.addEventListener("change", () => {
      audio.update({ haptics: haptics.checked });
      if (haptics.checked) audio.buzz(30);
    });
    openDialog(
      { title: "Sound and vibration", close: "Done" },
      h(
        "div",
        { class: "settings" },
        h("label", {}, "Sounds", sound),
        h("label", {}, "Volume", volume),
        h("label", {}, "Sound board", roomSounds),
        audio.canVibrate ? h("label", {}, "Vibration", haptics) : null,
      ),
    );
  }

  private showToast(message: string) {
    this.toast.textContent = message;
    this.toast.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.classList.remove("show"), 2500);
  }
}
