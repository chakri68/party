# Overheat

Flip cards for points. Every card also adds heat. Go over the heat limit and you get nothing for the round. Save in time, and push cards onto other players. 2–8 players.

Computer players can fill seats in this game. They flip first and save when the heat limit is close. In Cutthroat they keep cards for the right moment: Cool when close to the limit, Double early, a Steal that fits. They aim Push, Burn and Dump at the player closest to the limit, the leader first, and on a saved turn they play a card that hurts someone, or pass. In Classic they aim a Push at the player closest to the limit, and a Burn at the top score.

## The short version

- Each round has a heat limit. Everyone can see it.
- On your turn, flip a card or save.
- A number card adds its number to your heat and to your points.
- If your heat goes over the limit, you are too hot. You get 0 points for the round.
- Save to keep your points.
- Power cards (on by default) change heat, limits and rows. In Cutthroat, the default, you keep them in your hand and play them on others.
- The first player to reach the target score at the end of a round wins.

## How it plays

1. At the start of each round the game picks a heat limit from 18 to 30. Everyone's heat starts at 0 and every engine (your row of cards) is empty.
2. Turns go round the table. The first player moves one seat each round.
3. On your turn, press **Flip** to turn over the top card, or **Save +N** to keep your points and leave the round. On your first turn of a round you must flip.
4. A number card goes into your engine. Its number goes on your heat and on your points.
5. If your heat goes over your limit, you are **too hot**. You are out of the round with 0 points. This is checked after every change, so a card from another player can make you too hot on their turn.
6. If your heat is exactly your limit, that's **Perfect**: +10 points, and you save at once.
7. The round ends when nobody is still flipping. Everyone's round result stays on screen for a few seconds, then the next round starts.
8. When the deck runs out, the used cards are shuffled into a new deck.

## Power cards

Power cards add no heat and no points of their own. The **Power cards** setting picks how they work: Off (none), Classic (16 in the deck of 88) or **Cutthroat** (26 in the deck of 98, the default).

| Card | Classic | Cutthroat | What it does |
| --- | --- | --- | --- |
| Cool | 4 | 4 | Your heat goes down by 5. Never below 0. |
| Double | 3 | 3 | Your next number card this round counts double: double heat, double points. |
| Push | 3 | 3 | Pick a player still flipping. The next card from the deck goes into their engine. If it's a power card, it works for them at once. |
| Swap | 2 | 2 | Pick a player. Swap one of your number cards with one of theirs. Points move with the cards. Heat moves too, for players still flipping. |
| Burn | 2 | 2 | Pick a player still flipping. At the start of each of their turns, their heat goes up by 1. A player can have more than one. |
| Limit down | 2 | 2 | The limit goes down by 3 for every player still flipping. If you are still flipping, that includes you. |
| Steal | – | 3 | Take one number card from a player's row. Its heat and points come with it. |
| Dump | – | 2 | Give one of your number cards to a player still flipping. Its heat and points go with it. |
| Audit | – | 2 | Pick a player who saved this round. They lose their highest card. |
| Block | – | 3 | Keep it in your hand. It stops the next card a player aims at you. |

### Classic

A power card works as soon as you flip it. Push, Swap and Burn can only be aimed at players who are still flipping. After you save, other players' cards can't hurt you. If there is nobody to aim at, the card does nothing.

### Cutthroat

- **Your hand.** A power card you flip goes into your hand, face down. You can hold up to 3. With a full hand, a new power card works at once, as in Classic. Your hand stays with you from round to round.
- **Everyone sees how many.** Each row shows how many cards that player holds ("2 cards"), but not which ones. A full hand might be all Blocks.
- **Playing a card.** On your turn you may play one card from your hand, before you flip or save. Then you still flip or save.
- **Saved turns.** After you save or go too hot, you still get turns while you hold cards. You see "Play a card or pass." Play a card that aims at someone (Push, Swap, Burn, Steal, Dump, Audit) or Limit down, or press **Pass**. Cool and Double are for players still flipping.
- **Saved is not safe.** Steal, Swap and Audit can reach a player who saved. Their round points are worked out again, and their score goes down or up. A saved player can't go too hot.
- **Steal while saved.** If you have saved or gone too hot, a card you steal is thrown away. It only takes the points from them.
- **Block.** You never play it. When a player aims a card at you, your Block stops it by itself, and both cards are thrown away. Everyone sees "Ravi's Block stopped it." Limit down hits everyone and can't be blocked. A Block that a Push turns up, or one that comes with a full hand, does nothing.
- **The leader.** At the start of each round, the player with the top score is the leader, with a "Leader" mark on their row. There is no leader when the top score is shared, or is 0.
- **Bounty.** If a card you play makes the leader go too hot, you get 5 points at once. It counts for the card's own effect: Push (the card it brings), Swap, Dump and Limit down. Burn's heat at the start of a turn doesn't count.

