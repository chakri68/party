# Long Road (game id `long-road`, working title)

A trail game for the room: one shared caravan, a long route, not enough food, and a table that has to agree on every risky call. Genre: wagon-trail survival, in the tradition of the 1970s classic, but with our own name, settings, events, text and numbers. Nothing from that game carries over: no name, no 1840s American west, no hunting minigame, no famous death lines, no tombstones.

## Why

Trail games are solo. One person makes every call and everyone else watches. This site is phones in a group chat, so the multiplayer layer has to *be* the game. The fix: everyone rides the same caravan and votes on how it moves, and everyone also has a secret reason to want something slightly different. That gives the table something to argue about on every day, without becoming another traitor game. Heist and Nightfall already cover traitors.

## Goals, non-goals, anti-goals

**Goals**
- 3–8 players, 15–30 minutes, phones only, on the normal room runtime (turn-based, no streams, no Godot).
- Every player has a say every day (the vote), and something only they know (job info, secret goal).
- Settings as a lobby option. Each setting is a data pack plus one signature rule. Ship **Trade Route** first; **Monsoon** and **Space Convoy** follow as packs once the core plays well.

**Non-goals (v1)**
- Real-time anything: hunting, steering, reflex minigames.
- Personal inventories. Everything the caravan owns is shared.
- A traitor role.
- Custom art. Icons and text, same as the card and word games.

**Anti-goals** (failures even if it technically works)
- One loud player effectively runs the caravan. Leader rotates daily and the table votes.
- A player whose traveller dies sits out for ten minutes. Dead travellers keep voting and keep their goal.
- Days that drag. A day is about a minute.
- Anything recognisable from the classic game's text, names or art.

## Approaches considered

- **A. Skins only.** One rule set, settings swap names, events and goals. Cheapest, but settings stop feeling different after a few games.
- **B. A separate game per setting.** Most variety, but three games to balance and every rules change made three times.
- **C. Shared core plus one signature rule per setting.** One engine, one core balance pass, and each setting still plays a little differently. **Picked by the user.** Trade Route ships first because markets give the table the most to argue about.

## How a game plays

### Setup

