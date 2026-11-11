# CouchParty Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CouchParty live on couchpartygames.com: open free hosting, accounts, comp-code Host Pass, admin CLI, landing page, product renames, abuse controls. No billing.

**Architecture:** Part A adds hook-points to `master` (room tier + per-room host key in the runtime, a `HostPolicy` seam in the Worker, a `startShell(opts)` seam in the web app) with today's behaviour plugged in. Part B, on `product`, adds `apps/product-server` (a second Worker that reuses the room DO and fetch handler, plus D1-backed accounts) and `apps/product-web` (a multi-page Vite app: static landing/account pages plus the existing shell at `/play`).

**Tech Stack:** TypeScript, Cloudflare Workers + Durable Objects (partyserver), D1, R2, Workers Rate Limiting binding, Turnstile, Resend (REST), Google OAuth (hand-rolled), Vite, vitest, `node:sqlite` for D1 test fakes.

**Spec:** `docs/superpowers/specs/2026-11-11-couchparty-product-design.md`

## Global Constraints

- `product` merges `master` one way. Part A commits go to `master` (commit + push each, detailed body like recent commits), then `git switch product && git merge master`. Part B commits go to `product` (push each).
- Master behaviour must not move: after Part A the full existing suite (`pnpm test`, `pnpm typecheck`) passes with no edits to existing test assertions.
- No new runtime dependencies. Dev-only: none beyond what exists (`node:sqlite` is built into Node 24).
- Shared code (`apps/server/src`, `apps/web/src`) must not reference product names, D1, or accounts.
- Shared server code types its env as explicit interfaces (`ServerEnv`, `GodotEnv`), never the global `Env`, so the product Worker's generated `Env` can satisfy it.
- Premium game ids: `blind-rally`, `rally`, `treasure-hunt`, `dominion`. Free seat cap: 8. Pass seat cap: the game's own `maxPlayers`.
- Product renames: `dominion` → "Frontier", `scribbl` → "Doodle Dash". Nightfall unchanged.
- Product brand string: "CouchParty". Origin: `https://couchpartygames.com`.
- All on-site copy: short plain sentences, basic words, no idioms (site copy rule).
- Cookie: `cp_session`, HttpOnly, Secure, SameSite=Lax, Path=/, 30 days. Store only SHA-256 hashes of session and login tokens.
- Tokens: 144-bit random, base64url (reuse the `randomToken` shape from `apps/server/src/index.ts`).

## Deliberate deferrals from the spec (confirm in review)

- **Godot export gating by room tier:** deferred. Free rooms can't select premium games, so clients never load the exports; only direct hotlinking leaks bandwidth. Revisit if R2 egress shows it.
- **Host toggle for the profanity filter:** filter is always on in product for Phase 1 (toggle needs a protocol message).
- **Packs, history, cosmetics:** trail Phase 1, as the spec allows. Landing/pricing list them as "coming soon".
- **Better Auth:** not used; auth is hand-rolled (two flows, no passwords, no new dependency).

## Review Focus

1. A day pass or comp that expires mid-game must not downgrade an open room; tier only ever goes `free → pass`. Test in Task A1 and B4.
2. One user redeeming the same comp code twice must not get a second entitlement or burn a second use. Test in Task B2.
3. Two users racing for the last use of a comp code: exactly one wins. Uses increment via a conditional `UPDATE … WHERE uses < max_uses`. Test in Task B2.
4. Emails differing only in case or surrounding spaces are one account. Test in Task B3.
5. A free room fills at 8 even when the game allows 16, and the cap lifts after `upgrade`, without anyone rejoining. Test in Task A1.

---

## Part A: hook-points on master

### Task A1: Room tier and per-room host key in the runtime

**Files:**
- Modify: `packages/protocol/src/index.ts` (`RoomPublicState`)
- Modify: `apps/server/src/runtime.ts` (`RoomHost`, `RoomData`, `claim`, `onJoin`, `select-game`, `startGame`, `publicState`)
- Modify: `apps/server/test/harness.ts` (`World` gains `tierLimits`)
- Test: `apps/server/test/tier.test.ts`

**Interfaces:**
- Produces (protocol):
  ```ts
  export type RoomTier = "free" | "pass";
  // RoomPublicState gains:
  tier: RoomTier;
  /** Game ids this room can't select at its tier. Empty on master. */
  lockedGameIds: string[];
  ```
- Produces (runtime):
  ```ts
  export interface TierLimits { premiumGameIds: string[]; freeMaxPlayers: number }
  export interface RoomGrant { tier: RoomTier; hostKey: string | null }
  // RoomHost gains:  tierLimits?: TierLimits   (absent = nothing locked, no cap)
  // RoomData gains:  tier?: RoomTier; hostKey?: string | null   (absent = "pass", null)
  claim(grant?: RoomGrant): Promise<boolean>   // default { tier: "pass", hostKey: null }
  upgrade(): Promise<void>                      // sets tier "pass", commits; no-op if already pass or unclaimed
  hostKeyMatches(key: string): boolean          // constant-time vs data.hostKey; false when null
  ```
