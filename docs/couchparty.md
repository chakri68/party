# CouchParty setup

One-time setup for couchpartygames.com, then the deploy. Written for me, run from Claude Code with `!`, in order. Each step says what it does and what to paste back.

The product is its own Worker (`apps/product-server`) with its own D1 database and R2 bucket. The personal site (party-games.chakri.me, `pnpm deploy`) is a separate worker and none of this touches it.

Run everything from the repo root, on the `product` branch, logged in to the right Cloudflare account (`!pnpm --filter @games/product-server exec wrangler whoami`).

## What lives where

| Thing | What it is | Where it comes from |
| --- | --- | --- |
| `RESEND_API_KEY` | sends sign-in emails from `hello@couchpartygames.com` | Resend dashboard, API Keys |
| `GOOGLE_CLIENT_SECRET` | the "Sign in with Google" client secret | Google Cloud console, Credentials |
| `TURNSTILE_SECRET` | server side of the bot check on sign-in and room creation | Cloudflare dashboard, Turnstile |
| `ADMIN_KEY` | bearer key for `pnpm admin` (codes, grants). Make one up | `openssl rand -base64 24` |
| `IP_HASH_KEY` | HMAC key for the IP hash in room records. Without it no free room can be made | `openssl rand -base64 32` |
| `TURNSTILE_SITE_KEY` | public half of Turnstile. A var, not a secret | `wrangler.jsonc` |
| `GOOGLE_CLIENT_ID` | public half of the Google client. A var | `wrangler.jsonc` |

Secrets go in with `wrangler secret put` and never into git. The two vars go in `apps/product-server/wrangler.jsonc`.

## 1. Domain

1. Cloudflare dashboard, Domain Registration, Register Domains: buy `couchpartygames.com`. It lands in the same account, so the Worker's custom domain route in `wrangler.jsonc` can claim it. Nothing to run.

## 2. D1 and R2

2. Create the database:

   `!pnpm --filter @games/product-server exec wrangler d1 create couchparty`

   Copy the `database_id` it prints into `apps/product-server/wrangler.jsonc`, replacing `<from wrangler d1 create>`.

3. Create the bucket for the Godot exports:

   `!pnpm --filter @games/product-server exec wrangler r2 bucket create couchparty-godot`

## 3. Turnstile

4. Dashboard, Turnstile, Add widget. Hostname `couchpartygames.com`. Widget type **Invisible**. Copy the site key into `TURNSTILE_SITE_KEY` in `wrangler.jsonc`.

5. Store the secret key (it asks, paste it in):

   `!pnpm --filter @games/product-server exec wrangler secret put TURNSTILE_SECRET`

   The first `secret put` on a fresh account asks to create the Worker `couchparty`. Say yes; step 13 deploys over it.

## 4. Google sign-in

6. Google Cloud console, create a project (or reuse one). APIs and Services, OAuth consent screen: user type External, app name CouchParty, support and developer email yours, scopes `openid`, `email`, `profile` only. Publish it to production, or only test users can sign in.

7. Credentials, Create credentials, OAuth client ID, type Web application. Under Authorized redirect URIs add exactly:

   `https://couchpartygames.com/api/auth/google/callback`

   Leave JavaScript origins empty. Copy the client ID into `GOOGLE_CLIENT_ID` in `wrangler.jsonc`.

8. Store the client secret:

   `!pnpm --filter @games/product-server exec wrangler secret put GOOGLE_CLIENT_SECRET`

## 5. Resend

9. Sign up at resend.com. Domains, Add domain, `couchpartygames.com`. Resend shows the DNS records to add.

