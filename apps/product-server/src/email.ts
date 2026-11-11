import type { ProductEnv } from "./env.ts";

export async function sendEmail(env: ProductEnv, to: string, subject: string, html: string, fetchFn: typeof fetch = fetch): Promise<void> {
  if (!env.RESEND_API_KEY) {
    if (env.DEV_TOOLS === "1") {
      const link = /href="([^"]+)"/.exec(html)?.[1];
      console.log(`[email] to=${to} subject=${subject} link=${link ?? "(none)"}`);
      return;
    }
    throw new Error("RESEND_API_KEY is not set");
  }
  const res = await fetchFn("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: "CouchParty <hello@couchpartygames.com>", to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend failed: ${res.status}`);
}
