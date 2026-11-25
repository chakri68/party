# Not My Problem!

Everyone works at a very bad company. Problems keep coming. Fix them, or pass them to someone else. Three warnings and you are fired. 3–8 players, best with 4–6.

Computer players can fill seats in this game. The host can pause it.

## The short version

- You start with five cards and no warnings. Three warnings and you are fired.
- On your turn, you can play up to two cards. Then you draw one card. Drawing ends your turn.
- If you draw a Problem, fix it or pass it to another player. They can send it back, and other players can cancel a pass.
- If nobody fixes a Problem, the player who holds it gets the warnings on it.
- The last player who is not fired wins. If the cards run out first, the player with the fewest warnings wins.

## How it plays

1. Each player gets five cards: one Quick Fix and four other cards. Nobody starts with a Problem. The rest of the cards, with all the Problems, are shuffled into the draw pile.
2. The player after the dealer goes first. Turns go around the table. Fired players and players who left are skipped.
3. **Your turn.** You have 25 seconds. You can play up to two of these cards: Overtime, Intern, Promotion, Spy. Then tap **Draw**. If the time runs out, you draw.
4. **The draw.** An action card goes into your hand. Only you see it. A Problem goes in the middle of the table, and it is now your Problem.
5. **Your Problem.** You have 15 seconds. You can:
   - play a **Quick Fix**: the Problem is fixed;
   - play a **Blame Game** on another player: you try to pass it to them (see "Passing a Problem");
   - play a **Fake Report** (see "Fake Report");
   - tap **Take 1 warning** (**Take 2 warnings** for a Data Leak): you take the warnings on it. If you have an Intern, it takes one warning, so the button shows one less. If the Intern takes the only warning, the button says **Take it**.
   If the time runs out and you hold a Quick Fix, it is played for you. If you don't hold one, you take the warnings.
6. When the Problem is gone, your turn ends. If you have Overtime, you draw your second card first.

Cards you play to answer a Problem don't count toward your two cards. Every card you play is used up, even when someone cancels it. There is no limit on how many cards you can hold.

## Cards

The number of copies depends on how many players start the game.

| Card | When | What it does | 3 | 4 | 5 | 6 | 7 | 8 |
| --- | --- | --- | --: | --: | --: | --: | --: | --: |
| Quick Fix | Your Problem | Fix your Problem. | 5 | 6 | 7 | 8 | 9 | 10 |
| Blame Game | Your Problem | Pass your Problem to another player. | 5 | 6 | 7 | 8 | 9 | 10 |
| Not Me | Passed to you | A Problem passed to you goes back. | 3 | 4 | 5 | 6 | 7 | 8 |
| Revenge | Passed to you | A Problem passed to you goes to someone else. | 2 | 3 | 3 | 4 | 4 | 5 |
| HR Complaint | After a pass | Cancel the last pass. | 3 | 3 | 4 | 4 | 5 | 5 |
| Fake Report | Your Problem | Play a card face down and say it is a Quick Fix. | 2 | 2 | 3 | 3 | 4 | 4 |
| Overtime | Your turn | A player draws 2 cards on their next turn. | 2 | 2 | 3 | 3 | 4 | 4 |
| Intern | Your turn | Your next warning goes to the Intern. | 1 | 2 | 2 | 3 | 3 | 4 |
| Promotion | Your turn | Remove 1 of your warnings. | 2 | 2 | 3 | 3 | 4 | 4 |
| Spy | Your turn | Take a random card from a player. | 2 | 2 | 3 | 3 | 4 | 4 |

More about the cards you play on your turn:

- **Overtime.** Pick another player. On their next turn they draw two cards, one at a time. You can't pick a player who already has Overtime.
- **Intern.** It sits in front of you, and everyone can see it. It takes one warning for you, then it is gone. You can have only one Intern at a time.
- **Promotion.** You can play it only when you have a warning.
- **Spy.** Pick another player who has cards. You take one of their cards at random. Only the two of you see which card it was.

### Problems

There are 3 Problems for each player who starts the game.

