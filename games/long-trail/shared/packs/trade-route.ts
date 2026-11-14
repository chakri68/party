import type { ChoiceEvent, Effect, EventCard, GoalCard, LegKind, Leg, PlainEvent, RouteDef, SettingPack, StopDef } from "../pack.ts";
import type { Danger } from "../pack.ts";

type Market = NonNullable<StopDef["market"]>;
const mk = (silk: [number, number], spice: [number, number], salt: [number, number], supplies: Market["supplies"]): Market => ({
  goods: { silk, spice, salt },
  supplies,
});

const MARKETS = {
  saltmere: mk([10, 16], [8, 13], [2, 4], { food: 2, water: 1, medicine: 8, animals: 22 }),
  vessa: mk([9, 14], [7, 12], [3, 6], { food: 3, water: 2, medicine: 9 }),
  kessel: mk([10, 15], [6, 10], [3, 5], { food: 3, water: 1, medicine: 9 }),
  rook: mk([8, 13], [8, 13], [4, 7], { food: 3, water: 2 }),
  lorn: mk([9, 14], [7, 11], [3, 6], { food: 2, water: 1, medicine: 8, animals: 23 }),
  gorrow: mk([8, 12], [8, 12], [4, 7], { food: 3, water: 2, medicine: 10 }),
  yarrin: mk([10, 15], [8, 12], [3, 6], { food: 2, water: 1, medicine: 8, animals: 24 }),
  quillon: mk([10, 14], [8, 12], [3, 5], { food: 2, water: 1, medicine: 8, animals: 22 }),
  telOrrin: mk([9, 14], [7, 12], [3, 6], { food: 2, water: 1, medicine: 9 }),
  mirren: mk([14, 22], [10, 16], [4, 8], { food: 3, water: 2, medicine: 10, animals: 26 }),
};

const leg = (to: string, km: number, kind: LegKind, safe?: boolean): Leg => (safe === undefined ? { to, km, kind } : { to, km, kind, safe });
const stop = (id: string, name: string, next: Leg[], market?: Market): StopDef => (market ? { id, name, next, market } : { id, name, next });

const short: RouteDef = {
  start: "dunmar",
  end: "mirren-gate",
  deadline: 12,
  stops: [
    stop("dunmar", "Dunmar", [leg("tel-orrin", 60, "plain")]),
    stop("tel-orrin", "Tel Orrin", [leg("saltmere", 70, "river", true), leg("vessa-pass", 50, "mountain", false)]),
    stop("saltmere", "Saltmere", [leg("quillon", 60, "plain")], MARKETS.saltmere),
    stop("vessa-pass", "Vessa Pass", [leg("quillon", 60, "mountain")], MARKETS.vessa),
    stop("quillon", "Quillon", [leg("mirren-gate", 70, "desert")], MARKETS.quillon),
    stop("mirren-gate", "Mirren Gate", [], MARKETS.mirren),
  ],
};

const normal: RouteDef = {
  start: "dunmar",
  end: "mirren-gate",
  deadline: 20,
  stops: [
    stop("dunmar", "Dunmar", [leg("tel-orrin", 60, "plain")]),
    stop("tel-orrin", "Tel Orrin", [leg("brask", 50, "desert")]),
    stop("brask", "Brask", [leg("saltmere", 80, "river", true), leg("vessa-pass", 60, "mountain", false)]),
    stop("saltmere", "Saltmere", [leg("ombar", 60, "plain")], MARKETS.saltmere),
    stop("vessa-pass", "Vessa Pass", [leg("ombar", 70, "mountain")], MARKETS.vessa),
    stop("ombar", "Ombar", [leg("kessel-wells", 70, "desert", true), leg("rook-pass", 50, "mountain", false)]),
    stop("kessel-wells", "Kessel Wells", [leg("yarrin", 60, "plain")], MARKETS.kessel),
    stop("rook-pass", "Rook Pass", [leg("yarrin", 60, "mountain")], MARKETS.rook),
    stop("yarrin", "Yarrin", [leg("mirren-gate", 70, "river")], MARKETS.yarrin),
    stop("mirren-gate", "Mirren Gate", [], MARKETS.mirren),
  ],
};

