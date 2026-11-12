# CouchParty Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signed-in hosts can buy Host Pass: Razorpay in rupees for India, Paddle in dollars elsewhere, one-time passes that stack, refunds that revoke, all hidden behind `BILLING` until live accounts are approved.

**Architecture:** A `billing/` folder in `apps/product-server` with one file per provider plus shared plans, HMAC and purchase-recording code. The browser opens the provider's checkout, then posts to a confirm route that checks with the provider before granting; webhooks grant the same way (idempotent on the provider's payment id) and carry refunds. The web side gets one `buy.ts` used by the price strips, the account page and the room upgrade sheet.

**Tech Stack:** Cloudflare Workers + D1, TypeScript, vitest with `test/d1.ts` (in-memory SQLite), Vite multi-page web, Razorpay Orders API + Standard Checkout, Paddle Billing API + Paddle.js v2. No provider SDKs: plain `fetch` and Web Crypto, so it runs the same in Workers and in vitest.

**Spec:** `docs/superpowers/specs/2026-11-12-couchparty-billing-design.md`

## Global Constraints

- Branch `product`. Commit after each task and push (`git push`); detailed commit bodies in the repo's style.
- Plans: India `day` ₹49 (4900 paise, 1 day), `month` ₹149 (14900, 30 days), `year` ₹999 (99900, 365 days). Elsewhere `month` $4.99, `year` $39 via Paddle price IDs from env. No dollar day pass.
- Provider: `CF-IPCountry === "IN"` → `razorpay`, anything else (including missing) → `paddle`.
- Everything a buyer sees is hidden when `BILLING !== "1"`; with it off the site behaves exactly as today.
- No renewals, no own receipt emails, no admin refund command, no coupons.
- Site copy: short plain sentences, basic words, no idioms. No emoji in UI. No gradients. Late content eases in with `motion.ts` (`morph`, `swapIn`, `fadeIn`); nothing pops.
- Never log or return secrets. Signature checks use `crypto.subtle.verify` (constant time), never `===` on hex strings.
- Webhooks: 401 only for a bad or missing signature; 200 for everything else, including events ignored.
- Provider HTTP goes through injected `deps` (the `auth.ts` pattern), so tests never touch the network.

## Review Focus

1. A non-host (no host key in this browser) opens the upgrade sheet: no buy buttons, the existing "Only the host can do this" line; they must not pay for a room they can't upgrade. Pinned in Task 6 (`sheetMode`).
2. Razorpay confirm runs while the payment is still `authorized`, not `captured`: answer `{ pending: true }` (202), record nothing, let the `payment.captured` webhook grant. Pinned in Task 3.
3. A webhook for a user who deleted their account: purchase recorded with `user_id` null, no entitlement, 200. Pinned in Tasks 3 and 4.
4. Plan/provider mismatch: `day` through Paddle, an unknown plan, or a Paddle transaction with someone else's price: 400 / ignored, never a grant. Pinned in Tasks 3 and 4.
5. Paddle transaction `paid` (not yet `completed`) at confirm time: accepted as paid. Pinned in Task 4.

---

## File structure

```
apps/product-server/
  migrations/0002_billing.sql          purchases table
  src/billing/plans.ts                 PLANS, providerFor(), planForPaddlePrice()   (Task 1, exported to web)
  src/billing/hmac.ts                  hmacHex(), verifyHmacHex()                    (Task 1)
  src/billing/purchases.ts             recordPaid(), refundByRef(), listPurchases() (Task 2)
  src/billing/razorpay.ts              handleRazorpay() + RazorpayDeps               (Task 3)
  src/billing/paddle.ts                handlePaddle() + PaddleDeps                   (Task 4)
  src/entitlements.ts                  grant() stacks; revokeAndRelay()              (Task 2)
  src/config.ts, src/auth.ts, src/index.ts, src/secrets.d.ts, wrangler.jsonc, package.json  (Task 5)
  test/plans.test.ts, test/hmac.test.ts, test/purchases.test.ts, test/razorpay.test.ts, test/paddle.test.ts
apps/product-web/
  src/buy.ts                           buy(), loaders, pending poll                  (Task 6)
  src/pass-sheet.ts, src/play.ts, src/account.ts, src/landing.ts, src/api.ts, *.html, src/site.css (Tasks 6-7)
  test/buy.test.ts
scripts/deploy-product.mjs (+ .d.mts), apps/server/test/deploy-product.test.ts   (Task 5)
docs/couchparty.md, apps/product-web/privacy.html                              (Task 8)
```

