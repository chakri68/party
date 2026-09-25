/**
 * Things you can draw with a mouse and some optimism. Lowercase; a few are two
 * words. Anything that needs letters or numbers on it to make sense stays out.
 */
export const WORDS: readonly string[] = [
  // animals
  "cat", "dog", "fish", "bird", "horse", "cow", "pig", "sheep", "goat", "chicken",
  "duck", "owl", "penguin", "flamingo", "parrot", "eagle", "bat", "frog", "turtle", "snake",
  "lizard", "crocodile", "dinosaur", "shark", "whale", "dolphin", "octopus", "jellyfish", "crab", "lobster",
  "snail", "spider", "bee", "butterfly", "ant", "ladybug", "mosquito", "worm", "mouse", "rabbit",
  "squirrel", "hedgehog", "fox", "wolf", "bear", "panda", "koala", "kangaroo", "monkey", "gorilla",
  "elephant", "giraffe", "zebra", "lion", "tiger", "camel", "hippo", "rhino", "deer", "moose",
  "unicorn", "dragon", "mermaid", "seahorse", "peacock", "swan", "sloth", "raccoon", "skunk", "llama",
  // food
  "apple", "banana", "cherry", "grapes", "lemon", "orange", "pear", "pineapple", "strawberry", "watermelon",
  "coconut", "avocado", "carrot", "corn", "broccoli", "mushroom", "potato", "tomato", "onion", "pepper",
  "bread", "cheese", "egg", "bacon", "sandwich", "hamburger", "hot dog", "pizza", "taco", "sushi",
  "noodles", "popcorn", "pretzel", "donut", "cookie", "cake", "cupcake", "pie", "ice cream", "lollipop",
  "candy", "chocolate", "pancake", "waffle", "honey", "milk", "coffee", "tea", "juice", "soup",
  // around the house
  "chair", "table", "bed", "sofa", "lamp", "door", "window", "stairs", "clock", "mirror",
  "bathtub", "toilet", "shower", "sink", "fridge", "oven", "toaster", "kettle", "fork", "spoon",
  "knife", "plate", "bowl", "cup", "bottle", "candle", "pillow", "blanket", "broom", "bucket",
  "key", "lock", "ladder", "hammer", "saw", "screwdriver", "scissors", "needle", "rope", "umbrella",
  "television", "computer", "keyboard", "phone", "camera", "headphones", "light bulb", "battery", "plug", "remote",
  // things you wear
  "hat", "crown", "helmet", "glasses", "scarf", "glove", "sock", "shoe", "boot", "sandal",
  "dress", "shirt", "pants", "shorts", "skirt", "tie", "belt", "backpack", "purse", "ring",
  "necklace", "watch", "mask", "cape", "bikini",
  // getting around
  "car", "bus", "truck", "train", "tractor", "bicycle", "motorcycle", "scooter", "skateboard", "boat",
  "sailboat", "ship", "submarine", "airplane", "helicopter", "rocket", "hot air balloon", "parachute", "ambulance", "fire truck",
  "taxi", "tank", "canoe", "anchor", "traffic light",
  // outside
  "sun", "moon", "star", "cloud", "rain", "rainbow", "snowman", "lightning", "tornado", "volcano",
  "mountain", "island", "beach", "wave", "river", "waterfall", "desert", "cactus", "tree", "palm tree",
  "flower", "rose", "sunflower", "leaf", "grass", "forest", "cave", "bridge", "castle", "house",
  "tent", "igloo", "lighthouse", "windmill", "pyramid", "tower", "fountain", "fence", "garden", "campfire",
  "planet", "comet", "earth", "snowflake", "puddle",
  // stuff
  "ball", "balloon", "kite", "yo-yo", "dice", "puzzle", "teddy bear", "robot", "doll", "drum",
  "guitar", "piano", "violin", "trumpet", "microphone", "book", "pencil", "crayon", "paintbrush", "envelope",
  "map", "globe", "compass", "telescope", "magnet", "treasure", "coin", "gift", "trophy", "medal",
  "flag", "sword", "shield", "bow and arrow", "cannon", "bomb", "ghost", "skeleton", "zombie", "vampire",
  "witch", "wizard", "pirate", "ninja", "astronaut", "alien", "angel", "king", "queen", "clown",
  "tooth", "eye", "nose", "ear", "hand", "foot", "brain", "heart", "bone", "mustache",
  "beard", "fingerprint", "footprint", "shadow", "fire", "smoke", "bubble", "magnifying glass", "spider web", "chain",
  // doing things
  "swimming", "dancing", "sleeping", "running", "fishing", "juggling", "surfing", "skiing", "sneezing", "crying",
  "laughing", "yawning", "cooking", "painting", "singing", "reading", "jumping", "climbing", "flying", "falling",
];
