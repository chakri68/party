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
import { h, replaceChildren, seatName, type GameView, type View } from "@games/ui";
import { games } from "../games.ts";
import { getIdentity, getResumeToken, setDisplayName, setResumeToken } from "../identity.ts";
import { navigate } from "../router.ts";
import { nameInput } from "./home.ts";

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
    this.renderHeader();
    if (getIdentity().displayName) this.connect();
    else this.askName();
  }

  update() {}

  destroy() {
    clearTimeout(this.toastTimer);
    clearInterval(this.ticker);
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
    });
    this.client = client;

    client.on("status", () => this.renderHeader());
    client.on("welcome", ({ resumeToken }) => setResumeToken(this.code, resumeToken));
    client.on("update", (u) => {
      this.last = u;
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
      this.showMessage(FATAL_COPY[code] ?? message, code === "replaced-by-new-connection");
    });
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
      h("a", { href: "/", class: "brand", onclick: (e: Event) => (e.preventDefault(), navigate("/")) }, "Party Games"),
      h("span", { class: "room-code", "aria-label": `Room ${this.code.split("").join(" ")}` }, this.code),
      status === "reconnecting" || status === "connecting"
        ? h("span", { class: "conn" }, status === "connecting" ? "connecting…" : "reconnecting…")
        : null,
    );
  }

  private render() {
    const u = this.last;
    const me = this.client?.playerId;
    if (!u || !me) return;
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
        view.update({ room, game: room.game, private: u.private, playerId: me, events: u.events });
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
        }, `👋 Nudge ${target.name}`),
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
    const connected = room.seats.filter((s) => s.presence === "connected").length;
    const min = entry?.manifest.minPlayers ?? 2;
    const url = `${location.origin}/room/${room.code}`;

    const share = h("button", { type: "button" }, "Copy invite link");
    share.addEventListener("click", async () => {
      const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
      try {
        if (nav.share && matchMedia("(pointer: coarse)").matches) {
          await nav.share({ title: "Join my game", text: `Room ${room.code}`, url });
        } else {
          await navigator.clipboard.writeText(url);
          this.showToast("Link copied.");
        }
      } catch {
        // User dismissed the share sheet; nothing to do.
      }
    });

    return h(
      "section",
      { class: "lobby" },
      h("div", { class: "big-code" }, h("span", { class: "muted" }, "Room code"), h("strong", {}, room.code)),
      share,
      h("h2", {}, entry ? `${entry.manifest.icon} ${entry.manifest.name}` : room.gameId),
      entry ? h("p", { class: "muted" }, entry.manifest.description) : null,
      h(
        "ul",
        { class: "seats" },
        room.seats.filter((s) => s.presence !== "left").map((s) =>
          h(
            "li",
            { class: s.presence !== "connected" ? "away" : "" },
            h("span", { class: "name" }, s.name, s.id === me ? " (you)" : ""),
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
      ),
      h(
        "div",
        { class: "actions" },
        h(
          "button",
          { type: "button", onclick: () => this.client?.send({ type: "ready", ready: !mySeat?.ready }) },
          mySeat?.ready ? "Not ready" : "Ready",
        ),
        isHost
          ? h(
              "button",
              { type: "button", class: "primary", disabled: connected < min, onclick: () => this.client?.send({ type: "start-game" }) },
              connected < min ? `Need ${min - connected} more` : "Start game",
            )
          : h("p", { class: "muted" }, `Waiting for ${seatName(room, room.hostId)} to start.`),
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

    return h(
      "section",
      { class: "results" },
      h("h2", {}, winner ? (winner === me ? "You win! 🎉" : `${seatName(room, winner)} wins`) : "Game over"),
      h(
        "ol",
        { class: "standings" },
        (result?.standings ?? []).map((s) =>
          h(
            "li",
            {},
            h("span", {}, s.playerId === me ? "You" : seatName(room, s.playerId)),
            h("span", { class: "muted" }, room.seats.find((x) => x.id === s.playerId)?.presence === "left"
              ? "left"
              : `${s.value} ${s.value === 1 ? "card" : "cards"}`),
          ),
        ),
      ),
      h(
        "div",
        { class: "actions" },
        isHost
          ? [
              h("button", { type: "button", class: "primary", onclick: () => this.client?.send({ type: "start-game" }) }, `Rematch${readyCount ? ` (${readyCount} ready)` : ""}`),
              h("button", { type: "button", onclick: () => this.client?.send({ type: "return-to-lobby" }) }, "Back to lobby"),
            ]
          : h(
              "button",
              { type: "button", class: mySeat?.ready ? "" : "primary", onclick: () => this.client?.send({ type: "ready", ready: !mySeat?.ready }) },
              mySeat?.ready ? "Waiting for host…" : "Play again",
            ),
        h("button", { type: "button", class: "link", onclick: () => this.leave() }, "Leave room"),
      ),
    );
  }

  private showMessage(message: string, useHere = false) {
    this.dropGameView();
    replaceChildren(
      this.body,
      h(
        "section",
        { class: "message" },
        h("p", {}, message),
        useHere
          ? h("button", { type: "button", class: "primary", onclick: () => (this.client?.reconnect(), replaceChildren(this.body, h("p", { class: "muted center" }, "Connecting…"))) }, "Use here")
          : null,
        h("button", { type: "button", onclick: () => navigate("/") }, "Home"),
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
