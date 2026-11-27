# Blackjack

Play against the dealer. Get closer to 21 than the dealer, but do not go over. Everyone plays at the same time. 1–7 players. One person can play alone while the room fills.

Chips are play chips: no buying, no cash-out, nothing carries over between games.

Computer players can fill seats in this game. They play by the usual Blackjack chart for these rules, and they bet a small part of their chips. The host can pause it.

## The short version

- Everyone starts with 1,000 chips. You play against the dealer, not against each other.
- Everyone bets at the same time. Then everyone plays their own cards at the same time.
- Get closer to 21 than the dealer. Over 21 and you lose your bet at once.
- After the last round, the most chips wins.

## How a round goes

1. **Bet.** Everyone bets at the same time, before the clock runs out. The smallest bet is 10. The largest is all your chips. If you have less than 10, you can bet what you have. No bet in time means you sit out this round.
2. **Deal.** You get 2 cards face up. The dealer gets 1 card face up and 1 card face down.
3. **The dealer checks.** If the dealer's face-up card is an Ace or a card worth 10 (10, Jack, Queen or King), the dealer looks at the face-down card. If the dealer has Blackjack, the round ends at once. A player with Blackjack gets the bet back. Everyone else loses. The log says when the dealer checked and found nothing.
4. **Play.** Everyone plays at the same time, on their own cards:
   - **Hit:** take 1 more card.
   - **Stand:** stop with what you have.
   - **Double:** on your first 2 cards only. Put in the same bet again, take exactly 1 more card, and stop. You can also double on a hand you got from a split.
   - **Split:** when your 2 cards have the same rank (two 8s, or two Kings, but not a King and a Queen). They become 2 hands, each with the same bet. Each hand gets a second card at once. You can split only once a round. Split Aces get only 1 more card each, and then they stop.
   - Over 21 is a bust. You lose that bet at once.
   - When a hand reaches exactly 21, it stops by itself.
   - If the clock runs out, your hands stand.
5. **Dealer.** When every hand is done, the dealer turns over the face-down card. The dealer takes cards until 17 or more, and stands on every 17, also a soft 17 (an Ace counted as 11). If every hand is a bust or a Blackjack, the dealer takes no cards.
6. **Pay.**
   - A win pays the same as your bet: bet 100, get 200 back.
   - **Blackjack** is an Ace and a card worth 10 as your first 2 cards. It pays 3 to 2, rounded down to a whole chip: bet 10, win 15; bet 15, win 22. A 21 after a split is not Blackjack. It is only 21.
   - Blackjack beats a 21 made of 3 or more cards.
   - The same total as the dealer gives your bet back.
   - A bust always loses, even when the dealer goes over 21 too.

Card values: 2 to 10 count their number. Jack, Queen and King count 10. An Ace counts 11, or 1 if 11 would take you over 21. A hand where an Ace still counts 11 is **soft** ("Soft 17").

No insurance, no surrender, no side bets.

## The shoe

The game uses 6 decks shuffled together (312 cards). Before a round, if fewer than a quarter of the cards are left, the dealer shuffles all 6 decks again. The top line shows the cards left in the shoe. While you bet in a round with a new shuffle, it also says "New shuffle", and so does the log.

## Chips and the end

- If you lose all your chips, you are out.
- **Rebuys** (if the host turned them on): if you run out in the first half of the game (rounds 1 to 5 of 10, 1 to 7 of 15, 1 to 10 of 20), you can buy 1,000 chips once. **Rebuy** and **Stay out** show at the next betting. If you don't pick before the bet clock runs out, you stay out.
- The game ends after the last round, or when everyone is out of chips.
- The most chips wins. Equal chips share the win. The results show each player's chips, "out in round N" for players who ran out, and "left" for players who left.

## Settings

Host picks these in the lobby.

| Setting | Options | What it changes |
| --- | --- | --- |
| Rounds | **10**, 15, 20 | How many rounds the game has. |
| Rebuys | **Off**, 1 each in the first half | A player who runs out early can buy 1,000 chips once. |
| Turn timer | 15 s, **20 s**, 30 s | Time to bet, and time to play your hands. |

## On your screen

- **Top line.** The round, how many cards are left in the shoe, and the clock.
- **Status.** "Place your bet", "Your move", or who the table is waiting for. After the pay, what you won or lost this round.
- **Dealer.** The dealer's cards, the face-down card as a back, and the total the dealer shows.
- **Players.** Everyone else: name, chips, bet, their cards and total. While a player is still playing, their box is lit. After the pay, each hand shows Win, Blackjack, Tie, Lose or Bust.
- **Your cards.** Your hand (or 2 hands after a split, with the one you are playing lit), the total and the bet. Below: your chips.
- **Betting.** Quick amounts (10, 25, 50, 100, 250, 500 and All), a minus and a plus (10 each), and the **Bet** button. The game keeps your last amount for the next round.
- **Playing.** Hit, Stand, Double and Split. A button is grey when you can't use it now. If you tap twice fast, the second tap is not used, so you never take a card you didn't see coming.
- Your clock ticks in its last five seconds. Sounds and vibration cue the deal, your turn and your wins.

## When things go sideways

- **No bet in time.** You sit out this round. Miss 2 bets in a row and you are sitting out: the table stops waiting for your bet, and rounds start as soon as everyone else has bet. Tap **Play next round** at any time, and the next betting waits for you again. You can also just bet while betting is open.
- **Out of time while playing.** Your hands stand.
- **Disconnected player.** The table doesn't wait on them. With no bet yet, they sit out the round. Hands they are playing stand.
- **The host removes a player.** Their chips leave with them, also the chips they bet this round.
- **The host pauses the game.** The clock stops for everyone. Nobody can bet or play. When the host taps **Resume**, the clock goes on from where it stopped.
- **Game over.** The host sees Rematch and Back to lobby; everyone else sees Play again.

## Party recap

Blackjack counts each hand that goes over 21. With 3 or more in a party, you can get the **One card too many** award: "Went over the limit N times."
