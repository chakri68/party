import type { ProductEnv } from "./env.ts";

export interface Email {
  subject: string;
  html: string;
  /** Plain-text copy. Mail apps that skip HTML show this, and spam filters like having it. */
  text: string;
}

export async function sendEmail(env: ProductEnv, to: string, mail: Email, fetchFn: typeof fetch = fetch): Promise<void> {
  if (!env.RESEND_API_KEY) {
    if (env.DEV_TOOLS === "1") {
      const link = /href="([^"]+)"/.exec(mail.html)?.[1];
      console.log(`[email] to=${to} subject=${mail.subject} link=${link ?? "(none)"}`);
      return;
    }
    throw new Error("RESEND_API_KEY is not set");
  }
  const res = await fetchFn("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: "CouchParty <hello@couchpartygames.com>", to, subject: mail.subject, html: mail.html, text: mail.text }),
  });
  if (!res.ok) throw new Error(`Resend failed: ${res.status}`);
}

// Brand colours (branding/README.md). Mail apps ignore most CSS, so every
// style is inline and the layout is tables. The logo is a PNG on the site:
// Gmail and Outlook don't show SVG.
const INK = "#0e0e0c";
const PAPER = "#fffdf8";
const BONE = "#f3f1ea";
const MUTED = "#5c594f";
const LINE = "#e4e0d4";
const FONT = "'Space Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** The sign-in link email. The button is the first link, which the dev log and tests rely on. */
export function signInEmail(link: string, origin: string): Email {
  const site = origin.replace(/^https?:\/\//, "");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Sign in to CouchParty</title>
</head>
<body style="margin:0;padding:0;background:${BONE};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your sign-in link works for 15 minutes.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BONE};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
<tr><td style="padding:0 4px 20px;">
<img src="${origin}/email/lockup.png" width="160" height="38" alt="CouchParty" style="display:block;border:0;width:160px;height:auto;">
</td></tr>
<tr><td style="background:${PAPER};border:1px solid ${LINE};border-radius:16px;padding:32px 28px;font-family:${FONT};color:${INK};">
<h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;font-weight:700;color:${INK};">Sign in to CouchParty</h1>
<p style="margin:0 0 24px;font-size:16px;line-height:1.5;color:${INK};">Tap the button to sign in. You do not need a password.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:10px;background:${INK};">
<a href="${link}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">Sign in</a>
</td></tr></table>
<p style="margin:24px 0 0;font-size:14px;line-height:1.5;color:${MUTED};">This link works for 15 minutes. If you did not ask for it, ignore this email.</p>
<p style="margin:16px 0 0;padding-top:16px;border-top:1px solid ${LINE};font-size:13px;line-height:1.5;color:${MUTED};">Button not working? Open this link:<br><a href="${link}" style="color:${MUTED};word-break:break-all;">${link}</a></p>
</td></tr>
<tr><td style="padding:20px 4px 0;font-family:${FONT};font-size:13px;line-height:1.5;color:${MUTED};">
Party games for your group chat. <a href="${origin}" style="color:${MUTED};">${site}</a>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
  const text = `Sign in to CouchParty

Open this link to sign in. You do not need a password.

${link}

This link works for 15 minutes. If you did not ask for it, ignore this email.

CouchParty: party games for your group chat. ${origin}
`;
  return { subject: "Your CouchParty sign-in link", html, text };
}
