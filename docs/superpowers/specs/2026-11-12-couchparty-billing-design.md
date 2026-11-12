# CouchParty: buying Host Pass

**Status:** spec, approved in brainstorm · **Date:** 2026-11-12
**Branch:** `product` · **Parent spec:** [2026-11-11-couchparty-product-design.md](2026-11-11-couchparty-product-design.md) (this is its Phase 2)

Phase 1 shipped Host Pass from comp codes only. This adds paying for it: Razorpay for India in rupees, Paddle everywhere else in dollars, one-time passes that never renew. It replaces the parent spec's "Billing flow" section where the two disagree.

---

## 1. Decisions

| Decision | Choice | Why |
|---|---|---|
| Providers | Razorpay when `CF-IPCountry = IN`, Paddle otherwise | Razorpay has UPI and 2% fees; Paddle is Merchant of Record abroad, so it owns tax |
| Plans | India: Day ₹49, Month ₹149, Year ₹999. Elsewhere: Month $4.99, Year $39 | Paddle's 5% + 50c would take ~30% of a $1.99 day pass |
| Renewal | None. Every pass is a one-time payment | Simplest to build and to explain; revisit if hosts come back |
| Who can buy | Signed-in hosts only | The pass belongs to an account |
| Buying with a pass active | Time adds on: the new pass starts when the latest active one ends | Nobody loses paid time. Applies to comp codes too |
| How a payment is trusted | Server confirms with the provider at once; webhooks grant too, as a backup | Room upgrades in a second or two; a closed tab still gets its pass |
| Refunds | Done by hand in each provider's dashboard; their webhooks revoke the pass | Rare; no admin tooling until it hurts |
| Other currency link | Not built | An Indian abroad sees dollars; fine |

Out of scope: renewals, our own receipt emails, an admin refund command, coupons, GST invoices.

## 2. Data

Migration `0002_billing.sql`:

```sql
CREATE TABLE purchases (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('razorpay','paddle')),
  ref TEXT NOT NULL,                      -- Razorpay pay_…, Paddle txn_…
  plan TEXT NOT NULL CHECK (plan IN ('day','month','year')),
  amount INTEGER NOT NULL,                -- lowest unit: paise, cents
  currency TEXT NOT NULL,                 -- INR, USD
  status TEXT NOT NULL CHECK (status IN ('paid','refunded')),
  created_at INTEGER NOT NULL,
  refunded_at INTEGER,
  UNIQUE (provider, ref)
);
CREATE INDEX purchases_user ON purchases (user_id);
```

- A paid pass is an `entitlements` row with `source = razorpay | paddle` and `ref` = the purchase's `ref`. `UNIQUE(user_id, source, ref)` on entitlements and `UNIQUE(provider, ref)` on purchases make every grant safe to repeat.
- Deleting an account keeps its purchases with `user_id` set to null (money records for accounts and tax) and drops its entitlements (cascade, as now).
- **Stacking.** `grant()` sets `starts_at` to the latest `ends_at` among the user's active, non-revoked rows, or `now` if there are none. If any active row has no end (forever), the new row starts now: it cannot add anything.
- **Revoking one paid pass.** Set `revoked_at` on it, then re-lay the user's later non-revoked rows end to end from `max(now, end of whatever is still active before them)`, keeping each row's length. No gap, no lost days.

## 3. Plans in one place

`billing/plans.ts` exports the plan table: id, label, days, rupee amount in paise, and which Paddle price variable it maps to. Server and web both import it (the web already imports `catalog-data` the same way), and `priceTable()` reads from it.

- The server builds every Razorpay order from this table, so the browser never sets a price.
- A Paddle transaction is accepted only if its price ID is `PADDLE_PRICE_MONTH` or `PADDLE_PRICE_YEAR`; the plan follows from which.

## 4. Server

All under `apps/product-server/src/billing/`, one file per provider plus `purchases.ts` (record, grant, refund) and `plans.ts`. Provider HTTP calls go through a `deps` object, as `auth.ts` does for Google, so tests swap in fakes.

| Route | Auth | Does |
|---|---|---|
| `POST /api/billing/razorpay/order {plan}` | session | Create a Razorpay order for the plan's amount in INR, `notes.userId` = user. Return `{ orderId, keyId, amount, email }` |
| `POST /api/billing/razorpay/confirm {orderId, paymentId, signature}` | session | Check `HMAC_SHA256(orderId + "\|" + paymentId, KEY_SECRET)`. Fetch the payment: `captured`, order and amount match, `notes.userId` is this user. Then record + grant |
| `POST /api/billing/paddle/confirm {transactionId}` | session | Fetch the transaction from Paddle's API: `completed`, one item with our price, `custom_data.userId` is this user. Then record + grant |
| `POST /api/billing/razorpay/webhook` | HMAC of body with `RAZORPAY_WEBHOOK_SECRET` (`X-Razorpay-Signature`) | `payment.captured`: same record + grant, user from `notes.userId`. `refund.processed`: refund |
| `POST /api/billing/paddle/webhook` | `Paddle-Signature` (ts + h1 over `ts:body`) with `PADDLE_WEBHOOK_SECRET` | `transaction.completed`: record + grant, user from `custom_data.userId`. `adjustment.updated` with `status = approved` and action `refund` or `chargeback`: refund |