---

### Task 1: Plans and HMAC helpers

**Files:**
- Create: `apps/product-server/src/billing/plans.ts`, `apps/product-server/src/billing/hmac.ts`
- Modify: `apps/product-server/package.json` (exports `"./billing-plans": "./src/billing/plans.ts"`)
- Test: `apps/product-server/test/plans.test.ts`, `apps/product-server/test/hmac.test.ts`

**Interfaces:**
- Produces:
  - `type PlanId = "day" | "month" | "year"`; `type Provider = "razorpay" | "paddle"`
  - `PLANS: Record<PlanId, { days: number; length: string; inr: number; usd: number | null }>` with `length` = `"24 hours" | "30 days" | "365 days"`, `inr` in paise, `usd` in cents (`null` for day)
  - `providerFor(country: string | null): Provider`
  - `plansFor(provider: Provider): PlanId[]` → razorpay `["day","month","year"]`, paddle `["month","year"]`
  - `priceLabel(plan: PlanId, provider: Provider): string` → `"₹49"`, `"₹149"`, `"₹999"`, `"$4.99"`, `"$39"`
  - `planForPaddlePrice(priceId: string, env: { PADDLE_PRICE_MONTH?: string; PADDLE_PRICE_YEAR?: string }): PlanId | null`
  - `isPlanId(x: unknown): x is PlanId`
  - `hmacHex(secret: string, message: string): Promise<string>`; `verifyHmacHex(secret: string, message: string, hex: string): Promise<boolean>` (false for non-hex or wrong length, never throws)

- [ ] **Step 1: Write the failing tests**

```ts
// plans.test.ts
expect(providerFor("IN")).toBe("razorpay");
expect(providerFor("US")).toBe("paddle");
expect(providerFor(null)).toBe("paddle");
expect(plansFor("razorpay")).toEqual(["day", "month", "year"]);
expect(plansFor("paddle")).toEqual(["month", "year"]);
expect(PLANS.day).toEqual({ days: 1, length: "24 hours", inr: 4900, usd: null });
expect(PLANS.month).toEqual({ days: 30, length: "30 days", inr: 14900, usd: 499 });
expect(PLANS.year).toEqual({ days: 365, length: "365 days", inr: 99900, usd: 3900 });
expect(["day","month","year"].map((p) => priceLabel(p as PlanId, "razorpay"))).toEqual(["₹49", "₹149", "₹999"]);
expect(priceLabel("month", "paddle")).toBe("$4.99");
expect(priceLabel("year", "paddle")).toBe("$39");
const env = { PADDLE_PRICE_MONTH: "pri_m", PADDLE_PRICE_YEAR: "pri_y" };
expect(planForPaddlePrice("pri_m", env)).toBe("month");
expect(planForPaddlePrice("pri_y", env)).toBe("year");
expect(planForPaddlePrice("pri_other", env)).toBeNull();
expect(planForPaddlePrice("", {})).toBeNull();
expect(isPlanId("week")).toBe(false);

// hmac.test.ts — known vector: HMAC-SHA256("key", "The quick brown fox jumps over the lazy dog")
const H = "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8";
expect(await hmacHex("key", "The quick brown fox jumps over the lazy dog")).toBe(H);
expect(await verifyHmacHex("key", "The quick brown fox jumps over the lazy dog", H)).toBe(true);
expect(await verifyHmacHex("key", "the quick brown fox jumps over the lazy dog", H)).toBe(false);
expect(await verifyHmacHex("key", "x", "zz")).toBe(false);
expect(await verifyHmacHex("key", "x", "")).toBe(false);
```

- [ ] **Step 2: Run, expect fail** — `pnpm --filter @games/product-server exec vitest run test/plans.test.ts test/hmac.test.ts` → modules not found.
- [ ] **Step 3: Implement.** `verifyHmacHex` imports the key with `crypto.subtle.importKey("raw", …, { name: "HMAC", hash: "SHA-256" }, false, ["verify"])` and calls `crypto.subtle.verify` with the decoded bytes.
- [ ] **Step 4: Run, expect pass.**
- [ ] **Step 5: Point the web at the shared plans.** `apps/product-web/src/landing.ts` `priceTable(country)` becomes a thin map over `plansFor(providerFor(country))` with `{ plan: Capitalised id ("Day"/"Month"/"Year"), length: PLANS[p].length, price: priceLabel(p, provider) }`. The existing `apps/product-web/test/gallery.test.ts` `priceTable` test must pass unchanged. Run `pnpm --filter @games/product-web exec vitest run`.
- [ ] **Step 6: Commit** — `CouchParty billing: plans and HMAC helpers`.

