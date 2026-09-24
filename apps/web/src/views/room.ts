import { audio } from "@games/audio";
import {
  isValidRoomCode,
  normalizeName,
  normalizeRoomCode,
  NUDGE_AFTER_MS,
  SKIP_AFTER_MS,
  type RoomPublicState,
} from "@games/protocol";
import { RoomClient, type RoomUpdate } from "@games/room-client";
import { avatar, h, openDialog, replaceChildren, seatName, type GameView, type View } from "@games/ui";
import { brandMark, icon } from "../brand.ts";
import { games } from "../games.ts";
import { getIdentity, getOwnerKey, getResumeToken, setDisplayName, setResumeToken } from "../identity.ts";
import { APP_TITLE, navigate } from "../router.ts";
import { nameInput } from "./home.ts";

const STUCK_AFTER_MS = 15_000;

const FATAL_COPY: Record<string, string> = {
  "room-not-found": "That room doesn't exist (or everyone left and it closed).",
  "room-full": "This room is full.",
  "game-in-progress": "A game is already underway. You can join once this round ends.",
  "replaced-by-new-connection": "This room is open in another tab.",
  "protocol-mismatch": "A new version is out. Refresh to keep playing.",
  removed: "The host removed you from this room.",
};

export class RoomView implements View {
  private code: string;
  private root = h("main", { class: "room" });
  private header = h("header", { class: "room-header" });
  private body = h("div", { class: "room-body" });
  private toast = h("div", { class: "toast", role: "alert" });

  private client: RoomClient | null = null;
  private last: RoomUpdate | null = null;
  private gameView: GameView | null = null;
  private gameViewFor: string | null = null;
  private gameHost = h("div", { class: "game-host" });
  private controls = h("div", { class: "turn-controls", "aria-live": "polite" });
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  /** Re-checks the nudge/skip thresholds while a game runs (§12.2). */
  private ticker: ReturnType<typeof setInterval> | undefined;
  /** Fires if we've been trying to reconnect for too long (§36). */
  private stuckTimer: ReturnType<typeof setTimeout> | undefined;
  private stuck = false;
  private detachDebug: (() => void) | null = null;

  constructor(params: Record<string, string>) {
    this.code = normalizeRoomCode(params.code ?? "");
  }

  mount(container: HTMLElement) {
    this.root.append(this.header, this.body, this.toast);
    container.append(this.root);

    if (!isValidRoomCode(this.code)) return this.showMessage("That isn't a room code.");
    if (this.code !== location.pathname.split("/")[2]) {
      // Tidy lower-case links to the canonical URL.
      history.replaceState(null, "", location.pathname.replace(/[^/]+$/, this.code) + location.search);
    }
    document.title = `${this.code} · ${APP_TITLE}`;
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
    this.client?.close();
    this.gameView?.destroy();
    this.root.remove();
  }

  // ---- connection ---------------------------------------------------------

