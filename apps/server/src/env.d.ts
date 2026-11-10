// Secrets aren't in wrangler.jsonc, so `wrangler types` can't see them.
// Set with `wrangler secret put OWNER_KEY`; `pnpm dev` passes "dev".
// TREASURE_HUNT isn't in wrangler.jsonc either: only `pnpm dev` passes it (M1).
interface Env {
  OWNER_KEY?: string;
  TREASURE_HUNT?: string;
}
