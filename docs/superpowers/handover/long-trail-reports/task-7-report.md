# Task 7 report: balance check and number tuning

Status: DONE_WITH_CONCERNS (all bands pass; a few sit close to an edge, see Concerns).
Commit: c90e906 "Long Trail: tune numbers to the balance bands" (on master, not pushed).

## What I built

`games/long-trail/test/balance.test.ts`. Two bots play whole games through `longTrailGame`
(createGame / handleAction / onTimer / onPlayerDisconnected), one `seededRandomInt` per game
(seeds 1000..), a second seeded RNG for the careless bot's picks. 300 games per length at 5
players for each bot, plus 100 sensible games each at 3 and 8 players (printed only).

- **Sensible:** steady pace; full rations while food covers the days left on this leg, else
  half; rest when someone is Badly hurt and the margin (days left to the deadline minus steady
  days to the end on safe branches) is at least 3; dose every Badly hurt traveller (on a rest
  day, or with a living Healer); at a market sell any held good priced at least 20% above its
  range middle, buy food and water to cover the next leg plus 2 days, then the cheapest good
  up to capacity with coins over 40 (Trader-lead prices applied, same as the server); choice
  option 0; every armable job arms on day 1.
- **Careless:** random pace, random rations, no trades, no rest, no doses, random choices.
- Acts on public/private views; reads exact stock, prices ranges and leg km off server state.
- Calls the brief leaves open (also in the file's header comment): the sensible bot takes the
  safe branch at a fork (the open plan's), the careless one picks a branch at random; the
  sensible bot doesn't rebuy a good it is selling that day, and trades only on moving days.
- Speed trick: all players but p0 are marked away, so p0's single vote/choice/Next closes each
  phase at once (allHere counts connected players only). A Go from p0 is a majority of votes
  cast. This gave identical results to voting-then-ringing and cut clones per day by ~25%;
  structuredClone in handleAction is ~75% of the run time.
- Asserts per length: sensible arrival in [0.55, 0.80], fair + rich >= 0.50 and legendary <=
  0.15 among sensible arrivals, careless arrival <= 0.35, median sensible arrival day in
  [deadline - 5, deadline - 1]. `console.table` prints the table (vitest 5's default reporter
  hides console output of passing tests; use `--reporter=verbose` to see it).

## Before (original numbers, same harness)

| bot | length | players | arrive | dead | broke | fair | rich | legend | fair+rich | median day | deadline | median wealth |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sensible | short | 5 | 0.92 | 0.08 | 1 | 0 | 0 | 0 | 0 | 10 | 12 | 35 |
| careless | short | 5 | 0.38 | 0.60 | 0.61 | 0.39 | 0 | 0 | 0.39 | 10 | 12 | 84 |
| sensible | normal | 5 | 0.04 | 0.96 | 1 | 0 | 0 | 0 | 0 | 18 | 20 | 32 |
| careless | normal | 5 | 0 | 1 | - | - | - | - | - | - | 20 | - |
| sensible | epic | 5 | 0 | 1 | - | - | - | - | - | - | 32 | - |
| careless | epic | 5 | 0 | 1 | - | - | - | - | - | - | 32 | - |
| sensible | short | 3 | 0.91 | 0.09 | 0.99 | 0.01 | 0 | 0 | 0.01 | 10 | 12 | 36 |
| sensible | short | 8 | 0.96 | 0.05 | 1 | 0 | 0 | 0 | 0 | 10 | 12 | 34 |
| sensible | normal | 3 | 0.06 | 0.94 | 1 | 0 | 0 | 0 | 0 | 18 | 20 | 21 |
| sensible | normal | 8 | 0.06 | 0.94 | 1 | 0 | 0 | 0 | 0 | 18 | 20 | 1 |
| sensible | epic | 3 | 0 | 1 | - | - | - | - | - | - | 32 | - |
| sensible | epic | 8 | 0 | 1 | - | - | - | - | - | - | 32 | - |

(3/8-player "before" rows ran at 200 games each.) Why: start stock was 4 days of food and 6 of
water, Normal's first market is 7 days in, supplies cost 2-3 coins a unit against 60 starting
coins, and coin events (toll 25, raiders 20, thief 12) drained the rest. The caravan ran dry,
went thirsty (3 risk points = 36%/day per traveller) and died.

## After (final)

| bot | length | players | arrive | dead | broke | fair | rich | legend | fair+rich | median day | deadline | median wealth |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sensible | short | 5 | 0.71 | 0 | 0 | 0.29 | 0.62 | 0.09 | 0.91 | 11 | 12 | 365 |
| careless | short | 5 | 0.26 | 0.45 | 0.13 | 0.86 | 0.01 | 0 | 0.87 | 11 | 12 | 278 |
| sensible | normal | 5 | 0.78 | 0 | 0 | 0.37 | 0.55 | 0.08 | 0.92 | 18 | 20 | 363 |
| careless | normal | 5 | 0.06 | 0.91 | 0.11 | 0.89 | 0 | 0 | 0.89 | 18 | 20 | 271 |
| sensible | epic | 5 | 0.66 | 0.22 | 0.33 | 0.51 | 0.15 | 0.01 | 0.66 | 30 | 32 | 268 |
| careless | epic | 5 | 0 | 1 | - | - | - | - | - | 28 | 32 | - |
| sensible | short | 3 | 0.54 | 0 | 0.02 | 0.57 | 0.39 | 0.02 | 0.96 | 12 | 12 | 316 |
| sensible | short | 8 | 0.78 | 0 | 0 | 0.06 | 0.72 | 0.22 | 0.78 | 11 | 12 | 415 |
| sensible | normal | 3 | 0.78 | 0 | 0.10 | 0.63 | 0.27 | 0 | 0.90 | 19 | 20 | 307 |
| sensible | normal | 8 | 0.85 | 0 | 0 | 0.11 | 0.62 | 0.27 | 0.73 | 18 | 20 | 402 |
| sensible | epic | 3 | 0.70 | 0.20 | 0.34 | 0.53 | 0.13 | 0 | 0.66 | 28 | 32 | 260 |
| sensible | epic | 8 | 0.68 | 0.18 | 0.25 | 0.47 | 0.25 | 0.03 | 0.72 | 29 | 32 | 299 |

Arrival-day spread at 5 players (sensible): Short {11: 121, 12: 93}; Normal {17: 20, 18: 108,
19: 65, 20: 42}; Epic 24-32, median 30.

How each length fails now: Short and Normal fail on the deadline (no sensible deaths: the
start stock carries them). Epic fails on both: deaths on the long no-market stretches
(Kessel to Lorn, Yarrin to Mirren, where "next leg + 2 days" under-buys) and the deadline.
Careless fails mostly by deaths (random none/half rations and hard pace at 20% a point).

## Every number changed (old -> new, why)

`shared/numbers.ts`
- `riskStepChance` 0.12 -> 0.2. Careless play has to die (<= 35% arrival needs nearly all 5
  travellers dead); sensible play carries ~0 risk points when supplied, so a higher per-point
  chance separates the two bots.
- `risk.thirst` 3 -> 2, `risk.hungry` 2 -> 1. At 0.2 a point, a thirsty day was 60% per
  traveller; one short stretch on Epic wiped the caravan.
- `risk.sick` 1 -> 0.5. Untreated Sick still worsens (10%/day), but a single event hit no
  longer spirals to death over a long route.

`shared/packs/trade-route.ts`
- Start stock: food `8n` -> `44n`, water `6n` -> `30n` (22 days of full food, ~3-4 weeks of
  water). Needed because the brief's policy buys only "next leg + 2 days", so after a
  non-market stop the caravan runs short; the start buffer is what carries it. Also fixes the
  8-player Short starvation. Epic arrival was very sensitive to this (36n: 0.13, 44n: 0.66).
- Start coins `60` -> `200 + 10n`. The sensible bot spends down to 40 on goods at the first
  market and never sells to fund supplies, so it needs cash left over; the small per-player
  term keeps 3 and 8 players' wealth closer (30n made 8 players 98% legendary).
- Supply prices: food 2-3 -> 1 (2 at Kessel Wells and Rook Pass), water 1-2 -> 1 everywhere.
  At 2-3 coins a unit, a 5-player caravan needed ~35 coins a day.
- Coin-loss events: thief -12 -> -8; any-2-raiders cargo -3/coins -20 -> -2/-10; plain-2-raiders
  cargo -3/coins -15 -> -2/-10; toll 25 -> 15 (text too); ferry 15 -> 8 (text too). The
  sensible bot always pays (option 0); these drained Epic caravans to 0 coins before Yarrin.
- `any-2-lost-camel` option 1: chance 0.6 keep / else lose the camel -> 0.5 keep / else lose the
  camel AND one random traveller hurt 1 step. Option 0 (certain camel loss, no time) is now a
  real trade against a half-day search that can end worse. Option 0 still has no chance.
- Goals: `coins-60` (60) -> `coins-150` (150); `coins-100` (100) -> `coins-200` (200). Ids
  renamed to match (nothing else referenced them). Sensible arrivals' coins: median ~170
  (Short/Normal), ~90 (Epic), so 150 is about even odds and 200 is a stretch.
- Grades: fair 100 -> 240, rich 200 -> 340, legendary 350 -> 460. Set from the 5-player
  wealth percentiles: legendary above Short/Normal's ~p90, fair below Epic's ~p40.
- Leg km (all multiples of 30 unless noted, so a lost half-day costs a whole day):
  - Short: tel-orrin -> saltmere 70 -> 90; saltmere -> quillon 60 -> 90; quillon -> mirren-gate
    70 -> 90. Safe path 10 -> 11 days. Short had no sensible failures without deadline
    pressure. Min path (via Vessa) still 9 = deadline - 3.
  - Normal: tel-orrin -> brask 50 -> 60; brask -> saltmere 80 -> 90; ombar -> kessel-wells
    70 -> 90; yarrin -> mirren-gate 70 -> 80. Safe path stays 17 days but with almost no
    slack. Normal fails on the deadline only; 16 days gave 0.86-0.92 arrival.
  - Epic: dunmar -> tel-orrin 70 -> 60; brask -> vessa 70 -> 60; saltmere -> ombar 70 -> 60;
    vessa -> ombar 70 -> 60; ombar -> kessel-wells 80 -> 60; ombar -> rook 60 -> 50;
    anvil-gap -> teshun 70 -> 60; yarrin -> sef-oasis 70 -> 60; sef-oasis -> mirren-gate
    70 -> 60. Safe path 29 -> 24 days. Shorter legs after non-market stops shrink the supply
    gaps; the bot also rests a lot more with the extra margin, which is where the days go
    (median arrival 30).
- Deadlines unchanged (12/20/32). Unsafe branches still shorter in km than safe ones.

## Test fixed (not the numbers)

`test/events.test.ts` "healer gives today's worsen chance ...": it hard-coded 0.12/0.24/0.48/
0.84 from the live N. Now it derives each expectation from `N.risk` and `N.riskStepChance`,
summing points in riskPoints' order so the floats match exactly.

## Test results

- `pnpm vitest run games/long-trail`: 9 files, 164 tests pass; balance file 13.7 s standalone.
- `pnpm typecheck`: exit 0.
- `pnpm test`: 153 files / 2465 tests pass (pass-the-bomb didn't flake this time). The
  long-trail balance file takes ~33-37 s under the full parallel suite; its timeout is 120 s.

## Files changed

- `games/long-trail/test/balance.test.ts` (new)
- `games/long-trail/shared/numbers.ts`
- `games/long-trail/shared/packs/trade-route.ts`
- `games/long-trail/test/events.test.ts`

## Concerns

1. **Edges.** Normal sensible arrival is 0.78 (cap 0.80) and its median day is 18 with 128 of
   235 arrivals at day <= 18; Short's median 11 has 121 of 214. Normal fails only on the
   deadline, so arrival rate and median day move together; I couldn't find leg km that gives
   both comfortable margins (16-day paths: 0.86+; zero-slack 17: 0.74 but median 19). Seeded,
   so it passes deterministically, but a future rule change can tip it.
2. **The start stock does most of the work.** 44 food and 30 water per traveller means Short
   and Normal never need to buy supplies, and markets matter for supplies mainly on Epic. The
   cause is the brief's buy policy ("next leg + 2 days") meeting stops without markets: any
   policy that bought "to the next market" would let the stock come down a lot. If you want
   "not enough food" to bite on Short/Normal, that bot rule is the thing to revisit, not N.
3. **Grades don't mean "profit".** Start wealth is ~320 (250 coins + 6 goods at Mirren), and
   fair starts at 240, so a caravan that loses money can still arrive "fair". The bot's
   trading is weak (buys the cheapest good, rarely sells mid-route). Bands pass; the names
   just flatter it a bit. Raising Mirren buy prices would make trading matter more.
4. **Epic is no longer "tighter for its distance"** (spec line). Safe path 24 days against 32;
   the steady-only bot spends the margin resting. The bot can't push pace, so the bands
   couldn't hold with a tight Epic.
5. **3 players on Short arrive 0.54**, below the 5-player band (printed only). Fewer camels
   means one lost camel puts them over capacity (steady counts as slow) and the bot never
   dumps cargo. 8 players look healthy (0.68-0.85) but drift richer (22-27% legendary).
6. **Time.** 13.7 s standalone, ~35 s inside `pnpm test`. The 3/8-player side runs are 100
   games each (print-only) to stay under 20 s; the banded runs are 300.
7. `console.table` only shows with `--reporter=verbose` (vitest 5 hides passing tests' logs).

---

## Fix report 1: make markets matter (commit 213e84b)

Ruling applied: the sensible bot buys food and water to reach the next market plus 2 days; a
"no-trade" bot (sensible, never buys or sells goods) and two new asserts (no-trade's
fair-or-better share at least 0.25 below sensible's, per length; careless fair-or-better
<= 0.35); start stock covers the first leg or two; start coins and cargo are fixed; grades
are set against start wealth W0; Epic's safe path is 27 days.

### Before (c90e906 numbers, new bot policies, 300 games; 3p/8p at 60)

| bot | length | p | arrive | dead | broke | fair | rich | legend | fair+rich | fair+ | median day | wealth |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sensible | short | 5 | 0.71 | 0 | 0 | 0.29 | 0.62 | 0.09 | 0.91 | 1 | 11/12 | 365 |
| no-trade | short | 5 | 0.82 | 0 | 0.07 | 0.93 | 0 | 0 | 0.93 | 0.93 | 11/12 | 287 |
| careless | short | 5 | 0.26 | 0.45 | 0.13 | 0.86 | 0.01 | 0 | 0.87 | 0.87 | 11/12 | 278 |
| sensible | normal | 5 | 0.78 | 0 | 0 | 0.37 | 0.55 | 0.08 | 0.92 | 1 | 18/20 | 363 |
| no-trade | normal | 5 | 0.94 | 0 | 0.22 | 0.78 | 0 | 0 | 0.78 | 0.78 | 18/20 | 270 |
| careless | normal | 5 | 0.06 | 0.91 | 0.11 | 0.89 | 0 | 0 | 0.89 | 0.89 | 18/20 | 271 |
| sensible | epic | 5 | 0.74 | 0.09 | 0.43 | 0.47 | 0.09 | 0.01 | 0.57 | 0.57 | 30/32 | 250 |
| no-trade | epic | 5 | 0.99 | 0.01 | 0.94 | 0.06 | 0 | 0 | 0.06 | 0.06 | 28/32 | 155 |
| careless | epic | 5 | 0 | 1 | - | - | - | - | - | - | - | - |
| sensible | short | 3 / 8 | 0.52 / 0.77 | | | | | | | | 12 / 11 | 338 / 410 |
| sensible | normal | 3 / 8 | 0.77 / 0.87 | | | | | | | | 19 / 18 | 310 / 404 |
| sensible | epic | 3 / 8 | 0.82 / 0.68 | | | | | | | | 28 / 30 | 254 / 278 |

The review was right: no-trade and careless land "fair" 78-93% of the time on Short and Normal,
and no-trade out-arrives sensible everywhere.

### After (final)

| bot | length | p | arrive | dead | broke | fair | rich | legend | fair+rich | fair+ | median day | wealth |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sensible | short | 5 | 0.72 | 0 | 0 | 0.16 | 0.84 | 0 | 1 | 1 | 11/12 | 1520 |
| no-trade | short | 5 | 0.72 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 11/12 | 814 |
| careless | short | 5 | 0.22 | 0.54 | 1 | 0 | 0 | 0 | 0 | 0 | 11/12 | 873 |
| sensible | normal | 5 | 0.75 | 0.09 | 0 | 0.54 | 0.46 | 0 | 1 | 1 | 19/20 | 1425 |
| no-trade | normal | 5 | 0.75 | 0.09 | 1 | 0 | 0 | 0 | 0 | 0 | 19/20 | 681 |
| careless | normal | 5 | 0 | 1 | - | - | - | - | - | - | - | - |
| sensible | epic | 5 | 0.69 | 0.10 | 0.05 | 0.89 | 0.06 | 0 | 0.95 | 0.95 | 31/32 | 1173 |
| no-trade | epic | 5 | 0.69 | 0.10 | 1 | 0 | 0 | 0 | 0 | 0 | 31/32 | 387 |
| careless | epic | 5 | 0 | 1 | - | - | - | - | - | - | - | - |
| sensible | short | 3 | 0.52 | 0 | 0 | 0.77 | 0.23 | 0 | 1 | 1 | 12/12 | 1365 |
| sensible | short | 8 | 0.75 | 0 | 0 | 0 | 1 | 0 | 1 | 1 | 11/12 | 1629 |
| sensible | normal | 3 | 0.62 | 0.30 | 0 | 0.95 | 0.05 | 0 | 1 | 1 | 19/20 | 1334 |
| sensible | normal | 8 | 0.85 | 0 | 0 | 0.43 | 0.57 | 0 | 1 | 1 | 18/20 | 1452 |
| sensible | epic | 3 | 0.67 | 0.23 | 0.05 | 0.95 | 0 | 0 | 0.95 | 0.95 | 31/32 | 1173 |
| sensible | epic | 8 | 0.65 | 0.25 | 0.21 | 0.77 | 0.03 | 0 | 0.79 | 0.79 | 31/32 | 1064 |

Arrival-day spread, 5p sensible: Short {11: ~57%, 12}; Normal {18: 38%, 19: 35%, 20: 27%};
Epic {≤29: ~8%, 30: 28%, 31: 33%, 32: 31%}. The Normal and Epic medians are both 19 and 31, each
sitting on a wide block of arrivals, so a single seed won't flip them.

### How the economy works now

W0 = 800 coins + 2 silk, 2 spice, 2 salt at Mirren's middle prices (40, 24, 14) = 956, the same
at every player count. Every non-trading caravan ends below W0 because it pays for supplies
(no-trade 387-814), so it grades broke. The money is in silk: it costs 5-8 at every market and
sells for 36-44 at Mirren Gate, and its range is narrow enough that the bot never sells it on the
way (8 < 1.2 x its middle). The bot fills capacity with silk at the first market (~19 bolts for 5
players), which costs ~120, so it keeps hundreds of coins for supplies. Profit ~ +600 per
caravan. Supply spend grows with the route (~60 Short, ~250 Normal, ~450 Epic for 5 players), so
Short arrives mostly rich, Normal half and half, Epic mostly fair.

### Every number changed this round (old -> new, why)

Bot (test/balance.test.ts): buy cover "next leg + 2 days" -> "to the next market + 2 days" (the
ruling). Water for the +2 days drinks at the last leg's rate. New no-trade bot, new asserts,
`fairUp` column. 3/8-player print runs 100 -> 60 games.

shared/packs/trade-route.ts:
- Start: food 44n -> 14n (7 days, Normal's first market is 7 days in); water 30n -> 10n (Normal
  needs 9 per traveller to reach Saltmere); coins 200 + 10n -> 800, fixed. Cargo stays 2/2/2.
  At 600, 8-player Epic ran out of coins (0.17 arrival); 800 brings it to 0.65.
- Goods prices (market ranges; supplies unchanged):
  saltmere 10-16/8-13/2-4 -> 5-7/10-18/8-11; vessa 9-14/7-12/3-6 -> 6-8/9-17/9-12;
  kessel 10-15/6-10/3-5 -> 5-7/11-18/8-12; rook 8-13/8-13/4-7 -> 6-8/10-16/9-13;
  lorn 9-14/7-11/3-6 -> 5-7/10-17/8-12; gorrow 8-12/8-12/4-7 -> 6-8/9-16/9-12;
  yarrin 10-15/8-12/3-6 -> 5-7/11-18/8-11; quillon 10-14/8-12/3-5 -> 6-8/10-17/9-12;
  tel-orrin 9-14/7-12/3-6 -> 5-7/10-18/8-12; mirren 14-22/10-16/4-8 -> 36-44/20-28/12-16
  (silk/spice/salt). Why: the first attempts (goods x2-x3, salt cheapest) let the bot spend down
  to 40 coins on goods, then it starved at the next market. Cheap silk means capacity runs out
  before coins do. Silk is cheap in the east and dear at Mirren Gate.
- capacityPerAnimal 4 -> 5. At 4, Epic sensible was 55% fair+rich (edge) and nobody was rich on
  Epic; 5 gives Short 84% rich, Normal 46%, Epic 6%.
- Grades 240/340/460 -> 985/1435/2105 = 1.03 / 1.5 / 2.2 x W0.
- Goals: coins-150 -> coins-500, coins-200 -> coins-600 (sensible arrival coins: median ~590
  Short, ~500 Normal, ~230 Epic). cargo-silk 3 -> 22 bolts (the bot arrives with 21-24).
- any-2-lost-camel: option 0 "Leave it" (certain camel loss) -> "Look for it all morning" (-25 km,
  certain); option 1 -> "Go on without it" (50% the camel is lost). Why: the bot fills capacity
  and never dumps cargo, so a certain camel loss on option 0 overloaded it for the rest of the
  trip (steady counts as slow) and killed most sensible Epic caravans. Still a real trade (time
  now or a coin-flip on a camel), option 0 has no chance.
- Legs: normal dunmar -> tel-orrin 60 -> 70 (Normal path 17 -> 18 days, 2 of them slack: arrival
  0.86 -> 0.75 with a robust median of 19). Epic ombar -> kessel-wells 60 -> 90, anvil-gap ->
  teshun 60 -> 90, sef-oasis -> mirren-gate 60 -> 90 (safe path 24 -> 27 days, per the ruling).
- numbers.ts unchanged this round.

### Results

- `pnpm vitest run games/long-trail`: 9 files, 164 tests pass.
- `pnpm typecheck`: exit 0.
- Balance file standalone: 18.8 s (17.7-19.3 s across runs).

### Concerns

1. **Time margin is thin**: 18.8 s against 20 s. The cost is structuredClone in handleAction,
   ~3 clones a game day; three bots x 300 games is 2700 asserted games.
2. **Nobody reaches legendary** (2.2 x W0 = 2105; best caravans make ~1700). It meets the band
   (<= 0.15) but the grade is dead in bot play. A table that flips silk well, or sells spice high,
   might get there.
3. **Trading is one move**: fill up on silk once, sell it at Mirren Gate. The bot's 20% rule
   never sells silk on the way, by design, so Normal/Epic markets only matter for supplies. A
   human table has more to argue about (silk for capacity vs water), but the bot proves only
   that one move.
4. **Fixed coins mean big tables are poorer**: 8-player Epic is 21% broke and 0.65 arrival (5p:
   5% / 0.69). Short and Normal at 8p are fine (rich-heavy).
5. **3 players**: Short 0.52 (fewer camels, one loss overloads), Normal 0.62 with 0.30 dead.
   Printed only.
6. **Edges**: Short median 11 has ~57% of arrivals at 11; Epic median is 31 of a 31 limit. The
   sensible bot rests whenever it has 3+ days of margin, so it spends Epic's 5 spare days and
   arrives late regardless of leg km.
