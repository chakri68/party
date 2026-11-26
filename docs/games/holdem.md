# Hold'em

No-limit Texas Hold'em as a tournament. Two cards each, five shared, and blinds that climb until one player has every chip. 2–9 players. The host can pick Omaha instead (see [Omaha](#omaha)).

Chips are play chips: no buying, no cash-out, nothing carries over between games.

Computer players can fill seats in this game, in Hold'em and in Omaha. They play good starting cards and fold most bad ones. After the flop, they bet when their hand is likely to win, and they sometimes bluff. They buy back in when they can.

## The short version

- Everyone starts with the same stack. Run out and you're out.
- Two private cards each, five shared cards in the middle. Your best five of those seven is your hand.
- Bet, call, raise or fold over four rounds. Best hand at the end wins the pot, or the last player who didn't fold.
- Blinds go up every few hands, so the game always ends.

## How it plays

1. **Button and blinds.** The button moves one player left each hand. The next two players put in the small and big blind. Heads-up (two players), the button posts the small blind instead.
2. **Deal.** Two cards each, face down. Only you see yours.
3. **Pre-flop betting** starts left of the big blind. Heads-up, the button acts first.
4. **The flop** (three shared cards), **the turn** (one), **the river** (one), each followed by a round of betting that starts left of the button.
5. **On your turn:** fold, check if nothing's owed, call, bet or raise, or go all-in.
   - The smallest opening bet is the big blind.
   - A raise must be at least as big as the last full raise this round. Raising to 300 over a bet of 100 means the next raise is to at least 500.
   - All-in is always allowed, for any amount. An all-in smaller than a full raise doesn't reopen the betting: anyone who already acted can only call or fold.
6. **A round ends** when everyone still able to bet has matched the high bet.
7. **Everyone else folds:** the last player wins the pot without showing.
8. **Everyone's all-in** (or all but one): every hand turns face up and the rest of the board comes out one card at a time.
9. **Showdown.** Chips nobody called go back first. Every hand still in turns over, one at a time, starting left of the button. Losers too. After a fold-out the winner can tap Show, or not.

Hand rankings, best first:

1. **Straight flush:** five in a row, one suit. The top one (A-K-Q-J-10) is a royal flush.
2. **Four of a kind:** four of one rank.
3. **Full house:** three of one rank and two of another.
4. **Flush:** five of one suit.
5. **Straight:** five in a row. A-2-3-4-5 counts, as the lowest straight.
6. **Three of a kind**
7. **Two pair**
8. **Pair**
9. **High card**

Ties go to the higher ranks, then the leftover cards (kickers). Identical hands split the pot.

## Omaha

The host can set **Game** to Omaha in the lobby. Everything above stays the same, except three things.

- **4 cards each**, not 2. Only you see them.
- **Your hand is exactly 2 of your cards and exactly 3 shared cards.** Not 1, not 3, not 4. Some examples:
  - Four hearts are on the table, and you have one heart. You do **not** have a flush. You need two hearts in your hand.
  - You have four spades. Only two of them can play, so you need three spades on the table for a flush.
  - A straight on the table is not your hand. You must use 2 of your cards.
- **Pot-limit betting.** The most you can bet or raise is the size of the pot. To work it out: first call, then add the whole pot after your call. For example, 100 is in the pot, and then someone bets 50. Now 150 is in the middle. You call 50, and now 200 is in the middle. So you can raise by 200 more, to 250 in all. All-in is allowed only when your chips fit under this limit. The smallest bet and raise are the same as in Hold'em.

The hand rankings are the same. Your screen shows your best hand by the Omaha rule, so it never names a hand you can't use.

## Winning and scoring

Last player with chips wins. With a time cap, the hand in progress finishes when time's up and the biggest stack wins.

**Side pots.** If someone goes all-in for less than the others bet, they can only win what they matched from each player. The rest goes into a side pot for the players who covered it. Each pot goes to the best hand among the players in it. A split's odd chips go to the first winner left of the button.