  private askName() {
    const input = nameInput("");
    const form = h(
      "form",
      { class: "ask-name" },
      h("h2", {}, `Joining ${this.code}`),
      h("label", { class: "field" }, h("span", {}, "Your name"), input),
      h("button", { type: "submit", class: "primary" }, "Join"),
    );
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const n = normalizeName(input.value);
      if (!n) return input.focus();
      setDisplayName(n);
      this.connect();
    });
    replaceChildren(this.body, form);
    input.focus();
  }

  private connect() {
    const me = getIdentity();
    replaceChildren(this.body, h("p", { class: "muted center" }, "Connecting…"));
    const client = new RoomClient({
      code: this.code,
      name: me.displayName,
      avatarSeed: me.avatarSeed,
      getResumeToken: () => getResumeToken(this.code),
      getOwnerKey,
    });
    this.client = client;

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
    client.on("welcome", ({ resumeToken }) => setResumeToken(this.code, resumeToken));
    client.on("update", (u) => {
      const prev = this.last;
      this.last = u;
      if (prev && prev.room.hostId !== client.playerId && u.room.hostId === client.playerId) {
        this.showToast("You're the host now.");
      }
      this.render();
    });
    client.on("rejected", ({ clientActionId, message }) => this.gameView?.rejected(clientActionId, message));
    client.on("error", ({ message }) => this.showToast(message));
    client.on("nudged", ({ byPlayerId }) => {
      const room = this.last?.room;
      this.showToast(`${room ? seatName(room, byPlayerId) : "Someone"} nudged you: it's your turn!`);
      audio.play("nudge");
      navigator.vibrate?.([80, 60, 80]);
    });
    client.on("fatal", ({ code, message }) => {
      // A seat that no longer exists isn't worth resuming.
      if (code === "room-not-found" || code === "removed") setResumeToken(this.code, null);
      this.showMessage(FATAL_COPY[code] ?? message, code);
    });

    // Dev-only panel (§41). The DEV check is static, so production builds drop
    // the import entirely.
    if (import.meta.env.DEV) {
      void import("../debug.ts").then((m) => {
        if (this.client === client) this.detachDebug = m.attachDebug(client, () => this.last);
      });
    }
  }

  private showStuck() {
    this.stuck = true;
    this.dropGameView();
    replaceChildren(
      this.body,
      h(
        "section",
        { class: "message" },
        h("p", {}, "Couldn't reconnect to the room."),
        h("p", { class: "muted" }, "Still trying in the background. Your seat is kept for a minute."),
        h("button", { type: "button", class: "primary", onclick: () => this.client?.reconnect() }, "Try again"),
        h("button", {
          type: "button",
          onclick: () => {
            this.client?.close();
            setResumeToken(this.code, null);
            navigate("/");
          },
        }, "Leave room"),
      ),
    );
  }

  private leave() {
    if (this.last?.room.phase === "playing" && !confirm("Leave the game? Your cards will be played out automatically.")) {
      return;
    }
    this.client?.send({ type: "leave" });
    this.client?.close();
    setResumeToken(this.code, null);
    navigate("/");
  }

  // ---- rendering ----------------------------------------------------------

  private renderHeader() {
    const status = this.client?.status;
    replaceChildren(
      this.header,
      h("a", { href: "/", class: "brand", "aria-label": "Party Games home" }, brandMark(), h("span", {}, "party games", h("span", { class: "dot" }, "."))),
      h("span", { class: "room-code", "aria-label": `Room ${this.code.split("").join(" ")}` }, this.code),
      h("button", { type: "button", class: "icon-btn", "aria-label": "Sound and vibration settings", onclick: () => this.openSettings() }, icon(audio.settings.sound ? "sound-on" : "sound-off")),
      status === "reconnecting" || status === "connecting"
        ? h("span", { class: "conn" }, status === "connecting" ? "connecting…" : "reconnecting…")
        : null,
    );
  }

  private render() {
    const u = this.last;
    const me = this.client?.playerId;
    if (!u || !me || this.stuck) return;
    const room = u.room;

    if (room.phase === "playing") {
      this.ticker ??= setInterval(() => this.renderControls(), 1000);
    } else {
      clearInterval(this.ticker);
      this.ticker = undefined;
    }

    if (room.phase === "lobby") {
      this.dropGameView();
      replaceChildren(this.body, this.lobby(room, me));
      return;
    }

    // playing / results: the game view stays mounted so the final board is visible.
    const panel = room.phase === "results" ? this.results(room, me) : null;
    this.renderControls();
    replaceChildren(this.body, panel, this.controls, this.gameHost);
    void this.ensureGameView(room.gameId).then((view) => {
      if (view && this.last === u) {
        view.update({ room, game: room.game, private: u.private, playerId: me, events: u.events, snapshot: u.snapshot });
      }
    });
  }

  private async ensureGameView(gameId: string): Promise<GameView | null> {
    if (this.gameView && this.gameViewFor === gameId) return this.gameView;
    this.dropGameView();
    this.gameViewFor = gameId;
    const entry = games[gameId];
    if (!entry) return null;
    const mod = await entry.loadClient();
    if (this.gameViewFor !== gameId || !this.client) return null; // navigated away mid-load
    const client = this.client;
    this.gameView = mod.createView({ act: (action) => client.act(action) });
    this.gameView.mount(this.gameHost);
    return this.gameView;
  }

  private dropGameView() {
    this.gameView?.destroy();
    this.gameView = null;
    this.gameViewFor = null;
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
          ? `${target.name} is disconnected. The game waits for them.`
          : `${target.name} dropped out. Waiting for them to come back…`),
      );
    }
    if (target && target.id !== me && !dropped && elapsed >= NUDGE_AFTER_MS) {
      items.push(
        h("button", {
          type: "button",
          onclick: () => {
            client.send({ type: "nudge" });
            this.showToast(`Nudged ${target.name}.`);
          },
        }, `Nudge ${target.name}`),
      );
    }
    if (isHost && target && target.id !== me && (dropped || elapsed >= SKIP_AFTER_MS)) {
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
              if (confirm(`Remove ${s.name}? Their cards will be played out automatically.`)) {
                client.send({ type: "remove-player", playerId: s.id });
              }
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
    const max = entry?.manifest.maxPlayers ?? 8;
    const url = `${location.origin}/room/${room.code}`;

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
          share.textContent = "Copied ✓";
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

    return h(
      "section",
      { class: "lobby" },
      h(
        "div",
        { class: "invite" },
        h("span", { class: "muted" }, "Room code"),
        h("strong", { class: "big-code", "aria-label": room.code.split("").join(" ") }, room.code),
        h("span", { class: "invite-url" }, url.replace(/^https?:\/\//, "")),
        share,
      ),
      h(
        "div",
        { class: "game-card" },
        brandMark("mark game-icon"),
        h("div", {}, h("h2", {}, entry?.manifest.name ?? room.gameId), entry ? h("p", { class: "muted" }, entry.manifest.description) : null),
        rules,
      ),
      h("h3", { class: "seats-title" }, `Players `, h("span", { class: "muted" }, `${seats.length}/${max}`)),
      h(
        "ul",
        { class: "seats" },
        seats.map((s) =>
          h(
            "li",
            { class: s.presence !== "connected" ? "away" : "" },
            avatar(s.name, s.avatarSeed),
            h("span", { class: "name" }, s.name, s.id === me ? h("span", { class: "muted" }, " (you)") : null),
            s.id === room.hostId ? h("span", { class: "tag" }, "host") : null,
            h("span", { class: `ready ${s.ready ? "yes" : ""}` }, s.presence !== "connected" ? "reconnecting…" : s.ready ? "ready ✓" : "not ready"),
            isHost && s.id !== me
              ? h("button", {
                  type: "button",
                  class: "kick",
                  "aria-label": `Remove ${s.name}`,
                  onclick: () => confirm(`Remove ${s.name} from the room?`) && this.client?.send({ type: "remove-player", playerId: s.id }),
                }, "✕")
              : null,
          ),
        ),
        // Empty seats up to the minimum make "how many more?" obvious at a glance.
        Array.from({ length: Math.max(0, min - seats.length) }, () =>
          h("li", { class: "empty" }, h("span", { class: "avatar avatar-md ghost", "aria-hidden": "true" }), h("span", { class: "muted" }, "Waiting for a player…")),
        ),
      ),
      h(
        "div",
        { class: "actions" },
        h(
          "button",
          { type: "button", "aria-pressed": String(!!mySeat?.ready), onclick: () => this.client?.send({ type: "ready", ready: !mySeat?.ready }) },
          mySeat?.ready ? "Not ready" : "I'm ready",
        ),
        isHost
          ? h(
              "button",
              { type: "button", class: "primary", disabled: connected < min || !room.canStart, onclick: () => this.client?.send({ type: "start-game" }) },
              connected < min ? `Need ${min - connected} more` : room.canStart ? "Start game" : "Waiting for players…",
            )
          : h("p", { class: "muted waiting" }, `Waiting for ${seatName(room, room.hostId)} to start.`),
      ),
      h("button", { type: "button", class: "link", onclick: () => this.leave() }, "Leave room"),
    );
  }

  private results(room: RoomPublicState, me: string) {
    const result = room.result;
    const isHost = room.hostId === me;
    const mySeat = room.seats.find((s) => s.id === me);
    const winner = result?.winnerIds[0];
    const readyCount = room.seats.filter((s) => s.ready).length;
    const winnerSeat = room.seats.find((s) => s.id === winner);

    return h(
      "section",
      { class: `results${winner === me ? " won" : ""}` },
      winnerSeat ? h("div", { class: "winner-badge" }, avatar(winnerSeat.name, winnerSeat.avatarSeed)) : null,
      h("h2", {}, winner ? (winner === me ? "You win!" : `${seatName(room, winner)} wins`) : "Game over"),
      h(
        "ol",
        { class: "standings" },
        (result?.standings ?? []).map((s, i) => {
          const seat = room.seats.find((x) => x.id === s.playerId);
          return h(
            "li",
            { class: s.playerId === me ? "me" : "" },
            h("span", { class: "place" }, String(i + 1)),
            seat ? avatar(seat.name, seat.avatarSeed, "sm") : null,
            h("span", { class: "name" }, s.playerId === me ? "You" : seatName(room, s.playerId)),
            h("span", { class: "muted" }, seat?.presence === "left" ? "left" : s.value === 0 ? "out!" : `${s.value} ${s.value === 1 ? "card" : "cards"} left`),
          );
        }),
      ),
      h(
        "div",
        { class: "actions" },
        isHost
          ? [
              h(
                "button",
                { type: "button", class: "primary", disabled: !room.canStart, onclick: () => this.client?.send({ type: "start-game" }) },
                room.canStart ? `Rematch${readyCount ? ` (${readyCount} ready)` : ""}` : "Waiting for players…",
              ),
              h("button", { type: "button", onclick: () => this.client?.send({ type: "return-to-lobby" }) }, "Back to lobby"),
            ]
          : h(
              "button",
              { type: "button", class: mySeat?.ready ? "" : "primary", "aria-pressed": String(!!mySeat?.ready), onclick: () => this.client?.send({ type: "ready", ready: !mySeat?.ready }) },
              mySeat?.ready ? "Waiting for host…" : "Play again",
            ),
        h("button", { type: "button", class: "link", onclick: () => this.leave() }, "Leave room"),
      ),
    );
  }

  private showMessage(message: string, code?: string) {
    this.dropGameView();
    replaceChildren(
      this.body,
      h(
        "section",
        { class: "message" },
        h("p", {}, message),
        code === "replaced-by-new-connection"
          ? h("button", { type: "button", class: "primary", onclick: () => (this.client?.reconnect(), replaceChildren(this.body, h("p", { class: "muted center" }, "Connecting…"))) }, "Use here")
          : null,
        code === "protocol-mismatch"
          ? h("button", { type: "button", class: "primary", onclick: () => location.reload() }, "Refresh")
          : null,
        h("button", { type: "button", onclick: () => navigate("/") }, "Home"),
      ),
    );
  }

  private openSettings() {
    const sound = h("input", { type: "checkbox", checked: audio.settings.sound });
    const volume = h("input", { type: "range", min: 0, max: 1, step: 0.05, value: audio.settings.volume, "aria-label": "Volume" });
    const haptics = h("input", { type: "checkbox", checked: audio.settings.haptics });
    sound.addEventListener("change", () => {
      audio.update({ sound: sound.checked });
      volume.disabled = !sound.checked;
      if (sound.checked) audio.play("card-place");
      this.renderHeader();
    });
    volume.disabled = !audio.settings.sound;
    volume.addEventListener("change", () => {
      audio.update({ volume: Number(volume.value) });
      audio.play("card-place"); // hear what you picked
    });
    haptics.addEventListener("change", () => {
      audio.update({ haptics: haptics.checked });
      if (haptics.checked) audio.buzz(30);
    });
    openDialog(
      "Settings",
      h(
        "div",
        { class: "settings" },
        h("label", {}, "Sounds", sound),
        h("label", {}, "Volume", volume),
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
