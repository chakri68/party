import type { RoomPublicState } from "@games/protocol";
import { avatar, h, replaceChildren, seatName, type GameClientApi } from "@games/ui";
import { roleBriefing, rulesPreview, type BriefingLine } from "../shared/rules-text.ts";
import { trackName } from "../shared/tracks-public.ts";
import { formatClock } from "../shared/wire.ts";
import { teamColor, type BlindRallyPublicState, type PublicTeam, type PublicTrack, type Role } from "../shared/types.ts";
import { raceElapsed, teamBadge } from "./role.ts";

const ROLE_NAME: Record<Role, string> = { driver: "Driver", navigator: "Navigator" };
const ROLE_JOB: Record<Role, string> = {
  driver: "Pedals and wheel. No road.",
  navigator: "Sees the course. No pedals.",
};
const STATUS_LABEL = { running: "On stage", finished: "Finished", dnf: "DNF" } as const;

const DIFFICULTY = { easy: ["Easy", 1], medium: ["Medium", 2], hard: ["Hard", 3] } as const;
const km = (m: number) => `${(m / 1000).toFixed(1)} km`;
const SVG = "http://www.w3.org/2000/svg";

/**
 * A track's badge: a road from a start post to a chequered flag, wigglier
 * the harder it is, with a dot per landmark spaced evenly along it. Not a
 * map, on purpose: everyone in the lobby may end up a Driver (seats swap
 * until the start), and the Driver never gets the road's shape (spec §4.1).
 * Two tracks with the same difficulty and landmark count draw the same.
 */
