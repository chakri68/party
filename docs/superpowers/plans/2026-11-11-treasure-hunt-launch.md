# Treasure Hunt Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pnpm run deploy` ships Treasure Hunt to party-games.chakri.me the same way Blind Rally ships. Self-hosted copies keep it hidden.

**Architecture:**
- The Godot export's .wasm is over the 25 MiB asset limit. So, like Blind Rally, it goes to R2 (compressed with brotli-11) under its own hashed prefix. The Worker serves it at the same origin.
- One bucket and one route function serve both games, with a flag per game.
- `deploy.mjs` uploads both exports before it builds and deploys with both flags on.

**Tech Stack:** Node ESM scripts, a Cloudflare Worker (wrangler 4, R2), and vitest.

**Spec:** treasure-hunt-spec.md, in the repo root. Launch isn't a milestone there; this plan carries out "ship it like Blind Rally" (see the memory note blind-rally-direction: R2 hosting, hidden on self-host).

## Global Constraints

- Commit straight to master and push after each commit. Stage by path only, never `git add -A` or `git commit -a`. The repo root has untracked specs and zips, and an unrelated deleted ui_theme.md that must never be committed.
- No attribution lines in commit messages. The subject is "Treasure Hunt: …" (or "Deploy: …" for scripts/deploy.mjs), and the body is plain sentences.
- Never run `pnpm build` or `pnpm run deploy` (without `--dry-run`), and never run the real `--upload` (without `--local` or `--dry-run`). The real deploy is the controller's call, after the user says yes.
- The R2 bucket stays `party-games-blind-rally`, with the binding `BLIND_RALLY_GODOT`. Treasure Hunt's keys go under `treasure-hunt/godot/<hash>/`.
- Self-host (`scripts/host.mjs`) keeps `TREASURE_HUNT` at "0" and has no bucket.

## Review Focus

1. **Self-host and flag-off deploys:** `/treasure-hunt/godot/*` 404s without touching R2, and the game isn't listed. *Task 2 test.*
2. **Blind Rally regression:** its route, flag and upload behave exactly as before. *The existing godot.test.ts cases stay unchanged and must still pass (Task 2); Task 1 dry-run.*
3. **Flags are per game:** with only BLIND_RALLY on, Treasure Hunt paths 404, and the reverse. *Task 2 test.*
4. **A failed or half-finished Treasure Hunt upload** stops the deploy before `wrangler deploy`, and a rerun resumes. *The `.uploaded` marker is kept (Task 1); `run` exits on failure (Task 3).*
5. **Malformed requests on the new prefix:** a bad hash, traversal, a dotfile or another method gets the same 404/405 as Blind Rally's. *Task 2 test.*

---

### Task 1: One R2 uploader, used by both export scripts