const epic: RouteDef = {
  start: "dunmar",
  end: "mirren-gate",
  deadline: 32,
  stops: [
    stop("dunmar", "Dunmar", [leg("tel-orrin", 70, "plain")]),
    stop("tel-orrin", "Tel Orrin", [leg("brask", 60, "desert")], MARKETS.telOrrin),
    stop("brask", "Brask", [leg("saltmere", 90, "river", true), leg("vessa-pass", 70, "mountain", false)]),
    stop("saltmere", "Saltmere", [leg("ombar", 70, "plain")], MARKETS.saltmere),
    stop("vessa-pass", "Vessa Pass", [leg("ombar", 70, "mountain")], MARKETS.vessa),
    stop("ombar", "Ombar", [leg("kessel-wells", 80, "desert", true), leg("rook-pass", 60, "mountain", false)]),
    stop("kessel-wells", "Kessel Wells", [leg("anvil-gap", 60, "plain")], MARKETS.kessel),
    stop("rook-pass", "Rook Pass", [leg("anvil-gap", 60, "mountain")], MARKETS.rook),
    stop("anvil-gap", "Anvil Gap", [leg("teshun", 70, "plain")]),
    stop("teshun", "Teshun", [leg("lorn-ferry", 80, "river", true), leg("gorrow-heights", 60, "mountain", false)]),
    stop("lorn-ferry", "Lorn Ferry", [leg("yarrin", 60, "plain")], MARKETS.lorn),
    stop("gorrow-heights", "Gorrow Heights", [leg("yarrin", 60, "mountain")], MARKETS.gorrow),
    stop("yarrin", "Yarrin", [leg("sef-oasis", 70, "desert")], MARKETS.yarrin),
    stop("sef-oasis", "Sef Oasis", [leg("mirren-gate", 70, "plain")]),
    stop("mirren-gate", "Mirren Gate", [], MARKETS.mirren),
  ],
};

// Events. Choice events: options[0] is the safer one.
const ev = (id: string, kind: LegKind | "any", severity: Danger, text: string, effect: Effect): PlainEvent => ({ id, kind, severity, text, effect });
const ch = (
  id: string,
  kind: LegKind | "any",
  severity: Danger,
  text: string,
  a: [string, Effect],
  b: [string, Effect],
): ChoiceEvent => ({ id, kind, severity, text, options: [{ label: a[0], effect: a[1] }, { label: b[0], effect: b[1] }] });

