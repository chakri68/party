# Overheat: Cutthroat mode — design

**Status:** approved approach, design for review • **Game:** `games/overheat` • **Branch:** `overheat-cutthroat` (shared code, lands on `master`)

## Why

Overheat plays like a solo push-your-luck game: flip until the risk feels high, then save. Other players barely matter. Three reasons, found in the code:

1. Power cards fire the moment they are flipped. Nobody chooses when or whether to use one, so Push and Swap feel like random events, not plans.
2. Saving makes you untouchable for the rest of the round, so the safe line is always "flip a bit, save", and the table never has to watch each other.
3. Power cards are rare: 16 of 88 cards, about 1 flip in 5.

The user wants these fixed so the game is about betrayal and table drama: holding a card for the right moment, hitting someone after you are safe, ganging up on the leader, then turning on each other.

## Goals

- Power cards become a hidden hand you play when you choose.
- Saving keeps your points but no longer makes you fully safe.
- New cards built for hitting other players.
- More power cards in the deck (about 1 flip in 4).
- Saved (and too-hot) players still act: they can spend their hand on the players still flipping.
- Hand sizes public, cards hidden, so a full hand is a threat and Block can be a bluff.
- A bounty on the score leader.
- A "Backstabber" award in the party recap.

## Non-goals

- No trading, deals or offers between players.
- No change to number cards, colours, scoring bonuses, heat limits or the target.
- No turn timers (Overheat waits on players today, with host skip; keep that).

## Anti-goals

- Classic must not change. Anyone who likes today's game picks Classic and gets exactly today's game.
- No waiting windows that every player sits through (Block works without one, below).
- No hidden information leaking: other players never learn which cards you hold, only how many.

## Constraints

- AGENTS.md: copy in short plain sentences, basic words, no idioms, easy for Indian readers with English as a second language; no emoji; SVG icons. Party stats never in public or private views. Bots see only views, are pure, use `ctx.chance` for off-turn choices (none planned here).
- Games stored before the deploy must keep working: treat missing new fields as empty (`hand ??= []`, etc.). Their settings say `powers: "classic"`, so they stay Classic.
- `PROTOCOL_VERSION` stays (game state is `unknown` on the wire).

## Approaches considered

1. **Hand plus open targets (picked).** Powers go to a hand, saving no longer protects fully, new betrayal cards, more powers. Biggest change, fixes all three causes.
2. **Hand only.** Smaller, but saving early still dodges everything, so betrayal stays weak.
3. **Deals between players.** Most "betrayal" by name, but needs a trade screen and table talk; much bigger build.

The user picked 1, with Cutthroat as the default, and added all four extras: turns for saved players, public hand sizes, a leader bounty, a recap award.

## The design

### Settings

`powers`: **Off** / **Classic** / **Cutthroat** (default **Cutthroat**). Off and Classic are exactly today's rules and deck. Everything below is Cutthroat only, except the recap stat, which counts in every mode.

### Deck (Cutthroat)

Today's 72 number cards and 16 powers, plus 10 new powers:

| Card | Copies | What it does |
|---|---:|---|
| Cool | 4 | Your heat goes down by 5. |
| Double | 3 | Your next number card this round counts double. |
| Push | 3 | A player still flipping gets the next card from the deck. |
| Swap | 2 | Swap one of your number cards with one of another player's. In Cutthroat the other player may have saved this round. |
| Burn | 2 | A player still flipping gets +1 heat at the start of each of their turns. |
| Limit down | 2 | The limit goes down by 3 for everyone still flipping. |
| **Steal** (new) | 3 | Take one number card from another player's row (still flipping, or saved this round). Its heat and points come with it. |
| **Dump** (new) | 2 | Give one of your number cards to a player still flipping. Its heat and points go with it. |
| **Audit** (new) | 2 | A player who saved this round loses their highest number card. |
| **Block** (new) | 3 | Kept in your hand. When a card is aimed at you, Block cancels it by itself. |

26 powers in 98 cards, about 1 flip in 4.

### Your hand

- Flipping a power card puts it in your hand (face down to others). Hands hold at most **3**. If your hand is full, the flipped power fires at once, as in Classic.
- Your hand stays with you from round to round. It is discarded if you leave.
- Everyone sees how many cards each player holds. Only you see which.

### Turns