10. In Cloudflare, DNS, Records for `couchpartygames.com`, add what Resend lists, as given:
    - SPF: a TXT record (on the `send` subdomain in Resend's current layout) with `v=spf1 include:amazonses.com ~all`, plus the MX record it lists next to it.
    - DKIM: the TXT record at `resend._domainkey` with the long `p=` key.
    - DMARC: TXT at `_dmarc` with `v=DMARC1; p=none; rua=mailto:hello@couchpartygames.com`. Tighten `p=` later, once mail has flowed clean for a while.

    Set DNS-only (grey cloud) on any CNAME records. Back in Resend, press Verify. It can take a few minutes.

11. Resend, API Keys, create one with "Sending access" for this domain. Store it:

    `!pnpm --filter @games/product-server exec wrangler secret put RESEND_API_KEY`

## 6. Admin key, IP hash key and analytics

12. Make the admin key, store it, and keep a copy for `pnpm admin`:

    `!openssl rand -base64 24`

    `!pnpm --filter @games/product-server exec wrangler secret put ADMIN_KEY`

    Then in your shell profile (not in the repo): `export COUCHPARTY_ADMIN_KEY=<the same value>`.

    The IP hash key. Nobody needs a copy; changing it later only resets the per-IP room counts:

    `!openssl rand -base64 32`

    `!pnpm --filter @games/product-server exec wrangler secret put IP_HASH_KEY`

    Web Analytics: dashboard, Analytics and Logs, Web Analytics, Add a site, `couchpartygames.com`. Pick **Enable with JS Snippet installation** (the build adds the snippet; auto-inject on top would count each visit twice). The token is public, so it lives in `apps/product-web/.env.production` as `VITE_CF_BEACON`, committed. Production builds pick it up; dev has no beacon. Delete the line and the pages ship without one.

## 7. Deploy

13. Check what it will do first. This uploads nothing, skips the migration and runs `wrangler deploy --dry-run`:

    `!pnpm deploy:product --dry-run`

    Then the real one. Uploads both Godot exports to `couchparty-godot`, builds the web app, applies D1 migrations, deploys the Worker:

    `!pnpm deploy:product`

    It checks the Worker's secrets first (`IP_HASH_KEY`, `ADMIN_KEY`, `TURNSTILE_SECRET`, `RESEND_API_KEY`). If one is missing it names it and stops before anything ships; the dry run only warns.

    Reruns skip any Godot hash already in the bucket. It never sets `DEV_TOOLS`: that stays `"0"` in `wrangler.jsonc`, so a missing Resend key fails loudly instead of logging magic links.

    Secrets apply to the live Worker immediately; putting one later needs no redeploy.

14. Make the first comp code (20 uses, never expires):

    `!pnpm admin code new --uses 20 --forever --note family`

## Billing

Host Pass is paid. Razorpay takes the payment when Cloudflare's `CF-IPCountry` header is `IN`, in rupees. Paddle takes it everywhere else, as Merchant of Record, so it handles tax. Passes are one-time, not subscriptions, and they stack: a second pass starts when the first ends. After a payment the server asks the provider right away whether it went through, and grants the pass. Webhooks are the backup for when the tab closes mid-payment, and they are the only way a refund reaches us.

### Config

| Thing | Kind | What it is |
| --- | --- | --- |
| `BILLING` | var | `"1"` turns buying on. Anything else hides it |
| `RAZORPAY_KEY_ID` | var | public Razorpay key id |
| `PADDLE_ENV` | var | `sandbox` or `production` |
| `PADDLE_CLIENT_TOKEN` | var | public Paddle client-side token |
| `PADDLE_PRICE_MONTH` | var | Paddle price id, month pass |
| `PADDLE_PRICE_YEAR` | var | Paddle price id, year pass |
| `RAZORPAY_KEY_SECRET` | secret | Razorpay API secret |
| `RAZORPAY_WEBHOOK_SECRET` | secret | the secret you typed into the Razorpay webhook |
| `PADDLE_API_KEY` | secret | Paddle server API key |
| `PADDLE_WEBHOOK_SECRET` | secret | the notification destination's secret key |

Vars live in `apps/product-server/wrangler.jsonc`. Secrets go in with `wrangler secret put`. Locally, all ten go in `apps/product-server/.dev.vars`, which is git-ignored. Never commit them.

`/api/config` hides billing, so no buy buttons show, until `BILLING` is `"1"` and that provider's public values are real, not the `<set at setup>` placeholders. `pnpm deploy:product` requires the four secrets only when `BILLING` is `"1"` in `wrangler.jsonc`.

With `BILLING` at `"1"`, `pnpm deploy:product` also refuses to deploy a config that can't take real money: `PADDLE_ENV` not `production`, a `PADDLE_CLIENT_TOKEN` that doesn't start with `live_`, a `rzp_test_` Razorpay key id, or any billing var still a `<...>` placeholder. It names each problem and stops. The dry run only warns.

Always deploy with `pnpm deploy:product`. It applies D1 migrations before the Worker goes live. A plain `wrangler deploy` skips them, and without migration 0002 a signed-in `/api/me` fails.

### Webhooks

| Provider | URL | Events |
| --- | --- | --- |
| Razorpay | `https://couchpartygames.com/api/billing/razorpay/webhook` | `payment.captured`, `refund.processed` |
| Paddle | `https://couchpartygames.com/api/billing/paddle/webhook` | `transaction.completed`, `adjustment.created`, `adjustment.updated` |

A webhook that can't match a payment says why with a `console.warn` line. Read them in the Cloudflare dashboard: Workers, `couchparty`, Logs. `observability` is on in `wrangler.jsonc`, so the lines are kept.

### Refunds

By hand, in each provider's dashboard. The refund webhook ends the pass and pulls any later passes forward.

Only ever do **full** refunds. Razorpay's `refund.processed` fires for partial refunds too, and any refund ends the whole pass. A partial goodwill refund would cost the host their pass.

### Going live

1. Ship with `BILLING` at `"0"`. Nothing shows, nothing can be bought.
2. Once both accounts are approved:
   - create the live Paddle product and prices with the Paddle plugin (`paddle-live`);
   - put the live public values into `wrangler.jsonc`: `PADDLE_ENV` = `production`, the live `PADDLE_CLIENT_TOKEN` (starts with `live_`), the live `PADDLE_PRICE_MONTH` and `PADDLE_PRICE_YEAR`, and the live `RAZORPAY_KEY_ID` (starts with `rzp_live_`). The deploy stops if any of these is still a sandbox or test value;
   - in Paddle, get the domain `couchpartygames.com` approved (Checkout, Website approval), and set a default payment link (Checkout, Checkout settings). Live checkout does not open without both;
   - in Razorpay, set Account & Settings, Payment capture, to automatic and immediate, in live mode. Otherwise payments stay authorized, no pass is granted, and Razorpay refunds them later by itself;
   - set the four secrets with `wrangler secret put`;
   - register both webhooks at the live URLs above.
3. Set `BILLING` to `"1"` and `!pnpm deploy:product`. Then check both providers:
   - Razorpay: from India, buy a real Rs 49 day pass, refund it from the dashboard, and check the pass goes away;
   - Paddle: from outside India (or on a VPN), buy a $4.99 month pass, refund it in Paddle, and check the pass goes away.
4. Regenerate the Razorpay test key secret once billing works. The old one was shared in a chat.

### Testing locally

`pnpm dev` in `apps/product-server` turns `BILLING` on locally. To force Razorpay, send `CF-IPCountry: IN`: in Chrome DevTools, Network conditions or an extra-headers override. Without it you get Paddle.

In Razorpay's test mode, set Account & Settings, Payment capture, to automatic and immediate, same as live. Otherwise test payments stay authorized and no pass is granted.

For webhooks, run `cloudflared tunnel --url http://localhost:8788`. Register the tunnel URL (plus the webhook paths above) in Razorpay's test dashboard, and as a Paddle sandbox notification destination. Put the secrets it gives you in `.dev.vars` and restart `wrangler dev`.

## Smoke checklist

On the live site, phone and laptop:

- [ ] `https://couchpartygames.com` loads: landing, pricing, privacy, terms.
- [ ] `/play` creates a free room, with no sign-in.
- [ ] A second phone joins with the code or link.
- [ ] Picking a locked game (Blind Rally, Rally, Treasure Hunt, Frontier) shows the upgrade sheet instead of starting.
- [ ] Sign in by email: the magic link arrives within a minute and lands you signed in. Check spam once; if it's there, recheck the DNS records.
- [ ] Sign in with Google works.
- [ ] In the open room, tap a locked game, and redeem the comp code in the upgrade sheet. The room upgrades in place: the locked games unlock on both phones and the seat cap lifts, nobody rejoins.
- [ ] `!pnpm admin code list` shows 1 use on the code.
- [ ] Account, Delete account: signed out, signing in again makes a fresh account with no pass.

## Rollback

Code only; D1 migrations don't roll back.

`!pnpm --filter @games/product-server exec wrangler rollback`

It goes to the previous deployed version. Add a version id after `rollback` to pick one (`wrangler deployments list` shows them). The static assets roll back with the version. R2 uploads are content-hashed and left in place, so a rollback never leaves the old Worker without its Godot files.

## Later deploys

`!pnpm deploy:product`, never a plain `wrangler deploy`. Migrations apply only if new files are in `apps/product-server/migrations`. Secrets and DNS are done; they stay.
