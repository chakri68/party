// Night results in words. Shared so the wording is tested: every line must be
// literally true, and team checks only know how a player *reads* (the Stray
// reads as a wolf), so those say "reads as", never "is".

import { roleById } from "./roles.ts";
import type { NightLogEntry, NightResult } from "./types.ts";

/** "A and B", "A, B and C". */
export function list(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * `name` gives "you" for the viewer and a seat name for anyone else; `holder`
 * is whose result it is (the lone Wolf and a missed pick read differently).
 */
export function describeResult(r: NightResult, holder: string, me: string, name: (id: string) => string): string {
  const you = (id: string) => id === me;
  const Name = (id: string) => cap(name(id));
  const reads = (id: string) => (you(id) ? "read" : "reads");
  switch (r.kind) {
    case "wolves": {
      if (r.pack.length > 1) return `The Wolves: ${list(r.pack.map(name))}.`;
      const own = you(holder) ? "You're the only Wolf." : `${Name(holder)} was the only Wolf.`;
      return r.villager ? `${own} ${Name(r.villager)} ${you(r.villager) ? "hold" : "holds"} a Villager.` : `${own} No Villagers were dealt.`;
    }
    case "lamp":
      return `${Name(r.target)} ${reads(r.target)} as ${r.reads === "wolves" ? "a wolf" : "village"}.`;
    case "match":
      return `${Name(r.targets[0])} and ${name(r.targets[1])} read as ${r.same ? "the same side" : "different sides"}.`;
    case "bell":
      return `${r.count} of ${list(r.neighbours.map(name))} ${r.count === 1 ? "reads as a wolf" : "read as wolves"}.`;
    case "gossip":
      return `At least one of ${list(r.pair.map(name))} reads as a wolf.`;
    case "wander":
      return `${Name(r.target)} ${you(r.target) ? "aren't" : "isn't"} the ${roleById(r.notRole).label}.`;
    case "missed":
      return you(holder) ? "You didn't pick in time." : "No pick: time ran out.";
  }
}

/**
 * One line of the dawn log, after "Lamplighter (Ben): ". A picker's line says
 * who they picked before what they learned, so a real pick and a step that ran
 * out read differently.
 */
export function describeNightEntry(e: NightLogEntry, me: string, name: (id: string) => string): string {
  const holder = e.holders[0] ?? "";
  if (!e.result) return e.holders.length ? "Never got their turn." : "Not dealt.";
  const text = describeResult(e.result, holder, me, name);
  if (!e.targets.length) return text;
  return `Picked ${list(e.targets.map(name))}. ${text}`;
}

/**
 * The night list's selection after a tap: a second tap on a picked player
 * unpicks them; with room for one, a tap replaces; with room for two, the
 * oldest falls off. The same on every phone, picker or not.
 */
export function nextPicks(chosen: readonly string[], id: string, count: number): string[] {
  if (chosen.includes(id)) return chosen.filter((x) => x !== id);
  return count === 1 ? [id] : [...chosen, id].slice(-count);
}

/** The words for "the X is awake", with the Wolves, who wake together, in the plural. */
export function wakingLine(role: { id: string; label: string }): string {
  return role.id === "wolf" ? "The Wolves are awake" : `The ${role.label} is awake`;
}