- **Still flipping:** on your turn you may play **one** card from your hand, then you must flip or save, as today (first turn of a round: must flip).
- **Saved or too hot:** your turn still comes round while anyone is flipping. You may play one card from your hand, or **Pass**. If your hand is empty, your turn is skipped (hand size is public, so this reveals nothing new).
- The round ends, as today, when nobody is still flipping. Held cards then stay in hands.
- Block is never played by choice; the Play button doesn't offer it.
- **What a saved or too-hot player may play** (my call): aimed cards (Push, Swap, Burn, Steal, Dump, Audit) and Limit down. Cool and Double are for flippers only. A card with no legal target right now is shown but greyed out.
- **Holding cards but none playable** (my call): the turn still comes, and the player presses Pass. Skipping it would show the table that the hand is useless (often all Blocks) and kill the bluff. Bots pass at once; host Skip works as today. Cost: a short wait for that player's tap.

### Push in Cutthroat

When a Push turns up a power card for the target, it fires for the target at once, as in Classic, and never goes into their hand (my call: Push stays an attack, not a gift). A Block stops the Push when it is aimed, before any card is turned up. If the pushed card's effect makes the target go too hot, the pusher gets the bounty and `pushedOver`.

### Saved players are not fully safe

A saved player's points for the round were added at save time. When a card (Steal, Audit, Swap in Cutthroat) changes a saved player's row, recompute that player's round points with the normal scoring (numbers, colour bonuses, Perfect stays if it was earned) and change their score by the difference. Their heat does not matter any more; they cannot go too hot after saving.

### Block

When an aimed card (Push, Swap, Burn, Steal, Dump, Audit) is played at a player who holds Block, the Block is spent and the card is cancelled (discarded, no effect). No window, no waiting, no choice. Everyone sees "Ravi's Block stopped it." Limit down hits everyone and cannot be blocked.

### Bounty

- At the start of each round, the player with the highest score is the **leader** (shown with a mark). No leader when the top score is shared or is 0.
- If a card you play makes the leader go too hot that round, you get **+5** points at once.
- "Makes them go too hot" means your card's own effect caused it: Push (the card it brings), Swap, Dump, Limit down. Burn's later heat does not count (my call, to keep it clear who did it).

### Recap: Backstabber

- New stat key `pushedOver`: +1 for you each time a card you played makes another player go too hot (same rule as the bounty, any player, every mode).
- Award row in `packages/game-core/src/recap.ts`: title "Backstabber", min 2, line "Pushed N players over the limit." Placement: after "Not my problem".
- Overheat gets `partyStats` and comes off the recap exempt list in `apps/server/test/games.test.ts`.

### Screen

- Each player row shows a hand-size badge ("3 cards") and the leader mark.
- Your hand shows under the table: each card's name and one line. Tap a card to play it when allowed; aimed cards use today's "Pick" targeting.
- Saved or too-hot with cards: "Play a card or pass." with a **Pass** button.
- Log line for new events: Steal, Dump, Audit, Block, bounty.

### Bot

Plays from views only. Rough policy: play Cool when close to the limit; Double early; aim Push / Burn / Dump at the flipping player closest to the limit (leader first); Steal the highest card it can take without going too hot; Audit the saved player with the highest card; when saved, always play an aimed card if it has one, else pass.

### Testing

- Classic and Off unchanged: existing tests keep passing untouched.
- Cutthroat rules: hand limit and overflow firing, hands carry over, one card per turn, saved/too-hot turns and skipping, Steal/Dump/Audit/Swap on saved players with score recompute, Block cancelling each aimed card, bounty rules, stats.
- Privacy: no other player's hand cards in public state, others' private state or events (`findLeaks`).
- Card conservation including hands.
- Bots: `playBots` over 2–8 players in every mode; balance run reports bust rate and rounds per game.
- Balance (my call): Classic keeps its bounds untouched. Cutthroat gets its own: bust rate 0.2 to 0.75 per player per round, and a game at target 150 lasts 4 to 14 rounds at 4 players. If it lands outside, the builder may change the copies of the new and old power cards and the hand limit (2 to 4), never number cards, limits or scoring.
- Docs: `docs/games/overheat.md` and lobby rules text updated; rooms.md recap list.

## Left to the builder

File layout inside `games/overheat`, event shapes, exact bot thresholds, card icons, and how the hand row fits the current client layout.