| Problem | If nobody fixes it | Special rule | 3 | 4 | 5 | 6 | 7 | 8 |
| --- | --- | --- | --: | --: | --: | --: | --: | --: |
| Server Down | 1 warning | None. | 5 | 6 | 8 | 9 | 11 | 12 |
| Data Leak | 2 warnings | An Intern stops only 1 of the 2. | 2 | 2 | 3 | 3 | 4 | 4 |
| Angry Client | 1 warning | It can't go back to the player who last passed it on. A Not Me doesn't count. | 2 | 4 | 4 | 6 | 6 | 8 |

With 4 players, that is 44 cards. After the deal, 24 are left in the draw pile: 12 action cards and 12 Problems.

## Passing a Problem

A Blame Game starts a pass. Each pass has two short windows. Their length is the "Time to react" setting.

1. **The target window.** Only the player you picked can act. They can:
   - tap **Accept**: the pass goes ahead;
   - play **Not Me**: the Problem goes back to you;
   - play **Revenge** and pick a third player: the Problem goes to that player. They can't pick you or themselves.
   If the time runs out, it counts as Accept.
2. **The HR window.** Everyone sees what happened. Every player still in the game can play **HR Complaint**, except the player who made the last move. HR Complaint cancels that move:
   - after Accept, it cancels the Blame Game: the Problem stays with you;
   - after Not Me or Revenge, it cancels that card: the Problem goes to the player you first picked.
   Each player can also tap **Pass**. Once you pass, you can't play HR Complaint in that window. The window closes when time runs out, or when everyone who can play has passed.

The first HR Complaint wins and closes the window. If yours comes too late, it is refused, and the card stays in your hand. Nobody can cancel an HR Complaint.

When the Problem lands, the player who holds it gets a new 15 seconds to answer it. This also happens when it comes back to you.

**Four tries.** Each Problem can be passed at most 4 times. Each Blame Game and each Revenge counts, even one that was canceled. The table shows how many tries are left. After that, the holder can only fix it, play a Fake Report or accept it.

**Angry Client.** It can't be passed to the player who last passed it on: not with Blame Game, not with Revenge. Sending it back with Not Me doesn't count as passing it on.

## Fake Report

With a Problem, play Fake Report and one more card from your hand face down. You say the face-down card is a Quick Fix. It may really be one. Everyone else gets one challenge window, with the "Time to react" length.

- **Nobody challenges:** the Problem is fixed. Nobody ever sees the face-down card.
- **Someone challenges, and it was not a Quick Fix:** everyone sees the card. You take the Problem's warnings plus 1 (2 for Server Down or Angry Client, 3 for Data Leak). Then the Problem is gone.
- **Someone challenges, and it was a Quick Fix:** everyone sees the card. The player who challenged gets 1 warning. The Problem is fixed.

The first challenge wins. A late one is refused and costs nothing. Once you pass, you can't challenge that report. The window closes early when everyone who can challenge has passed. Both cards are used up either way.

## Winning

- **Fired.** At three warnings you are fired at once. Your cards go to the discard pile. If you held the Problem, it goes too. If it was your turn, your turn ends. You stay in the room and can still watch, chat and talk.
- **One player left.** The last player who is not fired wins at once.
- **No cards left.** When the draw pile is empty and there is no Problem on the table, the game ends. The player with the fewest warnings wins. If players tie, the one with the most cards in hand wins. Players still tied after that share the win.

The results list the players who are not fired first, by fewest warnings, then most cards. Each shows how many warnings they have, like "1 warning". Fired players come next, the last one fired first, with "Fired 1st", "Fired 2nd" and so on ("Fired 1st" was fired first). Players who left without being fired come last, marked "left".

## Settings

Host picks this in the lobby.

| Setting | Options | What it changes |
| --- | --- | --- |
| Time to react | 5 seconds, **8 seconds**, 12 seconds | How long the target window, the HR window and the challenge window last. The HR and challenge windows close early once everyone has passed. The lobby shows how many Problems there are, and how many cards are in the pile. |

The turn (25 seconds) and the time to answer a Problem (15 seconds) don't change.

## On your screen

