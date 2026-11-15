import type { EventId } from "./types.ts";

export interface EventCard {
  id: EventId;
  kind: "calm" | "harm" | "bargain";
  title: string;
  text: string;
  options: string[] | null;
}

const BARGAIN = ["Accept", "Refuse"];

export const EVENTS: Record<EventId, EventCard> = {
  "quiet-morning": {
    id: "quiet-morning", kind: "calm", title: "Quiet morning",
    text: "Nothing happens. The spider stays still this round.", options: null,
  },
  "old-camp": {
    id: "old-camp", kind: "calm", title: "Old camp",
    text: "The land around one hidden cache will open.", options: null,
  },
  "bird-calls": {
    id: "bird-calls", kind: "calm", title: "Bird calls",
    text: "3 hidden tiles next to open land will open.", options: null,
  },
  "clear-sky": {
    id: "clear-sky", kind: "calm", title: "Clear sky",
    text: "Vote. Open the land around the gate, or around the nearest ruin without its key stone.",
    options: ["Open the land around the gate", "Open the land around the nearest ruin"],
  },
  rain: {
    id: "rain", kind: "calm", title: "Rain",
    text: "All fire goes out at the end of the round.", options: null,
  },
  "dry-wind": {
    id: "dry-wind", kind: "harm", title: "Dry wind",
    text: "Fire spreads two times this round.", options: null,
  },
  "hungry-spider": {
    id: "hungry-spider", kind: "harm", title: "Hungry spider",
    text: "The spider moves 3 tiles this round, not 2.", options: null,
  },
  "falling-rocks": {
    id: "falling-rocks", kind: "harm", title: "Falling rocks",
    text: "Rocks fall on the marked tile at the end of the round. Anyone there loses 1 Heart. Guard stops it.",
    options: null,
  },
  "rotten-bridge": {
    id: "rotten-bridge", kind: "harm", title: "Rotten bridge",
    text: "This bridge will break at the end of the round. Stand on it to stop that.", options: null,
  },
  "echo-reeds": {
    id: "echo-reeds", kind: "harm", title: "Echo in the reeds",
    text: "The marked reeds make 2 noise at the end of the round.", options: null,
  },
  "stone-hand": {
    id: "stone-hand", kind: "bargain", title: "The stone hand",
    text: "Accept: every broken bridge is fixed now. In 2 rounds, the marked bridge gets 3 noise. Refuse: nothing happens.",
    options: BARGAIN,
  },
  "warm-spring": {
    id: "warm-spring", kind: "bargain", title: "The warm spring",
    text: "Accept: everyone gets 1 Heart, and down players get up. The sun moves on by 1. Refuse: nothing happens.",
    options: BARGAIN,
  },
};
