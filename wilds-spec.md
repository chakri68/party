# The Wilds — Design Specification

**Project:** `party-games.chakri.me`
**Status:** Draft v1, cut down from `spec.md` (v0.3) to fit this repo. Ready for review, then an implementation plan.
**Last updated:** 2026-11-15
**Game type:** Co-op hex-board adventure for 2–6 players. Everyone plans at the same time, on the existing room runtime.

## 1. Summary

You are explorers on a small, strange island. Find **3 key stones** at 3 old ruins, open the **gate** at the middle of the island, and all stand at the gate before the sun goes down. Everyone wins or loses together.

Each round, everyone secretly plans 2 actions at the same time. Then the game plays them all out. The island has a few simple rules that join up: fire spreads through forest, noise pulls the spider, and fire scares the spider. Most of the fun comes from those rules hitting your plans: "I scared the spider with the torch, set the forest on fire, and burned our only bridge."

It's an original genre game. The name, island, roles and rules are our own.

**Manifest:** `id: "wilds"`, name "The Wilds", 2–6 players, icon `"compass"`, lobby section **Strategy**.

**Match length:** about 12–18 minutes (10 rounds at about 70–90 s each). The balance test (§9) measures it.

### What changed from v0.3, and why

| v0.3 | v1 here | Why |
|---|---|---|
| Own stack: PixiJS, PartyKit, own protocol, auth, reconnect, lobby, replays | A `GameDefinition` in `games/wilds/`, with an SVG board | The room, lobby, reconnect and results already exist |
| 61-hex map, pan and zoom | 37-hex map (radius 3), fits a phone screen, no pan or zoom | Phones first. About 48 px a hex on a 360 px screen |
| Generated maps, checked afterwards | 4 hand-built islands × 6 rotations | Always fair, and easy to test every map |
| 2 creatures, fire, flood, collapse | 1 creature (the spider), fire, noise, broken bridges | Fire and the spider make the main chain. Flood needs weather and height rules |
| 8 items | 4 items | Each one feeds a world rule |
| 7 actions | 6: Move, Look, Act, Item, Help, Guard | Aid and Assist become one **Help** card |
| Perks, blessings, team votes on level-ups | Cut | Each one stops the game. Can come back later (§10) |
| Carrying downed players | Cut. Help gets a downed player back up | One rule, not two |
| 18–24 events, an Event Director | 12 events and simple deck rules | Enough for 10 rounds without repeats |
| Dry, clever narrator | Short, plain lines that say what happened | House copy rule: plain words, no idioms |
| Doom, sigils, temple, Might/Wits/Nerve | Sun, key stones, gate, Strength/Mind/Stealth | Simpler words for players reading in a second language |
| Expedition legends on the results screen | Party recap stats (§8) | The room's recap already does this job |

## 2. The board

### 2.1 Shape

- Pointy-top hexes with axial coordinates `(q, r)`, radius 3: **37 tiles**. Tile ids are `"q,r"`.
- The **camp** is on an edge tile. The **gate** is the centre tile. The 3 **ruins** sit at least 2 steps from the camp and from each other.
- Water all around the edge. Nobody can leave the board.

### 2.2 Terrain

| Terrain | Move | Notes |
|---|---|---|
| Grass | Yes | |
| Forest | Yes | Can burn |
| Reeds | Yes, but a Move stops here | Slow ground |
| River | No | Cross only on a bridge |
| Bridge | Yes | Can burn or break. A broken bridge is like river until someone fixes it |
| Rock | No | |
| Camp, Gate, Ruin | Yes | |
| Ash | Yes | What forest or a burnt bridge leaves after a fire. Can't burn again |

Tiles also hold a **noise** level (0–3), a **fire** count (0 = not burning, otherwise rounds left to burn), and at most one **cache** (a hidden item).

### 2.3 Maps

- 4 hand-built islands in `shared/maps.ts`, each turned one of 6 ways at random, so 24 boards. The 3 ruin types are shuffled across the 3 ruin spots.
- Each island has: camp, gate, 3 ruins, 1 spider nest (a forest tile next to one ruin), 3 caches, at least 2 bridges.
- **Fair-map rule (tested on all 24):** from the camp, every ruin and the gate can be reached on passable ground. With any **one** bridge broken, they can still be reached, maybe the long way round.

