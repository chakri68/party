# CouchParty: the party-games site as a product

**Status:** spec, approved in brainstorm · **Date:** 2026-11-11
**Branch:** `product` (cut from `master`) · **Domain:** couchpartygames.com

party-games.chakri.me stays exactly what it is: invite-only, owner key, my friends. CouchParty is the same games with the door open, a real landing page, and a Host Pass for the heavy stuff. It's a layer on top, not a fork that drifts.

---

## 1. Ground rules

- **One-way merges.** `product` regularly merges `master`. Never the other way.
- **Additive.** Product code lives in new places (`apps/product-*`, `packages/accounts`, product Worker entry). Shared files (`apps/server`, `apps/web`, `games/*`) get small hook-points only.
- **Hook-points land on master too.** Master plugs in today's behaviour, so its tests pass unchanged and both branches share the same seams. That's what keeps merges boring.
- **Separate deploy.** Own Worker, own Durable Object namespace, own D1, own R2 bucket. No shared state with the personal site. The Godot uploader pushes to both buckets.
- **Spend where users look.** Backstage goes cheap (Cloudflare built-ins, free tiers). Anything a user sees or touches (checkout, sign-in email, landing page) gets the good option.

## 2. Free vs Host Pass

| Free (anyone, no account) | Host Pass (host signs in) |
|---|---|
| Cards, Dice, Words and drawing, Hidden roles: ~20 games | Blind Rally, Rally, Treasure Hunt, Frontier (the long strategy game) |
| Rooms up to ~8 players | Up to 16 where the game supports it |
| Default word and prompt packs | Custom packs: write, save, reuse |
| | Saved history, friend-group leaderboard |
| | Cosmetics: room themes, extra emotes, character skins |

- **The host's tier covers the whole room.** Players never pay, never sign up.
- Premium games are the R2-heavy ones, so the paywall tracks what actually costs money.
- **Tier is locked into the room at creation** (and can only go up). A day pass expiring mid-game doesn't kill the game.

### Plans

Day pass (24 h, one-off), Monthly, Yearly. Placeholder prices, tune later:

| | Day | Month | Year |
|---|---|---|---|
| India (Razorpay, INR) | ₹49 | ₹149 | ₹999 |
| Global (Paddle, USD) | none | $4.99 | $39 |

No dollar day pass: Paddle charges 5% + 50c per sale, which would take about 30% of $1.99 (and Paddle prices sub-$10 products case by case). Decided 2026-11-12.

### Comps (the friends-and-family override)

Same mechanism as paid premium, different `source`:

- **Comp codes** like `CHAKRI-FAM-7Q2X`. Each has a duration (N days or forever), a use limit, and can be revoked. Revoking ends every entitlement redeemed from it.
- **Direct grant** via admin CLI: `pnpm admin grant <email> --forever`, `pnpm admin code new --uses 20 --days 30`, `pnpm admin code revoke <code>`.
- Comps never touch a payment provider and never count as revenue.

## 3. Architecture

```
couchpartygames.com ──▶ product Worker (new entry, wraps the existing one)
                         ├─ /              landing (static)
                         ├─ /pricing /account /terms /privacy
                         ├─ /play, /room/:code   existing shell + thin product header
                         ├─ /api/auth/*     magic link + Google
                         ├─ /api/billing/*  checkout + Razorpay/Paddle webhooks
                         ├─ /api/admin/*    comps and grants (admin key only)
                         ├─ /api/rooms ──▶  HostPolicy.canCreate → Room DO
                         └─ /room/* ws ──▶  existing Room Durable Object
                         D1: users, sessions, entitlements, comp_codes, packs, history
                         R2: product bucket (Godot exports gated by room tier)
```

### Pieces

| Concern | Pick | Why |
|---|---|---|
| Data | Cloudflare D1 | Already on Cloudflare, free tier covers it, point-in-time restore built in |
| Auth | Magic link + Google, hand-rolled; HttpOnly session cookie backed by a D1 row | No passwords to store. Small enough to own. Check Better Auth's D1 support before writing it |
| Sign-in email | Resend | User-facing: a magic link in spam is a broken sign-in |
| Payments, India | Razorpay (UPI, cards; one-off + subscriptions) | UPI is how a ₹49 day pass gets paid |
| Payments, global | Paddle (merchant of record) | They handle VAT/GST/sales tax worldwide |
| Bot check | Cloudflare Turnstile | Free, mostly invisible |
| Server logs/metrics | Workers Logs + Analytics Engine | Built in |
| Landing analytics | Cloudflare Web Analytics | Free, no cookies, no banner |
| Client errors | Sentry free tier | 5k errors/mo is plenty early |
| Domain | couchpartygames.com via Cloudflare Registrar (optional `couchparty.in` redirect) | At-cost pricing, no renewal trap, `.com` trust helps email deliverability |

### Entitlements

One table, one reader.

```
entitlements(id, user_id, source, plan, starts_at, ends_at, ref, revoked_at)
  source ∈ razorpay | paddle | comp | grant
  ref    = provider payment/subscription id, or comp code id
```

`tierFor(userId, now) → "free" | "pass"`: any non-revoked row with `starts_at ≤ now < ends_at` (or `ends_at` null for forever). Nothing else in the code knows where premium came from.

### Billing flow