const events: EventCard[] = [
  // Any, calm
  ev("any-0-spring", "any", 0, "A small spring runs beside the path. Everyone drinks and fills the skins.", { stock: { water: 2 } }),
  ev("any-0-farmer", "any", 0, "A farmer sells you fresh bread for almost nothing.", { stock: { food: 3 } }),
  ev("any-0-letter", "any", 0, "A rider pays you coins to carry a letter. It is not a long letter.", { stock: { coins: 8 } }),
  ev("any-0-quiet", "any", 0, "A quiet day. Nothing happens. Nobody trusts it.", {}),
  ch(
    "any-0-guide",
    "any",
    0,
    "A boy offers to lead you on a short path. He wants 6 coins first.",
    ["Walk on by yourselves", {}],
    ["Pay him and follow", { stock: { coins: -6 }, chance: { p: 0.6, then: { stock: { food: 2, water: 2 } }, else: { km: -20, lostTime: true } } }],
  ),
  ch(
    "any-0-rest",
    "any",
    0,
    "A good camp site, and the sun is still high. Camp now, or use the light?",
    ["Use the light", {}],
    ["Camp now", { km: -10, lostTime: true, stock: { food: 1 } }],
  ),
  // Any, rough
  ev("any-1-wind", "any", 1, "Hot wind all day. The water skins dry out faster than you expect.", { stock: { water: -2 } }),
  ev("any-1-cold", "any", 1, "A cold night and little wood. Someone sleeps badly and wakes sick.", { health: { target: "random", steps: 1 } }),
  ev("any-1-thief", "any", 1, "A thief takes a bag of coins in the night.", { stock: { coins: -12 } }),
  ev("any-1-ropes", "any", 1, "The ropes on a load come loose. You spend half a day tying everything again.", { km: -15, lostTime: true }),
  ch(
    "any-1-peddler",
    "any",
    1,
    "A peddler sells a cure for sick camels. It may be good. It may be coloured water.",
    ["No, thank you", {}],
    ["Buy it for 10 coins", { stock: { coins: -10 }, chance: { p: 0.5, then: { stock: { medicine: 2 } }, else: { health: { target: "random", steps: 1 } } } }],
  ),
  ch(
    "any-1-tired",
    "any",
    1,
    "Everyone is tired and the camels are slow. Stop early, or walk until dark?",
    ["Stop early", { km: -10, lostTime: true }],
    ["Walk until dark", { health: { target: "everyone", steps: 1 } }],
  ),
  // Any, dangerous
  ev("any-2-raiders", "any", 2, "Raiders on fast horses. They take what they can carry and leave before you can speak.", { cargo: -3, stock: { coins: -20 } }),
  ev("any-2-fever", "any", 2, "A fever moves through the camp. One traveller is very sick by morning.", { health: { target: "random", steps: 2 } }),
  ev("any-2-fire", "any", 2, "A lamp falls over in the night. The fire burns a tent and a load of food.", { stock: { food: -4 }, cargo: -1 }),
  ch(
    "any-2-toll",
    "any",
    2,
    "Armed men block the path and ask for a toll of 25 coins. You could try to go round them.",
    ["Pay the toll", { stock: { coins: -25 } }],
    ["Go round them", { km: -30, lostTime: true, chance: { p: 0.5, then: {}, else: { cargo: -3, health: { target: "random", steps: 1 } } } }],
  ),
  ch(
    "any-2-lost-camel",
    "any",
    2,
    "A camel runs off in the night. You can look for it, or leave it.",
    ["Leave it", { stock: { animals: -1 } }],
    ["Look for it all morning", { km: -25, lostTime: true, chance: { p: 0.6, then: {}, else: { stock: { animals: -1 } } } }],
  ),

  // Desert
  ev("desert-0-night", "desert", 0, "The sand is firm and the night is cool. The camels walk well.", {}),
  ev("desert-0-well", "desert", 0, "An old well has a little water left at the bottom.", { stock: { water: 3 } }),
  ev("desert-1-soft", "desert", 1, "Soft sand slows the camels all day.", { km: -15, lostTime: true }),
  ev("desert-1-dry", "desert", 1, "A leaking skin. By noon a third of that water is gone.", { stock: { water: -3 } }),
  ev("desert-2-storm", "desert", 2, "A sandstorm. You sit behind the camels until it ends, and drink more than you planned.", { km: -30, lostTime: true, stock: { water: -3 } }),
  ev("desert-2-sun", "desert", 2, "The sun is cruel today. One traveller falls and cannot get up for an hour.", { health: { target: "random", steps: 1 }, stock: { water: -4 } }),
  ch(
    "desert-1-dunes",
    "desert",
    1,
    "A wall of high dunes lies ahead. Go round for a day, or cross it?",
    ["Go round", { km: -20, lostTime: true }],
    ["Cross it", { chance: { p: 0.5, then: {}, else: { stock: { animals: -1 }, km: -10, lostTime: true } } }],
  ),
  ch(
    "desert-2-mirage",
    "desert",
    2,
    "Something shines far off. It could be a pond. It could be a trick of the heat.",
    ["Stay on the path", { stock: { water: -2 } }],
    ["Walk to it", { km: -20, lostTime: true, chance: { p: 0.4, then: { stock: { water: 6 } }, else: { stock: { water: -4 } } } }],
  ),

  ch(
    "desert-0-oasis",
    "desert",
    0,
    "A green oasis, a little off the path. Camp early and rest, or keep walking?",
    ["Keep walking", {}],
    ["Camp and rest", { km: -15, lostTime: true, stock: { water: 3 } }],
  ),
  ch(
    "mountain-0-hut",
    "mountain",
    0,
    "An old man in a stone hut offers a warm meal for 5 coins.",
    ["Walk on", {}],
    ["Eat with him", { stock: { coins: -5, food: 3 } }],
  ),
  ch(
    "river-0-fish",
    "river",
    0,
    "Fishermen on the bank sell their catch. They also offer to show you a shorter ford.",
    ["Buy only fish", { stock: { coins: -4, food: 3 } }],
    ["Follow them", { chance: { p: 0.7, then: { stock: { food: 2 } }, else: { km: -15, lostTime: true } } }],
  ),
  ch(
    "plain-0-fair",
    "plain",
    0,
    "A village fair is on. You can stop to trade, or pass quickly.",
    ["Pass quickly", {}],
    ["Stop and trade", { km: -10, lostTime: true, chance: { p: 0.6, then: { stock: { coins: 15 } }, else: { stock: { coins: -8 } } } }],
  ),

  // Mountain
  ev("mountain-0-view", "mountain", 0, "The air is clear and the view is wide. Everyone feels better for it.", {}),
  ev("mountain-0-shepherd", "mountain", 0, "A shepherd gives you cheese. In return, you listen to a very long story.", { stock: { food: 2 } }),
  ev("mountain-1-rockfall", "mountain", 1, "Rocks have fallen across the path. It takes half a day to clear.", { km: -20, lostTime: true }),
  ev("mountain-1-cold", "mountain", 1, "A freezing night. Nobody sleeps. The camels eat more to keep warm.", { stock: { food: -2 }, health: { target: "random", steps: 1 } }),
  ev("mountain-2-slide", "mountain", 2, "A rock slide. One traveller is hit and cannot walk well.", { health: { target: "random", steps: 2 } }),
  ev("mountain-2-ledge", "mountain", 2, "A camel slips on a narrow ledge. It lives, but a load goes down the slope.", { stock: { animals: -1 }, cargo: -2 }),
  ch(
    "mountain-1-snow",
    "mountain",
    1,
    "Snow on the high path. Wait for it to melt, or walk through it?",
    ["Wait a day", { km: -30, lostTime: true }],
    ["Walk through it", { chance: { p: 0.5, then: {}, else: { health: { target: "random", steps: 1 }, km: -15, lostTime: true } } }],
  ),
  ch(
    "mountain-2-bridge",
    "mountain",
    2,
    "An old rope bridge. It looks weak. The long way round takes two days.",
    ["Take the long way", { km: -40, lostTime: true, stock: { food: -2 } }],
    ["Use the bridge", { chance: { p: 0.6, then: {}, else: { cargo: -3, stock: { animals: -1 } } } }],
  ),

  // River
  ev("river-0-shallow", "river", 0, "The river is low and clear. You cross without any trouble.", {}),
  ev("river-0-fresh", "river", 0, "Cold, clean water. Every skin is filled to the top.", { stock: { water: 3 } }),
  ev("river-1-high", "river", 1, "The river is high. You cross slowly and some of the food gets wet.", { stock: { food: -2 } }),
  ev("river-1-mud", "river", 1, "The bank is soft mud. A camel sinks to its knees. It takes an hour to pull it out.", { km: -10, lostTime: true }),
  ev("river-2-flood", "river", 2, "A flood comes down in the night. It takes food and a load of goods from the camp.", { stock: { food: -3 }, cargo: -2 }),
  ev("river-2-swept", "river", 2, "A traveller is swept off their feet. They are pulled out cold and hurt.", { health: { target: "random", steps: 2 } }),
  ch(
    "river-1-ferry",
    "river",
    1,
    "A ferryman offers to take you across for 15 coins. The river looks deep, but the ford is nearby.",
    ["Pay the ferryman", { stock: { coins: -15 } }],
    ["Use the ford", { chance: { p: 0.6, then: {}, else: { cargo: -2, stock: { food: -2 } } } }],
  ),
  ch(
    "river-2-rising",
    "river",
    2,
    "Rain far upstream. The river is rising. Cross now, or wait for it to fall?",
    ["Wait for it to fall", { km: -35, lostTime: true }],
    ["Cross now", { chance: { p: 0.5, then: {}, else: { health: { target: "random", steps: 1 }, cargo: -3, stock: { animals: -1 } } } }],
  ),

  // Plain
  ev("plain-0-grass", "plain", 0, "Green grass by the path. The camels eat well and walk faster.", {}),
  ev("plain-0-fire", "plain", 0, "Other travellers share their fire. They sell you a little food and a lot of news.", { stock: { food: 2 } }),
  ev("plain-1-flies", "plain", 1, "Biting flies all night. Nobody sleeps. Everyone is angry in the morning.", { health: { target: "random", steps: 1 } }),
  ev("plain-1-wrong", "plain", 1, "The path forks and the signs are gone. You pick one. It was wrong.", { km: -20, lostTime: true }),
  ev("plain-2-raiders", "plain", 2, "Horsemen come out of the grass. They take goods and coins before they ride away.", { cargo: -3, stock: { coins: -15 } }),
  ev("plain-2-fire", "plain", 2, "Dry grass catches fire from a spark. You lose a day and some supplies getting out.", { km: -25, lostTime: true, stock: { food: -3, water: -1 } }),
  ch(
    "plain-1-merchant",
    "plain",
    1,
    "A merchant sells medicine, 10 coins for 2 doses. He is in a hurry, which is odd.",
    ["No, thank you", {}],
    ["Buy it", { stock: { coins: -10 }, chance: { p: 0.6, then: { stock: { medicine: 2 } }, else: { health: { target: "random", steps: 1 } } } }],
  ),
  ch(
    "plain-2-stranger",
    "plain",
    2,
    "A wounded stranger begs you for water. He has a good bag, and a story that changes each time.",
    ["Walk on", {}],
    ["Help him", { stock: { water: -2 }, chance: { p: 0.5, then: { stock: { coins: 15 } }, else: { cargo: -2, stock: { coins: -10 } } } }],
  ),
];

