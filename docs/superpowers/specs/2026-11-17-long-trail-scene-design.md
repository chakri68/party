# Long Trail: the trail scene

An animated band at the top of Long Trail's screen. The caravan walks through the land it is crossing, and each day's event is acted out. It is drawn on a canvas, using Kenney CC0 backdrops and our own flat sprites.

## Why

Long Trail plays well, but it looks like a form: a top bar, a row of dots for the route, stock as text, a player list and a plan panel. Nothing moves except the timer bar. The user's words: "too bare bones". The trail-game genre is fun in large part because you watch your caravan walk and see what happens to it. Players should feel the trip, not only read about it.

The idea comes from the classic trail game's travel screen: your caravan moving across the land while you decide. Only the idea carries over. The look, the art and every scene are our own, in line with the Long Trail spec's anti-goal "Anything recognisable from the classic game's text, names or art". No pixel-art wagon, no tombstones, no oxen, no screens copied from that game.

## Goals, non-goals, anti-goals

**Goals**
- The caravan is always visible and alive during plan, vote, choice and the day report, while players tap the panel below.
- The scene shows the true state of the trip: the land of the current leg, the pace, how many camels, who is alive, who is sick, rest days, towns.
- Every event card is acted out by a short scene. Choice cards show the situation while people pick, then the result.
- It runs smoothly on a cheap Android phone and does not drain the battery.

**Non-goals**
- Anything players can touch or tap in the scene. It is to watch, not to play.
- Sound design for each scene. The existing sounds and buzzes stay as they are.
- New rules. Only the day report timer changes.
- Scenes for the reveal, recap and "over" phases. The scene is hidden there, as the strip is today. (An arrival scene for the recap is a possible later step, not this one.)

**Anti-goals** (failures even if it works)
- **The scene leaks a secret.** It must never show what only one job may know: how dangerous a leg is, which way at a fork is safer or shorter, prices at the next market, or how close a sick traveller is to getting worse. Sky, weather and mood come from the event that happened, never from the hidden danger.
- **It gets in the way of the leader.** The plan form is the most important thing on screen in the plan phase. The scene stays in its band, adds no text the player must read, and does not flash.
- **It slows the game or the phone.** No dropped taps, no jank in the plan form, no heat.
- **It looks like a copy of the classic game** (see Why).
- **Emoji anywhere.** Art is drawn images. Labels are text.

## Constraints

- Phones first: a portrait screen 320–430px wide. The scene band is the full width of the game column (max 600px), about 150px tall (a fixed ratio, near 4:1).
- Plain DOM plus a canvas. No game engine and no Godot. The rest of the view stays DOM.
- All art is CC0 (Kenney) or drawn by us. Credit goes in a `LICENSES.md` next to the art, as Treasure Hunt does.
- Copy rules from AGENTS.md: short, plain sentences, no idioms, no emoji. The scene itself has no words.
- `prefers-reduced-motion: reduce`: no scrolling or walking. Draw a still frame of the current state, and give each event one still frame instead of motion.
- Pause the drawing loop when the tab is hidden (`document.visibilityState`) or the band is off screen (IntersectionObserver), and stop it in `destroy()`.
- The scene reads only public state (`LongTrailPublicState`) plus the pack. It never reads `LongTrailPrivateState`. That keeps the secrecy anti-goal true by construction.

## Approaches considered

1. **A layered DOM/CSS scene.** Wide background images scroll by CSS animation, and walkers use CSS sprite steps. Cheap, and it fits today's DOM view. **Turned down by the user:** walk cycles, weather, fire and robbers riding in would mean fighting CSS all the way.
2. **A canvas 2D scene. Picked by the user.** We draw each frame: parallax layers, sprites, particles (sand, rain, sparks). Full control over timing and effects. It costs more code and needs care with pixel ratio and pausing.
3. **Godot, like Treasure Hunt.** Real 3D, but far too heavy for a 150px band on a voting screen. Ruled out.

