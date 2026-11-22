// Secrets aren't in wrangler.jsonc, so `wrangler types` can't see them.
// TURN_KEY_ID and TURN_KEY_TOKEN (Cloudflare Realtime TURN) are secrets too; voice falls back to STUN without them.
// Set with `wrangler secret put OWNER_KEY`; `pnpm dev` passes "dev".
interface Env {
  OWNER_KEY?: string;
  TURN_KEY_ID?: string;
  TURN_KEY_TOKEN?: string;
}