const goals: GoalCard[] = [
  { id: "coins-60", text: "Arrive with at least 60 coins.", goal: { kind: "coins", atLeast: 60 } },
  { id: "coins-100", text: "Arrive with at least 100 coins.", goal: { kind: "coins", atLeast: 100 } },
  { id: "protect", text: "Make sure this traveller reaches the end alive.", goal: "protect-someone" },
  { id: "protect-2", text: "Keep this traveller safe. Their cousin owes you money.", goal: "protect-someone" },
  { id: "early-90", text: "Arrive early. Use no more than nine tenths of the days.", goal: { kind: "arrive-by", share: 0.9 } },
  { id: "early-80", text: "Arrive early. Use no more than four fifths of the days.", goal: { kind: "arrive-by", share: 0.8 } },
  { id: "visit-saltmere", text: "Visit Saltmere. You like their salt.", goal: { kind: "visit", stop: "saltmere" } },
  { id: "visit-vessa", text: "Visit Vessa Pass. You left something there once.", goal: { kind: "visit", stop: "vessa-pass" } },
  { id: "cargo-silk", text: "Arrive with at least 3 bolts of silk.", goal: { kind: "cargo", good: "silk", atLeast: 3 } },
  { id: "cargo-spice", text: "Arrive with at least 4 sacks of spice.", goal: { kind: "cargo", good: "spice", atLeast: 4 } },
  { id: "cargo-salt", text: "Arrive with at least 5 blocks of salt.", goal: { kind: "cargo", good: "salt", atLeast: 5 } },
  { id: "never-starve", text: "Never let the caravan go a whole day with no food.", goal: { kind: "never-starve" } },
  { id: "nobody-dies", text: "Bring everyone to the end. Nobody dies.", goal: { kind: "nobody-dies" } },
  { id: "grade-rich", text: "Arrive rich, or better.", goal: { kind: "grade", atLeast: "rich" } },
  { id: "grade-fair", text: "Arrive with a fair profit, or better.", goal: { kind: "grade", atLeast: "fair" } },
];

