// The rules encyclopedia (§15), generated from the content tables so it can
// never disagree with the game. It shows the reader's own people: their tech
// tree, their roster, what they can build. Search runs across every section.

import { h } from "@games/ui";
import {
  CITY_DEFENSE,
  DEMOLISH_COST,
  DEVELOP,
  FACTIONS,
  HARVEST,
  HEAL,
  HEAL_HOME,
  ICE,
  MARKET_CAP,
  MAX_CHAIN,
  MEND_HP,
  MONUMENTS,
  NETWORK,
  parentFor,
  POISON_TURNS,
  RESOURCE_NAMES,
  REWARDS,
  rewardChoices,
  techCost,
  TECHS,
  techsFor,
  TEND,
  TERRAIN,
  TERRAIN_DEFENSE,
  trainableFor,
  UNITS,
  VESSELS,
  VETERAN_HP,
  VETERAN_KILLS,
  WALLS_DEFENSE,
  type BuildKind,
} from "../shared/content.ts";
import { dominionRules, SPECIAL_RULES } from "../shared/rules-text.ts";
import type { FactionKind, Resource, TechId, Terrain, UnitType } from "../shared/types.ts";

export interface GuideOptions {
  kind: FactionKind;
  techs: readonly TechId[];
  cityCount: number;
  /** Bring the first-steps card back; label null when it's already showing. */
  tutorial: { label: string | null; run(): void };
  onClose(): void;
}

interface Section {
  id: string;
  title: string;
  /** Rows of plain text: what search matches against. */
  entries: Entry[];
}

interface Entry {
  title: string;
  /** Short facts shown as chips under the title. */
  facts?: string[];
  text?: string;
}

/** Movement is counted in half-points; people think in tiles. */
const tiles = (halfPoints: number) => `${halfPoints / 2}`;

/** A unit's special rules in plain words, from its flags. */
function unitNotes(type: UnitType): string {
  const d = UNITS[type];
  const notes: string[] = [];
  if (d.replaces) notes.push(`Replaces the ${UNITS[d.replaces].name.toLowerCase()}.`);
  if (d.staticAttack) notes.push("Can't move and attack in the same turn.");
  if (d.chain) notes.push(`Attacks again after a kill, up to ${MAX_CHAIN} times a turn.`);
  if (d.sage) notes.push(`Mends neighbours (+${MEND_HP} HP) and converts adjacent enemies instead of attacking.`);
  if (d.mender && !d.sage) notes.push(`Mends neighbours (+${MEND_HP} HP).`);
  if (d.stealth) notes.push("Hidden from enemies unless one is right next to it. Can sabotage a rival city from inside.");
  if (d.steadfast) notes.push("Can't be converted.");
  if (d.flying) notes.push("Flies: every step costs one, over water, peaks and enemy lines. Lands on land.");
  if (d.habitat === "amphibious") notes.push("Walks land and shallows alike; never needs a ship.");
  if (d.habitat === "water") notes.push("Lives in the water, ocean included.");
  if (d.noCapture) notes.push("Can't capture.");
  if (d.networkMove) notes.push(`Half a step on its own mycelium, ×${NETWORK.offFactor} terrain cost off it.`);
  if (d.onHit === "chill") notes.push("Its hits chill: the target can't move on its next turn.");
  if (d.onHit === "poison") notes.push(`Its hits poison: −1 HP for ${POISON_TURNS} turns, no healing.`);
  if (d.matures) notes.push(`Becomes a ${UNITS[d.matures.into].name.toLowerCase()} after ${d.matures.turns} turns.`);
  if (d.evolvesInto) notes.push(`On your mycelium, evolves early into a ${d.evolvesInto.map((t) => UNITS[t].name.toLowerCase()).join(" or ")}.`);
  if (d.lays) notes.push(`Lays a ${UNITS[d.lays].name.toLowerCase()} beside it each turn, room permitting.`);
  for (const [t, m] of Object.entries(d.terrainDefense ?? {})) notes.push(`Defends ×${m} on ${TERRAIN[t as Terrain].name.toLowerCase()}.`);
  for (const [t, c] of Object.entries(d.terrainCost ?? {})) notes.push(`${TERRAIN[t as Terrain].name} costs it ${tiles(c)} move.`);
  if (d.vision) notes.push(`Sees ${d.vision} tiles.`);
  if (d.reward && !d.matures && !d.faction) notes.push("Never trained: only from a reward or event.");
  return notes.join(" ");
}

