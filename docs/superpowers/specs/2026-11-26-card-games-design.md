# Card games: Omaha, Short Deck, Teen Patti, Blackjack

## Why

The user asked for more card games in the spirit of Hold'em. They picked:

1. Omaha and Short Deck, as settings of the existing Hold'em game.
2. Teen Patti, a new game. Most players are Indian and know it well.
3. Blackjack, a new game. Easy to learn, and one person can play it alone while the room fills.

## Build order

| Step | Where | Depends on |
|---|---|---|
| A1 Omaha | `games/holdem` | nothing |
| A2 Short Deck | `games/holdem` | A1 (same setting row) |
| A3 Teen Patti | `games/teen-patti`, pot helpers to `game-core` | A1, A2 (touches Hold'em's `rules.ts`) |
| B1 Blackjack | `games/blackjack` | nothing: built in parallel in its own worktree, merged at the end |

Each step is one commit (or a few), reviewed before the next.

## Shared rules for all steps

- Copy: short plain sentences, basic words, no idioms, no emoji. Easy for Indian readers. Indian card words are fine and wanted in Teen Patti (Pack, Chaal, Blind, Seen, Show, Sideshow, Trail).
- Play chips only. No buying, no cash-out, nothing carries over between games.
- Latency: a bot `decide` stays under about 5 ms on a normal laptop. Tests measure the worst case. Server moves do no Monte Carlo. One code path per rule: no second "fast" path to save milliseconds.
- Follow AGENTS.md for every new game: best player counts, computer players, party recap stats, docs, the lists in `apps/server/test/games.test.ts`.

## A1 Omaha (Hold'em setting)

- New Hold'em setting `variant`: `"holdem" | "omaha" | "shortdeck"`, default `"holdem"`. The lobby row is called "Game", with the options "Texas Hold'em", "Omaha" and "Short Deck" (A2 adds the third option).
- Omaha: 4 private cards each. Your hand is exactly 2 of your cards plus exactly 3 from the table. `bestHand` gets a variant-aware wrapper. Hold'em keeps the current 7-card path.
- Omaha is **pot-limit**: the largest bet or raise makes your total bet equal to the call plus the pot after the call. All-in is allowed only up to that size, or for a smaller stack. Hold'em and Short Deck stay no-limit. `LegalActions` already carries min and max, so the view only needs the new max.
- The bot plays Omaha with its own preflop rule (pairs, suited cards, connected cards, high cards across all 4) and Monte Carlo equity with the 2+3 rule. 60 five-card checks per hand per trial is slow, so cut trials for Omaha until the worst-case decision is under 5 ms. Keep one equity function with the variant passed in.
- The view shows 4 private cards on a phone without overflow. The made-hand label must use the 2+3 rule, so it never names a hand the player doesn't have.
- Docs: `docs/games/holdem.md` gets an Omaha section and the setting row. The manifest description mentions Omaha.

## A2 Short Deck (Hold'em setting)

- 36 cards: 6 up to Ace. No-limit, same blinds.
- Rankings change: a flush beats a full house. A-6-7-8-9 is the lowest straight (the Ace plays low). Three of a kind still loses to a straight.
- Deck, hand ranking, hand names, equity and the bot's preflop tiers all take the variant. Tests cover the changed order and the A-6-7-8-9 straight.
- Docs: the ranking list for Short Deck, in `holdem.md`.

## A3 Teen Patti (new game, id `teen-patti`)

