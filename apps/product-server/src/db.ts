export type Db = Pick<D1Database, "prepare" | "batch">;

/** Emails differing only in case or surrounding spaces are one account. */
export function normalizeEmail(s: string): string {
  return s.trim().toLowerCase();
}

export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 144 random bits, base64url. */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_");
}