## Winning and scoring

When you save, you score:

- the numbers on your cards (a card played after Double counts double),
- +5 for each colour you have 3 or more cards of,
- +5 if you have all 4 colours,
- +10 for Perfect.

At the end of a round, if anyone has reached the target, the game ends. The highest score wins. Ties share the win. Results show everyone's points.

## Settings

Host picks these in the lobby.

| Setting | Options | What it changes |
| --- | --- | --- |
| Target | 100, **150**, 200 | The score that ends the game at the end of a round. |
| Power cards | Off, Classic, **Cutthroat** | Off is pure flip-or-save. A good first game. Classic: power cards work when you flip them. Cutthroat: you keep them in your hand and play them on others. |

## On your screen

- **Header.** The round, the heat limit for the round, how many cards are left in the deck, and the target.
- **One row per player.** Name, score, and a chip: Flipping, Saved +N, Perfect +N, Too hot or Left. A burn icon with a count shows their Burns. "Next ×2" means a Double is waiting. In Cutthroat, a crown with "Leader" marks the leader, and a card icon shows how many cards they hold ("2 cards").
- **Heat bar.** It fills as heat goes up and turns from blue to red. The line is that player's limit, with the numbers next to it (`17 / 24`). After a Limit down card, the line moves left. When a player is 3 or less away from the limit, the bar shakes.
- **Cards.** A number card is filled with its colour. It shows a big number, and its shape in two corners: red circle, amber triangle, blue square, green diamond. A "×2" mark means it counts double. A power card shows an icon and its name. Its colour says what it does: blue helps you, red hits a player, amber hits everyone, violet keeps you safe.
- **Your cards** (Cutthroat). Under the table, each card in your hand with its name and what it does. On your turn, tap a card to play it. A card you can't play now is greyed out with the reason, like "No one to aim at", "Only while flipping", "Block works by itself" or "One card each turn".
- **Buttons.** Flip and Save +N, where N is what you would score now. Save is greyed out on your first turn. On a saved turn there is one button: Pass.
- **Aiming.** For Push, Burn and Audit, the rows you can aim at get a red border and the word "Pick". Pick one. For Swap, pick one of your cards and one of theirs. For Steal, pick a card in another player's row. For Dump, pick one of your cards and a player.
- **Log.** One line under the table says what just happened, like "Asha pushed a Red 8 onto you."
- Sounds and vibration mark flips, saves, going too hot, power cards and your turn.

## When something goes wrong

- **Idle player.** The host gets a "Skip" button after a while. A skip saves for them, or flips if it's their first turn. On a saved turn, it passes. If they were aiming a card, the game picks a target (and cards) at random.
- **Disconnected player.** The game waits, and their row shows them as reconnecting. The host can skip or remove them.
- **The host removes a player.** They're out, and the cards in their hand are thrown away. If they were aiming a card, the card does nothing and play goes on. If only one player is left, the game ends.
- **No cards left at all.** A Flip saves you. A Push does nothing.
- **Game over.** The host sees Rematch and Back to lobby; everyone else sees Play again.

## Party recap

Overheat counts each time a card you play makes another player go too hot, in any mode. With 2 or more, you can get the **Backstabber** award: "Pushed N players over the limit."

## Tips

- With 5 to go, about 1 flip in 3 makes you too hot. With 3 to go, more than half do.
- Colour bonuses add up. 3 reds and one of each other colour is +10.
- Watch other players' bars. A Push onto someone at 26 of 27 is very likely to make them too hot.
- In Cutthroat, a saved row is not safe. A big saved row is a target for Steal and Audit.
