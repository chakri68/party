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
  if (d.replaces) notes.push(`Takes the place of the ${UNITS[d.replaces].name.toLowerCase()}.`);
  if (d.staticAttack) notes.push("It can't move and attack in the same turn.");
  if (d.chain) notes.push(`After a kill, it can attack again. It can do this up to ${MAX_CHAIN} times a turn.`);
  if (d.sage) notes.push(`It heals units next to it (+${MEND_HP} HP). It does not attack. It turns enemies next to it to your side.`);
  if (d.mender && !d.sage) notes.push(`It heals units next to it (+${MEND_HP} HP).`);
  if (d.stealth) notes.push("Enemies can't see it from far away. An enemy right next to it can see it. It can damage an enemy city from inside.");
  if (d.steadfast) notes.push("Enemies can't turn it to their side.");
  if (d.flying) notes.push("It flies. Every step costs 1 move. It can fly over water, mountain tops and enemy lines. It must stop on land.");
  if (d.habitat === "amphibious") notes.push("It walks on land and in shallow water. It never needs a boat.");
  if (d.habitat === "water") notes.push("It lives in the water. It can go into the ocean too.");
  if (d.noCapture) notes.push("It can't take cities.");
  if (d.networkMove) notes.push(`On your mycelium, each step costs half. Off it, each step costs ${NETWORK.offFactor} times as much.`);
  if (d.onHit === "chill") notes.push("Its hits freeze the target. The target can't move on its next turn.");
  if (d.onHit === "poison") notes.push(`Its hits poison the target. The target loses 1 HP each turn for ${POISON_TURNS} turns. The target can't heal.`);
  if (d.matures) notes.push(`After ${d.matures.turns} turns, it becomes a ${UNITS[d.matures.into].name.toLowerCase()}.`);
  if (d.evolvesInto) notes.push(`On your mycelium, it can change early into a ${d.evolvesInto.map((t) => UNITS[t].name.toLowerCase()).join(" or ")}.`);
  if (d.lays) notes.push(`Each turn, it lays a ${UNITS[d.lays].name.toLowerCase()} next to it. It needs an empty tile for this.`);
  for (const [t, m] of Object.entries(d.terrainDefense ?? {})) notes.push(`It defends ×${m} on ${TERRAIN[t as Terrain].name.toLowerCase()}.`);
  for (const [t, c] of Object.entries(d.terrainCost ?? {})) notes.push(`For this unit, ${TERRAIN[t as Terrain].name.toLowerCase()} costs ${tiles(c)} move.`);
  if (d.vision) notes.push(`It sees ${d.vision} tiles away.`);
  if (d.reward && !d.matures && !d.faction) notes.push("You can't train it. You get it only from a reward or an event.");
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
        "Each side has a strength. Strength is attack (or defence) times the share of health left. Damage = 4.5 × attack × attacker strength ÷ (attacker strength + defender strength). The game rounds the damage. Damage is at least 1. The damage you see before you attack is exact. Nothing is random.",
    },
    { title: "Hitting back", text: "The defender may live. Then the defender hits back, if the attacker is in its range. Some units attack from far away, like archers and siege engines. Close-range units can't hit them back." },
    {
      title: "Defence bonuses",
      facts: [`City ×${CITY_DEFENSE}`, `Walls ×${WALLS_DEFENSE}`, `Forest with Archery ×${TERRAIN_DEFENSE}`, `Mountain with Meditation ×${TERRAIN_DEFENSE}`],
      text: "Only the best bonus counts. Some units have their own bonus. The Units tab lists these.",
    },
    { title: "Enemy units block you", text: "Your unit stops when it moves next to an enemy soldier. Units at peace with you don't stop you." },
    { title: "Healing", facts: [`+${HEAL} HP`, `+${HEAL_HOME} HP in your land`], text: "A unit can rest to heal. It must not move or fight that turn." },
    { title: "Veterans", facts: [`${VETERAN_KILLS} kills`, `+${VETERAN_HP} max HP`], text: "A unit with enough kills can become a veteran. A veteran gets more max HP." },
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
            ? "A land unit walks onto a harbour. The unit gets on a transport. Landing ends the unit's turn. The transport and the unit share 1 health bar."
            : `You make it from a transport.${d.splash ? " It also hits enemies next to the target. Those enemies take half the damage." : ""}`,
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
          ? `Frozen water. Anyone can walk on ice. The ice melts ${ICE.rounds} rounds after the Rimeborn leave it. Ice never melts under a unit.`
          : t === "ocean"
            ? "Open water. Ships need the 3rd sea tech to cross the ocean."
            : t === "shallow"
              ? "Water next to land. Ships can sail here. Land units get on ships at a harbour."
              : undefined,
    };
  });
  terrain.push({ title: "Roads", facts: ["half a step", ...(f.forbids?.includes("road") ? ["not for your people"] : [needs("roads")])], text: "In your land, each step on a road or city costs half. A road from a city to your capital gives that city +1 income." });

  const develop: Entry[] = [];
  for (const res of Object.keys(HARVEST) as Resource[]) {
    const hv = HARVEST[res]!;
    if (f.absorbs?.includes(res)) continue;
    develop.push(
      f.tends
        ? { title: `Tend ${RESOURCE_NAMES[res].toLowerCase()}`, facts: [`${TEND.cost}¢`, `+${TEND.pop} pop`, needs(f.replaces?.[hv.needs] ?? hv.needs)], text: "The resource stays. You can do this once per tile." }
        : { title: `Harvest ${RESOURCE_NAMES[res].toLowerCase()}`, facts: [`${hv.cost}¢`, `+${hv.pop} pop`, needs(f.replaces?.[hv.needs] ?? hv.needs)], text: "The resource is used up." },
    );
  }
  for (const res of f.absorbs ?? []) {
    develop.push({ title: `Absorb ${RESOURCE_NAMES[res].toLowerCase()}`, facts: [`${NETWORK.absorbCost}¢`, `+${NETWORK.absorbPop} pop`, needs("spreading")], text: "Your mycelium takes in the resource." });
  }
  if (f.network) develop.push({ title: "Spread mycelium", facts: [`${NETWORK.spreadCost}¢`, needs("spreading")], text: "Spread mycelium onto land next to your mycelium. You can't spread it into a treaty partner's land." });
  for (const [k, d] of Object.entries(DEVELOP) as [BuildKind, (typeof DEVELOP)[BuildKind]][]) {
    if (f.forbids?.includes(k) || !tree.includes(d.needs)) continue;
    const notes: Partial<Record<BuildKind, string>> = {
      farm: "On crops.",
      mine: "On ore.",
      mill: `1 per city. +1 pop for each farm next to the mill.`,
      forge: `1 per city. +1 pop for each mine next to the forge.`,
      market: `1 per city. +1 income for each farm, camp, mine, mill or forge next to the market. The most it gives is ${MARKET_CAP}.`,
      temple: "Adds score each turn. There is a limit.",
      port: "Build it on the shore. Land units get on ships here. 2 ports on the same water join their cities.",
      grove: "A grove still counts as untouched forest.",
      reef_nest: "Your harbour. Units get on ships here. It joins cities. It gives +1 income next to 2 fish or reef villages.",
      road: "Steps cost half. Roads join cities.",
    };
    develop.push({ title: d.name, facts: [`${d.cost}¢`, ...(d.pop ? [`+${d.pop} pop`] : []), d.terrain.map((t) => TERRAIN[t].name.toLowerCase()).join(" or "), needs(d.needs)], text: notes[k] });
  }
  if (f.forestIncome) develop.push({ title: "Untouched forest", facts: [`+1¢ per ${f.forestIncome.per}`, `up to +${f.forestIncome.cap}`], text: "Forest and groves in a city's land give income." });
  develop.push({ title: "Demolish", facts: [`${DEMOLISH_COST}¢`, needs(f.replaces?.construction ?? "construction")], text: "Removes a building. The city keeps its population." });

  const research: Entry[] = tree.map((t) => {
    const d = TECHS[t];
    const parent = parentFor(kind, t);
    return {
      title: `${d.name}${has(t) ? " ✓" : ""}`,
      facts: [`tier ${d.tier}`, `${techCost(t, cityCount, techs)}¢ now`, parent ? `after ${TECHS[parent].name}` : "a root"],
      text: d.unlocks,
    };
  });
  research.push({ title: "What research costs", text: "Cost = 3 + 3 × tier. Add 2 for each city after your first. Philosophy makes research 20% cheaper." });

  const cities: Entry[] = [
    { title: "Growing", text: "Harvest or build on a city's tiles to add population. A city goes up a level when its population reaches level + 1. Bigger cities give more credits. A city can hold level + 1 units." },
    { title: "Income", text: "Each city gives credits equal to its level. Your capital gets +1. A city joined to your capital gets +1. Workshops and markets add more. An enemy unit in a city stops that city's credits." },
    { title: "Capturing", text: "Move a unit into a village or an enemy city. Wait for your next turn. Then take the city. You can't take a treaty partner's cities." },
  ];
  for (const level of [2, 3, 4, 5]) {
    const [a, b] = rewardChoices(level);
    cities.push({ title: `Level ${level === 5 ? "5+" : level} reward`, facts: [REWARDS[a].name, REWARDS[b].name], text: `${REWARDS[a].name}: ${REWARDS[a].blurb}. ${REWARDS[b].name}: ${REWARDS[b].blurb}. If time runs out, you get the first one.` });
  }

  const milestones: Entry[] = Object.values(MONUMENTS).map((m) => ({ title: m.name, text: `${m.goal}. You get a monument to put on your land. A monument gives +3 population and +100 score.` }));

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
      body.replaceChildren(...(hits.length ? hits : [h("p", { class: "dm-muted" }, `Nothing found for “${query.trim()}”. Search for a unit, a building or a tech.`)]));
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