- Confirm and webhook can race; whichever lands second finds the purchase and does nothing. The confirm reply is the same either way: `{ ok: true, plan }`.
- A webhook for a user who has since deleted their account records the purchase with no user and grants nothing.
- Webhooks answer 2xx for events they ignore, and 4xx only for a bad signature, so providers don't retry forever.
- A refund for a `ref` we never recorded is logged and ignored (2xx).
- **Refund** = purchase `status = refunded`, `refunded_at = now`, then revoke its entitlement (section 2). Running rooms keep their tier until they close, as the refunds page promises.
- `GET /api/me` adds `purchases: [{ plan, amount, currency, status, createdAt }]`, newest first.

### Config

| Name | Kind | Where |
|---|---|---|
| `BILLING` | var, `"0"` / `"1"` | `wrangler.jsonc`; `/api/config` reports it; off hides every buy button |
| `RAZORPAY_KEY_ID`, `PADDLE_ENV` (`sandbox`/`production`), `PADDLE_CLIENT_TOKEN`, `PADDLE_PRICE_MONTH`, `PADDLE_PRICE_YEAR` | vars (public) | `wrangler.jsonc` live, `.dev.vars` local |
| `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET` | secrets | `wrangler secret put`; `.dev.vars` local |

`/api/config` adds `billing: { provider: "razorpay" | "paddle", ...public keys }` when `BILLING = "1"`, else `billing: null`. `deploy-product.mjs` requires the four secrets only when `BILLING` is `"1"` in `wrangler.jsonc`.

## 5. Web

One module, `buy.ts`, exports `buy(plan, opts): Promise<"done" | "closed" | "pending">`:

1. Signed out: go to `/account?next=<here with ?buy=<plan>>`; pages that see `?buy=` on load (signed in) call `buy()` once and drop the param.
2. Load the provider script on first use only (Razorpay `checkout.js`, Paddle.js), never on page load.
3. Razorpay: get an order, open Checkout with the email pre-filled, and on success post to confirm. Paddle: open the overlay with the price, `customData.userId` and the email, and on `checkout.completed` post the transaction ID to confirm.
4. Closing the checkout without paying resolves `"closed"`: no message.
5. Confirm failing after a payment resolves `"pending"`: the caller says "We got your payment. Your pass will show up in a minute." and polls `/api/me` every 3 s for up to 60 s. Still nothing: "Email hello@couchpartygames.com and we will fix it fast."

Where it shows (all hidden while `billing` is null, which looks exactly like today):

- **Pricing and landing price strips:** a Buy button under each price; the note becomes "One payment. Nothing renews."
- **Account:** the Buy panel shows plan buttons; with a pass it stays visible as "Add more time". A "Your purchases" list (date, plan, amount, Refunded).
- **Room upgrade sheet:** plan buttons above "Have a code?"; while confirming, "Finishing your payment…"; then the existing done state, worded "Payment done." The room upgrades in place through the existing `upgradeRoom` call.

Button text: price and length, e.g. "30 days · ₹149". Same motion rules as the rest of the site: late content eases in, no layout jumps.

## 6. Testing

- **Unit (vitest, fake providers):** each route's good path; bad signature; wrong amount or price; another user's payment; not captured / not completed; confirm twice; confirm and webhook racing; webhook first; refund for an unknown ref; refund twice; stacking on active, on forever, refund mid-stack; account delete keeps purchases unlinked.
- **Signature checks** run against sample payloads and headers copied from the providers' docs.
- **End to end, local:** Razorpay test mode (test card and UPI) and Paddle sandbox (test card) for every plan; a temporary Cloudflare tunnel for the webhooks, registered in Razorpay's test dashboard and as a Paddle sandbox notification destination; a dashboard refund on each removes the pass. Browser pass at phone and desktop size, light and dark.

## 7. Going live

1. Ship with `BILLING = "0"`.
2. After both accounts are approved: live public values into `wrangler.jsonc` (live Paddle product and prices created through the Paddle plugin), the four secrets via `wrangler secret put`, webhooks registered at `https://couchpartygames.com/api/billing/{razorpay,paddle}/webhook`.
3. `BILLING = "1"`, deploy, buy a real ₹49 day pass, refund it from the dashboard, see the pass go.
4. `docs/couchparty.md` gets a Billing section with these steps. The privacy page's account list adds the purchase record in the same change.