- Seat `owner` becomes `isOwnerKey(key) || hostKeyMatches(key)`, computed in `onJoin` exactly where it is now.

- [ ] **Step 1: Write the failing tests** in `apps/server/test/tier.test.ts` using `World`/`join`/`send` from the harness, with `world.tierLimits = { premiumGameIds: ["dominion"], freeMaxPlayers: 2 }` and a games map of `{ sevens, dominion }`:
  - `claim() with no grant behaves like today` → `publicState.tier === "pass"`, `lockedGameIds` `[]`.
  - `free room locks premium games` → after `claim({tier:"free",hostKey:"hk"})`, state has `lockedGameIds: ["dominion"]`; host `select-game dominion` gets error code `"needs-pass"`, message `"This game needs Host Pass."`; `gameId` unchanged.
  - `free room caps seats at freeMaxPlayers` → third join gets fatal `"room-full"`.
  - `upgrade lifts lock and cap in place` → after `await room.upgrade()`, same connections see `tier: "pass"`, `lockedGameIds: []`, a third join succeeds, `select-game dominion` succeeds.
  - `tier never goes down` → `upgrade()` twice, then the room persists and reloads (`new runtime` over the same `world.store`, `load()`): still `"pass"`.
  - `host key seats the owner` → with `world.ownerRequired = true`, joining with `ownerKey: "hk"` on a room claimed with `hostKey: "hk"` gives `canStart: true`; `ownerKey: "wrong"` gives `canStart: false`.
  - `rooms stored before tiers default to pass` → put a stored `RoomData` without `tier`/`hostKey`, load, expect `tier: "pass"`.
