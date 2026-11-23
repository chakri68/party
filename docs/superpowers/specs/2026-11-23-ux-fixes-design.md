# UI/UX fixes from the 2026-11-23 review: design (short)

Status: the user asked to fix every finding, most important first ("We need to fix all of these you can go ahead with things based on importance of each one for user experience"). The calls below are Claude's, made to keep moving; the user can correct any of them.

Source: `docs/superpowers/reviews/2026-11-23-ui-ux-review.md` (four headless-Chrome reviews plus the Face-Off flash diagnosis).

## Intent

Players are Indian, often reading English as a second language, on mid-range Android phones (360x780 is the main size), joining from a group chat link. Fix what blocks or confuses them first, then visible friction, then polish.

## Rules that hold for every fix

- Earlier rule from the user: "functionally nothing should change only the UI". A fix may move, restyle, relabel, or reveal a control, and may stop a tap that was clearly an accident (Face-Off). It does not change game rules, scoring, or what the server allows.
- Copy: short plain sentences, basic words, no idioms, no slang. No emoji anywhere in the UI; icons are SVG.
- Wire format stays put unless a fix needs it; if a message or room state changes shape, bump `PROTOCOL_VERSION`.
- Phone portrait 360x780 first, then landscape 780x360 where a game is played sideways, then desktop 1280x800.

## Waves, in order of player impact

1. High, main site: Face-Off late tap, President rank names, lobby Start/ready reach, guest home order, Long Trail leader controls.
2. Room-wide Medium: in-app confirm instead of `confirm()`, Rules dialog scroll, scroll reset on phase change, turn toast, pause, reactions bar, reaction icons, game picker, results buttons, host-only oddities.
3. In-game Medium: secret role card, disabled buttons, opponent row, long hands, landscape dock, per-game layout and copy.
4. CouchParty (product branch): honest player counts, Host Pass list, phone descriptions, phone menu, /play look, copy, tap targets.
5. Low items folded into the wave that touches the same file; the rest in a final sweep.

## Calls made (Claude's)

- **Face-Off:** after the first buzz the Buzz button keeps its place, shown disabled, so nothing slides under a late finger. A buzz while `canBuzz` is false is dropped on the client. Vote buttons say who gets the point: "Point to Asha" and "Point to Meena". The result line and `docs/games/face-off.md` use the same words.
- **President titles:** President, Vice-President, Citizen, Vice-Beggar, Beggar. Spelled out in full, with no short forms like "VP". A game saved under the old names must still finish after the deploy.
- **Lobby:** the lobby order becomes room code card, Players, Game card, settings, Lock and Add computer. On phones (under 600 px) the main action sits in a bar stuck to the bottom of the screen: Start for the host, I'm ready / Not ready for others, styled as the main button. The host no longer sees a ready button or a ready tag, because the host's ready state does nothing. Leave room and End party stay below. Guests see game settings as a one-line summary, and the host gets them in a fold that is closed by default on phones.
- **Guest home:** Name, Code and Join come first. "Host your own room" moves below, smaller.
- **Long Trail:** while the leader plans, the plan controls come before the report and scene on phones.
- **Confirm pop-ups:** one in-app confirm dialog in `packages/ui` replaces every native `confirm()`. The host's Leave room also asks first.
- **Reactions:** the wire values stay the same emoji strings, so there is no protocol change. The client draws an SVG icon for each one: thumbs up, laughing face, heart, surprised face, crying face, fire. The bar closes after a send.
- **Sound board icon:** a speaker with waves, not a 2x2 grid.
- **Game picker:** compact rows with no repeated icon, and each game's Rules link inside its own row.
- **Pause:** a clear banner across the game saying "Paused by the host". The host gets a Resume button in the banner, so they don't need the menu.
- **Timers shown six ways:** parked. A shared timer is a refactor that touches every game. Each game's own timer gets readable labels where the review called them out.
- **CouchParty player counts:** cards show the free range ("2 to 8 players"). The Host Pass is the one place that mentions bigger rooms.

## Non-goals

No new features, no game rule changes, no change to voice, sound board contents, or bot behaviour.