---

### Task 2: Purchases table, stacking passes, refunds

**Files:**
- Create: `apps/product-server/migrations/0002_billing.sql` (exactly the SQL in spec §2), `apps/product-server/src/billing/purchases.ts`
- Modify: `apps/product-server/src/entitlements.ts`
- Test: `apps/product-server/test/purchases.test.ts`, extend `apps/product-server/test/entitlements.test.ts`

**Interfaces:**
- Consumes: `PlanId`, `PLANS` (Task 1); `newId`, `Db` from `db.ts`.
- Produces:
  - `grant(db, userId, e, now)` — same signature; now **stacks**: `starts_at` = latest `ends_at` among the user's active non-revoked rows, or `now`; if an active row has `ends_at IS NULL`, starts at `now`.
  - `revokeAndRelay(db: Db, userId: string, source: EntitlementSource, ref: string, now: number): Promise<void>` — sets `revoked_at = now` on that row, then re-lays the user's non-revoked rows that start after `now` end to end from `max(now, latest ends_at among still-active rows starting at or before now)`, keeping each row's `ends_at - starts_at`. Rows with null `ends_at` untouched.
  - `type PaidInput = { provider: Provider; ref: string; plan: PlanId; amount: number; currency: "INR" | "USD"; userId: string | null }`
  - `recordPaid(db: Db, p: PaidInput, now: number): Promise<"granted" | "duplicate" | "no-user">` — inserts the purchase (`status = 'paid'`); on `UNIQUE(provider, ref)` conflict returns `"duplicate"` and does nothing; if `userId` is null or the user row is gone, stores `user_id` null and returns `"no-user"`; else calls `grant(..., { source: provider, plan, days: PLANS[plan].days, ref })` and returns `"granted"`.
  - `refundByRef(db: Db, provider: Provider, ref: string, now: number): Promise<"refunded" | "already" | "unknown">` — `paid` → `refunded` + `refunded_at`, then `revokeAndRelay` if the purchase has a user.
  - `listPurchases(db: Db, userId: string): Promise<Array<{ plan: PlanId; amount: number; currency: string; status: "paid" | "refunded"; createdAt: number }>>` newest first.

- [ ] **Step 1: Write the failing tests** (T0 = 1_800_000_000_000, DAY = 86_400_000; `fakeD1()`; insert a user row first)

```ts
// entitlements.test.ts additions
it("stacks a new pass after an active one", async () => {
  await grant(db, u, { source: "comp", plan: "comp", days: 10, ref: "a" }, T0);
  await grant(db, u, { source: "razorpay", plan: "month", days: 30, ref: "pay_1" }, T0 + DAY);
  expect((await activePlan(db, u, T0 + DAY))!.endsAt).toBe(T0 + 40 * DAY);
  expect(await tierFor(db, u, T0 + 39 * DAY)).toBe("pass");
  expect(await tierFor(db, u, T0 + 40 * DAY)).toBe("free");
});
it("starts now when the user holds a forever pass", async () => { /* grant days:null, then days:30 → that row's starts_at === now */ });
it("starts now after an expired pass", async () => { /* grant 1 day at T0, grant 30 at T0+5*DAY → ends T0+35*DAY */ });
it("refund mid-stack pulls later passes forward", async () => {
  await grant(db, u, { source: "razorpay", plan: "month", days: 30, ref: "pay_1" }, T0);
  await grant(db, u, { source: "razorpay", plan: "month", days: 30, ref: "pay_2" }, T0);
  await revokeAndRelay(db, u, "razorpay", "pay_1", T0 + 5 * DAY);
  expect((await activePlan(db, u, T0 + 5 * DAY))!.endsAt).toBe(T0 + 35 * DAY);
});

// purchases.test.ts
const p = { provider: "razorpay", ref: "pay_1", plan: "month", amount: 14900, currency: "INR", userId: u } as const;
expect(await recordPaid(db, p, T0)).toBe("granted");
expect(await recordPaid(db, p, T0)).toBe("duplicate");            // and still exactly one entitlement row
expect(await recordPaid(db, { ...p, ref: "pay_2", userId: null }, T0)).toBe("no-user");
expect(await recordPaid(db, { ...p, ref: "pay_3", userId: "gone" }, T0)).toBe("no-user");   // purchase row user_id IS NULL
expect(await refundByRef(db, "razorpay", "pay_1", T0 + DAY)).toBe("refunded");
expect(await tierFor(db, u, T0 + DAY)).toBe("free");
expect(await refundByRef(db, "razorpay", "pay_1", T0 + DAY)).toBe("already");
expect(await refundByRef(db, "razorpay", "pay_nope", T0)).toBe("unknown");
expect(await refundByRef(db, "paddle", "pay_1", T0)).toBe("unknown");   // provider is part of the key
expect((await listPurchases(db, u)).map((x) => x.status)).toEqual(["refunded"]);   // pay_2/pay_3 have no user
await recordPaid(db, { ...p, ref: "pay_4", plan: "year", amount: 99900 }, T0 + 2 * DAY);
expect((await listPurchases(db, u)).map((x) => x.plan)).toEqual(["year", "month"]);   // newest first
it("deleting the user keeps the purchase, unlinked", /* DELETE FROM users → SELECT user_id FROM purchases = null, entitlements gone */);
```

