# SDD ledger — plan: docs/superpowers/plans/2026-11-14-long-trail.md
Spec: docs/superpowers/specs/2026-11-14-long-trail-design.md
Branch: master (user's durable convention: commit on master, push after each commit). Implementers commit only; controller pushes after each task's review is clean.

## Pre-flight scan
| Rows | Produces vs consumes | Finding |
|---|---|---|
| T1↔T2 | T1 types (Goal, Supply, SettingId, Length, JobId, Grade) → T2 pack | ok |
| T1↔T2/T3 numbers.ts | T1 empty N; T2 pack test uses N.kmPerDay.steady; T3 fills N | CONFLICT → R1 |
| T2↔T3 | Leg, RouteDef, SettingPack → Caravan/travelDay | ok |
| T3↔T4 | Caravan, DayReport, Perks → applyEffect/resolveEvent/jobInfo | ok |
| T3/T4↔T5 | Caravan, DayReport.healthChanges → EndView/DayLog | ok |
| T5↔T7 | scoring tests vs grade thresholds T7 may retune | CONFLICT → R2 |
| T3↔T7 | travel tests vs N values T7 retunes | CONFLICT → R2 |
| T2↔T7 | pack.test structural asserts vs T7 retune of km/stock | ok if T7 keeps structure (deadline-3 check may need km tweaks; allowed) |
| T1–T6↔T6 | all shared fns → server | ok |
| T6↔T8 | public/private state shapes → view; planProblem shared | ok |
| T6 game-core | new STAT_KEY noGoVotes + award | ok |
| T1 self | tests vs code | ok |
| T2 self | ok after R1 |
| T3 self | Trader 9/11 floor/ceil consistent | ok |
| T4 self | ok |
| T5 self | gradeOf asserts use TradeRoute thresholds (100/200/350) | → R2 |
| T6 self | stall bound (deadline+1)*6+3 | ok |
| T7 self | tunes numbers only | ok |
| T8 self | manual play check | ok |
| T9 self | ok |

Ruling R1: Task 2 adds `kmPerDay` (slow 20, steady 30, hard 40) to N in numbers.ts; Task 3 adds the rest — pack test needs it before T3 — cost if wrong: trivial move.
Ruling R2: Unit tests in T3/T4/T5 use test fixtures (a test route/pack and explicit numbers), not the live tradeRoute/N values, wherever T7 could retune them — so T7 tuning can't break unit tests — cost if wrong: T7 edits a few asserts.
Ruling R3: Untracked junk sits in the repo root (client_secret json, kenney zips, specs). Implementers `git add` only their own files, never `-A` or `.` — cost if wrong: leaking a secret into git.

## Tasks
Task 1: dispatched (base 9af0991, implementer a95bef09eecda7d44, sonnet)
Task 1: complete (commits 9af0991..239d897, review clean; minors: rules-text 'comes up' idiom → fix in Task 9 docs pass)
Task 2: dispatched (base 239d897, implementer a912637cae4c2d3dc, sonnet)
Ruling R4: Short can't hit 40–60% markets on 3 interior stops; accept floor(0.4n)..ceil(0.6n) — spec says 'about half' — cost: none
Task 2: review approved (7bf14ff); minors 1,2,4,5,9 + test gaps sent back to implementer as polish round. Parked for Task 7: lost-camel option dominance, safe-path slack (Epic 30/32), coins-60 trivial goal. Full-suite failures: flaky timeouts (pass-the-bomb random games), 2nd run clean.
Task 2: complete (commits 239d897..508fec1, review clean + polish round checked by controller: 27/27)
Task 3: dispatched (base 508fec1, implementer a1de0f85da552b867, sonnet). Ruling R5: shared roll(p, randomInt) = randomInt(1000) < round(p*1000), exported from travel.ts for Task 4 — cost if wrong: small refactor
Task 3 rulings: R6 day counter always increments, arrivedDay field, arrived=arrivedDay<=deadline; R7 planProblem uses net coins incl sales + trader via shared price helper; R8 DayReport.perksUsed; accepted: supply prices via pack route, sick point for <Well. Sent to implementer as fix round 0 (pre-review).
Task 3 review (c600997): approved, but ⚠️ supplyPrice cross-route lookup confirmed REAL (tel-orrin market only on epic) → fix round 1 sent to implementer with test hardening + fatigue pin.
Task 3: complete (commits 508fec1..029b0df, review clean after fix round 1; controller re-checked fix diff, 66/66). applyTrades signature now (c, route, trades, traderLeads).
Task 4: dispatched (base 029b0df, implementer a5c233375f86f4c76, sonnet). Rulings R9: weighted draw over severities present; km effects bounded by leg km, no-op when halted; Scout zeroes km; risk fn exported from travel.ts for healer info.
Task 4 report accepted calls: resolveChoice added (Task 6 must call it); reroll/swap draw same type; safe fork danger capped 0..1; look-ahead includes current stop; healer info ignores perks; CACHE_FOOD applied in Task 6.
Task 4 review (a12fadb): approved; fix round sent for Scout spent-for-nothing, healer plan.fork, filler test. Note for Task 6: reroll uses card severity as danger (accepted); resolveChoice must be called for choice outcomes.
Task 4: complete (commits 029b0df..0026e9c, review clean + fix round checked by controller)
Task 5: dispatched (base 0026e9c, implementer ac6833677d7c5e697, sonnet). Rulings R10: wealth at end-stop price; arrive-by ceil(share*deadline); visit = single-branch stop; goal deck reuse when short.
Task 5 review (704de94): approved; follow-up sent (proposal.plan in DayLog, gains in result, goal copies, strict tests). Coins goal = raw coins: accepted (goal text 'arrive with coins'). Task 6 must fill EndView.endPrices and DayLog.proposals[].plan.
Task 5: complete (commits 0026e9c..60cc955, review clean + follow-up checked: 131/131)
Task 6: dispatched (base 60cc955, implementer ab9cfc4462bdea288, opus). Rulings R11: leg start after passed plan; perks reset per leg from report.perksUsed; event kind on halted/rest day = last leg kind; food bands floor(stock/daily use); interrupted headline 'The game ended early.'; recap without names (client maps ids).
Task 6 report: accepted no event on arrival/all-dead day. game.ts 782 lines → split projections/parsing to server/views.ts in fix round.
Task 6 review (eb5f290): Needs fixes. Fix round 1 dispatched: removed-in-reveal leader (Important), missing Skip-every-phase test, file split (pre-review ruling).
Ruling: public `fired` stays — jobs are public and the effect is visible in the day report; "arming never public" means before it fires — cost if wrong: drop one field.
⚠️ QM double-fire checked: events.ts never touches quartermaster; only game.ts:237 — not real.
Task 6: minor (deferred): removal into recap mid-choice/vote drops draft day log
Task 6: minor (deferred): food band reads "plenty" at 0 stock when per-day use is 0 (none rations / nobody alive)
Task 6: minor (deferred): weak other-player Guide armed leak check in test
Task 6: minor (deferred): openPlan computed twice per projection
Task 6: minor (deferred): first full pnpm test run had 5 uncaptured failures; reruns clean — verify in final review
Task 6: fix round 1/5 (3 addressed, 0 open; commits eb5f290..0453a1c)
Task 6: minor (deferred): public leader during reveal is placeholder seat 0 — client must not show a leader in reveal (carry to Task 8)
Task 6: complete (commits 60cc955..0453a1c, review clean after round 1)
Task 7: dispatched (base 0453a1c, implementer a65883d8908af6a44, opus). Carries Task 2 parked balance items + Task 6 8p-Short starvation note. Deadlines fixed 12/20/32.
Task 7 review (c90e906): approved on brief; Important "economy hollows out trade" + Epic slack.
Ruling R12: overrides plan's bot buy policy — sensible buys to next MARKET +2 days; start stock ~1–2 legs; start coins/cargo fixed (not per-n); grades relative to start wealth W0 (fair ≥ W0, rich ~1.5W0, legendary ~2.2W0); new asserted sensible-no-trade bot (≥0.25 lower fair+ share) and careless fair+ ≤ 0.35; Epic safe path ~27–28/32 — why: spec option A (wealth grade) is the point of Trade Route — cost if wrong: one more tuning pass.
Task 7: fix round 1/5 dispatched
Task 7: minor (deferred): console.table hidden under default reporter; Normal near 0.80 cap
Task 7: fix round 1/5 (economy addressed partially; commit 213e84b) — controller found degenerate "buy silk, sell at end" strategy, coins 800 vs supplies 1–2, legendary unreachable.
Ruling R13: round 2 — goods spread across towns incl. mid-route, coins scarce vs supplies, smarter sensible trading, assert legendary in [0.02,0.15] and ≥30% games sell mid-route — why: spec wants market arguments, not one dominant move — cost if wrong: one more tuning pass.
Task 7: fix round 2/5 dispatched
