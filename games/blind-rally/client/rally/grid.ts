import type { RoomPublicState } from "@games/protocol";
import { avatar, h, replaceChildren, seatName, type GameClientApi } from "@games/ui";
import { rallyBriefing, rallyPreview } from "../../shared/rally.ts";
import { trackName } from "../../shared/tracks-public.ts";
import { formatClock } from "../../shared/wire.ts";
import { teamColor, type BlindRallyPublicState, type PublicTeam } from "../../shared/types.ts";
import { briefingCard } from "../briefing.ts";
import { raceElapsed, teamBadge } from "../role.ts";
import { coinFlipped, trackPicker } from "../stages.ts";
import type { Lobby } from "../view.ts";

const STATUS_LABEL = { running: "On stage", finished: "Finished", dnf: "DNF" } as const;

/**
 * Rally's lobby: the grid. Nobody picks a seat (everyone has a car of their
 * own the moment they're in), so it's the track, the cars, your briefing
 * and Start. Also what spares watch from mid-race, and the backdrop under
 * the results.
 */
export class RallyGrid implements Lobby {
  readonly el = h("section", { class: "br-layer br-teams br-grid-screen", "aria-label": "Starting grid" });
  private api: GameClientApi;
  private note = h("p", { class: "br-note", role: "status", "aria-live": "polite" });
  private clock = h("span", { class: "br-tclock" });
  private ticker: ReturnType<typeof setInterval> | undefined;
  private game: BlindRallyPublicState | null = null;

  constructor(api: GameClientApi) {
    this.api = api;
  }

  destroy() {
    clearInterval(this.ticker);
  }

  rejected(message: string) {
    this.note.textContent = message;
    this.note.classList.add("err");
  }

  update(room: RoomPublicState, game: BlindRallyPublicState, me: string) {
    this.game = game;
    this.note.textContent = "";
    this.note.classList.remove("err");
    const isHost = room.hostId === me;
    const editable = game.phase === "teams";
    const cars = game.teams.filter((t) => t.driverId !== null);
    const seated = new Set(cars.map((t) => t.driverId));
    const spares = game.players.filter((p) => !seated.has(p.id));
    const ready = (id: string) => game.players.find((p) => p.id === id)?.ready ?? false;
    const name = (id: string) => seatName(room, id);

    const person = (id: string) => {
      const s = room.seats.find((x) => x.id === id);
      return h(
        "div",
        { class: `br-person${id === me ? " me" : ""}${s && s.presence !== "connected" ? " away" : ""}` },
        avatar(s?.name ?? "?", s?.avatarSeed ?? id, "sm"),
        h("span", { class: "br-name" }, name(id), id === me ? h("span", { class: "br-you" }, "you") : null),
      );
    };

    const status = (team: PublicTeam) =>
      team.status
        ? h(
            "span",
            { class: `br-status br-status-${team.status}${team.away.length ? " paused" : ""}` },
            team.away.length && team.status === "running" ? "Paused" : STATUS_LABEL[team.status],
            team.timeMs !== null ? ` ${formatClock(team.timeMs)}` : "",
            team.resets ? ` · ${team.resets} reset${team.resets === 1 ? "" : "s"}` : "",
          )
        : editable
          ? h("span", { class: `br-ready${ready(team.driverId!) ? " on" : ""}` }, ready(team.driverId!) ? "Ready" : "Not ready")
          : null;

    const card = (team: PublicTeam) =>
      h(
        "article",
        {
          class: `br-team br-car${team.driverId === me ? " mine" : ""}`,
          "aria-label": `Car ${team.id}, ${teamColor(team.color).name}`,
          style: `--br-team: ${teamColor(team.color).hex}`,
        },
        h("header", {}, h("h3", {}, teamBadge(team, "Car")), status(team)),
        person(team.driverId!),
      );

    const mine = cars.find((t) => t.driverId === me);
    const amReady = ready(me);
    // In a car and not ready: the briefing card is the ready control.
    const brief = editable && mine && !amReady
      ? briefingCard(rallyBriefing(room.settings), mine, "Your car", [
          h("button", { type: "button", class: "primary br-ready-btn", onclick: () => this.api.act({ type: "player.ready", ready: true }) }, "I'm ready"),
        ], "Car")
      : null;

    const bar: (Node | null)[] = [];
    if (editable && mine && !brief) {
      // Ready, but the course hasn't loaded yet: a way back out.
      bar.push(
        h("p", { class: "br-me" }, `You're in Car ${mine.id}.`),
        h("button", { type: "button", class: "primary br-ready-btn on", "aria-pressed": "true", onclick: () => this.api.act({ type: "player.ready", ready: false }) }, "Ready"),
      );
    } else if (editable && !mine) {
      bar.push(h("p", { class: "br-me" }, "Every car's taken. You're watching; the next free one is yours."));
    } else if (!editable && game.phase !== "finished") {
      bar.push(h("p", { class: "br-me" }, mine ? "Your car's out." : "You're watching this one."));
    }

    const host: (Node | null)[] = [];
    if (isHost && editable) {
      host.push(
        h("button", { type: "button", class: "primary br-start", disabled: game.startBlocker !== null, onclick: () => this.api.act({ type: "race.start" }) }, "Start race"),
        game.startBlocker ? h("p", { class: "br-blocker" }, game.startBlocker) : null,
      );
    } else if (editable) {
      host.push(h("p", { class: "br-blocker" }, game.startBlocker ?? "Everyone's ready. Over to the host."));
    } else if (isHost && game.phase !== "finished") {
      host.push(h("button", { type: "button", class: "link", onclick: () => confirm("End the race now? Anyone still out is DNF.") && this.api.act({ type: "race.end" }) }, "End race"));
    }

    replaceChildren(
      this.el,
      h(
        "header",
        { class: "br-head" },
        h("h2", { class: "br-title" }, "Rally"),
        h("p", { class: "br-sub" }, `${trackName(game.tracks, game.trackId)}, shared stage, ${game.timeLimitMs / 60_000} min`, this.clock),
      ),
      editable ? trackPicker(this.api, game, me, isHost, name, true) : null,
      h("section", { class: "br-cars", "aria-label": "Cars" }, h("h3", {}, editable ? "On the grid" : "Cars"), h("div", { class: "br-grid br-car-grid" }, cars.map(card))),
      brief,
      h(
        "section",
        { class: "br-rules", "aria-label": "Rules for this race" },
        h("h3", {}, editable ? "This race" : "Rules"),
        h("dl", {}, rallyPreview(room.settings, { name: trackName(game.tracks, game.trackId), tie: coinFlipped(game) }).flatMap((r) => [h("dt", {}, r.label), h("dd", {}, r.value)])),
      ),
      spares.length ? h("div", { class: "br-spares" }, h("h3", {}, "Watching"), h("div", { class: "br-spare-list" }, spares.map((p) => person(p.id)))) : null,
      bar.length || host.length ? h("div", { class: "br-bar" }, bar, host) : null,
      this.note,
    );

    clearInterval(this.ticker);
    this.ticker = undefined;
    this.tick();
    if (game.phase === "countdown" || game.phase === "racing") this.ticker = setInterval(() => this.tick(), 100);
  }

  private tick() {
    const g = this.game;
    if (!g || g.startsAt === null) return void (this.clock.textContent = "");
    const now = this.api.serverNow();
    this.clock.textContent = now < g.startsAt ? `, starts in ${Math.ceil((g.startsAt - now) / 1000)}` : `, ${formatClock(raceElapsed(g, now))}`;
  }
}
