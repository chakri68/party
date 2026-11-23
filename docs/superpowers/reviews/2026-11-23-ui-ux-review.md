# UI/UX review, 2026-11-23

Four headless-Chrome reviews (room shell, 12 bot games, 14 multiplayer games, CouchParty site) plus a Face-Off flash diagnosis. Screenshots: uxr/{shell,games-a,games-b,couchparty,faceoff-flash}/.

## Fix first (High)

1. Face-Off: a late Buzz tap hits "Redo" and cancels the duel. In confirm the Buzz button is hidden, Redo slides up ~123 px under the finger. This is the card flash the user saw (card, then "Your card", then card again), and the first buzzer loses their point. games/face-off/client/view.ts:321 (buzzer.hidden), :343 (Redo stays in confirm). Fix: keep the buzzer's box in confirm, disabled; drop buzz when !canBuzz.
2. President shows "Asshole", "A-hole", "Vice-Asshole", "VA" in game, results and the game picker everyone sees. games/president/shared/rules.ts:116-118, types.ts:32, rules-text.ts. Rename (e.g. President, Vice-President, Citizen, Vice-Last, Last), spelled out.
3. Lobby: Start (host) is ~2 screens down; guest "I'm ready" is low and not the main button. Order is invite, game, 5 settings, players, Lock, Add computer, Start. apps/web/src/views/room.ts ~860-930. Fix: sticky bottom action bar on phones; players right after invite; settings folded.
4. Guest home: "Host your own room" (npx, Node.js 22+) comes before Name/Code/Join, which start near the fold. apps/web/src/views/home.ts ~78, 188-197.
5. CouchParty: game cards say "2-12" / "2-16" players but free rooms stop at 8. product-web src/gallery.ts players string; index.html:150,192; pricing.html:45.
6. CouchParty: Host Pass card lists 4 paid games, 6 are tagged (Long Trail, The Wilds missing). Hard-coded in index.html:159, pricing.html:54; build from PREMIUM_GAME_IDS.
7. CouchParty phones: game descriptions hidden below 600 px (site.css:668), so 30 bare names.
8. Long Trail: leader's Pace/Rations/Propose start ~1.5 screens down at 360x780 with a 45 s timer.

## Medium

Shell
- Rules dialog opens scrolled to the bottom ("Got it" gets focus). packages/ui openDialog.
- Top row: 36 px buttons at 360 (40 fits), 26 px signal, the sound board 2x2 icon reads as "apps", no labels.
- Reactions bar stays open after a send and covers content.
- Reactions are emoji, against the no-emoji UI rule (packages/protocol REACTIONS).
- Host "Leave room" has no confirm and sits next to End party; "Home" in the menu keeps the seat with no explanation.
- Native confirm() for Restart/End game/Remove/Leave mid-game (room.ts 455, 556, 558, 783, 995); may be blocked in WhatsApp/Instagram webviews.
- Pause is easy to miss: small grey line, timers look live, Resume only in the menu.
- Game picker: ~30 tall cards, same icon for every game, Rules link floats between cards.
- Host sees "I'm ready" / "not ready" that do nothing.
- Results card buttons wrap at 360; exits live inside the card.

Games
- Secret role card stays shown after "Got it" in Heist, Nightfall, Short Night (Imposter hides it). Card hides on tap or tab switch, so Medium, not High. packages/hidden-roles reveal.ts callers.
- Game opens at the lobby's scroll position, hiding header/phase/timer (room.ts never resets scroll on phase change).
- "Your turn" toast covers the top row buttons and repeats the banner (views/turn.ts).
- Disabled Play/Pass/Confirm look pressable (dim lime).
- Opponent row cuts off the 3rd opponent with no scroll cue (Liar's Dice, Go Fish, Cheat, Oh Hell, President, Old Maid).
- Dock header too tight at 360 (Cheat, Crazy Eights suit picker, Go Fish, President).
- Long hands mostly off screen; selected/playable card not scrolled into view (Cheat, President, Sevens).
- Old Maid fan covers its label and the pairs pile on phone (fitFan).
- Liar's Dice bid bubble covers the status banner.
- "out 1st" means winner in Old Maid, last place in Liar's Dice.
- Oh Hell round table green check means "ready" but reads "made bid".
- Overheat: 4 players do not fit 360x780; copy (Shove, Bust, Heatwave, Fuse, Bank).
- Landscape 780x360: fixed hand dock hides the table in all 12 bot games.
- Bluff Definitions reveal "+1" unexplained; scoreboard names cut.
- Face-Off vote: "Accept: Asha" / "Reject: Meena" vs result "1 yes, 0 no" vs docs Confirm/Overturn.
- Heist top bar circles and Heat rings unlabeled.
- Scribbl player chips run off the right edge with 2 players.
- Same Page lists the same players twice.
- Don't Say It: Got it/Skip/Oops show no points; "captain" unexplained.
- The Wilds: actions under the map on phone, cut off on desktop; labels missing.
- Timers shown 6 different ways.

CouchParty
- No menu on phones (Games, Host Pass, Account hidden).
- /play looks like another product (dark, no logo/nav/footer, "Create room" vs "Start a room", double brand).
- /play subtitle asks for a room code (shared home.ts owner copy).
- Slang: "Adulting is hard enough.", "Sound familiar?".
- Small tap targets: Sign in 45x20, "Play with computers" 24 px, footer links ~23 px.
- Only 12 cards tappable; no per-game pages.
- Big prices but "Buying opens soon" is a small line.
- Games list starts on the ~5th phone screen.

## Low (selected)
Party-over screen bare and its top row differs; End party confirm below the fold; signal toast far away and shows ms; voice panel icon-only buttons; sound settings titled "Settings" closes with "Got it"; chat unread aria-label "1"; long names cut with no hint; closed-room link asks for a name first; President swap shows empty hand area; Old Maid view-transition console error (transition.ts:54); desktop cards small with empty space; "Ravi must play" phrasing; unexplained terms (blinds, Spot on, Pond); "Tap" hints on desktop; CouchParty: reveal-on-scroll blank space, hero card touches headline at 360, non-Indian names in mock and random names ("Shifty Wombat"), /play SEO title, FAQ lacks a pricing link; docs mismatch for Face-Off and Don't Say It.

## Works well
Clear turn signal (lime frame, banner, dock hint); bots paced with bubbles; strong reveal moments; consistent results card; tap-to-reveal role card; good error copy; room code card and Rejoin; chat sheet; CouchParty hero, trust signals, speed, no console errors, WhatsApp previews, helpful 404.