### 2.4 Fog

- Fog is **shared by the team** and kept in public state. If anyone sees a tile, everyone sees it.
- At the start: the camp and the tiles next to it are open. The gate and the 3 ruins always show as icons, so you know where to go, but their terrain and what's near them stay hidden.
- A tile opens when an explorer ends a Move next to it, or when a Look reaches it.
- Hidden tiles send only their id to clients. Terrain, caches, noise and the spider stay server-side.

## 3. Explorers

### 3.1 The sheet

| | |
|---|---|
| **Strength / Mind / Stealth** | Each 0, +1 or +2, set by role |
| **Hearts** | 3. At 0 you are **down** |
| **Actions** | 2 each round |
| **Bag** | 2 items |

### 3.2 Roles

Chosen in the game's first screen (§4.1). Two players can take the same role.

| Role | Strength | Mind | Stealth | Power |
|---|---:|---:|---:|---|
| **Runner** | 0 | +1 | +2 | Your Move goes up to 3 tiles, not 2 |
| **Fixer** | +1 | +2 | 0 | Act on a broken bridge next to you to fix it. No item needed |
| **Protector** | +2 | 0 | +1 | Your Guard also protects everyone on your tile |
| **Guide** | 0 | +2 | +1 | You see next round's event one round early (only on your phone). Your Look reaches 3 tiles, not 2 |

No role is needed to win. Every ruin has a way in for every role, and a bridge can be fixed with Planks or walked around.

The Guide's early look is the game's only private information apart from plans. It gives the Guide something to say out loud.

### 3.3 Down

- At 0 Hearts you are **down**. You can't plan actions, but you still vote on events.
- An ally uses **Help** on you to bring you back with 1 Heart.
- The spider leaves down players alone. Fire can't take you below 0.
- You keep your items.
- Hearts never go above 3.

## 4. A round

```
Roles (once) → [ Plan → Beat 1 → Beat 2 → Choice (some rounds) → Island turn → Report ] × up to 10
```

### 4.1 Roles (once, 30 s)

Everyone picks a role. Then each player gets 1 random item, and at least one player gets a Torch. The game starts when everyone has picked, or after 30 s. Anyone who didn't pick gets a random role.

### 4.2 Plan (45 s, setting)

- At the top: **this round's event**. It says what will happen at the end of the round, and where (§6).
- On the board: where the spider will go **if nothing changes**, shown as an arrow.
- Each explorer who isn't down picks **2 actions**, one for Beat 1 and one for Beat 2. Then they tap **Ready**.
- You can change your plan until you tap Ready, or until time runs out. Other players can't see your plan. Talk about it out loud.
- If time runs out, an empty action becomes **Guard**.
- The round goes on when every explorer who isn't down is Ready, or when time runs out.

### 4.3 Beats

Each beat, the server plays one action from each player:

1. **Help first.** Each Help checks what's true at the start of the beat (§5.5).
2. Then the other actions, one player at a time, in **turn order**. Turn order moves on one seat each round.
3. Each action is checked **at the moment it plays**, against the board as it is then. So a bridge fixed earlier in Beat 1 can be crossed later in Beat 1. A Move that can no longer happen becomes Guard, and the report says why.
4. An Act on a ruin someone else already finished in this beat becomes Guard.

### 4.4 Choice (20 s, some rounds)

Only when this round's event has options (§6). Everyone, down players too, taps an option. Most votes wins. For a **bargain**, a tie or no votes means **Refuse**. For other events, a tie goes to the first option. You can change your vote until the time runs out.

### 4.5 Island turn

In this fixed order:

1. The event happens (with the chosen option).
2. **Fire** spreads, then burns down (§7.1).
3. The **spider** moves (§7.2).
4. Anyone on a burning tile loses 1 Heart. Guard blocks it.
5. Noise on every tile goes down by 1.
6. **Win check** (§4.7).
7. The **sun** moves on by 1. If it reaches the limit, you lose.
8. If every explorer is down, you lose.

### 4.6 Report (8 s, or tap Next)

The client plays the round back: moves, dice, fire and the spider. Below that, 1–4 plain lines: "Ravi lit the forest. The fire spread to the bridge." Down players are named.

### 4.7 Win and lose

