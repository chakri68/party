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
import { canTransition, transition } from "../transition.ts";
import { identityField, nameInput } from "./home.ts";

const STUCK_AFTER_MS = 15_000;

const FATAL_COPY: Record<string, string> = {
  "room-not-found": "That room doesn't exist (or everyone left and it closed).",
  "room-full": "This room is full.",
  "game-in-progress": "A game is already underway. You can join once this round ends.",
  "replaced-by-new-connection": "This room is open in another tab.",
  "protocol-mismatch": "A new version is out. Refresh to keep playing.",
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
  /** Which screen the body shows, so we know when a change deserves motion. */
  private screen: string | null = null;

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

  /**
   * Every body swap goes through here. A new screen gets a view transition;
   * the lobby also animates its own updates (only named blocks move). The
   * first screen doesn't: it's already inside the router's page transition.
   */
  private show(screen: string, update: () => void | Promise<void>) {
    const first = this.screen === null;
    const kind = screen !== this.screen ? "phase" : screen === "lobby" ? "lobby" : null;
    this.screen = screen;
    if (first || !kind) void update();
    else transition(kind, update);
  }

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

  private connect() {
    const me = getIdentity();
    this.show("connecting", () => replaceChildren(this.body, h("p", { class: "muted center" }, "Connecting…")));
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
      // A snapshot already has everything the backlog would add.
      if (u.snapshot) this.streamBacklog = [];
      if (prev && prev.room.hostId !== client.playerId && u.room.hostId === client.playerId) {
        this.showToast("You're the host now.");
      }
      this.render();
    });
    client.on("stream", (m) => {
      if (this.gameView && this.gameViewFed) this.gameView.stream?.(m.from, m.data);
      else if (this.last?.room.phase === "playing") this.streamBacklog.push(m);
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
    const screen = h(
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
    );
    // Drop the game inside the swap, so the snapshot we animate from still has it.
    this.show("stuck", () => {
      this.dropGameView();
      replaceChildren(this.body, screen);
    });
  }

  private leave() {
    if (this.last?.room.phase === "playing" && !confirm("Leave the game? You'll be out for the rest of this round.")) {
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
      const lobby = this.lobby(room, me);
      this.show("lobby", () => {
        this.dropGameView();
        replaceChildren(this.body, lobby);
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
        this.show("results", () => arrange(this.body, panel, this.controls, this.gameHost));
      });
      return;
    }

    // The panel pops in by itself only when it's new and no view transition
    // brings it in; otherwise it would rise twice, or again on every update.
    const arriving = this.screen !== null && this.screen !== "results" && !canTransition();
    const panel = room.phase === "results" ? this.results(room, me, arriving) : null;
    this.show(room.phase, async () => {
      arrange(this.body, panel, this.controls, this.gameHost);
      // Awaited so the transition's "after" picture has the game in it.
      const view = await this.ensureGameView(room.gameId);
      if (view && this.last === u) {
        view.update(props);
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
    const loading = entry.loadClient().then((mod) => {
      // Navigated away, or dropped for another game, mid-load.
      if (this.gameViewLoading !== loading || !this.client) return null;
      this.gameViewLoading = null;
      const client = this.client;
      this.gameView = mod.createView({
        act: (action) => client.act(action),
        stream: (data) => client.stream(data),
        serverNow: () => client.serverNow(),
      });
      this.gameView.mount(this.gameHost);
      return this.gameView;
    });
    this.gameViewLoading = loading;
    return loading;
  }

  private dropGameView() {
    this.gameView?.destroy();
    this.gameView = null;
    this.gameViewFor = null;
    this.gameViewLoading = null;
    this.gameViewFed = false;
    this.streamBacklog = [];
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
              if (confirm(`Remove ${s.name}? They'll be out for the rest of this round.`)) {
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

    // Named blocks move smoothly when the lobby updates (someone joins, the
    // game changes) instead of the page jumping. Only a name-to-be: CSS
    // applies it during lobby transitions alone, so page changes still move
    // the lobby as one piece. Names must be page-unique.
    const vt = (name: string) => `--vt: ${name}`;

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
      ),
      h(
        "div",
        { class: "game-card", style: vt("lobby-game") },
        brandMark("mark game-icon"),
        h("div", { class: "game-card-text" }, h("h2", {}, entry?.manifest.name ?? room.gameId), entry ? h("p", { class: "muted" }, entry.manifest.description) : null),
        h(
          "div",
          { class: "game-card-links" },
          isHost && Object.keys(games).length > 1
            ? h("button", { type: "button", class: "link", onclick: () => this.openGameList(room.gameId, seats.length) }, "Change")
            : null,
          rules,
        ),
      ),
      this.gameSettings(room, isHost, seats.length, vt("lobby-settings")),
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
        Array.from({ length: Math.max(0, min - seats.length) }, (_, i) =>
          h("li", { class: "empty", style: vt(`seat-empty-${i}`) }, h("span", { class: "avatar avatar-md ghost", "aria-hidden": "true" }), h("span", { class: "muted" }, "Waiting for a player…")),
        ),
      ),
      h(
        "div",
        { class: "actions", style: vt("lobby-actions") },
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
      h("button", { type: "button", class: "link", style: vt("lobby-leave"), onclick: () => this.leave() }, "Leave room"),
    );
  }

  /**
   * Host-only: pick the room's game from a list. Built to grow: a search box
   * shows up once there are enough games to need one, and games that can't
   * seat everyone here say so instead of failing at "Start game".
   */
  private openGameList(current: string, players: number) {
    const all = Object.entries(games);
    const search = all.length > 6
      ? h("input", { type: "search", class: "game-search", placeholder: "Search games", "aria-label": "Search games", autocomplete: "off" })
      : null;
    const empty = h("p", { class: "muted center", hidden: true }, "No games match.");

    const rows = all.map(([id, entry]) => {
      const { name, description, minPlayers, maxPlayers } = entry.manifest;
      const tooMany = players > maxPlayers;
      const range = minPlayers === maxPlayers ? `${minPlayers} players` : `${minPlayers}–${maxPlayers} players`;
      const row = h(
        "li",
        {},
        h(
          "button",
          {
            type: "button",
            class: "game-option",
            "aria-current": id === current ? "true" : undefined,
            disabled: tooMany && id !== current,
            onclick: () => {
              if (id !== current) this.client?.send({ type: "select-game", gameId: id });
              dlg.close();
            },
          },
          brandMark("mark game-icon"),
          h(
            "span",
            { class: "game-option-text" },
            h("span", { class: "game-option-name" }, name, id === current ? h("span", { class: "tag" }, "current") : null),
            h("span", { class: "muted" }, description),
            h("span", { class: `game-option-meta${tooMany ? " warn" : ""}` }, tooMany ? `Up to ${maxPlayers} players, you're ${players}` : range),
          ),
        ),
      );
      return { row, text: `${name} ${description}`.toLowerCase() };
    });

    search?.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      let shown = 0;
      for (const r of rows) {
        r.row.hidden = !!q && !r.text.includes(q);
        if (!r.row.hidden) shown++;
      }
      empty.hidden = shown > 0;
    });

    const dlg = h(
      "dialog",
      { class: "dialog game-list", "aria-label": "Pick a game" },
      h("h2", {}, "Pick a game"),
      search,
      h("ul", { class: "game-options" }, rows.map((r) => r.row)),
      empty,
      h("form", { method: "dialog" }, h("button", {}, "Close")),
    );
    dlg.addEventListener("close", () => dlg.remove());
    dlg.addEventListener("click", (e) => e.target === dlg && dlg.close());
    document.body.append(dlg);
    dlg.showModal();
    // Start on the current game, not the search box: on phones that'd pop the keyboard.
    (dlg.querySelector<HTMLButtonElement>('.game-option[aria-current="true"]') ?? dlg.querySelector("button"))?.focus();
  }

  /** The game's own settings, rendered from its field descriptions (host edits, others read). */
  private gameSettings(room: RoomPublicState, isHost: boolean, players: number, style?: string) {
    const fields = games[room.gameId]?.settingFields(room.settings, players) ?? [];
    if (!fields.length) return null;
    return h(
      "div",
      { class: "game-settings", style },
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
                if (patch) this.client?.send({ type: "update-settings", settings: { ...(room.settings as object), ...patch } });
              });
              return select;
            })()
          : h("span", { id, class: "setting-value" }, f.options[f.selected]?.label ?? "");
        return h(
          "div",
          { class: "setting" },
          h("label", { for: id }, f.label),
          value,
          f.hint ? h("span", { class: "muted setting-hint" }, f.hint) : null,
        );
      }),
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
    const featured = room.seats.find((s) => s.id === (loser ?? winner));
    const won = loser ? loser !== me && !!result?.winnerIds.includes(me) : !!result?.winnerIds.includes(me);
    // A shared win names everyone in it, you first if you're one.
    const tied = loser ? [] : [...(result?.winnerIds ?? [])].sort((a, b) => Number(b === me) - Number(a === me));
    const names = (ids: string[]) => ids.map((id) => (id === me ? "You" : seatName(room, id))).join(ids.length > 2 ? ", " : " and ").replace(/, ([^,]*)$/, " and $1");
    const headline = loser
      ? loser === me ? "You lose" : `${seatName(room, loser)} loses`
      : tied.length > 1 ? `${names(tied)} tie`
      : winner ? (winner === me ? "You win!" : `${seatName(room, winner)} wins`) : "Game over";

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
            h("span", { class: "place" }, String(i + 1)),
            seat ? avatar(seat.name, seat.avatarSeed, "sm") : null,
            h("span", { class: "name" }, s.playerId === me ? "You" : seatName(room, s.playerId)),
            h("span", { class: "muted" }, seat?.presence === "left" ? "left" : s.label ?? (s.value === 0 ? "out!" : `${s.value} ${s.value === 1 ? "card" : "cards"} left`)),
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
    const screen = h(
      "section",
      { class: "message" },
      h("p", {}, message),
      code === "replaced-by-new-connection"
        ? h("button", { type: "button", class: "primary", onclick: () => (this.client?.reconnect(), this.show("connecting", () => replaceChildren(this.body, h("p", { class: "muted center" }, "Connecting…")))) }, "Use here")
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