export const tradeRoute: SettingPack = {
  id: "trade-route",
  name: "Trade Route",
  labels: { food: "Food", water: "Water", medicine: "Medicine", animals: "Camels", coins: "Coins", cargo: "Cargo" },
  goods: [
    { id: "silk", name: "Silk" },
    { id: "spice", name: "Spice" },
    { id: "salt", name: "Salt" },
  ],
  jobs: {
    guide: {
      name: "Guide",
      info: "You see how bad the weather is on the next leg: calm, rough or dangerous.",
      ability: "Once per game, change a plain event for a new one.",
    },
    healer: {
      name: "Healer",
      info: "You see exactly how close each traveller is to getting worse.",
      ability: "Give medicine on a travel day, without stopping to rest.",
    },
    trader: {
      name: "Trader",
      info: "You see the prices at the next market town before anyone else.",
      ability: "Get better prices on days when you lead.",
    },
    quartermaster: {
      name: "Quartermaster",
      info: "You see how many days of food and water are left at the current rations.",
      ability: "Once per game, find a hidden store of food.",
    },
    scout: {
      name: "Scout",
      info: "At a fork, you see which way is shorter.",
      ability: "Once per game, cancel an event that costs time.",
    },
    driver: {
      name: "Driver",
      info: "You see how tired each camel is.",
      ability: "Once per leg, a hard pace costs one less health step.",
    },
    cook: {
      name: "Cook",
      info: "You see how long the food lasts at each ration level.",
      ability: "One day per leg, half rations count as full rations for health.",
    },
    lookout: {
      name: "Lookout",
      info: "You see the odds of each option in a choice event.",
      ability: "Once per game, swap a choice event for a different one.",
    },
  },
  routes: { short, normal, epic },
  start: (players) => ({
    food: 8 * players,
    water: 6 * players,
    medicine: 3,
    coins: 60,
    animals: 2 + Math.ceil(players / 2),
    cargo: { silk: 2, spice: 2, salt: 2 },
  }),
  capacityPerAnimal: 4,
  events,
  goals,
  grades: { broke: 0, fair: 100, rich: 200, legendary: 350 },
  endLines: {
    arrived: {
      broke: [
        "You arrived. You also owe someone. Mostly the first part.",
        "Everyone is alive and nobody is richer. A fine walk.",
        "The goods sold for less than the water cost. Still, it was a trip.",
      ],
      fair: [
        "A fair profit. Your families will say it was fine.",
        "Not rich, not broke. The camels are proud.",
        "You made money. You will tell people you made more.",
      ],
      rich: [
        "Rich, late, and two short. A normal trip.",
        "Good money. The route is hard, but you were harder.",
        "A rich caravan. Someone will say it was easy.",
      ],
      legendary: [
        "Legendary. Every trader in Mirren Gate wants to buy you a drink.",
        "They will sing about this one. Badly, but they will.",
        "So much money that the camels were counting it.",
      ],
    },
    failed: [
      "The season ended. The road is still there.",
      "Nobody made it. The camels, at least, found a quiet field.",
      "The goods will wait. The market has moved on.",
    ],
  },
};