- **Win:** the gate is open, and at the win check, **every** explorer stands on the gate or next to it, and none of them is down. Down players must be brought back first. Nobody gets left behind.
- **Lose:** the sun reaches the limit (default 10), or every explorer is down at the end of a round.

## 5. Actions

Every action uses 1 of your 2 actions.

| Card | Target | What it does |
|---|---|---|
| **Move** | An open tile you can reach | Walk up to 2 tiles (Runner: 3) on open, passable tiles. The server finds the path. Reeds stop you. You can't walk into fire, the spider's tile or fog. Tiles next to where you stop open up |
| **Look** | You | Open every tile within 2 (Guide: 3). Shows caches and the spider |
| **Act** | Your tile or a tile next to you | Try a ruin (§5.4), open a cache, fix a bridge (Fixer only), or open the gate (with 3 key stones, standing on it) |
| **Item** | Depends on the item | §5.3 |
| **Help** | An ally on your tile or next to you | Down → they get up with 1 Heart. Otherwise → +1 to their roll this beat |
| **Guard** | You | Block the next 1 damage to you this round. Guard twice still blocks only 1 |

### 5.1 Rolls

Rolls happen only at ruins. Moving, looking, items and helping never roll.

`2d6 + attribute + way + Help + item ≥ target`

| Target | Number | With +1 and no other bonus |
|---|---:|---:|
| Easy | 7 | 72% |
| Hard | 9 | 42% |

**Way of acting** (picked in the plan, only for an Act on a ruin):

| Way | Bonus | Cost |
|---|---:|---|
| **Careful** | −1 | If you fail, the cost is smaller (§5.4) |
| **Normal** | 0 | — |
| **Bold** | +1 | 1 noise on your tile, pass or fail |

Bonuses: one attribute (0–2), one way (−1 to +1), at most one Help (+1), and at most one item (+1, none in v1). The plan screen shows the chance as a percent before you tap Ready, for example `Mind +2 · Bold +1 · Help +1 · need 9 · 83%`. If someone helps you, the report shows it, but your planned odds can't know about Help in advance, so the plan says "+1 if someone helps".

Dice come from `ctx.randomInt`. The report shows both dice and every bonus.

### 5.2 Items

Each explorer has 2 bag slots. A full bag can't take a cache item: the Act tells you, and the cache stays.

| Item | Use on | What it does | Used up? |
|---|---|---|---|
| **Torch** | A tile next to you | Spider there → it runs up to 3 tiles away from you now, and stays still for the rest of this round. Forest or bridge there → it starts to burn. Both at once is allowed | No |
| **Planks** | A broken bridge or river tile next to you | Becomes a bridge. A bridge made this way can burn too | Yes |
| **Medkit** | You or an ally next to you | +2 Hearts (max 3). Doesn't bring a down player back up | Yes |
| **Lure** | An open tile within 3 | Set that tile's noise to 3 | Yes |

### 5.3 Caches

3 per map, hidden in fog. Act on a cache: draw one item (Planks, Medkit, Lure or Torch, weighted 3/3/2/1). The cache is then empty.

### 5.4 Ruins

Each ruin gives 1 key stone. Two ways to roll, plus **Force** for anyone:

- **Pass:** take the key stone.
- **Fail:** pay the cost. The ruin is now **half open**. The next Act on it, by anyone and with any way in, takes the key stone with **no roll**.
- **Force:** no roll. Take the key stone, but the sun moves on by 1 now and the ruin gets 3 noise.
- **Careful** makes a fail cost smaller: 1 damage → 1 noise, 2–3 noise → 1 noise.

So a ruin always takes 1 or 2 Acts. The roll decides how fast and how costly, never whether you can get in.

| Ruin | Way in | Roll | Fail costs |
|---|---|---|---|
| **Sunken Shrine** | Read the old words | Mind, Hard 9 | 2 noise on the ruin |
| | Lift the stone door | Strength, Easy 7 | 1 damage to you |
| **Star Tower** | Climb in quietly | Stealth, Hard 9 | 1 damage to you |
| | Turn the star wheel | Mind, Easy 7 | 3 noise on the ruin |
| **Root Cave** (near the nest) | Sneak past the roots | Stealth, Easy 7 | 2 noise on the ruin |
| | Pull the roots away | Strength, Hard 9 | 1 damage to you |