- [ ] **Step 2: Run** `pnpm vitest run apps/server/test/tier.test.ts` → FAIL (no `tier` on state, `claim` ignores argument).
- [ ] **Step 3: Implement** the interfaces above. Locked ids = `tier === "free" ? tierLimits.premiumGameIds.filter(id => id in games) : []`. Seat cap in `onJoin` = `Math.min(def.manifest.maxPlayers, tier === "free" ? freeMaxPlayers : Infinity)`; `startGame` refuses a locked `gameId` with the same `needs-pass` error (covers a room whose game was selected before a hypothetical downgrade, which can't happen, but the check is one line). `hostKeyMatches` uses `safeEqual` from `@games/protocol`. `World.host()` passes `tierLimits: this.tierLimits` (default `undefined`).
- [ ] **Step 4: Run** `pnpm vitest run apps/server/test/tier.test.ts` → PASS, then `pnpm test && pnpm typecheck` → all PASS with no edits to existing tests.
- [ ] **Step 5: Commit on master** (`Rooms: tier and per-room host key`) and push.

### Task A2: Optional text filter hook

**Files:**
- Modify: `apps/server/src/runtime.ts` (`RoomHost`, `onJoin`, `case "chat"`)
- Test: `apps/server/test/tier.test.ts` (append)

**Interfaces:**
- Produces: `RoomHost.filterText?: (text: string) => string`. Applied after `normalizeName` in `onJoin` and after `cleanChatText` in chat. Absent = identity.

- [ ] **Step 1: Failing test** `filterText masks names and chat` → `world.filterText = (s) => s.replace(/darn/gi, "****")`; join as `"darn it"` → seat name `"**** it"`; chat `"oh darn"` → stored line text `"oh ****"`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; wire `World.filterText` through `host()`.
- [ ] **Step 4: Run** `pnpm test` → PASS.
- [ ] **Step 5: Commit on master** (`Rooms: optional text filter hook`) and push.

### Task A3: HostPolicy and a reusable Worker

**Files:**
- Create: `apps/server/src/policy.ts`
- Create: `apps/server/src/worker.ts` (moved out of `index.ts`: `wrap`, `RoomBase`, `createFetch`, `roomPage`, `canonical`, `isOwnerKey`)
- Modify: `apps/server/src/index.ts` (shrinks to wiring)
- Modify: `apps/server/package.json` (`"exports": { ".": "./src/index.ts", "./worker": "./src/worker.ts", "./games": "./src/games.ts" }`)
- Test: `apps/server/test/policy.test.ts`

**Interfaces:**
- Produces (`policy.ts`):
  ```ts
  export interface ServerEnv {
    Room: DurableObjectNamespace; ASSETS: Fetcher; OWNER_KEY?: string;
    DEV_TOOLS?: string; BLIND_RALLY?: string; TREASURE_HUNT?: string; BLIND_RALLY_GODOT?: GodotBucket;
  }
  export type CreateDecision = { ok: true; grant: RoomGrant; extra?: Record<string, unknown> } | { ok: false; response: Response };
  export interface HostPolicy { canCreate(request: Request, env: ServerEnv): Promise<CreateDecision> }
  export const ownerKeyPolicy: HostPolicy;   // today's check; grant { tier: "pass", hostKey: null }
  ```
- Produces (`worker.ts`):
  ```ts
  export class RoomBase extends Server<ServerEnv> {
    protected games(): Record<string, AnyGameDefinition>;  // default gamesFor(env flags)
    protected tierLimits(): TierLimits | undefined;         // default undefined
    protected filterText(): ((s: string) => string) | undefined; // default undefined
    claim(grant?: RoomGrant): Promise<boolean>;
    upgrade(hostKey: string): Promise<boolean>;  // false if key doesn't match; else runtime.upgrade(), true
  }
  export interface WorkerOptions { policy: HostPolicy; brand: string; onRoomCreated?(code: string, grant: RoomGrant, request: Request): Promise<void> }
  export function createFetch(opts: WorkerOptions): (request: Request, env: ServerEnv) => Promise<Response>;
  ```
  `createFetch` keeps today's routes: `POST /api/rooms` (policy → claim loop → `onRoomCreated` → `json({ code, ...extra })`), `/parties/*`, Godot, `/room/:code` preview (title `Join room ${code} · ${brand}`).
- `index.ts` becomes: `export class Room extends RoomBase {}` and `export default { fetch: createFetch({ policy: ownerKeyPolicy, brand: "Party Games" }) }`.

- [ ] **Step 1: Failing tests** in `policy.test.ts`: `ownerKeyPolicy` → no `OWNER_KEY` → `ok:false`, status 503; wrong bearer → 403; right bearer → `ok:true`, grant `{tier:"pass",hostKey:null}`. Plus `createFetch returns extra fields` with a stub policy returning `extra: { hostKey: "hk" }` and a fake `Room` namespace whose stub `claim` returns true → body `{ code, hostKey: "hk" }`.
- [ ] **Step 2: Run** → FAIL (modules don't exist).
- [ ] **Step 3: Implement** by moving code, not rewriting it. The fake namespace for the test: `getServerByName` is imported from partyserver; inject it via an optional `WorkerOptions.getRoom?(env, code)` defaulting to `getServerByName(env.Room, code)` so the test needn't fake partyserver.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck` → PASS; `pnpm dev`, open `/#owner=dev`, create a room, start Sevens with two tabs → works as before.
- [ ] **Step 5: Commit on master** (`Server: HostPolicy seam and a reusable Worker`) and push.

### Task A4: Shell seam in the web app

**Files:**
- Create: `apps/web/src/shell.ts`
- Modify: `apps/web/src/main.ts` (calls `startShell({})`)
- Modify: `apps/web/src/router.ts` (`APP_TITLE` → `appTitle()` from shell config; fallback path configurable)
- Modify: `apps/web/src/views/home.ts` (create via `config.createRoom`, show create button when `config.canCreate()`)
- Modify: `apps/web/src/views/room.ts` (`getOwnerKey` → `config.hostKeyFor(code)`; locked rows)
- Modify: `apps/web/src/games.ts` (export `overrideGameNames`)
- Modify: `apps/web/package.json` (`"exports": { "./shell": "./src/shell.ts", "./games": "./src/games.ts", "./style.css": "./src/style.css" }`)
- Test: `apps/web/test/shell.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ShellOptions {
    homePath?: string;                       // default "/"
    appTitle?: string;                       // default "Party Games"
    canCreate?: () => boolean;               // default () => !!getOwnerKey()
    createRoom?: () => Promise<{ code: string } | { error: string; forgetKey?: boolean }>; // default: today's owner-key fetch
    hostKeyFor?: (code: string) => string | null; // default () => getOwnerKey()
    onLockedGame?: (gameId: string, code: string) => void; // default: nothing
    nameOverrides?: Record<string, string>;
    beforeStart?: (outlet: HTMLElement) => void;
  }
  export function startShell(opts: ShellOptions): void;
  export function shellConfig(): Required<Omit<ShellOptions, "nameOverrides" | "beforeStart">>;
  export function configure(opts: ShellOptions): void;   // what startShell calls first; tests call it directly
  export function overrideGameNames(map: Record<string, string>): void; // mutates games[id].manifest.name (copy manifest, don't mutate the shared import)
  ```
- Locked row in the game picker: when `room.lockedGameIds.includes(id)`, the row gets class `locked`, a `tag` "Host Pass", and its click calls `onLockedGame(id, code)` instead of sending `select-game`.

- [ ] **Step 1: Failing tests** (`shell.test.ts`, no DOM needed): `overrideGameNames({dominion:"Frontier"})` → `games.dominion.manifest.name === "Frontier"` and `dominionManifest.name` still `"Dominion"`; `shellConfig()` defaults after `startShell` is not called: `homePath "/"`, `appTitle "Party Games"`. (Export a `configure(opts)` used by `startShell` so tests call it without touching `document`.)
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** `startShell` = `configure(opts)`, `overrideGameNames`, register `homePath` → `HomeView` and `/room/:code` → `RoomView`, `claimOwnerKeyFromUrl()`, `watchKeyboard()`, `beforeStart?.(outlet)`, `start(outlet)`. Add a `.game-option.locked` style (muted, lock tag) in `style.css`.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck` → PASS; `pnpm dev` smoke as in A3 plus the game list looks unchanged.
- [ ] **Step 5: Commit on master** (`Web: startShell seam`) and push. Then `git switch product && git merge master && git push`.

---

## Part B: the product (on `product`)

### Task B1: Product Worker scaffold, schema, entitlements

**Files:**
- Create: `apps/product-server/{package.json,tsconfig.json,wrangler.jsonc}`
- Create: `apps/product-server/migrations/0001_init.sql`
- Create: `apps/product-server/src/db.ts`, `src/entitlements.ts`, `src/index.ts` (minimal: `Room extends RoomBase`, fetch = `createFetch` with a temporary deny-all policy)
- Create: `apps/product-server/test/d1.ts` (D1 fake over `node:sqlite`)
- Test: `apps/product-server/test/entitlements.test.ts`

**Interfaces:**
- `package.json`: name `@games/product-server`, `"exports": { "./catalog-data": "./src/catalog-data.ts" }`, deps `@games/server: workspace:*`, `@games/protocol`, `@games/game-core`, `partyserver`; scripts `dev` (`wrangler dev --port 8788 --var DEV_TOOLS:1 --var ADMIN_KEY:dev --var TURNSTILE_SECRET:1x0000000000000000000000000000000AA`), `types`, `typecheck`, `deploy`, `db:migrate` (`wrangler d1 migrations apply couchparty --remote`), `db:migrate:local`.
- `wrangler.jsonc`: name `couchparty`; route `couchpartygames.com` custom domain; `assets.directory ../product-web/dist`, `not_found_handling "404-page"`, `run_worker_first ["/api/*","/parties/*","/room/*","/play","/blind-rally/godot/*","/treasure-hunt/godot/*"]`; vars `DEV_TOOLS "0"`, `BLIND_RALLY "1"`, `TREASURE_HUNT "1"`, `APP_ORIGIN "https://couchpartygames.com"`, `TURNSTILE_SITE_KEY "<set at setup>"`, `GOOGLE_CLIENT_ID "<set at setup>"`; `d1_databases [{ binding: "DB", database_name: "couchparty", database_id: "<from wrangler d1 create>", migrations_dir: "migrations" }]`; R2 `BLIND_RALLY_GODOT` → `couchparty-godot`; `ratelimits` `CREATE_LIMIT` (namespace_id `"1001"`, 10 per 60 s) and `EMAIL_LIMIT` (`"1002"`, 5 per 60 s); DO `Room`, migration `v1 new_sqlite_classes ["Room"]`. Secrets (not in file): `RESEND_API_KEY`, `GOOGLE_CLIENT_SECRET`, `TURNSTILE_SECRET`, `ADMIN_KEY`.
- Schema (`0001_init.sql`):
  ```sql
  CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
  CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
  CREATE TABLE login_tokens (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, next TEXT, expires_at INTEGER NOT NULL, used_at INTEGER);
  CREATE TABLE entitlements (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('razorpay','paddle','comp','grant')), plan TEXT NOT NULL,
    starts_at INTEGER NOT NULL, ends_at INTEGER, ref TEXT, revoked_at INTEGER, UNIQUE (user_id, source, ref));
  CREATE TABLE comp_codes (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, days INTEGER, max_uses INTEGER NOT NULL,
    uses INTEGER NOT NULL DEFAULT 0, note TEXT, created_at INTEGER NOT NULL, revoked_at INTEGER);
  CREATE TABLE rooms (code TEXT PRIMARY KEY, tier TEXT NOT NULL, ip_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE INDEX rooms_recent ON rooms (created_at);
  ```
- `db.ts`: `export type Db = Pick<D1Database, "prepare" | "batch">`; `normalizeEmail(s: string): string` (trim + lowercase); `sha256Hex(s: string): Promise<string>`; `newId(): string`.
- `entitlements.ts`: `export type Tier = RoomTier; tierFor(db: Db, userId: string, now: number): Promise<Tier>` (any row with `revoked_at IS NULL AND starts_at <= now AND (ends_at IS NULL OR ends_at > now)`); `grant(db, userId, { source, plan, days: number | null, ref: string | null }, now): Promise<void>`; `activePlan(db, userId, now): Promise<{ source; endsAt: number | null } | null>` (the latest-ending active row, null-forever wins).
- `test/d1.ts`: `fakeD1(): Db` over `new DatabaseSync(":memory:")`, applies every file in `migrations/` in order, implements `prepare(sql).bind(...).first<T>()/all<T>()/run()` (returning `{ meta: { changes } }`) and `batch(stmts)` in a transaction.

- [ ] **Step 1: Failing tests** `entitlements.test.ts`: no rows → `"free"`; grant 1 day → `"pass"` at `now`, `"free"` at `now + 86_400_000`; `days: null` → pass forever; revoked row → free; two rows, one expired one forever → `activePlan` returns `endsAt: null`.
- [ ] **Step 2: Run** `pnpm vitest run apps/product-server` → FAIL. Add `apps/product-server` to vitest `include` only if the existing glob misses it (it shouldn't: `{apps,…}/*/{src,test}/**/*.test.ts`).
- [ ] **Step 3: Implement.** `pnpm install`, `pnpm --filter @games/product-server types`.
- [ ] **Step 4: Run** tests → PASS; `pnpm typecheck` → PASS (proves shared code doesn't lean on master's `Env`).
- [ ] **Step 5: Commit** (`CouchParty: product Worker scaffold, schema, entitlements`) and push.

### Task B2: Comp codes

**Files:**
- Create: `apps/product-server/src/comps.ts`
- Test: `apps/product-server/test/comps.test.ts`

**Interfaces:**
- ```ts
  createCode(db, { maxUses: number; days: number | null; note?: string; prefix?: string }, now): Promise<string>  // e.g. "FAM-7Q2X-K9MD": prefix + two groups of 4 from A-Z2-9 minus I,O,0,1
  redeem(db, userId: string, code: string, now): Promise<{ ok: true; endsAt: number | null } | { ok: false; reason: "unknown" | "revoked" | "used-up" | "already-redeemed" }>
  revokeCode(db, code: string, now): Promise<boolean>   // sets comp_codes.revoked_at and revoked_at on every entitlement with source 'comp' and ref = code id
  listCodes(db): Promise<Array<{ code; uses; maxUses; days; note; revoked: boolean }>>
  ```
- Redeem order: look up (case-insensitive, strip spaces/dashes before compare by storing a normalized form in `code`), check revoked, check existing entitlement `(user, 'comp', id)` → `already-redeemed` without touching `uses`; then `UPDATE comp_codes SET uses = uses + 1 WHERE id = ? AND uses < max_uses AND revoked_at IS NULL` and require `changes === 1` else `used-up`; then `grant(source 'comp', plan 'comp', ref id)`.

- [ ] **Step 1: Failing tests:** redeem valid → pass; same user again → `already-redeemed`, `uses` still 1; `maxUses: 1` and second user → `used-up`; two users redeem concurrently (`Promise.all`) on a 1-use code → exactly one `ok`; lowercase with spaces `" fam 7q2x k9md "` works; revoke → both the code and the earlier redemption → user tier `"free"`; `days: 30` → `endsAt = now + 30 days`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** (`CouchParty: comp codes`) and push.

### Task B3: Accounts and sign-in

**Files:**
- Create: `apps/product-server/src/auth.ts` (sessions, magic link, Google), `src/email.ts` (Resend send), `src/turnstile.ts`, `src/http.ts` (`json`, cookie helpers, `clientIp(request)`)
- Test: `apps/product-server/test/auth.test.ts`

**Interfaces:**
- ```ts
  // auth.ts
  export function userFromRequest(db: Db, request: Request, now: number): Promise<{ id: string; email: string } | null>
  export function handleAuth(request: Request, env: ProductEnv, deps: AuthDeps): Promise<Response | null>  // null = not an auth route
  export interface AuthDeps { now(): number; sendEmail(to: string, subject: string, html: string): Promise<void>; fetch: typeof fetch; verifyTurnstile(token: string, ip: string): Promise<boolean> }
  ```
- Routes:
  - `POST /api/auth/email` `{ email, next?, turnstileToken }` → `EMAIL_LIMIT` by IP, Turnstile, store `login_tokens` (15 min), email a link `${APP_ORIGIN}/api/auth/verify?token=…`. Always `200 { ok: true }` for a well-formed email (no account enumeration). Subject: `Your CouchParty sign-in link`. Body: one line + button + "This link works for 15 minutes. If you did not ask for it, ignore this email."
  - `GET /api/auth/verify?token=` → unused, unexpired → mark used, upsert user by `normalizeEmail`, create session, `Set-Cookie`, `302` to `next` if it starts with `/` and not `//`, else `/account`. Bad token → `302 /account?error=link`.
  - `GET /api/auth/google?next=` → state = random, cookie `cp_oauth` (10 min, HttpOnly) holding `state|next`; `302` to `https://accounts.google.com/o/oauth2/v2/auth` with `client_id`, `redirect_uri=${APP_ORIGIN}/api/auth/google/callback`, `response_type=code`, `scope=openid email`, `state`.
  - `GET /api/auth/google/callback?code&state` → state must match cookie; `POST https://oauth2.googleapis.com/token`; decode `id_token` payload (trusted: fetched directly from Google over TLS); require `email_verified` and `aud === GOOGLE_CLIENT_ID`; then same as verify.
  - `POST /api/auth/logout` → delete session row, clear cookie.
  - `GET /api/me` → `{ email, tier, plan: activePlan }` or `{ email: null, tier: "free" }`.
  - `DELETE /api/account` → requires session; deletes user (cascade) and clears cookie.
- `turnstile.ts`: `POST https://challenges.cloudflare.com/turnstile/v0/siteverify` form `secret`, `response`, `remoteip` → `success`.
- `email.ts`: `POST https://api.resend.com/emails` with `from: "CouchParty <hello@couchpartygames.com>"`.

- [ ] **Step 1: Failing tests** with `fakeD1`, a fake clock, a capturing `sendEmail`, and a stub `fetch` for Google: magic link round trip sets cookie and `/api/me` returns the email; reused token → redirect with `error=link`; expired (16 min) → same; `"  Foo@X.com "` and `"foo@x.com"` → one `users` row; `next=//evil.com` → redirects to `/account`; Google callback with mismatched state → 400; with `email_verified: false` → 400; happy path → session; `DELETE /api/account` removes user, sessions and entitlements; unknown email still gets `{ ok: true }`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** (`CouchParty: accounts, magic link and Google sign-in`) and push.

### Task B4: Product rooms: policy, renames, limits, upgrade, filter

**Files:**
- Create: `apps/product-server/src/rooms.ts` (`productPolicy`, `recordRoom`, `handleUpgrade`), `src/catalog-data.ts`, `src/catalog.ts` (renamed games, `PRODUCT_LIMITS`), `src/filter.ts`
- Modify: `apps/product-server/src/index.ts` (real wiring)
- Test: `apps/product-server/test/rooms.test.ts`, `test/filter.test.ts`

**Interfaces:**
- `catalog-data.ts` (pure data, no Worker types; exported as `@games/product-server/catalog-data` so the web app imports the same values): `PREMIUM_GAME_IDS = ["blind-rally","rally","treasure-hunt","dominion"]`, `FREE_MAX_PLAYERS = 8`, `PRODUCT_NAMES = { dominion: "Frontier", scribbl: "Doodle Dash" }`.
- `catalog.ts`: `PRODUCT_LIMITS: TierLimits = { premiumGameIds: PREMIUM_GAME_IDS, freeMaxPlayers: FREE_MAX_PLAYERS }`; `productGames(flags): Record<string, AnyGameDefinition>` (copies each renamed definition with a copied manifest).
- `rooms.ts`:
  - `productPolicy(deps): HostPolicy` → signed-in user with `tierFor === "pass"` → grant `pass`, skip Turnstile; otherwise require `x-turnstile-token` header valid, `CREATE_LIMIT` by IP, and caps from `rooms` table over the last 6 h: ≤ 5 free rooms per `ip_hash`, ≤ 2000 free rooms total → else `429 { error: "Too many rooms right now. Please try again later." }`. Grant always carries a fresh `hostKey`; `extra: { hostKey }`.
  - `recordRoom(db)` → the `onRoomCreated` hook: insert into `rooms` (`ip_hash` = sha256 of IP + `code`-independent daily salt is overkill: sha256 of IP is enough).
  - `POST /api/rooms/:code/upgrade` `{ hostKey }` → requires session with `tierFor === "pass"`, calls DO `upgrade(hostKey)`; `false` → 403; else `UPDATE rooms SET tier='pass'`, `200`.
- `filter.ts`: `maskProfanity(text: string): string` — word-boundary, case-insensitive match against a short list (`src/filter-words.ts`, ~40 common English and Hindi/Hinglish slurs and swears), replaced by `*` of equal length. Must not mask inside longer words ("Scunthorpe", "class").
- `index.ts`: `export class Room extends RoomBase` overriding `games()` → `productGames(...)`, `tierLimits()` → `PRODUCT_LIMITS`, `filterText()` → `maskProfanity`. Fetch order: `handleAuth` → admin (B5) → upgrade → `/play` serves `ASSETS /play.html` → `createFetch({ policy: productPolicy, brand: "CouchParty", onRoomCreated: recordRoom })`. `/room/:code` must serve `play.html`, not `/`: add `WorkerOptions.shellPath?: string` (default `"/"`) in `apps/server/src/worker.ts` — **a master hook: do it on master as a follow-up commit in this task, then merge.**

- [ ] **Step 1: Failing tests:** anonymous without Turnstile → 403; anonymous with token → `{ code, hostKey }` and a `rooms` row with `tier 'free'`; sixth free room from one IP in 6 h → 429; pass user → no Turnstile needed, grant `pass`; upgrade with wrong host key → 403; upgrade signed out → 401; upgrade by a free user → 402 `{ error: "This needs Host Pass." }`; `productGames` names: `dominion` → "Frontier" and the original `dominionGame.manifest.name` unchanged. Filter: masks a listed word in any case; leaves "class", "Scunthorpe", "assassin" alone.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (master `shellPath` hook first, commit + push on master, merge into product).
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck` → PASS. `wrangler dev` with `db:migrate:local`: create a free room via curl with the Turnstile test token `XXXX.DUMMY.TOKEN.XXXX`, join two tabs at `/room/CODE`, Frontier shows locked.
- [ ] **Step 5: Commit** (`CouchParty: rooms, tiers, renames, filter`) and push.

### Task B5: Admin API and CLI

**Files:**
- Create: `apps/product-server/src/admin.ts`
- Create: `scripts/admin.mjs`; root `package.json` script `"admin": "node scripts/admin.mjs"`
- Test: `apps/product-server/test/admin.test.ts`

**Interfaces:**
- `/api/admin/*` requires `Authorization: Bearer ${ADMIN_KEY}` via `safeEqual`; no key set → 503.
  - `POST /api/admin/grant` `{ email, days: number | null }` → upserts the user by email, `grant(source 'grant', plan 'grant', ref null)` — for `ref null` uniqueness doesn't apply, so a second grant extends access by adding a row.
  - `POST /api/admin/revoke-grants` `{ email }` → sets `revoked_at` on that user's `source='grant'` rows.
  - `POST /api/admin/codes` `{ maxUses, days, note, prefix }` → `{ code }`; `GET /api/admin/codes` → list; `POST /api/admin/codes/:code/revoke`.
- CLI: `pnpm admin grant <email> [--days N | --forever]`, `pnpm admin revoke-grants <email>`, `pnpm admin code new [--uses N=1] [--days N | --forever] [--note text] [--prefix FAM]`, `pnpm admin code list`, `pnpm admin code revoke <code>`. Base URL from `--url` (default `https://couchpartygames.com`, `--local` = `http://127.0.0.1:8788`), key from `COUCHPARTY_ADMIN_KEY` env. Prints a one-line result; non-2xx → stderr + exit 1.

- [ ] **Step 1: Failing tests:** no bearer → 401; wrong bearer → 401; grant to an unknown email then that email signs in (magic link) → tier pass; revoke-grants → free; codes create/list/revoke round trip.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** both.
- [ ] **Step 4: Run** tests → PASS; against `wrangler dev`: `COUCHPARTY_ADMIN_KEY=dev pnpm admin --local code new --uses 3 --days 30 --note family` prints a code.
- [ ] **Step 5: Commit** (`CouchParty: admin API and CLI`) and push.

### Task B6: Product web: shell at /play

**Files:**
- Create: `apps/product-web/{package.json,tsconfig.json,vite.config.ts,play.html}`
- Create: `apps/product-web/src/play.ts`, `src/api.ts`, `src/header.ts`, `src/pass-sheet.ts`, `src/host-keys.ts`, `src/product.css`
- Test: `apps/product-web/test/host-keys.test.ts`

**Interfaces:**
- `vite.config.ts`: multi-page `build.rollupOptions.input` = `index`, `pricing`, `account`, `terms`, `privacy`, `play` HTML files (the five non-play pages come in B7; create stubs now so the build is stable). Dev proxy `/api`, `/parties` → `http://127.0.0.1:8788`; a tiny dev middleware rewriting `/play` and `/room/*` to `/play.html`.
- `api.ts`: `me(): Promise<Me>`, `createRoom(turnstileToken: string | null)`, `upgradeRoom(code, hostKey)`, `redeem(code)`, `logout()`, `deleteAccount()`, `startEmailSignIn(email, next, token)`.
- `host-keys.ts`: `saveHostKey(code, key)`, `hostKeyFor(code): string | null` — localStorage `cp-host-keys`, entries older than 6 h dropped on read.
- `play.ts`: `startShell({ homePath: "/play", appTitle: "CouchParty", canCreate: () => true, createRoom, hostKeyFor, onLockedGame: openPassSheet, nameOverrides: PRODUCT_NAMES (from `@games/product-server/catalog-data`), beforeStart: mountHeader })`. `createRoom` runs Turnstile invisibly (script `https://challenges.cloudflare.com/turnstile/v0/api.js`, site key from `/api/config`) when `me().tier === "free"`, stores the returned `hostKey`. On load, if URL has `?upgrade=1` and `/room/:code`, call `upgradeRoom` then strip the param.
- `header.ts`: thin bar above the outlet: wordmark → `/`, then either "Sign in" (→ `/account?next=<current path>`) or the email + a "Host Pass" badge when `tier === "pass"`.
- `pass-sheet.ts`: a `<dialog>`: title "This game needs Host Pass", lines "Host Pass opens all games for your whole room. Your friends do not need to pay.", then: signed out → "Sign in" (→ `/account?next=/room/CODE?upgrade=1`); signed in without pass → a code field "Have a code?" (redeem → `upgradeRoom` → close); and "Buying opens soon." in muted text. Signed in with pass (room was made before sign-in) → "Use my Host Pass here" → `upgradeRoom`.
- Add a server route `GET /api/config` → `{ turnstileSiteKey, googleEnabled }` in `apps/product-server/src/index.ts` (part of this task).

- [ ] **Step 1: Failing tests** `host-keys.test.ts` (stub `localStorage` with a Map): save then read; 7 h later → null; corrupt JSON → null, no throw.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** tests → PASS. Manual: `pnpm --filter @games/product-server dev` + `pnpm --filter @games/product-web dev`; `/play` → create room (no sign-in) → second tab joins → pick Frontier → sheet → sign in by magic link (Resend unset in dev: log the link to the console instead when `RESEND_API_KEY` is missing and `DEV_TOOLS=1`) → redeem a local comp code → room shows Frontier unlocked in both tabs without rejoining.
- [ ] **Step 5: Commit** (`CouchParty: shell at /play with sign-in and Host Pass sheet`) and push.

### Task B7: Landing, pricing, account, legal pages

**Files:**
- Create/replace: `apps/product-web/{index,pricing,account,terms,privacy,404}.html`
- Create: `apps/product-web/src/landing.ts`, `src/account.ts`, `src/site.css`
- Test: `apps/product-web/test/gallery.test.ts`

**Interfaces:**
- Load the `frontend-design` skill before designing; this is the user-facing surface where the spec says spend effort. Keep the existing brand mark and lime `#c6f432`.
- `landing.ts`: `galleryModel(): Array<{ section: string; games: Array<{ id; name; players: string; pass: boolean }> }>` built from `games` + `GAME_SECTIONS` (`@games/web/games`) after `overrideGameNames(PRODUCT_NAMES)`, `pass` from `PREMIUM_GAME_IDS` (`@games/product-server/catalog-data`). Flagged-off games (no Godot build) simply don't appear.
- `index.html` sections, in order (spec §5): hero "Party games for your group chat." + **Start a room** (→ `/play`) + muted line "No app. No sign-up for players."; How it works (3 steps: "Start a room." "Send the link in your group chat." "Everyone plays on their phone."); gallery; Host Pass (unlocks list; packs, history, cosmetics marked "Coming soon"; prices from `/api/config` country → ₹ or $ table from the spec; "Buying opens soon. Have a code? Redeem it on your account page."); FAQ (5 Qs: Do my friends need an account? / Do I need to download anything? / How many people can play? / What is Host Pass? / Is it free?); footer (Terms, Privacy, contact `hello@couchpartygames.com`). `/api/config` gains `country` from `CF-IPCountry`.
- Hero media: a static poster image per game card for now (screenshots taken from `pnpm dev`, saved under `apps/product-web/public/shots/`); the looping clip is a follow-up.
- `account.html`: signed out → Google button (if `googleEnabled`) + email form (Turnstile) + honours `?next=` and `?error=link` ("That link did not work. Ask for a new one."); signed in → email, plan line ("Host Pass until 12 Dec 2026" / "Host Pass, no end date" / "Free"), redeem-code form, Sign out, Delete account (two-step: button reveals "Yes, delete my account" — no `confirm()` dialog).
- `terms.html` / `privacy.html`: plain English per spec §7: 13+, conduct, comp/paid access can be revoked for abuse, refunds follow the payment provider (when billing opens); privacy lists exactly what's stored (host email, plan, codes redeemed, rooms created with a hashed IP for 6 h abuse limits), players store nothing, processors (Cloudflare, Resend, Google sign-in), deletion via the account page, DPDP and GDPR rights, contact email. Header note: "Last updated 11 Nov 2026."
- Every page: `<title>`, description, OG tags, favicon from the shell's brand assets, Cloudflare Web Analytics beacon (token via build-time `VITE_CF_BEACON`, omitted when unset).

- [ ] **Step 1: Failing test** `gallery.test.ts`: `galleryModel()` contains "Frontier" with `pass: true` under Strategy, "Doodle Dash" with `pass: false`, no entry named "Dominion" or "Scribbl"; sections keep `GAME_SECTIONS` order.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** tests → PASS; `pnpm --filter @games/product-web build` → PASS; check each page at 375 px and 1280 px wide in the browser, light and dark.
- [ ] **Step 5: Commit** (`CouchParty: landing, pricing, account and legal pages`) and push.

### Task B8: Deploy and setup

**Files:**
- Create: `scripts/deploy-product.mjs` (+ `.d.mts`), modelled on `scripts/deploy.mjs` with an exported `deploySteps(dryRun)`
- Modify: `scripts/godot-upload.mjs` (bucket from an option: `--bucket` default `party-games-blind-rally`)
- Create: `docs/couchparty.md` (setup runbook)
- Modify: root `package.json` (`"deploy:product": "node scripts/deploy-product.mjs"`)
- Test: `apps/server/test/deploy-product.test.ts`

**Interfaces:**
- `deploySteps(dryRun)` order: upload both Godot exports with `--bucket couchparty-godot` → `pnpm --filter @games/product-web build` with `VITE_BLIND_RALLY=1 VITE_TREASURE_HUNT=1` → drop godot dirs from `apps/product-web/dist` → `wrangler d1 migrations apply couchparty --remote` → `wrangler deploy` in `apps/product-server`.
- `docs/couchparty.md` runbook (the user runs these, via `!`): buy `couchpartygames.com` on Cloudflare Registrar; `wrangler d1 create couchparty` and paste the id; `wrangler r2 bucket create couchparty-godot`; Turnstile widget (site key into `wrangler.jsonc`, secret via `wrangler secret put TURNSTILE_SECRET`); Google OAuth client (redirect URI `https://couchpartygames.com/api/auth/google/callback`); Resend account + domain DNS (SPF/DKIM records on Cloudflare); `wrangler secret put` for `RESEND_API_KEY`, `GOOGLE_CLIENT_SECRET`, `ADMIN_KEY`; Web Analytics token; then `pnpm deploy:product`; then `pnpm admin code new --uses 20 --forever --note family`.

- [ ] **Step 1: Failing test:** `deploySteps(true)` lists the five steps in order, both uploads name `couchparty-godot`, the build sets both flags; and the master `deploySteps` still names `party-games-blind-rally`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (the `godot-upload.mjs` `--bucket` option is a master hook: commit on master first, merge).
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck` → PASS; `pnpm deploy:product --dry-run` prints the steps.
- [ ] **Step 5: Commit** (`CouchParty: deploy script and setup runbook`) and push. Don't deploy; the user runs the runbook.