**Art:** Kenney has no camel or desert caravan. Kenney's Animal Pack is cartoon heads, Desert Shooter is small tiles, and Sketch Desert is isometric. So we use [Kenney Background Elements Redux](https://www.kenney.nl/assets/background-elements-redux) (CC0) for hills, mountains, clouds and trees in the parallax layers. Camels, travellers, tents, stalls, robbers and props are drawn by us as simple flat shapes in a matching style. They can be drawn in code on the canvas or kept as small SVGs, whichever the builder finds cleaner.

## What the user decided

- The caravan moves through a scene **while people plan and vote**, not only between days.
- **Canvas**, not CSS.
- **Events are acted out**, like the classic trail game's travel screen (the idea, not the look).
- **The day report gets longer**, about 9 seconds instead of 5, so the travel and the event can play.
- **No emoji** in the UI, mockups or docs.

## What the scene shows

```
+------------------------------------------+
|   cloud        /\  /\        cloud    /\ |  far layer: mountains or dunes, slow
|  ~~~~~~~~~ near hills / dunes ~~~~~~~~~~ |  near layer, faster
|          C   C     T   T   T    t        |  C camel, T traveller, t sick (lags, slumps)
|  ==========ground, path, props========== |  ground layer, fastest
+------------------------------------------+
  o====o====O-----o---<o o>---o------ end      the route line, now thin, under the band
  To Vessa: 12 km left, desert                 the "where" line, as today
```

**Terrain** follows `leg.kind`: desert (dunes, sand, sun), mountain (peaks, rocks, a narrow path), river (water in the ground layer, reeds, bank), plain (grass, trees). Halted at a stop with no leg: the stop's town, with market stalls if it has a market and houses if not. At the end stop, the gate.

**The caravan:**
- One traveller sprite for each traveller still in `travellers`, in seat order. Each gets a colour from the room avatar, so players can find themselves. A player who left is not drawn. A dead traveller is not drawn walking. (Showing graves would copy the classic game, so the dead simply stop appearing. The party list below still says Dead.)
- Health 2 (Sick): walks a little slower and bobs less. Health 1 (Badly hurt): rides on a camel, or limps if there are more hurt travellers than camels.
- One camel for each camel in `stock.animals`, carrying packs. Over capacity: packs piled high.

**Motion:**
- Plan, vote and choice: the caravan walks in place while the layers scroll. The speed follows the plan on screen: the leader's draft for the leader, the proposed plan during the vote, yesterday's plan otherwise. Slow, Steady and Hard give three speeds. A rest in that plan shows the camp: a tent, a fire and still camels.
- Halted at a town: no scroll. The caravan stands by the stalls.
- At a fork: the path splits into two in the ground layer, with no hint of which is safer or shorter. Both ways look alike.

## What the server must add (my call, see Calls made)

Today the public state cannot tell the scene what the event did, apart from the rest of the day:
- `lastDay.report.healthChanges` mixes doses, rest healing, risk rolls and event harm in one list.
- `stockDelta` and `cargoDelta` are the whole day's change, so they mix in trades, food eaten, the Quartermaster's food and a camel lost to tiredness.
- The km lost to an event is thrown away.
- A chance option does not record which way it went.
- During the `choice` phase, `lastDay` is still yesterday's. Today's plan and travel are only in the server's `draft`.

So the server adds two public fields. Neither is a secret: the day report and the screen already show the same facts in words and numbers.

1. **`DayLog.eventOutcome`** (optional, missing in stored games and on days with no event): what the event alone did. That's `healthChanges`, `stock` and `cargo` deltas after clamping, `km` lost (as in `EffectReport`), `scoutSaved`, and for a choice, whether a chance option went well (`lucky: boolean`). It is set in `resolveDay` and `closeChoice` from the `EffectReport` they already build. The rest of `report` stays as it is. The scene works out "everything else" as `report` minus `eventOutcome`.
2. **`today`** on the public state during `choice` only (null otherwise): `{ day, plan, report }` for the part of the day already played (trades, doses, travel), from `draft`. It is what `lastDay` will hold once the choice closes, minus the event.

