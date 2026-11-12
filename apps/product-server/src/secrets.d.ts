// Secrets aren't in wrangler.jsonc, so `wrangler types` can't see them.
// Set with `wrangler secret put <NAME>`; `pnpm dev` passes test values where needed.
interface Env {
  RESEND_API_KEY?: string;
  GOOGLE_CLIENT_SECRET?: string;
  TURNSTILE_SECRET?: string;
  ADMIN_KEY?: string;
  /** HMAC key for the IP hash in `rooms` (src/rooms.ts). */
  IP_HASH_KEY?: string;
  /** Razorpay (src/billing/razorpay.ts). */
  RAZORPAY_KEY_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
  /** Paddle (src/billing/paddle.ts). */
  PADDLE_API_KEY?: string;
  PADDLE_WEBHOOK_SECRET?: string;
}