- [ ] **Step 2: Run, expect fail.** `pnpm --filter @games/product-server exec vitest run test/entitlements.test.ts test/purchases.test.ts`
- [ ] **Step 3: Write `0002_billing.sql`, the stacking `grant`, `revokeAndRelay`, and `purchases.ts`.** Existing comp redeem and admin grant keep calling `grant()` and inherit stacking; the existing comps/admin tests must still pass.
- [ ] **Step 4: Run the whole server suite, expect pass.** `pnpm --filter @games/product-server exec vitest run`
- [ ] **Step 5: Apply locally** — `pnpm --filter @games/product-server run db:migrate:local` succeeds.
- [ ] **Step 6: Commit** — `CouchParty billing: purchases table, stacking passes, refunds`.

---

### Task 3: Razorpay routes

**Files:**
- Create: `apps/product-server/src/billing/razorpay.ts`
- Test: `apps/product-server/test/razorpay.test.ts`

**Interfaces:**
- Consumes: Task 1 (`PLANS`, `isPlanId`, `hmacHex`, `verifyHmacHex`), Task 2 (`recordPaid`, `refundByRef`), `userFromRequest` from `auth.ts`, `json` from `http.ts`.
- Produces:
  - `interface RazorpayDeps { now(): number; api(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: any }> }` — `path` like `/v1/orders`; the real one does Basic auth `KEY_ID:KEY_SECRET` against `https://api.razorpay.com`.
  - `realRazorpayDeps(env: ProductEnv): RazorpayDeps`
  - `handleRazorpay(request: Request, env: ProductEnv, deps: RazorpayDeps): Promise<Response | null>` — null for any path not under `/api/billing/razorpay/`. All three routes 404 when `env.BILLING !== "1"`.

Route behaviour (spec §4):
- `POST /order {plan}` — 401 signed out; 400 unless `isPlanId(plan)`. `POST /v1/orders { amount: PLANS[plan].inr, currency: "INR", receipt: <newId()>, notes: { userId, plan } }`. Reply `{ orderId, keyId: env.RAZORPAY_KEY_ID, amount, currency: "INR", email }`. Provider non-2xx → 502 `{ error: "Payments are not working right now. Please try again." }`.
- `POST /confirm {orderId, paymentId, signature}` — 401 signed out; 400 on bad signature (`verifyHmacHex(KEY_SECRET, orderId + "|" + paymentId, signature)`). `GET /v1/payments/:paymentId` and `GET /v1/orders/:orderId`: payment `order_id === orderId`, order `notes.userId === user.id`, `isPlanId(order.notes.plan)`, `payment.amount === PLANS[plan].inr`, `currency === "INR"` — else 400. `payment.status === "authorized"` → 202 `{ pending: true }`; `"captured"` → `recordPaid(... ref: paymentId ...)` → 200 `{ ok: true, plan }` for `granted` or `duplicate`; other statuses → 400.
- `POST /webhook` — raw body text; `X-Razorpay-Signature` checked with `RAZORPAY_WEBHOOK_SECRET` over the exact body → else 401. `payment.captured`: take `payload.payment.entity`, fetch its order, then the same checks and `recordPaid` with `userId: order.notes.userId`. `refund.processed`: `refundByRef("razorpay", payload.refund.entity.payment_id)`. Anything else, or a failed check → 200 `{ ok: true }` with `console.warn` of event name and ids only.