Stored games without these fields fall back to the calm scene for the event and no travel step. Bump `PROTOCOL_VERSION` only if the room state shape rule in AGENTS.md asks for it (these are game state fields, not room fields). Update the secrecy test to cover both fields.

## The day report: travel, then the event

The day report timer goes from 5 s to **9 s** (`TIMERS.summary` in `shared/types.ts`).

**A day with a plain event** (or no event): when `summary` arrives, the scene plays one sequence:

1. **Travel (about 3 s).** The layers scroll at the day's pace, and the route line fills by the day's km (`lastDay.report.km`). If the caravan reached a stop (`report.reached`), the town slides in from the right and the caravan stops by it. A rest day skips this and shows camp at dawn.
2. **The event (about 4 s).** The scene for the day's card (below). It ends in the state the day left behind: a lost camel is gone, a hurt traveller is now riding, robbers have ridden out of frame.
3. **Settle (about 2 s).** Back to walking, or to camp.

Health changes that were not caused by the event (`report` minus `eventOutcome`: risk rolls, rest healing, doses) show in step 3: that traveller slows or climbs onto a camel. A death shows as that traveller fading out, with nothing else. Any change should be clear, never upsetting to look at.

When every player taps **Next** early, the sequence jumps to its last frame and the game moves on, as today. A player who reloads mid-report sees the end state, not the sequence again (`props.snapshot`).

**A choice day.** Travel plays once, at the start of `choice`, and not again in `summary`:
- `choice` (20 s): the travel step from `today` (about 3 s), then the card's situation as a loop, for example robbers waiting on a hill. Camp or walking comes from `today.plan.rest`.
- `summary` (9 s): the result scene for the picked option (about 5 s, using `eventOutcome`, with `lucky` choosing the good or bad version), then settle.

**The DOM and the scene.** By the time `summary` or `choice` arrives, the public `at`, `leg`, stock and health already show the state after travel. The DOM shows those numbers at once, as today, and does not rewind. The scene starts the travel step from the day's start (worked out from `report.km` and `report.reached`) and catches up to the DOM in about 3 s. Only the scene is ever "behind", and only for those seconds.

## Event scenes

About 13 scenes. Each card names its scene in the pack (a new optional `scene` field on `EventCard`, and on each option of a choice card for the result). A card with no `scene`, or one the client does not know, gets `calm`. So a new card never breaks the scene.

| Scene id | What happens on screen | Cards (examples) |
|---|---|---|
| `storm` | Sand or wind blows across the frame. The caravan crouches behind the camels. Then it clears. | desert-2-storm, any-1-wind |
| `robbers` | Riders come in fast from one side, circle the camels, a pack goes with them, they ride out. | any-2-raiders, plain-2-raiders |
| `fire` | Flames and smoke in the camp or the grass, then black ground and less in the packs. | any-2-fire, plain-2-fire |
| `water` | The river rises over the ground layer, or a wave knocks a traveller down, then it falls back. | river-2-flood, river-2-swept, river-1-high |
| `rocks` | Rocks roll down onto the path. The caravan stops, clears them, goes on. | mountain-1-rockfall, mountain-2-slide |
| `camel-trouble` | A camel slips or sinks, and the others pull it out (or it is gone, if `animals` dropped). | mountain-2-ledge, river-1-mud |
| `sick` | A traveller sits down or lies by the fire. Others gather round. | any-2-fever, any-1-cold, desert-2-sun, plain-1-flies, mountain-1-cold |
| `visitor` | Someone walks up from the right, a small exchange, they walk off. | any-0-farmer, mountain-0-shepherd, any-0-letter, plain-0-fire |
| `water-found` | A spring or a well glints. The travellers fill the water bags. | any-0-spring, desert-0-well, river-0-fresh |
| `turn-back` | The caravan stops, turns around, walks back a little, turns again. | plain-1-wrong, any-1-ropes, desert-1-soft |
| `thief` | Night. A shadow slips past the camp and away. | any-1-thief |
| `leak` | A water bag drips a trail behind a camel. A traveller sees it and ties it. | desert-1-dry |
| `calm` | Birds, a clear sky, the camels trot a little. | any-0-quiet, desert-0-night, mountain-0-view, plain-0-grass, river-0-shallow |