The Act card shows both ways in, each with its chance and its fail cost, plus Force with its cost.

Key stones belong to the team. Nobody carries them, and losing Hearts never loses them.

### 5.5 Help, exactly

- Help names a player. It works only if you are on their tile or next to it **at the start of the beat**.
- Down target → they get up with 1 Heart, at once.
- Otherwise → if they roll this beat, they get +1. If two people help the same roll, it still gets only +1. Plans are secret, so the plan screen can't warn you about that. The report says when a Help did nothing.
- Help is how you plan teamwork without seeing each other's plans: "I'll help you on the Shrine in Beat 2."

## 6. Events

One event a round, shown at the start of Plan. It happens in step 1 of the island turn. Events are data in `shared/events.ts`, checked by tests, never code from outside.

### 6.1 Deck rules

- Draw from a shuffled deck of 12. Skip any event that can't apply right now ("no fire" for Rain). Skipped cards go back into the deck.
- Rounds 1–2 draw only **calm** events.
- After a **harm** event, the next one can't be harm.
- Only one bargain can be waiting at a time.
- The Guide sees the next event (it's drawn one round ahead).

### 6.2 The 12 events (v1)

| Event | Kind | Can apply when | Effect | Options |
|---|---|---|---|---|
| Quiet morning | calm | always | Nothing. The spider stays still this round | — |
| Old camp | calm | a hidden cache exists | Opens the tiles around one hidden cache | — |
| Bird calls | calm | always | Opens 3 random hidden tiles next to open ones | — |
| Clear sky | calm | always | Choose: open the tiles around the gate, or around the nearest ruin without its key stone | 2 |
| Rain | calm | fire somewhere | All fire goes out | — |
| Dry wind | harm | fire somewhere | Fire spreads twice this round | — |
| Hungry spider | harm | spider can see an explorer | The spider moves 3, not 2 | — |
| Falling rocks | harm | always | One shown tile next to an explorer: 1 damage to anyone on it at the island turn. Guard blocks it | — |
| Rotten bridge | harm | an unbroken bridge | One shown bridge breaks, unless an explorer stands on it at the island turn | — |
| Echo in the reeds | harm | reeds exist | 2 noise on one shown reeds tile | — |
| The stone hand | bargain | a bridge is broken | **Accept:** every broken bridge is fixed now. In 2 rounds, that bridge gets 3 noise. **Refuse:** nothing | 2 |
| The warm spring | bargain | someone has under 3 Hearts | **Accept:** everyone gets +1 Heart, and down players get up. The sun moves on by 1. **Refuse:** nothing | 2 |

"Shown" tiles are chosen when the event is drawn, so the plan screen can mark them.

A waiting bargain cost shows on the board and in a small bar: "The stone hand: noise on this bridge in 2 rounds." It always happens, unless the tile is gone.

## 7. The island's rules

### 7.1 Fire

- Burning tiles start at **2** and go down by 1 each island turn. At 0 the tile becomes **ash**. A burnt bridge becomes a **broken bridge**.
- Spread: each burning tile picks one forest or bridge tile next to it (random, using `ctx.randomInt`) and lights it. New fires don't spread in the same turn.
- At most **5** tiles can burn at once. Extra spreads don't happen.
- You can't Move into fire. If you're on a tile when it catches, you lose 1 Heart at step 4 (Guard blocks it).
- Fire shows on all open tiles. Fire in fog shows as smoke on the edge of the fog, so you see something is burning.

### 7.2 The spider

One spider. It starts on its nest, which is hidden in fog. It always takes the first of these that fits:

1. **Scared** (it was hit by a Torch this round, or it's next to fire): move up to 3 away from the fire or the torch. A Torch scare (in the beats) makes it stay still for the rest of this round. A scare by fire (in the island turn) makes it stay still the next round.
2. **Noise:** if a tile with noise is within 4, move up to 2 toward the loudest. A tie goes to the nearest, then to the lower tile id.
3. **Hunt:** if an explorer (not down) is within 3, move up to 2 toward the nearest.
4. **Home:** move 1 toward the nest.

- It walks like an explorer: no river, rock, fire, or broken bridge. Reeds don't stop it.
- It ends its move on an explorer's tile, or next to one → each explorer it reaches loses 1 Heart (Guard blocks it). Then it stops.
- The plan screen arrow shows what it will do based on the board **now**, plus what step 1 of this island turn will do first: a stone hand's noise due this round, and this round's event. It leaves out fire spread (random) and an event with a vote (the vote isn't known yet). It's marked "if nothing changes", because players' actions can change it.
- In fog the spider is hidden, and so is its arrow.

### 7.3 Noise

Noise (0–3) is on tiles, not players. It comes from Bold rolls, failed ruins, Force, Lure and events. It goes down by 1 each island turn. Open tiles show their noise as 1–3 small marks.

## 8. Party recap stats

Co-op games count toward "Champion of the night" through `winnerIds`: on a win, everyone is a winner. Nothing in the current `STAT_KEYS` fits rescuing or lighting fires, so v1 adds two keys (AGENTS.md step 6):

| Key | Counted when | Award row in `recap.ts` |
|---|---|---|
| `rescues` | Your Help gets a down ally back up | **Always there**, min 2: "Got 3 friends back up." |
| `firesLit` | Your Torch lights a tile (spread doesn't count) | **Fire starter**, min 2: "Lit 4 fires." |
| `noGoVotes` (existing) | You vote **Refuse** on a bargain | Hardest to convince (existing) |

A bargain is a proposal put to a vote, so Refuse is a No-go. That's what the key means already, not a stretch.

Counts live in `state.stats`, set with `bumpStat`, returned by `partyStats`, and never in public or private state. `recap.test.ts` gets a test for each new award.

## 9. Implementation notes

Same layout as Long Trail (`games/long-trail`).

```
games/wilds/
  shared/  types.ts, manifest.ts, settings.ts, hex.ts, maps.ts, terrain.ts, ruins.ts,
           items.ts, events.ts, roll.ts (odds), rules-text.ts, index.ts
  server/  game.ts (GameDefinition), beats.ts, island.ts (events, fire, spider),
           views.ts (public/private), parse.ts
  client/  view.ts, board.ts (SVG hexes), plan.ts (action tray), report.ts, styles.css
  test/
docs/games/wilds.md
```

Register it in `apps/server/src/games.ts` and `apps/web/src/games.ts` (section `strategy`).

- **Phases:** `roles` → `plan` → `choice` (only if needed) → `report` → `plan` … → `over`. Beats and the island turn run inside one transition when planning closes, or when the choice closes. They emit one ordered list of events for the report to play back.
- **Timers:** `onTimer` for roles (30 s), plan (setting), choice (20 s) and report (8 s). Cancel and reset them with the `TimerRequest` list, like Long Trail.
- **Randomness:** only `ctx.randomInt`: map pick and turn, ruin shuffle, starting items, caches, the event deck, fire spread, dice. Tests inject a fixed sequence.
- **Public state:** open tiles (terrain, fire, noise, caches seen, spider if seen and its arrow), key stones, gate open, sun, round, turn order, each explorer's role, Hearts, items, tile, down, Ready (yes or no only), this round's event and its shown tiles, the waiting bargain, vote counts once the choice closes.
- **Private state:** your own plan draft, and the next event for a Guide.
- **Server-only:** hidden tiles, the deck order, other players' plans until they play, `stats`.
- **Actions** (`parseAction`): `pick-role`, `set-plan` (both beats, checked when they play, not when sent), `ready`, `unready`, `vote`, `next`.
- **`getAwaitedPlayerIds`:** in plan, explorers not down and not Ready. In choice, everyone who hasn't voted. Otherwise, nobody.
- **Skip and drops** (`skipTurn`, `onPlayerDisconnected`): plan → Guard, Guard and Ready. Choice → no vote (a bargain tie becomes Refuse). Roles → random role.
- **`onPlayerRemoved`:** their explorer leaves the board. Their items are lost. The win check stops counting them.
- **Results:** `winnerIds` is everyone on a win, nobody on a loss. Headline: "You escaped with 3 rounds left." or "The sun went down. 2 of 3 key stones found." Standings show each player's Hearts at the end, labelled "2 Hearts" or "Down".

### Client

- **Board:** SVG, pointy-top, 37 hexes, fills the width on phones. Terrain is a fill colour **and** a small icon (the colour is never the only sign). Fog is grey with no detail. The spider's arrow, noise marks, fire, shown event tiles, and explorer tokens (first letter of the name, with a role ring).
- **Plan tray:** 2 slots (Beat 1, Beat 2) and 6 action cards. Tap a card → legal targets light up on the board, and the others say why they're off when you tap them ("Fog: you can't plan a path there"). Ruin Acts open a small sheet with the ways in, the ways of acting, and the percent.
- **Top bar:** sun (`Sun 4 / 10`), key stones (3 icons), round, timer.
- **Report:** steps through the event list, about 0.5 s each. Tap to skip to the end. Respects reduced motion (no movement, just the end state and the lines).
- No emoji. SVG icons only. All words follow the plain-English rule.

### Settings

| Setting | Options | Default |
|---|---|---|
| Sun limit | 8 (hard) / 10 / 12 (easy) | 10 |
| Plan time | 30 / 45 / 60 s | 45 s |

### Lobby rules text (draft)

- Work together. Find 3 key stones at the 3 ruins.
- Open the gate in the middle, then all stand at the gate before the sun goes down.
- Each round, everyone plans 2 actions at the same time. Then they all happen.
- Talk! You can't see each other's plans.
- Fire spreads through forest. Noise pulls the spider. Fire scares the spider.
- At a ruin you roll 2 dice. If you fail, you pay a cost, but your next try always works.
- Lose all your Hearts and you are down. A friend can Help you get back up.

## 10. Tests

- **Hex:** neighbours, distance, rotation of all 4 maps, paths that avoid fog, fire, river and the spider.
- **Maps:** the fair-map rule on all 24 boards; camp and gate placed right; 3 caches and a nest each.
- **Beats:** turn order rotates; Help resolves first and uses start-of-beat tiles; a bridge fixed in Beat 1 is crossable later in Beat 1 but only after the fix plays; an impossible Move becomes Guard; a second Act on a finished ruin becomes Guard; Guard blocks only 1.
- **Rolls:** the odds function matches a full 36-case count for every bonus combination; Bold adds noise on pass and fail; Careful lowers each fail cost; a half-open ruin opens with no roll; Force moves the sun.
- **Fire:** spreads to one tile per burning tile; stops at 5; burns out after 2 turns; a burnt bridge breaks; damage only at step 4.
- **Spider:** each of the 4 rules, the tie breaks, the scared rest round, it never enters fire or river, and it ignores down players.
- **Events:** each one's "can apply" rule and effect; rounds 1–2 calm; no harm twice in a row; one bargain at a time; a bargain tie means Refuse; the stone hand's delayed noise lands.
- **Win and lose:** win needs everyone at the gate and nobody down; the win check comes before the sun; all down loses.
- **Secrecy:** hidden tiles send only ids; others' plans never appear; only a Guide's private state has the next event; `stats` never appears in public or private state.
- **Recap:** a short scripted game gives the right `rescues`, `firesLit` and `noGoVotes`.
- **Flow:** timers, skip, disconnect, remove.
- **Balance** (behind a flag, like Long Trail): simple bots (go to the nearest ruin, Look when blocked, Help anyone down, Torch the spider when it's next to them, Force when the sun is at limit − 3). Run 2,000 games for each player count. Targets: win rate 40–60% at sun 10, average 8–10 rounds, at least one fire in more than 50% of games, at least one player down in 30–60% of games. Tune the sun limit, fire spread and spider speed until it hits them.

## 11. Out of scope for v1

From `spec.md`, to add only after playtests:

- Perks at the first key stone and team blessings at the second.
- Carrying down players.
- A second creature, flood, weather, height.
- Rope, Smoke Bomb, Compass, Boots.
- Generated maps, a bigger map.
- More events, more bargains, story callbacks ("the spider you burned is back").
- Sound, art beyond flat SVG, a replay of the match.
- Race and hidden-traitor modes.
- Any AI narrator.

## 12. Open questions

1. **Name.** "The Wilds" is fine as a working name. Change it before release if you like.
2. **Is the sun limit too tight or too loose?** The board is small and Move is fast, so the balance test may want 8 instead of 10.
3. **Should ruins ever need a second Act?** In v1 the roll only decides cost and speed. If playtests find rolls feel empty, make a fail add the cost **and** leave the ruin closed once.
