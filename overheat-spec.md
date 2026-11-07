# Overheat — Design Specification

**Project:** `party-games.chakri.me`
**Status:** Design locked for v1. Ready for an implementation plan.
**Last updated:** 2026-11-07
**Game type:** Push-your-luck card game for 2–8 players. Turn-based, on the existing room runtime.

## 1. Summary

Each round, every player builds an **engine**: a row of flipped cards. Cards add **heat** and **points**. Each round has a **gauge**, and if your heat goes over it, you bust and score nothing for the round. You can **bank** at any time to keep your points and leave the round safe.

Power cards make it a table game, not a solo gamble. You can push cards into rivals' engines, swap with them, put a ticking fuse on them, or drop the gauge on everyone at once.

It's an original genre game: the name, theme, cards and rules are our own. Farkle already covers push-your-luck with dice, alone at your table. Overheat's difference is that other players can hurt you.

**Manifest:** `id: "overheat"`, 2–8 players, lobby section **Cards**.

## 2. Components

### 2.1 Number cards (72)

- 4 colours: **Red, Amber, Blue, Green**. Every card shows a shape as well as a colour, so colour is never the only signal.
- Values 1–9 in each colour, two copies of each: 4 × 9 × 2 = 72.
- A number card adds its value as **heat** and as **points**. Big cards are worth more and are more dangerous.

### 2.2 Power cards (16 in v1)

| Card | Copies | Kind |
|---|---|---|
| Vent | 4 | For yourself |
| Turbo | 3 | For yourself |
| Shove | 3 | Aimed |
| Wrench | 2 | Aimed |
| Fuse | 2 | Aimed |
| Heatwave | 2 | Whole table |

That's 88 cards in total. About 18% are power cards. Power cards add 0 heat and 0 points unless their text says otherwise.

### 2.3 The gauge

At the start of each round the server rolls the gauge, a whole number from **18 to 30** (uniform, `ctx.randomInt`). Everyone sees it before anyone flips. With an average card value of 5, a player gets about 4–6 cards before bust risk becomes real.

## 3. Rules

### 3.1 A round

1. Roll the gauge. Every player's engine is empty and their heat is 0.
2. Turns go around the table, starting from the round's first player. The first player moves one seat left each round.
3. On your turn, if you're still in the round, you choose:
   - **Flip:** turn over the top card of the deck and resolve it (§3.2). On your first turn of a round you must flip, so you can't bank zero.
   - **Bank:** add your engine's points to your score. You're out of the round and **safe**: aimed and table cards can't hit you any more.
4. If your heat goes over your gauge at any moment, you **bust**. You're out of the round and score 0 for it. Bust checks happen after every change, not just after your own flips, so Heatwave or a Shove can bust you on someone else's turn.
5. **Redline:** if your heat is exactly equal to the gauge after a resolve, you get **+10 points** and bank at once.
6. The round ends when nobody is still flipping. Discard every engine. When the deck runs out, shuffle the discard pile into a new deck.

### 3.2 Resolving a flip

- **Number card:** it goes into your engine. Add its value to your heat and to your points. Then check for bust and redline.
- **Power card:** the flipper resolves it right away. If it needs a target, the flipper picks one (§3.4). Power cards don't stay in the engine, except Fuse, which attaches to its target.

### 3.3 Scoring at bank

- Points = sum of the number cards' values in your engine,
- \+ **5** for each colour you have 3 or more cards of,
- \+ **5** if you have at least one card of all 4 colours,
- \+ **10** for a redline.

Heat changes from power cards (Vent, Fuse, Heatwave) never change points. Only Turbo does (§4).

### 3.4 Targets

- Aimed cards can only target players who are **still flipping**. Banked and busted players can't be targeted.
- You can't target yourself with an aimed card.
- If there's no valid target, the card is discarded with no effect.

### 3.5 End of game

At the end of a round, if anyone's score has reached the target (100, 150 or 200; default **150**), the game ends. The highest score wins. Tied players share the win.

## 4. Power cards (v1)

| Card | Effect |
|---|---|
| **Vent** | Your heat −5. Heat can't go below 0. Your points don't change. |
| **Turbo** | The next number card that goes into your engine this round counts double: double heat and double points. A second Turbo before then does nothing extra. |
| **Shove** | Flip the next card from the deck straight into the target's engine. If it's a number card, it counts in their engine and can bust or redline them. If it's a power card, the **target** resolves it as if they had flipped it. |
| **Wrench** | Swap one number card in your engine with one number card in the target's engine. You choose both cards. Heat and points move with the cards. Then check both players for bust and redline. If either engine has no number cards, Wrench is discarded with no effect. |
| **Fuse** | Attach it to the target. At the start of each of their turns while they're still flipping, their heat goes up by 1 before they choose. It's discarded when the round ends. A player can carry more than one Fuse, and each one ticks. |
| **Heatwave** | The gauge drops by 3 this round for **every player still flipping**, the flipper included. Check every one of them for bust, in turn order from the flipper. Banked players are safe. |