- [ ] **Step 1: Write the failing tests** with a fake `api` keyed by `"GET /v1/payments/pay_1"` etc. and a signed-in session (reuse the session helper from `auth.test.ts` setup: insert user + session, send `cookie: cp_session=…`). Cases, each asserting status and DB state:
  - order: signed out 401; `plan: "week"` 400; good plan sends `amount: 14900, currency: "INR", notes: { userId, plan: "month" }` and returns its `orderId`; provider 500 → 502; `BILLING: "0"` → 404.
  - confirm: good → 200 + one entitlement + one purchase (`amount 14900`); same call again → 200, still one of each; bad signature 400; payment for another order 400; order `notes.userId` of another user 400; amount 4900 on a month order 400; `authorized` → 202 `{ pending: true }` and no purchase row (**Review Focus 2**).
  - webhook: bad signature 401; good `payment.captured` grants; the same event twice → one entitlement; confirm then webhook → one entitlement; webhook for a deleted user → purchase with `user_id` null, no entitlement, 200 (**Review Focus 3**); `refund.processed` for a recorded payment → tier free; for an unknown payment → 200; `order.paid` event → 200, nothing written.
  - Use the sample body shape from Razorpay's docs (`entity: "event"`, `event`, `payload.payment.entity` with `id`, `order_id`, `amount`, `currency`, `status`), signed with `hmacHex(secret, body)`.
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement `razorpay.ts`.**
- [ ] **Step 4: Run, expect pass.**
- [ ] **Step 5: Commit** — `CouchParty billing: Razorpay order, confirm and webhook`.

---

### Task 4: Paddle routes

**Files:**
- Create: `apps/product-server/src/billing/paddle.ts`
- Test: `apps/product-server/test/paddle.test.ts`

**Interfaces:**
- Consumes: Task 1 (`planForPaddlePrice`, `PLANS`, `verifyHmacHex`, `hmacHex`), Task 2 (`recordPaid`, `refundByRef`), `userFromRequest`.
- Produces:
  - `interface PaddleDeps { now(): number; getTransaction(id: string): Promise<PaddleTxn | null> }` where `PaddleTxn = { id: string; status: string; custom_data: { userId?: string } | null; currency_code: string; items: Array<{ price: { id: string } }>; details: { totals: { grand_total: string } } }`.
  - `realPaddleDeps(env)` — `GET https://sandbox-api.paddle.com/transactions/:id` when `PADDLE_ENV === "sandbox"`, else `https://api.paddle.com`, `Authorization: Bearer PADDLE_API_KEY`; returns `body.data`, or null on 404.
  - `handlePaddle(request, env, deps): Promise<Response | null>` — null outside `/api/billing/paddle/`; 404 when `BILLING !== "1"`.

Route behaviour:
- `POST /confirm {transactionId}` — 401 signed out; fetch; accept when `status` is `"paid"` or `"completed"` (**Review Focus 5**), exactly one item whose price maps via `planForPaddlePrice`, and `custom_data.userId === user.id`; else 400. `recordPaid({ provider: "paddle", ref: txn.id, plan, amount: Number(grand_total), currency: currency_code, userId })` → 200 `{ ok: true, plan }`. `status` `"ready"`/`"draft"` → 202 `{ pending: true }`.
- `POST /webhook` — header `Paddle-Signature: ts=<unix>;h1=<hex>`; `verifyHmacHex(PADDLE_WEBHOOK_SECRET, ts + ":" + rawBody, h1)` and `|now/1000 - ts| <= 300` else 401. `transaction.completed`: same checks on `data` (it is a transaction entity) and `recordPaid`. `adjustment.created` / `adjustment.updated` with `data.status === "approved"` and `data.action` in `["refund", "chargeback"]` → `refundByRef("paddle", data.transaction_id)`. Everything else 200.

