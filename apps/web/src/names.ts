// Random names for the dice button. Adjective + animal, always under
// MAX_NAME_LENGTH (20), never the same two picks twice in a row.

const ADJECTIVES = [
  "Lucky", "Sneaky", "Wild", "Crafty", "Sleepy", "Bold", "Dapper", "Jolly", "Cheeky", "Quiet",
  "Mighty", "Fuzzy", "Swift", "Grumpy", "Sly", "Brave", "Cosmic", "Salty", "Zesty", "Plucky",
  "Bluffing", "Shifty", "Humble", "Dramatic", "Suspicious", "Smug", "Chaotic", "Polite",
];

const ANIMALS = [
  "Otter", "Badger", "Panda", "Fox", "Raven", "Moose", "Walrus", "Gecko", "Lemur", "Yak",
  "Heron", "Ferret", "Penguin", "Llama", "Koala", "Newt", "Toad", "Bison", "Marmot", "Puffin",
  "Capybara", "Goose", "Hedgehog", "Owl", "Crab", "Wombat",
];

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;

export function randomName(avoid = ""): string {
  for (;;) {
    const name = `${pick(ADJECTIVES)} ${pick(ANIMALS)}`;
    if (name.length <= 20 && name !== avoid) return name;
  }
}