1. The host picks a **setting** (v1: Trade Route only) and a **length**.
2. Each player gets a **traveller** (their own name and face, from the room), a **job card** and a **secret goal card**. They tap **Got it** (30 s, like Heist's reveal).
3. The caravan starts at the first stop with the setting's starting stock.

### A day

**Travel model (builder-check call):** legs between stops have distances (in km) and usually take 2–3 days. Pace sets how far a day goes. The caravan always halts on reaching a stop, even mid-day, and the rest of that day is lost. So every stop gets a fresh plan, which is where forks and markets are decided. "Lose half a day" on an event card means losing half a day's distance at the current pace. The day counter only moves in whole days.

1. **Plan (leader, 45 s).** The day's leader sets:
   - **Pace:** slow / steady / hard. Hard covers more ground, eats more and hurts health. Slow is the reverse.
   - **Rations:** full / half / none.
   - **Route**, only at a fork: one of two next legs.
   - **Rest** instead of moving (heals, costs a day).
   - **Medicine:** which travellers get a dose today, if any. The leader assigns doses. On a rest day a dose works as usual. On a moving day only the Healer can give one (see Jobs).
   - **Trade orders**, only at a market town (Trade Route twist, below).
   The plan opens on yesterday's pace and rations, so a leader in a hurry just taps **Propose**.
2. **Vote (25 s).** Everyone, living or dead traveller, taps **Go** or **No-go**. Majority of the votes cast passes. A tie fails. Votes are shown by name when it closes.
3. **Rejected?** The lead passes to the next seat for a second proposal. If that also fails, the caravan **stays the course**: yesterday's pace and rations, the safer route at a fork, no trades. No third proposal, so a deadlocked table costs nothing but momentum.
4. **Travel.** The server applies the plan: distance, food and water used, health changes.
5. **Event.** One event card is drawn from the current leg's deck. Two kinds:
   - **Plain:** it just happens. "A wheel cracks. Lose half a day." "A friendly herder shares water. +6 water."
   - **Choice:** two options and a quick table vote (20 s, majority, tie goes to the leader). "Toll at the pass: pay 15 coins, or take the goat track (+1 day, risk of a fall)."
6. **Day summary (5 s, or everyone taps Next).** What changed, who got sick, what's next. The leader moves one seat on.

### Travellers and health

Each traveller is **Well → Sick → Badly hurt → Dead**.
- **Who gets hit (builder-check call):** pace, rations and thirst run a separate roll for every living traveller. Event cards name their target: "everyone", "one random traveller", or "the weakest" (lowest health, ties broken at random).
- Bad events, hard pace, half or no rations, and thirst on dry legs push travellers down a step.
- Rest, full rations and **medicine** (one dose = one step up, spent by the Healer or at a rest) bring them back.
- Untreated Sick has a chance each day to get worse.

A dead traveller's player keeps voting, keeps their goal, and can still lead. They lose their job ability. The results screen remembers who made it.

### Jobs (private info and one ability each)

Dealt one each from the setting's job list of **8**, so everyone has a job at every player count. With fewer than 8 players some jobs are missing, and that's fine. **Jobs are public, the info is private** (builder-check call): everyone knows who the Guide is, and only the Guide sees what the Guide sees. That way using an ability gives nothing away, and the table knows who to ask.

**When abilities fire (builder-check call):** the holder **arms** an ability during the plan phase, from their own screen, any day, not only on days they lead. It isn't part of the vote. An armed ability triggers automatically when its condition comes up that day (the next plain event, the next lost-time event, the end of travel). Unused, it stays armed into the next day. Healer doses are the exception: they're part of the leader's plan (above). On a moving day the plan may include a dose only if the Healer is alive. No extra phase, no reaction window.

| Job | Knows (private) | Can do |
|---|---|---|
| Guide | The next leg's event deck "weather": calm / rough / dangerous | Once per game, reroll a plain event |
| Healer | Exact health ticks (who's close to getting worse) | Give medicine without resting |
| Trader | Prices at the next market town | Better prices when they're the day's leader |
| Quartermaster | Exact days of food and water left at current rations | Once per game, find a hidden cache (+food) |
| Scout | Which branch at the next fork is shorter | Cancel one "lost time" event per game |
| Driver | Animal condition | Hard pace costs one less health step once per leg |
| Cook | How long food lasts at each ration level | Half rations count as full for health, one day per leg |
| Lookout | The odds of each option in today's choice event | Once per game, swap the drawn choice event for another |

Public state still shows rough numbers (food bar, health icons). Jobs give the exact figures, so they're the ones who can make the case out loud.

### Secret goals

One each, dealt from the setting's goal deck. Most help the caravan; all of them bend a vote or two. Trade Route examples:
- Arrive with 60+ coins.
- Make sure *[another player]*'s traveller survives.
- Arrive before day 18.
- Visit the salt town.
- Arrive with at least 3 bolts of silk.
- Never go a day on no rations.

### End and scoring

The caravan **arrives** when it reaches the last stop with at least one living traveller, before the setting's **deadline** (the season ending). It **fails** if everyone's dead, or the deadline passes.

**Caravan grade (user's pick, option A).** On arrival the caravan sells its remaining cargo at the last stop's prices. Coins plus that sale give the caravan's **wealth**, which sets a grade shared by everyone: *broke* (+0), *fair* (+2), *rich* (+4), *legendary* (+6). The pack sets the wealth thresholds for each grade, tuned so sensible play lands around *fair* to *rich*. A failed caravan has no grade. This lives in the core, not in the pack: every setting has something to deliver (Trade Route: goods; Space Convoy: salvage; Monsoon: produce), and the pack only names it and prices it.

Points per player:
- **+5** if the caravan arrives (dead travellers too)
- **+0 to +6** for the caravan grade, if it arrived
- **+3** if your secret goal is met
- **+2** if your traveller is alive at the end

The results headline names the grade ("Arrived rich, day 19").

Arrived: winners are the players with the top score. Failed: nobody wins, the headline says how it ended, and standings still show each goal as met or missed so people can argue about whose fault it was.

## Trade Route (v1 setting)

**Story:** a camel caravan carrying goods along an old overland trade route, desert legs and mountain passes, market towns between. Every name in it is invented, and no real route is named.

**Stock:** food, water, medicine, coins, animals (pack count), cargo (three goods: silk, spice, salt).

**Signature rule: markets.** At a market town the leader's plan can include buy and sell orders. Each town has its own prices (rolled at game start within the town's range, so routes differ game to game), and the Trader sees the next town's prices early. Supplies are bought with coins. Cargo is weight: each pack animal carries so much. Over capacity, steady pace counts as slow. Losing animals (events, hard pace) squeezes capacity, so the table has to decide what to dump.

**Route:** about 8 stops, 2 forks, about half of them market towns, a mix of desert (water matters), mountain (falls and cold) and river legs (crossings as choice events).

**Length setting:**

| Length | Stops | Deadline | Roughly |
|---|---|---|---|
| Short | 5 | day 12 | 15 min |
| **Normal** | 8 | day 20 | 25 min |

## Later settings (not v1)

Same core. Each is a pack: names, stock labels, legs, event deck, jobs (relabelled), goals, and one rule.
- **Monsoon:** a road trip through the rains. Signature rule: a rising **rain meter** that closes roads and swells crossings, so resting and waiting become real choices.
- **Space Convoy:** fuel instead of food and air instead of water. Signature rule: **breakdowns and repairs**. A broken part pins the convoy until it's fixed with spares or a rest day.

## Built as

Same package shape as every game (`games/heist` is the reference):

- `games/long-road/shared`: manifest, types, rules (pure functions: plan validation, travel resolution, event resolution, scoring), `rules-text.ts`, setting fields.
- `games/long-road/server`: the `GameDefinition`.
- `games/long-road/client`: view and styles, on the shell's Ink & Lime theme.
- `games/long-road/packs/trade-route.ts`: the setting as data plus its twist hook.
- Registration in `apps/server/src/games.ts` and `apps/web/src/games.ts`. Lobby section: **Strategy**, next to Dominion.
- Docs: `docs/games/long-road.md` in the usual sections, a row in `docs/games/README.md` and the README list.

**Pack shape (sketch):**

```ts
interface SettingPack {
  id: "trade-route" | "monsoon" | "space-convoy";
  labels: Record<StockKey, string>;        // "food" → "Rations", "Fuel", …
  start: Stock;
  stops: Stop[];                           // with legs, forks, market flags
  events: Record<LegKind, EventCard[]>;
  jobs: JobCard[];
  goals: GoalCard[];
  twist: TwistHooks;                       // plan fields, travel modifiers, view bits
}
```

The core never names a setting. Everything setting-specific goes through the pack.

**Phases:** `reveal` → (`plan` → `vote` → [`plan` → `vote`] → `travel-event` → [`choice`] → `summary`) per day → `over`.

**Hidden information:** job info and goals live only in `getPrivateState`. Goal cards that name another player are dealt so they never name yourself. All goals and jobs are revealed on the results screen.

**Randomness:** every draw, price roll and health check goes through `ctx.randomInt`. Tests pass a seeded one.

**Lobby tier:** master has no tiers. Whether it's free or paid on CouchParty is decided on the `product` branch when it merges, not here.

**Idle players:** host **Skip** on a leader proposes the open plan (yesterday's pace and rations, safer fork, no trades). A skipped voter just doesn't count, since the vote is a majority of votes cast.

**Disconnects and removal:** usual 60 s seat hold; nothing waits on a disconnected player. A removed player's traveller leaves the caravan (doesn't count as dead for anyone's goal), their goal is void, and goals that named them count as met. Fewer than 2 players left: the game ends interrupted, no winner.

**Copy:** on-site text in short plain sentences, basic words, no idioms.

**Tests:** plan validation (forks, markets, capacity), travel maths per pace and ration, health steps, both-proposals-fail stays the course, choice-vote ties, goal checks, scoring, secrecy (no job info or goals in public state or other players' private state), removal edge cases, and a seeded full game that arrives and one that fails.

## Left to the builder

- Exact numbers: food and water per day by pace and ration, distances, prices, event odds, starting stock. Tune by simulation first (a quick script that plays random or greedy plans across seeds and reports arrival rate; aim for roughly 60–70% arrival on Normal with sensible play, and grades spread across fair and rich, not piled on one), then by real games.
- Event deck contents: around 30–40 Trade Route cards across leg kinds, about a third of them choice events.
- The view layout, within the shell's theme.