- [ ] **Step 1: Write the failing tests** (sign with `hmacHex(secret, `${ts}:${body}`)`): confirm good `completed` and good `paid` → 200 + pass; unknown price 400 (**Review Focus 4**); other user's `custom_data` 400; two items 400; `ready` → 202 no rows; twice → one entitlement. Webhook: missing header 401, wrong h1 401, ts 10 minutes old 401; `transaction.completed` grants; with a deleted user → `no-user` row; `adjustment.updated` approved refund revokes; `adjustment.created` approved chargeback revokes; `pending_approval` refund → no change; `credit` action → no change; refund for unknown txn → 200.
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement `paddle.ts`.**
- [ ] **Step 4: Run, expect pass.**
- [ ] **Step 5: Commit** — `CouchParty billing: Paddle confirm and webhook`.

---

### Task 5: Wiring, config, deploy check

**Files:**
- Modify: `apps/product-server/src/index.ts` (call `handleRazorpay` then `handlePaddle` after `handleUpgrade`), `src/config.ts`, `src/auth.ts` (`GET /api/me` adds `purchases: await listPurchases(...)`), `src/secrets.d.ts` (the four secrets), `wrangler.jsonc` vars (`"BILLING": "0"`, `"RAZORPAY_KEY_ID": "<set at setup>"`, `"PADDLE_ENV": "sandbox"`, `"PADDLE_CLIENT_TOKEN": "<set at setup>"`, `"PADDLE_PRICE_MONTH": "<set at setup>"`, `"PADDLE_PRICE_YEAR": "<set at setup>"`), then `pnpm --filter @games/product-server run types`; `package.json` `dev` script adds `--var BILLING:1` (local values come from `.dev.vars`)
- Modify: `scripts/deploy-product.mjs`, `scripts/deploy-product.d.mts`, `apps/server/test/deploy-product.test.ts`
- Test: `apps/product-server/test/config.test.ts`, `apps/product-server/test/auth.test.ts`, `apps/server/test/deploy-product.test.ts`

**Interfaces:**
- Produces:
  - `/api/config` adds `billing: null` when `BILLING !== "1"`, else `{ provider: providerFor(country), razorpayKeyId, paddle: { env, token, prices: { month, year } } }`.
  - `/api/me` adds `purchases` (signed-in only; signed-out reply unchanged).
  - `BILLING_SECRETS = ["RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "PADDLE_API_KEY", "PADDLE_WEBHOOK_SECRET"]`; `requiredSecrets(wranglerJsoncText: string): string[]` = `REQUIRED_SECRETS` plus `BILLING_SECRETS` when the file's vars have `"BILLING": "1"`; `missingSecrets(listOutput, required)` takes the list.

- [ ] **Step 1: Failing tests:** config with `BILLING: "0"` → `billing: null`; with `"1"` and `CF-IPCountry: IN` → `provider: "razorpay"`, `US` → `"paddle"` plus the price ids. `/api/me` for a user with one purchase lists it with `amount` and `status`. `requiredSecrets('{"vars":{"BILLING":"1"}}')` includes all four; `"0"` excludes them; `missingSecrets` with an explicit list.
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement.** `deploySteps` reads `apps/product-server/wrangler.jsonc` and passes `requiredSecrets(text)` into the `{ secrets }` step.
- [ ] **Step 4: Run all suites, expect pass:** `pnpm --filter @games/product-server exec vitest run`, `pnpm --filter @games/server exec vitest run`, `pnpm --filter @games/product-server run typecheck`.
- [ ] **Step 5: Commit** — `CouchParty billing: routes wired, config, deploy check`.

---

### Task 6: `buy.ts` and the room sheet

**Files:**
- Create: `apps/product-web/src/buy.ts`, `apps/product-web/test/buy.test.ts`
- Modify: `apps/product-web/src/api.ts` (`Config.billing`, `Me.purchases`, `razorpayOrder`, `razorpayConfirm`, `paddleConfirm`), `src/pass-sheet.ts`, `src/play.ts`, `src/site.css` / play CSS for the plan buttons