**Heat vs gauge per player.** Heatwave changes the gauge only for the players it hits, so each player has their own gauge for the round. The table shows each player's gauge next to their heat.

## 5. Later cards (after v1)

Add these once playtests have settled the base numbers. Ship each one behind a **Power cards: Classic / Full** setting.

| Card | Effect |
|---|---|
| **Overclock** | Your gauge +4 this round. If you bust, you also lose 5 banked points (score can't go below 0). |
| **Dipstick** | Look at the top 2 cards and put them back in any order. Private to you. This is the only card that needs hidden information. |
| **Dump** | Discard one number card from your engine. Its heat and points both go. |
| **Wildcard** | Goes into your engine with 2 heat and 0 points, and counts as any colour for colour bonuses. |
| **Siphon** | Move one number card from the target's engine into yours, with its heat and points. |
| **Cold Snap** | The gauge goes up by 3 this round for every player still flipping. |
| **Exhaust** | +2 heat to every other player still flipping. |

Rule of thumb: no more than 2 copies of any harsh card (Heatwave, Siphon, Fuse, Exhaust). More than that and the game becomes everyone attacking each other instead of pressing their luck.

## 6. Settings

| Setting | Options | Default |
|---|---|---|
| Target score | 100 / 150 / 200 | 150 |
| Power cards | Off / Classic | Classic. "Full" arrives with §5 |

With power cards off, the game is pure push-your-luck. That's a good first game for new players and a useful baseline for balance tests.

## 7. Implementation notes

It follows the same pattern as Farkle (`games/farkle`): `shared/` (types, rules, manifest, rules text), `server/game.ts`, `client/view.ts`, plus tests.

- **Randomness:** every shuffle and gauge roll goes through `ctx.randomInt`. Tests pass a fixed deck and gauge.
- **Hidden information:** none in v1. The deck order is server-only, and everything else is public. Dipstick (§5) will be the first private state.
- **Pending choices:** Shove, Wrench and Fuse put the game in a `choosing` sub-state for the flipper (pick a target, and for Wrench, pick two cards). Only the flipper can act. Heatwave and Vent need no choice.
- **Events:** emit `flip`, `bust`, `redline`, `bank` and one per power card, so the client can animate them. Most of the fun is watching a Shove land on someone at 26/27.
- **Idle players:** the host's Skip on a turn means **bank** (or flip, if it's their first turn and they must flip). The least damaging legal move. A Skip during a pending choice picks a random valid target and cards.
- **Results:** `GameOutcome` standings labelled with points ("142 pts").

### Client

- One row per player: their engine cards, a **heat bar with the gauge line on it**, their banked score, and status (flipping, banked, busted). Fuses show as a small icon on the row.
- The heat bar is the main visual. As heat closes in on the gauge it shifts from cool to hot, and it shakes at gauge −3 or closer.
- Phone-friendly: this is a lobby-and-cards game, not a Godot one. It should work on phones like every other card game in the repo.
- Site copy follows the plain-English rule: short sentences, simple words.

### Lobby rules text (draft)

- Each round has a heat limit. Everyone can see it.
- On your turn, flip a card or bank.
- A number card adds its number to your heat and to your points.
- If your heat goes over the limit, you bust. You get 0 points for the round.
- Bank to keep your points. After you bank, other players' cards can't hurt you.
- If your heat is exactly the limit, you get 10 extra points and bank.
- 3 cards of one colour: +5. All 4 colours: +5.
- Power cards can cool you, help you, or hit other players.
- The first player to reach the target score at the end of a round wins.

## 8. Tests

- **Rules:** heat and points from numbers; colour bonuses; redline is exact only; bust is strictly over the gauge; Vent floors heat at 0 and leaves points alone; Turbo doubles only the next number card; a second Turbo does nothing extra.
- **Power cards:**
  - Shove into a target at the edge busts them.
  - Shove that flips a power card makes the target resolve it.
  - Wrench rechecks both players.
  - Wrench with an empty engine does nothing.
  - Fuse ticks at the start of the target's turn and stacks.
  - Heatwave busts in turn order and skips banked players.
  - Aimed cards with no valid target do nothing.
- **Flow:** first turn must flip; the round ends when nobody is flipping; the first player rotates; the deck reshuffles from discards; the game ends at the target with shared wins on ties.
- **Skip:** bank on a normal turn, flip on a first turn, random choice during a pending choice.
- **Balance:** a simulation runs 10,000 rounds with simple bots ("bank at heat ≥ gauge − 4") for each player count. Report the bust rate and average round length. Rough targets: bust rate 25–40%, about 4–6 cards per engine. Tune the gauge range if it's off.

## 9. Out of scope for v1

- The §5 cards and the "Full" setting.
- Bots in real games (the simulation bots are test-only).
- Any card art beyond colour, shape and number.