The 18 choice cards each get a situation scene and a result scene for each option, picked from the same list. Most fit. The builder may add a scene or two if a choice card truly fits none, and should note which cards drove it.

A scene must not show anything the day's public report does not. It plays what happened (the `report` deltas and `healthChanges`). For the Guide's swapped event and the Lookout's swapped choice, it shows the card that was actually played.

**Who is hurt:** `healthChanges` names the travellers. The scene uses that traveller's sprite, so the table sees whose traveller got sick. The day report already says this in words, so it is not a new reveal.

## Where it lives

- `games/long-trail/client/scene/`: the canvas scene (loop, layers, caravan, scenes), split so each event scene is a small file or function with one job.
- `games/long-trail/client/assets/`: the Kenney backdrop pieces we use (only those, not the whole pack), our own sprites, and `LICENSES.md`.
- `games/long-trail/shared/packs/trade-route.ts`: a `scene` on each card.
- `shared/pack.ts`: the `scene` field type. Art sets are chosen per setting pack, so Monsoon and Space Convoy can bring their own later.
- `shared/recap.ts`, `shared/types.ts`, `server/game.ts`, `server/views.ts`: `eventOutcome` and `today` (see What the server must add).
- `packages/ui/src/faces.ts`: export the avatar colour, so a traveller sprite matches its player. This is shared code, so it lands on `master`.
- `view.ts`: the scene band replaces the dot strip. The thin route line and the "where" line stay under it as DOM, since screen readers use them.

## Accessibility

- The canvas is `aria-hidden`. Everything it shows is already in text: the "where" line, the party list, the stock and the day report. Nothing is only in the scene.
- Reduced motion: still frames, as in Constraints.
- No flashing faster than 3 times a second. Fire and storm flicker stay slow.

## Tests and checks

- Every card in every pack has a `scene` that the client knows, and every choice option has one (a test in `games/long-trail/test/`).
- The scene module takes only public state. A test checks that nothing in `client/scene/` imports or reads the private state type.
- The scene state (who is drawn, which speed, which terrain, which sequence) is worked out by a pure function from public state, separate from drawing. That function is unit tested: dead and left travellers not drawn, the camel count, rest gives camp, a fork shows two alike paths, a snapshot gives the end state.
- `docs/games/long-trail.md`: the day report is 9 s in "How it plays" step 6 and in the timers line under Settings. "On your screen" describes the scene instead of the line of stops.
- A manual check on a real phone, or a throttled mobile profile, in the browser: smooth while typing in the plan form, the loop stops when the tab is hidden.

## Calls made (not asked of the user)

- The server adds `eventOutcome` and `today` as public fields, rather than the client guessing from day totals. Guessing would sometimes act out a theft that was really a trade, or a camel loss that was really tiredness.
- On a choice day, travel plays once at the start of `choice`, and the result plays in `summary`.
- The DOM never rewinds. Only the scene plays catch-up for about 3 s.
- Dead travellers fade out and are not drawn. No graves, to stay clear of the classic game.
- A 13th scene, `leak`, for desert-1-dry, which fit none of the others.
- Kenney Background Elements Redux for the backdrop. Our own flat sprites for everything alive.

## Left to the builder

- Exact art style within "flat, Kenney-like", plus colours, sizes and timings.
- Whether our sprites are SVG files or drawn in code.
- How the scene picks a frame rate (30 fps is enough) and handles device pixel ratio.
- Which choice cards get which situation and result scenes.
- Whether the band is 140 or 160px tall, within the ratio.