**Placing.** Players who bust rank by when they went out. Two out in the same hand: whoever started that hand with more chips ranks higher; equal stacks share the place. The results screen shows "4,200 chips" for players still in and "out 3rd" for the rest.

**Blind levels** (small/big): 10/20, 15/30, 25/50, 50/100, 75/150, 100/200, 150/300, 200/400, 300/600, 500/1,000, then the big blind doubles each level.

## Settings

Host picks these in the lobby.

| Setting | Options | What it changes |
| --- | --- | --- |
| Game | **Texas Hold'em**, Omaha | Omaha: 4 cards each, use exactly 2 of them, and bets up to the size of the pot. See [Omaha](#omaha). |
| Starting chips | 1,000, **1,500**, 3,000 | 50, 75 or 150 big blinds at the opening 10/20. |
| Blind speed | Slow (10 hands), **Normal (6)**, Turbo (4) | Hands per blind level. Counted in hands, not minutes, so a slow hand doesn't eat a level. |
| Ending | **Last one standing**, 20 min, 30 min, 45 min | The time caps end after the hand in progress. Biggest stack wins. |
| Rebuys | **Off**, One each in the first 3 levels | A busted player can buy back in once, to the starting stack, while the blinds are in their first three levels. |
| Turn timer | 20 s, **30 s**, 45 s | Time per decision before the game checks for you (or folds, if checking isn't free). |

## On your screen

- **Top line.** Hand number, the blinds, and the next level with how many hands until it arrives. At the start of each hand the log says who puts in the blinds and who deals, for example "Blinds: Ravi puts in 10 and Meera puts in 20 before the cards. Asha deals this hand." Time-capped games add the minutes left.
- **Status.** Whose turn it is, or "Your turn · 40 to call" when it's yours.
- **Seats.** Everyone else, from your left: name, stack, what they've bet this round, D/SB/BB markers, and Folded, All-in or Out. Whoever's acting is highlighted, with their clock draining along the bottom of the seat.
- **The table.** The five shared cards, the pot, and main and side pots once there are any. Below that, the last hand: who won what, with what.
- **Your dock.** Your cards (2, or 4 in Omaha), your best hand so far ("Pair of Nines") once there's a flop, your stack and your clock.
- **Actions.** Fold, Check or Call, and Bet or Raise. Raise opens a slider bound to the legal minimum and your stack (in Omaha, the pot limit), with Min, ½ pot, Pot and All-in shortcuts, and a confirm button. In Omaha, All-in shows only when your chips fit under the pot limit. If all you can do is go all-in, the button says so.
- **Showdown.** Hands turn up one by one, each with its label, and the board lights up that player's best five. Then the winners get stamped, everyone else dims, and the pot slides over. The pause grows with the number of hands. The last hand of the game gets an extra beat before the results.
- **Show, I'm back, Rebuy** appear when they apply.
- Your clock ticks in its last five seconds. Sounds and vibration cue the deal, bets, your turn and the pot.

## When things go sideways

- **Running out of time.** The game checks for you if it's free, otherwise folds. Two in a row and you're sitting out: your hands fold straight away (you still post blinds, and you never fold a free check) until you tap **I'm back**.
- **Disconnected player.** Treated as sitting out from their next decision, so the table never waits on them. They're back automatically when they reconnect.
- **Idle player.** The host's Skip does what the clock would.
- **The host removes a player.** Mid-hand, their cards fold. What they've already bet stays in the pot; the rest of their stack leaves with them. If only one player is left, they win.
- **Game over.** The host sees Rematch and Back to lobby; everyone else sees Play again.

## Tips

- Blinds climb fast on Turbo. Waiting for aces gets expensive.
- Position matters: acting last after the flop means you see what everyone else did first.
- A short all-in can't be re-raised by players who already acted, so a small stack can sometimes buy a cheap look at the board.