- 3 to 7 players, best 4 to 6. Computer players: yes. Pause: yes, if the timers allow it cleanly (see Nightfall's `pause`).
- Tournament with play chips, like Hold'em: same starting stack for everyone. The last player with chips wins, or the biggest stack when a time cap runs out.
- **Each hand:** everyone puts in the boot. 3 cards each, face down. The dealer moves one seat each hand. The boot goes up every few hands (a setting: slow, normal, fast).
- **Blind and Seen.** Everyone starts Blind. On your turn you may see your cards. Seeing is free and you can still act this turn.
- **The stake** starts at the boot. A Blind player bets 1x or 2x the stake. A Seen player bets 2x or 4x the stake. Betting 2x as Blind (or 4x as Seen) doubles the stake.
- **On your turn:** Pack (fold), Chaal (bet), or, when only 2 players are left, Show. A Seen player can ask for a Sideshow with the player before them, if that player is also Seen.
- **Show:** open when exactly 2 players can still bet (an all-in player may also be in). Costs one bet. Every hand still in turns over, the best hand wins each pot. On equal hands, the player who asked loses to the player they asked. Against an all-in player, equal hands split as normal. A Show costs your normal bet: the Blind price if you are Blind, the Seen price if you are Seen.
- **Sideshow:** costs one Seen bet. The asked player accepts or refuses (a move the game waits on, with a timer that refuses by default). If accepted, the two compare in private and the lower hand packs. On equal hands, the player who asked packs.
- **Short stacks:** if you can't pay a bet, you can go all-in. You can win the pot as it is at that moment. Bets after that go into a side pot that only the players still betting can win; several all-ins nest in the order they happened. A stack short of the boot matches chips only: its first pot takes at most its own amount from each player. (A Blind bet is half a Seen bet, so matching raw chips as in Hold'em would be wrong.) Teen Patti stores everyone's chips in at each all-in and builds its pots from those. Move `buildPots`, `awardPots` and `formatChips` from `games/holdem/shared/rules.ts` into `packages/game-core` (a new `chips.ts`); Hold'em uses `buildPots`, both games use `awardPots` and `formatChips`. No copy-paste.
- **Pot limit:** when the pot reaches 256x the current boot, every player still in shows, and the best hand wins.
- **Rankings,** best first: Trail (three of a kind, A-A-A best), Pure sequence (run in one suit), Sequence (run), Color (same suit), Pair, High card. Runs: A-K-Q is the best, A-2-3 is next, then K-Q-J down to 4-3-2. Ties compare the ranks high to low. Fully equal hands split.
- **Settings:** starting chips, boot speed, ending (last player left, 20, 30 or 45 minutes), turn seconds.
- **Bot:** sees its cards early with a decent hand chance, plays by hand strength (rank class and top card), bluffs sometimes, calls a Show more when the pot is big. Answers a Sideshow request. Follow AGENTS.md "computer players" (off-turn moves, `ctx.chance`).
- **Party stats:** `rightCalls` / `wrongCalls` for whoever asks for a Show or Sideshow (won or lost the compare). `liesTold` once per hand when a Seen player with only a high card bets. `liesUncaught` when that player then wins the pot without a Show. `bigBids` once per hand for a Blind player who makes a Chaal or Double when the pot is past 20x the boot.
- **Docs:** `docs/games/teen-patti.md`, the README list, rooms.md "Computer players".

## B1 Blackjack (new game, id `blackjack`)

- 1 to 7 players, best 2 to 5. Computer players: yes (basic strategy). Pause: yes, if clean.
- Everyone plays their own hands against the dealer (the game). Players don't play against each other.
- **Shoe:** 6 decks, shuffled again when about three quarters are used. Players see when the shoe is shuffled.
- **A round:**
  1. Bet: everyone bets at the same time, with a timer (no bet in time means you sit out the round). Smallest bet 10. Largest: your stack.
  2. Deal: 2 cards face up to each player. The dealer gets 1 face up and 1 face down.
  3. Dealer peek: if the dealer's face-up card is an Ace or a 10-value card and the dealer has Blackjack, the round ends. A player Blackjack gets the bet back, other players lose.
  4. Play: **everyone acts at the same time** on their own hands (faster for a group than turns). Hit, Stand, Double (any first two cards: double the bet, take one card, stop), Split (two cards of the same rank, once per round; split Aces get one card each). Over 21 loses at once. No insurance, no surrender. The timer stands for you.
  5. Dealer: turns over the hidden card and takes cards until 17 or more (stands on every 17).
  6. Pay: a win pays 1 to 1. Blackjack (Ace plus a 10-value card in the first two cards, not after a split) pays 3 to 2, rounded down to a whole chip. Equal totals give the bet back.
- **Chips and ending:** everyone starts with 1,000. Out of chips means you're out, unless rebuys are on (one rebuy, in the first half of the game). The game ends after a set number of rounds (setting: 10, 15, 20) or when everyone is out. Most chips wins.
- **Settings:** rounds, rebuys (off or one), turn seconds.
- **Bot:** standard basic strategy for this rule set (dealer stands on soft 17, double any two, split once, no surrender) as a small table. Bets a random but sane amount (through `ctx.randomInt`).
- **Party stats:** new key `busts`: each hand that goes over the limit (over 21). Add it to `STAT_KEYS` and an award row in `recap.ts` that fits any push-your-luck game: title "One card too many", a minimum of 3, a line like "Went over the limit 5 times." Test it in `recap.test.ts`.
- **Docs:** `docs/games/blackjack.md`, the README list, rooms.md "Computer players".

## Not doing now

- Omaha Hi-Lo, Pineapple.
- Teen Patti side games (Muflis, AK47, jokers).
- Blackjack insurance, surrender, splitting more than once, side bets.
