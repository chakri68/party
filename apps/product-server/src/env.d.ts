// Secrets aren't in wrangler.jsonc, so `wrangler types` can't see them.
// Set with `wrangler secret put <NAME>`; `pnpm dev` passes test values where needed.
interface Env {
  RESEND_API_KEY?: string;
  GOOGLE_CLIENT_SECRET?: string;
  TURNSTILE_SECRET?: string;
  ADMIN_KEY?: string;
  OWNER_KEY?: string;
}