function stageBadge(t: PublicTrack): SVGSVGElement {
  const [, level] = DIFFICULTY[t.difficulty];
  const w = 200;
  const mid = 15;
  const x0 = 12;
  const x1 = w - 14;
  const amp = 2 + level * 2;
  const waves = level + 0.5;
  const y = (x: number) => mid + amp * Math.sin(((x - x0) / (x1 - x0)) * waves * 2 * Math.PI);
  const pts: string[] = [];
  for (let x = x0; x <= x1; x += 2) pts.push(`${x},${y(x).toFixed(1)}`);
  const n = Math.min(t.landmarkCount, 12);
  const dots = Array.from({ length: n }, (_, i) => {
    const x = x0 + ((i + 1) / (n + 1)) * (x1 - x0);
    return `<circle cx="${x.toFixed(1)}" cy="${y(x).toFixed(1)}" r="2.1"/>`;
  }).join("");
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} 30`);
  svg.setAttribute("class", "br-track-badge");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML =
    `<polyline class="road" points="${pts.join(" ")}"/>` +
    `<g class="sights">${dots}</g>` +
    `<rect class="post" x="${x0 - 4}" y="${y(x0) - 6}" width="3" height="12" rx="1"/>` +
    // A 2×2 chequer on a pole.
    `<g class="flag" transform="translate(${x1 + 2} ${y(x1) - 9})"><rect width="1.6" height="16" rx=".8"/>` +
    `<rect x="1.6" width="4" height="4"/><rect x="5.6" y="4" width="4" height="4"/><rect class="hole" x="5.6" width="4" height="4"/><rect class="hole" x="1.6" y="4" width="4" height="4"/></g>`;
  return svg;
}

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
    // Seated and not ready: the briefing card is the ready control (it carries the role buttons too).
    const brief = editable && mine && myRole && !amReady ? this.briefing(room.settings, mine, myRole) : null;
    if (editable && mine && myRole) {
      const otherRole: Role = myRole === "driver" ? "navigator" : "driver";
      // Ready, but the seat's screen hasn't loaded yet: the old row, to back out of it.
      if (!brief) bar.push(
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
        h("p", { class: "br-sub" }, `${trackName(game.tracks, game.trackId)}, ${game.mode === "practice" ? "practice" : `${game.stageMode} stage race`}, ${game.timeLimitMs / 60_000} min`, this.clock),
      ),
      editable ? this.stages(game, me, isHost, name) : null,
      h("div", { class: "br-grid" }, game.teams.map(card)),
      brief,
      // Everyone sees the rules before they ready up (spec §4.3): the room's settings, in words.
      h(
        "section",
        { class: "br-rules", "aria-label": "Rules for this race" },
        h("h3", {}, editable ? "This race" : "Rules"),
        h("dl", {}, rulesPreview(room.settings, { name: trackName(game.tracks, game.trackId), tie: this.coinFlipped(game) }).flatMap((r) => [h("dt", {}, r.label), h("dd", {}, r.value)])),
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

  /**
   * Before ready-up: your seat's job and every control it has, for this
   * race's settings. "I'm ready" here is the only ready button, so nobody
   * gets to the start without having had it in front of them. Mid-race (a
   * rejoin) the seat's screen is up instead and this never shows.
   */
  private briefing(settings: unknown, team: PublicTeam, role: Role) {
    const b = roleBriefing(role, settings);
    const other: Role = role === "driver" ? "navigator" : "driver";
    const keys = (line: BriefingLine) =>
      line.keys.length
        ? h("span", { class: "br-keys" }, line.keys.flatMap((chord, i) => [i ? h("span", { class: "br-keys-or" }, "or") : null, ...chord.map((k) => h("kbd", {}, k))]))
        : null;
    return h(
      "section",
      { class: "br-brief", "aria-label": "Your briefing", style: `--br-team: ${teamColor(team.color).hex}` },
      h(
        "header",
        { class: "br-brief-head" },
        h("p", { class: "br-brief-kicker" }, teamBadge(team), h("span", {}, ROLE_NAME[role])),
        h("h3", { class: "br-brief-title" }, b.title),
        h("p", { class: "br-brief-lead" }, b.lead),
      ),
      h("dl", { class: "br-brief-list" }, b.lines.flatMap((line) => [h("dt", {}, line.label), h("dd", {}, keys(line), h("span", {}, line.text))])),
      h(
        "footer",
        { class: "br-brief-foot" },
        h("button", { type: "button", class: "link", onclick: () => this.api.act({ type: "team.leave" }) }, "Leave seat"),
        h("button", { type: "button", onclick: () => this.api.act({ type: "role.pick", role: other }) }, `Be ${ROLE_NAME[other]}`),
        h("button", { type: "button", class: "primary br-ready-btn", onclick: () => this.api.act({ type: "player.ready", ready: true }) }, "I'm ready"),
      ),
    );
  }

  /** The track's on a coin flip: the ballot's top was level and the seed broke it. */
  private coinFlipped(game: BlindRallyPublicState) {
    return !!game.ballot && game.ballot.tied.length > 1 && game.ballot.tied.includes(game.trackId);
  }

  /**
   * TEAMS only: a card per track. The host taps one to pick it; in a team
   * vote, a captain taps one to cast the car's vote (again to take it back),
   * and every vote shows as that team's door plate on its card.
   */
  private stages(game: BlindRallyPublicState, me: string, isHost: boolean, name: (id: string) => string) {
    const ballot = game.ballot;
    const mine = game.teams.find((t) => t.driverId === me || t.navigatorId === me);
    const captain = !!ballot && !!mine && mine.captainId === me;
    const myVote = ballot && mine ? ballot.votes.find((v) => v.teamId === mine.id)?.trackId ?? null : null;
    const canPick = !ballot && isHost;
    const single = game.tracks.length < 2;

    const hint = ballot
      ? captain
        ? `You vote for Team ${mine!.id}. Tap again to take it back.`
        : mine
          ? mine.captainId ? `${name(mine.captainId)} votes for your car, as captain.` : "Your car's captain votes."
          : "Each car's captain votes. Sit down to have a say."
      : isHost
        ? single ? "One track so far. More on the way." : "Tap a track to race it."
        : "The host picks the track.";
    const tail = ballot && !ballot.votes.length ? ` No votes yet: it's ${trackName(game.tracks, game.trackId)} until someone votes.` : "";

    const card = (t: PublicTrack) => {
      const chosen = t.id === game.trackId;
      const votes = ballot ? ballot.votes.filter((v) => v.trackId === t.id) : [];
      const tag = chosen
        ? this.coinFlipped(game)
          ? "Tie: picked by coin flip"
          : ballot ? (ballot.votes.length ? "Leading" : "Racing this, for now") : "Racing this"
        : "";
      const actionable = canPick || captain;
      const body = [
        h("span", { class: "br-track-head" }, h("span", { class: "br-track-name" }, t.name), h("span", { class: `br-diff br-diff-${t.difficulty}` }, DIFFICULTY[t.difficulty][0])),
        stageBadge(t),
        h(
          "span",
          { class: "br-track-facts" },
          h("span", {}, km(t.length)),
          h("span", {}, `${t.landmarkCount} landmark${t.landmarkCount === 1 ? "" : "s"}`),
          h("span", { class: t.par_seconds === null ? "unset" : "" }, t.par_seconds === null ? "par: not set yet" : `par ${Math.floor(t.par_seconds / 60)}:${String(Math.round(t.par_seconds % 60)).padStart(2, "0")}`),
        ),
        h(
          "span",
          { class: "br-track-foot" },
          h(
            "span",
            { class: "br-track-votes", "aria-label": votes.length ? `Votes: ${votes.map((v) => `Team ${v.teamId}`).join(", ")}` : "No votes" },
            votes.map((v) => {
              const team = game.teams.find((x) => x.id === v.teamId);
              return team ? teamBadge(team) : null;
            }),
          ),
          tag ? h("span", { class: `br-track-tag${tag.startsWith("Tie") ? " tie" : ""}` }, tag) : null,
        ),
      ];
      const cls = `br-track${chosen ? " chosen" : ""}${myVote === t.id ? " voted" : ""}`;
      if (!actionable) return h("li", {}, h("div", { class: cls }, body));
      const pressed = captain ? myVote === t.id : chosen;
      return h("li", {}, h(
        "button",
        {
          type: "button",
          class: cls,
          "aria-pressed": String(pressed),
          onclick: () =>
            captain
              ? this.api.act({ type: "track.vote", trackId: myVote === t.id ? null : t.id })
              : chosen || this.api.act({ type: "track.pick", trackId: t.id }),
        },
        body,
      ));
    };

    return h(
      "section",
      { class: "br-stages", "aria-label": "Track" },
      h("h3", {}, ballot ? "Track: team vote" : "Track"),
      h("ul", { class: "br-track-list" }, game.tracks.map(card)),
      h("p", { class: "br-stage-hint" }, hint, tail, game.tracks.length > 1 ? " Changing the track un-readies the Navigators." : ""),
    );
  }

  private tick() {
    const g = this.game;
    if (!g || g.startsAt === null) return void (this.clock.textContent = "");
    const now = this.api.serverNow();
    this.clock.textContent = now < g.startsAt ? `, starts in ${Math.ceil((g.startsAt - now) / 1000)}` : `, ${formatClock(raceElapsed(g, now))}`;
  }
}
