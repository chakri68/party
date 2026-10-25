import type { RoomPublicState } from "@games/protocol";
import { avatar, h, replaceChildren, seatName, type GameClientApi } from "@games/ui";
import { rulesPreview } from "../shared/rules-text.ts";
import { trackName } from "../shared/tracks-public.ts";
import { formatClock } from "../shared/wire.ts";
import { teamColor, type BlindRallyPublicState, type PublicTeam, type Role } from "../shared/types.ts";
import { raceElapsed, teamBadge } from "./role.ts";

const ROLE_NAME: Record<Role, string> = { driver: "Driver", navigator: "Navigator" };
const ROLE_JOB: Record<Role, string> = {
  driver: "Pedals and wheel. No road.",
  navigator: "Sees the course. No pedals.",
};
const STATUS_LABEL = { running: "On stage", finished: "Finished", dnf: "DNF" } as const;

/**
 * The TEAMS phase: cars, seats, ready-up and the host's Start. Also what
 * spares watch during the race, and the backdrop under the results panel.
 */
export class TeamsScreen {
  readonly el = h("section", { class: "br-layer br-teams", "aria-label": "Teams" });
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
    const seated = new Set(game.teams.flatMap((t) => [t.driverId, t.navigatorId]).filter(Boolean));
    const spares = game.players.filter((p) => !seated.has(p.id));

    const ready = (id: string) => game.players.find((p) => p.id === id)?.ready ?? false;
    const name = (id: string) => seatName(room, id);
    const seatOf = room.seats.find.bind(room.seats);

    // The host's one control for anyone: a seat picker next to their name.
    const mover = (playerId: string) => {
      if (!isHost || !editable) return null;
      const here = game.teams.flatMap((t) => (["driver", "navigator"] as Role[]).filter((r) => (r === "driver" ? t.driverId : t.navigatorId) === playerId).map((r) => `${t.id}:${r}`))[0] ?? "";
      const select = h(
        "select",
        { class: "br-move", "aria-label": `Move ${name(playerId)}` },
        h("option", { value: "" }, "Spare"),
        game.teams.flatMap((t) => (["driver", "navigator"] as Role[]).map((r) => h("option", { value: `${t.id}:${r}` }, `Team ${t.id} ${ROLE_NAME[r]}`))),
      );
      select.value = here;
      select.addEventListener("change", () => {
        const [team, role] = select.value.split(":");
        this.api.act(team ? { type: "team.assign", playerId, teamId: Number(team), role } : { type: "team.assign", playerId, teamId: null });
      });
      return select;
    };

    const person = (id: string, tag?: Node | null) => {
      const s = seatOf((x) => x.id === id);
      return h(
        "div",
        { class: `br-person${id === me ? " me" : ""}${s && s.presence !== "connected" ? " away" : ""}` },
        avatar(s?.name ?? "?", s?.avatarSeed ?? id, "sm"),
        h("span", { class: "br-name" }, name(id), id === me ? h("span", { class: "br-you" }, "you") : null, tag ?? null),
        mover(id),
      );
    };

    const seatCell = (team: PublicTeam, role: Role) => {
      const id = role === "driver" ? team.driverId : team.navigatorId;
      const captain = id !== null && team.captainId === id;
      return h(
        "div",
        { class: `br-slot br-slot-${role}${id ? " taken" : ""}` },
        h(
          "div",
          { class: "br-slot-head" },
          h("span", { class: "br-role" }, ROLE_NAME[role]),
          id && editable ? h("span", { class: `br-ready${ready(id) ? " on" : ""}` }, ready(id) ? "Ready" : "Not ready") : null,
        ),
        id
          ? person(id, captain ? h("span", { class: "br-captain", title: "Captain: votes for the team" }, "captain") : null)
          : editable
            ? h("button", { type: "button", class: "br-sit", onclick: () => this.api.act({ type: "team.join", teamId: team.id, role }) }, "Sit here")
            : h("p", { class: "br-empty" }, "Empty"),
        !id && editable ? h("p", { class: "br-job" }, ROLE_JOB[role]) : null,
      );
    };

    const card = (team: PublicTeam) =>
      h(
        "article",
        {
          class: `br-team${team.driverId === me || team.navigatorId === me ? " mine" : ""}`,
          "aria-label": `Team ${team.id}, ${teamColor(team.color).name}`,
          style: `--br-team: ${teamColor(team.color).hex}`,
        },
        h(
          "header",
          {},
          h("h3", {}, teamBadge(team)),
          team.status
            ? h(
                "span",
                { class: `br-status br-status-${team.status}${team.away.length ? " paused" : ""}` },
                team.away.length && team.status === "running" ? "Paused" : STATUS_LABEL[team.status],
                team.timeMs !== null ? ` ${formatClock(team.timeMs)}` : "",
                team.penaltyMs ? ` +${team.penaltyMs / 1000} s` : "",
              )
            : null,
        ),
        seatCell(team, "driver"),
        seatCell(team, "navigator"),
      );

    const mine = game.teams.find((t) => t.driverId === me || t.navigatorId === me);
    const myRole: Role | null = mine ? (mine.driverId === me ? "driver" : "navigator") : null;
    const amReady = ready(me);

    const bar: (Node | null)[] = [];
    if (editable && mine && myRole) {
      const otherRole: Role = myRole === "driver" ? "navigator" : "driver";
      bar.push(
        h("p", { class: "br-me" }, `You're the ${ROLE_NAME[myRole]} in Team ${mine.id}.`),
        h("button", { type: "button", onclick: () => this.api.act({ type: "role.pick", role: otherRole }) }, `Be ${ROLE_NAME[otherRole]}`),
        h("button", { type: "button", class: "link", onclick: () => this.api.act({ type: "team.leave" }) }, "Leave seat"),
        h("button", { type: "button", class: `primary br-ready-btn${amReady ? " on" : ""}`, "aria-pressed": String(amReady), onclick: () => this.api.act({ type: "player.ready", ready: !amReady }) }, amReady ? "Ready" : "Ready up"),
      );
    } else if (editable) {
      bar.push(h("p", { class: "br-me" }, "Pick an empty seat, or watch from here."));
    } else if (game.phase === "finished") {
      bar.push(h("p", { class: "br-me" }, "Swapping seats? The rematch starts you in these cars; swap there."));
    } else {
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
        h("h2", { class: "br-title" }, "Blind Rally"),
        h("p", { class: "br-sub" }, `${trackName(game.trackId)}, ${game.mode === "practice" ? "practice" : `${game.stageMode} stage race`}, ${game.timeLimitMs / 60_000} min`, this.clock),
      ),
      h("div", { class: "br-grid" }, game.teams.map(card)),
      // Everyone sees the rules before they ready up (spec §4.3): the room's settings, in words.
      h(
        "section",
        { class: "br-rules", "aria-label": "Rules for this race" },
        h("h3", {}, editable ? "This race" : "Rules"),
        h("dl", {}, rulesPreview(room.settings).flatMap((r) => [h("dt", {}, r.label), h("dd", {}, r.value)])),
      ),
      spares.length
        ? h("div", { class: "br-spares" }, h("h3", {}, editable ? "Not in a car" : "Watching"), h("div", { class: "br-spare-list" }, spares.map((p) => person(p.id))))
        : null,
      h("div", { class: "br-bar" }, bar, host),
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
