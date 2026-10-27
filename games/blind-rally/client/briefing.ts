import { h } from "@games/ui";
import type { Briefing, BriefingLine } from "../shared/rules-text.ts";
import { teamColor, type PublicTeam } from "../shared/types.ts";
import { teamBadge } from "./role.ts";

// The pre-race card both lobbies use: your job, then every control it has,
// under this race's settings. Its footer (Ready, and whatever else the seat
// offers) is the caller's.

const keys = (line: BriefingLine) =>
  line.keys.length
    ? h("span", { class: "br-keys" }, line.keys.flatMap((chord, i) => [i ? h("span", { class: "br-keys-or" }, "or") : null, ...chord.map((k) => h("kbd", {}, k))]))
    : null;

/** `kicker` sits by the door plate: "Driver", "Navigator", or Rally's "Your car". */
export function briefingCard(b: Briefing, team: PublicTeam, kicker: string, foot: Node[], word: "Team" | "Car" = "Team"): HTMLElement {
  return h(
    "section",
    { class: "br-brief", "aria-label": "Your briefing", style: `--br-team: ${teamColor(team.color).hex}` },
    h(
      "header",
      { class: "br-brief-head" },
      h("p", { class: "br-brief-kicker" }, teamBadge(team, word), h("span", {}, kicker)),
      h("h3", { class: "br-brief-title" }, b.title),
      h("p", { class: "br-brief-lead" }, b.lead),
    ),
    h("dl", { class: "br-brief-list" }, b.lines.flatMap((line) => [h("dt", {}, line.label), h("dd", {}, keys(line), h("span", {}, line.text))])),
    h("footer", { class: "br-brief-foot" }, foot),
  );
}
