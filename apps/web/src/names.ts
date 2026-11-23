// Random names for the dice button. Adjective + animal, always under
// MAX_NAME_LENGTH (20), never the same two picks twice in a row.

// Plain words an English-as-second-language reader knows. No slang.
const ADJECTIVES = [
  "Happy", "Brave", "Quick", "Lucky", "Sleepy", "Clever", "Calm", "Kind", "Bright", "Gentle",
  "Strong", "Funny", "Proud", "Silent", "Sunny", "Wise",
];

const ANIMALS = [
  "Tiger", "Elephant", "Peacock", "Parrot", "Monkey", "Lion", "Deer", "Rabbit", "Panda", "Camel",
  "Owl", "Dolphin", "Squirrel", "Turtle", "Horse", "Eagle",
];

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;

export function randomName(avoid = ""): string {
  for (;;) {
    const name = `${pick(ADJECTIVES)} ${pick(ANIMALS)}`;
    if (name.length <= 20 && name !== avoid) return name;
  }
}