function sections(kind: FactionKind, techs: readonly TechId[], cityCount: number): Section[] {
  const f = FACTIONS[kind];
  const tree = techsFor(kind);
  const has = (t?: TechId) => !t || techs.includes(t);
  const needs = (t?: TechId) => (t ? `Needs ${TECHS[t].name}${has(t) ? " ✓" : ""}` : "From the start");

  // The lobby's rules, each split into its headline sentence and the rest.
  const basics: Entry[] = dominionRules.map((rule) => {
    const cut = rule.search(/[.:] /);
    return cut < 0 ? { title: rule } : { title: rule.slice(0, cut + 1), text: rule.slice(cut + 2) };
  });
  const special = SPECIAL_RULES[kind as keyof typeof SPECIAL_RULES];
  if (special && !dominionRules.includes(special)) basics.unshift({ title: `${f.name}: your people`, text: special });

  const combat: Entry[] = [
    {
      title: "How damage works",
      text:
        "Each side's strength is its attack (or defense) scaled by its remaining health. Damage is 4.5 × attack × attacker strength ÷ (attacker strength + defender strength), rounded, at least 1. The preview before you attack is exact; nothing is random.",
    },
    { title: "Hitting back", text: "A defender that survives strikes back if the attacker is within its range. Archers and siege at range take nothing back from melee units." },
    {
      title: "Defense bonuses",
      facts: [`City ×${CITY_DEFENSE}`, `Walls ×${WALLS_DEFENSE}`, `Forest with Archery ×${TERRAIN_DEFENSE}`, `Mountain with Meditation ×${TERRAIN_DEFENSE}`],
      text: "Only the best bonus counts. Some units carry their own, listed under Units.",
    },
    { title: "Zones of control", text: "Stepping next to an enemy fighter ends your move. Units at peace with you don't do this." },
    { title: "Healing", facts: [`+${HEAL} HP`, `+${HEAL_HOME} HP in your land`], text: "A unit that hasn't moved or fought can rest instead." },
    { title: "Veterans", facts: [`${VETERAN_KILLS} kills`, `+${VETERAN_HP} max HP`], text: "Promote a unit after enough kills." },
  ];

  const roster = [...new Set([...trainableFor(kind), ...(Object.keys(UNITS) as UnitType[]).filter((t) => UNITS[t].faction === kind), "champion", "raider"] as UnitType[])];
  const units: Entry[] = roster.map((t) => {
    const d = UNITS[t];
    return {
      title: d.name,
      facts: [d.cost ? `${d.cost}¢` : "not trained", `${d.hp} HP`, `${d.attack}/${d.defense}`, `move ${d.move}`, `range ${d.range}`, needs(d.needs)],
      text: unitNotes(t),
    };
  });
  if (!f.noShips) {
    for (const [v, d] of Object.entries(VESSELS)) {
      if (v !== "transport" && kind === "tidefolk") continue;
      units.push({
        title: d.name,
        facts: [v === "transport" ? "free on boarding" : `${d.cost}¢ refit`, `${d.attack}/${d.defense}`, `move ${d.move}`, `range ${d.range}`, `sees ${d.vision}`, needs(d.needs)],
        text:
          v === "transport"
            ? "A land unit that walks onto a harbour boards one. Landing ends its turn. Health is one pool with the unit aboard."
            : `Refitted from a transport.${d.splash ? " Splash: hits enemies beside the target for half." : ""}`,
      });
    }
  }

  const terrain: Entry[] = (Object.keys(TERRAIN) as Terrain[]).map((t) => {
    const d = TERRAIN[t];
    return {
      title: d.name,
      facts: [d.land ? "land" : "water", `costs ${tiles(d.cost)} move`, ...(d.needs ? [needs(f.replaces?.[d.needs] ?? d.needs)] : []), ...(d.defenseTech ? [`×${TERRAIN_DEFENSE} with ${TECHS[d.defenseTech].name}`] : [])],
      text:
        t === "ice"
          ? `Frozen water, walkable by anyone. Thaws ${ICE.rounds} rounds after its makers leave it, never under a unit.`
          : t === "ocean"
            ? "Open water. Ships need the third sea tech to cross it."
            : t === "shallow"
              ? "Water beside land. Ships sail it; land units board at a harbour."
              : undefined,
    };
  });
  terrain.push({ title: "Roads", facts: ["half a step", ...(f.forbids?.includes("road") ? ["not for your people"] : [needs("roads")])], text: "Between roads and cities in friendly land, a step costs half. They also link cities to your capital for +1 income." });

  const develop: Entry[] = [];
  for (const res of Object.keys(HARVEST) as Resource[]) {
    const hv = HARVEST[res]!;
    if (f.absorbs?.includes(res)) continue;
    develop.push(
      f.tends
        ? { title: `Tend ${RESOURCE_NAMES[res].toLowerCase()}`, facts: [`${TEND.cost}¢`, `+${TEND.pop} pop`, needs(f.replaces?.[hv.needs] ?? hv.needs)], text: "The resource stays. Once per tile." }
        : { title: `Harvest ${RESOURCE_NAMES[res].toLowerCase()}`, facts: [`${hv.cost}¢`, `+${hv.pop} pop`, needs(f.replaces?.[hv.needs] ?? hv.needs)], text: "Uses the resource up." },
    );
  }
  for (const res of f.absorbs ?? []) {
    develop.push({ title: `Absorb ${RESOURCE_NAMES[res].toLowerCase()}`, facts: [`${NETWORK.absorbCost}¢`, `+${NETWORK.absorbPop} pop`, needs("spreading")], text: "Your mycelium takes it in." });
  }
  if (f.network) develop.push({ title: "Spread mycelium", facts: [`${NETWORK.spreadCost}¢`, needs("spreading")], text: "Onto land touching your network, anywhere but a treaty partner's." });
  for (const [k, d] of Object.entries(DEVELOP) as [BuildKind, (typeof DEVELOP)[BuildKind]][]) {
    if (f.forbids?.includes(k) || !tree.includes(d.needs)) continue;
    const notes: Partial<Record<BuildKind, string>> = {
      farm: "On crops.",
      mine: "On ore.",
      mill: `One per city. +1 pop per farm beside it.`,
      forge: `One per city. +1 pop per mine beside it.`,
      market: `One per city. +1 income per farm, camp, mine, mill or forge beside it, up to ${MARKET_CAP}.`,
      temple: "Gathers score each turn, up to a cap.",
      port: "On the shore. Land units board ships here; two ports on the same water link their cities.",
      grove: "Still counts as untouched forest.",
      reef_nest: "Your harbour: boards ships and links cities. +1 income beside two fish or reef settlements.",
      road: "Half-cost steps, and city links.",
    };
    develop.push({ title: d.name, facts: [`${d.cost}¢`, ...(d.pop ? [`+${d.pop} pop`] : []), d.terrain.map((t) => TERRAIN[t].name.toLowerCase()).join(" or "), needs(d.needs)], text: notes[k] });
  }
  if (f.forestIncome) develop.push({ title: "Untouched forest", facts: [`+1¢ per ${f.forestIncome.per}`, `up to +${f.forestIncome.cap}`], text: "Bare forest and groves in a city's land pay." });
  develop.push({ title: "Demolish", facts: [`${DEMOLISH_COST}¢`, needs(f.replaces?.construction ?? "construction")], text: "Clears an improvement. Population already earned stays." });

  const research: Entry[] = tree.map((t) => {
    const d = TECHS[t];
    const parent = parentFor(kind, t);
    return {
      title: `${d.name}${has(t) ? " ✓" : ""}`,
      facts: [`tier ${d.tier}`, `${techCost(t, cityCount, techs)}¢ now`, parent ? `after ${TECHS[parent].name}` : "a root"],
      text: d.unlocks,
    };
  });
  research.push({ title: "What research costs", text: "3 + 3 × tier, plus 2 for every city past your first. Philosophy takes a fifth off." });

  const cities: Entry[] = [
    { title: "Growing", text: "Harvesting and building on a city's tiles adds population. A city levels up when its population reaches its level + 1. Bigger cities pay more and hold more units (level + 1)." },
    { title: "Income", text: "Each city pays its level, +1 if it's your capital, +1 if linked to the capital by road or harbours, plus workshops and markets. An enemy standing in it stops its pay." },
    { title: "Capturing", text: "Move a unit into a village or rival city, wait for your next turn, then capture. Treaty partners' cities are off limits." },
  ];
  for (const level of [2, 3, 4, 5]) {
    const [a, b] = rewardChoices(level);
    cities.push({ title: `Level ${level === 5 ? "5+" : level} reward`, facts: [REWARDS[a].name, REWARDS[b].name], text: `${REWARDS[a].name}: ${REWARDS[a].blurb}. ${REWARDS[b].name}: ${REWARDS[b].blurb}. The first is the default if time runs out.` });
  }

  const milestones: Entry[] = Object.values(MONUMENTS).map((m) => ({ title: m.name, text: `${m.goal}. Earns a monument to place on your land: +3 population and +100 score.` }));

  return [
    { id: "basics", title: "Basics", entries: basics },
    { id: "combat", title: "Combat", entries: combat },
    { id: "units", title: "Units", entries: units },
    { id: "terrain", title: "Terrain", entries: terrain },
    { id: "develop", title: "Develop", entries: develop },
    { id: "research", title: "Research", entries: research },
    { id: "cities", title: "Cities", entries: cities },
    { id: "milestones", title: "Milestones", entries: milestones },
  ];
}