- **Routing.** `CF-IPCountry = IN` → Razorpay, ₹. Everyone else → Paddle, $. A "pay in another currency" link for the edge cases.
- **Webhooks are the truth.** The success redirect grants nothing; the account page waits for the webhook to land. Both webhooks verify signatures (Razorpay HMAC, Paddle signature) and are idempotent on `ref`.
- **Renewals** extend `ends_at`. **Cancel** leaves `ends_at` at the period end. **Refund** sets `revoked_at` now.

## 4. Hook-points (land on master and product)

Master keeps its behaviour by plugging in the current logic.

| Where | Today | Becomes |
|---|---|---|
| `apps/server/src/index.ts` `POST /api/rooms` | owner key in `Authorization` | `HostPolicy.canCreate(request, env) → { ok, tier, hostToken } \| deny` |
| `apps/server/src/runtime.ts` `RoomHost` | `isOwnerKey`, `ownerRequired` | `seatIsHost(joinMsg)`, `roomTier()`; `canStart` = host seat connected |
| `gamesFor({ blindRally, treasureHunt })` | env flags hide games | plus a per-room filter: free rooms show premium games **locked**, not hidden |
| Room DO | nothing | `upgrade(tier)` RPC so a mid-lobby purchase upgrades in place |
| Godot serving | env flag per game | also checks room tier on product |
| Manifests | names fixed | product-side name-override map (manifest name, rules title, docs page) |

- **Master `HostPolicy`:** owner key, tier always `pass`, owner seat is host. Byte-for-byte the same behaviour as now.
- **Product `HostPolicy`:** anyone may create (Turnstile + rate limit for free). Signed-in host → `tierFor`. The creator's seat token marks the host.

## 5. Landing and host flow

### Pages

- `/` landing (static, outside the shell, fast and indexable)
  1. Hero: "Party games for your group chat." **Start a room**. Short looping clip of phones mid-game.
  2. How it works: start a room → drop the link in the chat → everyone plays on their phone.
  3. Game gallery from the manifests (section, player count, 🔒 Host Pass tag). New games on master show up on their own.
  4. Host Pass: what it unlocks, day/month/year prices by country.
  5. FAQ, footer.
- `/pricing`, `/account` (plan, redeem code, saved packs, delete account), `/terms`, `/privacy`.
- `/play`, `/room/:code`: the existing shell, plus a thin header (sign-in state, Host Pass badge).
- Copy follows the site rule: short plain sentences, basic words.

### Host flow

```
Start a room ──▶ free room, no account (Turnstile)
    │              └─ picks a premium game ──▶ "This needs Host Pass" sheet
    │                                            ├─ Sign in (Google / email link)
    │                                            ├─ Have a code?
    │                                            └─ Buy (day / month / year)
    └─ signed in with Host Pass ──▶ premium room: all games, 16 seats
```

- Players: open link, type a name, play. Unchanged.
- Buying or redeeming while the lobby is open calls `upgrade` on the room. Nobody rejoins.

## 6. Renames (product only, via the override map)

| Master | Product | Why |
|---|---|---|
| Dominion | **Frontier** | Trademarked board-game name |
| Scribbl | **Doodle Dash** | Too close to skribbl.io, a direct competitor |
| Nightfall | keep for now | Low risk; an unrelated deckbuilder shares it. Revisit if it ever matters |

## 7. Abuse, safety, legal

- **Room spam:** Turnstile on free create, per-IP rate limit on `/api/rooms`, cap on concurrent free rooms (global and per IP). Premium skips Turnstile.
- **Free text** (names, chat, guesses, Fake Word answers): basic profanity filter on names and chat, host-toggleable. Drawings can't be filtered; the existing host kick covers it.
- **Data held:** host email, plan, comp redemptions, packs, history. Players: nothing. Rooms still vanish.
- **Legal:** Terms (13+, conduct, refunds per provider), Privacy (India DPDP + GDPR), account delete that actually deletes. Paddle covers global tax. Razorpay/GST: check with a CA once there's revenue; Phase 1 has none.

## 8. Rollout

**Phase 1: open, free, comps.** Product Worker + D1 + R2 on couchpartygames.com. HostPolicy hooks, accounts, entitlements, comps, admin CLI, landing, renames, abuse controls. Premium is reachable only by comp. Watch whether hosts come back, which premium games get played, whether packs get used.

**Phase 2: billing.** Razorpay + Paddle in sandbox, then live, once repeat hosts show up. Plugs into the existing entitlements table; no other system changes.

Packs, history and cosmetics can trail Phase 1. They're Host Pass perks, not launch blockers.

## 9. Testing

- **Unit (vitest):** both `HostPolicy` variants; `tierFor` across every source, expiry, revoke, forever; comp redeem / use limit / expiry / revoke cascade; webhook signature verify against recorded Razorpay and Paddle payloads, including forged and replayed ones; idempotency on `ref`.
- **Integration:** `wrangler dev` with local D1. Free host → premium game locked → redeem code → room upgrades in place → premium game starts.
- **Master safety net:** the full existing suite passes unchanged after the hook-points land on master. That's the proof master didn't move.

## 10. Out of scope

- Native apps, ads, a pack marketplace, team/enterprise features.
- Migrating personal-site users or rooms (there are none to migrate).
- Buying `couchparty.com`. Revisit if it takes off.
