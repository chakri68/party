# Long Trail: handover (2026-11-15)

Picking this up on another machine. Everything you need is in git; this file is the map.

## What it is

Long Trail (`games/long-trail`) is a 3–8 player trail game on the room runtime. The whole table rides one shared caravan. Each day one player leads, plans the day and the table votes on it. Every player has a public job with private info and a secret goal. Settings come as data packs, and Trade Route ships first: markets, goods, and a caravan grade based on wealth at arrival.

- Spec: `docs/superpowers/specs/2026-11-14-long-trail-design.md`
- Plan (9 tasks): `docs/superpowers/plans/2026-11-14-long-trail.md`
- Ledger, with every ruling and deferred minor: `docs/superpowers/handover/2026-11-14-long-trail-sdd-ledger.md`
- Implementer reports (exact signatures and state shapes): `docs/superpowers/handover/long-trail-reports/task-N-report.md`

Built with subagent-driven development: each task got a fresh implementer, then a review, then fix rounds. All on master, pushed after each clean task.

## Status

| Task | What | State |
|---|---|---|
| 1 | Package, settings, manifest | done (`239d897`) |
| 2 | Setting pack + Trade Route data | done (`7bf14ff`, `508fec1`) |
| 3 | Travel, markets, health | done (`4c02b5b`..`029b0df`) |
| 4 | Events, abilities, job info | done (`a12fadb`, `0026e9c`) |
| 5 | Goals, scoring, recap | done (`704de94`, `60cc955`) |
| 6 | Server game + "Hardest to convince" award, registered in `apps/server` | done (`eb5f290`, `0453a1c`) |
| 7 | Balance check + tuning | **in progress: fix round 2 of 5** |
| 8 | Client view + `apps/web` registration | not started |
| 9 | Player docs | not started |

At HEAD the suite is green: `pnpm vitest run games/long-trail` passes 164/164, and typecheck is clean. The game is registered on the server but not in the web client yet, so it won't show in the lobby.

## Task 7: where it stopped

`213e84b` (round 1) passes every band. Its economy has one dominant move, though: buy silk anywhere at 5–8, then sell it at the end (Mirren Gate) for 36–44. Start coins are 800 against supplies at 1–2, so coins never compete with water, and legendary can't be reached. The spec wants markets to start arguments, so round 2 was dispatched (ledger ruling R13):

1. Spread the goods. Each good is cheap at some towns and dear at others, mid-route included. The end pays well but isn't a 5× jackpot. The best good should change from game to game.
2. Make coins scarce compared with supply prices. Start wealth W0 stays fixed (not scaled by player count), and grades sit at about 1.03 / 1.5 / 2.2 × W0.
3. Sensible bot: at each market, sell any good priced above its pack-wide range middle. Then buy the good with the best expected margin: the best mid-range sell price at any market still ahead on the safe path, minus the price here. Fill up to capacity and keep a supply reserve.
4. New checks per length: sensible legendary in [0.02, 0.15], and at least 30% of sensible games sell a good before the end stop.
5. Keep every existing band. The balance file must run under 20 s on its own (it was 18.8 s).

**Unfinished work** is saved as `docs/superpowers/handover/2026-11-15-long-trail-task7-round2-wip.patch`. It holds the new bot trading logic in `test/balance.test.ts` and a scratch sweep tool, `test/zz-sweep.test.ts`. That tool only runs with `SWEEP=<config.json>` and must be deleted before committing. No pack numbers were changed yet, so with the patch applied the balance test fails (`short sensible legendary: expected 0 to be >= 0.02`). That's expected.

To resume:

```sh
git apply docs/superpowers/handover/2026-11-15-long-trail-task7-round2-wip.patch
pnpm vitest run games/long-trail/test/balance.test.ts --reporter=verbose   # prints the table
```

Then retune the numbers only in `games/long-trail/shared/packs/trade-route.ts`, plus `shared/numbers.ts` if needed, until every band passes. Delete `zz-sweep.test.ts` and commit as `Long Trail: trade routes with real choices`. Rule from the brief: numbers and bot policy only, no rule changes. If you can't hit the bands with numbers alone, stop and decide which rule to change.

After that, Task 7 needs one more re-review of the economy (fix rounds used: 2 of 5).

## Next: Tasks 8 and 9

Briefs are the plan's Task 8 and Task 9 sections. Notes for Task 8:
- State shapes (public, private, events) are in `long-trail-reports/task-6-report.md`.
- During `reveal`, the public `leader` is a placeholder (seat 0). Don't show a leader in the reveal.
- Use `planProblem` from `shared/travel.ts` client-side to disable Propose, with the same text the server gives. Its signature takes `{ healerAlive, traderLeads }`.
- The recap holds player ids, not names. Map them to seat names in the view.
- UI follows the shell's Ink & Lime theme (`apps/web/src/style.css`). Ignore `ui_theme.md` at the repo root. Check phone (390×844) and 1280×720.
- Play a real room with `pnpm dev` and `/#owner=dev` plus 2 tabs, Short length, all the way to the recap.

Task 9 copy rules: short plain sentences, no idioms, no emoji. Also fix the rules-text idiom "an event comes up" in `shared/rules-text.ts`, which was deferred from Task 1.

## Then: final whole-branch review

When 7–9 are done, run one whole-branch review of `9af0991..HEAD` on the most capable model. Point it at the deferred minors in the ledger. The ones worth fixing before calling it shipped:
- Removal into recap mid-choice or mid-vote drops that day's draft log entry (`server/game.ts`).
- The food band reads "plenty" at 0 stock when per-day use is 0 (`server/views.ts` `band`).
- The other-player Guide-armed leak check in a secrecy test is weak.
- The full `pnpm test` has a load-flaky pass-the-bomb random-games timeout. Confirm nothing else flakes.

## Rulings that bind later work (from the ledger)

- **Day counter:** `c.day` is the day about to be played. `travelDay` always increments it. `arrivedDay` records arrival, and arriving on `day === deadline` counts.
- **Shared helpers:** pricing for plans and trades goes through one helper and always reads the **active route** (one stop id can have a market on one length and not another). `roll(p, randomInt)` is the only chance helper.
- **Abilities:** jobs are public and ability info is private. Arming is private. `fired` in public state is fine after an ability fires. The Scout is spent only when it actually saves km.
- **Leader:** the first leader is picked when the reveal ends, among players still in. Plans always skip seats that have left.
- **Unit tests** use fixtures (`test/fixtures.ts`), never live pack numbers, so tuning can't break them.

## Repo housekeeping

- Convention: commit on master and push after each commit (no branches). `product` merges master one way.
- Never `git add -A` or `git add .`. The repo root holds untracked things that must not be committed: a Google `client_secret_*.json`, the Kenney asset zips, draft specs, and `apps/product-server/` (product-only). Copy those to the new machine by hand if you need them. They aren't in git.
- The `.superpowers/` folder is git-ignored scratch. Its useful contents (ledger, reports) are copied here.