export function guideScreen({ kind, techs, cityCount, tutorial, onClose }: GuideOptions): HTMLElement {
  const all = sections(kind, techs, cityCount);
  let current = all[0]!.id;
  let query = "";

  const tabs = h("div", { class: "dm-gd-tabs", role: "tablist", "aria-label": "Guide sections" });
  const body = h("div", { class: "dm-gd-body", role: "tabpanel" });
  const search = h("input", {
    type: "search",
    class: "dm-gd-search",
    placeholder: "Search the rules",
    "aria-label": "Search the rules",
  }) as HTMLInputElement;

  const entryEl = (e: Entry) =>
    h(
      "article",
      { class: "dm-gd-entry" },
      h("h3", {}, e.title),
      e.facts?.length ? h("ul", { class: "dm-gd-facts" }, e.facts.map((x) => h("li", {}, x))) : null,
      e.text ? h("p", {}, e.text) : null,
    );

  const render = () => {
    const q = query.trim().toLowerCase();
    tabs.replaceChildren(
      ...all.map((s) =>
        h(
          "button",
          {
            type: "button",
            role: "tab",
            class: "dm-gd-tab",
            "aria-selected": String(!q && s.id === current),
            onclick: () => {
              current = s.id;
              query = "";
              search.value = "";
              render();
            },
          },
          s.title,
        ),
      ),
    );
    if (q) {
      // Search: every section, matching entries only, grouped under their section.
      const hits = all.flatMap((s) => {
        const found = s.entries.filter((e) => [e.title, e.text ?? "", ...(e.facts ?? [])].join(" ").toLowerCase().includes(q));
        return found.length ? [h("h2", { class: "dm-gd-group" }, s.title), ...found.map(entryEl)] : [];
      });
      body.replaceChildren(...(hits.length ? hits : [h("p", { class: "dm-muted" }, `Nothing about “${query.trim()}”. Try a unit, a building or a tech.`)]));
      return;
    }
    body.replaceChildren(...all.find((s) => s.id === current)!.entries.map(entryEl));
    body.scrollTop = 0;
  };
  search.addEventListener("input", () => {
    query = search.value;
    render();
  });

  render();
  const close = h("button", { type: "button", class: "dm-ts-close", "aria-label": "Close guide", onclick: onClose }, "×");
  const root = h(
    "div",
    { class: "dm-dip dm-gd", role: "dialog", "aria-modal": "true", "aria-label": "Guide" },
    h(
      "div",
      { class: "dm-dip-card dm-gd-card dm-plate" },
      h("header", { class: "dm-dip-head" }, h("h2", {}, "Guide"), search, close),
      tutorial.label
        ? h(
            "button",
            {
              type: "button",
              class: "dm-gd-coach",
              onclick: () => {
                tutorial.run();
                onClose();
              },
            },
            tutorial.label,
          )
        : null,
      tabs,
      body,
    ),
  );
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  });
  root.addEventListener("click", (e) => e.target === root && onClose());
  requestAnimationFrame(() => search.focus());
  return root;
}