**Interfaces:**
- Consumes: `/api/config.billing`, the three routes, `PLANS`/`priceLabel`/`plansFor` via `@games/product-server/billing-plans`.
- Produces:
  - `type BuyOutcome = "done" | "closed" | "pending" | "failed"`
  - `buy(plan: PlanId, opts: { returnTo: string }): Promise<BuyOutcome>` — signed out → `location.assign("/account?next=" + encodeURIComponent(withBuy(returnTo, plan)))` and never resolves; else loads the provider script once (`https://checkout.razorpay.com/v1/checkout.js` or `https://cdn.paddle.com/paddle/v2/paddle.js`), opens checkout, confirms. 202 from confirm → `waitForPass()`.
  - `waitForPass(before: number, deps?: { me(): Promise<Me>; sleep(ms: number): Promise<void> }): Promise<"done" | "pending">` — `before` = purchase count read before checkout opened; polls every 3000 ms, 20 tries, `done` once `purchases.length > before` (works when the buyer already had a pass).
  - `withBuy(path: string, plan: PlanId): string`; `takeBuyParam(url: URL): PlanId | null` (also strips it via `history.replaceState`).
  - `planButtons(billing: Billing, onPick: (p: PlanId) => void): HTMLElement` — one `button.plan-btn` per `plansFor(provider)`, text `"<length> · <price>"` (e.g. `"30 days · ₹149"`).
  - `sheetMode(m: Me, isHost: boolean, billing: Billing | null): "sign-in" | "use-pass" | "buy" | "code-only" | "not-host"` — `not-host` whenever `!isHost` and not signed out (**Review Focus 1**); `buy` when signed in, free, host, billing on; `code-only` when billing is null.
- Copy (exact): pending `"Finishing your payment…"`; slow `"We got your payment. Your pass will show up in a minute."`; gave up `"Your payment went through, but your pass is late. Email hello@couchpartygames.com and we will fix it fast."`; done lead `"Payment done. All games are open now, for everyone in this room, and up to 16 players can join when the game allows it."`

- [ ] **Step 1: Failing tests** for the pure parts: `withBuy("/pricing", "month") === "/pricing?buy=month"`, `withBuy("/room/ABCD?upgrade=1", "day") === "/room/ABCD?upgrade=1&buy=day"`; `takeBuyParam` returns `"year"` for `?buy=year`, null for `?buy=week`; `waitForPass(1, …)` with a fake `me` whose purchases grow from 1 to 2 on the 3rd call → `"done"` after 2 sleeps, never → `"pending"` after 20; every `sheetMode` row including the not-host one.
- [ ] **Step 2: Run, expect fail.** `pnpm --filter @games/product-web exec vitest run test/buy.test.ts`
- [ ] **Step 3: Implement `buy.ts`.** Razorpay options: `{ key, order_id, amount, currency, name: "CouchParty", description: "Host Pass, <length>", prefill: { email }, theme: { color: "#c6f432" }, handler, modal: { ondismiss } }`. Paddle: `Paddle.Environment.set("sandbox")` when `env === "sandbox"`, `Paddle.Initialize({ token, eventCallback })` once; `Paddle.Checkout.open({ items: [{ priceId, quantity: 1 }], customer: { email }, customData: { userId }, settings: { displayMode: "overlay", theme: "light" } })`; resolve on `checkout.completed` (`event.data.transaction_id` → confirm) or `checkout.closed` (→ `"closed"`). The user id for `customData` comes from a new `id` field on `/api/me` (add it in this task, server + `Me` type + an assertion in `auth.test.ts`).
- [ ] **Step 4: Sheet.** `openPassSheet(gameId, code, opts?: { buy?: PlanId })` uses `sheetMode`; `buy` mode shows `planButtons` above the existing code form; picking runs `buy(plan, { returnTo: "/room/" + code + "?upgrade=1" })`, shows "Finishing your payment…" via `swapIn`, then on `done` calls the existing `upgradeHere(code)` and `done()` with the payment lead; `closed` restores the buttons silently. `play.ts`: after `finishUpgrade`, `takeBuyParam(url)` and pass it as `opts.buy`, which auto-starts that purchase once.
- [ ] **Step 5: Run web tests + typecheck, expect pass.**
- [ ] **Step 6: Commit** — `CouchParty billing: buy flow and room sheet`.

---

### Task 7: Pricing, landing and account

**Files:**
- Modify: `apps/product-web/index.html`, `pricing.html`, `account.html`, `src/landing.ts`, `src/account.ts`, `src/site.css`

