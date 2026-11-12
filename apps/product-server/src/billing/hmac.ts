// HMAC-SHA256 as lowercase hex, for provider signatures.

const enc = new TextEncoder();

function key(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await key(secret, "sign"), enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time check via subtle.verify. Bad hex is just a failed match. */
export async function verifyHmacHex(secret: string, message: string, hex: string): Promise<boolean> {
  try {
    if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return false;
    const bytes = new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));
    return await crypto.subtle.verify("HMAC", await key(secret, "verify"), bytes, enc.encode(message));
  } catch {
    return false;
  }
}
