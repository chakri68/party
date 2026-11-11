// Secrets aren't in wrangler.jsonc, so `wrangler types` can't see them.
// Set with `wrangler secret put OWNER_KEY`; `pnpm dev` passes "dev".
interface Env {
  OWNER_KEY?: string;
}