**Interfaces:**
- Consumes: `buy`, `planButtons`, `takeBuyParam`, `withBuy` (Task 6), `Me.purchases` (Task 5).
- Produces (DOM): each `[data-prices] .price` gets a `button.price-buy` "Buy" when billing is on; `.prices-note` text becomes `"One payment. Nothing renews."`; account `[data-buy]` panel heading `"Buy Host Pass"` (free) / `"Add more time"` (pass) with `planButtons`; `[data-purchases]` list, hidden when empty, rows `"12 Nov 2026 · 30 days · ₹149"` plus `"Refunded"` tag; amounts formatted from `amount`/`currency` with `Intl.NumberFormat("en-IN" | "en-US", { style: "currency", currency, minimumFractionDigits: 0 })` so ₹149 and $4.99 match the price strip.

- [ ] **Step 1: Failing test** in `apps/product-web/test/me.test.ts` (or a new `purchases.test.ts`) for the pure `purchaseLine(p)` formatter: `{ plan: "month", amount: 14900, currency: "INR", createdAt: Date.UTC(2026,10,12) }` → `"12 Nov 2026 · 30 days · ₹149"`; `{ plan: "month", amount: 499, currency: "USD" }` → `… · $4.99`; `{ plan: "year", amount: 3900, currency: "USD" }` → `… · $39`.
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement.** Landing/pricing: buttons added inside `renderPrices` only when `config.billing`; clicking runs `buy(plan, { returnTo: location.pathname })`; `done` → `location.assign("/account")`. Both pages call `takeBuyParam` on boot and start that purchase once config says billing is on. Account: `show()` renders the panel per tier, the purchases list via `morph`, and after `done` re-runs `show()` so the pass card eases in.
- [ ] **Step 4: Browser check** with `pnpm dev` (product-web on 5174 + product-server on 8788, `.dev.vars` present): signed out Buy → sign-in → back → checkout opens; Razorpay test card completes → account shows the pass and one purchase; Paddle sandbox (set a non-IN country by stubbing `/api/config` in DevTools) completes the same; `BILLING:0` hides every button. Phone and desktop widths, light and dark.
- [ ] **Step 5: Run web tests + typecheck.**
- [ ] **Step 6: Commit** — `CouchParty billing: buy buttons on pricing, landing and account`.

---

### Task 8: Webhooks end to end, docs, privacy

**Files:**
- Modify: `docs/couchparty.md` (new "Billing" section: spec §7 steps, webhook URLs, events — Razorpay `payment.captured`, `refund.processed`; Paddle `transaction.completed`, `adjustment.created`, `adjustment.updated`), `apps/product-web/privacy.html` ("Hosts with an account" list gains `"for a pass you bought: the plan, the amount and the payment ID from Razorpay or Paddle. Never your card or bank details;"`, and "Delete your data" says purchase records stay without your email, for tax), date to the day it ships.

- [ ] **Step 1: Tunnel.** `cloudflared tunnel --url http://localhost:8788` (install if missing); note the `https://…trycloudflare.com` URL.
- [ ] **Step 2: Register test webhooks.** Razorpay test dashboard → Webhooks → `<tunnel>/api/billing/razorpay/webhook`, events `payment.captured`, `refund.processed`, a secret you put in `.dev.vars` as `RAZORPAY_WEBHOOK_SECRET`. Paddle sandbox via the Paddle MCP: `client.notificationSettings.create({ description: "couchparty local", type: "url", destination: "<tunnel>/api/billing/paddle/webhook", subscribed_events: ["transaction.completed", "adjustment.created", "adjustment.updated"] })`; put `endpoint_secret_key` in `.dev.vars` as `PADDLE_WEBHOOK_SECRET`. Restart `wrangler dev`.
- [ ] **Step 3: Close-the-tab path.** Buy a Razorpay day pass and close the tab as the handler fires (or block `/confirm` in DevTools): the webhook grants it. Same for Paddle month.
- [ ] **Step 4: Refunds.** Refund the Razorpay payment from the test dashboard → pass gone within a minute. Refund the Paddle transaction via `client.adjustments.create({ action: "refund", type: "full", transaction_id, reason: "test" })` → approved within ~10 min → pass gone.
- [ ] **Step 5: Clean up.** Delete the Paddle sandbox notification setting and the Razorpay test webhook (the tunnel URL dies anyway). Write the docs and privacy changes.
- [ ] **Step 6: Full suites + typecheck + `pnpm deploy:product --dry-run`** (BILLING still `"0"`, so it warns about nothing new).
- [ ] **Step 7: Commit** — `CouchParty billing: docs, privacy, end-to-end checked`.