**Files:**
- Create: `scripts/godot-upload.mjs` (Blind Rally's `upload()` and its constants, moved here and parameterised)
- Modify: `games/blind-rally/scripts/export-godot.mjs:143-247` (delete the moved code and call the shared one)
- Modify: `games/treasure-hunt/scripts/export-godot.mjs` (add `--upload [--dry-run] [--local [--persist-to <dir>]]`, and update the header comment)

**Interfaces:**
- Produces: `export function uploadGodot({ manifestPath, publicRoot, stagingRoot, keyRoot, argv }): void`
  - `keyRoot` is `"blind-rally/godot"` or `"treasure-hunt/godot"`.
  - The behaviour is Blind Rally's current upload, byte for byte:
    - it checks the files against the manifest;
    - it probes the `.uploaded` marker and skips the upload if the marker is there;
    - it compresses html/js/wasm/pck with brotli-11 and uploads them with `content-encoding: br`;
    - it puts the marker last;
    - `--dry-run` prints the commands and `--local`/`--persist-to` are passed through.
  - It locates wrangler from `apps/server`, as today.

- [ ] **Step 1:** Record the "before" output: `node games/blind-rally/scripts/export-godot.mjs --upload --dry-run > /tmp/br-before.txt`. Skip this if the Blind Rally public dir is missing; then note in the report that the first export has to be run with `--no-export`.
- [ ] **Step 2:** Create `scripts/godot-upload.mjs` and switch Blind Rally's script to it.
- [ ] **Step 3:** Run the same dry run again and diff it against the before output. Expected: identical.
- [ ] **Step 4:** Add `--upload` to Treasure Hunt's script with `keyRoot: "treasure-hunt/godot"` and staging in `games/treasure-hunt/build/r2/`.
- [ ] **Step 5:** Run `node games/treasure-hunt/scripts/export-godot.mjs --upload --dry-run`. Expected: 9 file puts plus `.uploaded`, all under `party-games-blind-rally/treasure-hunt/godot/<hash from client/godot/godot-build.json>/`, with `--content-encoding br` on html, js, wasm and pck, and none on png.
- [ ] **Step 6:** Commit and push.

### Task 2: The Worker serves Treasure Hunt's export

**Files:**
- Modify: `apps/server/src/godot.ts` (a table of games in place of the hard-coded prefix)
- Modify: `apps/server/wrangler.jsonc`:
  - add `"/treasure-hunt/godot/*"` to `run_worker_first`;
  - add `"TREASURE_HUNT": "0"` to `vars`;
  - update the comments.
- Modify: `apps/server/src/env.d.ts` (drop the "only pnpm dev" note)
- Modify: `apps/web/public/.assetsignore` (add `treasure-hunt/godot/`)
- Modify: comments that say Treasure Hunt is dev-only, in `apps/server/src/games.ts:66-71`, `apps/web/src/games.ts:65-69` and `scripts/host.mjs:187-189` (which should also name TREASURE_HUNT)
- Test: `apps/server/test/godot.test.ts`

**Interfaces:**
- `GodotEnv` gains `TREASURE_HUNT?: string`.
- `serveGodot(request, env)` keeps its signature. The routes are:
  - `/blind-rally/godot/<10 hex>/<file>`, gated by `BLIND_RALLY === "1"`, reading R2 key `blind-rally/godot/<hash>/<file>`;
  - `/treasure-hunt/godot/<10 hex>/<file>`, gated by `TREASURE_HUNT === "1"`, reading `treasure-hunt/godot/<hash>/<file>`.
  - Both need the `BLIND_RALLY_GODOT` bucket.
  - Everything else (headers, HEAD, ranges, 304, 405) is shared.

- [ ] **Step 1: Write the failing tests** in godot.test.ts, in a new `describe("Treasure Hunt's export")`:
  - `serves /treasure-hunt/godot/<hash>/index.wasm from treasure-hunt/godot/<hash>/index.wasm with TREASURE_HUNT=1`: status 200, `content-encoding: br`, `content-type: application/wasm`, and the bucket was asked for exactly that key.
  - `404s it with TREASURE_HUNT off, even with BLIND_RALLY on, without touching R2`: `bucket.gets` is empty.
  - `404s Blind Rally's paths with only TREASURE_HUNT on`.
  - `404s with no bucket bound`.
  - `rejects traversal, odd hashes and dotfiles on the new prefix`: use the same cases as the existing Blind Rally test.
  - `doesn't serve a Treasure Hunt key under the Blind Rally prefix`: a bucket holding only `treasure-hunt/godot/<h>/index.pck` gives a 404 for `/blind-rally/godot/<h>/index.pck`.
- [ ] **Step 2:** Run `pnpm vitest run apps/server/test/godot.test.ts`. Expected: the new tests FAIL and the old ones pass.
- [ ] **Step 3:** Implement the change, and update the config and comments listed above.
- [ ] **Step 4:** Run `pnpm vitest run apps/server` and `pnpm typecheck`. Expected: all pass. Leave the existing Blind Rally tests unedited.
- [ ] **Step 5:** Commit and push.

### Task 3: deploy.mjs ships both games

**Files:**
- Modify: `scripts/deploy.mjs`:
  - move the four steps into an exported `deploySteps(dryRun: boolean): Array<{cmd, args, env?} | {rm: string}>`;
  - run them in order only when the file is run directly (`import.meta.url` versus `process.argv[1]`);
  - update the header comment.
- Test: `apps/server/test/deploy.test.ts`. vitest.config.ts only includes `{apps,packages,games}/*/{src,test}`, so the test lives here and imports `../../../scripts/deploy.mjs`.

**Interfaces:**
- The steps, in this order:
  1. Blind Rally's `--upload`.
  2. Treasure Hunt's `--upload`. Both pass `--dry-run` when dry.
  3. `pnpm --filter @games/web build` with `{ VITE_BLIND_RALLY: "1", VITE_TREASURE_HUNT: "1" }`.
  4. Remove `apps/web/dist/blind-rally/godot`.
  5. Remove `apps/web/dist/treasure-hunt/godot`.
  6. `wrangler deploy --var BLIND_RALLY:1 --var TREASURE_HUNT:1`, plus `--dry-run` when dry.

- [ ] **Step 1: Write the failing tests:**
  - `uploads both exports before anything builds`: the indexes of both upload steps are lower than the build step's.
  - `builds with both lobby flags`.
  - `drops both godot dirs from dist before deploying`.
  - `deploys with both server flags`.
  - `passes --dry-run to both uploads and the deploy, and not to the build`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement the change.
- [ ] **Step 4:** Run the tests and `pnpm typecheck`. Expected: PASS. Don't run deploy.mjs itself.
- [ ] **Step 5:** Commit and push.

### Task 4: Local end-to-end check (controller)

- [ ] **Step 1:** Restart `pnpm dev`.
- [ ] **Step 2:** Run `node games/treasure-hunt/scripts/export-godot.mjs --upload --local`, with the same `--persist-to` that `pnpm dev`'s wrangler uses, so its simulated bucket sees the objects. The default is `apps/server/.wrangler/state`.
- [ ] **Step 3:** Fetch `curl -sI http://localhost:8787/treasure-hunt/godot/<hash>/index.wasm`. Expected: 200, `content-encoding: br`, `application/wasm`, and the immutable cache-control.
- [ ] **Step 4:** Fetch `/treasure-hunt/godot/<hash>/index.html`. Expected: 200.
- [ ] **Step 5:** Run the same upload a second time. Expected: "already uploaded".
- [ ] **Step 6:** Load a room in the browser. The page goes through Vite (5173), which serves the export from public/, so this is only a regression check. The R2 path was proven by the curl steps.
- [ ] **Step 7:** Log the results in the ledger.

### After the plan (controller, needs the user's yes)

The real `pnpm run deploy` uploads about 10 MB to R2 and replaces the live Worker. Ask first. Then open party-games.chakri.me, start a Treasure Hunt room, and check that the world loads.
