// The category lists for category mode. Server only: the lobby gets the names
// (shared/types.ts), and the table gets checked against these (shared/viable.ts).
// Written for this project. Every word is in the dictionary and none is listed
// twice in its category (test/rules.test.ts checks).

import type { Category } from "../shared/types.ts";

const list = (words: string): readonly string[] => words.trim().split(/\s+/);

export const CATEGORY_WORDS: Record<Category, readonly string[]> = {
  animals: list(`
    aardvark alligator alpaca anteater antelope ape armadillo badger bat bear beaver bee beetle
    bison boar buffalo bull butterfly camel canary caribou cat caterpillar cheetah chimpanzee
    chipmunk cobra cougar cow coyote crab crane cricket crocodile crow deer dingo dog dolphin
    donkey dove dragonfly duck eagle eel elephant elk emu falcon ferret finch flamingo fox frog
    gazelle gecko gerbil giraffe goat goose gopher gorilla grasshopper hamster hare hawk
    hedgehog heron hippopotamus hornet horse hyena iguana jaguar jellyfish kangaroo koala
    ladybug lemur leopard lion lizard llama magpie mole mongoose monkey moose mosquito moth
    mouse mule octopus ostrich otter owl panda panther parrot peacock pelican penguin pig pigeon
    platypus porcupine possum puma rabbit raccoon rat raven reindeer rhinoceros robin salmon
    scorpion seal shark sheep shrimp skunk sloth snail snake sparrow spider squid squirrel stork
    swan tiger toad tortoise turkey turtle vulture walrus wasp weasel whale wolf wombat
    woodpecker worm yak zebra
  `),
  food: list(`
    apple apricot avocado bacon bagel banana bean beef biscuit bread broccoli brownie burrito
    butter cabbage cake candy carrot cashew cauliflower celery cereal cheese cherry chili
    chocolate chowder coconut cookie corn cracker cucumber cupcake curry custard date doughnut
    dumpling egg eggplant fig fudge garlic ginger granola grape gravy hamburger honey hummus jam
    jelly kale kebab ketchup lasagna lemon lentil lettuce lime macaroni mango meatball melon
    muffin mushroom mustard noodle oatmeal olive omelet onion orange pancake papaya pasta pastry
    peach peanut pear pepper pickle pie pineapple pizza plum popcorn potato pretzel pudding
    pumpkin radish raisin rice salad salami salsa sandwich sausage soup spaghetti spinach steak
    stew strawberry sushi taco toast tofu tomato tortilla turnip vinegar waffle walnut yogurt
    zucchini
  `),
  body: list(`
    abdomen ankle arm armpit artery back backbone belly bladder blood bone brain brow calf cheek
    cheekbone chest chin collarbone cornea dimple ear eardrum earlobe elbow eye eyebrow eyelash
    eyelid face finger fingernail fist foot forearm forehead freckle gland gum hair hand head
    heart heel hip intestine jaw kidney knee kneecap knuckle leg lip liver lung molar mouth
    muscle nail navel neck nerve nose nostril palm pancreas pelvis pupil retina rib scalp shin
    shoulder skeleton skin skull spine spleen stomach sweat temple tendon thigh throat thumb toe
    toenail tongue tonsil tooth torso vein waist wrist
  `),
  home: list(`
    armchair attic balcony basement bathtub bed bedroom blanket blender bookcase broom bucket
    cabinet candle carpet ceiling chair chimney closet couch counter cupboard curtain cushion
    desk dishwasher door doorbell doormat drain drawer dresser dustpan faucet fence fireplace
    floor footstool fork fridge garage garden gate hallway hammer hanger heater kettle kitchen
    ladder lamp laundry lock mailbox mattress microwave mirror mop mug napkin oven pan pantry
    pillow plate porch pot quilt radiator rug saucepan shelf shower sink sofa sponge spoon
    stairs stool stove table teapot television thermostat toaster toilet towel tray vase
    wardrobe window
  `),
  nature: list(`
    avalanche bay beach blizzard boulder branch breeze brook canyon cave cliff cloud coast coral
    creek dawn desert dew drizzle dune dusk earthquake fern field flood fog forest frost glacier
    grass gravel hail hill horizon iceberg island jungle lagoon lake leaf lightning marsh meadow
    mist moon moss mountain mud oak ocean pebble pine plain pond prairie rain rainbow reef river
    rock sand savanna sea shore sky slope snow soil spring star storm stream sun sunrise sunset
    swamp thunder tide tornado tree tundra twig valley volcano waterfall wave weed wind wood
  `),
  jobs: list(`
    accountant actor architect artist astronaut auctioneer author baker banker barber butcher
    butler captain carpenter cashier chef chemist clerk coach cobbler cook courier dancer
    dentist designer detective diver doctor driver drummer economist editor electrician engineer
    farmer firefighter fisherman florist gardener glazier guard guide hairdresser janitor
    jeweler journalist judge lawyer lecturer librarian lifeguard locksmith magician manager
    mechanic midwife miner musician nanny nurse painter pharmacist photographer physician pilot
    plumber poet politician porter potter professor programmer psychologist ranger referee
    reporter sailor salesman scientist sculptor secretary shepherd sheriff singer soldier
    surgeon surveyor tailor teacher therapist translator tutor umpire veterinarian waiter welder
    writer
  `),
};

const sets = new Map<Category, Set<string>>();

/** On the list. Sets built on first use. */
export function inCategory(category: Category, word: string): boolean {
  let set = sets.get(category);
  if (!set) sets.set(category, (set = new Set(CATEGORY_WORDS[category])));
  return set.has(word);
}

/** The minimum each list promises. */
export const MIN_CATEGORY_WORDS = 80;
