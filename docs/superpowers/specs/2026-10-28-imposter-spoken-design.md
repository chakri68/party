# Imposter `spoken` mode: design

Part 2 of the social deduction roadmap (`2026-10-28-social-deduction-design.md`). Source: the roadmap's Spyfall ruling, `social-deduction-spec.md` §6 for intent only, and the controller's rulings in `.superpowers/sdd/sd-games/imposter-spoken-brief.md`. An upgrade of `games/imposter` (`2026-10-27-imposter-design.md`); everything that doc says still holds for the default mode, now called `clues`.

## The mode

Same table, same Imposter, same scoring. Instead of a word and typed clues, everyone but the Imposter is told a *place*. Nobody types: the table talks out loud for a few minutes, asking each other questions that only someone who's been there could answer. The full list of places is on every screen, so the Imposter is listening for which one fits. Then the usual vote, runoff and reveal; a caught Imposter guesses the place by tapping it on the list.

The Imposter has one extra move. Once per round, during the talk, they can press "I know where we are": the clock stops and they pick a place. Right, they take the round. Wrong, everyone else does. The button is on every player's screen and looks the same on all of them, so having it says nothing.

## Phases (spoken)

| Phase | Ends when | Then |
| --- | --- | --- |
| `reveal` | everyone here tapped "Got it", or 20 s | `talk` |
| `talk` | 4/6/8 min (host's pick), the host says vote, or the Imposter calls it | `vote`, or `guess` when called |
| `vote` | as in clues mode | `runoff` / `reveal-role` / `round-result` |
| `runoff` | as in clues mode | `reveal-role` |
| `reveal-role` | 5 s | caught: `guess`; else `round-result` |
| `guess` | the Imposter picks a place, or 30 s | `round-result` |
| `round-result` | 10 s, or the host says next | next round, or `finished` |

Clues mode is untouched: `reveal` → `clues` → `discuss` → `vote` …

## State

Server, added to the round: `placeId` (empty in clues mode; `word` holds the place's display name, so every existing reveal path carries it), `firstAsker`, and `early` (the Imposter called it from `talk`). Settings gain optional `mode` and `talkMinutes`.

Public, added: `mode`, `firstAsker` (from `talk` on), `early`. Category is empty in spoken mode. No place name is in public state before `round-result`: the list ships in `shared/places.ts`, not in state, so a leak check on the dealt place's name or id means something.

Private: unchanged. An innocent's `word` is the place name; the Imposter's is null.

## Actions

- `call`: the Imposter, in `talk`, before the deadline. Opens `guess`. From anyone else: rejected `not-yours`.
- `guess-place {placeId}`: the Imposter, in `guess`, spoken mode. Any id from the pack.
- `next` (host): also cuts `talk` short, straight to the vote.
- `clue` and text `guess` are rejected `wrong-mode` in spoken mode; `call` and `guess-place` likewise in clues mode.

## Settings

`mode` clues/spoken (default clues), `rounds` 3/5/7, then the second row is "Talking time": 30/60/90 s in clues mode, 4/6/8 min (default 6) in spoken. The mode row goes third, after the two rows the existing lobby and tests already know.

## Rulings

1. **The pack ships in `shared/`.** The brief allows it, and it's the only placement that lets a test treat the dealt place's name as a secret: a public list in state would contain every name. Which place was dealt never leaves the server before `round-result`.
2. **41 places**, each an id and a display name, picked so a question can split any two ("overnight sleeper train", "ferry crossing", "airport security queue" are three different answers to "how long are you here for?"). A test checks 35+, unique ids and names, and id/name shape.
3. **Settings fields are optional** (`mode?`, `talkMinutes?`): absent means clues and 6 minutes. `parseSettings` only echoes a new key when the input had one. Old settings, old tests and old rematches keep their exact shape.
4. **`call` is shown to everyone, gated twice.** First tap arms it ("Tap again to stop the clock"), on every screen. Second tap: the Imposter's client sends `call`; anyone else's shows a private "You're not the Imposter" and sends nothing. The server still rejects a `call` from a non-Imposter. The arm step is the spec's "avoid accidental taps".
5. **Calling it keeps the Imposter anonymous until the result.** The public event is a bare `early-guess`, `accusedId` stays null, and the awaited list during an early guess is empty: the runtime shows awaited players, and naming the guesser would name the Imposter. The 30 s clock covers a guesser who's dropped.
6. **The Imposter leaving during an early guess** is a missed guess (as rule 6 of the base design, for the caught case). Leaving in `reveal` or `talk` drops the round, as before.
7. **A caught guess also picks from the list.** No typing in spoken mode, so no `close` consolation either.
8. **Guess time is 30 s in spoken mode**, not 20: scanning 41 names takes longer than typing one word you've been thinking about.
9. **The first asker** is uniform over everyone still in, Imposter included, drawn at round start (spoken only, so clues-mode random draws don't shift). It's advisory and survives them leaving.
10. **The host can still say "Vote now"** during `talk`, as in `discuss`. A table that's sure shouldn't wait out eight minutes.
11. **Places don't repeat** within a match or across a rematch: they go into the same `used` list as words, as `place|<id>`, carried by the existing `carryOver`. Once the pack is spent, it starts over.
12. **No occupation tags, no anytime accusations, no conversation prompts.** The roadmap leaves the first two out; prompts would dictate speech.
13. **The role card stays Imposter's own** (tap to hide/show, auto-hides on "Got it"), not `roleReveal`. It already does the job in both modes; swapping it is a retrofit the roadmap says not to do.
14. **The place list is a collapsible panel**, closed by default and identical for every role, open in `guess` for everyone. The guesser's copy is buttons; everyone else's is read-only.

## Tests

Spoken mode gets its own file: settings and lobby fields, every phase transition and timeout, the call (Imposter only, once, before the deadline), both guess paths right and wrong, scoring, ties and runoff through the shared vote, leaving in each phase, rematch carry, and `findLeaks` for the place name, the place id and the role at every phase before `round-result`, for every non-entitled seat. The existing clues tests stay as they are.