- **The top bar.** The round, how many cards are left in the draw pile, whose turn it is, the timer, and a **Rules** button. **Rules** opens the short rules and every card, in groups: Problem cards, cards for when you hold a Problem, reactions, and cards for your turn.
- **Players.** A box for each player: their warnings as three small squares (a red square is a warning), and their number of cards. A person sign means they have an Intern. A clock sign means they have Overtime. The player whose turn it is has a green edge. The player who holds the Problem has a red edge and a "Problem" label. Fired players are marked "Fired", and players who left are marked "Left".
- **The table.** When there is a Problem: what it is, what it costs, who holds it, and how many tries are left to pass it on. If not, it says "No Problem right now."
- **The last move.** One line under the table says what just happened, like "Asha passed Server Down to Ravi." If the game refuses a move, the reason shows there for a few seconds.
- **The window.** A box above your hand says who played what and what will happen, with a countdown. It never covers your hand.
  - A Problem is passed to you: "Ravi wants to pass Data Leak to you." Tap **Not Me**, **Revenge** (pick a player, then **Confirm**) or **Accept**. You only see Not Me or Revenge if you hold that card. Everyone else sees who is deciding, like "Asha is deciding."
  - The HR window: what happened, like "Ravi passed it to Asha. Asha sent it back.", and who gets the Problem if nobody cancels it. Tap **HR Complaint** (if you hold one) or **Pass**. After you pass, it says "You passed. Waiting."
  - A Fake Report: "Ravi says this is a Quick Fix." Tap **Challenge** or **Pass**. The player who made the report sees their own face-down card.
- **A challenge.** The face-down card shows in the middle of the table for 2 seconds, with "Not a Quick Fix" or "A real Quick Fix". If your phone is set to reduce motion, it is not shown there. The last-move line always says what the card was and who got the warnings.
- **Your hand.** Your cards, with their text. The top of each card says when you can play it: "Your turn", "Your Problem", "Passed to you" or "After a pass". Cards you can play now have a green edge and say "Play now". Tap a card to read it. Looking at a card never plays it: tap **Play** to play it. For a card that needs a player, the players you can pick get a red edge and the word "Pick". Tap one, then **Confirm**.
- **Your Problem.** Buttons for what you can do: **Fix** (plays a Quick Fix), **Pass it on** (plays a Blame Game: pick a player, then **Confirm**), **Fake Report** (pick the card to put face down, then **Confirm**), and **Take 1 warning** (or 2 for a Data Leak). The count already leaves out the warning your Intern takes. If your Intern takes the only warning, the button says **Take it**.
- **Draw.** On your turn, after any cards you want to play.

On a phone held sideways, the cards are smaller and sit in one row beside the buttons.

## When things go sideways

- **Late cards.** If a window already closed, a late HR Complaint or challenge is refused with "Too late". The card stays in your hand, and nothing is shown.
- **Disconnected player.** They stay in the game. If a Problem is being passed to them when they drop, or is passed to them while they are away, the pass goes ahead at once. If it is their turn, or they hold a Problem, the game waits for their timer: then they draw, or a held Quick Fix fixes the Problem, or they take the warnings. They can't play HR Complaint or challenge, so windows don't wait for them. When they come back, they play again.
- **Idle player.** The host gets a **Skip** button after a while. A skip does what the timer would do: a turn draws, a Problem is fixed with a held Quick Fix (or the warnings are taken), and a target accepts. The HR and challenge windows wait only for the clock, so there is nothing to skip.
- **The host removes a player.** Their cards and their Intern go to the discard pile, and their Overtime ends. A Problem they hold goes too, and play goes on. A pass to them fails, and the Problem stays with the player who played the Blame Game. If it was their turn, the turn ends. If only one player is left, they win. A player who was fired and then left keeps their "Fired" place in the results.
- **The host pauses the game.** The timer stops for everyone. Nobody can play. When the host taps **Resume**, the timer goes on from where it stopped.
- **Game over.** The host sees Rematch and Back to lobby; everyone else sees Play again.

## Tips

- Keep a Quick Fix if you can. If your timer runs out, it is played for you.
- Keep a Not Me for when someone passes you a Data Leak.
- HR Complaint works best when a Problem is about to land on you.
- A Fake Report with a real Quick Fix face down is a trap for anyone who challenges.
- Watch the draw pile. Near the end, fewer warnings matter more than cards.
