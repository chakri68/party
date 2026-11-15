// The day report (summary phase) and the trip recap. Read-only, the same on every phone.
import { h } from "@games/ui";
import type { RouteDef, SettingPack } from "../shared/pack.ts";
import type { DayLog, Recap } from "../shared/recap.ts";
import type { ArmableJob, Goal } from "../shared/types.ts";
import { deltaLine, firedLine, goalLine, gradeLabel, HEALTH_LABEL, planLines } from "./format.ts";

type Name = (id: string) => string;

/** A log's place: "between A and B", or a stop name that needs "at". */
const place = (where: string) => (where.startsWith("between ") ? where : `at ${where}`);

function section(title: string, ...body: (Node | null)[]): HTMLElement {
  return h("section", { class: "lt-part" }, h("h3", {}, title), body);
}

/** "Go 3, No-go 2" and each vote by name. */
export function votesLine(votes: Record<string, "go" | "no-go">, name: Name): HTMLElement {
  return h(
    "ul",
    { class: "lt-votes" },
    Object.entries(votes).map(([id, v]) => h("li", { class: v }, `${name(id)}: ${v === "go" ? "Go" : "No-go"}`)),
  );
}

export function proposalsPart(proposals: DayLog["proposals"], pack: SettingPack, route: RouteDef, name: Name): HTMLElement | null {
  if (!proposals.length) return null;
  return section(
    proposals.length === 1 ? "The vote" : "The votes",
    h(
      "ol",
      { class: "lt-log" },
      proposals.map((p) => {
        const go = Object.values(p.votes).filter((v) => v === "go").length;
        const no = Object.values(p.votes).length - go;
        return h(
          "li",
          {},
          h("p", {}, `${name(p.by)}: ${planLines(p.plan, pack, route, name).join(" ")} `, h("b", {}, p.passed ? `Passed ${go}–${no}.` : `Rejected ${go}–${no}.`)),
          votesLine(p.votes, name),
        );
      }),
    ),
  );
}

export function dayReport(d: DayLog, fired: ArmableJob[], pack: SettingPack, route: RouteDef, name: Name): HTMLElement {
  const r = d.report;
  const moved = r.km > 0 ? `Moved ${r.km} km.` : d.plan.rest ? "Rested." : "Did not move.";
  const reached = r.reached ? ` Reached ${route.stops.find((s) => s.id === r.reached)?.name ?? r.reached}.` : ` Now ${place(d.where)}.`;
  const deltas = deltaLine(pack, r.stockDelta, r.cargoDelta);
  const health = r.healthChanges.map((c) => `${name(c.playerId)}: ${HEALTH_LABEL[c.from]} to ${HEALTH_LABEL[c.to]}.`);
  return h(
    "div",
    { class: "lt-report" },
    h("p", { class: "lt-report-head" }, `${moved}${reached}`),
    d.stayedCourse ? h("p", { class: "lt-hint" }, "Both plans were rejected. The caravan kept yesterday's plan.") : null,
    d.event
      ? h(
          "div",
          { class: "lt-event" },
          h("p", {}, d.event.text),
          d.event.choice ? h("p", { class: "lt-hint" }, `The caravan chose: ${d.event.choice.label}.`) : null,
        )
      : null,
    deltas ? h("p", { class: "lt-deltas" }, deltas) : null,
    health.length ? h("ul", { class: "lt-health-list" }, health.map((l) => h("li", {}, l))) : null,
    fired.length ? h("ul", { class: "lt-fired" }, fired.map((j) => h("li", {}, firedLine(j)))) : null,
  );
}

export function recapView(recap: Recap, goals: Record<string, Goal> | null, pack: SettingPack, name: Name): HTMLElement {
  const route = recap.route.map((s) => `${s.name} (day ${s.day})`).join(" → ");
  return h(
    "div",
    { class: "lt-recap" },
    h("p", { class: "lt-line" }, recap.line),
    section("The route", h("p", {}, route)),
    section(
      "Who lived",
      h(
        "ul",
        { class: "lt-log plain" },
        recap.fates.map((f) =>
          h(
            "li",
            { class: f.alive ? "alive" : "dead" },
            f.alive ? `${name(f.playerId)}: alive at the end.` : `${name(f.playerId)}: died${f.day ? ` on day ${f.day}` : ""}${f.where ? `, ${place(f.where)}` : ""}.`,
          ),
        ),
      ),
    ),
    recap.bigCalls.length
      ? section(
          "The closest votes",
          h(
            "ol",
            { class: "lt-log" },
            recap.bigCalls.map((b) => h("li", {}, h("b", {}, `Day ${b.day}. `), `${b.question}: ${b.go}–${b.noGo}. ${b.result}.`)),
          ),
        )
      : null,
    recap.worstDay ? section("The worst day", h("p", {}, h("b", {}, `Day ${recap.worstDay.day}. `), recap.worstDay.text)) : null,
    section(
      "Jobs and goals",
      h(
        "ul",
        { class: "lt-log plain" },
        recap.reveals.map((r) =>
          h(
            "li",
            { class: "lt-reveal" },
            h("span", {}, h("b", {}, `${name(r.playerId)}, ${pack.jobs[r.job].name}. `), goalLine(r.goal, goals?.[r.playerId], name)),
            h("span", { class: `lt-met ${r.met ? "yes" : "no"}` }, r.met ? "Met" : "Missed"),
          ),
        ),
      ),
    ),
    section(
      "Money at the end",
      h(
        "p",
        {},
        `${pack.labels.coins} ${recap.haul.coins}. ${pack.labels.cargo} sold for ${recap.haul.cargoSale}. Wealth ${recap.haul.wealth}. `,
        h("b", {}, recap.haul.grade ? `Grade: ${gradeLabel(recap.haul.grade)}.` : "No grade: the caravan did not arrive."),
      ),
    ),
  );
}
