import type { SettingField } from "@games/game-core";
import { TIME_LABELS, TIMES, timeHint } from "./sky.ts";
import { DEFAULT_SETTINGS, parseTHSettings } from "./types.ts";
import { RACE_TARGETS, TIMED_MINUTES } from "./world.ts";

/** Plain-language rules for the lobby's Rules button. */
export const treasureHuntRules: string[] = [
  "You need a computer with a keyboard. It does not work on phones.",
  "You play in teams. Pick a team or make a new one while the map loads. If you play alone, you are a team of one.",
  "Pick your character before the round starts. Your team colour shows on its shirt.",
  "The host starts the game. Players whose map is still loading watch this round.",
  "Every round is a new map, unless the host picks Same map again. Everyone starts at the same place.",
  "Your team gets a list of clues. Each clue points to one hidden cache.",
  "Timed: each team has its own list. The team with the most caches when the time ends wins.",
  "Race: all teams share the same list. 3 clues are open at the start, and 1 more opens each time any team finds a cache. A cache one team finds is gone for the others. The first team to find the set number wins.",
  "A clue names a place on the map, says the cache is between two places, gives a distance and a direction, shows a photo taken near the cache, or says where a shadow ends or a lamp shines.",
  "The clock at the top shows the time in the game. It moves 1 minute for every real minute. A shadow clue needs that time.",
  "At night, press F to turn your torch on or off. Buggy lights come on by themselves when it gets dark. Some places have lamps that come on when it gets dark. A cache has a small strip that shines when your torch is close.",
  "Directions are in degrees. 0° is north, 90° is east. The strip at the top of the screen shows where you are facing.",
  "A cache shows up when someone on your team is close to it. Walk up to it and press E to pick it up. You must be on foot.",
  "Move with W, A, S and D. Move the mouse to look. Hold Shift to run. Press Space to jump.",
  "A buggy has 2 seats. Press E near it to get in, and E again to get out. The first person in drives. The second person only looks around and drops pins. R puts the buggy back on its wheels.",
  "Press P to drop a pin where you are looking, or click on the map. You can have 5 pins. A 6th pin removes your oldest one. Only your team sees your pins.",
  "The minimap shows your team all the time. It shows other teams only when they are near you. Press M to open the full map.",
  "Every player has a name tag. Players and buggies pass through each other.",
  "Once in a round, your team can use Hot or cold on one clue. For 3 minutes, a meter shows how close each of you is to that cache. It opens halfway through a timed round, or 10 minutes into a race.",
  "The round ends when the time runs out, or when the hunt is over. The host can also end it early.",
  "If two teams find the same number, the team with the harder caches wins. If it is still a tie, the team that found its last cache first wins.",
  "After the round, a replay shows where every team went and where they found each cache.",
];

/** What the lobby shows (and the host can change) before a game. Caches to win is Race only. */
export function treasureHuntSettingFields(raw: unknown, _players: number): SettingField[] {
  const s = parseTHSettings(raw) ?? DEFAULT_SETTINGS;
  const fields: SettingField[] = [
    {
      key: "mode",
      label: "Mode",
      selected: s.mode === "race" ? 1 : 0,
      options: [
        { label: "Timed", patch: { mode: "timed" } },
        { label: "Race", patch: { mode: "race" } },
      ],
      hint: s.mode === "race" ? `The first team to find ${s.target} caches wins.` : "The team with the most caches at the end wins.",
    },
    {
      key: "minutes",
      label: "Round length",
      selected: Math.max(0, TIMED_MINUTES.indexOf(s.minutes)),
      options: TIMED_MINUTES.map((m) => ({ label: `${m} minutes`, patch: { minutes: m } })),
    },
    {
      key: "time",
      label: "Time of day",
      selected: Math.max(0, TIMES.indexOf(s.time)),
      options: TIMES.map((t) => ({ label: TIME_LABELS[t], patch: { time: t } })),
      hint: timeHint(s.time),
    },
  ];
  if (s.mode === "race") {
    fields.push({
      key: "target",
      label: "Caches to win",
      selected: Math.max(0, RACE_TARGETS.indexOf(s.target as (typeof RACE_TARGETS)[number])),
      options: RACE_TARGETS.map((n) => ({ label: String(n), patch: { target: n } })),
    });
  }
  fields.push({
    key: "map",
    label: "Map",
    selected: s.map === "same" ? 1 : 0,
    options: [
      { label: "New map", patch: { map: "new" } },
      { label: "Same map again", patch: { map: "same" } },
    ],
    hint: s.map === "same" ? "Uses the map from the last round. If there was none, you get a new map." : "A new map every round.",
  });
  return fields;
}
