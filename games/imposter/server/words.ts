// The Imposter's word pack. Server only: the word is the secret, and anything
// under shared/ or client/ ships to every browser. Written for this project.
//
// Words are things most people can picture and clue in a few words. None of
// them names its category, and no word appears twice (test/rules.test.ts).

export interface Category {
  name: string;
  words: readonly string[];
}

export const PACK: readonly Category[] = [
  {
    name: "In the kitchen",
    words: ["kettle", "toaster", "colander", "whisk", "rolling pin", "fridge", "ladle", "oven glove", "chopping board", "grater", "blender", "spatula", "teapot"],
  },
  {
    name: "Animals",
    words: ["giraffe", "penguin", "hedgehog", "octopus", "kangaroo", "owl", "camel", "squirrel", "flamingo", "tortoise", "bat", "dolphin", "goat"],
  },
  {
    name: "Jobs",
    words: ["firefighter", "dentist", "pilot", "plumber", "librarian", "chef", "lifeguard", "farmer", "astronaut", "hairdresser", "referee", "postman", "magician"],
  },
  {
    name: "Around town",
    words: ["library", "bakery", "museum", "cinema", "swimming pool", "car park", "launderette", "post office", "bus stop", "petrol station", "playground", "church", "market"],
  },
  {
    name: "Sports and games",
    words: ["tennis", "chess", "bowling", "fencing", "darts", "rowing", "surfing", "archery", "boxing", "skiing", "golf", "cricket", "hopscotch"],
  },
  {
    name: "Getting about",
    words: ["submarine", "tram", "hot air balloon", "scooter", "canoe", "helicopter", "tractor", "skateboard", "ferry", "rickshaw", "sleigh", "ambulance", "cable car"],
  },
  {
    name: "Things to wear",
    words: ["scarf", "wellies", "pyjamas", "apron", "bow tie", "flip flops", "raincoat", "mittens", "beanie", "tuxedo", "swimsuit", "slippers", "kilt"],
  },
  {
    name: "Music",
    words: ["violin", "drum kit", "trumpet", "harp", "accordion", "tambourine", "piano", "bagpipes", "ukulele", "triangle", "choir", "lullaby", "metronome"],
  },
  {
    name: "Food",
    words: ["pancake", "sushi", "lasagne", "popcorn", "porridge", "doughnut", "curry", "omelette", "dumpling", "pretzel", "trifle", "nachos", "toast"],
  },
  {
    name: "Fruit and veg",
    words: ["pineapple", "banana", "mushroom", "coconut", "carrot", "lemon", "pumpkin", "avocado", "cherry", "onion", "watermelon", "broccoli", "grape"],
  },
  {
    name: "Around the house",
    words: ["sofa", "bunk bed", "bathtub", "doorbell", "staircase", "chimney", "wardrobe", "letterbox", "curtains", "attic", "radiator", "mirror", "hammock"],
  },
  {
    name: "Nature",
    words: ["volcano", "rainbow", "waterfall", "glacier", "desert", "cave", "thunderstorm", "island", "swamp", "meadow", "fog", "avalanche", "tide"],
  },
  {
    name: "At the seaside",
    words: ["sandcastle", "lighthouse", "pier", "seagull", "deckchair", "rock pool", "crab", "beach hut", "ice cream van", "jellyfish", "windbreak", "bucket", "shell"],
  },
  {
    name: "Tools and gadgets",
    words: ["hammer", "torch", "ladder", "screwdriver", "tape measure", "compass", "padlock", "magnet", "wheelbarrow", "calculator", "stapler", "binoculars", "umbrella"],
  },
  {
    name: "Celebrations",
    words: ["birthday cake", "fireworks", "wedding", "piñata", "balloon", "confetti", "costume party", "graduation", "sparkler", "bonfire", "carnival", "surprise party", "parade"],
  },
  {
    name: "At school",
    words: ["blackboard", "lunchbox", "homework", "detention", "rubber", "pencil case", "register", "sports day", "field trip", "timetable", "globe", "recorder", "spelling test"],
  },
];
