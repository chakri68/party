import { h, type GameClientApi } from "@games/ui";
import { trackName } from "../shared/tracks-public.ts";
import type { BlindRallyPublicState, PublicTrack } from "../shared/types.ts";
import { teamBadge } from "./role.ts";

// The track picker both lobbies share: Blind Rally's teams screen and Rally's
// grid. Cards only, never a map (see stageBadge).

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

/** The track's on a coin flip: the ballot's top was level and the seed broke it. */
export function coinFlipped(game: BlindRallyPublicState): boolean {
  return !!game.ballot && game.ballot.tied.length > 1 && game.ballot.tied.includes(game.trackId);
}

/**
 * TEAMS only: a card per track. The host taps one to pick it; in a vote, a
 * captain taps one to cast the car's vote (again to take it back), and every
 * vote shows as that car's door plate on its card. In Rally every car is
 * one player, so every player is its captain and the words say "you".
 */
export function trackPicker(api: GameClientApi, game: BlindRallyPublicState, me: string, isHost: boolean, name: (id: string) => string, rally = false) {
  const ballot = game.ballot;
  const mine = game.teams.find((t) => t.driverId === me || t.navigatorId === me);
  const captain = !!ballot && !!mine && mine.captainId === me;
  const myVote = ballot && mine ? ballot.votes.find((v) => v.teamId === mine.id)?.trackId ?? null : null;
  const canPick = !ballot && isHost;
  const single = game.tracks.length < 2;

  const hint = ballot
    ? captain
      ? rally ? "Your vote. Tap again to take it back." : `You vote for Team ${mine!.id}. Tap again to take it back.`
      : mine
        ? mine.captainId ? `${name(mine.captainId)} votes for your car, as captain.` : "Your car's captain votes."
        : rally ? "Every car gets a vote. You'll get one with the next free car." : "Each car's captain votes. Sit down to have a say."
    : isHost
      ? single ? "One track so far. More on the way." : "Tap a track to race it."
      : "The host picks the track.";
  const tail = ballot && !ballot.votes.length ? ` No votes yet: it's ${trackName(game.tracks, game.trackId)} until someone votes.` : "";
  const unready = game.tracks.length > 1 ? (rally ? " Changing the track un-readies everyone." : " Changing the track un-readies the Navigators.") : "";

  const card = (t: PublicTrack) => {
    const chosen = t.id === game.trackId;
    const votes = ballot ? ballot.votes.filter((v) => v.trackId === t.id) : [];
    const tag = chosen
      ? coinFlipped(game)
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
          { class: "br-track-votes", "aria-label": votes.length ? `Votes: ${votes.map((v) => `${rally ? "Car" : "Team"} ${v.teamId}`).join(", ")}` : "No votes" },
          votes.map((v) => {
            const team = game.teams.find((x) => x.id === v.teamId);
            return team ? teamBadge(team, rally ? "Car" : "Team") : null;
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
            ? api.act({ type: "track.vote", trackId: myVote === t.id ? null : t.id })
            : chosen || api.act({ type: "track.pick", trackId: t.id }),
      },
      body,
    ));
  };

  return h(
    "section",
    { class: "br-stages", "aria-label": "Track" },
    h("h3", {}, ballot ? (rally ? "Track: everyone votes" : "Track: team vote") : "Track"),
    h("ul", { class: "br-track-list" }, game.tracks.map(card)),
    h("p", { class: "br-stage-hint" }, hint, tail, unready),
  );
}
